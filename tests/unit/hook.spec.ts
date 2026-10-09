import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { sendHook } from '../../cli/hook.mjs'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { promptSkill, skillFileIn, toEvents } from '../../cli/hook-events.mjs'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { health } from '../../cli/server.mjs'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { hookCommand, isNpxCache, planSetup, planSkill, setupStatus, skillFile } from '../../cli/setup.mjs'

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
    expect(promptSkill('/team:deploy now')).toBe('team:deploy')
    expect(promptSkill('/Users/me/file.ts is broken')).toBeUndefined()
    expect(promptSkill('please /review')).toBeUndefined()
    expect(promptSkill('$HOME is wrong')).toBeUndefined()
    expect(promptSkill('$review it', '$/')).toBe('review')
    expect(skillFileIn({ paths: ['C:\\agents\\skills\\ship\\SKILL.md'] })).toBe('ship')
    expect(skillFileIn('/Users/me/.cursor/skills-cursor/create-skill/SKILL.md')).toBe('create-skill')
    expect(skillFileIn("sed -n '1,200p' /Users/me/.codex/skills/.system/imagegen/SKILL.md")).toBe('imagegen')
  })
})

// What each agent's docs say its hooks receive, trimmed to the fields read.
describe('toEvents, per agent', () => {
  const skill = (name: string, source: string, session: string, project?: string) => ({
    kind: 'skill',
    skill: name,
    session,
    ...(project ? { project } : {}),
    source,
  })

  it('Codex: a $skill prompt, and a SKILL.md its shell reads', () => {
    const base = { session_id: 'c-1', cwd: '/w/app', turn_id: 't-1', model: 'gpt' }
    expect(toEvents('codex', { ...base, hook_event_name: 'UserPromptSubmit', prompt: '$review now' })).toContainEqual(
      skill('review', 'codex', 'c-1', 'app'),
    )
    const read = {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'cat ~/.agents/skills/ship/SKILL.md' },
    }
    expect(toEvents('codex', read)).toEqual([skill('ship', 'codex', 'c-1', 'app')])
  })

  it('Devin: its skill tool, and the project from DEVIN_PROJECT_DIR (it sends no cwd)', () => {
    const input = { hook_event_name: 'PostToolUse', session_id: 'd-1', tool_name: 'skill', tool_input: { name: 'review' } }
    expect(toEvents('devin', input, { env: { DEVIN_PROJECT_DIR: '/w/api' } })).toEqual([skill('review', 'devin', 'd-1', 'api')])
  })

  it('Copilot and VS Code: a SKILL.md read through Claude Code event names', () => {
    const input = {
      hook_event_name: 'PostToolUse',
      session_id: 'p-1',
      cwd: '/w/web',
      tool_name: 'view',
      tool_input: { path: '/Users/me/.copilot/skills/docs/SKILL.md' },
    }
    expect(toEvents('copilot', input)).toEqual([skill('docs', 'copilot', 'p-1', 'web')])
  })

  it("Gemini CLI: BeforeAgent's prompt, and activate_skill", () => {
    const base = { session_id: 'g-1', cwd: '/w/cli', timestamp: '' }
    expect(toEvents('gemini', { ...base, hook_event_name: 'BeforeAgent', prompt: 'fix it' })).toEqual([
      { kind: 'turn', session: 'g-1', project: 'cli', source: 'gemini' },
    ])
    expect(
      toEvents('gemini', { ...base, hook_event_name: 'AfterTool', tool_name: 'activate_skill', tool_input: { name: 'review' } }),
    ).toEqual([skill('review', 'gemini', 'g-1', 'cli')])
  })

  it("Windsurf: an @skill prompt and a SKILL.md read; the project is the hook's folder", () => {
    const base = { trajectory_id: 'w-1', execution_id: 'e-1' }
    const prompt = { ...base, agent_action_name: 'pre_user_prompt', tool_info: { user_prompt: '@deploy to staging' } }
    expect(toEvents('windsurf', prompt, { cwd: '/w/site' })).toContainEqual(skill('deploy', 'windsurf', 'w-1', 'site'))
    const read = { ...base, agent_action_name: 'post_read_code', tool_info: { file_path: '/w/site/.windsurf/skills/ship/SKILL.md' } }
    expect(toEvents('windsurf', read, { cwd: '/w/site' })).toEqual([skill('ship', 'windsurf', 'w-1', 'site')])
  })

  it('Antigravity: a skill file view_file reads', () => {
    const input = {
      conversationId: 'a-1',
      workspacePaths: ['/w/mobile'],
      toolCall: { name: 'view_file', args: { AbsolutePath: '/Users/me/.gemini/config/skills/review/SKILL.md', IsSkillFile: true } },
    }
    expect(toEvents('antigravity', input)).toEqual([skill('review', 'antigravity', 'a-1', 'mobile')])
  })

  it("opencode: its skill tool, as Skillverse's plugin passes it on", () => {
    const input = { tool: 'skill', args: { name: 'git-release' }, session: 'o-1', directory: '/w/tool' }
    expect(toEvents('opencode', input)).toEqual([skill('git-release', 'opencode', 'o-1', 'tool')])
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
    expect(() => planSetup('cursor', { home, command })).toThrow(/not plain JSON/)
    expect(() => planSetup('nobody', { home, command })).toThrow(/knows cursor/)
  })

  it("writes each agent's own shape, and undo leaves the file as it was", () => {
    // biome-ignore lint/suspicious/noExplicitAny: each agent's file has its own shape
    const shapes: Record<string, (config: any) => unknown> = {
      codex: config => config.hooks.PostToolUse[0].hooks[0].command,
      devin: config => config.hooks.UserPromptSubmit[0].hooks[0].command,
      gemini: config => config.hooks.AfterTool[0].hooks[0].command,
      windsurf: config => config.hooks.post_read_code[0].command,
      antigravity: config => config.skillverse.PostToolUse[0].hooks[0].command,
    }
    for (const [agent, read] of Object.entries(shapes)) {
      const own = { model: 'theirs', hooks: { Stop: [{ command: 'mine' }] } }
      const plan0 = planSetup(agent, { home, command: 'x' })
      fs.mkdirSync(path.dirname(plan0.file), { recursive: true })
      fs.writeFileSync(plan0.file, JSON.stringify(own))
      const ours = hookCommand(agent, '/usr/bin/node', '/opt/skillverse/bin/skillverse.mjs')
      const added = planSetup(agent, { home, command: ours })
      expect(read(JSON.parse(added.after))).toBe(ours)
      expect(JSON.parse(added.after).model).toBe('theirs')
      write(added)
      expect(JSON.parse(planSetup(agent, { home, isUndo: true, command: ours }).after)).toEqual(own)
    }
  })

  it("writes Copilot's and opencode's files whole, and undo removes them", () => {
    const copilot = planSetup('vscode', { home, command })
    expect(copilot.file).toBe(path.join(home, '.copilot', 'hooks', 'skillverse.json'))
    expect(JSON.parse(copilot.after).hooks.PostToolUse[0]).toMatchObject({ bash: command, command })
    write(copilot)
    expect(planSetup('copilot', { home, isUndo: true }).after).toBeNull()
    const opencode = planSetup('opencode', { home, hookModule: '/opt/skillverse/cli/hook.mjs' })
    expect(opencode.after).toContain('"/opt/skillverse/cli/hook.mjs"')
    expect(opencode.after).toContain("'tool.execute.before'")
  })

  it('puts the /skillverse skill where each agent reads it, once, and leaves a skill that is not its own', () => {
    expect(skillFile('cursor', home)).toBe(path.join(home, '.cursor', 'skills', 'skillverse', 'SKILL.md'))
    expect(skillFile('codex', home)).toBe(path.join(home, '.agents', 'skills', 'skillverse', 'SKILL.md'))
    const codex = planSkill('codex', { home })
    expect(codex.after).toContain('name: skillverse')
    expect(codex.after).toContain('summary --agent <id>')
    write(codex)
    expect(planSkill('gemini', { home }).isChanged).toBe(false)
    // The shared copy stays while another agent that reads it is set up, and goes with the last one.
    expect(planSkill('codex', { home, isUndo: true, othersSetUp: ['gemini'] }).isChanged).toBe(false)
    expect(planSkill('codex', { home, isUndo: true, othersSetUp: ['cursor'] }).after).toBeNull()
    fs.writeFileSync(codex.file, '---\nname: skillverse\n---\nMine')
    expect(planSkill('codex', { home })).toMatchObject({ isChanged: false, isTheirs: true })
  })

  it('knows the npx cache', () => {
    expect(isNpxCache('/Users/me/.npm/_npx/abc/node_modules/@jonathanjuliani/skillverse/bin/skillverse.mjs')).toBe(true)
    expect(isNpxCache('/usr/local/lib/node_modules/@jonathanjuliani/skillverse/bin/skillverse.mjs')).toBe(false)
  })
})
