// The 3D view: a force graph with one cluster per agent, each skill pulled
// toward its region, and live activity drawn as halos, comets and trails.

import { alpha, CDN, clusterForce, escapeHtml, loadScript, mixHex } from '../lib.js'
import { COMET_MS, glowOf, heatOf, live, TRAIL_MS } from '../live.js'
import { agents, colorOf, neighbours, regions, skills } from '../model.js'
import { actions, isLitLink, isRelated, state } from '../state.js'
import { graphData, linkStrength } from './graph-data.js'

const BACKGROUND = '#04060c'
const TWIN = '#c4a7ff'
const SETTLE_MS = 1500

const tooltip = i =>
  `<div class="tip"><b>${escapeHtml(skills[i].id)}</b><br><span>${escapeHtml(regions[skills[i].region]?.label || '')}</span></div>`

export const graph3dView = {
  async init(el) {
    this.isDestroyed = false
    await loadScript(CDN['3d'])
    const data = graphData(3)
    const graph = window
      .ForceGraph3D()(el)
      .backgroundColor(BACKGROUND)
      .showNavInfo(false)
      .graphData(data)
      .nodeId('i')
      .nodeRelSize(3)
      .nodeVal(n => 1 + neighbours[n.i].size * 0.5 + glowOf(n.i) * 5)
      .nodeColor(n =>
        glowOf(n.i) > 0
          ? mixHex(colorOf(n.i), '#ffffff', 0.6 * glowOf(n.i))
          : isRelated(n.i) || state.matches.has(n.i) || heatOf(n.i) > 0
            ? colorOf(n.i)
            : alpha(colorOf(n.i), 0.35),
      )
      .nodeOpacity(0.95)
      .nodeResolution(14)
      .nodeLabel(n => tooltip(n.i))
      .linkColor(l =>
        l.isTwin
          ? isLitLink(l.pair)
            ? TWIN
            : 'rgba(196,167,255,0.14)'
          : isLitLink(l.pair)
            ? colorOf(l.pair[0])
            : 'rgba(140,155,190,0.22)',
      )
      .linkWidth(l => (isLitLink(l.pair) ? 1.4 : 0))
      .linkOpacity(0.5)
      .linkDirectionalParticles(l => (isLitLink(l.pair) && !l.isTwin ? 4 : 0))
      .linkDirectionalParticleWidth(2)
      .linkDirectionalParticleSpeed(0.006)
      .onNodeClick(n => actions.select(n.i, true))
      .onNodeHover(n => {
        state.hover = n ? n.i : -1
        el.style.cursor = n ? 'pointer' : 'grab'
        actions.refresh()
      })
      .cooldownTicks(160)
      .onEngineStop(() => this.settle(true))
    // Also settle after a moment: a busy or background tab can take long to stop the layout.
    this.startedAt = Date.now()
    setTimeout(() => this.settle(false), SETTLE_MS)
    graph.d3Force('charge').strength(-45)
    graph.d3Force('link').strength(linkStrength(data.links))
    graph.d3Force(
      'cluster',
      clusterForce(n => regions[skills[n.i].region].centre3, 0.08),
    )
    this.graph = graph
    this.nodes = data.nodes
    this.el = el
    this.resize = () => graph.width(el.clientWidth).height(el.clientHeight)
    this.labels = document.createElement('div')
    this.labels.className = 'overlay'
    el.appendChild(this.labels)
    this.fx = { halos: new Map(), trails: new Map(), labels: new Map() }
    this.agentTags =
      agents.length > 1
        ? agents.map(agent => {
            const tag = document.createElement('div')
            tag.className = 'agent-tag'
            tag.textContent = agent.label
            this.labels.appendChild(tag)
            return tag
          })
        : []
    const step = () => {
      if (this.isDestroyed) return
      if (this.isActive && !document.hidden) this.drawLive()
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  },
  /** Frees the graph, its WebGL context and its loop; init builds it again. */
  destroy() {
    this.isDestroyed = true
    this.graph._destructor()
    this.el.replaceChildren()
    Object.assign(this, { graph: undefined, nodes: undefined, parts: undefined, fx: undefined, isSettled: false, isFinal: false })
  },
  /** Constructors and materials borrowed from the graph's own objects (three.js is not a global). */
  kit() {
    if (this.parts) return this.parts
    const mesh = this.nodes.find(n => n.__threeObj)?.__threeObj
    const line = this.graph.graphData().links.find(l => l.__lineObj && l.__lineObj.type === 'Line')?.__lineObj
    if (!mesh || !line) return null
    this.parts = {
      sphere: () => new mesh.geometry.constructor(1, 18, 14),
      mesh: (geometry, material) => new mesh.constructor(geometry, material),
      glowMaterial: color => {
        const m = mesh.material.clone()
        m.color.set(color)
        if (m.emissive) m.emissive.set(color)
        m.transparent = true
        m.depthWrite = false
        return m
      },
      line: points => {
        const geometry = new line.geometry.constructor()
        geometry.setFromPoints(points)
        const material = line.material.clone()
        material.transparent = true
        material.depthWrite = false
        return new line.constructor(geometry, material)
      },
    }
    return this.parts
  },
  /** The arc a path takes: bowed out from the graph's centre, as the globe's arcs rise off its surface. */
  curve(a, b, steps) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
    const span = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    const out = Math.hypot(mid.x, mid.y, mid.z) || 1
    const lift = 1 + Math.min(0.6, span / 400)
    const c = { x: (mid.x / out) * out * lift, y: (mid.y / out) * out * lift, z: (mid.z / out) * out * lift }
    return Array.from({ length: steps + 1 }, (_, k) => {
      const t = k / steps
      const u = 1 - t
      return {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
      }
    })
  },
  /** Glows, shockwaves, comets with trails and floating names, redrawn every frame from the live state. */
  drawLive() {
    this.drawAgentTags()
    const kit = this.kit()
    if (!kit) return
    const scene = this.graph.scene()
    const now = Date.now()
    const radiusOf = i => Math.cbrt(1 + neighbours[i].size * 0.5 + glowOf(i) * 5) * 3

    // Halos and shockwaves on skills that fired.
    for (const [i] of live.glow) {
      const g = glowOf(i)
      const node = this.nodes[i]
      let fx = this.fx.halos.get(i)
      if (g <= 0 || node.x === undefined) {
        if (fx) {
          scene.remove(fx.halo, fx.wave)
          this.fx.halos.delete(i)
        }
        continue
      }
      if (!fx) {
        fx = { halo: kit.mesh(kit.sphere(), kit.glowMaterial(colorOf(i))), wave: kit.mesh(kit.sphere(), kit.glowMaterial(colorOf(i))) }
        scene.add(fx.halo, fx.wave)
        this.fx.halos.set(i, fx)
      }
      const r = radiusOf(i)
      const pulse = 1 + 0.25 * Math.sin(now / 160)
      fx.halo.position.set(node.x, node.y, node.z)
      fx.halo.scale.setScalar(r * (1.25 + 0.6 * g) * pulse)
      fx.halo.material.opacity = 0.3 * g
      const phase = (now % 900) / 900
      fx.wave.position.set(node.x, node.y, node.z)
      fx.wave.scale.setScalar(r * (1.2 + phase * 2.6))
      fx.wave.material.opacity = 0.22 * g * (1 - phase) ** 2
    }

    for (const [i, fx] of this.fx.halos) {
      if (glowOf(i) <= 0) {
        scene.remove(fx.halo, fx.wave)
        this.fx.halos.delete(i)
      }
    }

    // Paths: a comet along the arc while fresh, then a fading trail.
    const seen = new Set()
    for (const p of live.paths) {
      const key = `${p.from}>${p.to}@${p.at}`
      seen.add(key)
      const a = this.nodes[p.from]
      const b = this.nodes[p.to]
      if (a.x === undefined || b.x === undefined) continue
      const age = now - p.at
      const color = p.isBranch ? '#c4a7ff' : colorOf(p.from)
      let fx = this.fx.trails.get(key)
      if (!fx) {
        const points = this.curve(a, b, 48)
        const trail = kit.line(points)
        trail.material.color.set(color)
        const comet = kit.mesh(kit.sphere(), kit.glowMaterial('#ffffff'))
        const glow = kit.mesh(kit.sphere(), kit.glowMaterial(color))
        scene.add(trail, comet, glow)
        fx = { trail, comet, glow, points }
        this.fx.trails.set(key, fx)
      }
      fx.trail.material.opacity = age < COMET_MS ? 0.75 : Math.max(0.12, 0.45 * (1 - age / TRAIL_MS))
      const isFlying = age < COMET_MS
      fx.comet.visible = fx.glow.visible = isFlying
      if (isFlying) {
        const t = (age % 1500) / 1500
        const at = fx.points[Math.min(fx.points.length - 1, Math.round(t * (fx.points.length - 1)))]
        fx.comet.position.set(at.x, at.y, at.z)
        fx.comet.scale.setScalar(2.2)
        fx.comet.material.opacity = 1
        fx.glow.position.set(at.x, at.y, at.z)
        fx.glow.scale.setScalar(4.5)
        fx.glow.material.opacity = 0.3
      }
    }
    for (const [key, fx] of this.fx.trails) {
      if (!seen.has(key)) {
        scene.remove(fx.trail, fx.comet, fx.glow)
        this.fx.trails.delete(key)
      }
    }

    // Names float over the skills that fired, as on the globe.
    const shown = new Set()
    for (const [i] of live.glow) {
      const g = glowOf(i)
      const node = this.nodes[i]
      if (g <= 0.12 || node.x === undefined) continue
      shown.add(i)
      let tag = this.fx.labels.get(i)
      if (!tag) {
        tag = document.createElement('div')
        tag.className = 'fire-tag'
        tag.textContent = skills[i].name
        this.labels.appendChild(tag)
        this.fx.labels.set(i, tag)
      }
      const at = this.graph.graph2ScreenCoords(node.x, node.y + radiusOf(i) * 2.2, node.z)
      tag.style.left = `${at.x}px`
      tag.style.top = `${at.y}px`
      tag.style.opacity = String(Math.min(1, g * 1.4))
    }
    for (const [i, tag] of this.fx.labels) {
      if (!shown.has(i)) {
        tag.remove()
        this.fx.labels.delete(i)
      }
    }
  },
  /**
   * Frames the selection or what is shown: soon after opening, and again when
   * the layout stops moving, unless the person moved the camera since it opened.
   */
  settle(isFinal) {
    if (this.isFinal) return
    this.isSettled = true
    this.isFinal = isFinal
    if (Math.max(live.lastFly, live.lastUserMove) > this.startedAt) return
    if (state.selected >= 0) this.focus(state.selected)
    else this.showAgent(state.agent)
  },
  /** Each agent's name over its cluster. */
  drawAgentTags() {
    if (!this.agentTags.length) return
    const sums = agents.map(() => ({ x: 0, z: 0, top: Number.NEGATIVE_INFINITY, n: 0 }))
    for (const node of this.nodes) {
      if (node.x === undefined) continue
      const s = sums[skills[node.i].agent]
      s.x += node.x
      s.z += node.z
      s.top = Math.max(s.top, node.y)
      s.n++
    }
    for (const [a, tag] of this.agentTags.entries()) {
      const s = sums[a]
      if (!s.n) continue
      const at = this.graph.graph2ScreenCoords(s.x / s.n, s.top + 40, s.z / s.n)
      tag.style.left = `${at.x}px`
      tag.style.top = `${at.y}px`
    }
  },
  refresh() {
    const g = this.graph
    g.nodeColor(g.nodeColor())
      .nodeVal(g.nodeVal())
      .linkColor(g.linkColor())
      .linkWidth(g.linkWidth())
      .linkDirectionalParticles(g.linkDirectionalParticles())
  },
  fly(i) {
    this.focus(i)
  },
  /** A burst of particles along the link from `from` to `to`, when the two are linked. */
  comet(from, to) {
    const link = this.graph
      .graphData()
      .links.find(l => (l.pair[0] === from && l.pair[1] === to) || (l.pair[0] === to && l.pair[1] === from))
    if (link) for (let k = 0; k < 6; k++) setTimeout(() => this.graph.emitParticle(link), k * 90)
  },
  focus(i) {
    if (!this.isSettled) return
    const n = this.nodes[i]
    const distance = 180
    const ratio = 1 + distance / Math.hypot(n.x || 1, n.y || 1, n.z || 1)
    this.graph.cameraPosition({ x: n.x * ratio, y: n.y * ratio, z: n.z * ratio }, n, 1200)
  },
  focusRegion(r) {
    this.graph.zoomToFit(1000, 60, n => skills[n.i].region === r)
  },
  fit() {
    this.showAgent(state.agent)
  },
  showAgent(agent) {
    if (this.isSettled) this.graph.zoomToFit(900, 60, n => agent === 'all' || skills[n.i].agent === agent)
  },
  pause() {
    this.isActive = false
    this.graph.pauseAnimation()
  },
  resume() {
    this.isActive = true
    this.graph.resumeAnimation()
  },
}
