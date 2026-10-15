import { describe, expect, it } from 'vitest'
import {
  galaxyDust,
  galaxyStars,
  placeHub,
  placeUniverses,
  radiusOf,
  sharedBetween,
  sharedCount,
  // @ts-expect-error: a plain ES module without types (web/ is JavaScript)
} from '../../web/js/views/multiverse-layout.js'

type Universe = { x: number; y: number; z: number; r: number } | null
const gap = (p: Universe, q: Universe) => {
  if (!p || !q) throw new Error('missing universe')
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) - p.r - q.r
}

// Agents 0 and 1 share three skills, 1 and 2 share one; 3 shares nothing; 4 is empty.
const agentOfSkill = (i: number) => Math.floor(i / 100)
const twins = [
  [0, 100],
  [1, 101],
  [2, 102],
  [103, 200],
]
const counts = [60, 30, 12, 8, 0]
const between = sharedBetween(agentOfSkill, twins)

describe('sharedBetween', () => {
  it('counts the skills each pair of agents shares, either way round', () => {
    expect(sharedCount(between, 0, 1)).toBe(3)
    expect(sharedCount(between, 1, 0)).toBe(3)
    expect(sharedCount(between, 1, 2)).toBe(1)
    expect(sharedCount(between, 0, 3)).toBe(0)
  })
})

describe('placeUniverses', () => {
  const placed = placeUniverses(counts, between)

  it('gives the same layout for the same input', () => {
    expect(placeUniverses(counts, between)).toEqual(placed)
  })

  it('never lets two universes overlap', () => {
    for (let a = 0; a < counts.length; a++) for (let b = a + 1; b < counts.length; b++) expect(gap(placed[a], placed[b])).toBeGreaterThan(0)
  })

  it('puts agents that share skills closer than agents that share none', () => {
    expect(gap(placed[0], placed[1])).toBeLessThan(gap(placed[0], placed[3]))
    expect(gap(placed[0], placed[1])).toBeLessThan(gap(placed[1], placed[2]))
  })

  it('still gives an empty agent a small universe', () => {
    expect(placed[4]?.r).toBe(radiusOf(0))
    expect(radiusOf(0)).toBeLessThan(radiusOf(1))
  })

  it('leaves out a skipped agent', () => {
    const skipped = placeUniverses(counts, between, { skip: new Set([3]) })
    expect(skipped[3]).toBeNull()
    expect(skipped.filter(Boolean)).toHaveLength(4)
  })
})

describe('placeHub', () => {
  it('floats clear of every universe', () => {
    const placed = placeUniverses(counts, between)
    const hub = placeHub(placed, [0, 1])
    for (const u of placed) expect(gap(u, hub)).toBeGreaterThan(0)
  })
})

describe('galaxyStars', () => {
  const skills = [
    ...Array.from({ length: 30 }, (_, k) => ({ category: 'plugins', links: k % 7 })),
    ...Array.from({ length: 12 }, () => ({ category: 'user', links: 0 })),
    { category: 'mcp', links: 20 },
  ]

  it('keeps every star inside its universe', () => {
    for (const [x, y, z] of galaxyStars(skills, 20)) expect(Math.hypot(x, y, z)).toBeLessThan(20)
    for (const { at } of galaxyDust(skills, 20, 300)) expect(Math.hypot(...at)).toBeLessThan(20)
  })

  it('puts the most linked skill nearest the core', () => {
    const stars = galaxyStars(skills, 20)
    const out = stars.map(([x = 0, , z = 0]: number[]) => Math.hypot(x, z))
    const linked = out[skills.length - 1]
    expect(linked).toBeLessThan(out.reduce((sum: number, d: number) => sum + d, 0) / out.length)
  })

  it('gives the same stars for the same input', () => {
    expect(galaxyStars(skills, 20)).toEqual(galaxyStars(skills, 20))
  })
})
