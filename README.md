# Skillverse

See every skill your AI agents have, how they connect, and what they cost.

Skill files and this session's transcript stay on your machine. The web app listens on `127.0.0.1`. Prompts do not leave the machine. The page loads its graph libraries from jsDelivr. The detail is in [How it works](docs/how-it-works.md).

The plugin and the web app install separately. Use either or both. Pick one plugin route. A marketplace install and a folder both loaded show two buttons.

`npx skills add jonathanjuliani/skillverse` is not available until this repo has a skill.

## Install

Plugin, from the marketplace:

```text
/plugin marketplace add jonathanjuliani/skillverse
/plugin install skillverse@skillverse
```

Start a new session. The Skillverse button appears above the prompt.

Web app:

```bash
npm i -g @jonathanjuliani/skillverse
skillverse run
skillverse open
```

Every command is in [Install](docs/install.md).

## Live events from other agents

Claude Code sends live events through the plugin. For the agents below, the web app has to be running, then install once. Restart the agent afterward so it loads the hooks.

```bash
skillverse run
skillverse install
```

| Agent | Install |
| --- | --- |
| Cursor (editor and CLI) | `skillverse install cursor` |
| Codex (CLI and app) | `skillverse install codex`, then trust the hooks with `/hooks` |
| GitHub Copilot CLI and VS Code | `skillverse install copilot` |
| Gemini CLI | `skillverse install gemini` |
| Devin CLI | `skillverse install devin` |
| Windsurf | `skillverse install windsurf` |
| Antigravity | `skillverse install antigravity` |
| opencode | `skillverse install opencode` |

`skillverse install` with no names asks which agents, with every one on this machine already checked. `skillverse install --all` installs those without asking. `skillverse remove` takes the hooks, the `/skillverse` skill, and backups back the same way. `--print` previews the files. Cursor writes `~/.cursor/hooks.json`; a skill shows when a prompt starts with `/name` or the agent reads a `SKILL.md`. The file each command writes is in [Use](docs/use.md#live-activity-from-other-agents).

## Where it shows

- **Pane.** The Claude Code plugin, a mod of function hooks that draws its own UI. A Skillverse button opens a tree of this session's skills, what they cost, and which ones loaded.
- **Web app.** A page on localhost for every agent on the machine: orbit, a 3D graph, and a 2D graph.
- **Terminal app.** `/sv-it` is a full-screen globe, graph, and tree. `skillverse --agent codex` shows another agent's.
- **Other agents.** The install above sends their activity to the web app and adds a `/skillverse` skill that prints that agent's summary. `skillverse summary` prints it anywhere.
- **Editor panel.** The VS Code extension in [`vscode/`](vscode/) shows the web app in a side panel of VS Code, Cursor, Windsurf or Antigravity, on that editor's own agent.

## Release

A release is a tag on `main`. The steps are in [Develop](docs/develop.md).

Engineering skills are in [skilldeck](https://github.com/jonathanjuliani/skilldeck).

## Read next

- [Install](docs/install.md) — requirements, clone, commands, updating
- [Use](docs/use.md) — pane, web app, terminal
- [How it works](docs/how-it-works.md) — what it reads, privacy, limits
- [Develop](docs/develop.md) — local commands and releasing
- [Contributing](CONTRIBUTING.md) — plugin, CLI, and docs

MIT, see [LICENSE](LICENSE).
