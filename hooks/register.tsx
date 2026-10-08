import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { GraphProps, Region } from './layout'
import { layoutGlobe, layoutGraph } from './layout'
import type { Skill } from './skills'
import { assignRegions, joinPath, linkSkills, parseSkillFile, splitId } from './skills'
import type { Family } from './tree'
import { byRoot, familiesOf, trimPrefix } from './tree'
import { buildWebData } from './web'

const PANE_ID = 'skillverse'
const BODY_LIMIT = 6000
const LINK_LIMIT = 24
const MATCH_LIMIT = 24
const WEB_PORTS = [4317, 4318, 4319, 4320]

const PANE_DESCRIPTION = 'Browse every skill this session has: grouped tree, links, context cost, web view'
const TERMINAL_DESCRIPTION = 'Open Skillverse full screen in a terminal (the Terminal panel in the desktop app)'
const COMMANDS = [
  ['skillverse', PANE_DESCRIPTION],
  ['sv', `${PANE_DESCRIPTION} (short for /skillverse)`],
  ['skillverse-it', TERMINAL_DESCRIPTION],
  ['sv-it', `${TERMINAL_DESCRIPTION} (short for /skillverse-it)`],
] as const

/** The ports to look for the web view on: SKILLVERSE_PORT alone when set, else WEB_PORTS. */
async function webPorts($: EngineInterface): Promise<number[]> {
  const chosen = Number((await $.env.get('SKILLVERSE_PORT')) ?? '')
  return Number.isInteger(chosen) && chosen > 0 && chosen < 65536 ? [chosen] : WEB_PORTS
}

const web = atom({ plugin: 'skillverse', key: 'web' } as const, '')
const selected = atom({ plugin: 'skillverse', key: 'selected' } as const, null as string | null)
const expanded = atom({ plugin: 'skillverse', key: 'expanded' } as const, [] as string[])
const closedCategories = atom({ plugin: 'skillverse', key: 'closed' } as const, [] as string[])
const query = atom({ plugin: 'skillverse', key: 'query' } as const, '')
const indexedAt = atom({ plugin: 'skillverse', key: 'indexedAt' } as const, 0)
const history = atom({ plugin: 'skillverse', key: 'history' } as const, [] as string[])
const statsAt = atom({ plugin: 'skillverse', key: 'statsAt' } as const, 0)

type Listed = { id: string; name: string; plugin?: string; source: string }

const READ_BATCH = 16

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Runs a step whose failure has a fallback (a folder that may not exist, a
 * port nobody serves): on failure it writes `what` and the error to the debug
 * log and returns undefined, so the caller falls back without hiding why.
 */
/** A failed hook's reason, for the message its .catch shows. */
const failureOf = (failure: { kind: string; message?: string }) => failure.message ?? failure.kind

async function safe<T>($: EngineInterface, what: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch (error) {
    $.ui.log(`skillverse: could not ${what}: ${describe(error)}`, { to: 'debug' })
    return undefined
  }
}

type Index = {
  skills: Skill[]
  byId: Map<string, Skill>
  position: Map<string, number>
  regions: Region[]
  regionOf: Map<string, Region>
  incoming: Map<string, string[]>
  graph: GraphProps
  globe: GraphProps
}

let index: Index | undefined
let indexing: Promise<void> | undefined

async function listedSkills($: EngineInterface): Promise<Listed[]> {
  const usage = await safe($, 'read the skill listing', () => $.session.usage({ breakdown: 'summary' }))
  const rows = usage?.context.breakdown?.skills?.skillFrontmatter ?? []

  return rows.map(row => {
    const id = row.name.includes(':') || !row.pluginName ? row.name : `${row.pluginName}:${row.name}`
    const parts = splitId(id)

    return { id, name: parts.name, plugin: row.pluginName ?? parts.plugin, source: row.source }
  })
}

async function readJson(path: string, $: EngineInterface): Promise<unknown> {
  const text = await safe($, `read ${path}`, () => $.fs.read(path))
  if (typeof text !== 'string') {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    $.ui.log(`skillverse: could not parse ${path}: ${describe(error)}`, { to: 'debug' })
    return undefined
  }
}

async function pluginDirs($: EngineInterface, home: string, wanted: Set<string>): Promise<Map<string, string>> {
  const dirs = new Map<string, string>()
  const installed = (await readJson(`${home}/.claude/plugins/installed_plugins.json`, $)) as
    | { plugins?: Record<string, { installPath?: string }[]> }
    | undefined
  for (const [key, installs] of Object.entries(installed?.plugins ?? {})) {
    const name = key.split('@')[0] ?? key
    const path = installs[0]?.installPath
    if (wanted.has(name) && path && !dirs.has(name)) {
      dirs.set(name, path)
    }
  }

  const marketsDir = `${home}/.claude/plugins/marketplaces`
  for (const market of (await safe($, 'list the marketplaces', () => $.fs.list(marketsDir))) ?? []) {
    const root = `${marketsDir}/${market.name}`
    const manifest = (await readJson(`${root}/.claude-plugin/marketplace.json`, $)) as
      | { plugins?: { name?: string; source?: unknown }[] }
      | undefined
    for (const plugin of manifest?.plugins ?? []) {
      if (plugin.name && wanted.has(plugin.name) && !dirs.has(plugin.name) && typeof plugin.source === 'string') {
        dirs.set(plugin.name, joinPath(root, plugin.source))
      }
    }
  }

  return dirs
}

/**
 * Finds the skills this session has: the engine's skill listing when it has
 * one, plus every skill folder under the user's and the project's skills and
 * under the plugins the listing names; each with its SKILL.md read.
 */
