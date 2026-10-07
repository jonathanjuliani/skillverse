# Skillverse

See every skill your Claude Code session has, how they connect, and what they cost.

Skillverse is a Claude Code plugin (a *mod*: a plugin of function hooks that draws its own UI). It adds a **Skillverse** button above the prompt that opens a side pane with:

- **A tree of every skill**, grouped by where it came from (Plugins, Project skills, Your skills, Built-in, Connectors), then by plugin, with plugins that share a prefix (`team-*`, `acme-*`) gathered under a root and skills that share a prefix (`deploy-staging-*`) folded into families.
- **Each skill's details**: description, file path, the skills it links to and the ones that link to it, and its `SKILL.md` rendered. Insert `/skill` into your prompt with one click.
- **Context and token cost**: what a new empty session loads before your first message, what this session holds now, both broken down by category, and which skill descriptions cost the most.
- **Skills used this session**, with how many times each.
- **A web view** with an interactive globe, a 3D graph and an Obsidian-style 2D graph of all your skills, served on `localhost`, with live activity as skills load.

There is also a **terminal app**: an animated braille globe, graph and tree that runs full screen in any terminal.

> Screenshots: _add `docs/pane.png`, `docs/web-globe.png`, `docs/terminal.png`_

## Requirements

**Where it runs:** Claude Code on your own computer: in a terminal, in the desktop app's Code tab, or in the VS Code extension. It does **not** run on claude.ai: chat on claude.ai does not run Claude Code plugins, and Claude Code on the web (claude.ai/code) runs in a cloud container, so the pane is not shown there and the web view's `localhost` server would not be reachable from your browser.

| | |
|---|---|
| **Claude Code 2.1.288 or newer** | Skillverse uses the function-hooks plugin API, which is **early access**: it can change between Claude Code releases without notice, and a release may break Skillverse until it is updated. |
| **macOS or Linux** | Windows is not supported yet (Skillverse calls `find`, `grep` and `mkdir`). |
| **Node.js** on `PATH` | Runs the local web view server. The terminal app needs **Node 22.18+**. |
| **Internet** for the web view | The web view loads its graph libraries from jsDelivr (pinned versions). The pane and the terminal app work offline. |

## Install

### From the marketplace

```
/plugin marketplace add jonathanjuliani/skillverse
/plugin install skillverse@skillverse
```

Start a new session; the **Skillverse** button appears above the prompt.

### From a clone

```bash
git clone https://github.com/jonathanjuliani/skillverse.git ~/skillverse
```

Then either start Claude Code with the folder:

```bash
claude --plugin-dir ~/skillverse
```

or, for every session (the desktop app included), add it to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/skillverse"
  }
}
```

Add `"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"` to the same block to reload Skillverse as you edit it.

### The terminal app

```bash
npx @jonathanjuliani/skillverse
```

It reads the skill list the plugin saves (`~/.cache/skillverse/skillverse.json`) so it shows exactly what your session has; open the Skillverse pane once first. Without it, it scans `~/.claude` and the current project: `npx @jonathanjuliani/skillverse --scan`. Inside Claude Code, `/skillverse-terminal` prints the command for the installed plugin.

### Updating

- **Marketplace:** `/plugin marketplace update skillverse`, then start a new session. Claude Code keeps installed plugins by version, so you get a change once a new version is released.
- **Clone:** `git pull` in the folder; the next session loads it (or right away with `CLAUDE_CODE_PLUGIN_DIR_WATCH`).
- **Terminal app:** `npx @jonathanjuliani/skillverse@latest`.

## Use

| | |
|---|---|
| **Skillverse** button (or `S` while the band has focus), `/skillverse` | Open the pane |
| Click in the pane, then **↑↓** and **Enter** | Move between rows and open or close them |
| **Find a skill…** | Filter the tree; matches show as chips; Enter opens the first |
| **Open web view** | Write the web view and serve it on `http://localhost:4317` |
| **↻ Reindex** / **↻ Measure** | Re-scan the skills / re-measure the context |
| `/skillverse-terminal` | Show the command for the terminal app |

