import type { GraphProps, Region } from './layout'
import type { Category, Skill } from './skills'

const BODY_LIMIT = 6000

export type WebSkill = {
  id: string
  name: string
  /** Index into `agents`, once combined (combineAgents); absent for a single agent's data. */
  agent?: number
  /** Index into `regions`. */
  region: number
  category: Category
  /** A connector (an MCP server) rather than a skill. */
  kind?: 'mcp'
  /** The plugin it came with. */
  plugin?: string
  description: string
  path?: string
  /** SKILL.md's body, cut at BODY_LIMIT characters. */
  body: string
  /** The body's full length in characters (for its token cost when the skill loads). */
  chars: number
  /** Indexes into `skills`. */
  links: number[]
  /** Indexes into `skills`: the same skill (by name) installed for other agents. */
  twins?: number[]
  lat: number
  lon: number
  x: number
  y: number
}

export type WebRegion = {
  label: string
  category: Category
  color: string
  count: number
  lat: number
  lon: number
  cap: number
  x: number
  y: number
  /** Index into `agents`, once combined. */
  agent?: number
}

/**
 * What a Claude Code session measured about its agent (the pane's figures):
 * the new empty session by category, what listing the skills costs (in total
 * and per skill id), and how often each skill was used.
 */
export type AgentStats = {
  baseline?: { tokens: number; rows: { name: string; tokens: number }[] }
  listing?: { tokens: number; perSkill: Record<string, number> }
  uses?: Record<string, number>
  measuredAt?: string
}

/** What an agent has, by category: skills and connectors in each, and how many plugins brought them. */
export type AgentSummary = { skills: number; connectors: number; plugins: number; byCategory: Partial<Record<Category, number>> }

/**
 * An AI agent whose skills are shown, each a planet; `from` says how its list
 * was found. `count` is everything on the planet, skills and connectors.
 * `notes` says what a scan cannot see for it (Claude Code's built-in skills).
 */
export type WebAgent = {
  id: string
  label: string
  count: number
  from: 'scan' | 'session'
  summary: AgentSummary
  stats?: AgentStats
  notes?: string[]
}

export type WebData = { generatedAt: string; skills: WebSkill[]; regions: WebRegion[]; agents?: WebAgent[] }

/** One agent's own data (from buildWebData), to combine with the others'. */
export type AgentPart = { id: string; label: string; from: WebAgent['from']; data: WebData; stats?: AgentStats; notes?: string[] }

/** An agent's skills and connectors counted by category, and the plugins they came with. */
export function summarise(skills: Pick<WebSkill, 'category' | 'kind' | 'plugin'>[]): AgentSummary {
  const byCategory: AgentSummary['byCategory'] = {}
  for (const skill of skills) byCategory[skill.category] = (byCategory[skill.category] ?? 0) + 1
  const connectors = skills.filter(skill => skill.kind === 'mcp').length

  return {
    skills: skills.length - connectors,
    connectors,
    plugins: new Set(skills.flatMap(skill => (skill.plugin ? [skill.plugin] : []))).size,
    byCategory,
  }
}

/** Space left between two agents' 2D graphs. */
const AGENT_GAP = 160

/** Shapes the index for web/index.html: the same regions, links and both layouts the pane uses. */
export function buildWebData(skills: Skill[], regions: Region[], graph: GraphProps, globe: GraphProps, generatedAt: string): WebData {
  const position = new Map(skills.map((skill, i) => [skill.id, i]))
  const regionIndex = new Map(regions.map((region, i) => [region.label, i]))

  return {
    generatedAt,
    regions: regions.map((region, i) => {
      const cap = globe.regions[i]

      return {
        label: region.label,
        category: region.category,
        color: region.color,
        count: region.ids.length,
        lat: cap?.[2] ?? 0,
        lon: cap?.[3] ?? 0,
        cap: cap?.[4] ?? 0.2,
        x: Math.round(region.x),
        y: Math.round(region.y),
      }
    }),
    skills: skills.map((skill, i) => ({
      id: skill.id,
      name: skill.name,
      region: regionIndex.get(skill.region) ?? 0,
      category: skill.category ?? 'user',
      ...(skill.kind ? { kind: skill.kind } : {}),
      ...(skill.plugin ? { plugin: skill.plugin } : {}),
      description: skill.description,
      ...(skill.path ? { path: skill.path } : {}),
      body: skill.body.length > BODY_LIMIT ? `${skill.body.slice(0, BODY_LIMIT)}\n\n…` : skill.body,
      chars: skill.chars ?? skill.body.length,
      links: skill.links.flatMap(id => {
        const at = position.get(id)
        return at === undefined ? [] : [at]
      }),
      lat: globe.nodes[i]?.[2] ?? 0,
      lon: globe.nodes[i]?.[3] ?? 0,
      x: graph.nodes[i]?.[2] ?? 0,
      y: graph.nodes[i]?.[3] ?? 0,
    })),
  }
}

/**
 * Puts several agents' data into one: each skill and region keeps its agent,
 * indexes are shifted into the combined lists, the 2D graphs sit side by side,
 * and a skill installed for several agents (same name) is linked to its twins.
 * Ids of every agent but the first are prefixed with the agent's (`codex/docs`).
 * An agent with nothing found is kept: it is installed, so it is a planet.
 */
export function combineAgents(parts: AgentPart[], generatedAt: string): WebData {
  const skills: WebSkill[] = []
  const regions: WebRegion[] = []
  let right = 0

  for (const [agent, part] of parts.entries()) {
    const xs = [...part.data.skills.map(skill => skill.x), ...part.data.regions.map(region => region.x)]
    const shift = agent === 0 || xs.length === 0 ? 0 : right + AGENT_GAP - Math.min(...xs)
    if (xs.length > 0) right = Math.max(...xs) + shift
    const skillBase = skills.length
    const regionBase = regions.length
    for (const region of part.data.regions) regions.push({ ...region, agent, x: Math.round(region.x + shift) })
    for (const skill of part.data.skills) {
      skills.push({
        ...skill,
        id: agent === 0 ? skill.id : `${part.id}/${skill.id}`,
        agent,
        region: skill.region + regionBase,
        links: skill.links.map(at => at + skillBase),
        x: skill.x + shift,
      })
    }
  }

  const byName = new Map<string, number[]>()
  for (const [i, skill] of skills.entries()) byName.set(skill.name, [...(byName.get(skill.name) ?? []), i])
  for (const skill of skills) {
    const twins = (byName.get(skill.name) ?? []).filter(at => skills[at]?.agent !== skill.agent)
    if (twins.length > 0) skill.twins = twins
  }

  return {
    generatedAt,
    agents: parts.map(part => ({
      id: part.id,
      label: part.label,
      count: part.data.skills.length,
      from: part.from,
      summary: summarise(part.data.skills),
      ...(part.stats ? { stats: part.stats } : {}),
      ...(part.notes?.length ? { notes: part.notes } : {}),
    })),
    regions,
    skills,
  }
}
