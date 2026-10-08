# CONTEXT

Shared vocabulary for Skillverse. Code, docs and the UI use these words this way.

## Skills

- **Skill**: one entry Claude Code can load, from a `SKILL.md`. Its **id** is `plugin:name` for a plugin's skill and `name` otherwise.
- **Session listing**: the skills the session lists for the model, as `/context` counts them. Skillverse's source of truth for which skills exist.
- **Link**: a skill naming another in its text (a full `plugin:name`, a `/name`, or a hyphenated name). Inferred, not declared. **Links to** are the ones it names; **linked from** are the ones that name it.
- **Agent**: an AI coding tool whose skills the web app shows: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, opencode, Windsurf, and **Shared** (`~/.agents/skills`, read by several). Each installed one is a planet (`cli/agents.mjs`). In the web app, ids of every agent but Claude Code carry its prefix (`codex/docs`).
- **Twin**: the same skill (same name) installed for another agent; shown as **Also installed for** and as a faint link across agents.

## Grouping

- **Category**: where skills came from, the top level of the tree and of a planet: Plugins, Your skills, Built-in, Connectors (MCP), Organization, Project. The web app leaves Project out. In code: `plugins`, `user`, `builtin`, `mcp`, `org`, `project` (`categoryOf`).
- **Connector**: an MCP server or app an agent is set up with, from its config or a plugin. Shown beside skills (`kind: 'mcp'`), read by name and transport only.
- **Region**: a group of skills inside a category: one plugin, or the category's word plus a name family (`User · docs`), or a plugin's connectors (`MCP · linear`). The UI calls a region a **group**; the code says region.
- **Plugin root**: plugins sharing a first word (`team-*`), gathered under it in the tree.
- **Family**: skills in one region sharing a name prefix (`deploy-*`), folded under it; a big family splits again (`deploy-staging-*`).

## Places

- **Pane**: Skillverse's side panel in Claude Code.
- **Band**: the row above the prompt that holds the Skillverse button.
- **Surface**: where Claude Code draws: `terminal`, `desktop`, `vscode` or `mobile`. The pane behaves differently per surface.
- **Web app**: `skillverse run`; the **Skillverse server** (`server/skillverse-server.mjs`) and the page it serves at `http://localhost:4317` (the **web view**). Installed with npm or a clone, separately from the plugin.
- **Live events**: what the plugin sends the web app as it happens (a skill loaded, a turn began), shown in the web view's **Live** card.
- **Orbit view**: the web view's default: the Skillverse **star** at the centre and every agent a **planet** on an **orbit** around it; the camera **follows** a planet once you fly to it.
- **Agents card**: the web view's card where an agent is picked and its costs read; **groups** sit inside each agent's categories.
- **Planet switcher**: the row of agents over the canvas, with **All** for the whole system; the same choice as the Agents card.
- **Summary**: an agent's figures (plugins, skills, connectors), its categories' shares and its session cost (`web/js/summary.js`); the **star card** shows every agent's together.
- **Costs**: what a skill takes in context in **every session** (its description), **when it loads** (its SKILL.md), and its **uses**; measured by a Claude Code session, estimated (≈) otherwise.
- **Cards** and **sheet**: the web view's Live, Agents and reader panels: floating cards on wide screens, one bottom sheet with tabs on a phone.
- **Terminal app**: `tui/skillverse.mjs`, the full-screen globe, graph and tree; the npm package.
- **Mod**: Claude Code's name for a plugin of function hooks that draws its own UI. Skillverse is a plugin that is a mod.

## Measures

- **New empty session**: the context a fresh session loads before the first message; this session's breakdown without the conversation.
- **Skill descriptions in context**: what listing every skill's name and description costs in tokens.
