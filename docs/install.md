# Install

How to install the plugin, the web app, or both, and how to update them.
Open this when you are installing, cloning, or updating.
Back to [Skillverse](../README.md).

Pick one plugin route. A marketplace install and a folder both loaded show two buttons.

## Requirements

Skillverse runs on your own computer. The plugin runs in Claude Code in a terminal, in the desktop app's Code tab, or in the VS Code extension. It does not run on claude.ai: chat on claude.ai does not run Claude Code plugins, and Claude Code on the web (claude.ai/code) runs in a cloud container, so the pane is not shown there and a localhost web app on your machine is not reachable from it.

| | |
| --- | --- |
| **Claude Code 2.1.288 or newer** | For the plugin. It uses the function-hooks plugin API, which is early access: it can change between Claude Code releases without notice, and a release may break Skillverse until it is updated. |
| **macOS or Linux** | Windows is not supported yet (the plugin calls `find`, `grep` and `mkdir`). |
| **Node.js 22.18+** | For the web app and the terminal app. |
| **Internet** for the web app | The page loads its graph libraries from jsDelivr (pinned versions). The pane and the terminal app work offline. |

## The plugin

From the marketplace:

```text
/plugin marketplace add jonathanjuliani/skillverse
/plugin install skillverse@skillverse
```

`npx skills add jonathanjuliani/skillverse` does not install this repo yet. It waits until this repo has a skill.

Start a new session. The Skillverse button appears above the prompt.

Or from a clone: `claude --plugin-dir ~/skillverse` for one session, or for every session (the desktop app included) add the folder to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/skillverse"
  }
}
```

## The web app

```bash
npm install -g @jonathanjuliani/skillverse
skillverse run
skillverse open
```

| Command | Does |
| --- | --- |
| `skillverse run [web]` | Start the web app in the background; reports the one already running |
| `skillverse open` | Open it in the browser, starting it if needed |
| `skillverse status` | Whether it runs, where, how many pages are open |
| `skillverse stop` | Stop the web app `skillverse run` started |
| `skillverse setup [<agent>]` | Send another agent's live activity to the web app (`--print`, `--undo`); see [Live activity from other agents](use.md#live-activity-from-other-agents) |
| `skillverse run --here` | Run it in this terminal instead (Ctrl+C stops it) |
| `skillverse` | The terminal app (`--scan` reads the disk instead of the plugin's list) |

The port is `--port`, else `SKILLVERSE_PORT`, else the first free one of 4317 to 4320. Set `SKILLVERSE_PORT` for Claude Code too (in the `env` block of `~/.claude/settings.json`) when you change it, so the plugin looks there.

Or from a clone: `pnpm install`, then `pnpm run dev`. See [Develop](develop.md).

## How the two connect

The plugin never serves the web view itself. As a session starts, and whenever a web app appears later, the plugin sends it the session's exact skill list (which replaces the web app's own scan of Claude Code) and then its live events. **Open web view** in the pane opens the running web app. When it is not running, the pane offers **Start web view** (`skillverse run`). When it is not installed, the pane shows the install command.

## Updating

1. **Plugin, marketplace:** `/plugin marketplace update skillverse`, then start a new session. Claude Code keeps installed plugins by version, so you get a change once a new version is released.
2. **Plugin, clone:** `git pull`. The next session loads it, or right away with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`.
3. **Web app:** `npm update -g @jonathanjuliani/skillverse`, then `skillverse stop && skillverse run`.

## It's working if

- One Skillverse button appears above the prompt after a new session.
- `skillverse status` reports the web app when you started it with `skillverse run`.
- **Open web view** in the pane opens that page.
