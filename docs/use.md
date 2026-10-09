# Use

How to open the pane, the web app, and the terminal app, and what the keys do.
Open this when Skillverse is installed and you want to look something up.
Back to [Skillverse](../README.md).

## The pane

| | |
| --- | --- |
| **Skillverse** button (or `S` while the band has focus), `/skillverse` or `/sv` | Open the pane |
| Click in the pane, then **↑↓** and **Enter** | Move between rows and open or close them |
| **Find a skill…** | Filter the tree; matches show as chips; Enter opens the first |
| **Open web view** | Open the web app with this session's skills (or say how to get it) |
| **↻ Reindex** / **↻ Measure** | Re-scan the skills / re-measure the context |
| `/skillverse-it` or `/sv-it` | Open the terminal app (the Terminal panel on the desktop app) |

The pane shows:

1. A tree of every skill the session has, grouped by where it came from (Plugins, Project skills, Your skills, Built-in, Connectors), then by plugin. Plugins that share a prefix (`team-*`) gather under a root. Skills that share one (`deploy-staging-*`) fold into families.
2. Each skill's details: description, file path, the skills it links to and the ones that link to it, and its `SKILL.md`. Insert `/skill` into your prompt with one click.
3. Context and token cost: what a new empty session loads before your first message, what this session holds now, and which skill descriptions cost the most.
4. Skills used this session, with how many times each.

## The web app

**Orbit · 3D · 2D** at the top switch the view.

1. **Orbit:** hover a planet for its summary, or the star for every agent's together. Click a planet to fly there. The camera then follows it along its orbit (drag to look around it). The switcher over the canvas jumps to any planet or back to **All**. So do the keys **1–9** and **0**. **Esc**, **Fit**, or a double-click on empty space returns to every planet. Close to a planet, each category's name sits over its area, and each plugin or group is named on the surface. Click the star to see everything again. The orbits pause while you hover a planet or read a skill. A selected skill's twins light up as bridges to the other planets. Live activity shows on the planet: skills glow and are named as they load, with a comet along the path between them (dashed for a subagent's branch).
2. Click a skill, or press **/** to search and **Enter** to open the first match. The reader shows its links, the same skill installed for other agents, and its `SKILL.md`. **Esc** closes it. **Fit** frames everything again.
3. **Live** (bottom left; the Live tab on a phone) lists skills as sessions load them. **Simulate** plays a made-up chain to show the effect. **Clear** empties it. It opens by itself on the first real activity.
4. **Follow activity** (bottom right) flies the camera to each skill as it loads. Turn it off to keep a zoomed-out view while the activity still shows. The choice is remembered.
5. **Agents** (bottom left; the Agents tab on a phone) has one row per agent: its skills and what their descriptions cost in context. Open one to fly to its planet and see the new empty session by category (Claude Code, measured by a session with the plugin), the heaviest skill descriptions, the most used skills, and its categories with their groups. A connector opens in the reader with how it is reached and the other agents that have it. Figures marked ≈ are estimates from the skill files: other agents do not report their context.
6. The reader shows each skill's **cost**: its description in every session, its `SKILL.md` when it loads, and how often this Claude Code session used it.

Each planet is split into **Plugins**, **Your skills**, **Built-in**, and **Connectors (MCP)**, and within those into each plugin or group. The Orbit view puts them in one scene: Skillverse is the star at the centre and each agent is a planet orbiting it, sized by what it has (the biggest on the inner orbit). There is also a 3D graph with a cluster per agent and an Obsidian-style 2D graph. A skill installed for several agents is linked across them. When the web app runs, every Claude Code session with the plugin feeds it live activity.

### Inside other agents and editors

- **`/skillverse` in any agent.** `skillverse setup <agent>` also adds a `/skillverse` skill (in `~/.agents/skills/`, or Cursor's and Antigravity's own skills folder). Typed in the agent, it prints that agent's summary: its plugins, skills and connectors, each category's share, what its skill descriptions cost every session, and the web app's address.
- **`skillverse summary [--agent <id>] [--json]`** prints the same in any terminal: every agent, or one. It reads the running web app (which knows what Claude Code sessions measured), else scans.
- **The terminal app for any agent.** `skillverse --agent codex` opens Codex's globe, graph and tree; keep it in a split pane next to a CLI agent.
- **A panel in your editor.** The VS Code extension (`vscode/`; `pnpm run vscode:package` builds the `.vsix`) shows the web app in a side panel of VS Code, Cursor, Windsurf or Antigravity, opened on that editor's agent (Copilot in VS Code). When the web app is not running, the panel's **Start it** runs `skillverse run` in a terminal. Install the `.vsix` with **Extensions: Install from VSIX…**.
- **Any web view address** takes `?agent=<id>` to open on that planet, and `?embed=1` for a narrow panel (no stats, switcher or hint).

### Live activity from other agents

Other agents send their activity through their own hooks. Set one up once:

```bash
skillverse setup          # which agents can, and which are set up
skillverse setup cursor   # adds Skillverse's hooks to ~/.cursor/hooks.json
```

| Agent | `skillverse setup …` | Writes | A skill shows when |
| --- | --- | --- | --- |
| Cursor (editor and CLI) | `cursor` | `~/.cursor/hooks.json` | a prompt starts with `/name`; it reads a `SKILL.md` |
| Codex (CLI and app) | `codex` | `~/.codex/hooks.json` | a prompt starts with `$name` or `/name`; it reads a `SKILL.md`. **Then trust the hooks once with `/hooks` in Codex.** |
| GitHub Copilot CLI and VS Code | `copilot` (or `vscode`) | `~/.copilot/hooks/skillverse.json` | a prompt starts with `/name`; it reads a `SKILL.md` |
| Gemini CLI | `gemini` | `~/.gemini/settings.json` | it activates a skill |
| Devin CLI | `devin` | `~/.config/devin/config.json` | a prompt starts with `/name`; its skill tool; it reads a `SKILL.md` |
| Windsurf | `windsurf` | `~/.codeium/windsurf/hooks.json` | a prompt starts with `@name`; it reads a `SKILL.md` |
| Antigravity | `antigravity` | `~/.gemini/config/hooks.json` | it reads a skill file (it has no hook for prompts) |
| opencode | `opencode` | `~/.config/opencode/plugins/skillverse.js` | its skill tool runs |

`--print` shows the file it would write without writing it, and `--undo` removes exactly Skillverse's entries. In a shared file the rest is kept, and the old file is saved next to it with `.skillverse-backup` added. Copilot's file and opencode's plugin are Skillverse's own, so undo removes them. Run it from a global install (`npm i -g`) or a clone, not `npx`: the hook calls this copy of Skillverse by its full path, and so the Node it ran with. After switching Node versions or moving a clone, run `skillverse setup <agent>` again. Restart the agent to load its hooks.

Only Claude Code, Gemini CLI and opencode say which skill loaded; for the others it is spotted as the table says. A skill an agent reads from `~/.agents/skills` lights up on the Shared planet.

## The terminal app

**Tab** globe · graph · tree, **arrows** or drag to spin, **+/-** or the wheel to zoom, click a skill or **Enter** on the one under ⌖, **1–9** follow a link, **[ ]** step through links, **b** back, **/** search, **space** pause, **q** quit.

## It's working if

- The pane opens from the Skillverse button, `/skillverse`, or `/sv`.
- **Open web view** reaches the page `skillverse run` started.
- `/sv-it` opens the terminal app.

Screenshots are not in the repo yet: `docs/pane.png`, `docs/web-globe.png`, `docs/terminal.png`.
