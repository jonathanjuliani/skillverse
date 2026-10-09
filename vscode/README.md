# Skillverse for VS Code

A side panel with every skill your AI agents have (Claude Code, Codex, Copilot, Cursor, Gemini CLI and more), their costs in context, and the skills they load, live. It shows the [Skillverse](https://github.com/jonathanjuliani/skillverse) web app, opened on this editor's own agent: Copilot in VS Code, Cursor's in Cursor, Windsurf's in Windsurf, Antigravity's in Antigravity.

It needs the web app running:

```bash
npm i -g @jonathanjuliani/skillverse
skillverse run
```

The panel's **Start it** button runs that last command in a terminal. To see an agent's skills load live, set it up once: `skillverse setup <agent>`.

Settings: `skillverse.port` (default: the port `skillverse run` picked) and `skillverse.agent` (default: this editor's agent).
