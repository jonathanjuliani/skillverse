# Skillverse

See every skill your AI agents have, how they connect, and what they cost.

Skillverse has two parts, installed separately; use either or both:

- **The Claude Code plugin** (a _mod_: a plugin of function hooks that draws its own UI). A **Skillverse** button above the prompt opens a side pane with:
  - **a tree of every skill** the session has, grouped by where it came from (Plugins, Project skills, Your skills, Built-in, Connectors), then by plugin, with plugins that share a prefix (`team-*`) gathered under a root and skills that share one (`deploy-staging-*`) folded into families;
  - **each skill's details**: description, file path, the skills it links to and the ones that link to it, and its `SKILL.md`; insert `/skill` into your prompt with one click;
  - **context and token cost**: what a new empty session loads before your first message, what this session holds now, and which skill descriptions cost the most;
  - **skills used this session**, with how many times each;
  - **the terminal app** (`/sv-it`): an animated braille globe, graph and tree, full screen.
- **The web app** (npm or a clone). A page on `localhost` with what every AI agent on your machine has: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, opencode, Windsurf and the shared `~/.agents` folder, each agent that is installed even when nothing is found in it. Each planet is split into **Plugins**, **Your skills**, **Built-in** and **Connectors (MCP)**, and within those into each plugin or group and what it brings. The **Orbit** view puts them all in one scene: Skillverse is the star at the centre and each agent is a planet orbiting it, sized by what it has (the biggest on the inner orbit). Hover a planet for a summary: plugins, skills and connectors, each category's share, and the new empty session (measured for Claude Code) or what its skill descriptions cost. There are also a 3D graph with a cluster per agent and an Obsidian-style 2D graph. The **Agents** card shows what each agent's skills cost in context, and for Claude Code the new empty session and which skills it used, as the pane measures them. A skill installed for several agents is linked across them. When it runs, every Claude Code session with the plugin feeds it **live activity**: skills lighting up as they load, the path between them, subagents branching off.

> Screenshots: _add `docs/pane.png`, `docs/web-globe.png`, `docs/terminal.png`_

## Requirements

**Where it runs:** on your own computer. The plugin runs in Claude Code in a terminal, in the desktop app's Code tab, or in the VS Code extension. It does **not** run on claude.ai: chat on claude.ai does not run Claude Code plugins, and Claude Code on the web (claude.ai/code) runs in a cloud container, so the pane is not shown there and a `localhost` web app on your machine is not reachable from it.

|                                  |                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code 2.1.288 or newer** | For the plugin. It uses the function-hooks plugin API, which is **early access**: it can change between Claude Code releases without notice, and a release may break Skillverse until it is updated. |
| **macOS or Linux**               | Windows is not supported yet (the plugin calls `find`, `grep` and `mkdir`).                                                                                                                          |
| **Node.js 22.18+**               | For the web app and the terminal app.                                                                                                                                                                |
| **Internet** for the web app     | The page loads its graph libraries from jsDelivr (pinned versions). The pane and the terminal app work offline.                                                                                      |

## Install

### The plugin

From the marketplace:

```
/plugin marketplace add jonathanjuliani/skillverse
/plugin install skillverse@skillverse
```

Or the plugin and the web app together. This installs `skillverse@skilldeck` when no Skillverse plugin is already installed, and installs `@jonathanjuliani/skillverse` when the web app is missing. It does not start the server.

```bash
npm i -g @jonathanjuliani/skilldeck
skilldeck install skillverse
```

The direct routes stay: `skillverse@skillverse` for the plugin, and `npm i -g @jonathanjuliani/skillverse` for the web app. Use one plugin route per machine.

Start a new session; the **Skillverse** button appears above the prompt.

