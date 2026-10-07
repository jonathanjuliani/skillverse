# Plan: install the whole plugin from npm

Status: **planned, not started**. Target release: **0.2.0** (minor: a new install route, nothing removed).

## Goal

Let people install all of Skillverse (the pane, the web view and the terminal app) from npm, as a second route next to the marketplace:

```bash
npm install -g @jonathanjuliani/skillverse
skillverse install
```

Then a new Claude Code session shows the Skillverse button. The marketplace route stays exactly as it is.

## Today

| Route | What it installs |
|---|---|
| Marketplace (`/plugin install skillverse@skillverse`) | The plugin: pane, web view, terminal app (`/skillverse-terminal`) |
| Clone + `CLAUDE_CODE_PLUGIN_DIRS` | The same plugin, from a folder |
| npm (`npx @jonathanjuliani/skillverse`) | **Only the terminal app** (`tui/`, ~17 kB) |

The npm package cannot give the pane or the web view: Claude Code loads plugins from a marketplace install or a plugin folder, and the package ships no plugin files.

## Design

### One install per machine

Two installs of the same plugin (marketplace and npm, or npm and a clone) load it twice: two buttons, double skill counts, two web servers. Every route can coexist in the project, but **a machine uses one**. The CLI enforces this on its side:

- `skillverse install` refuses when another Skillverse install is active and says which one.
- `skillverse doctor` reports every install it finds and flags duplicates.

### How npm installs it

The npm package carries the whole plugin. `skillverse install` adds the package's own folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, the documented way to load a plugin folder in every session, the desktop app included. It never runs on its own: no `postinstall` script.

- **Global install only.** `npx` runs from a cache that can be cleared at any time, which would leave Claude Code pointing at a missing folder. `skillverse install` refuses when it runs from the npx cache and prints the `npm install -g` command instead.
- **The path** is the package folder as Node resolves it (`fs.realpathSync` of the folder above `tui/`), so the global symlink for the `skillverse` command does not matter.
- **Updates** keep the same path: `npm update -g @jonathanjuliani/skillverse` replaces the files in place; the next session loads the new version.

### The CLI

One `skillverse` command, with the terminal app as the default:

