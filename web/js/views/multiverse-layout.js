// Where the Multiverse view puts things, with no three.js: how many skills
// each pair of agents shares, where each agent's universe sits (closer when
// they share more), and where each skill's star sits in its galaxy. The same
// input always gives the same layout, so the view does not jump between loads.

/** The order of a galaxy's spiral arms, one per category it has. */
export const ARM_ORDER = ['plugins', 'user', 'builtin', 'mcp', 'org', 'project']

/** A seeded random number generator (mulberry32): the same sequence for the same seed. */
export function random(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Roughly normal, between about -1 and 1. */
const gauss = rand => (rand() + rand() + rand() - 1.5) / 1.5

/** A universe's radius: by the square root of its skills, so the biggest does not swamp the rest; an empty one is small. */
export const radiusOf = count => (count > 0 ? 7 + Math.sqrt(count) * 1.5 : 3.4)

/**
 * Skills shared by each pair of agents, from twin pairs ([i, j] skill indexes):
 * a map from "a-b" (a < b) to the twin pairs between them.
 */
export function sharedBetween(agentOfSkill, twinPairs) {
  const between = new Map()
  for (const [i, j] of twinPairs) {
    const [a, b] = [agentOfSkill(i), agentOfSkill(j)].sort((x, y) => x - y)
    if (a === b) continue
    const key = `${a}-${b}`
    if (!between.has(key)) between.set(key, [])
    between.get(key).push([i, j])
  }
  return between
}

/** How many skills agents a and b share. */
export const sharedCount = (between, a, b) => between.get(`${Math.min(a, b)}-${Math.max(a, b)}`)?.length ?? 0

const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)

/**
 * Each universe's centre and radius. Agents that share skills are pulled to a
 * distance that shrinks as they share more; agents that share nothing only
 * keep well apart. `counts` are the agents' skill counts; `between` is
 * sharedBetween's map; `skip` agents get no universe (null).
 */
export function placeUniverses(counts, between, { skip = new Set(), seed = 7, steps = 900 } = {}) {
  const rand = random(seed)
  const shown = counts.map((_, a) => a).filter(a => !skip.has(a))
  const r = counts.map(radiusOf)
  const p = counts.map(() => ({ x: gauss(rand) * 60, y: gauss(rand) * 20, z: gauss(rand) * 60 }))
  for (let step = 0; step < steps; step++) {
    for (const [k, a] of shown.entries()) {
      for (const b of shown.slice(k + 1)) {
        const s = sharedCount(between, a, b)
        const target = r[a] + r[b] + (s ? 8 + 34 / (1 + s * 0.45) : 52)
        const d = distance(p[a], p[b]) || 0.01
        if (!s && d > target) continue
        const pull = ((d - target) / d) * 0.04
        for (const axis of ['x', 'y', 'z']) {
          const move = (p[b][axis] - p[a][axis]) * pull
          p[a][axis] += move
          p[b][axis] -= move
        }
      }
    }
    // A slight pull to the middle keeps loners from drifting off, and a flatter one keeps the system wide rather than tall.
    for (const a of shown) {
      p[a].x *= 0.998
      p[a].z *= 0.998
      p[a].y *= 0.99
    }
  }
  // Last, push apart any two that still touch.
  for (let pass = 0; pass < 50; pass++) {
    let moved = false
    for (const [k, a] of shown.entries()) {
      for (const b of shown.slice(k + 1)) {
        const d = distance(p[a], p[b]) || 0.01
        const gap = r[a] + r[b] + 4
        if (d >= gap) continue
        moved = true
        const push = (gap - d) / d / 2
        for (const axis of ['x', 'y', 'z']) {
          const move = (p[b][axis] - p[a][axis]) * push
          p[a][axis] -= move
          p[b][axis] += move
        }
      }
    }
    if (!moved) break
  }
  const centre = { x: 0, y: 0, z: 0 }
  for (const a of shown) for (const axis of ['x', 'y', 'z']) centre[axis] += p[a][axis] / Math.max(1, shown.length)
  return counts.map((_, a) => (skip.has(a) ? null : { x: p[a].x - centre.x, y: p[a].y - centre.y, z: p[a].z - centre.z, r: r[a] }))
}

/**
 * Where the Shared cluster floats: above the middle of the universes that
 * read it (all of them when none does), clear of every universe.
 */
export function placeHub(universes, readers) {
  const list = (readers.length ? readers : universes.map((_, a) => a)).map(a => universes[a]).filter(Boolean)
  const all = universes.filter(Boolean)
  const reach = Math.max(10, ...all.map(u => Math.hypot(u.x, u.y, u.z) + u.r))
  const hub = { x: 0, y: reach * 0.42, z: 0, r: 6 }
  for (const u of list) {
    hub.x += u.x / list.length
    hub.z += u.z / list.length
  }
  const isClear = () => all.every(u => distance(u, hub) > u.r + hub.r + 4)
  for (let k = 0; k < 100 && !isClear(); k++) hub.y += 4
  return hub
}

/**
 * Each skill's star in its galaxy, relative to the universe's centre: one
 * spiral arm per category, the most linked skills nearest the core. `skills`
 * are { category, links } for one agent; returns [x, y, z] per skill, all
 * inside radius `r`.
 */
export function galaxyStars(skills, r, seed = 1) {
  const rand = random(seed)
  const present = ARM_ORDER.filter(id => skills.some(skill => skill.category === id))
  const arm = Object.fromEntries(present.map((id, k) => [id, (k / Math.max(1, present.length)) * Math.PI * 2]))
  const order = skills.map((_, k) => k).sort((x, y) => skills[y].links - skills[x].links)
  const rank = new Array(skills.length)
  for (const [place, k] of order.entries()) rank[k] = skills.length > 1 ? place / (skills.length - 1) : 0
  return skills.map((skill, k) => {
    const out = r * (0.12 + 0.58 * Math.sqrt(0.6 * rank[k] + 0.4 * rand()))
    const angle = (arm[skill.category] ?? 0) + (out / r) * 4.2 + gauss(rand) * 0.32
    return [Math.cos(angle) * out, gauss(rand) * r * 0.05 * (1.1 - out / r), Math.sin(angle) * out]
  })
}

/** The faint dust along a galaxy's arms: `n` points, coloured by the category of the skill they trail. */
export function galaxyDust(skills, r, n, seed = 2) {
  const rand = random(seed)
  const present = ARM_ORDER.filter(id => skills.some(skill => skill.category === id))
  const arm = Object.fromEntries(present.map((id, k) => [id, (k / Math.max(1, present.length)) * Math.PI * 2]))
  return Array.from({ length: n }, (_, k) => {
    const category = skills[k % skills.length].category
    const out = r * (0.05 + 0.6 * Math.sqrt(rand()))
    const angle = arm[category] + (out / r) * 4.2 + gauss(rand) * 0.55
    return { category, at: [Math.cos(angle) * out, gauss(rand) * r * 0.05 * (1.1 - out / r), Math.sin(angle) * out] }
  })
}
