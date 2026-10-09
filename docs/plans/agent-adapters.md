# Plan: an adapter for each agent

Status: **planned**; starts when [agent-events.md](agent-events.md) is done. Second of three.

## Goal

`skillverse setup <agent>` and `skillverse hook <agent>` work for every agent below, each checked in the real tool, so its planet in the web app lights up when its skills are used.

## The agents

| Agent | Surfaces | Hooks | Config Skillverse writes | Mapper | Notes |
|---|---|---|---|---|---|
| Claude Code | CLI, desktop, IDE | The plugin | None: the plugin sends events | n/a | Done |
| Cursor | IDE, CLI (`agent`) | `hooks.json` | `~/.cursor/hooks.json` | `cursor` | Done in [agent-events.md](agent-events.md); the CLI reads the same file |
| Devin | CLI, cloud | `hooks.v1.json`, Claude Code compatible | `~/.config/devin/hooks.v1.json` | `claude-format` | Check the user-level file name |
| GitHub Copilot | CLI, VS Code | Hooks in both | Copilot CLI's user config; VS Code below | to check | Its payload may follow Claude Code's |
| VS Code | IDE | Agent hooks (preview) | User-level hooks file | to check | The schema depends on the agent harness picked in chat |
| Codex | CLI, desktop, VS Code | Hooks; plugins can bundle them | `~/.codex/config.toml` or a Codex plugin | `codex` | TOML: merge with care, or ship a plugin instead |
| Gemini CLI | CLI | Hooks, also inside extensions (experimental) | A Gemini extension with `hooks/hooks.json` | `gemini` | An extension keeps `settings.json` untouched |
| Windsurf | IDE | Cascade hooks, 12 events | `~/.codeium/windsurf/hooks.json` (check) | `windsurf` | `pre_read_code` can spot a `SKILL.md` read |
| opencode | TUI, desktop | JS plugins; an SSE stream (`/event`) | `~/.config/opencode/plugin/skillverse.js` | in the plugin | A plugin is JS, so it can post events itself |
| Antigravity | IDE, CLI | Docs list Hooks, Plugins, Skills | to find out | to find out | Research spike first |

"To check" means the docs found so far do not show it; each adapter starts by reading the tool's current docs and recording one real payload into `tests/fixtures/hooks/<agent>/`.

## Per agent, the same steps

1. Read the current docs; save one real payload for each hook used.
2. Map it (`cli/hook-events.mjs`), with a unit test on the saved payloads.
3. Add it to `skillverse setup`: where its config lives, which hooks are not permission hooks, how its file merges.
4. Try it for real: a typed `/skill` and a skill the agent loads on its own.
5. README's agents table: a "Live" column, and how to turn it on.

## Order

| # | Agent | Why then |
|---|---|---|
| 1 | Devin, Copilot CLI | Close to Claude Code's format: mostly config |
| 2 | VS Code | Same file reaches Copilot in VS Code |
| 3 | Codex | Many users; TOML or a plugin |
| 4 | Gemini CLI | An extension, so its own package layout |
| 5 | opencode | A JS plugin, different from the rest |
| 6 | Windsurf | Its own event names |
| 7 | Antigravity | After a research spike: its hooks and plugin format |

## Open questions

- Which agents report skill use directly (as Claude Code's `Skill` tool does), so the hook need not infer it? Check each during step 1.
- Codex: write into `config.toml`, or ship hooks as a Codex plugin? A plugin is cleaner if Codex lets it run commands on every event.
- Whether to also scan Devin and Antigravity's skills folders for their planets (`AGENTS` in `cli/agents.mjs`): needed for their events to have skills to match.

## Exit

Each agent in the table either lights up its planet in a real session, or has a line in the README saying why it cannot yet.