Terminal app keys: **Tab** globe · graph · tree, **arrows** or drag to spin, **+/-** or the wheel to zoom, click a skill or **Enter** on the one under ⌖, **1–9** follow a link, **[ ]** step through links, **b** back, **/** search, **space** pause, **q** quit.

## How it works

- **Which skills:** the session's own skill listing (the one `/context` counts), plus the skill folders under `~/.claude/skills`, the project's `.claude/skills` and each listed plugin. Each `SKILL.md` is read for its description and content.
- **Links:** a skill links to another when its text names it: a full `plugin:name`, a `/name`, or a hyphenated name. It is a heuristic: some links are missed, a few are coincidental.
- **Context figures:** Claude Code's own context breakdown, estimated locally. *New empty session* is the same breakdown without the conversation.
- **Skills used:** counted from this session's transcript (Skill tool calls and typed `/skill` commands), then live as skills load. Skills used inside subagents are not counted.

## Privacy and security

Nothing leaves your machine except the web view's requests for its graph libraries (jsDelivr).

- Skillverse reads your skill files and this session's transcript **locally**, and writes only to `~/.cache/skillverse/` (the web view's files and the skill list for the terminal app).
- The web view server listens on `127.0.0.1` only, answers only requests addressed to `localhost`/`127.0.0.1` (so a web page cannot reach it by DNS rebinding), and grants no cross-origin access: no other site can read your skills or the live event stream.
- Live events (which skill loaded, in which turn) are kept in memory only, unless you set `SKILLVERSE_LOG` to a file path.

## Limitations

- The plugin API is early access (see Requirements).
- On the desktop app the pane cannot draw graphs that take clicks; the graphs live in the web view and the terminal app.
- The links between skills are inferred from their text (see How it works).

## Develop

Uses pnpm, Biome, Vitest and TypeScript (strict). Conventions are in [AGENTS.md](AGENTS.md) and [.jon-skills/config.yaml](.jon-skills/config.yaml); vocabulary in [CONTEXT.md](CONTEXT.md).

```bash
pnpm install
pnpm run lint          # Biome: lint and format check (pnpm run format fixes)
pnpm test              # Vitest: pure modules, the version script, the web view server
pnpm run validate      # Claude Code: what the plugin hooks and calls, and anything it refuses
pnpm run test:plugin   # Claude Code: the pane, on the terminal and desktop surfaces
pnpm run typecheck     # once Claude Code has loaded the plugin (it writes .claude-plugin/types/)
pnpm run build && pnpm run snapshot   # the terminal app, one frame
```

`validate` and `test:plugin` need Claude Code 2.1.288 or newer on `PATH`.

| Path | What it is |
|---|---|
| `hooks/register.tsx` | The plugin: discovery, the pane, the web view, live events |
| `hooks/skills.ts`, `hooks/tree.ts`, `hooks/layout.ts`, `hooks/web.ts` | Parsing, grouping, layouts, web data (shared with the terminal app) |
| `server/skillverse-server.mjs` | The local web view server |
| `web/index.html` | The web view |
| `tui/skillverse.mjs` | The terminal app |
| `types/index.d.ts` | The plugin's state contract |
| `tests/*.test.ts`, `tests/unit/*.spec.ts` | Engine tests (`claude plugin test`), unit tests (Vitest) |
| `scripts/sync-version.mjs` | Keeps the version in step across the three files |

### Releasing

The version lives in three files (`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) and moves together:

1. Add each change under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) as you make it.
2. On a clean `main`, run `pnpm version patch` (or `minor` / `major`). It bumps `package.json`, copies the version into both plugin files, turns *Unreleased* into a dated section, then commits and tags `vX.Y.Z`.
3. `git push --follow-tags`. The [release workflow](.github/workflows/release.yml) checks that the tag, the three files and the changelog agree, validates and tests the plugin, publishes the npm package with provenance, and creates the GitHub Release from that version's changelog section.

Marketplace users only receive a change after a version bump, so every release needs one. `pnpm run check-version` checks the three files agree (CI runs it on every push). Publishing to npm needs an `NPM_TOKEN` secret (an npm automation token) in the repository's Actions secrets.

## License

MIT, see [LICENSE](LICENSE).
