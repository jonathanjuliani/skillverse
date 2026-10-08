// The orbit view: every agent in one scene. Skillverse is the star at the
// centre; each agent is a planet orbiting it, sized by its skill count (the
// biggest on the inner orbit). Twins (one skill under two agents) are bridges
// between planets. Click a skill to read it, a planet to fly to it; the camera
// then follows that planet along its orbit. Click the star to see everything.

import { alpha, deg, destination, ESM, escapeHtml, mixHex } from '../lib.js'
import { glowOf, heatOf, live, liveArcs, liveRings } from '../live.js'
import {
  agents,
  categoriesOfAgent,
  colorOf,
  isBareRegion,
  neighbours,
  pairs,
  regionName,
  regions,
  regionsOfAgent,
  skills,
  skillsOfAgent,
  twinPairs,
} from '../model.js'
import { actions, isLitLink, isRelated, state } from '../state.js'
import { agentSummary, allSummary } from '../summary.js'

const BACKGROUND = '#04060c'
const BRANCH = '#c4a7ff'
const TWIN = '#c4a7ff'
/** three-globe's radius, in scene units. */
const RADIUS = 100
/** The Skillverse star's radius, and the space between two orbits' planets. */
const STAR = 70
const ORBIT_GAP = 70
/** The inner orbit's speed (radians a second; outer ones are slower) and the tilt of the orbits' plane. */
const ORBIT_SPEED = 0.03
const TILT = 0.22
const FLY_MS = 1100
/** How close (in planet radii) the camera must be for a planet's category names to show. */
const CATEGORY_REACH = 7

let THREE
let OrbitControls
let ThreeGlobe

/** A planet's card on hover: what the agent has and what a session costs (summary.js). */
function planetTip(a) {
  const agent = agents[a]
  const from = agent.from === 'session' ? 'from a live session' : 'scanned from disk'
  const isHere = this?.following === a
  return `<div class="tip-head"><b>${escapeHtml(agent.label)}</b><span>${from}</span></div>
    ${agentSummary(a)}
    <p class="tip-hint">${isHere ? 'Double-click empty space or press Esc for every planet' : 'Click to fly there and follow it'}</p>`
}

/** The star's card: every agent together. */
const starTip = () => `<div class="tip-head"><b>Skillverse</b><span>every agent on this machine</span></div>
  ${allSummary()}
  <p class="tip-hint">Click to see every planet · keys 1–${Math.min(9, agents.length)} jump to one, 0 back here</p>`

const tooltip = i =>
  `<div class="tip-head"><b>${escapeHtml(skills[i].name)}</b>${skills[i].kind === 'mcp' ? '<span>connector</span>' : ''}</div><span>${escapeHtml(regions[skills[i].region]?.label || '')}</span>`

/**
 * The region names written on a planet, small, without their category's word
 * ("User · docs" is "docs"); the categories' names are tags on screen (drawCategories).
 */
function regionLabels(a) {
  return categoriesOfAgent(a).flatMap(category =>
    category.regions.flatMap(region => {
      // A region named only by its category's word ("User", "MCP") is under the category's tag.
      if (isBareRegion(region)) return []
      return [
        {
          lat: region.lat,
          lon: region.lon,
          text: regionName(region),
          color: region.color,
          size: 0.9 + Math.min(0.9, Math.sqrt(region.count) * 0.15),
        },
      ]
    }),
  )
}

