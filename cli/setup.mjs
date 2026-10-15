// `skillverse install` writes the hooks that make an agent run
// `skillverse hook <agent>` on its events, into the agent's own config, and
// `skillverse remove` takes them back. In a shared file everything else stays
// as it was, and the file is backed up first; a file of Skillverse's own
// (Copilot's hooks, opencode's plugin) is written whole and removed on remove.
// Only hooks that observe are used: a permission hook that answered wrongly
// could block the agent.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import { AGENTS, isInstalled } from './agents.mjs'

const BIN = fileURLToPath(new URL('./skillverse.mjs', import.meta.url))
const HOOK_MODULE = fileURLToPath(new URL('./hook.mjs', import.meta.url))

// The entries each hook format takes, for one command.
const flat = command => ({ command })
const nested = (command, extra = {}) => ({ matcher: '', hooks: [{ type: 'command', command, timeout: 10, ...extra }] })

/** The opencode plugin: it hands each tool call to Skillverse and never waits on it or fails the tool. */
const opencodePlugin = ({ hookModule }) => `// Written by \`skillverse install opencode\`; \`skillverse remove opencode\` removes it.
// It tells the Skillverse web app which skills opencode uses: a skill tool's name, or a SKILL.md read.
const HOOK = ${JSON.stringify(hookModule)}

export const Skillverse = async ({ directory }) => ({
  'tool.execute.before': async (input, output) => {
    const call = { tool: input?.tool, args: output?.args, session: input?.sessionID, directory }
    import(HOOK)
      .then(({ sendHook }) => sendHook('opencode', JSON.stringify(call)))
      .catch(() => {})
  },
})
`

/**
 * Each agent's hooks: the file, and either the events to merge Skillverse's
 * entry into (`events`, under `container`, `hooks` by default) or the whole
 * file Skillverse owns (`render`). `note` is said after setting it up.
 */
export const SETUPS = {
  cursor: {
    file: home => path.join(home, '.cursor', 'hooks.json'),
    empty: { version: 1, hooks: {} },
    events: { beforeSubmitPrompt: flat, postToolUse: flat },
  },
  codex: {
    file: home => path.join(home, '.codex', 'hooks.json'),
    empty: { hooks: {} },
    events: { UserPromptSubmit: nested, PostToolUse: nested },
    note: 'Codex runs a new hook only once you trust it: type /hooks in Codex and trust the two Skillverse hooks.',
  },
  devin: {
    file: home => path.join(home, '.config', 'devin', 'config.json'),
    empty: {},
    events: { UserPromptSubmit: nested, PostToolUse: nested },
  },
  copilot: {
    file: home => path.join(home, '.copilot', 'hooks', 'skillverse.json'),
    render: ({ command }) => {
      // Claude Code's event names make Copilot send Claude Code's fields; `bash` is Copilot's key, `command` VS Code's.
      const entry = { type: 'command', bash: command, command, timeout: 10 }
      return `${JSON.stringify({ version: 1, hooks: { UserPromptSubmit: [entry], PostToolUse: [entry] } }, null, 2)}\n`
    },
    note: 'Copilot CLI and VS Code both read this folder. Restart the Copilot CLI to load it.',
  },
  gemini: {
    file: home => path.join(home, '.gemini', 'settings.json'),
    empty: {},
    events: {
      BeforeAgent: command => ({ matcher: '*', hooks: [{ name: 'skillverse', type: 'command', command, timeout: 5000 }] }),
      AfterTool: command => ({ matcher: '*', hooks: [{ name: 'skillverse', type: 'command', command, timeout: 5000 }] }),
    },
  },
  windsurf: {
    file: home => path.join(home, '.codeium', 'windsurf', 'hooks.json'),
    empty: { hooks: {} },
    events: {
      pre_user_prompt: command => ({ command, show_output: false }),
      post_read_code: command => ({ command, show_output: false }),
    },
  },
  antigravity: {
    file: home => path.join(home, '.gemini', 'config', 'hooks.json'),
    empty: {},
    // Antigravity names each group of hooks; Skillverse's is `skillverse`.
    container: 'skillverse',
    events: { PostToolUse: command => ({ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }) },
    note: 'Antigravity has no hook for prompts, so only skills it reads show; typed /skills do not.',
  },
  opencode: {
    file: home => path.join(home, '.config', 'opencode', 'plugins', 'skillverse.js'),
    render: opencodePlugin,
    note: 'Restart opencode to load the plugin.',
  },
}

