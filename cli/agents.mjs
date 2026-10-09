// What each AI agent has installed, read from its own folders at home: its
// plugins (and what each brings), the user's skills, its built-in skills, and
// its connectors (MCP servers). Each agent is a planet once its folder exists,
// even with nothing in it. Connectors are read by name and transport only:
// commands, arguments, headers and environment can hold secrets and are never kept.

import fs from 'node:fs'
import path from 'node:path'

import { readJson } from './shared.mjs'

/** A JSON file that may hold comments (JSONC), or undefined. */
export function readJsonc(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
      out += text.slice(start, i + 1)
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) break
      i++
    } else out += c
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return undefined
  }
}

/** A TOML file's tables, each as its raw `key = value` strings (enough for names and flags). */
export function readTomlTables(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const tables = []
  let table
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(line)
    if (header) {
      table = { path: splitTomlKey(header[1].trim()), values: {} }
      tables.push(table)
      continue
    }
    const pair = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (pair && table) table.values[pair[1]] = pair[2]
  }
  return tables
}

/** `plugins."a@b".x` → ['plugins', 'a@b', 'x']. */
function splitTomlKey(key) {
  const parts = []
  for (const match of key.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^.\s]+)/g)) parts.push(match[1] ?? match[2] ?? match[3])
  return parts
}

