// Finds what each AI agent has on this machine without Claude Code: its
// plugins, skills and connectors (cli/agents.mjs), each SKILL.md parsed for
// its description and content, shaped into one planet per agent.

import os from 'node:os'

import { AGENTS, collector, isInstalled } from './agents.mjs'
import { load } from './shared.mjs'

const { layoutGlobe, layoutGraph } = await load('layout')
const { assignRegions, categoryOf, linkSkills, parseSkillFile, splitId } = await load('skills')
const { buildWebData, combineAgents } = await load('web')

export { AGENTS }

/**
 * One agent's skills and connectors, read from its folders at home; with a
 * project folder (`cwd`), Claude Code's project skills too (the terminal app
 * shows them; the web app is the machine-wide view and passes none).
 */
export function skillsOf(agent, cwd, home = os.homedir()) {
  const known = AGENTS.find(item => item.id === agent)
  if (!known) return []
  const found = collector(parseSkillFile)
  known.find(found, home, cwd)
  return found.list()
}

/** One agent's skills shaped for the web view: regions, links and both layouts, as the plugin makes them. */
export function shape(skills, generatedAt = new Date().toISOString()) {
  assignRegions(skills)
  linkSkills(skills)
  skills.sort((a, b) => a.id.localeCompare(b.id))
  const { regions, graph } = layoutGraph(skills)

  return buildWebData(skills, regions, graph, layoutGlobe(skills, regions), generatedAt)
}

/** Every installed agent's part (its folder exists at home), scanned; one with nothing found is still a planet. */
export function scanParts(home = os.homedir()) {
  return AGENTS.filter(agent => isInstalled(agent, home)).map(({ id, label, notes }) => ({
    id,
    label,
    from: 'scan',
    data: shape(skillsOf(id, undefined, home)),
    ...(notes ? { notes } : {}),
  }))
}

/**
 * A session's own list for its agent in place of the scan: the session knows
 * its skills exactly (built-ins included), the scan knows the connectors on
 * disk. Project skills are left out: the web app shows the machine, not one project.
 */
export function mergeSession(sent, scanned) {
  const skills = sent.skills
    .filter(skill => skill.category !== 'project')
    .map(skill => ({
      id: skill.id,
      name: skill.name,
      ...((skill.plugin ?? splitId(skill.id).plugin) ? { plugin: skill.plugin ?? splitId(skill.id).plugin } : {}),
      source: '',
      ...(skill.category ? { category: skill.category } : {}),
      ...(skill.kind ? { kind: skill.kind } : {}),
      region: '',
      description: skill.description,
      ...(skill.path ? { path: skill.path } : {}),
      body: skill.body,
      chars: skill.chars,
      links: [],
    }))
  const ids = new Set(skills.map(skill => skill.id))
  const names = new Set(skills.map(skill => skill.name))
  for (const skill of scanned) {
    if (categoryOf(skill) === 'mcp' && !ids.has(skill.id) && !names.has(skill.name)) skills.push(skill)
  }
  return shape(skills)
}

/** The web app's data: every installed agent, combined (one planet each). */
export function scanAgents(home = os.homedir()) {
  return combineAgents(scanParts(home), new Date().toISOString())
}

/** Claude Code's skills alone, project included, for the terminal app. */
export function scanSkills(cwd, home = os.homedir()) {
  return shape(skillsOf('claude', cwd, home))
}
