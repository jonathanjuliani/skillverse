# How it works

Which skills each surface reads, how links and costs are counted, and what stays on your machine.
Open this when you want the map, not a button to press.
Back to [Skillverse](../README.md).

## Which skills

In the plugin, the list is the session's own skill listing (the one `/context` counts), plus the skill folders under `~/.claude/skills`, the project's `.claude/skills`, and each listed plugin. Each `SKILL.md` is read for its description and content.

The web app finds each agent's own folders at home. It never reads a project's folders: the web app is the machine-wide view. An agent is shown when its folder exists.

| Agent | Plugins | Your skills | Built-in | Connectors (MCP) |
| --- | --- | --- | --- | --- |
| Claude Code (`~/.claude`) | turned on in `settings.json`, folders in its `CLAUDE_CODE_PLUGIN_DIRS`, and your organization's synced plugins (`plugins/synced/`, under **Organization**) | `skills/` | from a session with the plugin | `~/.claude.json`, each plugin's `.mcp.json` |
| Codex (`~/.codex`) | `config.toml`'s `[plugins]`, and those installed from its directory | `skills/` | `skills/.system`, the plugins it ships with | `config.toml`'s `[mcp_servers]`, plugins' servers and apps |
| Cursor (`~/.cursor`) | `plugins/cache`, `plugins/local` | `skills/` | `skills-cursor/` | `mcp.json`, plugins' `mcp.json` |
| Gemini CLI (`~/.gemini`) | `extensions/` | `skills/` | | `settings.json`, extensions' servers |
| GitHub Copilot (`~/.copilot`) | `installed-plugins/` | `skills/` | | `mcp-config.json` |
| opencode (`~/.config/opencode`) | | `skills/` | | `opencode.json`'s `mcp` |
| Windsurf (`~/.codeium/windsurf`) | | `skills/` | | `mcp_config.json` |
| Shared (`~/.agents`) | | `skills/`, grouped by the repo each came from | | |

A connector is read by its name and how it is reached (`http · host` or `stdio · command`) only. Its command line, headers, environment, and keys are never read into the page. A Claude Code session with the plugin replaces the Claude Code part with its exact list (built-ins and claude.ai connectors included, project skills left out). The connectors on disk stay.

## Links

A skill links to another when its text names it: a full `plugin:name`, a `/name`, or a hyphenated name. It is a heuristic: some links are missed, a few are coincidental. Skills with the same name under two agents are **twins**, linked across agents.

## Context and skills used

Context figures are Claude Code's own context breakdown, estimated locally. _New empty session_ is the same breakdown without the conversation.

Skills used are counted from this session's transcript (Skill tool calls and typed `/skill` commands), then live as skills load. Skills used inside subagents are not counted.

## Privacy and security

Nothing leaves your machine except the web app's requests for its graph libraries (jsDelivr).

- Skillverse reads your skill files and this session's transcript locally. It writes only to `~/.cache/skillverse/`: the skill list for the terminal app, and the web app's pid, port, and log.
- The web app listens on `127.0.0.1` only, answers only requests addressed to `localhost` or `127.0.0.1` (so a web page cannot reach it by DNS rebinding), and grants no cross-origin access. No other site can read your skills or the live event stream.
- Live events (which skill loaded, in which turn) are kept in memory only.

## Limitations

- The plugin API is early access. See [Requirements](install.md#requirements).
- On the desktop app the pane cannot draw graphs that take clicks. The graphs live in the web app and the terminal app.
- The links between skills are inferred from their text. See [Links](#links).
- Live activity comes from Claude Code sessions only. The other agents' planets show what they have, not their activity. Their costs are estimates.
- A connector's tools are listed by its agent when it runs, so what they cost in context is not counted.
- Claude Code's built-in skills are not on disk. They show once a session with the plugin sends its list. The other agents' folder layouts are read as they are today and may change with their releases.
