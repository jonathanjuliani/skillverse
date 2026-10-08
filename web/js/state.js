// What the page is showing, and the actions the views call back into. The
// shell (main.js) fills `actions` in, so views never import the shell.

import { neighbours } from './model.js'

export const state = {
  view: 'orbit',
  /** Which agent's skills are in front: an index into agents, or 'all'. */
  agent: 'all',
  selected: -1,
  hover: -1,
  matches: new Set(),
  history: [],
}

export const actions = {
  select: (_i, _isFocused) => {},
  refresh: () => {},
  /** A view started following an agent's planet by itself. */
  followed: _agent => {},
}

export const isLitLink = ([a, b]) => a === state.selected || b === state.selected || a === state.hover || b === state.hover

/** Whether a skill is part of what is being looked at: everything when nothing is selected or hovered. */
export const isRelated = i =>
  state.selected < 0 && state.hover < 0
    ? true
    : i === state.selected || i === state.hover || neighbours[state.selected]?.has(i) || neighbours[state.hover]?.has(i)
