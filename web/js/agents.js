// The Agents card: one row per agent (a planet) with what it has and what
// listing its skills costs; the open agent shows the new empty session (measured
// by a Claude Code session with the plugin), the heaviest skill descriptions,
// the most used skills, and its categories with their groups. It is where an
// agent is picked.

import { escapeHtml, formatTokens } from './lib.js'
import { agentCost, agents, categoriesOfAgent, colorOf, regionName, skills } from './model.js'
import { state } from './state.js'
import { agentSummary } from './summary.js'

const TOP = 5

const meter = (part, whole) =>
  `<span class="meter"><span style="width:${Math.max(2, Math.round((part / Math.max(1, whole)) * 100))}%"></span></span>`

const skillRow = (i, value) =>
  `<button class="stat-row" data-skill="${i}"><span class="dot" style="background:${colorOf(i)}"></span><span class="label">${escapeHtml(skills[i].name)}</span><span class="value">${value}</span></button>`

/** The open agent's figures and groups. */
function details(a) {
  const agent = agents[a]
  const cost = agentCost(a)
  const approx = cost.isMeasured ? '' : '≈ '
  // What it has, at a glance, as the planet's card shows it.
  const parts = [agentSummary(a, { isCompact: true })]

  if (cost.baseline) {
    const rows = cost.baseline.rows.slice(0, 6)
    parts.push(`<h5>New empty session <span class="total">${formatTokens(cost.baseline.tokens)} tokens</span></h5>
      ${rows.map(row => `<div class="stat-row"><span class="label">${escapeHtml(row.name)}</span>${meter(row.tokens, cost.baseline.tokens)}<span class="value">${formatTokens(row.tokens)}</span></div>`).join('')}`)
  } else if (agent.id === 'claude') {
    parts.push(
      '<p class="note">The new empty session is measured by a Claude Code session with the Skillverse plugin; none has sent its figures yet.</p>',
    )
  }

  if (agent.summary.skills > 0)
    parts.push(`<h5>Skill descriptions in context <span class="total">${approx}${formatTokens(cost.listing)} tokens</span></h5>
    ${cost.isMeasured ? '' : `<p class="note">Estimated from the skill files${agent.id === 'claude' ? '' : `: ${escapeHtml(agent.label)} does not report its context`}.</p>`}
    ${cost.heaviest
      .slice(0, TOP)
      .map(row => skillRow(row.i, `${approx}${formatTokens(row.tokens)}`))
      .join('')}`)

  if (cost.used.length) {
    parts.push(
      `<h5>Most used this session</h5>${cost.used
        .slice(0, TOP)
        .map(row => skillRow(row.i, `${row.uses}×`))
        .join('')}`,
    )
  }

  for (const category of categoriesOfAgent(a)) {
    parts.push(
      `<h5>${escapeHtml(category.label)} <span class="total">${category.count}</span></h5>${category.regions
        .map(
          region =>
            `<button class="region-row" data-region="${region.r}"><span class="dot" style="background:${region.color}"></span><span>${escapeHtml(regionName(region, category.regions.length === 1))}</span><span class="count">${region.count}</span></button>`,
        )
        .join('')}`,
    )
  }
  for (const note of agent.from === 'scan' ? (agent.notes ?? []) : []) parts.push(`<p class="note">${escapeHtml(note)}</p>`)
  return `<div class="agent-details">${parts.join('')}</div>`
}

/** An agent's row: its skills, its connectors when it has any, and what listing the skills costs. */
function rowSummary(agent, cost) {
  const { skills: count, connectors } = agent.summary
  if (agent.count === 0) return 'nothing found'
  const tokens = count > 0 ? ` · ${cost.isMeasured ? '' : '≈'}${formatTokens(cost.listing)} tok` : ''
  return `${count} skills${connectors ? ` · ${connectors} MCP` : ''}${tokens}`
}

export function renderAgentsCard() {
  const rows = agents.map((agent, a) => {
    const isOpen = state.agent === a
    const cost = agentCost(a)
    return `<div class="agent${isOpen ? ' is-open' : ''}">
      <button class="agent-row" data-agent="${a}" aria-expanded="${isOpen}">
        <span class="agent-name">${escapeHtml(agent.label)}</span>
        <span class="count">${rowSummary(agent, cost)}</span>
      </button>
      ${isOpen ? details(a) : ''}
    </div>`
  })
  document.getElementById('legend').innerHTML = rows.join('')
  renderPlanetNav()
  document.getElementById('agents-meta').textContent = `${agents.length}`
}

/** The switcher over the canvas: every planet, and "All" for the whole system; the open one is marked. */
function renderPlanetNav() {
  const nav = document.getElementById('planets')
  if (!nav) return
  const button = (value, label, isOn, key) =>
    `<button data-agent="${value}" aria-pressed="${isOn}" title="${escapeHtml(label)}${key ? ` (key ${key})` : ''}">${escapeHtml(label)}</button>`
  nav.innerHTML = [
    button('all', 'All', state.agent === 'all', '0 or Esc'),
    ...agents.map((agent, a) => button(a, agent.label, state.agent === a, a < 9 ? a + 1 : '')),
  ].join('')
}
