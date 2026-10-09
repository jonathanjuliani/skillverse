// `skillverse setup <agent>`: writes the hooks that make an agent run
// `skillverse hook <agent>` on its events, into the agent's own config, and
// takes them out again with --undo. In a shared file everything else stays as
// it was, and the file is backed up first; a file of Skillverse's own
// (Copilot's hooks, opencode's plugin) is written whole and removed on undo.
// Only hooks that observe are used: a permission hook that answered wrongly
// could block the agent.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AGENTS, isInstalled } from './agents.mjs'

const BIN = fileURLToPath(new URL('./skillverse.mjs', import.meta.url))
const HOOK_MODULE = fileURLToPath(new URL('./hook.mjs', import.meta.url))

// The entries each hook format takes, for one command.
const flat = command => ({ command })
const nested = (command, extra = {}) => ({ matcher: '', hooks: [{ type: 'command', command, timeout: 10, ...extra }] })

/** The opencode plugin: it hands each tool call to Skillverse and never waits on it or fails the tool. */
const opencodePlugin = ({ hookModule }) => `// Written by \`skillverse setup opencode\`; \`skillverse setup opencode --undo\` removes it.
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

/** Other names people use for an agent setup knows: VS Code's agent hooks are Copilot's. */
const ALIASES = { vscode: 'copilot', 'github-copilot': 'copilot', cascade: 'windsurf', agy: 'antigravity' }

/** The command an agent runs: absolute paths, since desktop apps often start without the shell's PATH. */
export const hookCommand = (agent, node = process.execPath, bin = BIN) => `"${node}" "${bin}" hook ${agent}`

/** Whether a hook entry is one Skillverse wrote for `agent`, wherever it was installed from. */
const isOurs = (entry, agent) => {
  const text = JSON.stringify(entry ?? '')
  return text.includes('skillverse') && new RegExp(` hook ${agent}(?![\\w-])`).test(text)
}

/** A folder npx runs packages from, which can be cleared at any time. */
export const isNpxCache = (dir = BIN) => /[\\/]_npx[\\/]/.test(dir)

/** An agent setup knows, by its id or another name for it; throws for one it does not. */
export function setupFor(name) {
  const id = ALIASES[name] ?? name
  if (!SETUPS[id]) throw new Error(`skillverse setup knows ${Object.keys(SETUPS).join(', ')} (and vscode); not ${name}`)
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
const SKILL_MARK = '<!-- Written by skillverse setup; skillverse setup <agent> --undo removes it. -->'

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
 * The `/skillverse` skill for an agent: written when missing, removed on undo
 * (the shared copy only once no other agent that reads it is still set up).
 * A SKILL.md there that Skillverse did not write is left alone.
 */
export function planSkill(id, { home = os.homedir(), isUndo = false, othersSetUp = [] } = {}) {
  const file = skillFile(id, home)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
  const isTheirs = before !== undefined && !before.includes(SKILL_MARK)
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

/** Every agent setup knows: installed here, and set up or not. */
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

const tilde = file => file.replace(os.homedir(), '~')

/** The command: list the agents, or set one up, print the change, or undo it. */
export function setup(name, { isUndo = false, isPrint = false, home = os.homedir() } = {}) {
  if (!name) {
    console.log('Agents that can send live events to the web app:')
    for (const one of setupStatus(home)) {
      const state = one.isSetUp ? 'set up' : one.isInstalled ? 'not set up' : 'not installed'
      console.log(`  ${one.id.padEnd(12)} ${one.label.padEnd(16)} ${state}`)
    }
    console.log('Claude Code sends them through the Skillverse plugin. Set one up with: skillverse setup <agent>')
    return
  }
  const known = setupFor(name)
  const label = AGENTS.find(one => one.id === known.id)?.label ?? known.id
  if (!isUndo && !installed(known.id, home)) {
    throw new Error(`${label} is not installed here (none of its folders exist), so there is nothing to set up`)
  }
  if (!isUndo && !isPrint && isNpxCache()) {
    throw new Error('this runs from the npx cache, which can be cleared. Install it first: npm install -g @jonathanjuliani/skillverse')
  }
  const plan = planSetup(known.id, { home, isUndo })
  const othersSetUp = setupStatus(home)
    .filter(one => one.id !== known.id && one.isSetUp)
    .map(one => one.id)
  const skill = planSkill(known.id, { home, isUndo, othersSetUp })
  if (isPrint) {
    for (const one of [plan, skill]) {
      const what = one.after === null ? '(removed)' : one.after
      console.log(`${tilde(one.file)}${one.isChanged ? '' : ' (no change)'}:\n${what}`)
    }
    return
  }
  applySetup(plan)
  applySetup(skill)
  if (isUndo) {
    if (plan.isChanged) console.log(plan.isOwned ? `Removed ${tilde(plan.file)}.` : `Removed Skillverse's hooks from ${tilde(plan.file)}.`)
    else console.log(`${label}'s hooks were not set up; ${tilde(plan.file)} is unchanged.`)
    if (skill.isChanged) console.log(`Removed the /skillverse skill (${tilde(skill.file)}).`)
    return
  }
  if (!plan.isChanged) console.log(`${label} is already set up; ${tilde(plan.file)} is unchanged.`)
  else {
    console.log(`${label} now sends its live events to the web app (${tilde(plan.file)}). Start the web app with skillverse run.`)
    if (known.note) console.log(known.note)
    if (plan.before !== undefined && !plan.isOwned) console.log(`The previous file is in ${tilde(plan.file)}.skillverse-backup.`)
  }
  if (skill.isChanged) console.log(`Type /skillverse in ${label} to see what it has (${tilde(skill.file)}).`)
  if (skill.isTheirs) console.log(`${tilde(skill.file)} is someone else's skill, so the /skillverse skill was not written.`)
}
