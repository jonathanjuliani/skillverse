// Turns what an agent's shell hook receives on stdin into Skillverse's live
// events. Only Claude Code says which skill loaded; for the others a skill is
// spotted from a prompt that starts with `/name`, a tool that reads a
// SKILL.md, or a `Skill` tool call. Only names leave: never a prompt, a file's
// content, a command or a path beyond a skill's name.

import path from 'node:path'

const SLASH = /^\s*\/([A-Za-z0-9][\w.-]*(?::[\w.-]+)?)(?:\s|$)/
// `skills/`, and an agent's own folder for its built-ins (Cursor's `skills-cursor/`).
const SKILL_FILE = /(?:^|[\\/])skills(?:-[\w-]+)?[\\/]([^\\/]+)[\\/]SKILL\.md$/i

/** The skill a prompt invokes (`/review the diff` → `review`), or undefined. */
export function slashSkill(prompt) {
  return typeof prompt === 'string' ? prompt.match(SLASH)?.[1] : undefined
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

/** The skill a tool call loads: a `Skill` tool's `skill`, or a SKILL.md it reads. */
function toolSkill(name, input) {
  if (name === 'Skill' && typeof input?.skill === 'string') return input.skill
  return skillFileIn(input)
}

const folderName = dir => (typeof dir === 'string' && dir ? path.basename(dir) : undefined)

/** Claude Code's shell-hook shape, which other agents copy: hook_event_name, session_id, cwd, prompt, tool_*. */
function claudeFormat(input) {
  const base = { session: input.session_id, project: folderName(input.cwd) }
  switch (input.hook_event_name) {
    case 'UserPromptSubmit': {
      const skill = slashSkill(input.prompt)
      return [{ kind: 'turn', ...base }, ...(skill ? [{ kind: 'skill', skill, ...base }] : [])]
    }
    case 'PreToolUse': {
      const skill = toolSkill(input.tool_name, input.tool_input)
      return skill ? [{ kind: 'skill', skill, ...base }] : []
    }
    case 'SubagentStart':
      return input.agent_id ? [{ kind: 'agent', agent: input.agent_id, agentType: input.agent_type, ...base }] : []
    default:
      return []
  }
}

/** Cursor's: hook_event_name, conversation_id, workspace_roots, prompt, tool_*. */
function cursorFormat(input) {
  const base = {
    session: input.conversation_id ?? input.session_id,
    project: folderName(input.workspace_roots?.[0] ?? input.cwd),
  }
  switch (input.hook_event_name) {
    case 'beforeSubmitPrompt': {
      const skill = slashSkill(input.prompt)
      return [{ kind: 'turn', ...base }, ...(skill ? [{ kind: 'skill', skill, ...base }] : [])]
    }
    case 'postToolUse': {
      const skill = toolSkill(input.tool_name, input.tool_input)
      return skill ? [{ kind: 'skill', skill, ...base }] : []
    }
    default:
      return []
  }
}

/** Each agent's hook shape. */
const FORMATS = { claude: claudeFormat, cursor: cursorFormat }

/** The agents `skillverse hook` reads. */
export const HOOK_AGENTS = Object.keys(FORMATS)

/** The events one hook call means, each marked with its source (the agent); [] for anything else. */
export function toEvents(agent, input) {
  const format = FORMATS[agent]
  if (!format || !input || typeof input !== 'object') return []
  return format(input).map(event =>
    Object.fromEntries(Object.entries({ ...event, source: agent }).filter(([, value]) => typeof value === 'string' && value)),
  )
}