| Command | Does |
|---|---|
| `skillverse` (and today's flags: `--scan`, `--snapshot`, …) | Opens the terminal app, unchanged |
| `skillverse install` | Registers this package with Claude Code, after the checks below |
| `skillverse uninstall` | Removes exactly that entry; nothing else |
| `skillverse doctor` | Reports installs, versions and problems; changes nothing |
| `skillverse --version`, `--help` | |

### Where installs are detected

| Install | How the CLI sees it |
|---|---|
| Marketplace | A key starting `skillverse@` in `~/.claude/plugins/installed_plugins.json` |
| Folder (npm or clone) | A path in `CLAUDE_CODE_PLUGIN_DIRS` (in `~/.claude/settings.json` `env`, or the process environment) whose `.claude-plugin/plugin.json` names `skillverse` |
| This npm package | A folder entry equal to this package's resolved path |

## Phases

Each phase ends in something releasable or a decision; later phases depend on earlier ones.

### Phase 0: verify the assumptions (spike, no release)

The plan rests on four facts that are not documented; check each by hand first.

1. **Claude Code loads a plugin folder under `node_modules`.** `npm pack`, `npm install -g` the tarball, add the global folder (for example `/opt/homebrew/lib/node_modules/@jonathanjuliani/skillverse`) to `CLAUDE_CODE_PLUGIN_DIRS`, start a session: the button shows and `claude plugin validate <folder>` passes.
2. **`CLAUDE_CODE_PLUGIN_DIRS` takes a `:`-separated list**, so the CLI can add one entry without dropping the person's others. Test with two folders.
3. **The format of `installed_plugins.json`** (version 2: `plugins` keyed `name@marketplace`, each an array of installs with `installPath`) is stable enough to read. Check after a real marketplace install of Skillverse.
4. **What happens with two installs at once** (marketplace and folder): two buttons? does one win? Write it down: it decides how strict `install` must be.

Exit: all four confirmed, or the plan amended. If (1) fails, stop: npm installs only the terminal app, and the README says so.

### Phase 1: ship the plugin in the npm package

1. Extend `files` in `package.json`: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/`, `server/`, `web/`, `types/`, `tui/`, `README.md`, `LICENSE`, `CHANGELOG.md`. Leave out `.claude-plugin/types/` (generated), `tests/`, `scripts/`, `docs/`, `.github/`.
2. Keep `prepack` building `tui/lib/` (the terminal app's prebuilt modules).
3. Check the tarball: `npm pack --dry-run` lists exactly those files; size about 60 kB.
4. Check it as a plugin: `claude plugin validate` and `claude plugin test` pass against the **unpacked tarball**, not only the repo.

Exit: the published package is a valid plugin folder. Releasable on its own (nothing registers it yet).

### Phase 2: the CLI entry point

1. Split `tui/skillverse.mjs`: a small dispatcher `bin/skillverse.mjs` (subcommands, `--help`, `--version`) and the terminal app as a module it imports. Point `bin` in `package.json` at the dispatcher.
2. No subcommand (or only terminal-app flags): run the terminal app exactly as today. `npx @jonathanjuliani/skillverse` keeps working.
3. `--version` prints the package version; `--help` lists the commands and the three install routes.

Exit: `skillverse`, `skillverse --help` and `skillverse --version` work from a global install and from npx.

### Phase 3: `install` and `uninstall`

**`skillverse install`**

1. Refuse on Windows (not supported yet).
2. Refuse when running from the npx cache (path under `_npx`); print `npm install -g @jonathanjuliani/skillverse`.
3. Check Claude Code: `claude --version` ≥ 2.1.288. Missing or older: warn and continue only with `--force`.
4. Look for other installs (see *Where installs are detected*). Marketplace or a clone found: stop, name it, and say how to remove it (`/plugin uninstall skillverse@skillverse`, or the folder entry).
5. Already registered (this exact path): say so and exit 0.
6. Edit `~/.claude/settings.json` safely:
   - read it; missing → start from `{}`; not valid JSON → stop without touching it;
   - back it up once to `settings.json.skillverse-backup`;
   - append this path to `env.CLAUDE_CODE_PLUGIN_DIRS` (create `env` and the variable if missing; keep every other entry and key);
   - write to a temporary file in the same folder, then rename it over the original.
7. Print: what changed, "start a new Claude Code session", and how to undo it.

**`skillverse uninstall`**

1. Remove this package's path from `CLAUDE_CODE_PLUGIN_DIRS`; drop the variable when it ends up empty; same safe write.
2. Print the next step: `npm uninstall -g @jonathanjuliani/skillverse`.
3. Order matters: npm 7+ runs no uninstall scripts, so a package removed first leaves a dangling entry. `doctor` detects it and `uninstall` still cleans it up afterwards (it matches entries whose folder no longer exists **and** whose path ends in `@jonathanjuliani/skillverse`).

Exit: install, a second install (no-op), uninstall, and uninstall again (no-op) all leave `settings.json` exactly as expected, with other keys and folders intact.

### Phase 4: `doctor`

Read-only. One line per check, ✔ / ⚠ / ✖, and the fix for each problem:

- Platform supported; Node ≥ 22.18.
- Claude Code found and ≥ 2.1.288.
- Installs found: marketplace / npm / clone / none; more than one → ✖ with what to remove.
- The registered npm path exists and is a valid plugin folder (has `.claude-plugin/plugin.json` named `skillverse`).
- Dangling entries (folder gone) → ✖ "run `skillverse uninstall`".
- `~/.cache/skillverse/skillverse.json` present (the terminal app's exact skill list) or not yet (open the pane once).
- `node` on `PATH` for the web view server.

Exit code: 0 when nothing is ✖, else 1 (usable in scripts).

### Phase 5: tests and CI

1. **Unit tests** (`node --test`, no extra dependencies) for the settings edit: empty file, missing `env`, existing entries kept, duplicate not added, removal of the last entry, invalid JSON refused, backup written once.
2. **Detection tests** with fixture `installed_plugins.json` and settings files, under a temporary `HOME`.
3. **End to end in CI** (Linux), in a temporary `HOME` and npm prefix: `npm pack` → `npm install -g --prefix` → `skillverse install` → assert `settings.json` → `skillverse doctor` exits 0 → `claude plugin validate <installed folder>` → `skillverse uninstall` → assert the entry is gone.
4. Keep the existing checks: `check-version`, plugin validate and test, terminal app snapshot.

Exit: CI green on a pull request with all of the above.

### Phase 6: docs and release

1. README *Install*: three routes (marketplace, npm, clone) with **"pick one"** and why.
2. README *Updating* and a new *Uninstalling*, per route.
3. README *Requirements*: npm route needs a global install.
4. CHANGELOG under *Unreleased*: Added (npm install route, `install` / `uninstall` / `doctor`), Changed (the npm package now carries the whole plugin).
5. Release: `pnpm version minor` → `git push --follow-tags` (0.2.0), as in README *Releasing*.
6. After release: on a clean machine (or a fresh user), run the npm route end to end and the marketplace route, one at a time.

## Acceptance criteria

- `npm install -g @jonathanjuliani/skillverse && skillverse install`, then a new session: the Skillverse button shows; the pane, the web view and `/skillverse-terminal` work.
- `skillverse install` with a marketplace install present refuses and explains; nothing is written.
- `skillverse uninstall` leaves `~/.claude/settings.json` as it was before `install` (other keys and folders untouched).
- `npx @jonathanjuliani/skillverse` still opens the terminal app.
- The marketplace route is unchanged and passes its own check.
- CI covers install → doctor → uninstall end to end.

## Risks

| Risk | Mitigation |
|---|---|
| Claude Code does not load plugin folders under `node_modules` | Phase 0 checks it first; if so, the npm route stays terminal-app only |
| The plugin API is early access and changes | `doctor` checks the Claude Code version; CI tests against the current release |
| Editing someone's `settings.json` | Back up once, refuse invalid JSON, change one entry only, write atomically, `uninstall` reverses it |
| Two installs on one machine | `install` refuses; `doctor` flags it; the README says "pick one" |
| `npm uninstall -g` before `skillverse uninstall` leaves a dangling entry | `doctor` detects it; `uninstall` cleans it up later |
| Project or managed settings also set `CLAUDE_CODE_PLUGIN_DIRS` | Only user settings are edited; `doctor` warns when the variable is set elsewhere too |

## Open questions

1. Should `install` also offer `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`? (Useful for development only; probably not.)
2. If Phase 0 shows that two installs at once are harmless (one wins), can `install` warn instead of refusing?
3. Windows: worth a later phase? The plugin itself needs `find`, `grep` and `mkdir` replaced first.

## Out of scope

- Changing the marketplace route.
- Windows support.
- A `postinstall` script that registers the plugin automatically.
