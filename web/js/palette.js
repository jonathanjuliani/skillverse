// Every colour the views draw with, in one place: the night sky, the twin
// lilac, each category's hue, and each agent's tint. The page's CSS has the
// same values as tokens (styles.css :root).

export const BACKGROUND = '#04060c'

/** Anything in more than one agent: twins, wormholes, the Shared folder. */
export const TWIN = '#c4a7ff'

/** Each category's hue; hooks/layout.ts CATEGORY_COLORS has the same (tests/unit/palette.spec.ts keeps them equal). */
export const CATEGORY_COLORS = {
  plugins: '#7aa2f7',
  user: '#9ece6a',
  builtin: '#e0af68',
  mcp: '#bb9af7',
  org: '#7dcfff',
  project: '#ff9e64',
}

/** Each agent's tint: the same family as the categories, never a category's own hue, and always shown beside the agent's name. */
export const AGENT_TINTS = {
  claude: '#ff9e64',
  codex: '#73daca',
  cursor: '#f7768e',
  gemini: '#2ac3de',
  copilot: '#a9b1d6',
  opencode: '#b4f9f8',
  windsurf: '#41a6b5',
  devin: '#ff757f',
  antigravity: '#c3e88d',
  shared: TWIN,
}

const SPARE = Object.values(AGENT_TINTS)

/** An agent's tint, by its id or the agent itself; one missing from AGENT_TINTS gets one picked from its id, the same every load. */
export function tintOf(agent) {
  const id = typeof agent === 'string' ? agent : (agent?.id ?? '')
  if (AGENT_TINTS[id]) return AGENT_TINTS[id]
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return SPARE[hash % SPARE.length]
}
