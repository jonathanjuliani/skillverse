// The shell: the top bar (view, search), the cards or the phone's
// bottom sheet, selection, and which view is drawing.

import { renderAgentsCard } from './agents.js'
import { CDN, isNarrow, loadScript } from './lib.js'
import { clearLive, connect, live, liveHooks, renderFeed, simulate, tickLive } from './live.js'
import { agents, skills, summary } from './model.js'
import { renderPanel } from './panel.js'
import { actions, state } from './state.js'
import { graph2dView } from './views/graph2d.js'
import { graph3dView } from './views/graph3d.js'
import { orbitView } from './views/orbit.js'

const views = { orbit: orbitView, '3d': graph3dView, '2d': graph2dView }
const HINTS = {
  orbit: 'drag to orbit · scroll to zoom · click a planet to follow it · click the star for everything',
  '3d': 'drag to orbit · scroll to zoom · click a skill',
  '2d': 'drag to pan · scroll to zoom · click a skill',
}
/** Remembered per browser: folded cards and Follow activity. Storage may be off; the page works without it. */
const PREFS_KEY = 'skillverse.prefs'
const $ = id => document.getElementById(id)

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
  } catch {
    return null
  }
}
function writePrefs(value) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(value))
  } catch {
    // Storage is off (a private window): folding just is not remembered.
  }
}

// ---- Views ----------------------------------------------------------------

const current = () => views[state.view]

async function show(view) {
  state.view = view
  for (const button of document.querySelectorAll('#views button')) button.setAttribute('aria-pressed', String(button.dataset.view === view))
  $('hint').textContent = HINTS[view]
  for (const [name, v] of Object.entries(views)) {
    $(`view-${name}`).classList.toggle('active', name === view)
    // A view out of sight is freed (its WebGL context, geometry and loop), not kept paused.
    if (name !== view && v.ready) {
      v.destroy()
      v.ready = false
    }
  }
  const v = current()
  if (!v.ready) {
    $('loading').classList.add('on')
    try {
      await v.init($(`view-${view}`))
      v.ready = true
    } catch (error) {
      $('loading').textContent = `${error.message}. This view loads its library from the internet.`
      return
    }
    $('loading').classList.remove('on')
  }
  v.resume()
  v.resize()
  v.refresh()
  if (state.selected >= 0) v.focus(state.selected)
  else v.showAgent?.(state.agent)
  if (state.selected < 0) renderPanel()
}

actions.refresh = () => {
  const v = current()
  if (v.ready) v.refresh()
}

actions.select = (i, isFocused = false, isBack = false) => {
  if (!isBack && state.selected >= 0 && state.selected !== i) state.history.push(state.selected)
  state.selected = i
  if (i >= 0 && state.agent !== 'all' && skills[i].agent !== state.agent) setAgent(skills[i].agent)
  const hadReader = document.body.classList.contains('has-selection')
  renderPanel()
  // On wide screens the reader opening or closing resizes the canvas beside it.
  if (hadReader !== i >= 0 && current().ready) current().resize()
  actions.refresh()
  if (i >= 0) openSheet('reader')
  const v = current()
  if (isFocused && v.ready && i >= 0) v.focus(i)
  // Nothing selected: back to the whole of what is shown.
  if (i < 0 && v.ready) v.showAgent?.(state.agent)
}

// ---- Agents ---------------------------------------------------------------

/**
 * Opens an agent in the Agents card (or none: 'all'). `isFlying` moves the
 * camera there too; it is false when the view itself started following it.
 */
function setAgent(agent, isFlying = true) {
  state.agent = agent
  renderAgentsCard()
  const v = current()
  if (isFlying && v.ready) v.showAgent?.(agent)
}

/** The orbit view started following a planet (a click on it): open its agent without flying again. */
actions.followed = a => {
  if (state.agent !== a) setAgent(a, false)
}

// ---- Cards and the phone sheet --------------------------------------------

