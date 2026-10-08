# Changelog

All notable changes to Skillverse are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Add each change under **Unreleased** as you make it; `pnpm version` moves them under the new version when you release (see [Releasing](README.md#releasing)).

## [Unreleased]

### Added

- **Web app**: `skillverse run` serves the web view in the background (`skillverse open`, `status`, `stop`), scanning the skills on this machine itself; `POST /refresh` scans again. The plugin sends its live events to it when it runs. The npm package now carries it.
- The web app shows every agent's skills: Claude Code, Codex (`~/.codex/skills`), Cursor (`~/.cursor/skills`) and shared skills (`~/.agents/skills`), at home and in the project. A skill installed for several agents is linked across them. A Claude Code session sends its exact list (`POST /skills`), which replaces the scan of Claude Code.
- **Agents** card (replaces Groups and the agent menu): one row per agent with its skill count and what its skill descriptions cost; the open agent shows the new empty session by category, the heaviest descriptions, the most used skills and its groups. A Claude Code session sends the figures the pane measures (`POST /skills` now carries them); other agents are estimated from their skill files. The reader shows a skill's cost: in every session, when it loads, and its uses.
- **Follow activity** switch beside Fit: turn off camera flights to each skill as it loads; remembered per browser.
- **Orbit view** (the default): every agent in one scene. Skillverse is the star at the centre; each agent is a planet orbiting it, sized by its skill count; twins are bridges between planets. Click a planet to fly there and follow it along its orbit; click the star to see everything. Live activity glows, names the skills and draws the path between them on the planet. Built with three.js and three-globe (pinned, from jsDelivr).
- The web view, redesigned for small screens and split into ES modules (`web/js/`), still with no build step:
  - a cluster per agent in 3D and in 2D; twins shown in the reader (**Also installed for**) and as faint links;
  - the canvas comes first: Live and Groups fold into a stack at the bottom left and the reader takes its own column; on a phone, one bottom sheet with Skill, Live and Groups tabs;
  - **Fit** frames everything again; **/** searches; **Esc** closes the reader; a skip link reaches the groups by keyboard;
  - a reload (new skills from a session, or a changed page) keeps the view, the agent and the selected skill.
- `/sv`, short for `/skillverse`.
- `/skillverse-it` and `/sv-it` open the terminal app: on the desktop app they ask Claude to start it in the Terminal panel; elsewhere, or if that fails, they print the command.
- `SKILLVERSE_PORT` sets the port the web view is served and looked for on (default: 4317, then up to 4320).
- Development: `pnpm run dev` runs the web app with reload on change, `pnpm run dev:plugin` runs Claude Code with the working copy as a plugin (debug log in `.dev/debug.log`), `pnpm run dev:terminal` the terminal app.

### Changed

- The web view frees a view you leave (its WebGL context, geometry and animation loop) instead of keeping it paused, draws nothing while its tab is hidden, and reuses live path objects: about half the memory after visiting every view. The split Globes view is gone; Orbit replaces it.
- The `skillverse` command (`bin/skillverse.mjs`) dispatches: the terminal app stays the default.
- The plugin no longer serves the web view. **Open web view** finds the web app, sends it the session's skills and opens it; when it is not running it offers **Start web view** (`skillverse run`), and when it is not installed it shows the install command. A session also feeds a web app that is already running when it starts.

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
- **Terminal app** (`npx @jonathanjuliani/skillverse`): an animated globe, graph and tree.
- When a step falls back (a folder that does not exist, a port nobody serves, a session that cannot be measured), the reason goes to Claude Code's debug log (`claude --debug`).

### Security

- The web view server listens on `127.0.0.1` only, answers only requests addressed to `localhost`/`127.0.0.1` (no DNS rebinding), and grants no cross-origin access.
- Nothing leaves the machine except the web view's requests for its graph libraries (jsDelivr, pinned versions).

[Unreleased]: https://github.com/jonathanjuliani/skillverse/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jonathanjuliani/skillverse/releases/tag/v0.1.0
