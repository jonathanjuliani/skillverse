import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PORT = 47000 + Math.floor(Math.random() * 1000)
let server: ChildProcess
let dir = ''

/** A raw request, so the test can send the Host and Origin headers a browser page would. */
function request(pathname: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: pathname, method: init.method ?? 'GET', headers: init.headers },
      res => {
        res.resume()
        resolve({ status: res.statusCode ?? 0, headers: res.headers })
      },
    )
    req.on('error', reject)
    req.end(init.body)
  })
}

beforeAll(async () => {
  // An empty home: the scan finds no skills, which is all the security checks need.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-server-'))
  server = spawn('node', ['server/skillverse-server.mjs', '--port', String(PORT)], {
    stdio: 'ignore',
    env: { ...process.env, HOME: dir },
  })
  for (let attempt = 0; attempt < 50; attempt++) {
    const ready = await request('/health', { headers: { host: `localhost:${PORT}` } }).catch(() => undefined)
    if (ready?.status === 200) return
    await new Promise(done => setTimeout(done, 50))
  }
  throw new Error('the server did not start')
})

afterAll(() => {
  server.kill()
  fs.rmSync(dir, { recursive: true, force: true })
})

const local = { host: `localhost:${PORT}` }
const event = JSON.stringify({ kind: 'turn' })

describe('skillverse-server', () => {
  it('serves the web view to a local request', async () => {
    expect((await request('/data.js', { headers: local })).status).toBe(200)
  })

  it('refuses a request addressed to another host name (DNS rebinding)', async () => {
    expect((await request('/data.js', { headers: { host: `evil.example.com:${PORT}` } })).status).toBe(403)
  })

  it('refuses events posted by another site, and accepts them from the web view', async () => {
    const post = (origin: string) =>
      request('/events', { method: 'POST', headers: { ...local, origin, 'content-type': 'application/json' }, body: event })
    expect((await post('https://evil.example.com')).status).toBe(403)
    expect((await post(`http://localhost:${PORT}`)).status).toBe(202)
  })

  it('refuses the live event stream to another site', async () => {
    expect((await request('/events/stream', { headers: { ...local, origin: 'https://evil.example.com' } })).status).toBe(403)
  })

  it('grants no cross-origin access', async () => {
    const { headers } = await request('/health', { headers: local })
    expect(headers['access-control-allow-origin']).toBeUndefined()
  })

  it("serves each agent's summary without the skills, to a local request only", async () => {
    const response = await fetch(`http://localhost:${PORT}/summary.json`)
    expect(Array.isArray((await response.json()).agents)).toBe(true)
    expect((await request('/summary.json', { headers: { host: `evil.example.com:${PORT}` } })).status).toBe(403)
  })

  it('never serves a file outside web/', async () => {
    expect((await request('/../../etc/passwd', { headers: local })).status).not.toBe(200)
  })

  it("keeps an event's source, and numbers the turns of a session whose events come without them", async () => {
    const session = `hooked-${Date.now()}`
    const events = [
      { kind: 'turn', session, source: 'cursor' },
      { kind: 'skill', skill: 'review', session, source: 'cursor' },
      { kind: 'turn', session, source: 'cursor' },
      { kind: 'skill', skill: 'ship', session, source: 'Not An Id!' },
    ]
    await request('/events', { method: 'POST', headers: { ...local, 'content-type': 'application/json' }, body: JSON.stringify(events) })
    const controller = new AbortController()
    const response = await fetch(`http://localhost:${PORT}/events/stream`, { signal: controller.signal })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('the stream has no body')
    let text = ''
    while (!text.includes('"skill":"ship"')) text += new TextDecoder().decode((await reader.read()).value)
    controller.abort()
    const sent = text
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)))
      .filter(one => one.session === session)
    expect(sent.map(one => [one.kind, one.turn, one.source])).toEqual([
      ['turn', 1, 'cursor'],
      ['skill', 1, 'cursor'],
      ['turn', 2, 'cursor'],
      ['skill', 2, undefined],
    ])
  })

  it('keeps the stats a session sends with its skills, and ignores stats it does not know', async () => {
    const skill = { id: 'docs', name: 'docs', region: 0, description: '', body: '', chars: 0, links: [], lat: 0, lon: 0, x: 0, y: 0 }
    const region = { label: 'User', color: '#7aa2f7', count: 1, lat: 0, lon: 0, cap: 0.2, x: 0, y: 0 }
    const data = { skills: [skill], regions: [region], generatedAt: '' }
    const send = (stats: unknown) =>
      request('/skills', {
        method: 'POST',
        headers: { ...local, 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'claude', data, stats }),
      })
    const script = async () => {
      const response = await fetch(`http://localhost:${PORT}/data.js`)
      return response.text()
    }
    expect((await send({ listing: { tokens: 12, perSkill: { docs: 12 } }, uses: { docs: 2 } })).status).toBe(200)
    expect(await script()).toContain('"stats":{"listing":{"tokens":12')
    expect((await send({ evil: true })).status).toBe(200)
    expect(await script()).not.toContain('evil')
  })
})