/** A region as a coloured cap on the globe (a polygon; one over a pole is closed across it). */
function continent(region) {
  const edge = []
  for (let k = 0; k < 96; k++) {
    const [lat, lon] = destination(region.lat, region.lon, (k / 96) * Math.PI * 2, region.cap)
    edge.push([deg(lon), deg(lat)])
  }
  let ring
  if (region.cap >= Math.PI / 2 - Math.abs(region.lat)) {
    const pole = region.lat >= 0 ? 90 : -90
    const around = edge.map(([lon, lat]) => [((lon + 540) % 360) - 180, lat]).sort((a, b) => a[0] - b[0])
    ring = [...around, [180, around[around.length - 1][1]], [180, pole], [-180, pole], [-180, around[0][1]], around[0]]
    // The outline's direction says which side is inside: clockwise around the cap.
    if (pole > 0) ring.reverse()
  } else {
    ring = [...edge, edge[0]]
  }
  return { type: 'Feature', properties: { color: region.color }, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** Where a planet's orbit puts it now. */
const orbitPosition = planet =>
  new THREE.Vector3(
    Math.cos(planet.angle) * planet.orbit,
    Math.sin(planet.angle) * planet.orbit * Math.sin(TILT),
    Math.sin(planet.angle) * planet.orbit * Math.cos(TILT),
  )

/** A planet: one agent's globe, its place on its orbit, and its size. */
function makePlanet(a) {
  const own = skillsOfAgent(a)
  const ownPairs = pairs.filter(([x]) => skills[x].agent === a)
  const ownRegions = regionsOfAgent(a)
  const labels = regionLabels(a)
  const isOwn = p => skills[p.from].agent === a && skills[p.to].agent === a
  const globe = new ThreeGlobe({ animateIn: false })
    .showAtmosphere(true)
    .atmosphereColor('#6d8cff')
    .atmosphereAltitude(0.18)
    .showGraticules(true)
    .polygonsData(ownRegions.map(continent))
    .polygonCapColor(f => alpha(f.properties.color, 0.16))
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(f => alpha(f.properties.color, 0.55))
    .polygonAltitude(0.007)
    .polygonCapCurvatureResolution(5)
    .pointsMerge(false)
    .pointsTransitionDuration(0)
    .pointLat(d => deg(d.lat))
    .pointLng(d => deg(d.lon))
    .pointAltitude(d => (d.i === state.selected ? 0.07 : 0.01) + glowOf(d.i) * 0.14)
    .pointRadius(
      d =>
        (d.i === state.selected ? 0.9 : 0.45 + Math.min(0.4, Math.sqrt(neighbours[d.i].size) * 0.09)) +
        glowOf(d.i) * 0.6 +
        Math.min(0.3, heatOf(d.i) * 0.06),
    )
    .pointResolution(10)
    .pointColor(d => {
      if (glowOf(d.i) > 0) return mixHex(colorOf(d.i), '#ffffff', 0.55 * glowOf(d.i))
      return isRelated(d.i) || state.matches.has(d.i) || heatOf(d.i) > 0 ? colorOf(d.i) : alpha(colorOf(d.i), 0.25)
    })
    .ringLat(r => deg(skills[r.i].lat))
    .ringLng(r => deg(skills[r.i].lon))
    .ringAltitude(0.012)
    .ringColor(r => t => alpha(r.isBranch ? BRANCH : colorOf(r.i), Math.max(0, 1 - t) * r.strength))
    .ringMaxRadius(6)
    .ringPropagationSpeed(3.2)
    .ringRepeatPeriod(650)
    .arcStartLat(p => deg(skills[p.live ? p.from : p[0]].lat))
    .arcStartLng(p => deg(skills[p.live ? p.from : p[0]].lon))
    .arcEndLat(p => deg(skills[p.live ? p.to : p[1]].lat))
    .arcEndLng(p => deg(skills[p.live ? p.to : p[1]].lon))
    .arcAltitudeAutoScale(0.35)
    // A live path rises well off the surface, so a hop between neighbours still reads as a jump.
    .arcAltitude(p => (p.live ? 0.22 : null))
    .arcColor(p => {
      // Lighter than the planet's own blue, so the path stands out against it.
      const tint = color => (p.isBranch ? BRANCH : mixHex(color, '#ffffff', 0.45))
      if (p.live === 'comet') return [alpha(tint(colorOf(p.from)), 0.3), '#ffffff']
      if (p.live === 'trail') return [alpha(tint(colorOf(p.from)), 0.85), alpha(tint(colorOf(p.to)), 0.85)]
      return isLitLink(p) ? [colorOf(p[0]), colorOf(p[1])] : ['rgba(150,165,200,0.14)', 'rgba(150,165,200,0.14)']
    })
    .arcStroke(p => (p.live === 'comet' ? 2 : p.live === 'trail' ? 0.9 : isLitLink(p) ? 0.6 : null))
    .arcDashLength(p => (p.live === 'comet' ? 0.3 : p.live === 'trail' ? 0.04 : isLitLink(p) ? 0.45 : 1))
    .arcDashGap(p => (p.live === 'comet' ? 1.4 : p.live === 'trail' ? 0.02 : isLitLink(p) ? 0.15 : 0))
    .arcDashInitialGap(p => (p.live === 'comet' ? 1 : 0))
    .arcDashAnimateTime(p => (p.live === 'comet' ? 1500 : !p.live && isLitLink(p) ? 1600 : 0))
    .labelLat(l => deg(l.lat))
    .labelLng(l => deg(l.lon))
    .labelText(l => l.text)
    .labelColor(l => alpha(mixHex(l.color, '#ffffff', 0.4), 0.9))
    .labelSize(l => l.size)
    .labelDotRadius(0)
    .labelAltitude(0.03)
    .labelResolution(2)
  const material = globe.globeMaterial()
  material.color.set('#0a1224')
  if (material.emissive) material.emissive.set('#050914')
  material.shininess = 6

  const group = new THREE.Group()
  group.add(globe)
  const name = document.createElement('div')
  name.className = 'planet-name'
  name.textContent = `${agents[a].label} · ${agents[a].count}`
  const categories = categoriesOfAgent(a).map(category => {
    const tag = document.createElement('div')
    tag.className = 'category-tag'
    tag.style.setProperty('--tag', category.regions[0].color)
    tag.innerHTML = `${escapeHtml(category.label)} <b>${category.count}</b>`
    tag.hidden = true
    return { ...category, tag }
  })

  return {
    agent: a,
    globe,
    group,
    name,
    categories,
    scale: 1,
    orbit: 0,
    angle: 0,
    /** Redraws what changes with selection, hover and live activity. */
    refresh() {
      globe
        .pointsData(own)
        .arcsData([...ownPairs, ...liveArcs().filter(isOwn)])
        .ringsData(liveRings().filter(r => skills[r.i].agent === a))
        .labelsData(labels)
    },
  }
}

export const orbitView = {
  async init(el) {
    ;[THREE, { OrbitControls }, { default: ThreeGlobe }] = await Promise.all([import(ESM.three), import(ESM.controls), import(ESM.globe)])
    this.el = el
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    // 1.5 is sharp enough for thin lines, and a 2x buffer costs nearly twice the memory.
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))
    this.renderer.setClearColor(BACKGROUND)
    el.append(this.renderer.domElement)
    this.labels = document.createElement('div')
    this.labels.className = 'overlay'
    el.append(this.labels)
    this.tip = document.createElement('div')
    this.tip.className = 'orbit-tip'
    this.tip.hidden = true
    el.append(this.tip)

    this.scene = new THREE.Scene()
    // The star lights the planets; a soft ambient keeps their night side readable.
    this.scene.add(new THREE.AmbientLight(0xcbd5ff, Math.PI * 0.4))
    this.scene.add(new THREE.PointLight(0xfff2dd, Math.PI * 1.1, 0, 0))
    this.star = this.makeStar()
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 20000)
    this.camera.position.set(0, 420, 1400)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 140
    this.controls.maxDistance = 4000

    this.planets = agents.map((_, a) => makePlanet(a))
    for (const planet of this.planets) {
      this.scene.add(planet.group)
      this.labels.append(planet.name, ...planet.categories.map(category => category.tag))
    }
    this.rings = new THREE.Group()
    this.scene.add(this.rings)
    this.bridges = this.makeBridges()
    this.following = -1
    this.fired = new Map()
    this.layout()
    for (const planet of this.planets) planet.group.position.copy(orbitPosition(planet))

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.hovered = { i: -1, planet: -1 }
    this.bindPointer()
    this.clock = new THREE.Clock()
    this.isActive = true
    this.isDestroyed = false
    const frame = () => {
      if (this.isDestroyed) return
      requestAnimationFrame(frame)
      // Nothing to draw for a tab nobody sees.
      if (this.isActive && !document.hidden) this.draw(this.clock.getDelta())
    }
    requestAnimationFrame(frame)
    for (const planet of this.planets) planet.refresh()
    this.resize()
    this.fit(0)
  },

  /** The Skillverse star: a bright core in two glows, named on screen like the planets. */
  makeStar() {
    const group = new THREE.Group()
    const core = new THREE.Mesh(new THREE.SphereGeometry(STAR, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffd98a }))
    const glow = (scale, opacity) =>
      new THREE.Mesh(
        new THREE.SphereGeometry(STAR * scale, 48, 32),
        new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
    const corona = glow(1.3, 0.22)
    group.add(core, corona, glow(1.9, 0.07))
    this.scene.add(group)
    const name = document.createElement('div')
    name.className = 'planet-name is-centre'
    name.textContent = 'Skillverse'
    this.labels.append(name)
    return { group, core, corona, name }
  },

  /** Each planet's size (by skill count) and orbit: the biggest closest to the star, outer orbits slower. */
  layout() {
    const most = Math.max(...agents.map(agent => agent.count), 1)
    const bySize = [...this.planets].sort((a, b) => agents[b.agent].count - agents[a.agent].count)
    let reach = STAR * 1.9 + ORBIT_GAP
    for (const [k, planet] of bySize.entries()) {
      planet.scale = Math.max(0.4, Math.sqrt(agents[planet.agent].count / most))
      planet.group.scale.setScalar(planet.scale)
      reach += RADIUS * planet.scale
      planet.orbit = reach
      reach += RADIUS * planet.scale + ORBIT_GAP
      // Spread around the star so no two start lined up.
      planet.angle = k * 2.4
    }
    const inner = bySize[0]?.orbit ?? 1
    for (const planet of this.planets) planet.speed = ORBIT_SPEED * Math.sqrt(inner / planet.orbit) ** 3
    // Faint circles for the orbits.
    this.rings.clear()
    for (const planet of this.planets) {
      const points = Array.from({ length: 129 }, (_, k) => {
        const t = (k / 128) * Math.PI * 2
        return new THREE.Vector3(
          Math.cos(t) * planet.orbit,
          Math.sin(t) * planet.orbit * Math.sin(TILT),
          Math.sin(t) * planet.orbit * Math.cos(TILT),
        )
      })
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x6d8cff, transparent: true, opacity: 0.12 }),
      )
      this.rings.add(line)
    }
  },

  /** One line segment per twin pair, redrawn as planets move; the selected skill's are bright. */
  makeBridges() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(twinPairs.length * 6), 3))
    const faint = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: TWIN, transparent: true, opacity: 0.06 }))
    const litGeometry = new THREE.BufferGeometry()
    litGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(32 * 6), 3))
    const lit = new THREE.LineSegments(litGeometry, new THREE.LineBasicMaterial({ color: TWIN, transparent: true, opacity: 0.9 }))
    this.scene.add(faint, lit)
    return { faint, lit }
  },

  /** Where a skill sits in the scene now (its planet moves). */
  worldOf(i, altitude = 0.02) {
    const planet = this.planets[skills[i].agent]
    const c = planet.globe.getCoords(deg(skills[i].lat), deg(skills[i].lon), altitude)
    return planet.group.localToWorld(new THREE.Vector3(c.x, c.y, c.z))
  },

  draw(dt) {
    // Orbits pause while a planet is hovered or a skill is open, so neither runs away.
    const isPaused = this.hovered.planet >= 0 || state.selected >= 0
    for (const planet of this.planets) {
      if (!isPaused) planet.angle += planet.speed * dt
      planet.group.position.copy(orbitPosition(planet))
      planet.group.rotation.y += isPaused ? 0 : dt * 0.05
    }
    this.star.corona.scale.setScalar(1 + 0.03 * Math.sin(performance.now() / 900))
    this.scene.updateMatrixWorld()
    this.flyStep()
    this.followStep()
    this.drawBridges()
    this.drawNames()
    this.controls.update()
    for (const planet of this.planets) planet.globe.setPointOfView(this.camera)
    this.renderer.render(this.scene, this.camera)
  },

  drawBridges() {
    const faint = this.bridges.faint.geometry.attributes.position
    for (const [k, [a, b]] of twinPairs.entries()) {
      const p = this.worldOf(a)
      const q = this.worldOf(b)
      faint.setXYZ(k * 2, p.x, p.y, p.z)
      faint.setXYZ(k * 2 + 1, q.x, q.y, q.z)
    }
    faint.needsUpdate = true
    const lit = this.bridges.lit.geometry.attributes.position
    const focus = state.selected >= 0 ? state.selected : state.hover
    const ends = focus >= 0 ? skills[focus].twins.slice(0, 32) : []
    for (const [k, j] of ends.entries()) {
      const p = this.worldOf(focus)
      const q = this.worldOf(j)
      lit.setXYZ(k * 2, p.x, p.y, p.z)
      lit.setXYZ(k * 2 + 1, q.x, q.y, q.z)
    }
    this.bridges.lit.geometry.setDrawRange(0, ends.length * 2)
    lit.needsUpdate = true
  },

  /** Each planet's name under it, and the star's, on screen. */
  drawNames() {
    const { clientWidth: w, clientHeight: h } = this.el
    const place = (name, position, below) => {
      const at = position
        .clone()
        .add(new THREE.Vector3(0, -below, 0))
        .project(this.camera)
      name.hidden = at.z > 1
      name.style.left = `${((at.x + 1) / 2) * w}px`
      name.style.top = `${((1 - at.y) / 2) * h}px`
    }
    for (const planet of this.planets) {
      place(planet.name, planet.group.position, RADIUS * planet.scale * 1.25)
      planet.name.classList.toggle('is-followed', planet.agent === this.following)
    }
    place(this.star.name, this.star.group.position, STAR * 1.5)
    this.drawCategories()
    this.drawFired()
  },

  /**
   * Each category's name over its area, on the planets the camera is close to,
   * and only on the side facing the camera.
   */
  drawCategories() {
    const { clientWidth: w, clientHeight: h } = this.el
    const camera = this.camera.position
    for (const planet of this.planets) {
      const centre = planet.group.position
      const isClose = camera.distanceTo(centre) < RADIUS * planet.scale * CATEGORY_REACH
      for (const category of planet.categories) {
        if (!isClose) {
          category.tag.hidden = true
          continue
        }
        const c = planet.globe.getCoords(deg(category.lat), deg(category.lon), 0.06)
        const point = planet.group.localToWorld(new THREE.Vector3(c.x, c.y, c.z))
        const isFacing = point.clone().sub(centre).dot(camera.clone().sub(point)) > 0
        const at = point.project(this.camera)
        category.tag.hidden = !isFacing || at.z > 1
        category.tag.style.left = `${((at.x + 1) / 2) * w}px`
        category.tag.style.top = `${((1 - at.y) / 2) * h}px`
      }
    }
  },

  /** The name of each skill that just fired, over it on screen, fading with its glow. */
  drawFired() {
    const { clientWidth: w, clientHeight: h } = this.el
    const shown = new Set()
    for (const i of live.glow.keys()) {
      const g = glowOf(i)
      if (g <= 0.12) continue
      shown.add(i)
      let tag = this.fired.get(i)
      if (!tag) {
        tag = document.createElement('div')
        tag.className = 'fire-tag'
        tag.textContent = skills[i].name
        this.labels.append(tag)
        this.fired.set(i, tag)
      }
      const at = this.worldOf(i, 0.2).project(this.camera)
      tag.hidden = at.z > 1
      tag.style.left = `${((at.x + 1) / 2) * w}px`
      tag.style.top = `${((1 - at.y) / 2) * h}px`
      tag.style.opacity = String(Math.min(1, g * 1.4))
    }
    for (const [i, tag] of this.fired) {
      if (shown.has(i)) continue
      tag.remove()
      this.fired.delete(i)
    }
  },

  // ---- Camera ---------------------------------------------------------------

  /**
   * Moves the camera to `position` looking at `target` over `ms` (animated in
   * draw). With an `anchor` planet both are relative to it, so the flight ends
   * on the planet wherever its orbit has taken it, and the camera then follows it.
   */
  flyTo(position, target, ms = FLY_MS, anchor = -1) {
    const origin = anchor >= 0 ? this.planets[anchor].group.position.clone() : new THREE.Vector3()
    this.following = -1
    this.flight = {
      from: this.camera.position.clone(),
      look: this.controls.target.clone(),
      to: position.clone().sub(origin),
      lookTo: target.clone().sub(origin),
      anchor,
      at: performance.now(),
      ms,
    }
  },
  flyStep() {
    const f = this.flight
    if (!f) return
    const origin = f.anchor >= 0 ? this.planets[f.anchor].group.position : new THREE.Vector3()
    const t = f.ms > 0 ? Math.min(1, (performance.now() - f.at) / f.ms) : 1
    const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    this.camera.position.lerpVectors(f.from, f.to.clone().add(origin), ease)
    this.controls.target.lerpVectors(f.look, f.lookTo.clone().add(origin), ease)
    if (t < 1) return
    this.flight = undefined
    if (f.anchor >= 0) {
      this.following = f.anchor
      this.followedAt = origin.clone()
      actions.followed(f.anchor)
    }
  },
  /** Keeps a followed planet in view: the camera moves as far as the planet did since the last frame. */
  followStep() {
    if (this.following < 0 || this.flight) return
    const now = this.planets[this.following].group.position
    const moved = now.clone().sub(this.followedAt)
    this.camera.position.add(moved)
    this.controls.target.add(moved)
    this.followedAt.copy(now)
  },
  /** The camera over a planet: in front of it, a few radii out; then it follows the planet. */
  flyToPlanet(a, distance = 4) {
    const planet = this.planets[a]
    const centre = planet.group.position.clone()
    const away = this.camera.position.clone().sub(centre).normalize()
    this.flyTo(centre.clone().add(away.multiplyScalar(RADIUS * planet.scale * distance)), centre, FLY_MS, a)
  },
  /** The camera facing a skill on its planet, following the planet. */
  focus(i) {
    const a = skills[i].agent
    const planet = this.planets[a]
    const centre = planet.group.position.clone()
    const out = this.worldOf(i).sub(centre).normalize()
    this.flyTo(centre.clone().add(out.multiplyScalar(RADIUS * planet.scale * 3.4)), centre, FLY_MS, a)
  },
  fly(i) {
    this.focus(i)
  },
  focusRegion(r) {
    const region = regions[r]
    const planet = this.planets[region.agent]
    const c = planet.globe.getCoords(deg(region.lat), deg(region.lon), 0)
    const centre = planet.group.position.clone()
    const out = planet.group
      .localToWorld(new THREE.Vector3(c.x, c.y, c.z))
      .sub(centre)
      .normalize()
    this.flyTo(centre.clone().add(out.multiplyScalar(RADIUS * planet.scale * (2.6 + region.cap))), centre, FLY_MS, region.agent)
  },
  /** The whole system in view, from above the orbits' plane so the orbits read as rings. */
  fit(ms = FLY_MS) {
    const reach = Math.max(STAR * 2, ...this.planets.map(planet => planet.orbit + RADIUS * planet.scale))
    const aspect = this.el.clientWidth / Math.max(1, this.el.clientHeight)
    const tan = Math.tan((this.camera.fov * Math.PI) / 360)
    const distance = Math.max(reach / (tan * aspect), (reach * 0.8) / tan) * 1.08
    this.flyTo(new THREE.Vector3(0, distance * 0.62, distance * 0.78), new THREE.Vector3(0, 0, 0), ms)
  },
  showAgent(agent) {
    // A card left over from the last pointer position would describe where the camera was.
    this.tip.hidden = true
    if (agent === 'all') this.fit()
    else this.flyToPlanet(agent)
  },

  // ---- Pointer --------------------------------------------------------------

  /** What is under the pointer: a skill (its index) and the planet it is on. */
  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects([this.star.core, ...this.planets.map(planet => planet.group)], true)
    for (const hit of hits) {
      if (hit.object === this.star.core) return { i: -1, planet: -1, isStar: true }
      let object = hit.object
      let planet = -1
      let point
      while (object) {
        if (object.__globeObjType === 'point' && object.__data) point = object.__data
        const found = this.planets.findIndex(p => p.group === object)
        if (found >= 0) planet = found
        object = object.parent
      }
      if (point) return { i: point.i, planet }
      if (planet >= 0 && hit.object.type === 'Mesh') return { i: -1, planet }
    }
    return { i: -1, planet: -1 }
  },

  bindPointer() {
    const canvas = this.renderer.domElement
    let down
    canvas.addEventListener('pointermove', event => {
      const hit = this.pick(event)
      if (hit.i !== this.hovered.i) {
        state.hover = hit.i
        actions.refresh()
      }
      this.hovered = hit
      canvas.style.cursor = hit.i >= 0 || hit.planet >= 0 || hit.isStar ? 'pointer' : 'grab'
      this.tip.hidden = hit.i < 0 && hit.planet < 0 && !hit.isStar
      if (!this.tip.hidden) {
        this.tip.innerHTML = hit.i >= 0 ? tooltip(hit.i) : hit.isStar ? starTip() : planetTip.call(this, hit.planet)
        // Beside the pointer, flipped to its other side near the canvas's right or bottom edge.
        const rect = this.el.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        const { offsetWidth: w, offsetHeight: h } = this.tip
        this.tip.style.left = `${x + 14 + w > rect.width ? Math.max(4, x - 14 - w) : x + 14}px`
        this.tip.style.top = `${y + 14 + h > rect.height ? Math.max(4, y - 14 - h) : y + 14}px`
      }
    })
    // A double-click on empty space goes back to every planet.
    canvas.addEventListener('dblclick', event => {
      const hit = this.pick(event)
      if (hit.i < 0 && hit.planet < 0) actions.showAll()
    })
    canvas.addEventListener('pointerleave', () => {
      this.hovered = { i: -1, planet: -1 }
      this.tip.hidden = true
      if (state.hover >= 0) {
        state.hover = -1
        actions.refresh()
      }
    })
    canvas.addEventListener('pointerdown', event => {
      down = { x: event.clientX, y: event.clientY }
      // Taking the camera mid-flight ends the flight, but keeps following its planet.
      const f = this.flight
      this.flight = undefined
      if (f?.anchor >= 0) {
        this.following = f.anchor
        this.followedAt = this.planets[f.anchor].group.position.clone()
      }
    })
    canvas.addEventListener('click', event => {
      // A drag that ends over a skill is not a click on it.
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return
      const hit = this.pick(event)
      if (hit.i >= 0) actions.select(hit.i, true)
      else if (hit.planet >= 0) this.flyToPlanet(hit.planet)
      else if (hit.isStar) actions.showAll()
    })
  },

  // ---- The view interface ---------------------------------------------------

  refresh() {
    for (const planet of this.planets) planet.refresh()
  },
  resize() {
    const { clientWidth: w, clientHeight: h } = this.el
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    for (const planet of this.planets) planet.globe.rendererSize(new THREE.Vector2(w, h))
  },
  /** Frees every geometry, texture and the WebGL context; init builds it all again. */
  destroy() {
    this.isDestroyed = true
    this.scene.traverse(object => {
      object.geometry?.dispose()
      for (const material of [object.material].flat()) material?.dispose()
    })
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.el.replaceChildren()
    Object.assign(this, { scene: undefined, planets: undefined, renderer: undefined, flight: undefined, following: -1 })
  },
  pause() {
    this.isActive = false
  },
  resume() {
    this.isActive = true
    this.clock.getDelta()
  },
}
