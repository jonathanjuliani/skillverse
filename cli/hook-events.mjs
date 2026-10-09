// Turns what an agent's hook receives into Skillverse's live events. Only
// Claude Code says which skill loaded; for the others a skill is spotted from
// a prompt that invokes it (`/name`, Codex's `$name`, Windsurf's `@name`), a
// skill tool's call (`Skill`, `skill`, `activate_skill`), or a tool that reads
// a SKILL.md. Only names leave: never a prompt, a file's content, a command or
// a path beyond a skill's name.

import path from 'node:path'

const NAME = '([A-Za-z0-9][\\w.-]*(?::[\\w.-]+)?)'
// A SKILL.md inside a skills folder (`skills/`, `skills-cursor/`, `.system/` under one), anywhere in a string.
const SKILL_FILE = /skills[\w-]*[\\/](?:[^\s"'\\/]+[\\/])*?([^\s"'\\/]+)[\\/]SKILL\.md\b/i
const SKILL_TOOLS = new Set(['Skill', 'skill', 'activate_skill'])

/** The skill a prompt starts by invoking (`/review the diff` → `review`), with the agent's sigils; or undefined. */
export function promptSkill(prompt, sigils = '/') {
  if (typeof prompt !== 'string') return undefined
  const escaped = [...sigils].map(sigil => `\\${sigil}`).join('')
  return prompt.match(new RegExp(`^\\s*[${escaped}]${NAME}(?:\\s|$)`))?.[1]
}

/** The skill whose SKILL.md a tool's input names, looked for in its strings a few levels down. */
export function skillFileIn(value, depth = 0) {
  if (typeof value === 'string') return value.match(SKILL_FILE)?.[1]
  if (!value || typeof value !== 'object' || depth > 3) return undefined
  for (const item of Object.values(value)) {
    const found = skillFileIn(item, depth + 1)
    if (found) return found
  }
  return undefined
}

/** The skill a tool call loads: a skill tool's `skill` or `name`, or a SKILL.md it reads. */
export function toolSkill(name, input) {
  if (SKILL_TOOLS.has(name) && input && typeof input === 'object') {
    const named = input.skill ?? input.name
    if (typeof named === 'string') return named
  }
  return skillFileIn(input)
}

const folderName = dir => (typeof dir === 'string' && dir ? path.basename(dir) : undefined)
const turnWith = (skill, base) => [{ kind: 'turn', ...base }, ...(skill ? [{ kind: 'skill', skill, ...base }] : [])]
const skillOf = (skill, base) => (skill ? [{ kind: 'skill', skill, ...base }] : [])

const PROMPT_EVENTS = new Set(['UserPromptSubmit', 'BeforeAgent'])
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'AfterTool'])

/**
 * Claude Code's hook shape and the agents that copy it (Codex, Devin, Copilot
 * and VS Code with PascalCase events, Gemini CLI with its own event names):
 * hook_event_name, session_id, cwd, prompt, tool_name, tool_input.
 */
const claudeLike =
  ({ sigils = '/' } = {}) =>
  (input, { env }) => {
    const base = {
      session: input.session_id ?? input.sessionId,
      project: folderName(input.cwd ?? env.DEVIN_PROJECT_DIR ?? env.GEMINI_PROJECT_DIR),
    }
    const event = input.hook_event_name
    if (PROMPT_EVENTS.has(event)) return turnWith(promptSkill(input.prompt, sigils), base)
    if (TOOL_EVENTS.has(event)) return skillOf(toolSkill(input.tool_name ?? input.toolName, input.tool_input ?? input.toolArgs), base)
    if (event === 'SubagentStart' && input.agent_id) return [{ kind: 'agent', agent: input.agent_id, agentType: input.agent_type, ...base }]
    return []
  }

/** Cursor: hook_event_name, conversation_id, workspace_roots, prompt, tool_*. */
function cursor(input) {
  const base = { session: input.conversation_id ?? input.session_id, project: folderName(input.workspace_roots?.[0] ?? input.cwd) }
  if (input.hook_event_name === 'beforeSubmitPrompt') return turnWith(promptSkill(input.prompt), base)
  if (input.hook_event_name === 'postToolUse') return skillOf(toolSkill(input.tool_name, input.tool_input), base)
  return []
}

/** Windsurf's Cascade: agent_action_name, trajectory_id, tool_info; the hook runs in the workspace. */
function windsurf(input, { cwd }) {
  const base = { session: input.trajectory_id, project: folderName(cwd) }
  if (input.agent_action_name === 'pre_user_prompt') return turnWith(promptSkill(input.tool_info?.user_prompt, '@/'), base)
  if (input.agent_action_name === 'post_read_code') return skillOf(skillFileIn(input.tool_info?.file_path), base)
  return []
}

/** Antigravity: conversationId, workspacePaths, toolCall {name, args}; it has no prompt hook. */
function antigravity(input) {
  const base = { session: input.conversationId, project: folderName(input.workspacePaths?.[0]) }
  const call = input.toolCall
  return call ? skillOf(toolSkill(call.name, call.args), base) : []
}

/** opencode: what Skillverse's opencode plugin passes on from `tool.execute.before`. */
function opencode(input) {
  const base = { session: input.session, project: folderName(input.directory) }
  return input.tool ? skillOf(toolSkill(input.tool, input.args), base) : []
}

/** Each agent's hook shape. Copilot's covers VS Code too: both read `~/.copilot/hooks/`. */
const FORMATS = {
  claude: claudeLike(),
  codex: claudeLike({ sigils: '$/' }),
  devin: claudeLike(),
  copilot: claudeLike(),
  gemini: claudeLike(),
  cursor,
  windsurf,
  antigravity,
  opencode,
}

/** The agents `skillverse hook` reads. */
export const HOOK_AGENTS = Object.keys(FORMATS)

/** What a hook prints: Gemini CLI and Antigravity read a hook's stdout as JSON; the rest want nothing. */
export const REPLIES = { gemini: '{}', antigravity: '{}' }

/** The events one hook call means, each marked with its source (the agent); [] for anything else. */
export function toEvents(agent, input, { env = process.env, cwd = process.cwd() } = {}) {
  const format = FORMATS[agent]
  if (!format || !input || typeof input !== 'object') return []
  return format(input, { env, cwd }).map(event =>
    Object.fromEntries(Object.entries({ ...event, source: agent }).filter(([, value]) => typeof value === 'string' && value)),
  )
}
