#!/usr/bin/env node
// Skillverse server: serves the web view and relays live events to it.
//
//   node server/skillverse-server.mjs [--port 4317] [--project <folder>] [--dev] [--keep 50] [--log events.ndjson]
//
// The web app: the page from web/, the skills from a scan of every agent on
// this machine (and of --project's skill folders), rebuilt on POST /refresh.
// --dev reloads open pages when a file under web/ changes. `skillverse run`
// starts it; the Claude Code plugin only finds it and feeds it.
//
//   GET  /data.js         the skills, as window.SKILLVERSE = {...}
//   POST /refresh         scan again
//   POST /skills          {"agent":"claude","data":{...},"stats":{...}}: a session's exact list (and what it
//                         measured: the new empty session, listing cost, uses), replacing that agent's scan
//   POST /events          one event or an array: {"kind":"skill","skill":"docs:write","agent":"main","turn":3,"session":"a1b2c3d4","project":"my-app"}
//   GET  /events/stream   server-sent events: the last --keep events (marked history), then each new one
//   GET  /health          {"ok":true,"skillverse":true,"version":"0.1.0","clients":1,"seq":42,"pid":123}
//
// Nothing is written to disk unless --log names a file (one JSON line per event).
// It listens on 127.0.0.1 only, answers only requests addressed to this
// machine (no DNS rebinding), and grants no cross-origin access: the web view
// it serves is same-origin, so no other site can read the skills or events.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : fallback
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version
const DIR = path.join(HERE, '..', 'web')
const PROJECT = path.resolve(arg('--project', process.cwd()))
const IS_DEV = process.argv.includes('--dev')
const PORT = Number(arg('--port', 4317))
const KEEP = Number(arg('--keep', 50))
const LOG = arg('--log', '')
const MAX_BODY = 64 * 1024
// A session's skill list carries every SKILL.md body (cut at 6000 characters each).
const MAX_SKILLS_BODY = 16 * 1024 * 1024
const KINDS = new Set(['skill', 'agent', 'tool', 'turn'])
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
}

let seq = 0
// The web app's skills: one part per agent (a scan, or a session's own list), combined on ask.
let parts
let data
let recent = []
const clients = new Set()

/** Keeps only the fields the page reads, as strings or numbers of sane size. */
function clean(input) {
  if (!input || typeof input !== 'object' || !KINDS.has(input.kind)) return null
  const text = value => (typeof value === 'string' ? value.slice(0, 200) : undefined)
  const event = {
    seq: ++seq,
    at: Date.now(),
    kind: input.kind,
    turn: Number.isFinite(input.turn) ? input.turn : 0,
    agent: text(input.agent) || 'main',
  }
  for (const key of ['skill', 'parent', 'agentType', 'tool', 'session', 'project']) if (text(input[key])) event[key] = text(input[key])
  return event
}

function publish(event) {
  recent = KEEP > 0 ? [...recent, event].slice(-KEEP) : []
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const client of clients) client.write(line)
  if (LOG) fs.appendFile(LOG, `${JSON.stringify(event)}\n`, () => {})
}

/**
 * The web app's skills as the page loads them: every agent scanned on first
 * ask and again on POST /refresh, where a session's own list (POST /skills)
 * stays in place of its agent's scan.
 */
async function skillsScript(isFresh = false) {
  const scan = await import('../cli/scan.mjs')
  if (!parts || isFresh) {
    const sent = new Map((parts ?? []).filter(part => part.from === 'session').map(part => [part.id, part]))
    parts = scan.scanParts(PROJECT).map(part => sent.get(part.id) ?? part)
    data = undefined
  }
  data ??= (await import('../cli/shared.mjs').then(shared => shared.load('web'))).combineAgents(parts, new Date().toISOString())
  return `window.SKILLVERSE = ${JSON.stringify(data)}\n`
}

/** A session's stats as the plugin sends them: an object of the known keys, nothing else kept. */
function isStats(value) {
  const isObject = item => item !== null && typeof item === 'object' && !Array.isArray(item)
  return isObject(value) && Object.keys(value).every(key => ['baseline', 'listing', 'uses', 'measuredAt'].includes(key))
}

