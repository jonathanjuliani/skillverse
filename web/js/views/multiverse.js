// The Multiverse view: what your agents share, and where they differ. Each
// agent is a universe, a bubble with its skills inside as a galaxy (one spiral
// arm per category, one star per skill). A skill installed in two agents is a
// wormhole between their bubbles; universes that share more sit closer. The
// Shared folder (~/.agents) is a cluster between them, threaded to the agents
// that read it. Click a universe to fly into it, a star to read the skill.
//
// It draws only while something moves (frames.js): every frame while you drag,
// fly or hover or an effect plays, a few for the slow drift, and none at all
// once nothing has happened for a while.

import { createGovernor, createLoop, createScheduler } from '../frames.js'
import { ESM, escapeHtml } from '../lib.js'
import { glowOf, live } from '../live.js'
import { agents, neighbours, regions, skills, skillsOfAgent, twinPairs } from '../model.js'
import { CATEGORY_COLORS, TWIN, tintOf } from '../palette.js'
import { actions, state } from '../state.js'
import { agentSummary } from '../summary.js'
import { galaxyDust, galaxyStars, placeHub, placeUniverses, random, sharedBetween } from './multiverse-layout.js'
import { glowing, MEMBRANE, membraneUniforms, STARS, WORMHOLE, wormholeUniforms } from './shaders.js'
import { nebulaTexture, starPoints } from './sky3d.js'

let THREE
let OrbitControls

const FLY_MS = 1700
/** The Shared folder: drawn as the cluster between the universes, not as one. */
const SHARED = agents.findIndex(agent => agent.id === 'shared')
const MAX_DUST = 1500
const MAX_CHIPS = 30
/** How long a pulse takes through a wormhole, and how long the twin it reaches stays lit. */
const PULSE_MS = 1600
const ECHO_MS = 4000
/** How long a group's arm stays bright after it is picked in the Agents card. */
const ARM_MS = 4000
const isPerf = new URLSearchParams(location.search).get('perf') === '1'
const prefersStill = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** A soft round glow, for galaxy cores and pulses (one texture for all of them). */
function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(canvas)
}

const chip = i =>
  `<button class="chip" data-skill="${i}"><span class="dot" style="background:${CATEGORY_COLORS[skills[i].category] ?? TWIN}"></span><span>${escapeHtml(skills[i].name)}</span></button>`

const chips = list =>
  `<div class="chips">${list.slice(0, MAX_CHIPS).map(chip).join('')}</div>${
    list.length > MAX_CHIPS ? `<p class="tip-hint">and ${list.length - MAX_CHIPS} more</p>` : ''
  }`

