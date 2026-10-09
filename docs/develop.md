# Develop

How to run Skillverse from a clone, where the code lives, and how a release is cut.
Open this when you are changing the plugin, the web app, or the terminal app.
Back to [Skillverse](../README.md).

Uses pnpm, Biome, Vitest, and TypeScript (strict). Conventions are in [AGENTS.md](../AGENTS.md) and [.jon-skills/config.yaml](../.jon-skills/config.yaml). Vocabulary is in [CONTEXT.md](../CONTEXT.md).

## Run it

```bash
pnpm install
pnpm run dev           # the web app on localhost, restarting on server changes, reloading pages on web/ changes
pnpm run dev:plugin    # Claude Code with this folder as the plugin, reloading on save
pnpm run dev:terminal  # the terminal app, from the working copy
```

Run `pnpm run dev` and `pnpm run dev:plugin` side by side. The plugin finds the web app and feeds it. The plugin's fallbacks and errors go to `.dev/debug.log` (ignored by git). Follow it with `tail -f .dev/debug.log`.

```bash
pnpm run lint          # Biome: lint and format check (pnpm run format fixes)
pnpm test              # Vitest: pure modules, the scan, the CLI, the server, the version script
pnpm run validate      # Claude Code: what the plugin hooks and calls, and anything it refuses
pnpm run test:plugin   # Claude Code: the pane and the commands, on the terminal and desktop surfaces
pnpm run typecheck     # once Claude Code has loaded the plugin (it writes .claude-plugin/types/)
pnpm run build && pnpm run snapshot   # the terminal app, one frame
```

`dev:plugin`, `validate`, and `test:plugin` need Claude Code 2.1.288 or newer on `PATH`.

| Path | What it is |
| --- | --- |
| `hooks/register.tsx` | The plugin: discovery, the pane, the commands, feeding the web app |
| `hooks/skills.ts`, `hooks/tree.ts`, `hooks/layout.ts`, `hooks/web.ts` | Parsing, grouping, layouts, web data (shared with the CLI and the app) |
| `bin/skillverse.mjs`, `cli/` | The `skillverse` command: run, open, status, stop; the scan of agents |
| `server/skillverse-server.mjs` | The web app's server |
| `web/index.html`, `web/styles.css`, `web/js/` | The web app's page: ES modules, no build step |
| `tui/skillverse.mjs` | The terminal app |
| `types/index.d.ts` | The plugin's state contract |
| `tests/*.test.ts`, `tests/unit/*.spec.ts` | Engine tests (`claude plugin test`), unit tests (Vitest) |
| `scripts/sync-version.mjs` | Keeps the version in step across the three files |

## Releasing

A release tags `main`, publishes the npm package, and opens a GitHub Release.

The version lives in three files (`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) and moves together:

1. Add each change under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) as you make it.
2. On a clean `main`, run `pnpm version patch` (or `minor` / `major`). It bumps `package.json`, copies the version into both plugin files, turns _Unreleased_ into a dated section, then commits and tags `vX.Y.Z`.
3. `git push --follow-tags`. The [release workflow](../.github/workflows/release.yml) checks that the tag, the three files, and the changelog agree, validates and tests the plugin, publishes the npm package with provenance, and creates the GitHub Release from that version's changelog section.

Marketplace users only receive a change after a version bump, so every release needs one. `pnpm run check-version` checks the three files agree (CI runs it on every push). Publishing to npm needs an `NPM_TOKEN` secret (an npm automation token) in the repository's Actions secrets.

## It's working if

- `pnpm run dev` and `pnpm run dev:plugin` are both running, and the pane's **Open web view** reaches the local page.
- `pnpm test` passes for the modules you changed.
