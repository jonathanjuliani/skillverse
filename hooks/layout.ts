import type { Skill } from './skills'

/** A group of skills (a plugin, or a source and name family) placed on the map. */
export type Region = {
  label: string
  color: string
  ids: string[]
  x: number
  y: number
  radius: number
}

/** A node: short name, region index, then world x and y (graph) or latitude and longitude in radians (globe). */
export type GraphNode = [string, number, number, number]

/** A region: label, color, centre (x, y or latitude, longitude), radius (world units or radians). */
export type GraphRegion = [string, string, number, number, number]

/** The graph and globe layouts (hooks/layout.ts), as the web view and the terminal app read them. */
export type GraphProps = {
  nodes: GraphNode[]
  regions: GraphRegion[]
  /** Pairs of node indexes, flattened. */
  edges: number[]
}

const SPACING = 8
const REGION_GAP = 10
const RELAX_STEPS = 50
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const PALETTE = [
  '#7aa2f7',
  '#9ece6a',
  '#e0af68',
  '#f7768e',
  '#bb9af7',
  '#7dcfff',
  '#ff9e64',
  '#73daca',
  '#c678dd',
  '#2ac3de',
  '#e5c07b',
  '#98c379',
  '#d19a66',
  '#56b6c2',
  '#ff79c6',
  '#b4f9f8',
]

type Point = { x: number; y: number }

/** Orders a region's skills so linked ones sit next to each other on its spiral. */
function linkedOrder(ids: string[], neighbours: Map<string, Set<string>>): string[] {
  const inRegion = new Set(ids)
  const degree = (id: string) => [...(neighbours.get(id) ?? [])].filter(other => inRegion.has(other)).length
  const pending = [...ids].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))
  const seen = new Set<string>()
  const order: string[] = []
  for (const start of pending) {
    if (seen.has(start)) {
      continue
    }
    const queue = [start]
    seen.add(start)
    while (queue.length > 0) {
      const id = queue.shift() ?? ''
      order.push(id)
      const next = [...(neighbours.get(id) ?? [])].filter(other => inRegion.has(other) && !seen.has(other)).sort()
      for (const other of next) {
        seen.add(other)
        queue.push(other)
      }
    }
  }

  return order
}

/** Pushes overlapping skills apart and pulls linked ones together, inside the region's circle. */
function relax(ids: string[], at: Map<string, Point>, centre: Point, radius: number, neighbours: Map<string, Set<string>>): void {
  for (let step = 0; step < RELAX_STEPS; step++) {
    for (let i = 0; i < ids.length; i++) {
      const a = at.get(ids[i] ?? '')
      if (!a) {
        continue
      }
      for (let j = i + 1; j < ids.length; j++) {
        const b = at.get(ids[j] ?? '')
        if (!b) {
          continue
        }
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy) || 0.01
        const isLinked = neighbours.get(ids[i] ?? '')?.has(ids[j] ?? '') ?? false
        const push = distance < SPACING ? (SPACING - distance) * 0.25 : isLinked ? -(distance - SPACING) * 0.02 : 0
        if (push !== 0) {
          const ux = (dx / distance) * push
          const uy = (dy / distance) * push
          a.x -= ux
          a.y -= uy
          b.x += ux
          b.y += uy
        }
      }
    }
    for (const id of ids) {
      const point = at.get(id)
      if (!point) {
        continue
      }
      const dx = point.x - centre.x
      const dy = point.y - centre.y
      const distance = Math.hypot(dx, dy)
      const limit = radius - SPACING / 2
      if (distance > limit) {
        point.x = centre.x + (dx / distance) * limit
        point.y = centre.y + (dy / distance) * limit
      }
    }
  }
}

/**
 * Lays the skills out as a map of regions: each region a circle sized to its
 * skills, packed outward on a spiral, largest first, with its skills inside.
 * Deterministic: the same skills give the same map.
 */
function neighboursOf(skills: Skill[]): Map<string, Set<string>> {
  const neighbours = new Map<string, Set<string>>()
  const link = (a: string, b: string) => neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b))
  for (const skill of skills) {
    for (const target of skill.links) {
      link(skill.id, target)
      link(target, skill.id)
    }
  }

  return neighbours
}

function edgePairs(skills: Skill[]): number[] {
  const indexOf = new Map(skills.map((skill, i) => [skill.id, i]))
  const edges: number[] = []
  const seen = new Set<string>()
  for (const skill of skills) {
    for (const target of skill.links) {
      const a = indexOf.get(skill.id)
      const b = indexOf.get(target)
      if (a === undefined || b === undefined) continue
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push(a, b)
      }
    }
  }

  return edges
}

