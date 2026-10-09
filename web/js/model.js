// The skills as the server sends them (data.js sets window.SKILLVERSE), with
// what the views derive from them: agents, links both ways, twins, lookups.

const DATA = window.SKILLVERSE || { skills: [], regions: [] }

export const skills = DATA.skills
export const regions = DATA.regions

/** The agents, one planet each. Data from before agents existed is one agent. */
export const agents = DATA.agents?.length ? DATA.agents : [{ id: 'claude', label: 'Skills', count: skills.length, from: 'scan' }]

for (const [i, skill] of skills.entries()) {
  skill.i = i
  skill.agent ??= 0
  skill.twins ??= []
  skill.category ??= 'user'
}
for (const [r, region] of regions.entries()) {
  region.r = r
  region.agent ??= 0
  region.category ??= 'user'
}
for (const [a, agent] of agents.entries()) {
  agent.summary ??= { skills: agent.count, connectors: 0, plugins: 0, byCategory: {} }
  agent.i = a
}

/** The top-level groups of a planet, in the order they are listed, and their names. */
export const CATEGORIES = [
  ['plugins', 'Plugins'],
  ['user', 'Your skills'],
  ['builtin', 'Built-in'],
  ['mcp', 'Connectors (MCP)'],
  ['org', 'Organization'],
  ['project', 'Project'],
]
export const categoryLabel = category => CATEGORIES.find(([id]) => id === category)?.[1] ?? category

/** The region names that are just a category's word (hooks/skills.ts REGION_PREFIX). */
const BARE_REGIONS = new Set(['Plugin', 'User', 'Built-in', 'MCP', 'Organization', 'Project'])
export const isBareRegion = region => BARE_REGIONS.has(region.label)

/** A region's name under its category: without the category's word ("User · docs" is "docs"); a bare one is "Other", or "All" when alone. */
export function regionName(region, isAlone = false) {
  if (isBareRegion(region)) return isAlone ? 'All' : 'Other'
  const at = region.label.indexOf(' · ')
  return at >= 0 ? region.label.slice(at + 3) : region.label
}

/** A connector (an MCP server or app) rather than a skill. */
export const isConnector = i => skills[i].kind === 'mcp'