/** Folds or unfolds a card (Live, Agents); remembered only when the person did it. */
function foldCard(id, isFolded, isRemembered = false) {
  const card = $(id)
  card.classList.toggle('collapsed', isFolded)
  card.querySelector('[data-collapse]').setAttribute('aria-expanded', String(!isFolded))
  if (isRemembered) writePrefs({ ...(readPrefs() ?? {}), [id]: isFolded })
}

/** Cards start folded (the canvas comes first) unless the person unfolded them before. */
function setupCards() {
  const folded = { live: true, agents: true, ...(readPrefs() ?? {}) }
  for (const button of document.querySelectorAll('[data-collapse]')) {
    const id = button.dataset.collapse
    foldCard(id, Boolean(folded[id]))
    button.addEventListener('click', () => foldCard(id, !$(id).classList.contains('collapsed'), true))
  }
}

/** On a phone: shows one panel in the sheet and opens it; elsewhere nothing to do (the cards are always there). */
function openSheet(tab) {
  const sheet = $('sheet')
  sheet.dataset.tab = tab
  for (const button of document.querySelectorAll('.sheet-tabs [role="tab"]'))
    button.setAttribute('aria-selected', String(button.dataset.tab === tab))
  setSheetOpen(true)
}

function setSheetOpen(isOpen) {
  if (!isNarrow()) return
  $('sheet').classList.toggle('open', isOpen)
  $('sheet-toggle').setAttribute('aria-expanded', String(isOpen))
  $('sheet-toggle').setAttribute('aria-label', isOpen ? 'Collapse' : 'Expand')
  document.body.classList.toggle('sheet-open', isOpen)
  const v = current()
  if (v.ready) v.resize()
}

function setupSheet() {
  for (const button of document.querySelectorAll('.sheet-tabs [role="tab"]')) {
    button.addEventListener('click', () => {
      const sheet = $('sheet')
      if (sheet.dataset.tab === button.dataset.tab && sheet.classList.contains('open')) setSheetOpen(false)
      else openSheet(button.dataset.tab)
    })
  }
  $('sheet-toggle').addEventListener('click', () => setSheetOpen(!$('sheet').classList.contains('open')))
}

// ---- Search ---------------------------------------------------------------

function setupSearch() {
  const search = $('search')
  const setQuery = text => {
    const q = text.trim().toLowerCase()
    const pool = skills.filter(skill => state.agent === 'all' || skill.agent === state.agent)
    state.matches = new Set(
      q ? pool.filter(s => s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).map(s => s.i) : [],
    )
    $('search-count').textContent = q ? String(state.matches.size) : ''
    actions.refresh()
  }
  search.addEventListener('input', () => setQuery(search.value))
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter' && state.matches.size) actions.select([...state.matches][0], true)
    if (event.key === 'Escape') {
      search.value = ''
      setQuery('')
      closeSearch()
    }
  })
  const bar = document.querySelector('.bar')
  const closeSearch = () => {
    bar.classList.remove('searching')
    $('search-toggle').setAttribute('aria-expanded', 'false')
  }
  $('search-toggle').addEventListener('click', () => {
    const isOpen = !bar.classList.contains('searching')
    bar.classList.toggle('searching', isOpen)
    $('search-toggle').setAttribute('aria-expanded', String(isOpen))
    if (isOpen) search.focus()
  })
}

// ---- Live -----------------------------------------------------------------

liveHooks.fired = (i, from, session) => {
  // The first real activity opens Live, unless the person folded it themselves.
  if (session !== 'simulate' && readPrefs()?.live === undefined) foldCard('live', false)
  const v = current()
  if (from !== undefined && v.ready && v.comet) v.comet(from, i)
  const now = Date.now()
  const isShown = state.agent === 'all' || state.agent === skills[i].agent
  if (live.isFollowing && isShown && now - live.lastUserMove > 5000 && state.selected < 0 && v.ready && v.fly) {
    live.lastFly = now
    v.fly(i)
  }
}

