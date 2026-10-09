# Contributing

Changes to the plugin, the CLI, and the docs are welcome. A new skill is out of scope until a later release, so this file has no `SKILL.md` template.

The pane in `hooks/register.tsx` has its own rules. Read them in [AGENTS.md](AGENTS.md) before editing that file.

## Checks

```bash
pnpm run lint && pnpm test && pnpm run validate
```

`validate` needs Claude Code 2.1.288 or newer on `PATH`. The rest of the local commands are in [Develop](docs/develop.md).

Add the change under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

Doc fixes can use the `good first skill` label.
