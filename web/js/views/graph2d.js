// The 2D view: an Obsidian-like force graph, the agents side by side, each
// skill pulled toward its region; live activity drawn over it.

import { alpha, CDN, clusterForce, loadScript } from '../lib.js'
import { COMET_MS, glowOf, live, TRAIL_MS } from '../live.js'
import { agents, colorOf, neighbours, regions, skills } from '../model.js'
import { actions, isLitLink, isRelated, state } from '../state.js'
import { graphData, linkStrength } from './graph-data.js'

const BACKGROUND = '#04060c'
const TWIN = '#c4a7ff'
const SETTLE_MS = 1500

/** Each agent's name above its part of the graph, when there are several. */
function drawAgentNames(ctx, scale, nodes) {
  if (agents.length < 2) return
  const box = agents.map(() => ({ left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, top: Number.POSITIVE_INFINITY }))
  for (const node of nodes) {
    if (node.x === undefined) continue
    const b = box[skills[node.i].agent]
    b.left = Math.min(b.left, node.x)
    b.right = Math.max(b.right, node.x)
    b.top = Math.min(b.top, node.y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.font = `700 ${16 / scale}px ui-sans-serif, -apple-system, sans-serif`
  ctx.fillStyle = 'rgba(229,231,235,0.55)'
  for (const [a, agent] of agents.entries()) {
    const b = box[a]
    if (b.left === Number.POSITIVE_INFINITY) continue
    ctx.fillText(agent.label, (b.left + b.right) / 2, b.top - 24 / scale)
  }
}

/** Draws glowing halos and travelling comets over the 2D graph. */
function drawLive2d(ctx, scale, nodes) {
  const now = Date.now()
  for (const p of live.paths) {
    const age = now - p.at
    if (age > TRAIL_MS) continue
    const a = nodes[p.from],
      b = nodes[p.to]
    if (!a || !b || a.x === undefined) continue
    const color = p.isBranch ? '#c4a7ff' : colorOf(p.from)
    ctx.save()
    ctx.strokeStyle = alpha(color.startsWith('#') ? color : '#c4a7ff', age < COMET_MS ? 0.55 : 0.28)
    ctx.lineWidth = 1.6 / scale
    if (p.isBranch) ctx.setLineDash([4 / scale, 3 / scale])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    if (age < COMET_MS) {
      const t = (age % 1500) / 1500
      const x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 9 / scale)
      glow.addColorStop(0, '#ffffff')
      glow.addColorStop(0.35, alpha(color.startsWith('#') ? color : '#c4a7ff', 0.8))
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, 9 / scale, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  for (const [i] of live.glow) {
    const g = glowOf(i)
    const n = nodes[i]
    if (!g || !n || n.x === undefined) continue
    const pulse = 1 + 0.35 * Math.sin(now / 160)
    const r = ((10 + 18 * g) * pulse) / Math.max(0.6, scale)
    const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r)
    halo.addColorStop(0, alpha(colorOf(i), 0.9 * g))
    halo.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `600 ${12 / scale}px ui-sans-serif, -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = `rgba(255,255,255,${g})`
    ctx.fillText(skills[i].name, n.x, n.y - r * 0.55)
  }
}

export const graph2dView = {
  async init(el) {
    await loadScript(CDN['2d'])
    this.el = el
    const data = graphData(2)
    const graph = window
      .ForceGraph()(el)
      .backgroundColor(BACKGROUND)
      .graphData(data)
      .nodeId('i')
      .nodeRelSize(4)
      .nodeVal(n => 1 + neighbours[n.i].size * 0.6)
      .nodeCanvasObject((n, ctx, scale) => {
        const i = n.i
        const radius = 2.6 + Math.sqrt(neighbours[i].size) * 1.4
        const related = isRelated(i) || state.matches.has(i)
        ctx.beginPath()
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2)
        ctx.fillStyle = related ? colorOf(i) : alpha(colorOf(i), 0.15)
        if (i === state.selected) {
          ctx.shadowColor = colorOf(i)
          ctx.shadowBlur = 18
        }
        ctx.fill()
        ctx.shadowBlur = 0
        if (i === state.selected) {
          ctx.lineWidth = 1.6 / scale
          ctx.strokeStyle = '#fff'
          ctx.stroke()
        }
        const isNamed =
          scale > 1.6 ||
          i === state.selected ||
          i === state.hover ||
          state.matches.has(i) ||
          (state.selected >= 0 && neighbours[state.selected].has(i))
        if (isNamed && related) {
          ctx.font = `${(i === state.selected ? 13 : 11) / scale}px ui-sans-serif, -apple-system, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = i === state.selected || i === state.hover ? '#fff' : 'rgba(229,231,235,.85)'
          ctx.fillText(skills[i].name, n.x, n.y + radius + 2 / scale)
        }
      })
      .nodePointerAreaPaint((n, color, ctx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(n.x, n.y, 4 + Math.sqrt(neighbours[n.i].size) * 1.4, 0, Math.PI * 2)
        ctx.fill()
      })
      .linkColor(l => {
        if (l.isTwin) return isLitLink(l.pair) ? alpha(TWIN, 0.8) : 'rgba(196,167,255,0.08)'
        if (isLitLink(l.pair)) return alpha(colorOf(l.pair[0]), 0.9)
        return state.hover >= 0 || state.selected >= 0 ? 'rgba(120,130,160,0.07)' : 'rgba(120,130,160,0.22)'
      })
      .linkLineDash(l => (l.isTwin ? [3, 3] : null))
      .linkWidth(l => (isLitLink(l.pair) ? 1.6 : 0.6))
      .onNodeClick(n => actions.select(n.i, true))
      .onNodeHover(n => {
        state.hover = n ? n.i : -1
        el.style.cursor = n ? 'pointer' : 'grab'
        actions.refresh()
      })
      .onRenderFramePre((ctx, scale) => {
        if (scale > 2.2) return
        const sums = regions.map(() => ({ x: 0, y: 0, n: 0 }))
        for (const node of data.nodes) {
          const s = sums[skills[node.i].region]
          s.x += node.x
          s.y += node.y
          s.n++
        }
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        regions.forEach((region, r) => {
          const s = sums[r]
          if (s.n < (scale > 1 ? 1 : 3)) return
          ctx.font = `600 ${Math.min(22, 9 + Math.sqrt(s.n) * 1.6) / scale}px ui-sans-serif, -apple-system, sans-serif`
          ctx.fillStyle = alpha(region.color, 0.26)
          ctx.fillText(region.label, s.x / s.n, s.y / s.n)
        })
        drawAgentNames(ctx, scale, data.nodes)
      })
      .onRenderFramePost((ctx, scale) => drawLive2d(ctx, scale, data.nodes))
      .autoPauseRedraw(false)
      .cooldownTicks(300)
      .onEngineStop(() => this.settle(true))
    // Also settle after a moment: a busy or background tab can take long to stop the layout.
    this.startedAt = Date.now()
    setTimeout(() => this.settle(false), SETTLE_MS)
    graph.d3Force('charge').strength(-28)
    graph.d3Force(
      'cluster',
      clusterForce(n => regions[skills[n.i].region].centre2, 0.3),
    )
    graph.d3Force('link').strength(linkStrength(data.links, 0.02))
    this.graph = graph
    this.nodes = data.nodes
    this.resize = () => graph.width(el.clientWidth).height(el.clientHeight)
  },
  refresh() {
    const g = this.graph
    g.linkColor(g.linkColor()).linkWidth(g.linkWidth())
  },
  fly(i) {
    const n = this.nodes[i]
    this.graph.centerAt(n.x, n.y, 900)
    this.graph.zoom(Math.max(this.graph.zoom(), 1.6), 900)
  },
  focus(i) {
    const n = this.nodes[i]
    this.graph.centerAt(n.x, n.y, 900)
    this.graph.zoom(Math.max(this.graph.zoom(), 3), 900)
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
  focusRegion(r) {
    this.graph.zoomToFit(900, 60, n => skills[n.i].region === r)
  },
  fit() {
    this.showAgent(state.agent)
  },
  showAgent(agent) {
    this.graph.zoomToFit(700, 60, n => agent === 'all' || skills[n.i].agent === agent)
  },
  /** Frees the graph and its canvas; init builds it again. */
  destroy() {
    this.graph._destructor()
    this.el.replaceChildren()
    Object.assign(this, { graph: undefined, nodes: undefined, isSettled: false, isFinal: false })
  },
  pause() {
    this.graph.pauseAnimation()
  },
  resume() {
    this.graph.resumeAnimation()
  },
}