Or from a clone: `claude --plugin-dir ~/skillverse` for one session, or for every session (the desktop app included) add the folder to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/skillverse"
  }
}
```

Use one route per machine: a marketplace install and a folder both loaded show two buttons.

### The web app

```bash
npm install -g @jonathanjuliani/skillverse
skillverse run      # starts it in the background
skillverse open     # opens it in the browser (starts it if needed)
```

| Command                 | Does                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| `skillverse run [web]`  | Start the web app in the background; reports the one already running    |
| `skillverse open`       | Open it in the browser, starting it if needed                           |
| `skillverse status`     | Whether it runs, where, how many pages are open                         |
| `skillverse stop`       | Stop the web app `skillverse run` started                               |
| `skillverse run --here` | Run it in this terminal instead (Ctrl+C stops it)                       |
| `skillverse`            | The terminal app (`--scan` reads the disk instead of the plugin's list) |

The port is `--port`, else `SKILLVERSE_PORT`, else the first free one of 4317 to 4320. Set `SKILLVERSE_PORT` for Claude Code too (in the `env` block of `~/.claude/settings.json`) when you change it, so the plugin looks there.

Or from a clone: `pnpm install`, then `pnpm run dev` (see [Develop](#develop)).

### How the two connect

The plugin never serves the web view itself. As a session starts, and whenever a web app appears later, the plugin sends it the session's exact skill list (which replaces the web app's own scan of Claude Code) and then its live events. **Open web view** in the pane opens the running web app; when it is not running, the pane offers **Start web view** (`skillverse run`), and when it is not installed, the pane shows the install command.

### Updating

- **Plugin, marketplace:** `/plugin marketplace update skillverse`, then start a new session. Claude Code keeps installed plugins by version, so you get a change once a new version is released.
- **Plugin, clone:** `git pull`; the next session loads it (or right away with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`).
- **Web app:** `npm update -g @jonathanjuliani/skillverse`, then `skillverse stop && skillverse run`.

## Use

### The pane

|                                                                                 |                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Skillverse** button (or `S` while the band has focus), `/skillverse` or `/sv` | Open the pane                                                      |
| Click in the pane, then **↑↓** and **Enter**                                    | Move between rows and open or close them                           |
| **Find a skill…**                                                               | Filter the tree; matches show as chips; Enter opens the first      |
| **Open web view**                                                               | Open the web app with this session's skills (or say how to get it) |
| **↻ Reindex** / **↻ Measure**                                                   | Re-scan the skills / re-measure the context                        |
| `/skillverse-it` or `/sv-it`                                                    | Open the terminal app (the Terminal panel on the desktop app)      |

### The web app

- **Orbit · 3D · 2D** at the top switch the view.
- **Orbit:** hover a planet for its summary, or the star for every agent's together; click a planet to fly there; the camera then follows it along its orbit (drag to look around it). The switcher over the canvas jumps to any planet or back to **All**; so do the keys **1–9** and **0**, and **Esc**, **Fit** or a double-click on empty space return to every planet. Close to a planet, each category's name sits over its area, and each plugin or group is named on the surface. Click the star to see everything again. The orbits pause while you hover a planet or read a skill. A selected skill's twins light up as bridges to the other planets. Live activity shows on the planet: skills glow and are named as they load, with a comet along the path between them (dashed for a subagent's branch).
- Click a skill, or press **/** to search and **Enter** to open the first match. The reader shows its links, the same skill installed for other agents, and its `SKILL.md`. **Esc** closes it; **Fit** frames everything again.
- **Live** (bottom left; the Live tab on a phone) lists skills as sessions load them. **Simulate** plays a made-up chain to show the effect, **Clear** empties it. It opens by itself on the first real activity.
- **Follow activity** (bottom right) flies the camera to each skill as it loads. Turn it off to keep a zoomed-out view while the activity still shows; the choice is remembered.
- **Agents** (bottom left; the Agents tab on a phone) has one row per agent: its skills and what their descriptions cost in context. Open one to fly to its planet and see the new empty session by category (Claude Code, measured by a session with the plugin), the heaviest skill descriptions, the most used skills, and its categories with their groups. A connector opens in the reader with how it is reached and the other agents that have it. Figures marked ≈ are estimates from the skill files: other agents do not report their context.
- The reader shows each skill's **cost**: its description in every session, its `SKILL.md` when it loads, and how often this Claude Code session used it.

### The terminal app

**Tab** globe · graph · tree, **arrows** or drag to spin, **+/-** or the wheel to zoom, click a skill or **Enter** on the one under ⌖, **1–9** follow a link, **[ ]** step through links, **b** back, **/** search, **space** pause, **q** quit.

## How it works

- **Which skills, in the plugin:** the session's own skill listing (the one `/context` counts), plus the skill folders under `~/.claude/skills`, the project's `.claude/skills` and each listed plugin. Each `SKILL.md` is read for its description and content.
- **What the web app finds:** each agent's own folders at home (never a project's: the web app is the machine-wide view). An agent is shown when its folder exists.

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

  A connector is read by its name and how it is reached (`http · host` or `stdio · command`) only: its command line, headers, environment and keys are never read into the page. A Claude Code session with the plugin replaces the Claude Code part with its exact list (built-ins and claude.ai connectors included, project skills left out); the connectors on disk stay.
- **Links:** a skill links to another when its text names it: a full `plugin:name`, a `/name`, or a hyphenated name. It is a heuristic: some links are missed, a few are coincidental. Skills with the same name under two agents are **twins**, linked across agents.
- **Context figures:** Claude Code's own context breakdown, estimated locally. _New empty session_ is the same breakdown without the conversation.
- **Skills used:** counted from this session's transcript (Skill tool calls and typed `/skill` commands), then live as skills load. Skills used inside subagents are not counted.