async function discoverSkills($: EngineInterface): Promise<Skill[]> {
  const home = (await safe($, 'read HOME', () => $.env.get('HOME'))) ?? ''
  const listed = await listedSkills($)
  const commands = new Map(((await safe($, 'list the commands', () => $.command.list())) ?? []).map(command => [command.name, command]))

  const files = new Map<string, { path: string; source: string }>()
  const add = (id: string, path: string, source: string) => {
    if (!files.has(id)) {
      files.set(id, { path, source })
    }
  }
  // Each folder under `root` holding a SKILL.md is a skill; a folder without
  // one is a category, and its own folders are looked at once more.
  const scan = async (root: string, source: string, plugin?: string, depth = 0) => {
    for (const entry of (await safe($, `list ${root}`, () => $.fs.list(root))) ?? []) {
      if (entry.name.startsWith('.') || entry.kind === 'file') {
        continue
      }
      const path = `${root}/${entry.name}/SKILL.md`
      if (await safe($, `check ${path}`, () => $.fs.exists(path))) {
        add(plugin ? `${plugin}:${entry.name}` : entry.name, path, source)
      } else if (depth === 0) {
        await scan(`${root}/${entry.name}`, source, plugin, depth + 1)
      }
    }
  }
  await scan('.claude/skills', 'projectSettings')
  if (home) {
    await scan(`${home}/.claude/skills`, 'userSettings')
  }
  const wanted = new Set(listed.flatMap(skill => (skill.plugin ? [skill.plugin] : [])))
  for (const [plugin, dir] of await pluginDirs($, home, wanted)) {
    const manifest = (await readJson(`${dir}/.claude-plugin/plugin.json`, $)) as { skills?: unknown } | undefined
    const declared = typeof manifest?.skills === 'string' ? [manifest.skills] : Array.isArray(manifest?.skills) ? manifest.skills : []
    for (const rel of declared.filter((one): one is string => typeof one === 'string')) {
      const folder = joinPath(dir, rel).replace(/\/SKILL\.md$/, '')
      if (await safe($, `check ${folder}/SKILL.md`, () => $.fs.exists(`${folder}/SKILL.md`))) {
        add(`${plugin}:${folder.split('/').pop() ?? rel}`, `${folder}/SKILL.md`, 'plugin')
      } else {
        await scan(folder, 'plugin', plugin)
      }
    }
    await scan(`${dir}/skills`, 'plugin', plugin)
  }

  const all = new Map<string, Listed>(listed.map(skill => [skill.id, skill]))
  for (const [id, file] of files) {
    if (!all.has(id) && (listed.length === 0 || !splitId(id).plugin)) {
      all.set(id, { id, ...splitId(id), source: file.source })
    }
  }

  const entries = [...all.values()]
  const skills: Skill[] = []
  for (let i = 0; i < entries.length; i += READ_BATCH) {
    const batch = entries.slice(i, i + READ_BATCH)
    const read = await Promise.all(
      batch.map(async entry => {
        const path = files.get(entry.id)?.path
        const text = path ? await safe($, `read ${path}`, () => $.fs.read(path)) : undefined
        const parsed = typeof text === 'string' ? parseSkillFile(text) : { meta: {}, body: '' }
        const command = commands.get(entry.id) ?? commands.get(entry.name)
        const skill: Skill = {
          id: entry.id,
          name: entry.name,
          ...(entry.plugin ? { plugin: entry.plugin } : {}),
          source: entry.source,
          region: '',
          description: parsed.meta.description ?? command?.description ?? '',
          ...(typeof text === 'string' && path ? { path } : {}),
          body: parsed.body,
          links: [],
        }

        return skill
      }),
    )
    skills.push(...read)
  }

  assignRegions(skills)
  linkSkills(skills)

  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

function buildIndex(skills: Skill[]): Index {
  const { regions, graph } = layoutGraph(skills)
  const globe = layoutGlobe(skills, regions)
  const incoming = new Map<string, string[]>()
  for (const skill of skills) {
    for (const target of skill.links) {
      incoming.set(target, [...(incoming.get(target) ?? []), skill.id])
    }
  }

  return {
    skills,
    byId: new Map(skills.map(skill => [skill.id, skill])),
    position: new Map(skills.map((skill, i) => [skill.id, i])),
    regions,
    regionOf: new Map(regions.map(region => [region.label, region])),
    incoming,
    graph,
    globe,
  }
}

/**
 * Saves the session's skills where the terminal app (tui/skillverse.mjs) reads
 * them, so it shows exactly what this session has. Best effort.
 */
async function saveBrain($: EngineInterface, current: Index): Promise<void> {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    const dir = `${home}/.cache/skillverse`
    await $.process.run(['mkdir', '-p', dir])
    const data = buildWebData(current.skills, current.regions, current.graph, current.globe, new Date().toISOString())
    await $.fs.write(`${dir}/skillverse.json`, JSON.stringify(data))
  } catch (error) {
    // The terminal app falls back to scanning the disk.
    $.ui.log(`skillverse: could not save the skill list for the terminal app: ${describe(error)}`, { to: 'debug' })
  }
}

function startIndexing($: EngineInterface): void {
  if (index || indexing) {
    return
  }
  indexing = (async () => {
    try {
      index = buildIndex(await discoverSkills($))
      void saveBrain($, index)
    } catch (error) {
      $.ui.toast(`Skillverse could not index: ${String(error)}`)
    }
    await update($, indexedAt, n => n + 1)
  })().finally(() => {
    indexing = undefined
  })
}

let server: { port: number; url: string; isLive: boolean } | undefined

/**
 * One thing that happened, as the Skillverse server relays it to the web view:
 * a skill loaded, a subagent started, a tool ran, a turn began.
 */
type LiveEvent = {
  seq: number
  at: number
  turn: number
  kind: 'skill' | 'agent' | 'tool' | 'turn'
  /** The skill as the engine names it (`docs:write`). */
  skill?: string
  /** The loop it happened in: `main`, or a subagent's id. */
  agent: string
  /** For `agent`: the loop that started it, and its type. */
  parent?: string
  agentType?: string
  tool?: string
  /** Which session: a short id, and the folder it runs in. */
  session: string
  project: string
}

/** Events from before the server is up, sent when it starts; nothing is kept on disk. */
const PENDING_LIMIT = 50
let pending: LiveEvent[] = []
let liveSeq = 0
let liveTurn = 0
let liveSends: Promise<void> = Promise.resolve()
/** The loop whose Skill tool call is running, so its skill.prompt can be credited to it. */
let skillCaller: string | undefined
/** Whether skill.prompt fired during the running Skill tool call; when it did not, the call itself records the skill. */
let isSkillSeen = false
/** A skill typed as `/name` in the last prompt, recorded from the prompt; its skill.prompt, if it fires, is not counted again. */
let typedSkill: string | undefined

/**
 * Sends an event to the Skillverse server, which pushes it to every open web view.
 * Before the server runs, the last few wait in memory; sends run one at a time.
 */
let identity: { session: string; project: string } | undefined
/** When this session last looked for a Skillverse server it did not start, so it asks at most every few seconds. */
let lastLook = 0
const LOOK_EVERY_MS = 5000

async function whoAmI($: EngineInterface): Promise<{ session: string; project: string }> {
  if (!identity) {
    const id = (await safe($, 'read the session id', () => $.session.id())) ?? 'session'
    const cwd = (await safe($, 'read the session folder', () => $.session.cwd())) ?? ''
    identity = { session: id.slice(0, 8), project: cwd.split('/').filter(Boolean).pop() ?? 'session' }
  }

  return identity
}

