// The skills as the server sends them (data.js sets window.SKILLVERSE), with
// what the views derive from them: agents, links both ways, twins, lookups.

const DATA = window.SKILLVERSE || { skills: [], regions: [] }

export const skills = DATA.skills
export const regions = DATA.regions

/** The agents, one globe each. Data from before agents existed is one agent. */
export const agents = DATA.agents?.length ? DATA.agents : [{ id: 'claude', label: 'Skills', count: skills.length, from: 'scan' }]

for (const [i, skill] of skills.entries()) {
  skill.i = i
  skill.agent ??= 0
  skill.twins ??= []
}
for (const [r, region] of regions.entries()) {
  region.r = r
  region.agent ??= 0
}

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

/** The agent whose sessions send live events: Claude Code's, when it is shown. */
export const LIVE_AGENT = Math.max(
  0,
  agents.findIndex(agent => agent.id === 'claude'),
)

const byId = new Map()
const byName = new Map()
for (const skill of skills) {
  if (skill.agent !== LIVE_AGENT) continue
  byId.set(skill.id.toLowerCase(), skill.i)
  const name = skill.name.toLowerCase()
  // A name two plugins share cannot say which one fired.
  byName.set(name, byName.has(name) ? -1 : skill.i)
}

/** The live agent's skill an event names (`docs:write`, `/write`, `write`), or -1. */
export function findSkill(name) {
  const key = String(name || '')
    .toLowerCase()
    .replace(/^\//, '')
  const short = key.split(':').pop()
  return byId.get(key) ?? (byName.get(short) >= 0 ? byName.get(short) : -1)
}

export const summary = `${skills.length} skills · ${agents.length > 1 ? `${agents.length} agents · ` : ''}${pairs.length} links`

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
  const own = skillsOfAgent(a)
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