/** Takes a session's skill list for one agent; resolves to how many skills it holds. */
async function takeSkills(body) {
  const { agent, data: sent, stats } = JSON.parse(body)
  if (typeof agent !== 'string' || !Array.isArray(sent?.skills) || !Array.isArray(sent?.regions))
    throw new Error('expected {"agent","data":{"skills","regions"}}')
  await skillsScript()
  const { AGENTS } = await import('../cli/scan.mjs')
  const known = AGENTS.find(item => item.id === agent)
  if (!known) throw new Error(`unknown agent: ${agent}`)
  const part = { id: agent, label: known.label, from: 'session', data: sent, ...(isStats(stats) ? { stats } : {}) }
  parts = [...parts.filter(item => item.id !== agent), part].sort(
    (a, b) => AGENTS.findIndex(item => item.id === a.id) - AGENTS.findIndex(item => item.id === b.id),
  )
  data = undefined
  return sent.skills.length
}

/** Tells every open page something other than an event (a named server-sent event). */
function signal(name) {
  for (const client of clients) client.write(`event: ${name}\ndata: {}\n\n`)
}

function readBody(request, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

const send = (response, status, body, type = 'application/json') => {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

/** Only requests addressed to this machine, from a page on this machine (or no page at all). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const hostnameOf = value => {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}
function isLocalRequest(request) {
  // A page that rebinds its own name to 127.0.0.1 still sends its own name as Host.
  if (!LOCAL_HOSTS.has(hostnameOf(`http://${request.headers.host || ''}`))) return false
  // Another site's page (fetch, form or EventSource) sends its Origin.
  const origin = request.headers.origin
  return !origin || LOCAL_HOSTS.has(hostnameOf(origin))
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost')

  if (!isLocalRequest(request)) return send(response, 403, { ok: false, error: 'not a local request' })

  if (url.pathname === '/events' && request.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(request))
      const events = (Array.isArray(body) ? body : [body]).map(clean).filter(Boolean)
      events.forEach(publish)
      return send(response, 202, { ok: true, accepted: events.length, seq })
    } catch (error) {
      return send(response, 400, { ok: false, error: String(error.message || error) })
    }
  }

  if (url.pathname === '/events/stream') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    response.write('retry: 2000\n\n')
    for (const event of recent) response.write(`data: ${JSON.stringify({ ...event, history: true })}\n\n`)
    clients.add(response)
    request.on('close', () => clients.delete(response))
    return
  }

  if (url.pathname === '/health')
    return send(response, 200, { ok: true, skillverse: true, version: VERSION, clients: clients.size, seq, pid: process.pid })

  if (url.pathname === '/data.js') {
    try {
      return send(response, 200, await skillsScript(), TYPES['.js'])
    } catch (error) {
      return send(response, 500, `console.error(${JSON.stringify(`Skillverse could not scan: ${error.message}`)})`, TYPES['.js'])
    }
  }

  if (url.pathname === '/skills' && request.method === 'POST') {
    try {
      const count = await takeSkills(await readBody(request, MAX_SKILLS_BODY))
      signal('reload')
      return send(response, 200, { ok: true, skills: count })
    } catch (error) {
      return send(response, 400, { ok: false, error: error.message })
    }
  }

  if (url.pathname === '/refresh' && request.method === 'POST') {
    try {
      await skillsScript(true)
      signal('reload')
      return send(response, 200, { ok: true, skills: parts.reduce((sum, part) => sum + part.data.skills.length, 0) })
    } catch (error) {
      return send(response, 500, { ok: false, error: error.message })
    }
  }

  // Static files from DIR, never outside it.
  const file = path.resolve(DIR, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`)
  if (!file.startsWith(DIR + path.sep)) return send(response, 403, { ok: false })
  fs.readFile(file, (error, data) => {
    if (error) return send(response, 404, { ok: false })
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(data)
  })
})

// A comment line every 15 s keeps idle streams open through proxies and sleep.
setInterval(() => {
  for (const client of clients) client.write(': ping\n\n')
}, 15000)

server.on('error', error => {
  console.error(`skillverse-server: ${error.message}`)
  process.exit(1)
})
if (IS_DEV) {
  // Editors save in bursts; one reload per burst.
  let timer
  fs.watch(DIR, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => signal('reload'), 100)
  })
}

server.listen(PORT, '127.0.0.1', () =>
  console.log(
    `skillverse-server: http://localhost:${PORT}/ serving ${DIR}${IS_DEV ? ' (reloading on change)' : ''}${LOG ? `, logging to ${LOG}` : ''}`,
  ),
)