/** A Skillverse server any session started, found by its /health answer; undefined when none runs. */
async function findServer($: EngineInterface): Promise<{ port: number; url: string; isLive: boolean } | undefined> {
  for (const port of await webPorts($)) {
    const url = `http://localhost:${port}/`
    const health = await safe($, `probe ${url}health`, () => $.http.fetch(`${url}health`))
    if (health?.ok && health.text.includes('"skillverse":true')) {
      return { port, url, isLive: true }
    }
  }

  return undefined
}

async function post($: EngineInterface, url: string, events: LiveEvent | LiveEvent[]): Promise<boolean> {
  const sent = await safe($, 'send live events', () =>
    $.http.fetch(`${url}events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(events) }),
  )

  return sent?.ok === true
}

/**
 * Sends an event to the Skillverse server, whichever session started it, which
 * pushes it to every open web view. With no server running, the last few wait
 * in memory and go out once one appears; sends run one at a time.
 */
function record($: EngineInterface, event: Omit<LiveEvent, 'seq' | 'at' | 'turn' | 'session' | 'project'>): void {
  liveSends = liveSends
    .then(async () => {
      const at = await $.clock.now()
      const entry: LiveEvent = { ...event, ...(await whoAmI($)), seq: ++liveSeq, at, turn: liveTurn }
      if (!server?.isLive && at - lastLook > LOOK_EVERY_MS) {
        lastLook = at
        server = (await findServer($)) ?? server
        // A web app started after this session: it gets the session's skills before the events.
        if (server?.isLive && index) {
          await sendSkills($, server.url, index)
        }
      }
      if (!server?.isLive) {
        pending = [...pending, entry].slice(-PENDING_LIMIT)
        return
      }
      const batch = [...pending, entry]
      if (await post($, server.url, batch)) {
        pending = []
      } else {
        // The server went away (its session ended): hold the events and look again later.
        pending = batch.slice(-PENDING_LIMIT)
        server = undefined
      }
    })
    .catch(error => {
      // Live events are a nicety: a failed send never touches the session.
      $.ui.log(`skillverse: could not record a live event: ${describe(error)}`, { to: 'debug' })
    })
}

/** What Open web view shows when the web app is not running: installed but stopped, or not installed. */
const WEB_STOPPED = 'stopped'
const WEB_MISSING = 'missing'
const WEB_INSTALL = 'npm install -g @jonathanjuliani/skillverse'

/**
 * Sends this session's exact skill list to the web app, in place of its own
 * scan of Claude Code; true when it took it.
 */
async function sendSkills($: EngineInterface, url: string, current: Index): Promise<boolean> {
  const data = buildWebData(current.skills, current.regions, current.graph, current.globe, new Date().toISOString())
  // What the pane shows, for the web app's agent card and reader: measured, not estimated.
  const measured = {
    ...(stats ? { baseline: stats.baseline } : {}),
    ...(stats?.listing ? { listing: { tokens: stats.listing.tokens, perSkill: stats.listing.perSkill } } : {}),
    uses: Object.fromEntries(uses),
    measuredAt: new Date().toISOString(),
  }
  const sent = await safe($, 'send the skill list to the web app', () =>
    $.http.fetch(`${url}skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'claude', data, stats: measured }),
    }),
  )

  return sent?.ok === true
}

/** Gives the web app at `url` this session's skills and the events held for it. */
async function feedWebApp($: EngineInterface, url: string): Promise<void> {
  startIndexing($)
  await indexing
  await measure($)
  if (index) {
    await sendSkills($, url, index)
  }
  if (pending.length > 0 && (await post($, url, pending))) {
    pending = []
  }
}

/**
 * Open web view: the web app's address when it runs (fed with this session's
 * skills), else WEB_STOPPED when the skillverse command is installed, else
 * WEB_MISSING. The plugin never serves the web view itself.
 */
async function openWebApp($: EngineInterface): Promise<string> {
  server = (await findServer($)) ?? undefined
  if (server) {
    await feedWebApp($, server.url)
    return server.url
  }
  const installed = await safe($, 'look for the skillverse command', () => $.process.run(['sh', '-c', 'command -v skillverse']))

  return installed?.exitCode === 0 ? WEB_STOPPED : WEB_MISSING
}

/** Start web view: `skillverse run` starts the web app in the background; resolves to its address. */
async function startWebApp($: EngineInterface): Promise<string> {
  const ports = await webPorts($)
  const run = await $.process.run(['skillverse', 'run', ...(ports.length === 1 ? ['--port', String(ports[0])] : [])])
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.trim() || `skillverse run exited with ${run.exitCode}`)
  }
  const url = await openWebApp($)
  if (!url.startsWith('http')) {
    throw new Error('skillverse run did not start the web app; see ~/.cache/skillverse/server.log')
  }

  return url
}

/**
 * Runs Open web view or Start web view, showing its progress and outcome under
 * the buttons; a running web app also opens in the browser.
 */
async function showWebApp($: EngineInterface, isStart = false): Promise<void> {
  await update($, web, () => 'Looking for the web app…')
  try {
    const state = isStart ? await startWebApp($) : await openWebApp($)
    await update($, web, () => state)
    if (state.startsWith('http')) {
      await openInBrowser($, state)
    }
  } catch (error) {
    await update($, web, () => `Web view failed: ${describe(error)}`)
  }
}

/** As a session starts: a web app already running gets this session's skills now, and its events as they happen. */
async function feedOnStart($: EngineInterface): Promise<void> {
  server = (await findServer($)) ?? undefined
  if (server) {
    await feedWebApp($, server.url)
  }
}

const CATEGORY_ORDER = ['Plugins', 'Connectors (MCP)', 'Organization', 'Project skills', 'Your skills', 'Built-in']

/** Which top-level group of the tree a skill belongs to, by where it was installed from. */
function categoryOf(skill: Skill | undefined): string {
  if (!skill) return 'Other'
  if (skill.plugin) return 'Plugins'
  const labels: Record<string, string> = {
    plugin: 'Plugins',
    mcp: 'Connectors (MCP)',
    syncedSkills: 'Organization',
    policySettings: 'Organization',
    projectSettings: 'Project skills',
    localSettings: 'Project skills',
    userSettings: 'Your skills',
    'built-in': 'Built-in',
    bundled: 'Built-in',
  }
  return labels[skill.source] ?? 'Other'
}

