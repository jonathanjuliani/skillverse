# Plan: an adapter for each agent

Status: **built; each agent still to be tried for real** (branch `feat/agent-events`). Second of three.

## Goal

`skillverse setup <agent>` and `skillverse hook <agent>` work for every agent below, each checked in the real tool, so its planet in the web app lights up when its skills are used.

## The agents

What each agent's docs say, as built. "Inferred" marks what the docs leave out and a real session must confirm.

| Agent | Surfaces | Skillverse writes | Hooks used | Payload | A skill shows when | Notes |
|---|---|---|---|---|---|---|
| Claude Code | CLI, desktop, IDE | Nothing: the plugin sends events | n/a | n/a | Its `Skill` tool | Done before this plan |
| Cursor | IDE, CLI | `~/.cursor/hooks.json` (merged) | `beforeSubmitPrompt`, `postToolUse` | Its own (`conversation_id`, `workspace_roots`) | `/name`; a `SKILL.md` read | Done in [agent-events.md](agent-events.md) |
| Codex | CLI, app, VS Code | `~/.codex/hooks.json` (merged) | `UserPromptSubmit`, `PostToolUse` | Claude Code's, plus `turn_id` | `$name` or `/name`; a `SKILL.md` read in a shell command (inferred: it has no skill tool) | Each hook must be trusted once with `/hooks` |
| Devin | CLI | `~/.config/devin/config.json` `hooks` (merged) | `UserPromptSubmit`, `PostToolUse` | Claude Code's, no `cwd` (`DEVIN_PROJECT_DIR`) | `/name` (inferred); its `skill` tool (input field inferred: `skill` or `name`); a `SKILL.md` read | Devin also runs the hooks in `~/.claude/settings.json`, so Skillverse never writes there |
| GitHub Copilot | CLI, VS Code | `~/.copilot/hooks/skillverse.json` (its own) | `UserPromptSubmit`, `PostToolUse` (Claude Code's names, so Claude Code's fields) | Claude Code's | `/name` (inferred); a `SKILL.md` read | One file serves the CLI and VS Code's agent hooks; both count as Copilot |
| Gemini CLI | CLI | `~/.gemini/settings.json` `hooks` (merged) | `BeforeAgent`, `AfterTool` | Claude Code's field names | `activate_skill`'s `name` | The hook answers `{}` |
| Windsurf | IDE | `~/.codeium/windsurf/hooks.json` (merged) | `pre_user_prompt`, `post_read_code` | Its own (`trajectory_id`, `tool_info`) | `@name` (inferred); a `SKILL.md` read (inferred) | No cwd in the payload: the hook runs in the workspace |
| Antigravity | App, IDE, CLI | `~/.gemini/config/hooks.json` group `skillverse` (merged) | `PostToolUse` | camelCase (`conversationId`, `toolCall`) | A `view_file` of a `SKILL.md` | No prompt hook, so no `/name` and no turns. The hook answers `{}` |
| opencode | TUI, desktop | `~/.config/opencode/plugins/skillverse.js` (its own) | `tool.execute.before` | What the plugin passes on | Its `skill` tool's `name`; a `SKILL.md` read | A JS plugin, not a shell hook; no turns (no documented prompt hook) |

Devin and Antigravity are new planets (`cli/agents.mjs`), so their events have skills to match. A skill read from `~/.agents/skills` matches on the Shared planet. A name that matches nothing is left out of the feed for every agent but Claude Code, since the others' hooks guess.

## Left to do

1. Try each agent for real, as the user: set it up, type a `/skill` (or `$`, `@`), let it load one on its own, and check the Live card. Record one real payload per hook into `tests/fixtures/hooks/<agent>/` and replace the doc-based payloads in `tests/unit/hook.spec.ts`.
2. Settle each "inferred" in the table from that run.
3. Subagents for the agents that report them without a permission hook (Codex and Copilot's `SubagentStart`).
4. opencode turns: find the event that carries a user message (`message.updated`), if one does.

## Exit

Each agent in the table either lights up its planet in a real session, or has a line in the README saying why it cannot yet.
