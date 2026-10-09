// Live activity: skills firing in your agents' sessions, the paths between
// them, the feed, and the simulator. Events arrive over a stream from the
// Skillverse server: the last few as history (counted, not animated), then
// each one as it happens.

import { escapeHtml } from './lib.js'
import { colorOf, findSkill, LIVE_AGENT, neighbours, skills } from './model.js'
import { actions } from './state.js'

export const GLOW_MS = 7000
export const COMET_MS = 7500
export const TRAIL_MS = 90000
const FEED_LIMIT = 60

export const live = {
  glow: new Map(), // skill index -> { at, isBranch }
  heat: new Map(), // skill index -> loads seen
  paths: [], // { from, to, at, isBranch }
  last: new Map(), // `${session}|${turn}|${agent}` -> last skill index loaded there
  agents: new Map(), // `${session}|${agent}` -> { parent, type, turn }
  sessions: new Map(), // session id -> project folder name
  only: '', // one session's activity, or '' for all
  feed: [],
  isFollowing: true,
  lastUserMove: 0,
  lastFly: 0,
  isConnected: false,
}

/** Called with each skill that fires (and the one before it on its path), to animate the view. */
export const liveHooks = { fired: (_i, _from, _session) => {}, changed: () => {}, reload: () => location.reload() }

export const glowOf = i => {
  const g = live.glow.get(i)
  if (!g) return 0
  const age = (Date.now() - g.at) / GLOW_MS
  return age >= 1 ? 0 : 1 - age
}
export const heatOf = i => live.heat.get(i) || 0

/** The live paths as arcs: a comet while fresh, then a fading trail. */
/**
 * The live paths as arcs: a comet while fresh, then a fading trail. The same
 * objects every time, so a globe redraw keeps their geometry instead of
 * building it again four times a second.
 */
const arcsOf = new WeakMap()
export function liveArcs() {
  const now = Date.now()
  return live.paths.flatMap(p => {
    if (!arcsOf.has(p)) arcsOf.set(p, { comet: { ...p, live: 'comet' }, trail: { ...p, live: 'trail' } })
    const { comet, trail } = arcsOf.get(p)
    const age = now - p.at
    if (age < COMET_MS) return [comet, trail]
    return age < TRAIL_MS ? [trail] : []
  })
}

export function liveRings() {
  return [...live.glow.entries()]
    .filter(([i]) => glowOf(i) > 0)
    .map(([i, g]) => ({ i, isBranch: g.isBranch, strength: 0.4 + 0.6 * glowOf(i) }))
}

/** Takes one event in; `isHistory` marks events from before the page opened (counted, not animated). */
export function ingest(event, isHistory = false) {
  const session = event.session || 'local'
  if (!live.sessions.has(session)) {
    live.sessions.set(session, event.project || session)
    renderSessions()
  }
  if (live.only && live.only !== session) return
  if (event.kind === 'turn') {
    if (!isHistory && live.feed.length && live.feed[0].kind !== 'turn') addFeed({ kind: 'turn', turn: event.turn })
    return
  }
  if (event.kind === 'agent') {
    live.agents.set(`${session}|${event.agent}`, { parent: event.parent || 'main', type: event.agentType || 'agent', turn: event.turn })
    if (!isHistory) addFeed({ kind: 'agent', agent: event.agent, type: event.agentType, session })
    return
  }
  if (event.kind !== 'skill') return

  const i = findSkill(event.skill, event.source)
  const agent = event.agent || 'main'
  const track = `${session}|${event.turn}|${agent}`
  let from = live.last.get(track)
  let isBranch = false
  if (from === undefined && agent !== 'main') {
    const parent = live.agents.get(`${session}|${agent}`)
    if (parent) {
      from = live.last.get(`${session}|${parent.turn}|${parent.parent}`)
      isBranch = true
    }
  }
  if (i < 0) {
    // Named the way the planets' ids are: with the agent's prefix, unless it is Claude Code's.
    const name = event.source && event.source !== 'claude' ? `${event.source}/${event.skill}` : event.skill
    if (!isHistory) addFeed({ kind: 'skill', name, i: -1, from, agent, session })
    return
  }
  live.heat.set(i, heatOf(i) + 1)
  live.last.set(track, i)
  if (isHistory) return

  const now = Date.now()
  live.glow.set(i, { at: now, isBranch: agent !== 'main' })
  if (from !== undefined && from !== i) live.paths.push({ from, to: i, at: now, isBranch })
  addFeed({ kind: 'skill', name: skills[i].id, i, from, agent, session })
  liveHooks.fired(i, from, session)
  actions.refresh()
}

/** Clears the trails, glows and feed (Clear, or a different session picked). */
export function clearLive() {
  live.paths = []
  live.feed = []
  live.glow = new Map()
  renderFeed(false)
  actions.refresh()
}

const SESSION_COLORS = ['#7dd3fc', '#fca5a5', '#86efac', '#fcd34d', '#c4b5fd', '#f9a8d4', '#5eead4', '#fdba74']
function sessionColor(id) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return SESSION_COLORS[hash % SESSION_COLORS.length]
}

function renderSessions() {
  const select = document.getElementById('live-session')
  select.innerHTML =
    `<option value="">All sessions (${live.sessions.size})</option>` +
    [...live.sessions]
      .map(([id, project]) => `<option value="${escapeHtml(id)}">${escapeHtml(project)} · ${escapeHtml(id)}</option>`)
      .join('')
  select.value = live.only
  select.hidden = live.sessions.size < 2
}

