// What each agent has, as the web app's planet and star cards show it, for
// places that are not the web app: `skillverse summary`, the `/skillverse`
// skill every agent can run, and the server's GET /summary.json. Figures only:
// counts, each category's share, and what a session costs in context.

// In the order the web app lists them (hooks/skills.ts CATEGORIES).
const CATEGORY_LABELS = {
  plugins: 'Plugins',
  user: 'Your skills',
  builtin: 'Built-in',
  mcp: 'Connectors (MCP)',
  org: 'Organization',
  project: 'Project',
}

/** Tokens in a text, the usual rough estimate (about four characters each), as the web app counts. */
const estimate = text => Math.ceil(String(text).length / 4)

export const formatTokens = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)))

/**
 * Each agent of the web app's data (combineAgents) as a summary: its figures,
 * its categories, what its skill descriptions cost in every session (measured
 * by a Claude Code session when one sent it, else estimated), a session's
 * measured new empty session, and the skills it used most.
 */
export function summarize(data) {
  return data.agents.map((agent, a) => {
    const own = data.skills.filter(skill => skill.agent === a && skill.kind !== 'mcp')
    const stats = agent.stats ?? {}
    const byName = new Map(own.map(skill => [skill.id.replace(`${agent.id}/`, ''), skill.name]))
    return {
      id: agent.id,
      label: agent.label,
      from: agent.from,
      plugins: agent.summary?.plugins ?? 0,
      skills: agent.summary?.skills ?? 0,
      connectors: agent.summary?.connectors ?? 0,
      categories: Object.keys(CATEGORY_LABELS)
        .map(id => ({ id, label: CATEGORY_LABELS[id], count: agent.summary?.byCategory?.[id] ?? 0 }))
        .filter(category => category.count > 0),
      listing: {
        tokens: stats.listing?.tokens ?? own.reduce((sum, skill) => sum + estimate(`- ${skill.name}: ${skill.description}`), 0),
        isMeasured: Boolean(stats.listing),
      },
      ...(stats.baseline ? { baseline: stats.baseline.tokens } : {}),
      used: Object.entries(stats.uses ?? {})
        .sort(([, x], [, y]) => y - x)
        .slice(0, 5)
        .map(([id, uses]) => ({ name: byName.get(id) ?? id, uses })),
      ...(agent.notes?.length ? { notes: agent.notes } : {}),
    }
  })
}

const bar = (count, most) => '█'.repeat(Math.max(1, Math.round((count / Math.max(1, most)) * 16)))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function figures(one) {
  return [plural(one.skills, 'skill'), plural(one.plugins, 'plugin'), plural(one.connectors, 'connector')].join(' · ')
}

/** One agent as text: figures, categories as bars, costs, the most used skills. */
export function formatAgent(one) {
  if (one.skills + one.connectors === 0) return `${one.label}\n  Installed, but no plugins, skills or connectors were found in its folders.`
  const most = Math.max(...one.categories.map(category => category.count))
  const width = Math.max(...one.categories.map(category => category.label.length))
  const lines = [`${one.label} · ${figures(one)}`]
  for (const category of one.categories)
    lines.push(`  ${category.label.padEnd(width)}  ${String(category.count).padStart(4)}  ${bar(category.count, most)}`)
  if (one.baseline) lines.push(`  New empty session: ${formatTokens(one.baseline)} tokens (measured by a Claude Code session)`)
  if (one.skills > 0) {
    lines.push(
      `  Skill descriptions, every session: ${one.listing.isMeasured ? '' : '≈ '}${formatTokens(one.listing.tokens)} tokens${one.listing.isMeasured ? ' (measured)' : ' (estimated)'}`,
    )
  }
  if (one.used.length) lines.push(`  Used most: ${one.used.map(row => `${row.name} (${row.uses})`).join(', ')}`)
  return lines.join('\n')
}

/** Every agent: one line each, then the totals. */
export function formatAll(list) {
  const width = Math.max(...list.map(one => one.label.length))
  const sum = key => list.reduce((total, one) => total + one[key], 0)
  const lines = list.map(one =>
    one.skills + one.connectors === 0
      ? `  ${one.label.padEnd(width)}  nothing found`
      : `  ${one.label.padEnd(width)}  ${figures(one)} · ${one.listing.isMeasured ? '' : '≈'}${formatTokens(one.listing.tokens)} tok`,
  )
  return [
    `Skillverse · ${plural(list.length, 'agent')} · ${plural(sum('skills'), 'skill')} · ${plural(sum('plugins'), 'plugin')} · ${plural(sum('connectors'), 'connector')}`,
    ...lines,
  ].join('\n')
}

/**
 * `skillverse summary [--agent <id>] [--json]`: from the running web app when
 * there is one (it knows what Claude Code sessions measured), else from a scan.
 */
export async function printSummary({ agent, isJson = false, ports }) {
  const { findRunning } = await import('./server.mjs')
  const server = await findRunning(ports)
  let list
  if (server) {
    // An older web app has no /summary.json: then scan, as when none runs.
    const response = await fetch(`${server.url}summary.json`, { signal: AbortSignal.timeout(10000) }).catch(() => undefined)
    if (response?.ok) list = (await response.json()).agents
  }
  if (!list) {
    const { scanAgents } = await import('./scan.mjs')
    list = summarize(scanAgents())
  }
  const one = agent ? list.find(item => item.id === agent) : undefined
  if (agent && !one) throw new Error(`no planet for ${agent} here; these are: ${list.map(item => item.id).join(', ')}`)
  if (isJson) return console.log(JSON.stringify({ agents: one ? [one] : list, web: server?.url ?? null }, null, 2))
  console.log(one ? formatAgent(one) : formatAll(list))
  console.log(
    server
      ? `\nWeb app: ${server.url}${one ? `?agent=${one.id}` : ''} (the planets, graphs and live activity)`
      : '\nWeb app: not running. skillverse run starts it, with the planets, graphs and live activity.',
  )
}
