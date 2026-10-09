import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { sendHook } from '../../cli/hook.mjs'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { skillFileIn, slashSkill, toEvents } from '../../cli/hook-events.mjs'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { health } from '../../cli/server.mjs'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { hookCommand, isNpxCache, planSetup, setupStatus } from '../../cli/setup.mjs'

// What Cursor sends its hooks (cursor.com/docs/agent/hooks), trimmed to the fields read.
const cursor = {
  conversation_id: 'conv-1',
  generation_id: 'gen-1',
  workspace_roots: ['/Users/me/code/my-app'],
  user_email: 'me@example.com',
}

describe('toEvents', () => {
  it('spots a typed /skill in Cursor, and counts the prompt as a turn without sending its text', () => {
    const events = toEvents('cursor', { ...cursor, hook_event_name: 'beforeSubmitPrompt', prompt: '/review the diff, secret plan' })
    expect(events).toEqual([
      { kind: 'turn', session: 'conv-1', project: 'my-app', source: 'cursor' },
      { kind: 'skill', skill: 'review', session: 'conv-1', project: 'my-app', source: 'cursor' },
    ])
    expect(JSON.stringify(events)).not.toContain('secret')
    expect(JSON.stringify(events)).not.toContain('me@example.com')
  })

  it('spots a SKILL.md that a Cursor tool reads, and sends only the skill name', () => {
    const input = {
      ...cursor,
      hook_event_name: 'postToolUse',
      tool_name: 'read_file',
      tool_input: { target_file: '/Users/me/.cursor/skills/review/SKILL.md' },
    }
    expect(toEvents('cursor', input)).toEqual([{ kind: 'skill', skill: 'review', session: 'conv-1', project: 'my-app', source: 'cursor' }])
    expect(toEvents('cursor', { ...input, tool_input: { target_file: '/Users/me/code/my-app/README.md' } })).toEqual([])
  })

  it("reads Claude Code's hook shape: a Skill tool call and a subagent", () => {
    const base = { session_id: 's-1', cwd: '/Users/me/code/api' }
    expect(toEvents('claude', { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'docs:write' } })).toEqual(
      [{ kind: 'skill', skill: 'docs:write', session: 's-1', project: 'api', source: 'claude' }],
    )
    expect(toEvents('claude', { ...base, hook_event_name: 'SubagentStart', agent_id: 'a-1', agent_type: 'Explore' })).toEqual([
      { kind: 'agent', agent: 'a-1', agentType: 'Explore', session: 's-1', project: 'api', source: 'claude' },
    ])
  })

  it('sends nothing for an agent or an event it does not know', () => {
    expect(toEvents('nobody', { hook_event_name: 'beforeSubmitPrompt', prompt: '/x' })).toEqual([])
    expect(toEvents('cursor', { ...cursor, hook_event_name: 'afterFileEdit' })).toEqual([])
    expect(toEvents('cursor', null)).toEqual([])
  })

  it('tells a /skill from a path or plain text', () => {
    expect(slashSkill('/team:deploy now')).toBe('team:deploy')
    expect(slashSkill('/Users/me/file.ts is broken')).toBeUndefined()
    expect(slashSkill('please /review')).toBeUndefined()
    expect(skillFileIn({ paths: ['C:\\agents\\skills\\ship\\SKILL.md'] })).toBe('ship')
    expect(skillFileIn('/Users/me/.cursor/skills-cursor/create-skill/SKILL.md')).toBe('create-skill')
  })
})

