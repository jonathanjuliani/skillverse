# Skillverse

See every skill your AI agents have, how they connect, and what they cost.

The plugin and the web app install separately. Use either or both. Pick one plugin route. A marketplace install and a folder both loaded show two buttons.

## Do this

1. Plugin only, from the marketplace:

```text
/plugin marketplace add jonathanjuliani/skillverse
/plugin install skillverse@skillverse
```

Start a new session. The Skillverse button appears above the prompt.

2. Plugin and web app together. This installs `skillverse@skilldeck` when no Skillverse plugin is already installed, and installs `@jonathanjuliani/skillverse` when the web app is missing. It does not start the server.

```bash
npm i -g @jonathanjuliani/skilldeck
skilldeck install skillverse
```

3. Web app alone:

```bash
npm i -g @jonathanjuliani/skillverse
skillverse run
```

## Where it shows

- **Pane.** The Claude Code plugin, a mod of function hooks that draws its own UI. A Skillverse button opens a tree of this session's skills, what they cost, and which ones loaded.
- **Web app.** A page on localhost for every agent on the machine: orbit, a 3D graph, and a 2D graph.
- **Terminal app.** `/sv-it` is a full-screen globe, graph, and tree.

## Read next

- [Install](docs/install.md) — requirements, clone, commands, updating
- [Use](docs/use.md) — pane, web app, terminal
- [How it works](docs/how-it-works.md) — what it reads, privacy, limits
- [Develop](docs/develop.md) — local commands and releasing

MIT, see [LICENSE](LICENSE).
