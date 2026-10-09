# Skillverse

See every skill your AI agents have, how they connect, and what they cost.

Skill files and this session's transcript stay on your machine. The web app listens on `127.0.0.1`. Prompts do not leave the machine. The page loads its graph libraries from jsDelivr. The detail is in [How it works](docs/how-it-works.md).

The plugin and the web app install separately. Use either or both. Pick one plugin route. A marketplace install and a folder both loaded show two buttons.

`npx skills add jonathanjuliani/skillverse` is not available until this repo has a skill.

## Install

Plugin, from the marketplace:

```text
/plugin marketplace add jonathanjuliani/skillverse
/plugin install skillverse@skillverse
```

Start a new session. The Skillverse button appears above the prompt.

Web app:

```bash
npm i -g @jonathanjuliani/skillverse
skillverse run
skillverse open
```

Every command is in [Install](docs/install.md).

## Where it shows

- **Pane.** The Claude Code plugin, a mod of function hooks that draws its own UI. A Skillverse button opens a tree of this session's skills, what they cost, and which ones loaded.
- **Web app.** A page on localhost for every agent on the machine: orbit, a 3D graph, and a 2D graph.
- **Terminal app.** `/sv-it` is a full-screen globe, graph, and tree.

## Release

A release is a tag on `main`. The steps are in [Develop](docs/develop.md).

Engineering skills are in [skilldeck](https://github.com/jonathanjuliani/skilldeck).

## Read next

- [Install](docs/install.md) — requirements, clone, commands, updating
- [Use](docs/use.md) — pane, web app, terminal
- [How it works](docs/how-it-works.md) — what it reads, privacy, limits
- [Develop](docs/develop.md) — local commands and releasing
- [Contributing](CONTRIBUTING.md) — plugin, CLI, and docs

MIT, see [LICENSE](LICENSE).
