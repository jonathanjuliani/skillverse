# Plan: Multiverse view

Status: **built** (branch `feat/multiverse`). The frame scheduler is in Multiverse and Orbit; the 3D graph keeps its library's own loop. Mockup: [multiverse-mockup.html](multiverse-mockup.html) (open it in a browser; the data is made up). Needs Parts 1 and 2 of [design-refresh.md](design-refresh.md) first: agent tints and the shared sky.

## Goal

A fourth view, beside Orbit, 3D and 2D, that answers one question: **what do my agents share, and where do they differ?** Orbit shows what each agent has, and 3D and 2D show how skills link to each other. Neither shows the overlap between agents at a glance.

Each agent is a universe: a glowing bubble with its skills inside as a galaxy. A skill installed in two agents is a wormhole between their bubbles.

## What it shows

| On screen | Meaning | From |
|---|---|---|
| A bubble | One agent | `agents` |
| Bubble size | Number of skills, by square root | `agent.count` |
| Distance between bubbles | How many skills two agents share: more in common, closer together | `twinPairs` |
| A galaxy inside a bubble | The agent's skills, one spiral arm per category, one star per skill | `skillsOfAgent`, `skill.category` |
| A star's distance from the centre | How many links the skill has: the most linked sit near the core | `neighbours` |
| A brighter star | A skill that is also installed in another agent | `skill.twins` |
| A wormhole | Skills installed in both agents. It gets thicker with more shared skills | `twinPairs`, counted per pair of agents |
| A lilac cluster between the bubbles | Shared skills (`~/.agents`), with a thread to each agent that has one of its skills | The `shared` agent and its twins |
| A small, dim, flickering bubble | An agent that is installed but has nothing in it | `agent.count === 0` |

## How it behaves

The view implements the same interface as the others (AGENTS.md: "When changing the web app's page").

| Method | In Multiverse |
|---|---|
| `init` / `destroy` | Builds the scene. `destroy` frees every geometry, material, texture and render target, the post-processing passes and the WebGL context |
| `refresh` | Search matches flare in every universe, and the wormholes between matches light up. The selection is ringed |
| `resize` | Renderer, composer and point scale |
| `showAgent(a)` | Flies through that agent's bubble into its galaxy. The planet switcher and keys 1–9 call it |
| `fit` | Flies back out to every universe. "All", 0 and Esc call it |
| `focus(i)` / `fly(i)` | Flies into the skill's universe and flares its star. The reader opens through `actions.select` as usual |
| `focusRegion(r)` | Flies into the region's universe and brightens that category's arm |

- **Hover:** a bubble shows the planet card (`agentSummary`) plus `sharesOf` ("Shares 8 with Codex"). A wormhole lists the skills both agents have; clicking one opens it in the reader. A star shows its name, category and the other agents it's in.
- **Live events:** the star flares and a ripple runs across its bubble. If the skill has twins, a pulse travels through each wormhole and flares the twin when it arrives. This uses `live.js` (`glowOf`, `heatOf`) like the other views. "Follow activity" flies to the universe that fired.
- **URL:** `?view=multiverse`. The button reads "Multiverse".

## Performance

The mockup redraws everything at 60 fps forever. The real view only draws when something changes, and costs nothing while idle.

**Budget, measured on an M-series MacBook, full screen, retina:**

| State | Target |
|---|---|
| Idle (nothing moving, no hover, no live events for 8 s) | No frames drawn. Close to 0% CPU and GPU |
| Ambient drift | 30 fps or less, under 4 ms GPU per frame |
| Dragging, flying, a live event playing | 60 fps, under 12 ms per frame |
| Memory | Under 200 MB for the tab, flat over an hour |
| Load | Interactive in under 1 s once three.js is cached |

**How:**

1. **Frame scheduler** (`web/js/frames.js`). Three states:
   - `active`: 60 fps while you drag, fly or hover, and while an effect plays.
   - `ambient`: 30 fps for the slow drift.
   - `idle`: no frames at all, after 8 s with nothing happening.
   
   Pointer input, a live event, a resize or a search wakes it. It's a pure state machine with the clock passed in, so it can be unit-tested. When the tab is hidden it already draws nothing, as the other views do today.
2. **Baked sky.** The nebula comes from `sky.js` (design-refresh Part 2), rendered once into a small 1024×512 image; the stars are points (`views/sky3d.js`), sharp at any zoom. Nothing is computed per pixel per frame for the background.
   **One loop** (`createLoop` in `frames.js`): waking the view while it draws never starts a second loop. An early build did, and the loops doubled every frame until the browser blocked WebGL.