/** Other names people use for an agent install knows: VS Code's agent hooks are Copilot's. */
export const ALIASES = { vscode: 'copilot', 'github-copilot': 'copilot', cascade: 'windsurf', agy: 'antigravity' }

const aliasesFor = id =>
  Object.entries(ALIASES)
    .filter(([, agent]) => agent === id)
    .map(([alias]) => alias)

/** The command an agent runs: absolute paths, since desktop apps often start without the shell's PATH. */
export const hookCommand = (agent, node = process.execPath, bin = BIN) => `"${node}" "${bin}" hook ${agent}`

/** Whether a hook entry is one Skillverse wrote for `agent`, wherever it was installed from. */
const isOurs = (entry, agent) => {
  const text = JSON.stringify(entry ?? '')
  return text.includes('skillverse') && new RegExp(` hook ${agent}(?![\\w-])`).test(text)
}

/** A folder npx runs packages from, which can be cleared at any time. */
export const isNpxCache = (dir = BIN) => /[\\/]_npx[\\/]/.test(dir)

/** An agent install knows, by its id or another name for it; throws for one it does not. */
export function setupFor(name) {
  const id = ALIASES[name] ?? name
  if (!SETUPS[id]) throw new Error(`skillverse install knows ${Object.keys(SETUPS).join(', ')} (and vscode); not ${name}`)
  return { id, ...SETUPS[id] }
}

