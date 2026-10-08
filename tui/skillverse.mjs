#!/usr/bin/env node
// Skillverse for the terminal: an animated braille globe (or 2D graph, or
// tree) of the skills your Claude Code session has, with a reading panel.
//
//   node tui/skillverse.mjs                 the session's skills (from the plugin's skillverse.json)
//   node tui/skillverse.mjs --scan          scan the disk instead
//   node tui/skillverse.mjs --snapshot 140x40 [--frames 40] [--mode graph] [--select docs:write]
//                                      print one frame and exit (no keyboard)
//
// Keys: Tab globe/graph/tree · arrows/drag spin · +/- or wheel zoom ·
// Enter open what is under ⌖ · click a skill · 1-9 follow a link · [ ] step
// links · b back · / search · n next match · PgUp/PgDn read · space pause · q quit

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scanSkills } from '../cli/scan.mjs'

// ---- data ---------------------------------------------------------------

const CACHE = path.join(os.homedir(), '.cache', 'skillverse', 'skillverse.json')

function loadData(args) {
  if (!args.has('--scan')) {
    try {
      return { data: JSON.parse(fs.readFileSync(CACHE, 'utf8')), from: 'your Claude Code session' }
    } catch {
      // No snapshot from the mod yet: fall back to the disk.
    }
  }

  return { data: scanSkills(process.cwd()), from: 'a scan of this machine' }
}

// ---- colour and text -----------------------------------------------------

const hex = value => {
  const n = parseInt(String(value).replace('#', ''), 16) || 0x7aa2f7
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const shade = ([r, g, b], k) => [Math.round(r * k), Math.round(g * k), Math.round(b * k)]
const mixTo = ([r, g, b], [r2, g2, b2], t) => [Math.round(r + (r2 - r) * t), Math.round(g + (g2 - g) * t), Math.round(b + (b2 - b) * t)]
const WHITE = [235, 238, 245]
const MUTED = [125, 135, 155]
const FAINT = [62, 70, 88]
const RIM = [95, 135, 255]
const ACCENT = [122, 162, 247]

const width = text => [...text].length
const cut = (text, n) => (width(text) > n ? `${[...text].slice(0, Math.max(0, n - 1)).join('')}…` : text)
function wrap(text, n) {
  const lines = []
  for (const paragraph of String(text).split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue
      if (width(line) + width(word) + 1 > n && line) {
        lines.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    lines.push(line)
  }
  return lines
}

// ---- frame buffer -----------------------------------------------------------

const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

class Frame {
  constructor(columns, rows) {
    this.columns = columns
    this.rows = rows
    const size = columns * rows
    this.ch = new Array(size).fill(' ')
    this.fg = new Array(size).fill(null)
    this.bold = new Uint8Array(size)
    this.bits = new Uint8Array(size)
    this.dotFg = new Array(size).fill(null)
    this.dotRank = new Int8Array(size).fill(-1)
    this.locked = new Uint8Array(size)
  }
  put(x, y, ch, fg, isBold = false) {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return
    const i = y * this.columns + x
    this.ch[i] = ch
    this.fg[i] = fg
    this.bold[i] = isBold ? 1 : 0
    this.locked[i] = 1
  }
  text(x, y, text, fg, isBold = false) {
    let column = x
    for (const ch of text) this.put(column++, y, ch, fg, isBold)
    return column
  }
  isFree(x, y, n) {
    if (y < 0 || y >= this.rows || x < 0 || x + n > this.columns) return false
    for (let i = 0; i < n; i++) if (this.locked[y * this.columns + x + i]) return false
    return true
  }
  /** A braille dot at dot coordinates inside the box (left, top, columns, rows) of cells. */
  dot(box, dx, dy, fg, rank) {
    const x = Math.floor(dx)
    const y = Math.floor(dy)
    if (x < 0 || y < 0 || x >= box.columns * 2 || y >= box.rows * 4) return
    const i = (box.top + (y >> 2)) * this.columns + box.left + (x >> 1)
    this.bits[i] |= DOT_BITS[y & 3][x & 1]
    if (rank >= this.dotRank[i]) {
      this.dotFg[i] = fg
      this.dotRank[i] = rank
    }
  }
  lines() {
    const out = []
    for (let y = 0; y < this.rows; y++) {
      let line = ''
      let last = ''
      for (let x = 0; x < this.columns; x++) {
        const i = y * this.columns + x
        let ch = this.ch[i]
        let fg = this.fg[i]
        let isBold = this.bold[i]
        if (!this.locked[i] && this.bits[i]) {
          ch = String.fromCharCode(0x2800 + this.bits[i])
          fg = this.dotFg[i]
          isBold = 0
        }
        const style = fg ? `\x1b[${isBold ? '1;' : '22;'}38;2;${fg[0]};${fg[1]};${fg[2]}m` : '\x1b[22;39m'
        if (style !== last) {
          line += style
          last = style
        }
        line += ch
      }
      out.push(`${line}\x1b[0m`)
    }
    return out
  }
}

// ---- the brain --------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a))
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

function destination(lat, lon, bearing, distance) {
  const toLat = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing))
  return [
    toLat,
    lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(toLat)),
  ]
}

