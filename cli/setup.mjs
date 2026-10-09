// `skillverse setup <agent>`: writes the hooks that make an agent run
// `skillverse hook <agent>` on its events, into the agent's own config, and
// takes them out again with --undo. Everything else in the file stays as it
// was; the file is backed up first. Only hooks that observe are used: a
// permission hook that answered wrongly could block the agent.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AGENTS, isInstalled } from './agents.mjs'
import { readJson } from './shared.mjs'

const BIN = fileURLToPath(new URL('../bin/skillverse.mjs', import.meta.url))

/** Each agent setup knows: where its hooks live and which of its events to hook. */
export const SETUPS = {
  cursor: {
    file: home => path.join(home, '.cursor', 'hooks.json'),
    events: ['beforeSubmitPrompt', 'postToolUse'],
    empty: { version: 1, hooks: {} },
  },
}

/** The command an agent runs: absolute paths, since desktop apps often start without the shell's PATH. */
export const hookCommand = (agent, node = process.execPath, bin = BIN) => `"${node}" "${bin}" hook ${agent}`

/** Whether a hook entry is one Skillverse wrote for `agent`, wherever it was installed from. */
const isOurs = (entry, agent) =>
  typeof entry?.command === 'string' && entry.command.includes('skillverse') && entry.command.endsWith(` hook ${agent}`)

/** A folder npx runs packages from, which can be cleared at any time. */
export const isNpxCache = (dir = BIN) => /[\\/]_npx[\\/]/.test(dir)

/**
 * The agent's config with Skillverse's hooks added (or, with `isUndo`, taken
 * out). Returns the file, its text before and after (`before` undefined when
 * it does not exist yet), and whether anything changes.
 */
export function planSetup(agent, { home = os.homedir(), isUndo = false, command = hookCommand(agent) } = {}) {
  const known = SETUPS[agent]
  if (!known) throw new Error(`skillverse setup knows ${Object.keys(SETUPS).join(', ')}; not ${agent}`)
  const file = known.file(home)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
  let config
  try {
    config = before === undefined || before.trim() === '' ? structuredClone(known.empty) : JSON.parse(before)
  } catch {
    throw new Error(`${file} is not valid JSON; fix it first, Skillverse will not rewrite it`)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${file} is not a JSON object`)
  config.hooks ??= {}

  for (const event of known.events) {
    const others = (Array.isArray(config.hooks[event]) ? config.hooks[event] : []).filter(entry => !isOurs(entry, agent))
    const list = isUndo ? others : [...others, { command }]
    if (list.length > 0) config.hooks[event] = list
    else delete config.hooks[event]
  }
  const after = `${JSON.stringify(config, null, 2)}\n`
  const isChanged = before === undefined ? !isUndo : JSON.stringify(JSON.parse(before || '{}')) !== JSON.stringify(config)
  return { file, before, after, isChanged }
}

/** Writes a planned change, backing the old file up next to it. */
export function applySetup({ file, before, after, isChanged }) {
  if (!isChanged) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (before !== undefined) fs.writeFileSync(`${file}.skillverse-backup`, before)
  fs.writeFileSync(file, after)
}

/** Every agent setup knows: installed here, and set up or not. */
export function setupStatus(home = os.homedir()) {
  return Object.keys(SETUPS).map(id => {
    const agent = AGENTS.find(one => one.id === id)
    const hooks = readJson(SETUPS[id].file(home))?.hooks ?? {}
    const isSetUp = SETUPS[id].events.some(event => Array.isArray(hooks[event]) && hooks[event].some(entry => isOurs(entry, id)))
    return { id, label: agent?.label ?? id, isInstalled: agent ? isInstalled(agent, home) : false, isSetUp }
  })
}

const tilde = file => file.replace(os.homedir(), '~')

/** The command: list the agents, or set one up, print the change, or undo it. */
export function setup(agent, { isUndo = false, isPrint = false, home = os.homedir() } = {}) {
  if (!agent) {
    console.log('Agents that can send live events to the web app:')
    for (const one of setupStatus(home)) {
      const state = one.isSetUp ? 'set up' : one.isInstalled ? 'not set up' : 'not installed'
      console.log(`  ${one.id.padEnd(10)} ${one.label.padEnd(16)} ${state}`)
    }
    console.log('Claude Code sends them through the Skillverse plugin. Set one up with: skillverse setup <agent>')
    return
  }
  if (!isUndo && !isPrint && isNpxCache()) {
    throw new Error('this runs from the npx cache, which can be cleared. Install it first: npm install -g @jonathanjuliani/skillverse')
  }
  const plan = planSetup(agent, { home, isUndo })
  if (isPrint) return console.log(`${tilde(plan.file)}${plan.isChanged ? '' : ' (no change)'}:\n${plan.after}`)
  applySetup(plan)
  const label = AGENTS.find(one => one.id === agent)?.label ?? agent
  if (!plan.isChanged) return console.log(`${label} is already ${isUndo ? 'not set up' : 'set up'}; ${tilde(plan.file)} is unchanged.`)
  console.log(
    isUndo
      ? `Removed Skillverse's hooks from ${tilde(plan.file)}.`
      : `${label} now sends its live events to the web app (${tilde(plan.file)}). Start the web app with skillverse run.`,
  )
  if (plan.before !== undefined) console.log(`The previous file is in ${tilde(plan.file)}.skillverse-backup.`)
}