3. **Resolution caps.** Pixel ratio at most 1.5, like Orbit. **No bloom**: three.js's bloom pass over the sky took 50–260 ms a frame on an M3 Pro, so the glow comes from sprites and the skins' own edge glow.
4. **Quality governor.** It keeps an average of frame time. If frames take over 20 ms for 2 s, it drops the pixel ratio to 1. It only steps down within a page load, never back up, so it can't flicker between settings.
5. **Light geometry.** Bubbles at 48×32 segments. All of an agent's stars are one draw call, and so is its dust. Hover tests use low-poly invisible spheres, and run at most once per frame.
6. **Motion.** A "Motion" toggle in the canvas tools pauses drift and spin (remembered in `localStorage`, wrapped in try/catch). With `prefers-reduced-motion`, there's no drift, and the camera cuts instead of flying.
7. **Measuring.** `?perf=1` adds a small overlay: fps, frame time, draw calls (`renderer.info`), frames drawn since load, the current pixel ratio and the textures in memory. Check the budget with Chrome's Task Manager and the overlay.

The frame scheduler also fits Orbit and the 3D graph, which draw every frame while visible today. Adopting it there is the last part of this plan.

## Files

| File | What |
|---|---|
| `web/js/views/multiverse-layout.js` | Pure: overlap per pair of agents, bubble positions (fixed starting point, so the same on every load, never overlapping), star positions per galaxy. No three.js |
| `web/js/views/multiverse.js` | The view: scene, shaders, picking, flights, live effects |
| `web/js/frames.js` | Frame scheduler and quality governor, pure |
| `web/js/views/sky3d.js` | The sky inside a scene: the nebula texture and the star points, shared by Orbit and Multiverse |
| `web/index.html`, `web/js/main.js` | The Multiverse button, `#view-multiverse`, registering the view |
| `web/styles.css` | Labels, wormhole card, the perf overlay |
| `tests/unit/multiverse-layout.spec.ts`, `tests/unit/frames.spec.ts` | See Tests |
| `docs/use.md`, `README.md`, `CONTEXT.md`, `CHANGELOG.md` | The new view, and its words: **universe**, **wormhole** |

## Parts

| # | Part | Size |
|---|---|---|
| 1 | Layout module and its specs | S |
| 2 | The scene: bubbles, galaxies, wormholes, Shared cluster, labels, baked sky, wired into the page | M |
| 3 | Interaction: hover cards, flights, switcher and keys, reader, `focus` and `focusRegion` | M |
| 4 | Live events and search | S |
| 5 | Performance: frame scheduler, governor, resolution caps, motion toggle, `?perf=1`, fallback without WebGL (a short note, and the page switches to Orbit) | M |
| 6 | Docs, and the frame scheduler adopted in Orbit and 3D | S |

## Tests

- **Layout:**
  - The same input gives the same positions.
  - No two bubbles overlap.
  - Two agents that share skills sit closer than two that share none.
  - An empty agent still gets a bubble.
  - Every star stays inside its bubble.
- **Frame scheduler:**
  - Input moves it to `active`.
  - It goes to `idle` after 8 s with nothing happening, and then asks for no frames.
  - A live event wakes it.
  - The governor steps down once per threshold and never back up.
- **By hand, at 1024px and 375px:**
  - Every interaction in the table above.
  - The idle check: leave it for 10 s and the overlay's frame counter stops.
  - The network panel shows one copy of three.js.

## Risks and decisions

- **Two copies of three.js.** jsDelivr's `+esm` builds rewrite `three` imports. Check that the post-processing modules load `three@0.180.0/+esm` and not another version. If they don't, give each addon an exact URL that resolves to 0.180.0 before going further. AGENTS.md has the same rule for Orbit.
- **Many shared skills.** One wormhole per pair of agents, never one per skill, so ten agents means at most 45 tubes.
- **Shared isn't a bubble.** Shared (`.agents`) is a cluster between the bubbles, because it's read by other agents rather than being one. Its threads come from twins, so no new scan data is needed.
- **Big agents.** A galaxy with hundreds of skills stays one draw call. Dust is capped at 1,500 points per galaxy.

## Exit

`?view=multiverse` shows every installed agent as a universe, with wormholes between agents that share skills, from the real scan. Hover, flights, the reader, search and live events work as in the other views. Left alone for 10 s, it draws no frames.
