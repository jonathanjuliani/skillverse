import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PORT = 46000 + Math.floor(Math.random() * 1000)
let home = ''

/**
 * Runs the skillverse command under a temporary HOME, on the test's own port
 * (a Skillverse already running on the default ports must not count).
 */
function cli(...args: string[]) {
  try {
    const out = execFileSync('node', ['cli/skillverse.mjs', ...args], {
      env: { ...process.env, HOME: home, SKILLVERSE_PORT: String(PORT) },
      encoding: 'utf8',
    })
    return { out, code: 0 }
  } catch (error) {
    const failed = error as { stdout: string; status: number }
    return { out: failed.stdout, code: failed.status }
  }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-cli-'))
  const skill = path.join(home, '.claude', 'skills', 'write-docs')
  fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: write-docs\ndescription: Writes docs\n---\nBody')
})

afterAll(() => {
  cli('stop')
  fs.rmSync(home, { recursive: true, force: true })
})

describe('skillverse', () => {
  it('prints its version and help', () => {
    expect(cli('--version').out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(cli('--help').out).toContain('skillverse run')
  })

  it('refuses an unknown command', () => {
    expect(cli('bogus').code).toBe(2)
  })

  it('runs the web app in the background, reports it, and stops it', async () => {
    expect(cli('status').code).toBe(1)
    expect(cli('run', '--port', String(PORT)).out).toContain(`http://localhost:${PORT}/`)
    expect(cli('run', '--port', String(PORT)).out).toContain('Already running')
    expect(cli('status').out).toContain(`http://localhost:${PORT}/: web app`)

    const health = await (await fetch(`http://localhost:${PORT}/health`)).json()
    expect(health).toMatchObject({ skillverse: true })
    const data = await (await fetch(`http://localhost:${PORT}/data.js`)).text()
    expect(data).toContain('"write-docs"')
    const refresh = await (await fetch(`http://localhost:${PORT}/refresh`, { method: 'POST' })).json()
    expect(refresh).toEqual({ ok: true, skills: 1 })

    expect(cli('stop').out).toContain(`port ${PORT}`)
    expect(cli('status').code).toBe(1)
  })

  it('rejects a port that is not one', () => {
    expect(cli('run', '--port', 'abc').code).toBe(1)
  })
})