/** A group's name under its category: the plugin, or the family ("Project · docs" → "docs"). */
function groupLabel(region: string): string {
  const at = region.indexOf(' · ')
  return at < 0 ? region : region.slice(at + 3)
}

const HEADING_SIZES = { 1: 26, 2: 19, 3: 15 } as const

/** A small linked-nodes mark for the title, drawn in SVG (emoji fail inside an SVG image). */
function logoIcon(left: number, height: number, size: number): string {
  const scale = size / 26
  const nodes: [number, number, string][] = [
    [6, -6, '#7aa2f7'],
    [20, -10, '#bb9af7'],
    [27, 3, '#9ece6a'],
    [14, 8, '#e0af68'],
    [4, 6, '#7dcfff'],
  ]
  const point = ([x, y]: [number, number, string]) => [Math.round(left + x * scale), Math.round(height / 2 + y * scale)] as const
  const links: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 0],
    [0, 3],
    [1, 3],
  ]
  const lines = links
    .map(([a, b]) => {
      const [x1, y1] = point(nodes[a] as [number, number, string])
      const [x2, y2] = point(nodes[b] as [number, number, string])
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8b95a7" stroke-opacity=".7" stroke-width="${(1.4 * scale).toFixed(1)}"/>`
    })
    .join('')
  const dots = nodes
    .map(node => {
      const [cx, cy] = point(node)
      return `<circle cx="${cx}" cy="${cy}" r="${(3.4 * scale).toFixed(1)}" fill="${node[2]}"/>`
    })
    .join('')

  return lines + dots
}

/** A heading drawn as SVG text, so the desktop shows it at a real size (Markdown headings there stay body size). */
function headingSvg(text: string, level: 1 | 2 | 3, hasIcon = false): { source: string; width: number; height: number } {
  const size = HEADING_SIZES[level]
  const bar = level === 3 ? 0 : 10
  const icon = hasIcon ? Math.round(size * 1.3) : 0
  const width = Math.ceil([...text].length * size * 0.62) + bar + icon + 8
  const height = Math.ceil(size * 1.5)
  const escaped = text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    '<style>text{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:700;fill:#f3f4f6}' +
    '@media (prefers-color-scheme: light){text{fill:#111827}}</style>' +
    (bar ? `<rect x="0" y="${Math.round(height * 0.18)}" width="4" height="${Math.round(height * 0.64)}" rx="2" fill="#7aa2f7"/>` : '') +
    (icon ? logoIcon(bar, height, size) : '') +
    `<text x="${bar + icon}" y="${Math.round(size * 1.1)}" font-size="${size}">${escaped}</text></svg>`

  // biome-ignore lint/suspicious/noControlCharactersInRegex: every non-ASCII character becomes a numeric reference
  return { source: source.replace(/[^\x00-\x7f]/g, c => `&#${c.codePointAt(0)};`), width, height }
}

/**
 * Fits a name in `max` characters: a long `plugin:skill` loses the middle of
 * its plugin part first, so the skill stays readable; anything else loses its end.
 */
function fitName(name: string, max: number): string {
  if (name.length <= max) return name
  const at = name.indexOf(':')
  if (at > 0) {
    const skill = name.slice(at + 1)
    const room = max - skill.length - 2
    if (room >= 4) return `${name.slice(0, room)}…:${skill}`
    return `…${skill.slice(-(max - 1))}`
  }
  return `${name.slice(0, max - 1)}…`
}

/** Opens a URL in the default browser: `open` on macOS, `xdg-open` on Linux. */
/**
 * /skillverse-it: on the desktop app, asks Claude to start the terminal app in
 * the Terminal panel (a plugin cannot open one itself); elsewhere, or when the
 * prompt cannot be sent, prints the command to run.
 */
async function openTerminalApp($: EngineInterface): Promise<{ text: string }> {
  const command = `node ${JSON.stringify(`${$.plugin.root}/tui/skillverse.mjs`)}`
  const manual = [
    'Run this in a terminal (Node 22.18 or newer) for the full-screen Skillverse:',
    '',
    `    ${command}`,
    '',
    'Or, with the npm package: npx @jonathanjuliani/skillverse',
  ].join('\n')
  const surfaces = (await safe($, 'read the session surfaces', () => $.session.surfaces())) ?? []
  if (!surfaces.includes('desktop')) {
    return { text: manual }
  }
  const asked = await safe($, 'ask Claude to open the Terminal panel', () =>
    $.prompt.submit({
      text: [
        'Start the Skillverse terminal app for me in a new tab of the Terminal panel of this app.',
        `It is a full-screen interactive program, so run it there with the run-in-terminal tool, not with Bash: ${command}`,
        'Then link the tab. If you cannot open a terminal tab here, do not run it any other way: show me the command above to run myself.',
      ].join('\n'),
    }),
  )

  return { text: asked === undefined ? manual : 'Asking Claude to open Skillverse in the Terminal panel…' }
}

async function openInBrowser($: EngineInterface, url: string): Promise<void> {
  const system = (await safe($, 'detect the operating system', () => $.process.run(['uname', '-s'])))?.stdout.trim()
  const opened = await safe($, `open ${url}`, () => $.process.run([system === 'Darwin' ? 'open' : 'xdg-open', url]))
  if (opened?.exitCode !== 0) {
    $.ui.toast(`Open ${url} in your browser`)
  }
}

function matchesQuery(skill: Skill, text: string): boolean {
  return text === '' || skill.id.toLowerCase().includes(text) || skill.description.toLowerCase().includes(text)
}

/** Selects a skill (or none), remembering the one it replaces for Back, and opens its region in the tree. */
async function select($: EngineInterface, id: string | null, isBack = false): Promise<void> {
  const previous = await read($, selected)
  if (!isBack && previous && previous !== id) {
    await update($, history, list => [...list, previous].slice(-30))
  }
  await update($, selected, () => id)
  const region = id ? index?.byId.get(id)?.region : undefined
  if (region) {
    await update($, expanded, list => (list.includes(region) ? list : [...list, region]))
  }
}

type Stats = {
  /** Context before the first message: everything in use but the conversation. */
  baseline: { tokens: number; rows: { name: string; tokens: number }[] }
  /** The context right now. */
  now: { tokens: number; window: number; percent: number; messages: number; rows: { name: string; tokens: number }[] }
  /** The skill listing's share of the baseline. */
  listing?: {
    tokens: number
    total: number
    included: number
    heaviest: { name: string; tokens: number }[]
    /** Every listed skill's description cost, by skill id (sent to the web app). */
    perSkill: Record<string, number>
  }
  measuredAt: number
}