function readConfig(file, before, empty) {
  if (before === undefined || before.trim() === '') return structuredClone(empty)
  let config
  try {
    config = JSON.parse(before)
  } catch {
    throw new Error(`${file} is not plain JSON (comments or a typo?); Skillverse will not rewrite it`)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${file} is not a JSON object`)
  return config
}

/**
 * The agent's config with Skillverse's hooks added (or, with `isUndo`, taken
 * out). Returns the file, its text before and after (`before` undefined when
 * it does not exist yet, `after` null when it is to be removed), and whether
 * anything changes.
 */
export function planSetup(name, { home = os.homedir(), isUndo = false, command, hookModule = HOOK_MODULE } = {}) {
  const known = setupFor(name)
  const file = known.file(home)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
  const ours = command ?? hookCommand(known.id)

  if (known.render) {
    const after = isUndo ? null : known.render({ command: ours, hookModule })
    return { file, before, after, isChanged: isUndo ? before !== undefined : before !== after, isOwned: true }
  }

  const config = readConfig(file, before, known.empty)
  const key = known.container ?? 'hooks'
  const hooks = config[key] && typeof config[key] === 'object' ? config[key] : {}
  for (const [event, entry] of Object.entries(known.events)) {
    const others = (Array.isArray(hooks[event]) ? hooks[event] : []).filter(one => !isOurs(one, known.id))
    const list = isUndo ? others : [...others, entry(ours)]
    if (list.length > 0) hooks[event] = list
    else delete hooks[event]
  }
  // An empty group Skillverse made goes; one the file's shape needs (`hooks` in Cursor's) stays.
  if (Object.keys(hooks).length > 0 || key in known.empty) config[key] = hooks
  else delete config[key]

  const after = `${JSON.stringify(config, null, 2)}\n`
  const isChanged = before === undefined ? !isUndo : JSON.stringify(JSON.parse(before || '{}')) !== JSON.stringify(config)
  return { file, before, after, isChanged, isOwned: false }
}

/** Writes a planned change: a shared file is backed up next to itself first; a file of Skillverse's own is just written or removed. */
export function applySetup({ file, before, after, isChanged, isOwned }) {
  if (!isChanged) return
  if (after === null) return fs.rmSync(file, { force: true })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (before !== undefined && !isOwned) fs.writeFileSync(`${file}.skillverse-backup`, before)
  fs.writeFileSync(file, after)
}

/** Where each agent reads user skills: its own folder for Cursor and Antigravity, `~/.agents/skills` for the rest. */
const SKILL_HOMES = {
  cursor: home => path.join(home, '.cursor', 'skills'),
  antigravity: home => path.join(home, '.gemini', 'config', 'skills'),
}
const SHARED_SKILLS = home => path.join(home, '.agents', 'skills')
const SKILL_MARK = '<!-- Written by skillverse install; skillverse remove <agent> removes it. -->'
/** Skills written by `skillverse setup` before install/remove. Removal still treats them as Skillverse's. */
const OLD_SKILL_MARK = 'Written by skillverse setup'
const isOurSkill = text => text.includes(SKILL_MARK) || text.includes(OLD_SKILL_MARK)

/** The `/skillverse` skill: any agent runs the summary for itself (its id from the list) and shows it. */
export const skillText = (command = `"${process.execPath}" "${BIN}" summary`) => `---
name: skillverse
description: Show what this agent has installed (skills, plugins, connectors), what they cost in context every session, and where to watch them live in the Skillverse web app. Use when the user types /skillverse, or asks which skills or plugins are installed, how many there are, or what they cost.
---

${SKILL_MARK}

Run this, with your own agent's id after \`--agent\`:

\`\`\`bash
${command} --agent <id>
\`\`\`

| You are | id |
| --- | --- |
| Codex | codex |
| Cursor | cursor |
| GitHub Copilot (CLI or VS Code) | copilot |
| Gemini CLI | gemini |
| Devin | devin |
| Windsurf | windsurf |
| Google Antigravity | antigravity |
| opencode | opencode |

When you are none of these, or not sure, run it without \`--agent\` to show every agent.

Show the output to the user as it is, in a code block. It ends with the web app's address when it runs, or how to start it: mention that line too. Do not summarise or change the figures.
`

/** Where an agent's `/skillverse` skill goes. */
export const skillFile = (id, home) => path.join((SKILL_HOMES[id] ?? SHARED_SKILLS)(home), 'skillverse', 'SKILL.md')

/**
 * The `/skillverse` skill for an agent: written when missing, removed on remove
 * (the shared copy only once no other agent that reads it is still installed).
 * A SKILL.md there that Skillverse did not write is left alone.
 */
export function planSkill(id, { home = os.homedir(), isUndo = false, othersSetUp = [] } = {}) {
  const file = skillFile(id, home)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
  const isTheirs = before !== undefined && !isOurSkill(before)
  const isShared = !SKILL_HOMES[id]
  const isKept = isTheirs || (isUndo && isShared && othersSetUp.some(other => !SKILL_HOMES[other]))
  const after = isKept ? before : isUndo ? null : skillText()
  return { file, before, after, isChanged: !isKept && (isUndo ? before !== undefined : before !== after), isOwned: true, isTheirs }
}

/** Whether the agent is installed here, by the folders the scan looks for. */
const installed = (id, home) => {
  const agent = AGENTS.find(one => one.id === id)
  return agent ? isInstalled(agent, home) : false
}

/** Every agent install knows: on this machine, and whether Skillverse's hooks are there. */
export function setupStatus(home = os.homedir()) {
  return Object.keys(SETUPS).map(id => {
    const file = SETUPS[id].file(home)
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    return {
      id,
      label: AGENTS.find(one => one.id === id)?.label ?? id,
      isInstalled: installed(id, home),
      isSetUp: SETUPS[id].render ? text !== '' : isOurs(text, id),
    }
  })
}

const tilde = (file, home = os.homedir()) => (file.startsWith(home) ? `~${file.slice(home.length)}` : file)

const labelFor = id => AGENTS.find(one => one.id === id)?.label ?? id

/** A directory Skillverse created for a file of its own, removed once nothing else is in it. */
const OWNED_DIRS = new Set(['hooks', 'plugins', 'skillverse'])

function removeEmptyOwnedDir(dir) {
  if (!OWNED_DIRS.has(path.basename(dir)) || !fs.existsSync(dir)) return
  if (fs.readdirSync(dir).length > 0) return
  fs.rmdirSync(dir)
}

const skillOwned = (id, home) => {
  const file = skillFile(id, home)
  return fs.existsSync(file) && isOurSkill(fs.readFileSync(file, 'utf8'))
}

const usesSharedSkill = id => !SKILL_HOMES[id]

const agentRow = (one, state) => ({ id: one.id, label: one.label, state, aliases: aliasesFor(one.id) })

/**
 * Rows for the picker, besides "all". Install lists agents on this machine.
 * Remove lists agents that still have Skillverse's hooks or skill.
 */
export function choicesFor(mode, home = os.homedir()) {
  const status = setupStatus(home)
  if (mode === 'install')
    return status.filter(one => one.isInstalled).map(one => agentRow(one, one.isSetUp ? 'installed' : 'not installed'))
  const shared = skillOwned('codex', home)
  const sharedWithHooks = status.some(one => usesSharedSkill(one.id) && one.isSetUp)
  const sharedOnDisk = status.some(one => usesSharedSkill(one.id) && one.isInstalled)
  return status
    .filter(one => {
      if (one.isSetUp) return true
      if (!usesSharedSkill(one.id)) return skillOwned(one.id, home)
      if (!shared || sharedWithHooks) return false
      return one.isInstalled || !sharedOnDisk
    })
    .map(one => {
      const bits = []
      if (one.isSetUp) bits.push('hooks')
      const hasSkill = usesSharedSkill(one.id) ? shared : skillOwned(one.id, home)
      if (hasSkill) bits.push('skill')
      return agentRow(one, bits.join(', '))
    })
}

/** The picker's starting point: every row checked. */
export function pickerState(agents) {
  return { cursor: 0, selection: { all: agents.length > 0, ids: agents.map(one => one.id) }, buffer: '', error: '', agents }
}

/** Space on "all" checks or clears every row. Unchecking one row clears "all" and leaves the rest. */
export function toggleSelection(selection, rowId, agents) {
  if (rowId === 'all') {
    if (selection.all) return { all: false, ids: [] }
    return { all: agents.length > 0, ids: agents.map(one => one.id) }
  }
  const ids = new Set(selection.ids)
  if (ids.has(rowId)) ids.delete(rowId)
  else ids.add(rowId)
  const list = agents.map(one => one.id).filter(id => ids.has(id))
  return { all: agents.length > 0 && list.length === agents.length, ids: list }
}

/**
 * A typed choice: `all` or `1` is every row, `2` is the first agent, and a name
 * or alias (comma or space separated) is that agent. Throws for one not in the list.
 */
export function parseSelection(text, agents) {
  const tokens = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (tokens.length === 0) throw new Error('name an agent, a number, or all')
  const known = new Set(agents.map(one => one.id))
  const ids = []
  for (const token of tokens) {
    if (token === 'all' || token === '1') return agents.map(one => one.id)
    if (/^\d+$/.test(token)) {
      const index = Number(token) - 2
      if (index < 0 || index >= agents.length) throw new Error(`there is no ${token} in the list`)
      ids.push(agents[index].id)
      continue
    }
    const id = ALIASES[token] ?? token
    if (!known.has(id)) {
      if (!SETUPS[id]) throw new Error(`skillverse install knows ${Object.keys(SETUPS).join(', ')} (and vscode); not ${token}`)
      throw new Error(`${labelFor(id)} is not in this list`)
    }
    ids.push(id)
  }
  return [...new Set(ids)]
}

/** One key in the picker. `confirm` carries the chosen agent ids; `cancel` writes nothing. */
export function onKey(state, key = {}) {
  const name = key.name
  const sequence = key.sequence ?? ''
  if ((key.ctrl && name === 'c') || sequence === '\u0003') return { state, action: 'cancel' }
  if ((name === 'escape' || name === 'q') && state.buffer === '') return { state, action: 'cancel' }
  if (name === 'up') return { state: { ...state, cursor: Math.max(0, state.cursor - 1), error: '' }, action: 'stay' }
  if (name === 'down') return { state: { ...state, cursor: Math.min(state.agents.length, state.cursor + 1), error: '' }, action: 'stay' }
  if ((name === 'space' || sequence === ' ') && state.buffer === '') {
    const rowId = state.cursor === 0 ? 'all' : state.agents[state.cursor - 1]?.id
    if (!rowId) return { state, action: 'stay' }
    return { state: { ...state, selection: toggleSelection(state.selection, rowId, state.agents), error: '' }, action: 'stay' }
  }
  if (name === 'return') {
    if (state.buffer.trim() === '') return { state, action: 'confirm', ids: [...state.selection.ids] }
    try {
      return { state: { ...state, buffer: '', error: '' }, action: 'confirm', ids: parseSelection(state.buffer, state.agents) }
    } catch (error) {
      return { state: { ...state, buffer: '', error: error.message }, action: 'stay' }
    }
  }
  if (name === 'backspace') return { state: { ...state, buffer: state.buffer.slice(0, -1), error: '' }, action: 'stay' }
  if (sequence.length === 1 && sequence >= ' ' && sequence <= '~') {
    return { state: { ...state, buffer: state.buffer + sequence, error: '' }, action: 'stay' }
  }
  return { state, action: 'stay' }
}

function renderPicker(state, { title, allLabel }) {
  const rows = [{ id: 'all', label: allLabel, state: '', aliases: [] }, ...state.agents]
  const lines = [title, '']
  for (const [index, row] of rows.entries()) {
    const checked = index === 0 ? state.selection.all : state.selection.ids.includes(row.id)
    const cursor = state.cursor === index ? '>' : ' '
    const box = checked ? '[x]' : '[ ]'
    const id = index === 0 ? ''.padEnd(13) : row.id.padEnd(13)
    const aliases = row.aliases.length ? `  ${row.aliases.join(', ')}` : ''
    const detail = row.state ? `  ${row.state}` : ''
    lines.push(`${cursor} ${box} ${String(index + 1).padEnd(2)} ${id}${row.label.padEnd(18)}${detail}${aliases}`)
  }
  lines.push('')
  lines.push('Space toggles. Enter confirms. Type a number, name, or alias, then Enter. Esc cancels.')
  if (state.buffer) lines.push(`> ${state.buffer}`)
  if (state.error) lines.push(state.error)
  return lines
}

/** The checkbox list. Resolves to the chosen ids, or null when cancelled. */
export function promptChoices(agents, { title, allLabel, input = process.stdin, output = process.stdout } = {}) {
  return new Promise(resolve => {
    if (!input.isTTY) {
      resolve(null)
      return
    }
    readline.emitKeypressEvents(input)
    input.setRawMode(true)
    input.resume()
    let state = pickerState(agents)
    let drawn = 0
    const paint = () => {
      const lines = renderPicker(state, { title, allLabel })
      const height = Math.max(lines.length, drawn)
      if (drawn > 0) output.write(`\x1b[${drawn}A`)
      for (let index = 0; index < height; index++) output.write(`\x1b[2K${lines[index] ?? ''}\n`)
      drawn = height
    }
    const finish = result => {
      input.off('keypress', onPress)
      input.setRawMode(false)
      input.pause()
      resolve(result)
    }
    const onPress = (_text, key) => {
      const next = onKey(state, key)
      state = next.state
      if (next.action === 'cancel') return finish(null)
      if (next.action === 'confirm') return finish(next.ids)
      paint()
    }
    input.on('keypress', onPress)
    paint()
  })
}

const NPX_MESSAGE = 'this runs from the npx cache, which can be cleared. Install it first: npm install -g @jonathanjuliani/skillverse'

function printAgentList(home, isRemove) {
  if (isRemove) {
    const agents = choicesFor('remove', home)
    if (agents.length === 0) {
      console.log('Skillverse is not installed for any agent.')
      console.log('Claude Code sends live events through the Skillverse plugin.')
      return
    }
    console.log('Skillverse is installed for:')
    for (const one of agents) console.log(`  ${one.id.padEnd(12)} ${one.label.padEnd(16)} ${one.state}`)
    console.log('Remove them with: skillverse remove --all')
    console.log('Or name them: skillverse remove <agent> [<agent>...]')
    return
  }
  console.log('Agents that can send live events to the web app:')
  for (const one of setupStatus(home)) {
    const state = one.isSetUp ? 'installed' : one.isInstalled ? 'available' : 'not on this machine'
    console.log(`  ${one.id.padEnd(12)} ${one.label.padEnd(16)} ${state}`)
  }
  console.log('Claude Code sends them through the Skillverse plugin.')
  console.log('Install the available ones with: skillverse install --all')
  console.log('Or name them: skillverse install <agent> [<agent>...]')
}

function applyAgent(id, { isRemove, isPrint, home }) {
  const known = setupFor(id)
  const label = labelFor(known.id)
  const plan = planSetup(known.id, { home, isUndo: isRemove })
  const othersSetUp = setupStatus(home)
    .filter(one => one.id !== known.id && one.isSetUp)
    .map(one => one.id)
  const skill = planSkill(known.id, { home, isUndo: isRemove, othersSetUp })
  const backup = `${plan.file}.skillverse-backup`
  const where = file => tilde(file, home)

  if (isPrint) {
    for (const one of [plan, skill]) {
      const what = one.after === null ? '(removed)' : one.after
      console.log(`${where(one.file)}${one.isChanged ? '' : ' (no change)'}:\n${what}`)
    }
    if (isRemove && fs.existsSync(backup)) console.log(`${where(backup)}:\n(removed)`)
    return
  }

  applySetup(plan)
  applySetup(skill)
  if (isRemove) {
    let removed = false
    if (plan.isChanged) {
      removed = true
      console.log(plan.isOwned ? `Removed ${where(plan.file)}.` : `Removed Skillverse's hooks from ${where(plan.file)}.`)
      if (plan.after === null) removeEmptyOwnedDir(path.dirname(plan.file))
    }
    if (skill.isChanged) {
      removed = true
      console.log(`Removed the /skillverse skill (${where(skill.file)}).`)
      removeEmptyOwnedDir(path.dirname(skill.file))
    }
    if (fs.existsSync(backup)) {
      fs.rmSync(backup)
      removed = true
      console.log(`Removed ${where(backup)}.`)
    }
    if (!removed) console.log(`${label} had nothing Skillverse installed.`)
    return
  }
  if (!plan.isChanged) console.log(`${label} is already installed; ${where(plan.file)} is unchanged.`)
  else {
    console.log(`${label} now sends its live events to the web app (${where(plan.file)}). Start the web app with skillverse run.`)
    if (known.note) console.log(known.note)
    if (plan.before !== undefined && !plan.isOwned) console.log(`The previous file is in ${where(backup)}.`)
  }
  if (skill.isChanged) console.log(`Type /skillverse in ${label} to see what it has (${where(skill.file)}).`)
  if (skill.isTheirs) console.log(`${where(skill.file)} is someone else's skill, so the /skillverse skill was not written.`)
}

/**
 * Install Skillverse's hooks and `/skillverse` skill, or remove them.
 * Names and `--all` skip the prompt. With neither, a terminal asks (everything
 * checked); anything else prints the list and writes nothing.
 */
export async function install(
  names = [],
  { isRemove = false, isPrint = false, isAll = false, home = os.homedir(), ask = promptChoices, isTTY = Boolean(process.stdin.isTTY) } = {},
) {
  const mode = isRemove ? 'remove' : 'install'
  const agents = choicesFor(mode, home)
  let ids
  if (names.length > 0) {
    ids = []
    for (const name of names) {
      const id = setupFor(name).id
      if (!ids.includes(id)) ids.push(id)
    }
    if (!isRemove) {
      for (const id of ids) {
        if (!installed(id, home))
          throw new Error(`${labelFor(id)} is not installed here (none of its folders exist), so there is nothing to install`)
      }
    }
  } else if (isAll) ids = agents.map(one => one.id)
  else if (!isTTY || agents.length === 0) {
    printAgentList(home, isRemove)
    return
  } else {
    if (!isRemove && !isPrint && isNpxCache()) throw new Error(NPX_MESSAGE)
    const title = isRemove ? 'Remove Skillverse from:' : 'Install live events for:'
    const allLabel = isRemove ? 'all' : 'all available'
    const picked = await ask(agents, { title, allLabel })
    if (picked === null) {
      console.log('Cancelled.')
      return
    }
    ids = picked
  }

  if (ids.length === 0) {
    console.log(isRemove ? 'Nothing to remove.' : 'Nothing to install.')
    return
  }
  if (!isRemove && !isPrint && isNpxCache()) throw new Error(NPX_MESSAGE)

  let failed = 0
  for (const id of ids) {
    try {
      applyAgent(id, { isRemove, isPrint, home })
    } catch (error) {
      console.error(`skillverse: ${error.message}`)
      failed += 1
    }
  }
  if (failed > 0) process.exitCode = 1
}
