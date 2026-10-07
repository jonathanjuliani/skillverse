import { describe, expect, it } from 'vitest'
import { layoutGlobe, layoutGraph } from '../../hooks/layout'
import { assignRegions, type Skill } from '../../hooks/skills'

const skills = (count: number, plugins: number): Skill[] => {
  const list = Array.from({ length: count }, (_, i) => ({
    id: `p${i % plugins}:skill-${i}`,
    name: `skill-${i}`,
    plugin: `p${i % plugins}`,
    source: 'plugin',
    region: '',
    description: '',
    body: '',
    links: [],
  }))
  assignRegions(list)
  return list
}

const unit = (lat: number, lon: number) => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
const angle = (a: number[], b: number[]) =>
  Math.acos(Math.min(1, (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)))

describe('layoutGraph', () => {
  it('gives the same map for the same skills', () => {
    const list = skills(60, 5)
    expect(layoutGraph(list).graph).toEqual(layoutGraph(list).graph)
  })

  it('never overlaps two regions, and keeps every skill inside its own', () => {
    const { regions, graph } = layoutGraph(skills(60, 5))
    for (const a of regions) {
      for (const b of regions) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius)
      }
    }
    for (const [, region, x, y] of graph.nodes) {
      const [, , rx, ry, radius] = graph.regions[region] ?? ['', '', 0, 0, 0]
      expect(Math.hypot(x - rx, y - ry)).toBeLessThanOrEqual(radius + 1)
    }
  })
})

describe('layoutGlobe', () => {
  it('never overlaps two continents, and keeps every skill inside its own', () => {
    const list = skills(90, 7)
    const globe = layoutGlobe(list, layoutGraph(list).regions)
    for (const a of globe.regions) {
      for (const b of globe.regions) {
        if (a !== b) expect(angle(unit(a[2], a[3]), unit(b[2], b[3]))).toBeGreaterThanOrEqual(a[4] + b[4] - 0.01)
      }
    }
    for (const [, region, lat, lon] of globe.nodes) {
      const cap = globe.regions[region]
      expect(cap).toBeDefined()
      if (cap) expect(angle(unit(lat, lon), unit(cap[2], cap[3]))).toBeLessThanOrEqual(cap[4] + 0.001)
    }
  })
})