let stats: Stats | undefined
let measuring: Promise<void> | undefined
/** Skill id → times used in this session: from the transcript, then counted live. */
let uses = new Map<string, number>()
let isUsesLoaded = false

const STATS_MAX_AGE_MS = 30000
const LISTING_ROWS = 15
/** Solid triangles read well at a glance; U+FE0E keeps ▶ from turning into an emoji. */
const TOGGLE_OPEN = '▼'
const TOGGLE_CLOSED = '▶\uFE0E'

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))
const bar = (part: number, whole: number, width = 24) => {
  const filled = whole > 0 ? Math.min(width, Math.round((part / whole) * width)) : 0
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

/** The session id's skill name as the index knows it: `plugin:name`, or a unique bare name. */
/** Whether two names are the same skill (`docs:write`, `/write`, `write`). */
function sameSkill(a: string, b: string): boolean {
  const clean = (name: string) => name.replace(/^\//, '').trim()
  return clean(a) === clean(b) || (skillIdOf(a) !== undefined && skillIdOf(a) === skillIdOf(b))
}

/** The `/name` a prompt starts with, a skill or not. */
function typedNameOf(text: string): string | undefined {
  return /^\s*\/([A-Za-z0-9_.:-]+)/.exec(text)?.[1]
}

/**
 * Records a typed `/name` once this session's skill list is known (on the
 * first prompt it may still be building), and only when it names a skill:
 * built-in commands such as `/clear` are not skills.
 */
async function recordTyped($: EngineInterface, name: string): Promise<void> {
  if (!index) {
    startIndexing($)
    await indexing
  }
  if (skillIdOf(name)) await skillUsed($, name, 'main')
}

/** One use of a skill: a live event for the web view, and one more in the pane's "Skills used". */
async function skillUsed($: EngineInterface, name: string, agent: string): Promise<void> {
  record($, { kind: 'skill', skill: name, agent })
  const used = skillIdOf(name)
  if (used && isUsesLoaded) {
    uses.set(used, (uses.get(used) ?? 0) + 1)
    await update($, statsAt, n => n + 1)
  }
}

function skillIdOf(name: string): string | undefined {
  const clean = name.replace(/^\//, '').trim()
  if (!index) return undefined
  if (index.byId.has(clean)) return clean
  const matches = index.skills.filter(skill => skill.name === clean)
  return matches.length === 1 ? matches[0]?.id : undefined
}

/** Measures the context now and what a fresh session would start with (the same minus the conversation). */
/** A listed skill's id as the rest of Skillverse writes it: `plugin:name` for a plugin's. */
const listedId = (skill: { name: string; pluginName?: string }) =>
  skill.pluginName && !skill.name.includes(':') ? `${skill.pluginName}:${skill.name}` : skill.name

async function measure($: EngineInterface): Promise<void> {
  if (measuring) return measuring
  measuring = (async () => {
    try {
      const usage = await $.session.usage({ breakdown: 'summary' })
      const breakdown = usage.context.breakdown
      if (!breakdown) return
      const used = breakdown.categories.filter(row => row.kind === 'used')
      const isConversation = (name: string) => /message/i.test(name)
      const messages = used.filter(row => isConversation(row.name)).reduce((sum, row) => sum + row.tokens, 0)
      const baselineRows = used
        .filter(row => !isConversation(row.name) && row.tokens > 0)
        .map(row => ({ name: row.name, tokens: row.tokens }))
      const listing = breakdown.skills
      stats = {
        baseline: {
          tokens: baselineRows.reduce((sum, row) => sum + row.tokens, 0),
          rows: baselineRows.sort((a, b) => b.tokens - a.tokens),
        },
        now: {
          tokens: usage.context.tokens ?? breakdown.totalTokens,
          window: usage.context.window || breakdown.rawMaxTokens,
          percent: usage.context.percent ?? breakdown.percentage,
          messages,
          rows: used
            .filter(row => row.tokens > 0)
            .map(row => ({ name: row.name, tokens: row.tokens }))
            .sort((a, b) => b.tokens - a.tokens),
        },
        ...(listing
          ? {
              listing: {
                tokens: listing.tokens,
                total: listing.totalSkills,
                included: listing.includedSkills,
                heaviest: [...listing.skillFrontmatter]
                  .sort((a, b) => b.tokens - a.tokens)
                  .slice(0, LISTING_ROWS)
                  .map(skill => ({ name: listedId(skill), tokens: skill.tokens })),
                perSkill: Object.fromEntries(listing.skillFrontmatter.map(skill => [listedId(skill), skill.tokens])),
              },
            }
          : {}),
        measuredAt: await $.clock.now(),
      }
      if (!isUsesLoaded) await loadUses($)
    } catch (error) {
      // Not every session can measure (no session bound yet); the section says so.
      $.ui.log(`skillverse: could not measure the context: ${describe(error)}`, { to: 'debug' })
    } finally {
      await update($, statsAt, n => n + 1)
    }
  })().finally(() => {
    measuring = undefined
  })
  return measuring
}

/** Counts skill uses already in this session's transcript: Skill tool calls and typed slash commands. */
async function loadUses($: EngineInterface): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  const id = await $.session.id()
  const found = await safe($, "find this session's transcript", () =>
    $.process.run(['find', `${home}/.claude/projects`, '-maxdepth', '2', '-name', `${id}.jsonl`]),
  )
  const file = found?.stdout.split('\n')[0]?.trim()
  if (!file) return
  const hits = await safe($, 'count skill uses in the transcript', () =>
    $.process.run(['grep', '-ohE', '"name":"Skill","input":\\{"skill":"[^"]+"|<command-name>/?[^<]+</command-name>', file], {
      timeoutMs: 20000,
    }),
  )
  const counted = new Map<string, number>()
  for (const line of hits?.stdout.split('\n') ?? []) {
    const name = /"skill":"([^"]+)"/.exec(line)?.[1] ?? /<command-name>\/?([^<]+)<\/command-name>/.exec(line)?.[1]
    const skill = name ? skillIdOf(name) : undefined
    if (skill) counted.set(skill, (counted.get(skill) ?? 0) + 1)
  }
  uses = counted
  isUsesLoaded = true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of COMMANDS) {
      await $.command.register({ name, description })
    }
    record($, { kind: 'turn', agent: 'main' })
    void feedOnStart($)

    return next(e)
  })

  // Live activity for the web view: which skills load, in which loop, in which turn.
  on('prompt.submit', async ($, e, next) => {
    liveTurn++
    record($, { kind: 'turn', agent: 'main' })
    // A typed `/name` is recorded here: skill.prompt does not fire for every skill on every surface.
    typedSkill = typedNameOf(e.text)
    if (typedSkill) void recordTyped($, typedSkill)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const agent = e.agentId ?? 'main'
    if (e.tool !== 'Skill') {
      record($, { kind: 'tool', tool: e.tool, agent })
      return next(e)
    }
    const previous = skillCaller
    skillCaller = agent
    isSkillSeen = false
    try {
      return await next(e)
    } finally {
      skillCaller = previous
      // skill.prompt did not fire for this call: the call's own input names the skill.
      const name = (e as { skill?: unknown }).skill
      if (!isSkillSeen && typeof name === 'string' && name) await skillUsed($, name, agent)
      isSkillSeen = false
    }
  })

  on('skill.prompt', async ($, e, next) => {
    if (skillCaller !== undefined) isSkillSeen = true
    // A typed skill was already recorded from its prompt.
    const isTyped = skillCaller === undefined && typedSkill !== undefined && sameSkill(typedSkill, e.skill)
    if (isTyped) typedSkill = undefined
    else await skillUsed($, e.skill, skillCaller ?? 'main')

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId) {
      record($, { kind: 'agent', agent: started.agentId, parent: e.parentAgentId ?? 'main', agentType: e.subagentType })
    }

    return started
  })

  for (const command of ['skillverse-it', 'sv-it']) {
    on('command.run', { command }, async $ => openTerminalApp($)).catch((_$, _e, next) => ({
      text: `Skillverse could not open the terminal app (${failureOf(next.error)}). Run: npx @jonathanjuliani/skillverse`,
    }))
  }

  for (const command of ['skillverse', 'sv']) {
    on('command.run', { command }, async $ => {
      startIndexing($)
      await $.ui.open({ id: PANE_ID, title: 'Skillverse', focus: true })

      return { text: 'Skillverse opened.' }
    }).catch((_$, _e, next) => ({ text: `Skillverse could not open its pane (${failureOf(next.error)}).` }))
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        <Button
          key="skillverse"
          label="Skillverse"
          hotkey="s"
          onPress={async () => {
            startIndexing($)
            await $.ui.open({ id: PANE_ID, title: 'Skillverse', focus: true })
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text, Markdown, Link } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    /** A section heading with a blank row around it: SVG at size on the desktop, Markdown elsewhere. */
    const heading = (text: string, level: 1 | 2 | 3, key: string, hasIcon = false) => {
      const drawn = Svg ? headingSvg(text, level, hasIcon) : undefined
      return (
        <Box key={key} flexDirection="column" paddingTop={level === 1 ? 0 : 1} paddingBottom={1}>
          {Svg && drawn ? (
            <Svg key={`${key}-svg`} source={drawn.source} alt={text} width={drawn.width} height={drawn.height} />
          ) : (
            <Markdown key={`${key}-md`} text={`${'#'.repeat(level)} ${text}`} />
          )}
        </Box>
      )
    }

    await read($, indexedAt)
    startIndexing($)
    if (!index) {
      return (
        <Box flexDirection="column">
          <Text bold>Skillverse</Text>
          <Text dimColor>Indexing the skills of this session…</Text>
        </Box>
      )
    }

    const data = index
    const selectedId = await read($, selected)
    const back = await read($, history)
    const open = await read($, expanded)
    const closed = await read($, closedCategories)
    const text = (await read($, query)).trim().toLowerCase()
    const webState = await read($, web)
    const current = selectedId ? data.byId.get(selectedId) : undefined
    const matched = text ? data.skills.filter(skill => matchesQuery(skill, text)) : []

    const jump = (id: string) => select($, id)
    const colorOf = (id: string) => data.regionOf.get(data.byId.get(id)?.region ?? '')?.color
    const chips = (ids: string[], prefix: string) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {ids.map(id =>
          data.byId.has(id) ? (
            <Box key={`${prefix}-${id}`} flexDirection="row" gap={1}>
              <Text color={colorOf(id)}>●</Text>
              <Button key={`${prefix}-go-${id}`} plain label={id} onPress={() => jump(id)} />
            </Box>
          ) : null,
        )}
      </Box>
    )
    const webUrl = webState.startsWith('http') ? (current ? `${webState}?skill=${encodeURIComponent(current.id)}` : webState) : ''

    const header = (
      <Box flexDirection="column">
        {heading('Skillverse', 1, 'title', true)}
        <Text>{`${data.skills.length} skills in ${data.regions.length} groups`}</Text>
        <Box flexDirection="row" gap={2} flexWrap="wrap" paddingTop={1} paddingBottom={1}>
          <Button
            key="reindex"
            label="↻ Reindex"
            onPress={async () => {
              index = undefined
              startIndexing($)
              await update($, indexedAt, n => n + 1)
            }}
          />
          <Button key="publish" label="Open web view" onPress={() => showWebApp($)} />
          {Input && (
            <Input
              key="find"
              placeholder="Find a skill…"
              onInput={value => update($, query, () => value)}
              onSubmit={async value => {
                await update($, query, () => value)
                const first = data.skills.find(skill => matchesQuery(skill, value.trim().toLowerCase()))
                if (first) await jump(first.id)
              }}
            />
          )}
        </Box>
        <Box paddingBottom={1}>
          <Text dimColor>Keyboard: click in this pane, then ↑↓ to move and Enter to open or close</Text>
        </Box>
        {webUrl !== '' ? (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>Web view:</Text>
            <Link key="web-link" href={webUrl} label={webState} />
            <Button key="web-open" label="Open in browser" onPress={() => openInBrowser($, webUrl)} />
          </Box>
        ) : webState === WEB_STOPPED ? (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>The web app is installed but not running.</Text>
            <Button key="web-start" label="Start web view" onPress={() => showWebApp($, true)} />
          </Box>
        ) : webState === WEB_MISSING ? (
          <Box flexDirection="column">
            <Text dimColor>The web view is a separate app. Install it, then click Open web view again:</Text>
            <Text>{`  ${WEB_INSTALL}`}</Text>
            <Text dimColor>Or in a clone of the repo: pnpm run dev.</Text>
          </Box>
        ) : (
          webState !== '' && <Text dimColor>{webState}</Text>
        )}
        {matched.length > 0 && (
          <Box flexDirection="column" paddingTop={1}>
            <Text bold>{`Matches (${matched.length})`}</Text>
            {chips(
              matched.slice(0, MATCH_LIMIT).map(skill => skill.id),
              'match',
            )}
          </Box>
        )}
      </Box>
    )

    // Category → plugin or group → skills; a skill takes its parent's color.
    const categories = new Map<string, Region[]>()
    for (const one of data.regions) {
      const first = data.byId.get(one.ids[0] ?? '')
      const name = categoryOf(first)
      categories.set(name, [...(categories.get(name) ?? []), one])
    }
    const leaf = (id: string, color: string, isLast: boolean, strip = '') => (
      <Box key={`leaf-${id}`} flexDirection="row" paddingLeft={1} gap={1}>
        <Text color={color}>{`${isLast ? '└' : '├'}${id === selectedId ? '◉' : '●'}`}</Text>
        <Button key={`tree-${id}`} plain label={trimPrefix(data.byId.get(id)?.name ?? id, strip)} onPress={() => jump(id)} />
      </Box>
    )
    const byName = (a: string, b: string) => (data.byId.get(a)?.name ?? a).localeCompare(data.byId.get(b)?.name ?? b)
    /** One family (collapsible, its relative prefix shown) or one skill; families nest. */
    const familyNode = (part: Family, one: Region, isLast: boolean, parent: string): ReturnType<typeof leaf> => {
      if (!part.prefix) return leaf(part.ids[0] ?? '', one.color, isLast, parent)
      const key = `family:${one.label}:${part.prefix}`
      const isFamilyOpen = text !== '' || open.includes(key)
      const inner = part.children ?? [...part.ids].sort(byName).map((id): Family => ({ prefix: null, ids: [id] }))

      return (
        <Box key={key} flexDirection="column" paddingLeft={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={one.color}>{isLast ? '└' : '├'}</Text>
            <Button
              key={`toggle-${key}`}
              plain
              label={`${isFamilyOpen ? TOGGLE_OPEN : TOGGLE_CLOSED}  ${trimPrefix(part.prefix, parent)}-*`}
              onPress={() => update($, expanded, list => (list.includes(key) ? list.filter(other => other !== key) : [...list, key]))}
            />
            <Text dimColor>{String(part.ids.length)}</Text>
          </Box>
          {isFamilyOpen && (
            <Box flexDirection="column" paddingLeft={2}>
              {inner.map((child, m) => familyNode(child, one, m === inner.length - 1, `${part.prefix}-`))}
            </Box>
          )}
        </Box>
      )
    }
    /** A plugin or group row; open, its skills, with shared-prefix families as sub-groups. */
    const groupRow = (one: Region, ids: string[], indent: number, strip = '') => {
      const isOpen = text !== '' || open.includes(one.label)
      const parts = familiesOf(ids.map(id => ({ id, name: data.byId.get(id)?.name ?? id })))

      return (
        <Box key={`region-${one.label}`} flexDirection="column" paddingLeft={indent}>
          <Box flexDirection="row" gap={1}>
            <Text color={one.color} bold>
              ■
            </Text>
            <Button
              key={`toggle-${one.label}`}
              plain
              label={`${isOpen ? TOGGLE_OPEN : TOGGLE_CLOSED}  ${trimPrefix(groupLabel(one.label), strip)}`}
              onPress={() =>
                update($, expanded, list => (list.includes(one.label) ? list.filter(other => other !== one.label) : [...list, one.label]))
              }
            />
            <Text dimColor>{`${ids.length} skill${ids.length === 1 ? '' : 's'}`}</Text>
          </Box>
          {isOpen && parts.map((part, k) => familyNode(part, one, k === parts.length - 1, ''))}
        </Box>
      )
    }

    const tree = (
      <Box flexDirection="column" paddingTop={1}>
        {heading('Skills', 2, 'h-skills')}
        {[...categories]
          .sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]) || a[0].localeCompare(b[0]))
          .map(([name, groups], categoryIndex) => {
            const visible = groups
              .map(one => ({
                one,
                ids: one.ids.filter(id => (data.byId.has(id) ? matchesQuery(data.byId.get(id) as Skill, text) : false)),
              }))
              .filter(group => group.ids.length > 0)
              .sort((a, b) => groupLabel(a.one.label).localeCompare(groupLabel(b.one.label)))
            if (visible.length === 0) {
              return null
            }
            const isCategoryOpen = text !== '' || !closed.includes(name)
            const skillCount = visible.reduce((total, group) => total + group.ids.length, 0)

            return (
              <Box key={`category-${name}`} flexDirection="column" paddingBottom={1}>
                <Box flexDirection="row" gap={2}>
                  <Button
                    key={`category-toggle-${name}`}
                    plain
                    {...(categoryIndex === 0 && !current ? { autoFocus: true as const } : {})}
                    label={`${isCategoryOpen ? TOGGLE_OPEN : TOGGLE_CLOSED}  ${name.toUpperCase()}`}
                    onPress={() =>
                      update($, closedCategories, list => (list.includes(name) ? list.filter(other => other !== name) : [...list, name]))
                    }
                  />
                  <Text
                    dimColor
                  >{`${visible.length} ${visible.length === 1 ? 'group' : 'groups'} · ${skillCount} skill${skillCount === 1 ? '' : 's'}`}</Text>
                </Box>
                {isCategoryOpen &&
                  (name === 'Plugins' ? byRoot(visible) : visible.map(group => ({ root: null, groups: [group] }))).map(
                    ({ root, groups }) => {
                      if (!root) return groups.map(group => groupRow(group.one, group.ids, 2))
                      const key = `root:${root}`
                      const isOpen = text !== '' || open.includes(key)
                      const total = groups.reduce((sum, group) => sum + group.ids.length, 0)

                      return (
                        <Box key={key} flexDirection="column" paddingLeft={2}>
                          <Box flexDirection="row" gap={2}>
                            <Button
                              key={`toggle-${key}`}
                              plain
                              label={`${isOpen ? TOGGLE_OPEN : TOGGLE_CLOSED}  ${root}-*`}
                              onPress={() =>
                                update($, expanded, list => (list.includes(key) ? list.filter(other => other !== key) : [...list, key]))
                              }
                            />
                            <Text dimColor>{`${groups.length} plugins · ${total} skills`}</Text>
                          </Box>
                          {isOpen && groups.map(group => groupRow(group.one, group.ids, 2, `${root}-`))}
                        </Box>
                      )
                    },
                  )}
              </Box>
            )
          })}
      </Box>
    )

    const outgoing = current?.links ?? []
    const incoming = current ? (data.incoming.get(current.id) ?? []) : []
    const detail = current ? (
      <Box flexDirection="column" paddingTop={1}>
        <Text bold color={colorOf(current.id)}>{`◉ ${current.id}`}</Text>
        <Text dimColor wrap="truncate-start">
          {[current.region, current.path].filter(Boolean).join(' · ')}
        </Text>
        {current.description !== '' && <Text>{current.description}</Text>}
        <Box flexDirection="row" gap={1} paddingTop={1}>
          <Button
            key="insert"
            label={`Insert /${current.id}`}
            variant="primary"
            autoFocus
            onPress={() => $.prompt.fill({ text: `/${current.id} ` })}
          />
          {back.length > 0 && (
            <Button
              key="back"
              label="← Back"
              onPress={async () => {
                const previous = back[back.length - 1]
                await update($, history, list => list.slice(0, -1))
                if (previous) await select($, previous, true)
              }}
            />
          )}
          <Button key="clear" label="Clear" onPress={() => select($, null)} />
        </Box>
        {outgoing.length > 0 && (
          <Box flexDirection="column" paddingTop={1}>
            <Text bold>{`Links to (${outgoing.length})`}</Text>
            {chips(outgoing.slice(0, LINK_LIMIT), 'out')}
          </Box>
        )}
        {incoming.length > 0 && (
          <Box flexDirection="column" paddingTop={1}>
            <Text bold>{`Linked from (${incoming.length})`}</Text>
            {chips(incoming.slice(0, LINK_LIMIT), 'in')}
          </Box>
        )}
        <Box flexDirection="column" paddingTop={1}>
          {current.body.trim() === '' ? (
            <Text dimColor>No SKILL.md found for this skill; its description is all the session lists.</Text>
          ) : (
            <Markdown key="body" text={current.body.length > BODY_LIMIT ? `${current.body.slice(0, BODY_LIMIT)}\n\n…` : current.body} />
          )}
        </Box>
      </Box>
    ) : null

    await read($, statsAt)
    if (!stats || (await $.clock.now()) - stats.measuredAt > STATS_MAX_AGE_MS) void measure($)
    const used = [...uses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    /** One line per context category: name, tokens, share of the window. */
    const usageRows = (
      rows: { name: string; tokens: number }[],
      prefix: string,
      whole = stats?.now.window ?? 1,
      nameWidth = 24,
      columns: [string, string, string] = ['Category', 'Tokens', '% window'],
    ) => (
      <Box flexDirection="column" paddingTop={1}>
        <Box key={`${prefix}-head`} flexDirection="row">
          <Box width={nameWidth} flexShrink={0}>
            <Text bold dimColor>{`  ${columns[0]}`}</Text>
          </Box>
          <Box width={9} flexShrink={0} justifyContent="flex-end">
            <Text bold dimColor>
              {columns[1]}
            </Text>
          </Box>
          <Box width={11} flexShrink={0} justifyContent="flex-end">
            <Text bold dimColor>
              {columns[2]}
            </Text>
          </Box>
        </Box>
        <Box width={nameWidth + 20} overflow="hidden">
          <Text dimColor wrap="truncate">
            {'─'.repeat(nameWidth + 20)}
          </Text>
        </Box>
        {rows.map(row => (
          <Box key={`${prefix}-${row.name}`} flexDirection="row">
            <Box width={nameWidth} flexShrink={0} overflow="hidden">
              <Text wrap="truncate">{`• ${fitName(row.name, nameWidth - 4)}`}</Text>
            </Box>
            <Box width={9} flexShrink={0} justifyContent="flex-end">
              <Text bold>{formatTokens(row.tokens)}</Text>
            </Box>
            <Box width={11} flexShrink={0} justifyContent="flex-end">
              <Text dimColor>{`${((row.tokens / (whole || 1)) * 100).toFixed(1)}%`}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
    const insights = (
      <Box flexDirection="column" paddingTop={1}>
        {heading('Context & skills', 2, 'h-context')}
        <Box flexDirection="row" gap={1}>
          <Button key="measure" label="↻ Measure" onPress={() => measure($)} />
        </Box>
        {!stats ? (
          <Text dimColor>Measuring this session's context…</Text>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="column" paddingTop={1}>
              {heading('New empty session', 3, 'h-new')}
              <Text
                dimColor
              >{`${formatTokens(stats.baseline.tokens)} of ${formatTokens(stats.now.window)} (${Math.round((stats.baseline.tokens / stats.now.window) * 100)}%) loaded before your first message`}</Text>
              <Text color="#7aa2f7">{bar(stats.baseline.tokens, stats.now.window)}</Text>
              {usageRows(stats.baseline.rows, 'new')}
            </Box>
            <Box flexDirection="column" paddingTop={1}>
              {heading('This session now', 3, 'h-now')}
              <Text
                dimColor
              >{`${formatTokens(stats.now.tokens)} of ${formatTokens(stats.now.window)} (${Math.round(stats.now.percent)}%)`}</Text>
              <Text color={stats.now.percent >= 85 ? '#f7768e' : stats.now.percent >= 60 ? '#e0af68' : '#9ece6a'}>
                {bar(stats.now.tokens, stats.now.window)}
              </Text>
              {usageRows(stats.now.rows, 'now')}
            </Box>
            {stats.listing && (
              <Box flexDirection="column" paddingTop={1}>
                {heading('Skill descriptions in context', 3, 'h-listing')}
                <Text dimColor>
                  {`Every session lists each skill's name and description so Claude knows when to use it. That costs ${formatTokens(stats.listing.tokens)} tokens for ${stats.listing.total} skills${stats.listing.included < stats.listing.total ? ` (${stats.listing.included} fit the budget; the rest are left out)` : ''}.`}
                </Text>
                <Text dimColor>{`The ${stats.listing.heaviest.length} most expensive descriptions:`}</Text>
                {usageRows(stats.listing.heaviest, 'listing', stats.listing.tokens, 36, ['Skill', 'Tokens', '% of all'])}
              </Box>
            )}
          </Box>
        )}
        <Box flexDirection="column" paddingTop={1}>
          {heading(`Skills used this session (${used.reduce((sum, [, n]) => sum + n, 0)})`, 3, 'h-used')}
          {used.length === 0 ? (
            <Text dimColor>{isUsesLoaded ? 'No skill used yet in this session.' : 'Reading this session…'}</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {used.map(([id, n]) => (
                <Box key={`used-${id}`} flexDirection="row" gap={1}>
                  <Text color={colorOf(id)}>●</Text>
                  <Button key={`used-go-${id}`} plain label={`${id} ×${n}`} onPress={() => jump(id)} />
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header}
        {detail}
        {tree}
        {insights}
      </Box>
    )
  })
}
