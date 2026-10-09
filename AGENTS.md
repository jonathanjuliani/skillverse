# AGENTS.md

Guidance for an agent working on Skillverse: a Claude Code plugin (a function-hooks mod that draws its own pane), a web app (`skillverse run`) that shows every agent's skills, and a terminal app. Vocabulary is in [CONTEXT.md](CONTEXT.md).

## Standards

This is a personal open-source project. No company or employer standard applies here, even when a company standards skill is installed on the machine. Conventions come from [.jon-skills/config.yaml](.jon-skills/config.yaml) and the personal defaults in `jonathanjuliani/skilldeck`.

## Before you finish a change

```bash
pnpm run lint && pnpm test && pnpm run validate && pnpm run test:plugin && pnpm run typecheck
```

`validate` and `test:plugin` need Claude Code 2.1.288 or newer on `PATH`. `typecheck` reads `.claude-plugin/types/`, which Claude Code writes when it loads the plugin, so on a fresh clone run `validate` first.

## When editing `hooks/register.tsx`

- Pass `$` only to functions in the same file: the engine refuses a module that passes `$` across an import. Logic without `$` goes in `hooks/skills.ts`, `tree.ts`, `layout.ts` or `web.ts`, which the terminal app and the Vitest specs also import.
- Import only the plugin's own files, never an npm package: a marketplace install has no `node_modules`. The same holds for `server/`, `cli/` and `bin/` (Node built-ins only).
- The plugin never starts or serves the web app: it finds it (`/health`), sends it the session's skills (`POST /skills`) and live events (`POST /events`), and tells the person how to start or install it.
- When adding an `atom`, declare its key in [types/index.d.ts](types/index.d.ts), or `validate` fails.
- Never edit `.claude-plugin/types/`: Claude Code regenerates it.

## When changing what the pane draws

The desktop app draws pane text in a proportional font and refuses a tree past 100,000 serialized characters, so character art and `Client` canvases break there. Use `Box`, `Text`, `Button`, `Markdown`, and `Svg` only as a picture (it takes no clicks). Cover the terminal and the desktop surface in `tests/*.test.ts`.

## When adding a test

- It mounts the pane or runs hooks: `tests/*.test.ts` with `claude-code/testing` (`pnpm run test:plugin`).
- Anything else: `tests/unit/*.spec.ts` with Vitest (`pnpm test`). `claude plugin test` collects only `*.test.ts`.

## When changing the web app's page

`web/` is plain ES modules with no build step: `index.html`, `styles.css`, `js/main.js` (the shell) and one module per concern (`model`, `state`, `live`, `panel`, `agents`, `views/*`). A view implements `init`, `destroy`, `refresh`, `resize`, `focus`, `fly`, `focusRegion`, `fit` and `showAgent`; the shell destroys a view when it is left, so keep `destroy` freeing everything `init` makes. Views never import the shell; they call `actions` in `js/state.js`. Libraries load from the pinned CDN URLs in `js/lib.js` only. The orbit view imports three.js, its controls and three-globe as ES modules (`ESM` in `lib.js`); keep all three on the three.js version three-globe's build imports, or two copies of three.js load and its objects stop working together. Check it at a phone width (760px and less: one bottom sheet) and a desktop width before finishing.

## When changing the web app's server

It must keep refusing requests whose Host is not `localhost`/`127.0.0.1` and requests from another site's Origin, and keep sending no CORS headers. `tests/unit/server.spec.ts` pins this; do not weaken a test to pass. A new agent to scan goes in `AGENTS` in `cli/agents.mjs` (a function that reads its folders through the collector), with a case in `tests/unit/scan.spec.ts`. Connectors keep only a name and transport: never read a command line, header, environment or key into the page.

An agent's live events: its hook shape goes in `FORMATS` in `cli/hook-events.mjs` (only names leave: never a prompt, file content or command), and where its hooks live in `SETUPS` in `cli/setup.mjs` (only hooks that observe, never permission hooks). Test both with a recorded payload in `tests/unit/hook.spec.ts`. `skillverse hook` must keep printing nothing and exiting 0.

## When changing the VS Code extension

`vscode/` is its own package: plain CommonJS, no dependencies, no build. Logic without `vscode` goes in `vscode/lib.js`, tested in `tests/unit/vscode.spec.ts`. It only shows the web app (`?embed=1`); it never serves or scans. Its version is its own, outside `pnpm version`. `pnpm run vscode:package` checks the manifest and builds the `.vsix`.

## When releasing

Add each change under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) as you make it. Release with `pnpm version <patch|minor|major>`, then `git push --follow-tags`. Never change the version in one file by hand: `check-version` fails, and marketplace users only receive a change after a version bump.
