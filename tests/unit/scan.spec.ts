import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { mergeSession, scanAgents, skillsOf } from '../../cli/scan.mjs'

let home = ''
let project = ''

const skill = (root: string, name: string, description = `About ${name}`) => {
  fs.mkdirSync(path.join(root, name), { recursive: true })
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}`)
}
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const ids = (list: { id: string }[]) => list.map(found => found.id).sort()

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-home-'))
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-project-'))

  // Claude Code: a user skill, a project skill, a turned-on plugin with a skill and a server, a server of the user's.
  skill(path.join(home, '.claude', 'skills'), 'write-docs')
  skill(path.join(project, '.claude', 'skills'), 'ship')
  const plugin = path.join(home, 'plugin-kit')
  skill(path.join(plugin, 'skills'), 'create')
  write(
    path.join(plugin, '.mcp.json'),
    JSON.stringify({ mcpServers: { kit: { command: '/usr/local/bin/kit-server', args: ['--token', 'secret'] } } }),
  )
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'kit@market': true } }))
  write(
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'kit@market': [{ installPath: plugin }] } }),
  )
  // A plugin synced from a claude.ai organization.
  const synced = path.join(home, '.claude', 'plugins', 'synced', 'org_user', 'team-kit')
  write(path.join(synced, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'team-kit' }))
  skill(path.join(synced, 'skills'), 'triage')
  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { docs: { url: 'https://docs.example.com/mcp?key=secret' } } }))

  // Codex: a built-in system skill, a bundled plugin (built in), an installed one turned off, a server.
  skill(path.join(home, '.codex', 'skills', '.system'), 'imagegen')
  skill(path.join(home, '.codex', 'plugins', 'cache', 'openai-bundled', 'browser', '1.0', 'skills'), 'browse')
  skill(path.join(home, '.codex', 'plugins', 'cache', 'market', 'off', '1.0', 'skills'), 'hidden')
  write(
    path.join(home, '.codex', 'config.toml'),
    [
      '[plugins."browser@openai-bundled"]',
      'enabled = true',
      '[plugins."off@market"]',
      'enabled = false',
      '[mcp_servers.stitch]',
      'url = "https://stitch.example.com/mcp"',
      '[mcp_servers.stitch.http_headers]',
      'Authorization = "secret"',
    ].join('\n'),
  )

  // Cursor: a user skill, a built-in one, a cached plugin with a server file.
  skill(path.join(home, '.cursor', 'skills'), 'review')
  skill(path.join(home, '.cursor', 'skills-cursor'), 'create-rule')
  const cursorPlugin = path.join(home, '.cursor', 'plugins', 'cache', 'public', 'linear', 'abc123')
  write(path.join(cursorPlugin, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'linear' }))
  write(path.join(cursorPlugin, 'mcp.json'), JSON.stringify({ linear: { url: 'https://mcp.linear.app/mcp' } }))

  // GitHub Copilot: installed, nothing in it.
  fs.mkdirSync(path.join(home, '.copilot'), { recursive: true })
})

afterAll(() => {
  for (const dir of [home, project]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('skillsOf', () => {
  it('reads Claude Code at home, in turned-on plugins, and in the project only when given one', () => {
    expect(ids(skillsOf('claude', project, home))).toEqual([
      'kit:create',
      'mcp/docs',
      'mcp/kit/kit',
      'ship',
      'team-kit:triage',
      'write-docs',
    ])
    expect(ids(skillsOf('claude', undefined, home))).toEqual(['kit:create', 'mcp/docs', 'mcp/kit/kit', 'team-kit:triage', 'write-docs'])
  })

  it("puts an organization's synced plugins under Organization", () => {
    const triage = skillsOf('claude', undefined, home).find((one: { id: string }) => one.id === 'team-kit:triage')
    expect(triage).toMatchObject({ plugin: 'team-kit', category: 'org' })
  })

  it('keeps only the name and transport of a connector, never its command, arguments, headers or keys', () => {
    const found = skillsOf('claude', undefined, home)
    const kit = found.find((one: { id: string }) => one.id === 'mcp/kit/kit')
    expect(kit).toMatchObject({
      kind: 'mcp',
      category: 'mcp',
      plugin: 'kit',
      description: 'MCP server (stdio · kit-server), from the kit plugin',
    })
    expect(found.find((one: { id: string }) => one.id === 'mcp/docs').description).toBe('MCP server (http · docs.example.com)')
    expect(JSON.stringify(found)).not.toContain('secret')
  })

  it('reads Codex: built-ins from .system and its bundled market, plugins turned on, servers from config.toml', () => {
    const found = skillsOf('codex', undefined, home)
    expect(ids(found)).toEqual(['browser:browse', 'imagegen', 'mcp/stitch'])
    expect(found.filter((one: { category: string }) => one.category === 'builtin').length).toBe(2)
    expect(JSON.stringify(found)).not.toContain('secret')
  })

  it('reads Cursor: skills, built-in skills and a cached plugin with its server', () => {
    const found = skillsOf('cursor', undefined, home)
    expect(ids(found)).toEqual(['create-rule', 'mcp/linear/linear', 'review'])
    expect(found.find((one: { id: string }) => one.id === 'create-rule').category).toBe('builtin')
  })
})

describe('skillsOf, Devin and Antigravity', () => {
  it("reads Devin's skills, and Antigravity's from the folder its app, IDE and CLI share", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-more-'))
    skill(path.join(other, '.config', 'devin', 'skills'), 'triage')
    skill(path.join(other, '.gemini', 'config', 'skills'), 'review')
    skill(path.join(other, '.gemini', 'antigravity-cli', 'skills'), 'ship')
    expect(ids(skillsOf('devin', undefined, other))).toEqual(['triage'])
    expect(ids(skillsOf('antigravity', undefined, other))).toEqual(['review', 'ship'])
    fs.rmSync(other, { recursive: true, force: true })
  })
})

describe('scanAgents', () => {
  it('shows every installed agent as a planet, an empty one too, with twins across them', () => {
    const data = scanAgents(home)
    expect(data.agents.map((agent: { id: string }) => agent.id)).toEqual(['claude', 'codex', 'cursor', 'copilot'])
    expect(data.agents[3].count).toBe(0)
    expect(data.agents[0].summary).toMatchObject({ skills: 3, connectors: 2, plugins: 2 })
    // The web app is the machine-wide view: no project skills.
    expect(data.skills.some((found: { id: string }) => found.id === 'ship')).toBe(false)
  })
})

describe('mergeSession', () => {
  it("keeps a session's list without its project skills, and adds the connectors the scan found", () => {
    const sent = {
      skills: [
        { id: 'update-config', name: 'update-config', category: 'builtin', description: '', body: '', chars: 0 },
        { id: 'ship', name: 'ship', category: 'project', description: '', body: '', chars: 0 },
        { id: 'kit:create', name: 'create', description: '', body: 'Body', chars: 4000 },
      ],
      regions: [],
    }
    const data = mergeSession(sent, skillsOf('claude', undefined, home))
    expect(ids(data.skills)).toEqual(['kit:create', 'mcp/docs', 'mcp/kit/kit', 'update-config'])
    expect(data.skills.find((one: { id: string }) => one.id === 'kit:create')).toMatchObject({ category: 'plugins', chars: 4000 })
  })
})
