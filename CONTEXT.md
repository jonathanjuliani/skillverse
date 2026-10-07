# CONTEXT

Shared vocabulary for Skillverse. Code, docs and the UI use these words this way.

## Skills

- **Skill**: one entry Claude Code can load, from a `SKILL.md`. Its **id** is `plugin:name` for a plugin's skill and `name` otherwise.
- **Session listing**: the skills the session lists for the model, as `/context` counts them. Skillverse's source of truth for which skills exist.
- **Link**: a skill naming another in its text (a full `plugin:name`, a `/name`, or a hyphenated name). Inferred, not declared. **Links to** are the ones it names; **linked from** are the ones that name it.

## Grouping

- **Category**: where skills came from, the tree's top level: Plugins, Connectors (MCP), Organization, Project skills, Your skills, Built-in.
- **Region**: a group of skills: one plugin, or a source plus a name family (`Project · docs`). The UI calls a region a **group**; the code says region.
- **Plugin root**: plugins sharing a first word (`team-*`), gathered under it in the tree.
- **Family**: skills in one region sharing a name prefix (`deploy-*`), folded under it; a big family splits again (`deploy-staging-*`).

## Places

- **Pane**: Skillverse's side panel in Claude Code.
- **Band**: the row above the prompt that holds the Skillverse button.
- **Surface**: where Claude Code draws: `terminal`, `desktop`, `vscode` or `mobile`. The pane behaves differently per surface.
- **Web view**: the page at `http://localhost:4317`, served by the **Skillverse server** (`server/skillverse-server.mjs`).
- **Live events**: what the plugin sends the server as it happens (a skill loaded, a turn began), shown in the web view.
- **Terminal app**: `tui/skillverse.mjs`, the full-screen globe, graph and tree; the npm package.
- **Mod**: Claude Code's name for a plugin of function hooks that draws its own UI. Skillverse is a plugin that is a mod.

## Measures

- **New empty session**: the context a fresh session loads before the first message; this session's breakdown without the conversation.
- **Skill descriptions in context**: what listing every skill's name and description costs in tokens.