/** Reloads (new skills, or a changed page) keeping what is on screen: the view, the agent and the selected skill. */
liveHooks.reload = () => {
  const params = new URLSearchParams()
  if (state.selected >= 0) params.set('skill', skills[state.selected].id)
  if (state.view !== 'orbit') params.set('view', state.view)
  if (state.agent !== 'all' && agents[state.agent]) params.set('agent', agents[state.agent].id)
  const query = params.toString()
  location.replace(`${location.pathname}${query ? `?${query}` : ''}`)
}

function setupLive() {
  $('live-demo').addEventListener('click', simulate)
  $('live-clear').addEventListener('click', clearLive)
  $('live-session').addEventListener('change', event => {
    live.only = event.currentTarget.value
    clearLive()
  })
  // Follow activity: on by default; the choice is remembered in this browser.
  const follow = $('live-follow')
  const setFollowing = isOn => {
    live.isFollowing = isOn
    follow.setAttribute('aria-pressed', String(isOn))
  }
  setFollowing(readPrefs()?.follow !== false)
  follow.addEventListener('click', () => {
    setFollowing(!live.isFollowing)
    writePrefs({ ...(readPrefs() ?? {}), follow: live.isFollowing })
  })
  const moved = () => {
    live.lastUserMove = Date.now()
  }
  $('stage').addEventListener('pointerdown', moved)
  $('stage').addEventListener('wheel', moved, { passive: true })
  renderFeed(false)
  connect()
  tickLive()
}

// ---- Clicks anywhere: skills, agents, groups, reader actions ---------------

document.addEventListener('click', event => {
  const target = event.target.closest('[data-skill],[data-region],[data-agent],#copy,#back,#clear')
  if (!target) return
  if (target.dataset.agent) {
    // A second click on the open agent closes it and frames everything again.
    const a = Number(target.dataset.agent)
    setAgent(state.agent === a ? 'all' : a)
  } else if (target.dataset.skill) actions.select(Number(target.dataset.skill), true)
  else if (target.dataset.region) {
    const v = current()
    if (v.ready) v.focusRegion(Number(target.dataset.region))
    if (isNarrow()) setSheetOpen(false)
  } else if (target.id === 'copy') {
    navigator.clipboard?.writeText(`/${skills[state.selected].id.split('/').pop()} `)
    target.textContent = 'Copied'
  } else if (target.id === 'back') {
    const previous = state.history.pop()
    if (previous !== undefined) actions.select(previous, true, true)
  } else if (target.id === 'clear') {
    state.history = []
    actions.select(-1)
    setSheetOpen(false)
  }
})

document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault()
    if (isNarrow()) $('search-toggle').click()
    else $('search').focus()
  }
  if (event.key === 'Escape' && state.selected >= 0 && document.activeElement?.tagName !== 'INPUT') actions.select(-1)
})

window.addEventListener('resize', () => {
  const v = current()
  if (v.ready) v.resize()
})

for (const button of document.querySelectorAll('#views button')) button.addEventListener('click', () => show(button.dataset.view))

$('fit').addEventListener('click', () => {
  const v = current()
  if (!v.ready) return
  if (state.selected >= 0) v.focus(state.selected)
  else v.fit()
})

// Skip to agents: unfold the card and move focus there.
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault()
  foldCard('agents', false)
  if (isNarrow()) openSheet('agents')
  $('legend').querySelector('button')?.focus()
})

// ---- Start ----------------------------------------------------------------

$('stats').textContent = summary
renderAgentsCard()
setupCards()
setupSheet()
setupSearch()
setupLive()
setAgent(state.agent)
Promise.all([loadScript(CDN.marked), loadScript(CDN.purify)])
  .catch(error => console.warn('Skillverse: SKILL.md shows as plain text', error))
  .finally(renderPanel)
const params = new URLSearchParams(location.search)
const wantedAgent = agents.findIndex(agent => agent.id === params.get('agent'))
if (wantedAgent >= 0) state.agent = wantedAgent
const wanted = params.get('skill')
show(views[params.get('view')] ? params.get('view') : 'orbit').then(() => {
  const i = wanted ? skills.findIndex(skill => skill.id === wanted) : -1
  if (i >= 0) actions.select(i, true)
})