/** Each skill's neighbours, either direction, and each link once as [a, b]. */
export const neighbours = skills.map(() => new Set())
export const pairs = []
/** Each skill installed for several agents, once per pair: drawn faintly across agents. */
export const twinPairs = []
export const incoming = skills.map(() => [])
{
  const seen = new Set()
  for (const [i, skill] of skills.entries()) {
    for (const j of skill.links) {
      neighbours[i].add(j)
      neighbours[j].add(i)
      incoming[j].push(i)
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`
      if (!seen.has(key)) {
        seen.add(key)
        pairs.push([i, j])
      }
    }
    for (const j of skill.twins) if (i < j) twinPairs.push([i, j])
  }
}

export const colorOf = i => regions[skills[i].region]?.color || '#7aa2f7'
export const agentOf = i => skills[i].agent
export const skillsOfAgent = agent => skills.filter(skill => skill.agent === agent)
export const regionsOfAgent = agent => regions.filter(region => region.agent === agent)

/**
 * An agent's categories, each with its regions (biggest first), how many it
 * holds, and where its middle is on the planet (radians), for its label.
 */
export function categoriesOfAgent(agent) {
  const own = regionsOfAgent(agent)
  return CATEGORIES.flatMap(([id, label]) => {
    const list = own.filter(region => region.category === id).sort((x, y) => y.count - x.count)
    if (list.length === 0) return []
    let [x, y, z] = [0, 0, 0]
    for (const region of list) {
      x += Math.cos(region.lat) * Math.cos(region.lon) * region.count
      y += Math.cos(region.lat) * Math.sin(region.lon) * region.count
      z += Math.sin(region.lat) * region.count
    }
    const count = list.reduce((sum, region) => sum + region.count, 0)
    return [{ id, label, regions: list, count, lat: Math.atan2(z, Math.hypot(x, y)), lon: Math.atan2(y, x) }]
  })
}

/** The agent an event without a source came from: Claude Code's, when it is shown. */
export const LIVE_AGENT = Math.max(
  0,
  agents.findIndex(agent => agent.id === 'claude'),
)

// Per agent: each skill by id (without the agent's prefix) and by name.
const byId = agents.map(() => new Map())
const byName = agents.map(() => new Map())
for (const skill of skills) {
  if (skill.kind === 'mcp') continue
  const id = skill.id.toLowerCase()
  const prefix = skill.agent === 0 ? '' : `${agents[skill.agent].id}/`
  byId[skill.agent].set(id.startsWith(prefix) ? id.slice(prefix.length) : id, skill.i)
  const name = skill.name.toLowerCase()
  // A name two plugins share cannot say which one fired.
  byName[skill.agent].set(name, byName[skill.agent].has(name) ? -1 : skill.i)
}

/** The planet of an event's source (`cursor`), Claude Code's when it has none; -1 for an agent not shown. */
export function agentOfSource(source) {
  return source ? agents.findIndex(agent => agent.id === source) : LIVE_AGENT
}

/** The skill an event names (`docs:write`, `/write`, `write`) on its source's planet, or -1. */
export function findSkill(name, source) {
  const agent = agentOfSource(source)
  if (agent < 0 || !byId[agent]) return -1
  const key = String(name || '')
    .toLowerCase()
    .replace(/^\//, '')
  const short = key.split(':').pop()
  const byShort = byName[agent].get(short)
  return byId[agent].get(key) ?? (byShort >= 0 ? byShort : -1)
}

const connectorCount = skills.filter(skill => skill.kind === 'mcp').length
export const summary = `${skills.length - connectorCount} skills · ${connectorCount ? `${connectorCount} connectors · ` : ''}${agents.length > 1 ? `${agents.length} agents · ` : ''}${pairs.length} links`

// ---- Costs ------------------------------------------------------------------

/** Tokens in a text, the usual rough estimate (about four characters each). */
const estimate = text => Math.ceil(String(text).length / 4)

/**
 * What a skill costs: its description, in context in every session (measured by
 * a Claude Code session when one sent its figures, else estimated); its SKILL.md
 * when it loads (estimated); and how often the session used it.
 */
export function costOf(i) {
  const skill = skills[i]
  const stats = agents[skill.agent]?.stats
  const measured = stats?.listing?.perSkill?.[skill.id]
  // A connector's tools are listed by the agent itself; their cost is not in any file.
  if (skill.kind === 'mcp') return { listing: 0, isMeasured: false, body: 0, uses: 0 }
  return {
    listing: measured ?? estimate(`- ${skill.name}: ${skill.description}`),
    isMeasured: measured !== undefined,
    body: Math.ceil((skill.chars ?? skill.body.length) / 4),
    uses: stats?.uses?.[skill.id] ?? 0,
  }
}

/** What an agent's skills cost: listing them all (measured or estimated), and the new empty session where measured. */
export function agentCost(a) {
  const stats = agents[a]?.stats
  const own = skillsOfAgent(a).filter(skill => skill.kind !== 'mcp')
  return {
    listing: stats?.listing?.tokens ?? own.reduce((sum, skill) => sum + costOf(skill.i).listing, 0),
    isMeasured: Boolean(stats?.listing),
    baseline: stats?.baseline,
    heaviest: own.map(skill => ({ i: skill.i, tokens: costOf(skill.i).listing })).sort((x, y) => y.tokens - x.tokens),
    used: own
      .map(skill => ({ i: skill.i, uses: costOf(skill.i).uses }))
      .filter(row => row.uses > 0)
      .sort((x, y) => y.uses - x.uses),
  }
}
