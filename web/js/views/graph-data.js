// What the 3D and 2D graphs share: nodes placed near their region (and their
// agent's cluster), the links, and how strongly each link pulls.

import { agents, pairs, regions, skills, twinPairs } from '../model.js'

/** How far apart the agents' clusters sit in 3D. */
const AGENT_SPACING = 900
const SPHERE = 320

/** Scale from the layout's units to the 2D graph's. */
const SCALE_2D = 5
/** Space between two agents' boxes in the 2D grid, in layout units. */
const GAP_2D = 120

/**
 * Where each agent's part of the 2D graph moves to: the agents in a near-square
 * grid (the data puts them in one row), each box by its top-left corner.
 */
const shift2d = (() => {
  const boxes = agents.map(() => ({
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  }))
  for (const item of [...skills, ...regions]) {
    const box = boxes[item.agent]
    box.left = Math.min(box.left, item.x)
    box.right = Math.max(box.right, item.x)
    box.top = Math.min(box.top, item.y)
    box.bottom = Math.max(box.bottom, item.y)
  }
  const cols = Math.ceil(Math.sqrt(agents.length))
  const width = Math.max(...boxes.map(box => box.right - box.left)) + GAP_2D
  const height = Math.max(...boxes.map(box => box.bottom - box.top)) + GAP_2D
  return boxes.map((box, a) => ({ x: (a % cols) * width - box.left, y: Math.floor(a / cols) * height - box.top }))
})()

const at2d = item => ({ x: (item.x + shift2d[item.agent].x) * SCALE_2D, y: (item.y + shift2d[item.agent].y) * SCALE_2D })

/** Each agent's cluster centre in 3D: a near-square grid around the origin. */
const centre3d = agents.map((_, a) => {
  const cols = Math.ceil(Math.sqrt(agents.length))
  const rows = Math.ceil(agents.length / cols)
  return { x: ((a % cols) - (cols - 1) / 2) * AGENT_SPACING, y: ((rows - 1) / 2 - Math.floor(a / cols)) * AGENT_SPACING }
})

for (const region of regions) {
  const shift = centre3d[region.agent]
  region.centre3 = {
    x: shift.x + SPHERE * Math.cos(region.lat) * Math.cos(region.lon),
    y: shift.y + SPHERE * Math.sin(region.lat),
    z: SPHERE * Math.cos(region.lat) * Math.sin(region.lon),
  }
  region.centre2 = at2d(region)
}

/** Nodes and links for a force graph; links between twins (one skill, two agents) are marked and never pull. */
export function graphData(dimensions) {
  const nodes = skills.map((skill, i) => {
    const region = regions[skill.region]
    if (dimensions === 3) {
      const c = region.centre3
      return { i, x: c.x + (Math.random() - 0.5) * 30, y: c.y + (Math.random() - 0.5) * 30, z: c.z + (Math.random() - 0.5) * 30 }
    }
    return { i, ...at2d(skill) }
  })
  const links = [
    ...pairs.map(([a, b]) => ({ source: a, target: b, pair: [a, b] })),
    ...twinPairs.map(([a, b]) => ({ source: a, target: b, pair: [a, b], isTwin: true })),
  ]
  return { nodes, links }
}

/** d3's own link strength (1 / the smaller degree) for links, none for twins. */
export function linkStrength(links, scale = 1) {
  const degree = new Map()
  for (const link of links) {
    if (link.isTwin) continue
    for (const end of link.pair) degree.set(end, (degree.get(end) ?? 0) + 1)
  }
  return link => (link.isTwin ? 0 : scale / Math.min(degree.get(link.pair[0]) ?? 1, degree.get(link.pair[1]) ?? 1))
}
