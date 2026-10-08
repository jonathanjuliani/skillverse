// Finds the skills on this machine without Claude Code: the skill folders each
// AI agent reads, each SKILL.md parsed for its description and content.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { load, readJson } from './shared.mjs'

const { layoutGlobe, layoutGraph } = await load('layout')
const { assignRegions, linkSkills, parseSkillFile } = await load('skills')
const { buildWebData, combineAgents } = await load('web')

/** The agents scanned, in the order their globes show; `folder` is where each keeps skills, at home and in a project. */
export const AGENTS = [
  { id: 'claude', label: 'Claude Code', folder: '.claude' },
  { id: 'codex', label: 'Codex', folder: '.codex' },
  { id: 'cursor', label: 'Cursor', folder: '.cursor' },
  { id: 'shared', label: 'Shared (.agents)', folder: '.agents' },
]

/**
 * One agent's skills: `<folder>/skills` in the project (`cwd`) and at home;
 * for Claude Code also the skills of each plugin turned on in its settings.
 */
export function skillsOf(agent, cwd, home = os.homedir()) {
  const found = new Map()
  const add = (id, name, plugin, source, file) => {
    if (found.has(id)) return
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    const { meta, body } = parseSkillFile(text)
    found.set(id, {
      id,
      name,
      ...(plugin ? { plugin } : {}),
      source,
      region: '',
      description: meta.description ?? '',
      path: file,
      body,
      links: [],
    })
  }
  const scan = (root, source, plugin, depth = 0) => {
    let entries = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isFile()) continue
      const file = path.join(root, entry.name, 'SKILL.md')
      if (fs.existsSync(file)) add(plugin ? `${plugin}:${entry.name}` : entry.name, entry.name, plugin, source, file)
      else if (depth === 0) scan(path.join(root, entry.name), source, plugin, 1)
    }
  }

  const { folder } = AGENTS.find(known => known.id === agent) ?? { folder: `.${agent}` }
  scan(path.join(cwd, folder, 'skills'), 'projectSettings')
  scan(path.join(home, folder, 'skills'), 'userSettings')
  if (agent !== 'claude') return [...found.values()]
  const enabled = new Set()
  for (const file of [
    path.join(home, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
  ]) {
    for (const [key, isOn] of Object.entries(readJson(file)?.enabledPlugins ?? {})) if (isOn) enabled.add(key)
  }
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'))?.plugins ?? {}
  for (const key of enabled) {
    const name = key.split('@')[0]
    const dir = installed[key]?.[0]?.installPath
    if (!dir) continue
    const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json'))
    const declared = typeof manifest?.skills === 'string' ? [manifest.skills] : Array.isArray(manifest?.skills) ? manifest.skills : []
    for (const rel of declared) {
      const folder = path.join(dir, rel).replace(/\/SKILL\.md$/, '')
      if (fs.existsSync(path.join(folder, 'SKILL.md')))
        add(`${name}:${path.basename(folder)}`, path.basename(folder), name, 'plugin', path.join(folder, 'SKILL.md'))
      else scan(folder, 'plugin', name)
    }
    scan(path.join(dir, 'skills'), 'plugin', name)
  }

  return [...found.values()]
}

/** One agent's skills shaped for the web view: regions, links and both layouts, as the plugin makes them. */
export function shape(skills, generatedAt = new Date().toISOString()) {
  assignRegions(skills)
  linkSkills(skills)
  skills.sort((a, b) => a.id.localeCompare(b.id))
  const { regions, graph } = layoutGraph(skills)

  return buildWebData(skills, regions, graph, layoutGlobe(skills, regions), generatedAt)
}

/** Every agent's part, scanned; agents with no skills are left out when combined. */
export function scanParts(cwd, home = os.homedir()) {
  return AGENTS.map(({ id, label }) => ({ id, label, from: 'scan', data: shape(skillsOf(id, cwd, home)) }))
}

/** The web app's data: every agent's skills, combined (one globe each). */
export function scanAgents(cwd, home = os.homedir()) {
  return combineAgents(scanParts(cwd, home), new Date().toISOString())
}

/** Claude Code's skills alone, for the terminal app. */
export function scanSkills(cwd, home = os.homedir()) {
  return shape(skillsOf('claude', cwd, home))
}
