# Plan: Skillverse inside every agent

Status: **planned**; after [agent-events.md](agent-events.md), and alongside [agent-adapters.md](agent-adapters.md). Third of three.

## Goal

Someone using any agent can see what Claude Code's pane shows (the agent's skills, its categories and costs, and live activity) without leaving it, or with one step. The web app stays the full view and, for terminal-only agents, the default.

## Where each agent can show it

| Agent | Panel in the tool | Otherwise |
|---|---|---|
| Claude Code | The pane (done) | Web app |
| Cursor, Windsurf, Antigravity | A VS Code extension (they are VS Code-based) | Web app |
| VS Code (Copilot, Codex extension) | The same VS Code extension | Web app |
| Codex, Gemini, Copilot, Devin CLIs, opencode TUI | None | Web app; the terminal app in a split pane; the `/skillverse` skill |
| Codex desktop, opencode desktop | None found | Web app; the `/skillverse` skill |

## Parts

### 1. A `/skillverse` skill for every agent (small)

A `SKILL.md` every agent reads (`~/.agents/skills`, and each agent's own folder where it does not read the shared one). It runs `skillverse summary --agent <id>`, which prints the planet's summary as text: plugins, skills, connectors, categories, the listing cost, and the web app's address when it runs, or how to start it.

- New: `skillverse summary [--agent <id>] [--json]`, built on `web/js/summary.js`'s figures (moved where the CLI can import them).
- `skillverse setup <agent>` offers to install the skill too.

### 2. A VS Code extension (medium to large)

A webview panel that shows the web view of the running web app, focused on the editor's agent (Cursor's planet in Cursor), with a status bar item that opens it. When the web app is not running, the panel offers to start it.

- Published to the VS Code Marketplace and to Open VSX, which Cursor, Windsurf and Antigravity install from.
- A `?agent=<id>&embed=1` mode in the web view: no planet switcher, one card at a time, sized for a side panel.
- Its own folder (`vscode/`) and build; the rest of the repo keeps no build step.

### 3. The terminal app for every agent (small)

The terminal app (`skillverse`) shows Claude Code's skills. Give it `--agent <id>` to show another planet's, so a CLI user can keep it in a split pane.

### Later

- **Status lines**, where an agent has one (Claude Code, Cursor CLI): a count of skills used this session.
- **MCP App view**, where a host draws MCP UI: the summary as an MCP App, from a small Skillverse MCP server.

## Order

| # | Part | Value | Size |
|---|---|---|---|
| 1 | `skillverse summary` and the `/skillverse` skill | Something in every agent, quickly | S |
| 2 | Terminal app `--agent` | Terminal-only agents get the full view in a pane | S |
| 3 | Web view embed mode | Needed by the extension, also a tidy small window | S |
| 4 | VS Code extension | A real panel in four IDEs | M–L |
| 5 | Status lines, MCP App | Extras | S–M |

## Exit

In each agent, the `/skillverse` skill prints that agent's summary; in VS Code and Cursor the extension's panel shows the agent's planet with live activity.
