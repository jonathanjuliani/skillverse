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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-server-'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>ok</p>')
  fs.writeFileSync(path.join(dir, 'data.js'), 'window.SKILLVERSE = {}')
  server = spawn('node', ['server/skillverse-server.mjs', '--dir', dir, '--port', String(PORT)], { stdio: 'ignore' })
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

  it('never serves a file outside its folder', async () => {
    expect((await request('/../../etc/passwd', { headers: local })).status).not.toBe(200)
  })
})
