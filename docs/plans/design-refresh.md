# Plan: one look across the web view

Status: **built** (branch `feat/multiverse`); twin links in 3D and 2D blend the two tints rather than drawing a gradient (the graph libraries colour a link with one colour). Pairs with [multiverse.md](multiverse.md): Parts 1 and 2 here land first, because the Multiverse view is built on them. The look comes from the [Multiverse mockup](multiverse-mockup.html) (open it in a browser; the data is made up).

## Goal

The four views and the cards read as one product, in the mockup's look: lavender text on a deep night sky, soft translucent panels, a colour for each agent, and lilac for anything shared between agents.

## What changes, and what stays

The category colours are already the mockup's (`hooks/layout.ts`), so they stay. The difference is everything around them.

| | Today | The mockup's look |
|---|---|---|
| Text | `#e5e7eb`, a neutral grey-white | `#c0caf5`, lavender-white (11.7:1 on a card) |
| Muted text | `#8b95a7` | `#7a83a6`, biased to the blue (5.0:1 on a card) |
| Lines | `#1f2937`, solid | `rgba(160, 175, 220, 0.16)`, a translucent hairline |
| Cards | `rgba(11, 15, 26, 0.88)`, 8px blur, 8px radius | `rgba(13, 17, 29, 0.9)`, 12px radius, no blur: a blur over a canvas that redraws is recomputed every frame, so only the bar (over the still sky) keeps one |
| Selected | Filled blue (`--accent`) | Lilac ring (`--twin`) |
| Background | Flat `#04060c` | Nebula and starfield, the same in every view |
| Agents | No colour of their own | A tint each, always shown next to the agent's name |
| Shared, twins | Lilac, in a few places | Lilac everywhere a skill is in more than one agent |

Staying as they are: the category colours, the system font stack (the web app works offline, and Google Fonts needs the network), the cards' and sheet's layout, the phone behaviour (760px and less: one bottom sheet), and the red live dot. `--accent` stays the focus ring.

## Parts

### 1. Tokens and agent tints (S)

- Retune `:root` in `web/styles.css` to the values in the table. Add `--select` (lilac ring), `--radius-card: 12px` and `--blur: 10px`.
- New `web/js/palette.js`, the one place the page's colours live: `BACKGROUND`, `TWIN`, `CATEGORY_COLORS` and `AGENT_TINTS`, with `tintOf(agent)`. The views and `summary.js` import from it instead of each declaring their own (`summary.js`, `orbit.js`, `graph2d.js` and `graph3d.js` each do today).
- `CATEGORY_COLORS` stays duplicated in `hooks/layout.ts` (the plugin cannot import the page). A unit spec reads both files and fails if they drift.
- Agent tints, from the same Tokyo Night family as the categories, but never a category's own hue:

| Agent | Tint |
|---|---|
| Claude Code | `#ff9e64` |
| Codex | `#73daca` |
| Cursor | `#f7768e` |
| Gemini CLI | `#2ac3de` |
| GitHub Copilot | `#a9b1d6` |
| opencode | `#b4f9f8` |
| Windsurf | `#41a6b5` |
| Devin | `#ff757f` |
| Antigravity | `#c3e88d` |
| Shared (`.agents`) | `#c4a7ff`, the twin lilac |

An agent missing from the table gets a tint from the agent's id, picked from the same list, so it stays stable across loads. Claude Code's orange is Project's colour in the pane, but the web app leaves Project out, so the two never meet.

### 2. One sky for every view (S–M)

- New `web/js/sky.js`. It renders the mockup's nebula and starfield **once** per page load into a 2048×1024 canvas, using one short-lived WebGL pass, then frees that context. Every view reuses the canvas.
- Orbit and Multiverse use it as `scene.background` (equirectangular). The 3D graph sets it on `graph.scene().background`. The 2D graph shows it as the container's CSS background, with the graph's own background made transparent.
- Cost: about 50 ms once, at load. Nothing per frame. This replaces drawing the nebula every frame, which was the mockup's most expensive part.

### 3. Bar, switcher and cards (S)

- **Top bar:** translucent with a blur, so the sky shows through, instead of today's opaque gradient. The selected view in the switcher gets the lilac ring.
- **Planet switcher:** each pill gets the agent's tint dot and skill count, as in the mockup. "All" stays first.
- **Card headings:** a small uppercase label with letter-spacing (the mockup's Live heading).
- **Hover cards** (`.orbit-tip`): the mockup's card treatment: 12px radius, blur, the figures as large numbers, the category bars.
- **Shared skills:** a new `sharesOf(agent)` in `summary.js`, built from `twinPairs`, gives "Shares 8 with Codex · 5 with Cursor". It shows in the planet card, the Agents card and the Multiverse view.
- **Reader:** the same card treatment; skill names in chips use the monospace style.

### 4. Live feed (S)

- Each event's dot takes its source agent's tint, so you can tell which agent fired at a glance.
- New rows slide in with the mockup's short rise animation instead of today's blue flash. No animation when reduced motion is set.
- Session chips keep their own colours, drawn as outlines so they don't compete with the agent dot.

### 5. Orbit view (M)

- Each planet's atmosphere takes its agent's tint (`.atmosphereColor`, one call per globe) instead of the one blue.
- Planet labels take the tint, with a muted second line for the skill count (the mockup's label).
- Twin bridges become thin wormhole tubes: a gradient between the two agents' tints with a slow flowing band, the mockup's shader at a smaller radius. They still light up on hover, selection and live events as today.
- The centre star gets the iridescent rim from the mockup's membranes.
- No bloom in Orbit. Glow comes from sprites and shaders, so its cost stays where it is today.

### 6. 3D and 2D graphs (S)

- Twin links are drawn as a gradient between the two agents' tints, instead of flat lilac.
- The background is the shared sky.

### 7. Logo (XS)

The round logo becomes a small iridescent bubble (a conic and radial gradient) that matches the Multiverse bubbles.

## Order

| # | Part | Why this order | Size |
|---|---|---|---|
| 1 | Tokens and agent tints | Everything else reads them, Multiverse too | S |
| 2 | Shared sky | Multiverse needs it, and it unifies the other three views at once | S–M |
| 3 | Bar, switcher, cards | The most visible change, low risk | S |
| 4 | Live feed | Small, and it makes the agent tints useful straight away | S |
| 5 | Orbit view | The default view, the most work | M |
| 6 | 3D and 2D | Small once the tints and sky exist | S |
| 7 | Logo | Last touch | XS |

Parts 1–2 come before [multiverse.md](multiverse.md). Parts 3–7 can go before, after or alongside it.

## Checks

- Check at 1024px and at 375px, in each view, before finishing each part (AGENTS.md).
- Muted text over the brightest part of the nebula, measured through a card, stays at 4.5:1 or more. If it doesn't, the card gets less transparent, and the text keeps its colour.
- No colour is declared outside `palette.js` and `:root` (a grep in review).
- The `palette.js` and `hooks/layout.ts` drift spec passes.

## Exit

Switching between Orbit, 3D, 2D and Multiverse shows one sky and one set of colours. Every agent has its tint in the switcher, the hover cards, the Agents card and the Live feed. Anything shared between agents is lilac in every view.
