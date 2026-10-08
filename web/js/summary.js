// What an agent has, and what all of them have together, as one block of HTML:
// the figures (plugins, skills, connectors), each category's share as a bar,
// and what a session costs. The planet and star cards on the Orbit view and
// the open agent in the Agents card show the same block.

import { escapeHtml, formatTokens } from './lib.js'
import { agentCost, agents, CATEGORIES, categoriesOfAgent } from './model.js'

/** The colour each category is drawn in (hooks/layout.ts CATEGORY_COLORS). */
const CATEGORY_COLORS = { plugins: '#7aa2f7', user: '#9ece6a', builtin: '#e0af68', mcp: '#bb9af7', org: '#7dcfff', project: '#ff9e64' }

const figures = list =>
  `<dl class="sum-figures">${list.map(([value, label]) => `<div><dd>${value}</dd><dt>${label}</dt></div>`).join('')}</dl>`

const bars = rows => {
  const most = Math.max(1, ...rows.map(row => row.count))
  return `<div class="sum-rows">${rows
    .map(
      row =>
        `<div class="sum-row"><span class="dot" style="background:${row.color}"></span><span class="label">${escapeHtml(row.label)}</span><span class="meter"><span style="width:${Math.max(4, Math.round((row.count / most) * 100))}%;background:${row.color}"></span></span><span class="value">${row.count}</span></div>`,
    )
    .join('')}</div>`
}

const cost = (label, value, note) =>
  `<div class="sum-cost"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`

/** One agent: its figures, its categories, and its new empty session (measured) or skill descriptions (estimated). */
export function agentSummary(a, { isCompact = false } = {}) {
  const agent = agents[a]
  if (agent.count === 0) return '<p class="sum-note">Installed, but no plugins, skills or connectors were found in its folders.</p>'
  const { summary } = agent
  const spend = agentCost(a)
  const parts = [
    figures([
      [summary.plugins, 'plugins'],
      [summary.skills, 'skills'],
      [summary.connectors, 'connectors'],
    ]),
    bars(categoriesOfAgent(a).map(category => ({ label: category.label, count: category.count, color: CATEGORY_COLORS[category.id] }))),
  ]
  if (isCompact) return parts.join('')
  if (spend.baseline)
    parts.push(cost('New empty session', `${formatTokens(spend.baseline.tokens)} tokens`, 'measured by a Claude Code session'))
  else if (summary.skills > 0) {
    const why =
      agent.id === 'claude'
        ? 'estimated until a session with the plugin measures it'
        : `estimated: ${escapeHtml(agent.label)} does not report its context`
    parts.push(cost('Skill descriptions, every session', `≈ ${formatTokens(spend.listing)} tokens`, why))
  }
  return parts.join('')
}

/** Every agent together: totals, each category across all of them, and each agent's share. */
export function allSummary() {
  const sum = key => agents.reduce((total, agent) => total + (agent.summary?.[key] ?? 0), 0)
  const byCategory = CATEGORIES.flatMap(([id, label]) => {
    const count = agents.reduce((total, agent) => total + (agent.summary?.byCategory?.[id] ?? 0), 0)
    return count ? [{ label, count, color: CATEGORY_COLORS[id] }] : []
  })
  const perAgent = agents.map((agent, a) => {
    const spend = agentCost(a)
    const tokens = agent.summary.skills ? ` · ${spend.isMeasured ? '' : '≈'}${formatTokens(spend.listing)} tok` : ''
    return `<div class="sum-agent"><span class="label">${escapeHtml(agent.label)}</span><span class="value">${agent.count ? `${agent.count}${tokens}` : 'nothing found'}</span></div>`
  })
  const measured = agents.findIndex((_, a) => agentCost(a).baseline)
  return [
    figures([
      [agents.length, 'agents'],
      [sum('plugins'), 'plugins'],
      [sum('skills'), 'skills'],
      [sum('connectors'), 'connectors'],
    ]),
    bars(byCategory),
    `<div class="sum-agents">${perAgent.join('')}</div>`,
    measured >= 0
      ? cost(
          `New empty session, ${escapeHtml(agents[measured].label)}`,
          `${formatTokens(agentCost(measured).baseline.tokens)} tokens`,
          'measured by a Claude Code session',
        )
      : '',
  ].join('')
}