export function createBrain(data, from) {
  const skills = data.skills
  const regions = data.regions
  const colors = regions.map(r => hex(r.color))
  const incoming = skills.map(() => [])
  const neighbours = skills.map(() => new Set())
  for (const [i, skill] of skills.entries()) {
    for (const j of skill.links) {
      incoming[j].push(i)
      neighbours[i].add(j)
      neighbours[j].add(i)
    }
  }
  const pairs = []
  {
    const seen = new Set()
    for (const [i, skill] of skills.entries()) {
      for (const j of skill.links) {
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`
        if (!seen.has(key)) {
          seen.add(key)
          pairs.push([i, j])
        }
      }
    }
  }
  const stars = Array.from({ length: 160 }, (_, k) => ({ x: (k * 0.6180339) % 1, y: (k * 0.4142135 * 1.7) % 1, phase: k * 1.3 }))

  const s = {
    mode: 'globe',
    time: 0,
    intro: 1,
    isSpinning: true,
    globe: { lon: 0.4, lat: 0.35, zoom: 1 },
    graph: { cx: 0, cy: 0, zoom: 0 },
    target: null,
    selected: -1,
    under: -1,
    linkCursor: -1,
    history: [],
    scroll: 0,
    query: '',
    isTyping: false,
    matches: [],
    matchAt: 0,
    treeOpen: new Set(),
    treeCursor: 0,
    drag: null,
    hits: [],
    panelHits: [],
    box: null,
  }

  const regionOf = i => regions[skills[i].region]
  const colorOf = i => colors[skills[i].region] ?? ACCENT

  // ---- projection per mode --------------------------------------------------
  function globeProject(lat, lon, box) {
    const v = s.globe
    const dl = lon - v.lon
    const cosLat = Math.cos(lat)
    const x = cosLat * Math.sin(dl)
    const y = Math.cos(v.lat) * Math.sin(lat) - Math.sin(v.lat) * cosLat * Math.cos(dl)
    const z = Math.sin(v.lat) * Math.sin(lat) + Math.cos(v.lat) * cosLat * Math.cos(dl)
    const radius = v.zoom * s.intro * Math.min(box.columns * 2, box.rows * 4) * 0.46
    return [box.columns + x * radius, box.rows * 2 - y * radius, z, radius]
  }
  function graphFit(box) {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity
    for (const r of regions) {
      const radius = 8 * Math.sqrt(r.count) + 8
      left = Math.min(left, r.x - radius)
      right = Math.max(right, r.x + radius)
      top = Math.min(top, r.y - radius)
      bottom = Math.max(bottom, r.y + radius)
    }
    s.graph = {
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
      zoom: Math.min((box.columns * 2) / (right - left), (box.rows * 4) / (bottom - top)) * 0.92,
    }
  }
  function graphProject(x, y, box) {
    const v = s.graph
    return [(x - v.cx) * v.zoom + box.columns, (y - v.cy) * v.zoom + box.rows * 2, 1, 0]
  }
  function nodeAt(i, box) {
    const skill = skills[i]
    return s.mode === 'graph' ? graphProject(skill.x, skill.y, box) : globeProject(skill.lat, skill.lon, box)
  }

  // ---- drawing ---------------------------------------------------------------
  function drawGlobe(frame, box) {
    const [, , , radius] = globeProject(0, 0, box)
    const cx = box.columns
    const cy = box.rows * 2

    // Stars twinkle outside the sphere.
    for (const star of stars) {
      const dx = star.x * box.columns * 2
      const dy = star.y * box.rows * 4
      if (Math.hypot(dx - cx, dy - cy) < radius + 3) continue
      const glow = 0.25 + 0.25 * Math.sin(s.time * 2 + star.phase)
      if (glow > 0.32) frame.dot(box, dx, dy, shade(WHITE, glow), 0)
    }
    // Atmosphere: a double rim.
    const step = 1 / Math.max(radius, 1)
    for (let a = 0; a < Math.PI * 2; a += step) {
      frame.dot(box, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, RIM, 2)
      frame.dot(box, cx + Math.cos(a) * (radius + 2), cy + Math.sin(a) * (radius + 2), shade(RIM, 0.35), 1)
    }
    // Graticule, faint, front only.
    for (let lat = -60; lat <= 60; lat += 30)
      for (let lon = 0; lon < Math.PI * 2; lon += step * 3) {
        const [x, y, z] = globeProject((lat * Math.PI) / 180, lon, box)
        if (z > 0) frame.dot(box, x, y, shade(FAINT, 0.5 + z * 0.5), 1)
      }
    // Continents: region caps stippled, shaded by how much they face us.
    regions.forEach((region, r) => {
      const count = clamp(Math.round((Math.PI * (region.cap * radius) ** 2) / 12), 10, 700)
      const isLit = s.selected >= 0 && skills[s.selected].region === r
      for (let i = 0; i < count; i++) {
        const [lat, lon] = destination(region.lat, region.lon, i * GOLDEN, region.cap * Math.sqrt((i + 0.5) / count))
        const [x, y, z] = globeProject(lat, lon, box)
        if (z > 0) frame.dot(box, x, y, shade(colors[r], (isLit ? 0.55 : 0.32) + z * 0.45), 3)
      }
    })
  }

  function drawGraph(frame, box) {
    regions.forEach((region, r) => {
      const radius = (8 * Math.sqrt(region.count) + 8) * s.graph.zoom
      const [cx, cy] = graphProject(region.x, region.y, box)
      const steps = Math.max(24, Math.round(radius * 2))
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2
        frame.dot(box, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, shade(colors[r], 0.45), 1)
      }
    })
  }

  /** Links: every link faint in graph mode; the selected's flowing in both. */
  function drawLinks(frame, box) {
    const flow = s.time * 18
    for (const [a, b] of pairs) {
      const isLit = a === s.selected || b === s.selected
      const isNear = a === s.under || b === s.under
      if (s.mode === 'globe' && !isLit && !isNear) continue
      const from = isLit && b === s.selected ? b : a
      const to = from === a ? b : a
      let points
      if (s.mode === 'globe') points = arc(from, to, box)
      else {
        const [x0, y0] = nodeAt(from, box)
        const [x1, y1] = nodeAt(to, box)
        const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)))
        points = Array.from({ length: n }, (_, k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, 1])
      }
      const color = isLit ? colorOf(s.selected) : isNear ? colorOf(s.under) : FAINT
      points.forEach(([x, y, z], k) => {
        if (z <= 0) return
        if (isLit) {
          const wave = (k - flow) % 10
          const glow = wave < 0 ? wave + 10 : wave
          frame.dot(box, x, y, glow < 4 ? mixTo(color, WHITE, 0.45) : shade(color, 0.6), 6)
        } else if (isNear) frame.dot(box, x, y, shade(color, 0.7), 5)
        else if (k % 3 === 0) frame.dot(box, x, y, FAINT, 2)
      })
    }
  }

  function arc(a, b, box) {
    const va = vec(skills[a])
    const vb = vec(skills[b])
    const angle = Math.acos(clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1))
    if (angle < 1e-6) return []
    const [, , , radius] = globeProject(0, 0, box)
    const n = clamp(Math.round(angle * radius * 1.2), 6, 500)
    const points = []
    for (let k = 1; k < n; k++) {
      const t = k / n
      const wa = Math.sin((1 - t) * angle) / Math.sin(angle)
      const wb = Math.sin(t * angle) / Math.sin(angle)
      const lift = 1 + Math.sin(t * Math.PI) * Math.min(0.3, angle * 0.18)
      const x = va[0] * wa + vb[0] * wb
      const y = va[1] * wa + vb[1] * wb
      const z = va[2] * wa + vb[2] * wb
      const [px, py, pz] = globeProject(Math.asin(clamp(z, -1, 1)), Math.atan2(y, x), box)
      const sx = box.columns + (px - box.columns) * lift
      const sy = box.rows * 2 + (py - box.rows * 2) * lift
      const isOutside = Math.hypot(sx - box.columns, sy - box.rows * 2) > radius
      points.push([sx, sy, pz > 0 || isOutside ? 1 : 0])
    }
    return points
  }
  const vec = skill => [Math.cos(skill.lat) * Math.cos(skill.lon), Math.cos(skill.lat) * Math.sin(skill.lon), Math.sin(skill.lat)]

  function drawNodes(frame, box) {
    s.hits = []
    const matchSet = new Set(s.matches)
    const near = s.selected >= 0 ? neighbours[s.selected] : new Set()
    const placed = []
    skills.forEach((_skill, i) => {
      const [x, y, z] = nodeAt(i, box)
      if (z <= 0.04) return
      const column = box.left + Math.floor(x / 2)
      const row = box.top + Math.floor(y / 4)
      if (column < box.left || row < box.top || column >= box.left + box.columns || row >= box.top + box.rows) return
      const isSel = i === s.selected
      const isHot = isSel || i === s.under || matchSet.has(i) || near.has(i) || i === linkTarget()
      const depth = s.mode === 'globe' ? 0.35 + z * 0.65 : 1
      const color = isHot ? mixTo(colorOf(i), WHITE, isSel ? 0.25 : 0.1) : shade(colorOf(i), depth)
      const glyph = isSel ? (Math.sin(s.time * 6) > 0 ? '◉' : '●') : z < 0.3 ? '•' : '●'
      frame.put(column, row, glyph, color, isHot)
      s.hits.push([i, column, row, z])
      placed.push({
        i,
        column,
        row,
        z,
        rank: isSel ? 0 : i === s.under ? 1 : i === linkTarget() ? 1 : matchSet.has(i) ? 2 : near.has(i) ? 3 : 4,
      })
    })
    // A ping ring expands from the selected skill.
    if (s.selected >= 0) {
      const [x, y, z] = nodeAt(s.selected, box)
      if (z > 0) {
        const phase = (s.time * 0.9) % 1
        const ringRadius = 3 + phase * 14
        for (let a = 0; a < Math.PI * 2; a += 0.12)
          frame.dot(box, x + Math.cos(a) * ringRadius, y + Math.sin(a) * ringRadius, shade(colorOf(s.selected), 1 - phase), 7)
      }
    }
    // Labels: important first, then whatever fits once zoomed in.
    const zoomedIn = s.mode === 'globe' ? s.globe.zoom >= 1.6 : s.graph.zoom >= fitZoom * 2.2
    placed.sort((a, b) => a.rank - b.rank || b.z - a.z)
    for (const p of placed) {
      if (p.rank === 4 && !zoomedIn) continue
      const name = ` ${cut(skills[p.i].name, 28)}`
      const color = p.rank === 0 ? WHITE : p.rank < 4 ? mixTo(colorOf(p.i), WHITE, 0.35) : shade(colorOf(p.i), 0.85)
      const right = p.column + 1
      const left = p.column - width(name) - 1
      if (frame.isFree(right, p.row, width(name)) && right + width(name) <= box.left + box.columns)
        frame.text(right, p.row, name, color, p.rank < 2)
      else if (frame.isFree(left, p.row, width(name)) && left >= box.left) frame.text(left, p.row, name, color, p.rank < 2)
    }
    // Region names over their continents / circles.
    if ((s.mode === 'globe' && s.globe.zoom < 2.4) || (s.mode === 'graph' && !zoomedIn)) {
      regions.forEach((region, r) => {
        const [x, y, z] =
          s.mode === 'graph'
            ? graphProject(region.x, region.y - (8 * Math.sqrt(region.count) + 8), box)
            : globeProject(region.lat, region.lon, box)
        if (z < 0.45) return
        const name = cut(region.label, 26)
        const column = box.left + Math.round(x / 2 - width(name) / 2)
        const row = box.top + Math.floor(y / 4)
        if (
          row >= box.top &&
          row < box.top + box.rows &&
          frame.isFree(column, row, width(name)) &&
          column >= box.left &&
          column + width(name) <= box.left + box.columns
        )
          frame.text(column, row, name, mixTo(colors[r], WHITE, 0.2), true)
      })
    }
  }

  let fitZoom = 1
  function drawCanvas(frame, box) {
    s.box = box
    if (s.mode === 'graph' && s.graph.zoom === 0) {
      graphFit(box)
      fitZoom = s.graph.zoom
    }
    if (s.mode === 'globe') drawGlobe(frame, box)
    else drawGraph(frame, box)
    drawLinks(frame, box)
    drawNodes(frame, box)
    // Crosshair: what Enter opens.
    const column = box.left + Math.floor(box.columns / 2)
    const row = box.top + Math.floor(box.rows / 2)
    if (!frame.locked[row * frame.columns + column]) frame.put(column, row, '⌖', MUTED)
  }

  function drawTree(frame, box) {
    const lines = treeLines()
    s.treeCursor = clamp(s.treeCursor, 0, Math.max(0, lines.length - 1))
    const start = clamp(s.treeCursor - Math.floor(box.rows / 2), 0, Math.max(0, lines.length - box.rows))
    s.panelHits = s.panelHits.filter(hit => hit.zone !== 'tree')
    lines.slice(start, start + box.rows).forEach((line, k) => {
      const row = box.top + k
      const isCursor = start + k === s.treeCursor
      if (isCursor) frame.text(box.left, row, '›', ACCENT, true)
      if (line.region !== undefined) {
        const region = regions[line.region]
        let x = frame.text(box.left + 2, row, s.treeOpen.has(line.region) || s.query ? '▾ ' : '▸ ', MUTED)
        x = frame.text(x, row, '● ', colors[line.region])
        x = frame.text(x, row, cut(region.label, box.columns - 12), isCursor ? WHITE : mixTo(colors[line.region], WHITE, 0.3), true)
        frame.text(x, row, `  ${line.count}`, MUTED)
      } else {
        const x = frame.text(box.left + 6, row, line.skill === s.selected ? '◉ ' : '· ', colorOf(line.skill))
        frame.text(
          x,
          row,
          cut(skills[line.skill].name, box.columns - 10),
          isCursor || line.skill === s.selected ? WHITE : shade(WHITE, 0.75),
          line.skill === s.selected,
        )
      }
      s.panelHits.push({ zone: 'tree', row, index: start + k })
    })
  }

  function treeLines() {
    const q = s.query.toLowerCase()
    const lines = []
    regions
      .map((region, r) => ({ region, r }))
      .sort((a, b) => a.region.label.localeCompare(b.region.label))
      .forEach(({ r }) => {
        const members = skills
          .map((skill, i) => ({ skill, i }))
          .filter(
            ({ skill }) => skill.region === r && (!q || skill.id.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)),
          )
        if (members.length === 0) return
        lines.push({ region: r, count: members.length })
        if (s.treeOpen.has(r) || q)
          members
            .sort((a, b) => a.skill.name.localeCompare(b.skill.name))
            .forEach(({ i }) => {
              lines.push({ skill: i })
            })
      })
    return lines
  }

  function linkList() {
    if (s.selected < 0) return []
    return [...skills[s.selected].links.map(i => ({ i, way: '→' })), ...incoming[s.selected].map(i => ({ i, way: '←' }))]
  }
  function linkTarget() {
    const list = linkList()
    return s.linkCursor >= 0 && s.linkCursor < list.length ? list[s.linkCursor].i : -1
  }

  function drawPanel(frame, box) {
    s.panelHits = s.panelHits.filter(hit => hit.zone === 'tree')
    for (let y = box.top; y < box.top + box.rows; y++) frame.put(box.left - 1, y, '│', FAINT)
    let row = box.top
    const line = (text, color, isBold = false, x = box.left + 1) => {
      if (row < box.top + box.rows) frame.text(x, row, cut(text, box.columns - 2), color, isBold)
      row++
    }
    if (s.selected < 0) {
      line('SKILLVERSE', ACCENT, true)
      line(`${skills.length} skills · ${regions.length} regions · ${pairs.length} links`, MUTED)
      line(`from ${from}`, FAINT)
      row++
      const tips = [
        s.mode === 'tree' ? '↑↓ move · Enter open/expand' : '←→↑↓ or drag  spin the globe',
        s.mode === 'tree' ? '' : 'Enter  open the skill under ⌖',
        'click  open any skill',
        '/  search · n  next match',
        'Tab  globe · graph · tree',
        '+ -  zoom (or the wheel)',
        'space  pause · q  quit',
      ].filter(Boolean)
      for (const tip of tips) line(tip, shade(WHITE, 0.7))
      row++
      line('BIGGEST REGIONS', MUTED, true)
      regions
        .map((region, r) => ({ region, r }))
        .sort((a, b) => b.region.count - a.region.count)
        .slice(0, Math.max(0, box.top + box.rows - row))
        .forEach(({ region, r }) => {
          if (row >= box.top + box.rows) return
          const x = frame.text(box.left + 1, row, '● ', colors[r])
          frame.text(x, row, cut(`${region.label}  ${region.count}`, box.columns - 4), shade(WHITE, 0.8))
          row++
        })
      return
    }

    const skill = skills[s.selected]
    const color = colorOf(s.selected)
    line(`◉ ${skill.name}`, mixTo(color, WHITE, 0.3), true)
    line(`${regionOf(s.selected).label} · /${skill.id}`, MUTED)
    row++
    for (const text of wrap(skill.description || 'No description.', box.columns - 3).slice(0, 6)) line(text, shade(WHITE, 0.82))
    row++
    const list = linkList()
    if (list.length) {
      line(`LINKS  ${skill.links.length} out · ${incoming[s.selected].length} in   (1-9 follow · [ ] step)`, MUTED, true)
      list.slice(0, 9).forEach((link, k) => {
        if (row >= box.top + box.rows) return
        const isCursor = k === s.linkCursor
        let x = frame.text(box.left + 1, row, `${k + 1} ${link.way} `, isCursor ? WHITE : MUTED, isCursor)
        x = frame.text(x, row, '● ', colorOf(link.i))
        frame.text(x, row, cut(skills[link.i].id, box.columns - 9), isCursor ? WHITE : shade(WHITE, 0.8), isCursor)
        s.panelHits.push({ zone: 'link', row, index: link.i })
        row++
      })
      if (list.length > 9) line(`… ${list.length - 9} more (step with [ ])`, FAINT)
      row++
    }
    line('CONTENT   PgUp/PgDn', MUTED, true)
    const body = markdown(skill.body, box.columns - 3)
    s.scroll = clamp(s.scroll, 0, Math.max(0, body.length - 1))
    for (const [text, tone, isBold] of body.slice(s.scroll)) {
      if (row >= box.top + box.rows) break
      line(text, tone, isBold, box.left + 2)
    }
  }

  function markdown(text, n) {
    const out = []
    let isCode = false
    for (const raw of String(text || 'No SKILL.md found.').split('\n')) {
      if (raw.startsWith('```')) {
        isCode = !isCode
        continue
      }
      if (isCode) {
        out.push([cut(`  ${raw}`, n), [150, 200, 160], false])
        continue
      }
      const heading = /^(#{1,6})\s+(.*)/.exec(raw)
      if (heading) {
        out.push(['', null, false])
        out.push([heading[2].toUpperCase(), heading[1].length <= 2 ? ACCENT : mixTo(ACCENT, WHITE, 0.4), true])
        continue
      }
      const bullet = /^(\s*)[-*]\s+(.*)/.exec(raw)
      const content = bullet ? bullet[2] : raw
      const indent = bullet ? `${bullet[1]}• ` : ''
      const pieces = wrap(content.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1'), n - indent.length)
      for (const [k, piece] of pieces.entries())
        out.push([(k === 0 ? indent : ' '.repeat(indent.length)) + piece, shade(WHITE, 0.78), false])
    }
    return out.map(([t, c, b]) => [t, c ?? WHITE, b])
  }

  function drawBars(frame) {
    const tabs = [
      ['1', 'Globe', 'globe'],
      ['2', 'Graph', 'graph'],
      ['3', 'Tree', 'tree'],
    ]
    let x = frame.text(1, 0, '✦ SKILLVERSE ', ACCENT, true)
    x = frame.text(x, 0, ' Tab', FAINT)
    for (const [key, label, mode] of tabs) {
      const isOn = s.mode === mode
      x = frame.text(x + 1, 0, ` ${key} ${label} `, isOn ? WHITE : MUTED, isOn)
    }
    const crumbs = [...s.history.slice(-2).map(i => skills[i].name), s.selected >= 0 ? skills[s.selected].name : '']
      .filter(Boolean)
      .join(' › ')
    if (crumbs) frame.text(Math.max(x + 3, frame.columns - width(crumbs) - 2), 0, cut(crumbs, frame.columns - x - 5), MUTED)

    const bottom = frame.rows - 1
    if (s.isTyping || s.query) {
      const x2 = frame.text(1, bottom, '/ ', ACCENT, true)
      const x3 = frame.text(x2, bottom, s.query + (s.isTyping && Math.sin(s.time * 8) > 0 ? '▏' : ' '), WHITE)
      frame.text(
        x3 + 1,
        bottom,
        s.matches.length ? `${s.matchAt + 1}/${s.matches.length} matches · Enter go · n next · Esc clear` : 'no matches · Esc clear',
        MUTED,
      )
    } else {
      const hint =
        s.mode === 'tree'
          ? '↑↓ move · Enter open · Tab view · / search · b back · q quit'
          : `drag/arrows spin · wheel/+- zoom · Enter ⌖ · click skill · 1-9 link · b back · / search · Tab view · ${s.isSpinning ? 'space pause' : 'space spin'} · q quit`
      frame.text(1, bottom, cut(hint, frame.columns - 2), FAINT)
    }
  }

  // ---- one frame ---------------------------------------------------------------
  function render(columns, rows) {
    const frame = new Frame(columns, rows)
    const isWide = columns >= 96
    const panelColumns = isWide ? Math.max(36, Math.floor(columns * 0.38)) : 0
    const canvas = { left: 0, top: 1, columns: columns - panelColumns - (isWide ? 1 : 0), rows: rows - 2 }
    if (s.mode === 'tree') drawTree(frame, { ...canvas, left: 1, columns: canvas.columns - 2 })
    else drawCanvas(frame, canvas)
    if (isWide) drawPanel(frame, { left: columns - panelColumns, top: 1, columns: panelColumns, rows: rows - 2 })
    else if (s.selected >= 0) {
      const rowsBelow = Math.floor((rows - 2) * 0.45)
      for (let y = rows - 1 - rowsBelow; y < rows - 1; y++) for (let x = 0; x < columns; x++) frame.put(x, y, ' ', null)
      drawPanel(frame, { left: 1, top: rows - 1 - rowsBelow, columns: columns - 1, rows: rowsBelow })
    }
    drawBars(frame)
    return frame
  }

  // ---- time --------------------------------------------------------------------
  function tick(dt) {
    s.time += dt
    if (s.intro < 1) s.intro = Math.min(1, s.intro + dt * 0.9)
    const t = s.target
    if (t && s.mode === 'globe') {
      const k = 1 - 0.002 ** dt
      s.globe.lon = wrapAngle(s.globe.lon + wrapAngle(t.lon - s.globe.lon) * k)
      s.globe.lat += (t.lat - s.globe.lat) * k
      s.globe.zoom += (t.zoom - s.globe.zoom) * k
      if (Math.abs(wrapAngle(t.lon - s.globe.lon)) < 0.002 && Math.abs(t.lat - s.globe.lat) < 0.002) s.target = null
    } else if (t && s.mode === 'graph') {
      const k = 1 - 0.002 ** dt
      s.graph.cx += (t.cx - s.graph.cx) * k
      s.graph.cy += (t.cy - s.graph.cy) * k
      s.graph.zoom += (t.zoom - s.graph.zoom) * k
      if (Math.abs(t.cx - s.graph.cx) < 0.05 && Math.abs(t.cy - s.graph.cy) < 0.05) s.target = null
    } else if (s.mode === 'globe' && s.isSpinning && !s.drag && s.selected < 0) {
      s.globe.lon = wrapAngle(s.globe.lon + dt * 0.18)
    }
    if (s.box && s.mode !== 'tree') s.under = underCrosshair()
  }

  function underCrosshair() {
    const column = s.box.left + Math.floor(s.box.columns / 2)
    const row = s.box.top + Math.floor(s.box.rows / 2)
    let best = -1
    let bestScore = 3.5
    for (const [i, c, r, z] of s.hits) {
      const score = (c - column) ** 2 + ((r - row) * 2) ** 2 - z
      if (score < bestScore) {
        best = i
        bestScore = score
      }
    }
    return best
  }

  // ---- actions -------------------------------------------------------------------
  function focusOn(i) {
    const skill = skills[i]
    if (s.mode === 'graph') s.target = { cx: skill.x, cy: skill.y, zoom: Math.max(s.graph.zoom, fitZoom * 2.6) }
    else s.target = { lon: skill.lon, lat: clamp(skill.lat, -1.3, 1.3), zoom: Math.max(s.globe.zoom, 1.9) }
  }
  function select(i, isBack = false) {
    if (i === s.selected) return
    if (!isBack && s.selected >= 0) s.history.push(s.selected)
    s.selected = i
    s.linkCursor = -1
    s.scroll = 0
    if (i >= 0) {
      s.treeOpen.add(skills[i].region)
      if (s.mode !== 'tree') focusOn(i)
    }
  }
  function search(text) {
    s.query = text
    const q = text.toLowerCase()
    s.matches = q
      ? skills
          .map((skill, i) => ({ skill, i }))
          .filter(({ skill }) => skill.id.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
          .map(({ i }) => i)
      : []
    s.matchAt = 0
  }

  function key(k) {
    if (s.isTyping) {
      if (k === 'escape') {
        s.isTyping = false
        search('')
      } else if (k === 'return') {
        s.isTyping = false
        if (s.matches.length) select(s.matches[0])
      } else if (k === 'backspace') search(s.query.slice(0, -1))
      else if (k.length === 1 && k >= ' ') search(s.query + k)
      return true
    }
    if (k === 'q' || k === 'ctrl-c') return false
    if (k === '1' && s.selected < 0) s.mode = 'globe'
    else if (k === '2' && s.selected < 0) s.mode = 'graph'
    else if (k === '3' && s.selected < 0) s.mode = 'tree'
    else if (/^[1-9]$/.test(k)) {
      const link = linkList()[Number(k) - 1]
      if (link) select(link.i)
    } else if (k === 'tab') s.mode = s.mode === 'globe' ? 'graph' : s.mode === 'graph' ? 'tree' : 'globe'
    else if (k === '/') {
      s.isTyping = true
      search('')
    } else if (k === 'n' && s.matches.length) {
      s.matchAt = (s.matchAt + 1) % s.matches.length
      select(s.matches[s.matchAt])
    } else if (k === 'escape') {
      if (s.query) search('')
      else select(-1)
    } else if (k === 'b' || k === 'backspace') {
      const previous = s.history.pop()
      if (previous !== undefined) select(previous, true)
    } else if (k === ' ') s.isSpinning = !s.isSpinning
    else if (k === ']' || k === '[') {
      const list = linkList()
      if (list.length) {
        s.linkCursor = (s.linkCursor + (k === ']' ? 1 : list.length - 1) + (s.linkCursor < 0 && k === '[' ? 1 : 0)) % list.length
        focusOn(list[s.linkCursor].i)
      }
    } else if (k === 'pagedown') s.scroll += 10
    else if (k === 'pageup') s.scroll = Math.max(0, s.scroll - 10)
    else if (s.mode === 'tree') treeKey(k)
    else if (k === 'return') {
      const target = linkTarget() >= 0 ? linkTarget() : s.under
      if (target >= 0) select(target)
    } else if (k === '+' || k === '=') zoom(1.25)
    else if (k === '-' || k === '_') zoom(0.8)
    else if (k === 'f' || k === '0') {
      s.target = null
      if (s.mode === 'globe') s.globe.zoom = 1
      else s.graph.zoom = 0
    } else if (['left', 'right', 'up', 'down'].includes(k)) {
      s.target = null
      if (s.mode === 'globe') {
        const turn = 0.12 / s.globe.zoom
        if (k === 'left') s.globe.lon = wrapAngle(s.globe.lon - turn)
        if (k === 'right') s.globe.lon = wrapAngle(s.globe.lon + turn)
        if (k === 'up') s.globe.lat = clamp(s.globe.lat + turn, -1.4, 1.4)
        if (k === 'down') s.globe.lat = clamp(s.globe.lat - turn, -1.4, 1.4)
      } else {
        const stepBy = 10 / s.graph.zoom
        if (k === 'left') s.graph.cx -= stepBy
        if (k === 'right') s.graph.cx += stepBy
        if (k === 'up') s.graph.cy -= stepBy
        if (k === 'down') s.graph.cy += stepBy
      }
    }
    return true
  }
  function zoom(factor) {
    s.target = null
    if (s.mode === 'globe') s.globe.zoom = clamp(s.globe.zoom * factor, 0.5, 8)
    else if (s.mode === 'graph') s.graph.zoom = clamp(s.graph.zoom * factor, fitZoom * 0.5, fitZoom * 12)
  }
  function treeKey(k) {
    const lines = treeLines()
    if (k === 'down') s.treeCursor = Math.min(lines.length - 1, s.treeCursor + 1)
    else if (k === 'up') s.treeCursor = Math.max(0, s.treeCursor - 1)
    else if (k === 'return' || k === 'right' || k === 'left') {
      const line = lines[s.treeCursor]
      if (!line) return
      if (line.region !== undefined) {
        if (s.treeOpen.has(line.region) && k !== 'right') s.treeOpen.delete(line.region)
        else s.treeOpen.add(line.region)
      } else if (k === 'return') select(line.skill)
    }
  }

  function mouse({ button, x, y, isPress, isDrag }) {
    if (button === 64 || button === 65) return zoom(button === 64 ? 1.15 : 0.87)
    const hit = s.panelHits.find(h => h.row === y)
    if (isPress && !isDrag && hit) {
      if (hit.zone === 'link') return select(hit.index)
      if (hit.zone === 'tree') {
        s.treeCursor = hit.index
        return treeKey('return')
      }
    }
    if (!s.box || s.mode === 'tree') return
    if (isPress && !isDrag) s.drag = { x, y, lon: s.globe.lon, lat: s.globe.lat, cx: s.graph.cx, cy: s.graph.cy, isMoved: false }
    else if (isDrag && s.drag) {
      const dx = x - s.drag.x
      const dy = y - s.drag.y
      s.drag.isMoved = s.drag.isMoved || dx !== 0 || dy !== 0
      s.target = null
      if (s.mode === 'globe') {
        const [, , , radius] = globeProject(0, 0, s.box)
        s.globe.lon = wrapAngle(s.drag.lon - (dx * 2) / radius)
        s.globe.lat = clamp(s.drag.lat + (dy * 4) / radius, -1.4, 1.4)
      } else {
        s.graph.cx = s.drag.cx - (dx * 2) / s.graph.zoom
        s.graph.cy = s.drag.cy - (dy * 4) / s.graph.zoom
      }
    } else if (!isPress && s.drag) {
      if (!s.drag.isMoved) {
        let best = -1
        let bestScore = 6
        for (const [i, c, r, z] of s.hits) {
          const score = (c - x) ** 2 + ((r - y) * 2) ** 2 - z
          if (score < bestScore) {
            best = i
            bestScore = score
          }
        }
        if (best >= 0) select(best)
      }
      s.drag = null
    }
  }

  function open(id, mode) {
    if (mode) s.mode = mode
    const i = skills.findIndex(skill => skill.id === id)
    if (i >= 0) {
      select(i)
      const t = s.target
      if (t && s.mode === 'globe') Object.assign(s.globe, t)
      if (t && s.mode === 'graph') Object.assign(s.graph, t)
      s.target = null
    }
  }

  return { state: s, render, tick, key, mouse, open, setIntro: v => (s.intro = v) }
}

// ---- terminal loop -------------------------------------------------------------

function parseKeys(chunk) {
  const out = []
  let i = 0
  while (i < chunk.length) {
    const rest = chunk.slice(i)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR mouse reports start with ESC
    const sgr = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest)
    if (sgr) {
      const code = Number(sgr[1])
      out.push({
        mouse: {
          button: code & 0b11000011,
          x: Number(sgr[2]) - 1,
          y: Number(sgr[3]) - 1,
          isPress: sgr[4] === 'M',
          isDrag: (code & 32) !== 0,
        },
      })
      i += sgr[0].length
      continue
    }
    const named = [
      ['\x1b[A', 'up'],
      ['\x1b[B', 'down'],
      ['\x1b[C', 'right'],
      ['\x1b[D', 'left'],
      ['\x1b[5~', 'pageup'],
      ['\x1b[6~', 'pagedown'],
      ['\x1bOA', 'up'],
      ['\x1bOB', 'down'],
      ['\x1bOC', 'right'],
      ['\x1bOD', 'left'],
    ].find(([seq]) => rest.startsWith(seq))
    if (named) {
      out.push({ key: named[1] })
      i += named[0].length
      continue
    }
    const ch = chunk[i]
    out.push({
      key:
        ch === '\r' || ch === '\n'
          ? 'return'
          : ch === '\x7f' || ch === '\b'
            ? 'backspace'
            : ch === '\x1b'
              ? 'escape'
              : ch === '\x03'
                ? 'ctrl-c'
                : ch === '\t'
                  ? 'tab'
                  : ch,
    })
    i++
  }
  return out
}

function main() {
  const args = new Set(process.argv.slice(2))
  const value = name => {
    const at = process.argv.indexOf(name)
    return at >= 0 ? process.argv[at + 1] : undefined
  }
  const { data, from } = loadData(args)
  if (!data.skills?.length) {
    console.error('No skills found. Open the Skillverse pane once in Claude Code (it saves skillverse.json), or run with --scan.')
    process.exit(1)
  }
  const brain = createBrain(data, from)

  const snapshot = value('--snapshot')
  if (snapshot) {
    const [columns, rows] = snapshot.split('x').map(Number)
    if (value('--mode')) brain.state.mode = value('--mode')
    if (value('--select')) brain.open(value('--select'), value('--mode'))
    const frames = Number(value('--frames') ?? 30)
    for (let k = 0; k < frames; k++) {
      brain.render(columns, rows)
      brain.tick(1 / 30)
    }
    const lines = brain.render(columns, rows).lines()
    // biome-ignore lint/suspicious/noControlCharactersInRegex: --plain strips the ANSI colour codes, which start with ESC
    const plain = l => l.replace(/\x1b\[[0-9;]*m/g, '')
    process.stdout.write(`${(args.has('--plain') ? lines.map(plain) : lines).join('\n')}\n`)
    return
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('Run this in a terminal (or use --snapshot 140x40).')
    process.exit(1)
  }
  brain.setIntro(0.05)
  const out = process.stdout
  out.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[2J')
  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  let previous = []
  let isRunning = true
  const stop = () => {
    if (!isRunning) return
    isRunning = false
    out.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?25h\x1b[0m\x1b[?1049l')
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  out.on('resize', () => {
    previous = []
    out.write('\x1b[2J')
  })
  process.stdin.on('data', chunk => {
    for (const event of parseKeys(chunk)) {
      if (event.mouse) brain.mouse(event.mouse)
      else if (!brain.key(event.key)) stop()
    }
  })
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    brain.tick(Math.min(0.1, (now - last) / 1000))
    last = now
    const lines = brain.render(out.columns, out.rows).lines()
    let text = ''
    lines.forEach((line, y) => {
      if (line !== previous[y]) text += `\x1b[${y + 1};1H${line}`
    })
    previous = lines
    if (text) out.write(text)
  }, 33)
}

main()
