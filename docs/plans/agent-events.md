# Plan: live events from every agent

Status: **built; a real Cursor session still to try** (branch `feat/agent-events`). First of three: this one, then [agent-adapters.md](agent-adapters.md), then [agent-views.md](agent-views.md).

## Goal

Any agent with shell hooks can feed the web app's **Live** card, not only Claude Code through the plugin. One command takes a hook's JSON and turns it into Skillverse events; one command writes the hook entries into an agent's config and takes them out again.

```bash
skillverse setup cursor          # adds Skillverse's hooks to ~/.cursor/hooks.json
skillverse setup cursor --undo   # removes exactly those entries
skillverse setup                 # which agents are set up, which could be
```

The agent then runs `skillverse hook cursor` on its events. Cursor is the first agent, and the reference for the others in [agent-adapters.md](agent-adapters.md).

## Today

- `POST /events` takes `skill`, `agent`, `tool` and `turn` events. Every event is assumed to be Claude Code's: the page matches `event.skill` against Claude Code's planet only (`findSkill`, `LIVE_AGENT`).
- `turn` numbers come from the plugin, which counts a session's turns.
- Only the plugin sends events.

## Design

### Events carry their source

An event gets an optional **`source`**: the id of the agent it came from (`cursor`, `codex`, …, the ids in `AGENTS`). Missing means `claude`, so the plugin is unchanged. The event's `agent` field keeps its meaning: the subagent inside a session (`main` when none).

- **Server** keeps `source` when it is a known shape (`[a-z0-9-]`, 32 characters at most).
- **Server numbers turns** when an event has none: a `turn` event moves its session one turn on; a `skill` or `agent` event takes its session's current turn. A hook runs as a new process each time, so it cannot count.
- **Page** matches a skill on the source's planet: by id (`cursor/review`, or `review`), then by name when only one skill on that planet has it. The feed shows the agent's name beside a skill from any agent other than Claude Code.

### `skillverse hook <agent>`

Reads the hook's JSON on stdin, maps it to events and posts them to the running web app.

- **Never in the way.** It always exits 0, prints nothing (Cursor reads a hook's stdout as its reply), and gives up after about a second. No web app running means nothing to do, not an error.
- **Finds the web app** the way `skillverse status` does: the port `skillverse run` recorded, then 4317–4320 (or `SKILLVERSE_PORT`).
- **Sends only names**: a skill's name, the session id, the project folder's name, a subagent's type. Never a prompt, a file's content, a command or a path beyond the skill's name.

### How a skill is spotted

Only Claude Code reports which skill loaded. For the others, the hook infers it:

| Signal | Example | Event |
|---|---|---|
| A prompt that starts with `/name` or `/plugin:name` | `/review the diff` | `skill` named `review` |
| A tool that reads a `SKILL.md` | `read_file …/skills/review/SKILL.md` | `skill` named `review` |
| A `Skill` tool call | `{"skill": "docs:write"}` | `skill` named `docs:write` |
| A new prompt | | `turn` |
| A subagent starting (where it is not a permission hook) | | `agent` |

A `/name` that is not a skill (a built-in command) does not match one on the planet, so the feed shows it unmatched; that is how the plugin's events behave today.

### Mappers

`cli/hook-events.mjs` exports `toEvents(agent, input)`, a pure function per agent, so tests feed it recorded payloads. Two to start:

- **`claude-format`**: the shape Claude Code's shell hooks use (`hook_event_name`, `session_id`, `prompt`, `tool_name`, `tool_input`, `cwd`). Several agents copy it (Devin says so outright); [agent-adapters.md](agent-adapters.md) checks each.
- **`cursor`**: Cursor's (`hook_event_name`, `conversation_id`, `prompt`, `tool_name`, `tool_input`, `workspace_roots`).

### `skillverse setup <agent>`

| Rule | Why |
|---|---|
| Merges into the agent's config, keeping everything else as it was, and backs the file up first (`<file>.skillverse-backup`) | It is the person's file |
| Marks its entries by their command (`… hook <agent>`), so `--undo` removes exactly those and a second `setup` changes nothing | Safe to run twice; nothing else is touched |
| Writes absolute paths: Node's and this package's `bin/skillverse.mjs` | Desktop apps often start without the shell's `PATH` |
| Refuses to run from the npx cache, and prints the `npm install -g` command | That folder can be cleared, which would leave the agent calling a missing file |
| `--print` shows the file it would write, and writes nothing | To check before trusting it |
| Only the hooks that are not permission hooks | A permission hook that answers wrongly can block the agent; these only observe |

Cursor's entries go in `~/.cursor/hooks.json` (`version: 1`): `beforeSubmitPrompt` and `postToolUse`. Its `subagentStart` is a permission hook, so subagents are left to [agent-adapters.md](agent-adapters.md).

## Steps

1. Server: `source`, numbering turns. Unit tests in `tests/unit/server.spec.ts`.
2. Page: `findSkill(name, source)`, the agent's name in the feed.
3. `cli/hook-events.mjs` with the `claude-format` and `cursor` mappers. Unit tests with recorded payloads.
4. `skillverse hook <agent>`. A test that posts to a test server, and one that it exits 0 with no server.
5. `skillverse setup [<agent>] [--undo] [--print]` with Cursor. Unit tests on a temporary home: merge, a second run, undo, an existing file kept, refusing in the npx cache.
6. Docs: README, CONTEXT (`source`), `docs/how-it-works.md`, CHANGELOG.
7. Tried for real in Cursor: a typed `/skill` and a skill Cursor reads on its own both light up on Cursor's planet.

## Exit

`pnpm run lint && pnpm test && pnpm run typecheck` pass. With the web app running and `skillverse setup cursor` done, using a skill in Cursor shows it in the Live card on Cursor's planet. `skillverse setup cursor --undo` leaves `hooks.json` as it was.

## Not in this plan

- Every agent but Cursor: [agent-adapters.md](agent-adapters.md).
- Showing the info inside the agents: [agent-views.md](agent-views.md).
- Per-session skill lists and costs from other agents (`POST /skills`): only Claude Code measures them.