function addFeed(entry) {
  live.feed.unshift({ ...entry, at: new Date() })
  live.feed = live.feed.slice(0, FEED_LIMIT)
  renderFeed(true)
}

/** Redraws the feed and the live status (the pill and the panel header). */
export function renderFeed(isNew) {
  const time = d => d.toTimeString().slice(0, 8)
  const sessionBadge = e => {
    if (live.sessions.size < 2 || !e.session) return ''
    return `<span class="session" style="background:${sessionColor(e.session)}" title="session ${escapeHtml(e.session)}">${escapeHtml(live.sessions.get(e.session) || e.session)}</span>`
  }
  const agentBadge = e => {
    if (!e.agent || e.agent === 'main') return ''
    const info = live.agents.get(`${e.session}|${e.agent}`)
    return `<span class="subagent">${escapeHtml(info?.type || 'subagent')}</span>`
  }
  const rows = live.feed.map((e, k) => {
    const flash = isNew && k === 0 ? ' new' : ''
    if (e.kind === 'turn') return `<li class="ev turn${flash}">new turn</li>`
    if (e.kind === 'agent')
      return `<li class="ev${flash}"><span class="t">${time(e.at)}</span>${sessionBadge(e)}<span class="subagent">${escapeHtml(e.type || 'subagent')}</span><span class="from">subagent started</span></li>`
    const color = e.i >= 0 ? colorOf(e.i) : '#6b7280'
    const from = e.from !== undefined && e.from >= 0 ? `<span class="from">← ${escapeHtml(skills[e.from].name)}</span>` : ''
    const name =
      e.i >= 0
        ? `<button class="name" data-skill="${e.i}">${escapeHtml(e.name)}</button>`
        : `<span class="name">${escapeHtml(e.name)}</span>`
    return `<li class="ev${flash}"><span class="t">${time(e.at)}</span>${sessionBadge(e)}${agentBadge(e)}<span class="dot" style="background:${color}"></span>${name}${from}</li>`
  })
  const empty = live.isConnected
    ? 'Skills light up here as your agents load them: Claude Code with the Skillverse plugin, the others after skillverse setup.'
    : 'Not connected to the Skillverse server: live activity needs it running (skillverse run).'
  document.getElementById('feed').innerHTML = rows.join('') || `<li class="ev turn">${empty} Simulate shows the effect.</li>`
  const used = live.heat.size
  const status = live.isConnected ? `${used} skill${used === 1 ? '' : 's'} used` : 'not connected'
  for (const el of document.querySelectorAll('[data-live-status]')) el.textContent = status
  document.body.classList.toggle('is-live', live.isConnected)
  liveHooks.changed()
}

export function connect() {
  if (!window.EventSource) return
  const stream = new EventSource('events/stream')
  stream.onopen = () => {
    live.isConnected = true
    renderFeed(false)
  }
  stream.onmessage = message => {
    let event
    try {
      event = JSON.parse(message.data)
    } catch (error) {
      console.warn('Skillverse: skipped an event that is not JSON', error)
      return
    }
    ingest(event, Boolean(event.history))
    if (event.history) renderFeed(false)
  }
  // The server asks for a reload when the skills were scanned again, or a file of the page changed (dev).
  stream.addEventListener('reload', () => liveHooks.reload())
  stream.onerror = () => {
    // EventSource reconnects by itself; say so meanwhile.
    live.isConnected = false
    renderFeed(false)
  }
}

/** A made-up chain of skills along real links, with a subagent branch, to show the effect. */
export function simulate() {
  const linked = skills.filter(skill => skill.agent === LIVE_AGENT && neighbours[skill.i].size >= 2).map(skill => skill.i)
  if (!linked.length) return
  let current = linked[Math.floor(Math.random() * linked.length)]
  const turn = 1e6 + Math.floor(Math.random() * 1e6)
  const steps = [current]
  for (let k = 0; k < 4; k++) {
    const next = [...neighbours[current]].filter(n => !steps.includes(n) && skills[n].agent === LIVE_AGENT)
    if (!next.length) break
    current = next[Math.floor(Math.random() * next.length)]
    steps.push(current)
  }
  const base = { turn, session: 'simulate', project: 'simulate' }
  let delay = 0
  ingest({ kind: 'turn', ...base })
  for (const [k, i] of steps.entries()) {
    delay += 1100
    setTimeout(() => ingest({ kind: 'skill', skill: skills[i].id, agent: 'main', ...base }), delay)
    if (k !== 1) continue
    const branch = [...neighbours[i]].find(n => !steps.includes(n) && skills[n].agent === LIVE_AGENT)
    if (branch === undefined) continue
    setTimeout(() => ingest({ kind: 'agent', agent: 'sim-agent', parent: 'main', agentType: 'Explore', ...base }), delay + 300)
    setTimeout(() => ingest({ kind: 'skill', skill: skills[branch].id, agent: 'sim-agent', ...base }), delay + 700)
  }
}

/** Keeps glows fading and comets moving between events, and forgets old trails. */
export function tickLive() {
  setInterval(() => {
    const now = Date.now()
    const isBusy = [...live.glow.values()].some(g => now - g.at < GLOW_MS + 500) || live.paths.some(p => now - p.at < COMET_MS + 500)
    if (isBusy) actions.refresh()
    live.paths = live.paths.filter(p => now - p.at < TRAIL_MS)
  }, 250)
}
