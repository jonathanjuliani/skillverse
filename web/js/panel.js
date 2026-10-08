// The reader: the selected skill's name, group, agent, description, links
// both ways, the same skill installed for other agents, and its SKILL.md. A
// connector (an MCP server) shows its transport and the agents that also have it.

import { escapeHtml, formatTokens } from './lib.js'
import { agents, categoryLabel, colorOf, costOf, incoming, isConnector, regions, skills } from './model.js'
import { state } from './state.js'

const chip = i =>
  `<button class="chip" data-skill="${i}"><span class="dot" style="background:${colorOf(i)}"></span><span>${escapeHtml(skills[i].name)}</span></button>`

const twinChip = i =>
  `<button class="chip" data-skill="${i}"><span class="dot" style="background:${colorOf(i)}"></span><span>${escapeHtml(agents[skills[i].agent]?.label ?? '')}</span></button>`

/** What the skill costs: its description in every session, its SKILL.md when it loads, and its uses. */
function costs(i) {
  const cost = costOf(i)
  const isClaude = agents[skills[i].agent]?.id === 'claude'
  const cell = (label, value, title) => `<div title="${escapeHtml(title)}"><dt>${label}</dt><dd>${value}</dd></div>`
  return `<dl class="costs">
    ${cell('Every session', `${cost.isMeasured ? '' : '≈ '}${formatTokens(cost.listing)}`, `Tokens its name and description take in context, in every session${cost.isMeasured ? ' (measured by Claude Code)' : ' (estimated)'}`)}
    ${cell('When it loads', `≈ ${formatTokens(cost.body)}`, 'Tokens its SKILL.md adds when the skill is used (estimated)')}
    ${cell('Used', isClaude && agents[skills[i].agent].stats ? `${cost.uses}×` : '–', isClaude ? 'Times this Claude Code session used it' : 'Only Claude Code sessions report uses')}
  </dl>`
}

const section = (title, items, toChip) =>
  items.length ? `<h4>${title} <span class="count">${items.length}</span></h4><div class="chips">${items.map(toChip).join('')}</div>` : ''

export function renderPanel() {
  const head = document.getElementById('reader-head')
  const body = document.getElementById('reader-body')
  const i = state.selected
  document.body.classList.toggle('has-selection', i >= 0)
  if (i < 0) {
    head.innerHTML = ''
    body.innerHTML = `<p class="empty">Pick a skill on the ${state.view === 'orbit' ? 'planets' : 'graph'}, search, or choose an agent.</p>
      <p class="empty">Links come from skills naming each other: a full <code>plugin:name</code>, a <code>/name</code>, or a hyphenated name.</p>`
    return
  }
  const skill = skills[i]
  const region = regions[skill.region]
  const agent = agents[skill.agent]
  const isMcp = isConnector(i)
  head.innerHTML = `
    <div class="reader-title">
      <h2>${escapeHtml(skill.name)}</h2>
      <button class="icon" id="clear" aria-label="Close">✕</button>
    </div>
    <div class="chips">
      ${agents.length > 1 ? `<span class="tag">${escapeHtml(agent?.label ?? '')}</span>` : ''}
      <span class="tag">${escapeHtml(categoryLabel(skill.category))}</span>
      <button class="chip" data-region="${skill.region}"><span class="dot" style="background:${region.color}"></span><span>${escapeHtml(region.label)}</span></button>
    </div>
    ${skill.description ? `<p class="desc">${escapeHtml(skill.description)}</p>` : ''}
    ${isMcp ? '' : costs(i)}
    <div class="actions">
      ${isMcp ? '' : `<button class="primary" id="copy">Copy /${escapeHtml(skill.id.split('/').pop())}</button>`}
      ${state.history.length ? '<button id="back">← Back</button>' : ''}
    </div>
    ${skill.path ? `<div class="path" title="${escapeHtml(skill.path)}">${escapeHtml(skill.path)}</div>` : ''}`

  if (isMcp) {
    body.innerHTML = `${section('Also installed for', skill.twins, twinChip)}
      <p class="empty">A connector: its tools are listed by ${escapeHtml(agent?.label ?? 'the agent')} when it runs, so what they cost in context is not in any file. Skillverse reads only its name and how it is reached; commands, headers and keys are never read into the page.</p>`
    body.scrollTop = 0
    return
  }
  body.innerHTML = `${section('Links to', skill.links, chip)}${section('Linked from', incoming[i], chip)}${section('Also installed for', skill.twins, twinChip)}
    <h4>SKILL.md</h4><div class="md" id="md"></div>`
  body.scrollTop = 0
  const md = document.getElementById('md')
  if (!skill.body.trim()) {
    md.innerHTML = '<p class="empty">No SKILL.md was found for this skill.</p>'
  } else if (window.marked && window.DOMPurify) {
    md.innerHTML = window.DOMPurify.sanitize(window.marked.parse(skill.body))
  } else {
    md.innerHTML = `<pre>${escapeHtml(skill.body)}</pre>`
  }
}