export const multiverseView = {
  async init(el) {
    ;[THREE, { OrbitControls }] = await Promise.all([import(ESM.three), import(ESM.controls)])
    this.el = el
    this.isDestroyed = false
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      throw Object.assign(new Error('Multiverse needs WebGL, which is turned off in this browser'), { isWebGL: true })
    }
    this.quality = { ratio: Math.min(1.5, window.devicePixelRatio) }
    this.renderer.setPixelRatio(this.quality.ratio)
    // Counted per frame, for ?perf=1.
    this.renderer.info.autoReset = false
    el.append(this.renderer.domElement)
    this.labels = document.createElement('div')
    this.labels.className = 'overlay'
    this.tip = document.createElement('div')
    this.tip.className = 'orbit-tip'
    this.tip.hidden = true
    el.append(this.labels, this.tip)

    this.scene = new THREE.Scene()
    this.scene.background = nebulaTexture(THREE)
    this.sky = starPoints(THREE)
    this.scene.add(this.sky)
    this.time = { value: 0 }
    this.pointScale = { value: 1 }
    this.glow = glowTexture()

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.minDistance = 1
    this.controls.autoRotateSpeed = 0.25
    // A drag, and the damping after it, keep frames coming.
    this.controls.addEventListener('change', () => this.wake(300))

    this.build()
    this.controls.maxDistance = this.extent * 6

    this.scheduler = createScheduler({ now: () => performance.now(), isDrifting: () => this.isMoving() })
    // No bloom: three.js's glow pass over the sky took 50–260 ms a frame on an M3 Pro. The sprites and skins glow on their own.
    this.governor = createGovernor({ levels: 1 })
    this.frames = { drawn: 0, second: 0, perSecond: 0, last: undefined, ms: 0 }
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.hovered = null
    this.isPinned = false
    this.inside = -1
    this.marks = new Map()
    this.echo = new Map()
    this.pulses = []
    this.seen = new Map([...live.glow].map(([i, g]) => [i, g.at]))
    this.bindPointer()
    if (isPerf) {
      this.perf = document.createElement('div')
      this.perf.className = 'perf'
      el.append(this.perf)
    }
    this.isActive = true
    this.loop = createLoop({
      scheduler: this.scheduler,
      step: () => this.frame(),
      request: f => requestAnimationFrame(f),
      cancel: id => cancelAnimationFrame(id),
    })
    this.resize()
    this.camera.position.copy(this.home().position).multiplyScalar(1.8)
    this.fit(2600)
  },

  // ---- The scene ------------------------------------------------------------

  build() {
    this.between = sharedBetween(i => skills[i].agent, twinPairs)
    const readers = []
    if (SHARED >= 0) for (const key of this.between.keys()) for (const a of key.split('-').map(Number)) if (a !== SHARED) readers.push(a)
    this.places = placeUniverses(
      agents.map(agent => agent.count),
      this.between,
      { skip: new Set(SHARED >= 0 ? [SHARED] : []) },
    )
    const hasHub = SHARED >= 0 && agents[SHARED].count > 0
    this.hubPlace = hasHub ? placeHub(this.places, [...new Set(readers)]) : null
    const all = [...this.places, this.hubPlace].filter(Boolean)
    this.extent = Math.max(20, ...all.map(p => Math.hypot(p.x, p.y, p.z) + p.r))
    this.starOf = new Map()
    this.galaxies = []
    this.universes = agents.map((_, a) => (this.places[a] ? this.makeUniverse(a) : null))
    this.wormholes = [...this.between]
      .filter(([key]) => !key.split('-').map(Number).includes(SHARED))
      .map(([key, list]) => this.makeWormhole(key, list))
    this.hub = hasHub ? this.makeHub([...new Set(readers)]) : null
  },

  /** The Points of one galaxy's stars: one draw call, each star's flare an attribute. */
  makeStars(positions, colors, sizes) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions.flat()), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors.flatMap(c => [c.r, c.g, c.b])), 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(sizes), 1))
    const flare = new THREE.BufferAttribute(new Float32Array(sizes.length), 1)
    flare.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aFlare', flare)
    const material = new THREE.ShaderMaterial({ ...STARS, ...glowing(THREE), uniforms: { uScale: this.pointScale, uDim: { value: 1 } } })
    return new THREE.Points(geometry, material)
  },

  sprite(color, scale, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, opacity, ...glowing(THREE) }))
    s.scale.setScalar(scale)
    return s
  },

  label(html, color) {
    const el = document.createElement('div')
    el.className = 'planet-name'
    el.style.color = color
    el.innerHTML = html
    this.labels.append(el)
    return el
  },

  makeUniverse(a) {
    const agent = agents[a]
    const place = this.places[a]
    const own = skillsOfAgent(a).map(skill => skill.i)
    const group = new THREE.Group()
    group.position.set(place.x, place.y, place.z)
    this.scene.add(group)
    const skin = new THREE.Mesh(
      new THREE.SphereGeometry(place.r, 48, 32),
      new THREE.ShaderMaterial({
        ...MEMBRANE,
        ...glowing(THREE),
        side: THREE.DoubleSide,
        uniforms: membraneUniforms(THREE, tintOf(agent), this.time),
      }),
    )
    skin.raycast = () => {}
    // Hover tests hit a light, invisible sphere rather than the skin.
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(place.r, 16, 12), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.userData = { type: 'agent', a }
    group.add(skin, proxy)
    const rand = random(a * 7919 + 3)
    const tilt = new THREE.Group()
    tilt.rotation.set((rand() - 0.5) * 0.7, 0, (rand() - 0.5) * 0.7)
    const spin = new THREE.Group()
    tilt.add(spin)
    group.add(tilt)
    const universe = { a, group, skin, proxy, spin, r: place.r, centre: group.position, own, stars: null }
    universe.name = this.label(
      `${escapeHtml(agent.label)}<small>${agent.count ? `${agent.count} skills` : 'installed · empty'}</small>`,
      tintOf(agent),
    )
    if (!own.length) return universe

    spin.add(this.sprite(tintOf(agent), place.r * 0.55, 0.55), this.sprite('#ffffff', place.r * 0.16, 0.9))
    const shape = own.map(i => ({ category: skills[i].category, links: neighbours[i].size }))
    const white = new THREE.Color('#ffffff')
    universe.stars = this.makeStars(
      galaxyStars(shape, place.r, a + 1),
      own.map(i => {
        const c = new THREE.Color(CATEGORY_COLORS[skills[i].category] ?? TWIN)
        return skills[i].twins.length ? c.lerp(white, 0.35) : c
      }),
      own.map(i => (skills[i].twins.length ? 1.25 : 0.85)),
    )
    spin.add(universe.stars)
    const dust = galaxyDust(shape, place.r, Math.min(MAX_DUST, 140 + own.length * 9), a + 101)
    const dustStars = this.makeStars(
      dust.map(d => d.at),
      dust.map(d => new THREE.Color(CATEGORY_COLORS[d.category] ?? TWIN).multiplyScalar(0.32 + rand() * 0.25)),
      dust.map(() => 0.25 + rand() * 0.3),
    )
    dustStars.raycast = () => {}
    spin.add(dustStars)
    universe.dust = dustStars
    this.addGalaxy(universe)
    return universe
  },

  /** Registers a galaxy's stars, so flares, search and live events reach them. */
  addGalaxy(galaxy) {
    galaxy.flare = galaxy.stars.geometry.attributes.aFlare
    for (const [k, i] of galaxy.own.entries()) this.starOf.set(i, { galaxy, k })
    this.galaxies.push(galaxy)
  },

  makeWormhole(key, list) {
    const [a, b] = key.split('-').map(Number)
    const p = this.places[a]
    const q = this.places[b]
    const from = new THREE.Vector3(p.x, p.y, p.z)
    const to = new THREE.Vector3(q.x, q.y, q.z)
    const along = to.clone().sub(from).normalize()
    const start = from.clone().addScaledVector(along, p.r * 0.82)
    const end = to.clone().addScaledVector(along, -q.r * 0.82)
    const length = start.distanceTo(end)
    let side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0))
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0)
    side.normalize()
    const mid = start
      .clone()
      .lerp(end, 0.5)
      .addScaledVector(side, length * 0.12 * ((a + b) % 2 ? 1 : -1))
      .add(new THREE.Vector3(0, length * 0.1, 0))
    const curve = new THREE.CatmullRomCurve3([start, mid, end])
    const radius = 0.3 + Math.sqrt(list.length) * 0.28
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, radius, 12, false),
      new THREE.ShaderMaterial({
        ...WORMHOLE,
        ...glowing(THREE),
        side: THREE.DoubleSide,
        uniforms: wormholeUniforms(THREE, tintOf(agents[a]), tintOf(agents[b]), this.time),
      }),
    )
    mesh.raycast = () => {}
    // A fatter, invisible tube, so a thin wormhole is easy to point at.
    const proxy = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius + 1.2, 6, false), new THREE.MeshBasicMaterial({ visible: false }))
    const wormhole = { a, b, mesh, proxy, curve, pairs: list, lit: 0 }
    proxy.userData = { type: 'worm', wormhole }
    // The skills both have, as their entries in the first agent.
    wormhole.own = list.map(([i, j]) => (skills[i].agent === a ? i : j))
    this.scene.add(mesh, proxy)
    return wormhole
  },

  makeHub(readers) {
    const place = this.hubPlace
    const own = skillsOfAgent(SHARED).map(skill => skill.i)
    const group = new THREE.Group()
    group.position.set(place.x, place.y, place.z)
    this.scene.add(group)
    const spin = new THREE.Group()
    group.add(spin)
    spin.add(this.sprite(TWIN, 9, 0.5))
    const rand = random(97)
    const ball = n => Array.from({ length: n }, () => [(rand() - 0.5) * 4, (rand() - 0.5) * 4, (rand() - 0.5) * 4])
    const hub = { a: SHARED, group, spin, centre: group.position, own, r: place.r }
    hub.stars = this.makeStars(
      ball(own.length),
      own.map(() => new THREE.Color('#d6c8ff')),
      own.map(() => 1.1),
    )
    spin.add(hub.stars)
    const dust = this.makeStars(
      ball(60).map(([x, y, z]) => [x * 1.6, y * 1.6, z * 1.6]),
      Array.from({ length: 60 }, () => new THREE.Color('#d6c8ff').multiplyScalar(0.35)),
      Array.from({ length: 60 }, () => 0.3),
    )
    dust.raycast = () => {}
    spin.add(dust)
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(place.r, 16, 12), new THREE.MeshBasicMaterial({ visible: false }))
    proxy.userData = { type: 'hub' }
    group.add(proxy)
    hub.proxy = proxy
    hub.readers = readers
    hub.threads = readers.map(a => {
      const u = this.places[a]
      const centre = new THREE.Vector3(u.x, u.y, u.z)
      const end = centre.clone().addScaledVector(group.position.clone().sub(centre).normalize(), u.r * 0.9)
      const curve = new THREE.CatmullRomCurve3([
        group.position.clone(),
        group.position
          .clone()
          .lerp(end, 0.5)
          .add(new THREE.Vector3(0, 3, 0)),
        end,
      ])
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 48, 0.09, 6, false),
        new THREE.ShaderMaterial({ ...WORMHOLE, ...glowing(THREE), uniforms: wormholeUniforms(THREE, TWIN, tintOf(agents[a]), this.time) }),
      )
      mesh.raycast = () => {}
      mesh.material.uniforms.uLit.value = -0.35
      this.scene.add(mesh)
      return { a, curve, mesh }
    })
    hub.name = this.label(`Shared skills<small>~/.agents · ${own.length}</small>`, TWIN)
    this.addGalaxy(hub)
    return hub
  },

  // ---- Frames ---------------------------------------------------------------

  isMoving() {
    return state.motion !== false && !prefersStill()
  },

  /** Something happened: draw for `ms`, and start the loop if it stopped. */
  wake(ms = 1200) {
    if (this.isDestroyed || !this.loop) return
    this.loop.wake(ms)
  },

  /** One animation frame: draws when the scheduler says so, and keeps the frame times. */
  frame() {
    if (this.isDestroyed || !this.isActive) return
    const now = performance.now()
    const mode = this.scheduler.state()
    if (!document.hidden && this.scheduler.shouldDraw()) {
      const f = this.frames
      const gap = f.last === undefined ? 16 : now - f.last
      // Frame times count only while drawing every frame; drift draws slowly on purpose.
      if (mode === 'active' && f.last !== undefined && gap < 250) this.adjust(this.governor.sample(gap, now))
      this.draw(Math.min(0.05, gap / 1000))
      f.last = now
      f.drawn += 1
      f.ms = f.ms ? f.ms * 0.9 + gap * 0.1 : gap
    }
    if (mode === 'idle') this.frames.last = undefined
  },

  /** The governor stepped quality down: a lower resolution. */
  adjust(level) {
    if (level !== 1) return
    this.quality.ratio = 1
    this.resize()
  },

  draw(dt) {
    this.time.value += dt
    this.renderer.info.reset()
    const isMoving = this.isMoving()
    if (isMoving) {
      for (const u of this.universes) if (u) u.spin.rotation.y += dt * (0.05 + 0.3 / u.r)
      if (this.hub) this.hub.spin.rotation.y += dt * 0.2
    }
    this.flyStep()
    this.controls.autoRotate = isMoving && this.inside < 0 && !this.flight && !this.hovered
    this.controls.update(dt)
    if (this.pointerAt && !this.isPinned) {
      this.hover(this.pick(this.pointerAt.x, this.pointerAt.y), this.pointerAt.x, this.pointerAt.y)
      this.pointerAt = undefined
    }
    this.drawSkins(dt)
    this.liveStep()
    this.drawFlares()
    this.drawPulses(dt)
    this.drawLabels()
    this.sky.position.copy(this.camera.position)
    this.renderer.render(this.scene, this.camera)
    this.drawPerf()
  },

  drawSkins(dt) {
    const approach = (uniform, target, rate = 0.12) => {
      uniform.value += (target - uniform.value) * Math.min(1, rate * dt * 60)
    }
    const h = this.hovered
    for (const u of this.universes) {
      if (!u) continue
      const isHovered = h && ((h.type === 'agent' && h.a === u.a) || (h.type === 'worm' && (h.wormhole.a === u.a || h.wormhole.b === u.a)))
      approach(u.skin.material.uniforms.uHover, isHovered ? 1 : 0)
      const level = u.skin.material.uniforms.uLevel
      // An empty agent flickers, an unborn universe; the one the camera is in fades, so its galaxy shows.
      if (!u.own.length) level.value = 0.4 + 0.25 * Math.sin(this.time.value * 2.3) * Math.sin(this.time.value * 0.7 + 1)
      else approach(level, this.inside === u.a ? 0.5 : 1)
    }
    for (const w of this.wormholes) approach(w.mesh.material.uniforms.uLit, (h?.type === 'worm' && h.wormhole === w) || w.isLit ? 1 : 0)
    if (this.hub) for (const t of this.hub.threads) approach(t.mesh.material.uniforms.uLit, h?.type === 'hub' ? 0.9 : -0.35)
  },

  /** Each star's flare: a live glow, a twin that a pulse reached, search, hover, selection or a picked group. */
  drawFlares() {
    const now = performance.now()
    const arm = this.arm && now - this.arm.at < ARM_MS ? this.arm : null
    for (const g of this.galaxies) {
      const values = g.flare.array
      let isChanged = false
      for (const [k, i] of g.own.entries()) {
        const echo = this.echo.has(i) ? Math.max(0, 1 - (now - this.echo.get(i)) / ECHO_MS) : 0
        const picked = arm && arm.agent === g.a && skills[i].category === arm.category ? 0.35 * (1 - (now - arm.at) / ARM_MS) : 0
        const value = Math.max(glowOf(i), echo, picked, this.marks.get(i) ?? 0)
        if (Math.abs(values[k] - value) > 0.002) {
          values[k] = value
          isChanged = true
        }
      }
      if (isChanged) g.flare.needsUpdate = true
    }
  },

  // ---- Live -----------------------------------------------------------------

  /** Skills that just fired: a ripple across their universe, and a pulse to each twin. */
  liveStep() {
    const now = Date.now()
    for (const [i, g] of live.glow) {
      if (this.seen.get(i) === g.at) continue
      this.seen.set(i, g.at)
      if (now - g.at < 2000) this.fire(i)
    }
  },

  ripple(i) {
    const spot = this.starOf.get(i)
    if (!spot?.galaxy.skin) return
    const { galaxy, k } = spot
    const at = new THREE.Vector3().fromBufferAttribute(galaxy.stars.geometry.attributes.position, k)
    galaxy.stars.localToWorld(at)
    const uniforms = galaxy.skin.material.uniforms
    uniforms.uRippleDir.value.copy(at.sub(galaxy.centre).normalize())
    uniforms.uRippleAt.value = this.time.value
  },

  fire(i) {
    this.ripple(i)
    const a = skills[i].agent
    for (const j of skills[i].twins) {
      const b = skills[j].agent
      let curve
      let isForward = true
      if (a === SHARED || b === SHARED) {
        const thread = this.hub?.threads.find(t => t.a === (a === SHARED ? b : a))
        curve = thread?.curve
        isForward = a === SHARED
      } else {
        const w = this.wormholes.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a))
        curve = w?.curve
        isForward = w?.a === a
      }
      if (!curve) continue
      const sprite = this.sprite('#ffffff', 3.2)
      this.scene.add(sprite)
      this.pulses.push({ curve, sprite, isForward, at: performance.now(), to: j })
    }
    this.wake(PULSE_MS + 600)
  },

  drawPulses() {
    const now = performance.now()
    for (const pulse of [...this.pulses]) {
      const t = Math.min(1, (now - pulse.at) / PULSE_MS)
      pulse.sprite.position.copy(pulse.curve.getPointAt(pulse.isForward ? t : 1 - t))
      pulse.sprite.material.opacity = Math.sin(t * Math.PI) * 0.9 + 0.1
      if (t < 1) continue
      this.scene.remove(pulse.sprite)
      pulse.sprite.material.dispose()
      this.pulses.splice(this.pulses.indexOf(pulse), 1)
      this.echo.set(pulse.to, now)
      this.ripple(pulse.to)
      this.wake(ECHO_MS)
    }
  },

  // ---- Labels and the perf overlay -----------------------------------------

  drawLabels() {
    const { clientWidth: w, clientHeight: h } = this.el
    const place = (el, centre, lift) => {
      const at = centre
        .clone()
        .add(new THREE.Vector3(0, lift, 0))
        .project(this.camera)
      el.hidden = at.z > 1 || Math.abs(at.x) > 1.2 || Math.abs(at.y) > 1.2
      el.style.left = `${((at.x + 1) / 2) * w}px`
      el.style.top = `${((1 - at.y) / 2) * h}px`
      el.classList.toggle('is-followed', state.agent !== 'all' && this.universes[state.agent]?.name === el)
    }
    for (const u of this.universes) if (u) place(u.name, u.centre, -(u.r + 3))
    if (this.hub) place(this.hub.name, this.hub.centre, -(this.hub.r + 2))
  },

  drawPerf() {
    if (!this.perf) return
    const f = this.frames
    const now = performance.now()
    if (now - f.second < 250) return
    f.perSecond = Math.round(1000 / Math.max(1, f.ms))
    f.second = now
    const info = this.renderer.info.render
    this.perf.textContent = [
      `${this.scheduler.state()} · ${f.perSecond} fps · ${f.ms.toFixed(1)} ms`,
      `${info.calls} draw calls · ${f.drawn} frames drawn`,
      `ratio ${this.renderer.getPixelRatio()} · ${this.renderer.info.memory.textures} textures`,
    ].join('\n')
  },

  // ---- Camera ---------------------------------------------------------------

  /** Where the camera sees every universe from, for this canvas's shape. */
  home() {
    const aspect = this.el.clientWidth / Math.max(1, this.el.clientHeight)
    const tan = Math.tan((this.camera.fov * Math.PI) / 360)
    const distance = (this.extent / (tan * Math.min(1, aspect))) * 1.15
    return { position: new THREE.Vector3(0, distance * 0.3, distance * 0.95), target: new THREE.Vector3(0, this.extent * 0.08, 0) }
  },

  flyTo(position, target, ms = FLY_MS, then) {
    if (prefersStill()) ms = 0
    this.flight = {
      from: this.camera.position.clone(),
      look: this.controls.target.clone(),
      to: position,
      lookTo: target,
      at: performance.now(),
      ms,
      then,
    }
    this.wake(ms + 400)
  },

  flyStep() {
    const f = this.flight
    if (!f) return
    const t = f.ms > 0 ? Math.min(1, (performance.now() - f.at) / f.ms) : 1
    const e = ease(t)
    this.camera.position.lerpVectors(f.from, f.to, e)
    this.controls.target.lerpVectors(f.look, f.lookTo, e)
    if (t < 1) return
    this.flight = undefined
    f.then?.()
  },

  /** Through a universe's skin into its galaxy; Shared flies to its cluster instead. */
  flyInto(a) {
    if (a === SHARED) return this.flyToHub()
    const u = this.universes[a]
    if (!u) return
    this.inside = a
    this.unpin()
    const from = this.camera.position.clone().sub(u.centre).normalize()
    from.y = Math.max(from.y, 0.35)
    from.normalize()
    const distance = u.own.length ? u.r * 0.7 : u.r * 2.6
    this.flyTo(u.centre.clone().addScaledVector(from, distance), u.centre.clone(), FLY_MS, () => actions.followed(a))
  },

  flyToHub() {
    if (!this.hub) return
    this.inside = -1
    this.unpin()
    const from = this.camera.position.clone().sub(this.hub.centre).normalize()
    this.flyTo(this.hub.centre.clone().addScaledVector(from, 22), this.hub.centre.clone(), FLY_MS, () => actions.followed(SHARED))
  },

  flyOut(ms = FLY_MS) {
    this.inside = -1
    this.unpin()
    const { position, target } = this.home()
    this.flyTo(position, target, ms)
  },

  // ---- Pointer --------------------------------------------------------------

  /** What is under the pointer: a star of the universe the camera is in, a universe, a wormhole or the Shared cluster. */
  pick(x, y) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const inside = this.universes[this.inside]
    if (inside?.stars) {
      this.raycaster.params.Points.threshold = inside.r * 0.035
      const hit = this.raycaster.intersectObject(inside.stars, false)[0]
      if (hit) return { type: 'star', i: inside.own[hit.index] }
    }
    if (this.hub && this.camera.position.distanceTo(this.hub.centre) < 60) {
      this.raycaster.params.Points.threshold = 0.6
      const hit = this.raycaster.intersectObject(this.hub.stars, false)[0]
      if (hit) return { type: 'star', i: this.hub.own[hit.index] }
    }
    const targets = [
      ...this.universes.filter(u => u && u.a !== this.inside).map(u => u.proxy),
      ...this.wormholes.map(w => w.proxy),
      ...(this.hub ? [this.hub.proxy] : []),
    ]
    return this.raycaster.intersectObjects(targets, false)[0]?.object.userData ?? null
  },

  hover(hit, x, y) {
    const i = hit?.type === 'star' ? hit.i : -1
    if (i !== state.hover) {
      state.hover = i
      actions.refresh()
    }
    this.hovered = hit
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab'
    this.showTip(hit, x, y)
  },

  tipHtml(hit, isPinned) {
    if (hit.type === 'star') {
      const skill = skills[hit.i]
      const also = skill.twins.map(j => agents[skills[j].agent].label)
      return `<div class="tip-head"><b>${escapeHtml(skill.name)}</b>${skill.kind === 'mcp' ? '<span>connector</span>' : ''}</div><span>${escapeHtml(regions[skill.region]?.label || '')}</span>${
        also.length ? `<p class="tip-hint">Also in ${escapeHtml([...new Set(also)].join(', '))}</p>` : ''
      }`
    }
    if (hit.type === 'agent') {
      const agent = agents[hit.a]
      const from = agent.from === 'session' ? 'from a live session' : 'scanned from disk'
      return `<div class="tip-head"><b>${escapeHtml(agent.label)}</b><span>${from}</span></div>${agentSummary(hit.a)}<p class="tip-hint">Click to fly in</p>`
    }
    if (hit.type === 'worm') {
      const { a, b, own } = hit.wormhole
      return `<div class="tip-head"><b>${escapeHtml(agents[a].label)} ⟷ ${escapeHtml(agents[b].label)}</b><span>${own.length} in both</span></div>${chips(own)}<p class="tip-hint">${
        isPinned ? 'Pick a skill to read it' : 'Click to keep this open'
      }</p>`
    }
    const readers = this.hub.readers.map(a => agents[a].label)
    return `<div class="tip-head"><b>Shared skills</b><span>~/.agents/skills</span></div>${
      readers.length ? `<p class="sum-shares">Read by ${escapeHtml(readers.join(', '))}</p>` : ''
    }${chips(this.hub.own)}<p class="tip-hint">${isPinned ? 'Pick a skill to read it' : 'Click to fly there'}</p>`
  },

  showTip(hit, x, y, isPinned = false) {
    this.tip.hidden = !hit
    this.tip.classList.toggle('is-pinned', isPinned)
    if (!hit) return
    this.tip.innerHTML = this.tipHtml(hit, isPinned)
    // Beside the pointer, flipped to its other side near the canvas's right or bottom edge.
    const rect = this.el.getBoundingClientRect()
    const px = x - rect.left
    const py = y - rect.top
    const { offsetWidth: w, offsetHeight: h } = this.tip
    this.tip.style.left = `${px + 14 + w > rect.width ? Math.max(4, px - 14 - w) : px + 14}px`
    this.tip.style.top = `${py + 14 + h > rect.height ? Math.max(4, py - 14 - h) : py + 14}px`
  },

  unpin() {
    if (!this.isPinned) return
    this.isPinned = false
    this.tip.hidden = true
  },

  bindPointer() {
    const canvas = this.renderer.domElement
    let down
    canvas.addEventListener('pointermove', event => {
      // Picked once per drawn frame, not once per event.
      this.pointerAt = { x: event.clientX, y: event.clientY }
      this.wake(600)
    })
    canvas.addEventListener('pointerleave', () => {
      this.pointerAt = undefined
      this.hovered = null
      if (!this.isPinned) this.tip.hidden = true
      if (state.hover >= 0) {
        state.hover = -1
        actions.refresh()
      }
      this.wake(400)
    })
    canvas.addEventListener('pointerdown', event => {
      down = { x: event.clientX, y: event.clientY }
      // Taking the camera mid-flight ends the flight.
      this.flight = undefined
      this.wake()
    })
    canvas.addEventListener('wheel', () => this.wake(800), { passive: true })
    canvas.addEventListener('click', event => {
      // A drag that ends over something is not a click on it.
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return
      const hit = this.pick(event.clientX, event.clientY)
      if (!hit) return this.unpin()
      if (hit.type === 'star') return actions.select(hit.i, true)
      if (hit.type === 'agent') return this.flyInto(hit.a)
      if (hit.type === 'hub' && this.isPinned) return this.flyToHub()
      this.isPinned = true
      this.hovered = hit
      this.showTip(hit, event.clientX, event.clientY, true)
    })
    // A double-click on empty space goes back to every universe.
    canvas.addEventListener('dblclick', event => {
      if (!this.pick(event.clientX, event.clientY)) actions.showAll()
    })
  },

  // ---- The view interface ---------------------------------------------------

  /** Search, hover and selection: matching stars flare in every universe, the rest dim, and wormholes between them light. */
  refresh() {
    if (!this.galaxies) return
    const marks = new Map()
    for (const i of state.matches) marks.set(i, 0.5)
    if (state.hover >= 0) marks.set(state.hover, 0.6)
    if (state.selected >= 0) marks.set(state.selected, 0.85)
    this.marks = marks
    const dim = state.matches.size ? 0.3 : 1
    for (const g of this.galaxies) g.stars.material.uniforms.uDim.value = dim
    for (const w of this.wormholes) w.isLit = w.pairs.some(([i, j]) => marks.has(i) || marks.has(j))
    this.wake(400)
  },
  resize() {
    const { clientWidth: w, clientHeight: h } = this.el
    if (!w || !h) return
    this.renderer.setPixelRatio(this.quality.ratio)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.pointScale.value = (h * this.quality.ratio) / (2 * Math.tan((this.camera.fov * Math.PI) / 360))
    this.wake(300)
  },
  focus(i) {
    const a = skills[i].agent
    if (a === SHARED) this.flyToHub()
    else if (this.inside !== a) this.flyInto(a)
    this.refresh()
  },
  fly(i) {
    this.focus(i)
  },
  focusRegion(r) {
    const region = regions[r]
    this.arm = { agent: region.agent, category: region.category, at: performance.now() }
    if (region.agent === SHARED) this.flyToHub()
    else this.flyInto(region.agent)
    this.wake(ARM_MS)
  },
  fit(ms = FLY_MS) {
    this.flyOut(ms)
  },
  showAgent(agent) {
    this.unpin()
    this.tip.hidden = true
    if (agent === 'all') this.flyOut()
    else this.flyInto(agent)
  },
  /** Frees every geometry, material, texture, render target and the WebGL context; init builds it all again. */
  destroy() {
    this.isDestroyed = true
    this.loop?.stop()
    this.scene.background?.dispose()
    this.scene.traverse(object => {
      object.geometry?.dispose()
      for (const material of [object.material].flat()) material?.dispose()
    })
    this.glow.dispose()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.el.replaceChildren()
    Object.assign(this, {
      scene: undefined,
      universes: undefined,
      wormholes: undefined,
      galaxies: undefined,
      hub: undefined,
      renderer: undefined,
      scheduler: undefined,
      loop: undefined,
      flight: undefined,
      pulses: [],
    })
  },
  pause() {
    this.isActive = false
  },
  resume() {
    this.isActive = true
    this.frames.last = undefined
    this.wake()
  },
}
