// Starts, finds and stops the Skillverse web app: the server in
// server/skillverse-server.mjs, run in the background with its pid, port and
// log under ~/.cache/skillverse.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CACHE_DIR, DEFAULT_PORTS, readJson } from './shared.mjs'

const SERVER = fileURLToPath(new URL('../server/skillverse-server.mjs', import.meta.url))
const ROOT = path.dirname(path.dirname(SERVER))
const STATE = path.join(CACHE_DIR, 'server.json')
const LOG = path.join(CACHE_DIR, 'server.log')
const START_TIMEOUT_MS = 5000

/** The ports to use: the one asked for (--port, then SKILLVERSE_PORT), else the defaults. */
export function portsFor(asked = process.env.SKILLVERSE_PORT) {
  const port = Number(asked)
  if (asked !== undefined && asked !== '' && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new Error(`not a port: ${asked}`)
  }
  return asked ? [port] : DEFAULT_PORTS
}

/** What a Skillverse server on `port` says about itself, or undefined when none answers there. */
export async function health(port) {
  try {
    const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(800) })
    const body = await response.json()
    return body?.skillverse === true ? { ...body, port, url: `http://localhost:${port}/` } : undefined
  } catch {
    // Nothing listens there, or something that is not Skillverse: both mean "not here".
    return undefined
  }
}

/** The running Skillverse web app on any of `ports` or the port skillverse run recorded. */
export async function findRunning(ports) {
  const recorded = readJson(STATE)?.port
  const found = (await Promise.all([...new Set([...(recorded ? [recorded] : []), ...ports])].map(health))).filter(Boolean)
  return found[0]
}

const isFree = port =>
  new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Starts the web app in the background on the first free port and waits for
 * it to answer. Resolves to the running server; one already running is
 * returned as is (`isNew` false).
 */
export async function start({ ports, project = process.cwd() }) {
  const running = await findRunning(ports)
  if (running) return { ...running, isNew: false }

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  for (const port of ports) {
    if (!(await isFree(port))) continue
    const log = fs.openSync(LOG, 'a')
    const child = spawn(process.execPath, [SERVER, '--port', String(port), '--project', project], {
      detached: true,
      stdio: ['ignore', log, log],
      cwd: ROOT,
    })
    child.unref()
    fs.closeSync(log)
    for (let waited = 0; waited < START_TIMEOUT_MS; waited += 150) {
      await sleep(150)
      const server = await health(port)
      if (server) {
        fs.writeFileSync(STATE, `${JSON.stringify({ pid: server.pid, port, startedAt: new Date().toISOString() }, null, 2)}\n`)
        return { ...server, isNew: true }
      }
      if (child.exitCode !== null) break
    }
  }
  throw new Error(`could not start the web app on ${ports.length > 1 ? `ports ${ports.join(', ')}` : `port ${ports[0]}`}; see ${LOG}`)
}

/** Runs the web app in this terminal until Ctrl+C; with `isDev`, restarts on code changes and reloads pages on web/ changes. */
export async function runHere({ ports, project = process.cwd(), isDev = false }) {
  const running = await findRunning(ports)
  if (running) throw new Error(`a Skillverse server already runs at ${running.url} (skillverse stop ends the one skillverse run started)`)
  const port = (await Promise.all(ports.map(isFree))).indexOf(true)
  if (port < 0) throw new Error(`no free port among ${ports.join(', ')}`)
  const watch = isDev
    ? ['--watch-path', path.join(ROOT, 'server'), '--watch-path', path.join(ROOT, 'cli'), '--watch-path', path.join(ROOT, 'hooks')]
    : []
  const child = spawn(
    process.execPath,
    [...watch, SERVER, '--port', String(ports[port]), '--project', project, ...(isDev ? ['--dev'] : [])],
    {
      stdio: 'inherit',
      cwd: ROOT,
    },
  )
  child.on('exit', code => process.exit(code ?? 0))
}

/** Stops the web app this CLI started. Resolves to its port, or undefined when none was running. */
export async function stop() {
  const state = readJson(STATE)
  if (!state) return undefined
  const server = await health(state.port)
  fs.rmSync(STATE, { force: true })
  // Only the process that still answers as our server: a pid can be reused after a restart.
  if (!server || server.pid !== state.pid) return undefined
  process.kill(state.pid, 'SIGTERM')
  for (let waited = 0; waited < START_TIMEOUT_MS && (await health(state.port)); waited += 100) await sleep(100)
  return state.port
}

export const LOG_FILE = LOG
