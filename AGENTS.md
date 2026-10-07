# AGENTS.md

Guidance for an agent working on Skillverse: a Claude Code plugin (a function-hooks mod that draws its own pane), its web view, and a terminal app. Vocabulary is in [CONTEXT.md](CONTEXT.md).

## Standards

This is a personal open-source project. No company or employer standard applies here, even when a company standards skill is installed on the machine. Conventions come from [.jon-skills/config.yaml](.jon-skills/config.yaml) and the personal defaults in `jonathanjuliani/skills`.

## Before you finish a change

```bash
pnpm run lint && pnpm test && pnpm run validate && pnpm run test:plugin && pnpm run typecheck
```

`validate` and `test:plugin` need Claude Code 2.1.288 or newer on `PATH`. `typecheck` reads `.claude-plugin/types/`, which Claude Code writes when it loads the plugin, so on a fresh clone run `validate` first.

## When editing `hooks/register.tsx`

- Pass `$` only to functions in the same file: the engine refuses a module that passes `$` across an import. Logic without `$` goes in `hooks/skills.ts`, `tree.ts`, `layout.ts` or `web.ts`, which the terminal app and the Vitest specs also import.
- Import only the plugin's own files, never an npm package: a marketplace install has no `node_modules`. The same holds for `server/skillverse-server.mjs` (Node built-ins only).
- When adding an `atom`, declare its key in [types/index.d.ts](types/index.d.ts), or `validate` fails.
- Never edit `.claude-plugin/types/`: Claude Code regenerates it.

## When changing what the pane draws

The desktop app draws pane text in a proportional font and refuses a tree past 100,000 serialized characters, so character art and `Client` canvases break there. Use `Box`, `Text`, `Button`, `Markdown`, and `Svg` only as a picture (it takes no clicks). Cover the terminal and the desktop surface in `tests/*.test.ts`.

## When adding a test

- It mounts the pane or runs hooks: `tests/*.test.ts` with `claude-code/testing` (`pnpm run test:plugin`).
- Anything else: `tests/unit/*.spec.ts` with Vitest (`pnpm test`). `claude plugin test` collects only `*.test.ts`.

## When changing the web view server

It must keep refusing requests whose Host is not `localhost`/`127.0.0.1` and requests from another site's Origin, and keep sending no CORS headers. `tests/unit/server.spec.ts` pins this; do not weaken a test to pass.

## When releasing

Add each change under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) as you make it. Release with `pnpm version <patch|minor|major>`, then `git push --follow-tags`. Never change the version in one file by hand: `check-version` fails, and marketplace users only receive a change after a version bump.
