# Changelog

All notable changes to Skillverse are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add each change under **Unreleased** as you make it; `pnpm version` moves them under the new version when you release (see [Releasing](README.md#releasing)).

## [Unreleased]

## [0.1.0] - 2026-10-07

First release. Requires Claude Code 2.1.288 or newer (the function-hooks plugin API, early access).

### Added

- **Skillverse pane**, opened from the Skillverse button above the prompt or `/skillverse`:
  - every skill in a tree grouped by source (Plugins, Project skills, Your skills, Built-in, Connectors), plugin root, plugin and name family, each group in its plugin's color;
  - a skill's description, path, links to and from other skills, and its `SKILL.md`; Insert `/skill` into the prompt; Back and Clear;
  - search with matches as chips;
  - context and token cost of a new empty session and of this session, by category, and the most expensive skill descriptions;
  - skills used in this session, counted from the transcript and live.
- **Web view** on `localhost` (Open web view): a globe, a 3D graph and a 2D graph of every skill, with live activity as skills load.
- **Terminal app** (`npx @jonathanjuliani/skillverse`): an animated globe, graph and tree; `/skillverse-terminal` shows the command for the installed plugin.
- When a step falls back (a folder that does not exist, a port nobody serves, a session that cannot be measured), the reason goes to Claude Code's debug log (`claude --debug`).

### Security

- The web view server listens on `127.0.0.1` only, answers only requests addressed to `localhost`/`127.0.0.1` (no DNS rebinding), and grants no cross-origin access.
- Nothing leaves the machine except the web view's requests for its graph libraries (jsDelivr, pinned versions).

[Unreleased]: https://github.com/jonathanjuliani/skillverse/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jonathanjuliani/skillverse/releases/tag/v0.1.0