## Privacy and security

Nothing leaves your machine except the web app's requests for its graph libraries (jsDelivr).

- Skillverse reads your skill files and this session's transcript **locally**. It writes only to `~/.cache/skillverse/`: the skill list for the terminal app, and the web app's pid, port and log.
- The web app listens on `127.0.0.1` only, answers only requests addressed to `localhost`/`127.0.0.1` (so a web page cannot reach it by DNS rebinding), and grants no cross-origin access: no other site can read your skills or the live event stream.
- Live events (which skill loaded, in which turn) are kept in memory only.

## Limitations

- The plugin API is early access (see Requirements).
- On the desktop app the pane cannot draw graphs that take clicks; the graphs live in the web app and the terminal app.
- The links between skills are inferred from their text (see How it works).
- Live activity comes from Claude Code sessions only; the other agents' planets show what they have, not their activity; their costs are estimates.
- A connector's tools are listed by its agent when it runs, so what they cost in context is not counted.
- Claude Code's built-in skills are not on disk: they show once a session with the plugin sends its list. The other agents' folder layouts are read as they are today and may change with their releases.

## Develop

Uses pnpm, Biome, Vitest and TypeScript (strict). Conventions are in [AGENTS.md](AGENTS.md) and [.jon-skills/config.yaml](.jon-skills/config.yaml); vocabulary in [CONTEXT.md](CONTEXT.md).

```bash
pnpm install
pnpm run dev           # the web app on localhost, restarting on server changes, reloading pages on web/ changes
pnpm run dev:plugin    # Claude Code with this folder as the plugin, reloading on save
pnpm run dev:terminal  # the terminal app, from the working copy
```

Run `pnpm run dev` and `pnpm run dev:plugin` side by side: the plugin finds the web app and feeds it. The plugin's fallbacks and errors go to `.dev/debug.log` (ignored by git); follow it with `tail -f .dev/debug.log`.

```bash
pnpm run lint          # Biome: lint and format check (pnpm run format fixes)
pnpm test              # Vitest: pure modules, the scan, the CLI, the server, the version script
pnpm run validate      # Claude Code: what the plugin hooks and calls, and anything it refuses
pnpm run test:plugin   # Claude Code: the pane and the commands, on the terminal and desktop surfaces
pnpm run typecheck     # once Claude Code has loaded the plugin (it writes .claude-plugin/types/)
pnpm run build && pnpm run snapshot   # the terminal app, one frame
```

`dev:plugin`, `validate` and `test:plugin` need Claude Code 2.1.288 or newer on `PATH`.

| Path                                                                  | What it is                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `hooks/register.tsx`                                                  | The plugin: discovery, the pane, the commands, feeding the web app     |
| `hooks/skills.ts`, `hooks/tree.ts`, `hooks/layout.ts`, `hooks/web.ts` | Parsing, grouping, layouts, web data (shared with the CLI and the app) |
| `bin/skillverse.mjs`, `cli/`                                          | The `skillverse` command: run, open, status, stop; the scan of agents  |
| `server/skillverse-server.mjs`                                        | The web app's server                                                   |
| `web/index.html`, `web/styles.css`, `web/js/`                         | The web app's page: ES modules, no build step                          |
| `tui/skillverse.mjs`                                                  | The terminal app                                                       |
| `types/index.d.ts`                                                    | The plugin's state contract                                            |
| `tests/*.test.ts`, `tests/unit/*.spec.ts`                             | Engine tests (`claude plugin test`), unit tests (Vitest)               |
| `scripts/sync-version.mjs`                                            | Keeps the version in step across the three files                       |

### Releasing

The version lives in three files (`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) and moves together:

1. Add each change under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) as you make it.
2. On a clean `main`, run `pnpm version patch` (or `minor` / `major`). It bumps `package.json`, copies the version into both plugin files, turns _Unreleased_ into a dated section, then commits and tags `vX.Y.Z`.
3. `git push --follow-tags`. The [release workflow](.github/workflows/release.yml) checks that the tag, the three files and the changelog agree, validates and tests the plugin, publishes the npm package with provenance, and creates the GitHub Release from that version's changelog section.

Marketplace users only receive a change after a version bump, so every release needs one. `pnpm run check-version` checks the three files agree (CI runs it on every push). Publishing to npm needs an `NPM_TOKEN` secret (an npm automation token) in the repository's Actions secrets.

## License

MIT, see [LICENSE](LICENSE).
