import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { scanAgents, skillsOf } from '../../cli/scan.mjs'

let home = ''
let project = ''

const skill = (root: string, name: string, description = `About ${name}`) => {
  fs.mkdirSync(path.join(root, name), { recursive: true })
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}`)
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-home-'))
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-project-'))
  skill(path.join(home, '.claude', 'skills'), 'write-docs')
  skill(path.join(project, '.claude', 'skills'), 'ship')
  skill(path.join(home, '.codex', 'skills'), 'write-docs')
  skill(path.join(home, '.cursor', 'skills'), 'review')
  // A plugin turned on in Claude Code's settings, with one skill.
  const plugin = path.join(home, 'plugin-kit')
  skill(path.join(plugin, 'skills'), 'create')
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'kit@market': true } }))
  fs.writeFileSync(
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'kit@market': [{ installPath: plugin }] } }),
  )
})

afterAll(() => {
  for (const dir of [home, project]) fs.rmSync(dir, { recursive: true, force: true })
})

describe('skillsOf', () => {
  it('reads Claude Code at home, in the project and in turned-on plugins', () => {
    const ids = skillsOf('claude', project, home).map((found: { id: string }) => found.id)
    expect(ids.sort()).toEqual(['kit:create', 'ship', 'write-docs'])
  })

  it('reads another agent from its own folder only', () => {
    expect(skillsOf('codex', project, home).map((found: { id: string }) => found.id)).toEqual(['write-docs'])
    expect(skillsOf('shared', project, home)).toEqual([])
  })
})

describe('scanAgents', () => {
  it('combines the agents that have skills, one globe each, with twins across them', () => {
    const data = scanAgents(project, home)
    expect(data.agents.map((agent: { id: string }) => agent.id)).toEqual(['claude', 'codex', 'cursor'])
    const docs = data.skills.findIndex((found: { id: string }) => found.id === 'write-docs')
    expect(data.skills[docs].twins.map((at: number) => data.skills[at].id)).toEqual(['codex/write-docs'])
  })
})
