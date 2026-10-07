import type { GraphProps, Region } from './layout'
import type { Skill } from './skills'

const BODY_LIMIT = 6000

export type WebSkill = {
  id: string
  name: string
  /** Index into `regions`. */
  region: number
  description: string
  path?: string
  body: string
  /** Indexes into `skills`. */
  links: number[]
  lat: number
  lon: number
  x: number
  y: number
}

export type WebRegion = { label: string; color: string; count: number; lat: number; lon: number; cap: number; x: number; y: number }

export type WebData = { generatedAt: string; skills: WebSkill[]; regions: WebRegion[] }

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
      description: skill.description,
      ...(skill.path ? { path: skill.path } : {}),
      body: skill.body.length > BODY_LIMIT ? `${skill.body.slice(0, BODY_LIMIT)}\n\n…` : skill.body,
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