describe('sendHook', () => {
  let server: http.Server
  let port = 0
  const received: unknown[] = []

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let body = ''
      request.on('data', chunk => {
        body += chunk
      })
      request.on('end', () => {
        if (request.url === '/events') received.push(...JSON.parse(body))
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ ok: true, skillverse: true, pid: process.pid }))
      })
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    port = (server.address() as { port: number }).port
  })

  afterAll(() => {
    server.close()
  })

  // Only the test server: never a web app the person has running.
  const find = async (ports: number[]) => health(ports[0])

  it('posts the events to the running web app', async () => {
    const text = JSON.stringify({ ...cursor, hook_event_name: 'beforeSubmitPrompt', prompt: '/review' })
    expect(await sendHook('cursor', text, [port], find)).toBe(2)
    expect(received).toContainEqual({ kind: 'skill', skill: 'review', session: 'conv-1', project: 'my-app', source: 'cursor' })
  })

  it('sends nothing for input that is not JSON', async () => {
    expect(await sendHook('cursor', 'not json', [port], find)).toBe(0)
  })

  it('exits 0 and prints nothing when no web app is running', () => {
    const run = spawnSync(process.execPath, ['bin/skillverse.mjs', 'hook', 'cursor', '--port', '1'], {
      input: JSON.stringify({ ...cursor, hook_event_name: 'beforeSubmitPrompt', prompt: '/review' }),
      encoding: 'utf8',
      timeout: 5000,
      // A home with no recorded web app, so the hook cannot reach one the person has running.
      env: { ...process.env, HOME: os.tmpdir(), SKILLVERSE_PORT: '' },
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
  })
})

describe('setup', () => {
  let home = ''
  const command = hookCommand('cursor', '/usr/bin/node', '/opt/skillverse/bin/skillverse.mjs')
  const file = () => path.join(home, '.cursor', 'hooks.json')
  const write = (plan: { file: string; after: string }) => {
    fs.mkdirSync(path.dirname(plan.file), { recursive: true })
    fs.writeFileSync(plan.file, plan.after)
  }

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-setup-'))
    fs.mkdirSync(path.join(home, '.cursor'))
  })

  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('adds its hooks to a new hooks.json, and a second run changes nothing', () => {
    const plan = planSetup('cursor', { home, command })
    expect(plan.before).toBeUndefined()
    expect(JSON.parse(plan.after)).toEqual({
      version: 1,
      hooks: { beforeSubmitPrompt: [{ command }], postToolUse: [{ command }] },
    })
    write(plan)
    expect(planSetup('cursor', { home, command }).isChanged).toBe(false)
    expect(setupStatus(home).find((one: { id: string }) => one.id === 'cursor')).toMatchObject({ isInstalled: true, isSetUp: true })
  })

  it("keeps the person's own hooks, and --undo takes out only Skillverse's", () => {
    const own = { command: './hooks/format.sh' }
    fs.writeFileSync(file(), JSON.stringify({ version: 1, hooks: { postToolUse: [own], afterFileEdit: [own] } }))
    const added = planSetup('cursor', { home, command })
    expect(JSON.parse(added.after).hooks.postToolUse).toEqual([own, { command }])
    write(added)
    const undone = planSetup('cursor', { home, isUndo: true, command })
    expect(JSON.parse(undone.after)).toEqual({ version: 1, hooks: { postToolUse: [own], afterFileEdit: [own] } })
  })

  it('replaces its entry when Skillverse moved, instead of adding a second', () => {
    write(planSetup('cursor', { home, command: hookCommand('cursor', '/old/node', '/old/skillverse/bin/skillverse.mjs') }))
    expect(JSON.parse(planSetup('cursor', { home, command }).after).hooks.beforeSubmitPrompt).toEqual([{ command }])
  })

  it('refuses a hooks.json that is not JSON, and an agent it does not know', () => {
    fs.writeFileSync(file(), '{ broken')
    expect(() => planSetup('cursor', { home, command })).toThrow(/not valid JSON/)
    expect(() => planSetup('nobody', { home, command })).toThrow(/knows cursor/)
  })

  it('knows the npx cache', () => {
    expect(isNpxCache('/Users/me/.npm/_npx/abc/node_modules/@jonathanjuliani/skillverse/bin/skillverse.mjs')).toBe(true)
    expect(isNpxCache('/usr/local/lib/node_modules/@jonathanjuliani/skillverse/bin/skillverse.mjs')).toBe(false)
  })
})