export function layoutGraph(skills: Skill[]): { regions: Region[]; graph: GraphProps } {
  const neighbours = neighboursOf(skills)

  const grouped = new Map<string, string[]>()
  for (const skill of skills) {
    grouped.set(skill.region, [...(grouped.get(skill.region) ?? []), skill.id])
  }
  const regions: Region[] = [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([label, ids], i) => ({
      label,
      color: PALETTE[i % PALETTE.length] ?? '#7aa2f7',
      ids,
      x: 0,
      y: 0,
      radius: SPACING * Math.sqrt(ids.length) + SPACING,
    }))

  const placed: Region[] = []
  for (const region of regions) {
    for (let k = 0; ; k++) {
      const angle = k * 0.35
      const distance = 2.5 * k
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      const isClear = placed.every(other => Math.hypot(other.x - x, other.y - y) >= other.radius + region.radius + REGION_GAP)
      if (isClear) {
        region.x = x
        region.y = y
        placed.push(region)
        break
      }
    }
  }

  const at = new Map<string, Point>()
  for (const region of regions) {
    const order = linkedOrder(region.ids, neighbours)
    order.forEach((id, i) => {
      const distance = SPACING * Math.sqrt(i + 0.5)
      at.set(id, { x: region.x + Math.cos(i * GOLDEN) * distance, y: region.y + Math.sin(i * GOLDEN) * distance })
    })
    relax(order, at, region, region.radius, neighbours)
  }

  const regionOf = new Map(regions.map((region, i) => [region.label, i]))
  const edges = edgePairs(skills)

  return {
    regions,
    graph: {
      nodes: skills.map(skill => {
        const point = at.get(skill.id) ?? { x: 0, y: 0 }

        return [skill.name, regionOf.get(skill.region) ?? 0, Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10]
      }),
      regions: regions.map(region => [region.label, region.color, Math.round(region.x), Math.round(region.y), Math.round(region.radius)]),
      edges,
    },
  }
}

type Vec = [number, number, number]

const fromVec = ([x, y, z]: Vec): [number, number] => [Math.asin(Math.max(-1, Math.min(1, z))), Math.atan2(y, x)]
const normalise = ([x, y, z]: Vec): Vec => {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

/** The point `distance` radians from (lat, lon) along `bearing`. */
function destination(lat: number, lon: number, bearing: number, distance: number): [number, number] {
  const toLat = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing))
  const toLon =
    lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(toLat))

  return [toLat, toLon]
}

const GLOBE_FILL = 0.5
const CAP_GAP = 0.05
const CAP_STEPS = 300

/**
 * Lays the skills out on a globe: each region a circular cap ("continent")
 * sized to its skills, the caps spread over the sphere and pushed apart until
 * they no longer overlap, each region's skills on a spiral inside its cap.
 * Angles in radians; `regions` in the order `layoutGraph` gave them.
 */
export function layoutGlobe(skills: Skill[], regions: Region[]): GraphProps {
  const neighbours = neighboursOf(skills)
  const total = Math.max(1, skills.length)
  const scale = Math.sqrt((4 * GLOBE_FILL) / total)
  const caps = regions.map((region, k) => {
    const y = 1 - (2 * (k + 0.5)) / regions.length
    const ring = Math.sqrt(1 - y * y)
    return {
      region,
      at: [ring * Math.cos(k * GOLDEN), ring * Math.sin(k * GOLDEN), y] as Vec,
      radius: Math.min(1.2, scale * Math.sqrt(region.ids.length) + 0.03),
    }
  })

  for (let step = 0; step < CAP_STEPS; step++) {
    let isSettled = true
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        const a = caps[i]
        const b = caps[j]
        if (!a || !b) continue
        const dot = a.at[0] * b.at[0] + a.at[1] * b.at[1] + a.at[2] * b.at[2]
        const apart = Math.acos(Math.max(-1, Math.min(1, dot)))
        const overlap = a.radius + b.radius + CAP_GAP - apart
        if (overlap <= 0) continue
        isSettled = false
        const away = normalise([a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]])
        const push = Math.min(0.2, overlap * 0.5)
        a.at = normalise([a.at[0] + away[0] * push, a.at[1] + away[1] * push, a.at[2] + away[2] * push])
        b.at = normalise([b.at[0] - away[0] * push, b.at[1] - away[1] * push, b.at[2] - away[2] * push])
      }
    }
    if (isSettled) break
  }

  const at = new Map<string, [number, number]>()
  for (const cap of caps) {
    const [lat, lon] = fromVec(cap.at)
    const order = linkedOrder(cap.region.ids, neighbours)
    order.forEach((id, i) => {
      const distance = cap.radius * 0.88 * Math.sqrt((i + 0.5) / order.length)
      at.set(id, destination(lat, lon, i * GOLDEN, distance))
    })
  }

  const regionOf = new Map(regions.map((region, i) => [region.label, i]))
  const round = (value: number) => Math.round(value * 10000) / 10000

  return {
    nodes: skills.map(skill => {
      const [lat, lon] = at.get(skill.id) ?? [0, 0]
      return [skill.name, regionOf.get(skill.region) ?? 0, round(lat), round(lon)]
    }),
    regions: caps.map(cap => {
      const [lat, lon] = fromVec(cap.at)
      return [cap.region.label, cap.region.color, round(lat), round(lon), round(cap.radius)]
    }),
    edges: edgePairs(skills),
  }
}