const isDir = dir => {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

const listDirs = dir => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/** The newest version folder of a cached plugin (`<name>/<version>/`). */
function newest(dir) {
  const versions = listDirs(dir)
  if (versions.length === 0) return undefined
  const time = name => {
    try {
      return fs.statSync(path.join(dir, name)).mtimeMs
    } catch {
      return 0
    }
  }
  return path.join(dir, versions.sort((a, b) => time(b) - time(a))[0])
}

/** How a connector is reached, without anything secret: `http · host` or `stdio · npx`. */
function transportOf(server) {
  const url = server?.url ?? server?.httpUrl ?? server?.serverUrl
  if (typeof url === 'string') {
    try {
      return `http · ${new URL(url).host}`
    } catch {
      return 'http'
    }
  }
  const command = Array.isArray(server?.command) ? server.command[0] : server?.command
  return typeof command === 'string' ? `stdio · ${path.basename(command)}` : ''
}

/**
 * Collects one agent's entries, skills and connectors alike, keyed by id so a
 * skill found twice (a plugin listed in two places) is kept once.
 */
export function collector(parseSkillFile) {
  const found = new Map()

  const skill = (id, name, file, fields) => {
    if (found.has(id)) return
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    const { meta, body } = parseSkillFile(text)
    found.set(id, { id, name, region: '', description: meta.description ?? '', path: file, body, links: [], ...fields })
  }

  /** Every `<name>/SKILL.md` under a folder, one level of nesting allowed (`skills/design/brief`). */
  const skills = (root, fields = {}, depth = 0) => {
    for (const name of listDirs(root)) {
      const file = path.join(root, name, 'SKILL.md')
      if (fs.existsSync(file)) skill(fields.plugin ? `${fields.plugin}:${name}` : name, name, file, fields)
      else if (depth === 0) skills(path.join(root, name), fields, 1)
    }
  }

  /** Connectors from an `mcpServers`-style object: a name per server, its transport, nothing else. */
  const servers = (object, file, fields = {}, noun = 'MCP server') => {
    if (!object || typeof object !== 'object') return
    for (const [name, server] of Object.entries(object)) {
      if (server?.enabled === false || server?.disabled === true) continue
      const id = fields.plugin ? `mcp/${fields.plugin}/${name}` : `mcp/${name}`
      if (found.has(id)) continue
      const from = fields.plugin ? `, from the ${fields.plugin} plugin` : ''
      const how = transportOf(server)
      found.set(id, {
        id,
        name,
        kind: 'mcp',
        source: 'mcp',
        region: '',
        description: `${noun}${how ? ` (${how})` : ''}${from}`,
        path: file,
        body: '',
        links: [],
        ...fields,
        category: 'mcp',
      })
    }
  }

  /**
   * A plugin's folder: its skills (from its manifest, else `skills/`) and its
   * connectors (`.mcp.json`, `mcp.json`, the manifest's `mcpServers`, Codex's `apps`).
   */
  const plugin = (dir, name, manifestFile, category = 'plugins') => {
    const manifest = (manifestFile && readJson(path.join(dir, manifestFile))) || {}
    const fields = { plugin: name, source: 'plugin', category }
    const declared = typeof manifest.skills === 'string' ? [manifest.skills] : Array.isArray(manifest.skills) ? manifest.skills : []
    for (const rel of declared) {
      const folder = path.join(dir, rel).replace(/\/SKILL\.md$/, '')
      if (fs.existsSync(path.join(folder, 'SKILL.md')))
        skill(`${name}:${path.basename(folder)}`, path.basename(folder), path.join(folder, 'SKILL.md'), fields)
      else skills(folder, fields)
    }
    skills(path.join(dir, 'skills'), fields)

    const connectorFields = { plugin: name }
    for (const file of ['.mcp.json', 'mcp.json']) {
      const json = readJson(path.join(dir, file))
      if (json) servers(json.mcpServers ?? json, path.join(dir, file), connectorFields)
    }
    if (typeof manifest.mcpServers === 'string') {
      const file = path.join(dir, manifest.mcpServers)
      const json = readJson(file)
      servers(json?.mcpServers ?? json, file, connectorFields)
    } else servers(manifest.mcpServers, path.join(dir, manifestFile ?? ''), connectorFields)
    if (typeof manifest.apps === 'string') {
      const file = path.join(dir, manifest.apps)
      servers(readJson(file)?.apps, file, connectorFields, 'App connector')
    }
  }

  return { skill, skills, servers, plugin, list: () => [...found.values()] }
}

// ---- The agents ---------------------------------------------------------------

/** Claude Code: `~/.claude/skills`, the plugins turned on in its settings, those loaded from folders and those synced from an organization, `~/.claude.json`'s servers. */
function claude(c, home, cwd) {
  const settings = [path.join(home, '.claude', 'settings.json')]
  if (cwd) settings.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'))
  c.skills(path.join(home, '.claude', 'skills'), { source: 'userSettings' })
  if (cwd) c.skills(path.join(cwd, '.claude', 'skills'), { source: 'projectSettings' })

  const enabled = new Set()
  const folders = new Set()
  for (const file of settings) {
    const json = readJson(file)
    for (const [key, isOn] of Object.entries(json?.enabledPlugins ?? {})) if (isOn) enabled.add(key)
    for (const dir of String(json?.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(':')) if (dir) folders.add(dir)
  }
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'))?.plugins ?? {}
  for (const key of enabled) {
    const dir = installed[key]?.[0]?.installPath
    if (dir) c.plugin(dir, key.split('@')[0], '.claude-plugin/plugin.json')
  }
  // Plugins loaded from a folder (CLAUDE_CODE_PLUGIN_DIRS in settings' env): named by their manifest, else their folder.
  for (const dir of folders) {
    const name = readJson(path.join(dir, '.claude-plugin', 'plugin.json'))?.name ?? path.basename(dir)
    c.plugin(dir, name, '.claude-plugin/plugin.json')
  }
  // Plugins synced from a claude.ai organization (`plugins/synced/<org>_<user>/<plugin>/`), when there are any.
  const synced = path.join(home, '.claude', 'plugins', 'synced')
  for (const account of listDirs(synced)) {
    for (const name of listDirs(path.join(synced, account))) {
      const dir = path.join(synced, account, name)
      c.plugin(dir, readJson(path.join(dir, '.claude-plugin', 'plugin.json'))?.name ?? name, '.claude-plugin/plugin.json', 'org')
    }
  }
  const user = readJson(path.join(home, '.claude.json'))
  c.servers(user?.mcpServers, path.join(home, '.claude.json'))
}

/** The markets Codex ships with: their plugins are built in, not installed by the user. */
const CODEX_BUILT_IN = new Set(['openai-bundled', 'openai-primary-runtime'])

/** Codex: plugins from `config.toml` (cached under `plugins/cache/<market>/<name>/<version>`), `skills/` with its `.system` built-ins, `mcp_servers`. */
function codex(c, home) {
  const root = path.join(home, '.codex')
  c.skills(path.join(root, 'skills'), { source: 'userSettings' })
  c.skills(path.join(root, 'skills', '.system'), { source: 'built-in', category: 'builtin' })

  const tables = readTomlTables(path.join(root, 'config.toml'))
  const cache = path.join(root, 'plugins', 'cache')
  const seen = new Set()
  for (const table of tables) {
    if (table.path[0] !== 'plugins' || table.path.length !== 2) continue
    const [name, market] = table.path[1].split('@')
    seen.add(`${market}/${name}`)
    if (table.values.enabled === 'false') continue
    const dir = newest(path.join(cache, market ?? '', name ?? ''))
    if (dir) c.plugin(dir, name, '.codex-plugin/plugin.json', CODEX_BUILT_IN.has(market) ? 'builtin' : 'plugins')
  }
  // Plugins installed from Codex's online directory are not listed in config.toml.
  for (const market of listDirs(cache)) {
    for (const name of listDirs(path.join(cache, market))) {
      if (seen.has(`${market}/${name}`) || !fs.existsSync(path.join(cache, market, name, '.codex-remote-plugin-install.json'))) continue
      const dir = newest(path.join(cache, market, name))
      if (dir) c.plugin(dir, name, '.codex-plugin/plugin.json')
    }
  }
  const servers = {}
  for (const table of tables) {
    if (table.path[0] === 'mcp_servers' && table.path.length === 2) {
      const url = table.values.url?.replace(/^["']|["']$/g, '')
      const command = table.values.command?.replace(/^["']|["']$/g, '')
      servers[table.path[1]] = { url, command, enabled: table.values.enabled !== 'false' }
    }
  }
  c.servers(servers, path.join(root, 'config.toml'))
}

/** Cursor: `skills/`, its built-in `skills-cursor/`, plugins cached per market and local ones, `mcp.json`. */
function cursor(c, home) {
  const root = path.join(home, '.cursor')
  c.skills(path.join(root, 'skills'), { source: 'userSettings' })
  c.skills(path.join(root, 'skills-cursor'), { source: 'built-in', category: 'builtin' })
  const cache = path.join(root, 'plugins', 'cache')
  for (const market of listDirs(cache)) {
    for (const name of listDirs(path.join(cache, market))) {
      const dir = newest(path.join(cache, market, name))
      if (dir) c.plugin(dir, name, '.cursor-plugin/plugin.json')
    }
  }
  for (const name of listDirs(path.join(root, 'plugins', 'local'))) {
    c.plugin(path.join(root, 'plugins', 'local', name), name, '.cursor-plugin/plugin.json')
  }
  c.servers(readJson(path.join(root, 'mcp.json'))?.mcpServers, path.join(root, 'mcp.json'))
}

/** Gemini CLI: `skills/`, extensions (each with its manifest's servers), `settings.json`'s servers. */
function gemini(c, home) {
  const root = path.join(home, '.gemini')
  c.skills(path.join(root, 'skills'), { source: 'userSettings' })
  for (const name of listDirs(path.join(root, 'extensions'))) {
    const dir = path.join(root, 'extensions', name)
    c.plugin(dir, readJson(path.join(dir, 'gemini-extension.json'))?.name ?? name, 'gemini-extension.json')
  }
  c.servers(readJsonc(path.join(root, 'settings.json'))?.mcpServers, path.join(root, 'settings.json'))
}

/** GitHub Copilot CLI: `skills/`, installed plugins per market, `mcp-config.json`. */
function copilot(c, home) {
  const root = path.join(home, '.copilot')
  c.skills(path.join(root, 'skills'), { source: 'userSettings' })
  const plugins = path.join(root, 'installed-plugins')
  for (const market of listDirs(plugins)) {
    for (const name of listDirs(path.join(plugins, market))) {
      const dir = path.join(plugins, market, name)
      const manifest = ['plugin.json', '.github/plugin/plugin.json', '.claude-plugin/plugin.json'].find(file =>
        fs.existsSync(path.join(dir, file)),
      )
      c.plugin(dir, name, manifest)
    }
  }
  c.servers(readJsonc(path.join(root, 'mcp-config.json'))?.mcpServers, path.join(root, 'mcp-config.json'))
}

/** opencode: `skills/` (or `skill/`), the `mcp` block of `opencode.json`. */
function opencode(c, home) {
  const root = path.join(home, '.config', 'opencode')
  c.skills(path.join(root, 'skills'), { source: 'userSettings' })
  c.skills(path.join(root, 'skill'), { source: 'userSettings' })
  for (const file of ['opencode.json', 'opencode.jsonc']) {
    const json = readJsonc(path.join(root, file))
    if (json?.mcp) c.servers(json.mcp, path.join(root, file))
  }
}

/** Windsurf: `skills/`, `mcp_config.json`. */
function windsurf(c, home) {
  const root = path.join(home, '.codeium', 'windsurf')
  c.skills(path.join(root, 'skills'), { source: 'userSettings' })
  c.servers(readJsonc(path.join(root, 'mcp_config.json'))?.mcpServers, path.join(root, 'mcp_config.json'))
}

/** Devin's CLI: `~/.config/devin/skills/` (its other folders are Shared's and Windsurf's). */
function devin(c, home) {
  c.skills(path.join(home, '.config', 'devin', 'skills'), { source: 'userSettings' })
}

/** Google Antigravity: the skills its app, IDE and CLI share (`~/.gemini/config/skills/`) and each one's own. */
function antigravity(c, home) {
  for (const folder of ['config', 'antigravity', 'antigravity-ide', 'antigravity-cli']) {
    c.skills(path.join(home, '.gemini', folder, 'skills'), { source: 'userSettings' })
  }
}

/** The shared `~/.agents/skills` folder; skills installed with `npx skills` are grouped by the repo they came from. */
function shared(c, home) {
  const root = path.join(home, '.agents')
  const lock = readJson(path.join(root, '.skill-lock.json'))?.skills ?? {}
  for (const name of listDirs(path.join(root, 'skills'))) {
    const file = path.join(root, 'skills', name, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    const from = lock[name]?.source
    c.skill(name, name, file, { source: 'userSettings', ...(typeof from === 'string' ? { group: from.split('/').pop() } : {}) })
  }
}

/**
 * The agents Skillverse knows, in the order their planets are listed. `folder`
 * is where each keeps its files at home (or a list of places); an agent is
 * shown when one exists. `notes` says what a scan cannot see for it.
 */
export const AGENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    folder: '.claude',
    find: claude,
    notes: ['Built-in skills and claude.ai connectors show once a Claude Code session with the Skillverse plugin sends its list.'],
  },
  { id: 'codex', label: 'Codex', folder: '.codex', find: codex },
  { id: 'cursor', label: 'Cursor', folder: '.cursor', find: cursor },
  { id: 'gemini', label: 'Gemini CLI', folder: '.gemini', find: gemini },
  { id: 'copilot', label: 'GitHub Copilot', folder: '.copilot', find: copilot },
  { id: 'opencode', label: 'opencode', folder: '.config/opencode', find: opencode },
  { id: 'windsurf', label: 'Windsurf', folder: '.codeium/windsurf', find: windsurf },
  { id: 'devin', label: 'Devin', folder: '.config/devin', find: devin },
  {
    id: 'antigravity',
    label: 'Antigravity',
    folder: ['.gemini/config', '.gemini/antigravity', '.gemini/antigravity-ide', '.gemini/antigravity-cli'],
    find: antigravity,
  },
  { id: 'shared', label: 'Shared (.agents)', folder: '.agents', find: shared },
]

/** Whether an agent is installed here: its folder (or one of them) at home exists. */
export const isInstalled = (agent, home) => [agent.folder].flat().some(folder => isDir(path.join(home, folder)))
