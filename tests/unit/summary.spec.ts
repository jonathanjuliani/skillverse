import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ES module without types (cli/ is JavaScript)
import { formatAgent, formatAll, summarize } from '../../cli/summary.mjs'

const data = {
  agents: [
    {
      id: 'claude',
      label: 'Claude Code',
      from: 'session',
      summary: { skills: 2, connectors: 1, plugins: 1, byCategory: { user: 1, plugins: 1, mcp: 1 } },
      stats: { listing: { tokens: 1234 }, baseline: { tokens: 15000, rows: [] }, uses: { 'docs:write': 3, ship: 1 } },
    },
    { id: 'copilot', label: 'GitHub Copilot', from: 'scan', summary: { skills: 0, connectors: 0, plugins: 0, byCategory: {} } },
  ],
  skills: [
    { id: 'docs:write', name: 'write', description: 'Writes docs', agent: 0 },
    { id: 'ship', name: 'ship', description: 'Ships', agent: 0 },
    { id: 'mcp/linear', name: 'linear', description: '', kind: 'mcp', agent: 0 },
  ],
}

describe('summary', () => {
  it("keeps a session's measured figures, and lists categories in the web app's order", () => {
    const [claude] = summarize(data)
    expect(claude).toMatchObject({ skills: 2, plugins: 1, connectors: 1, listing: { tokens: 1234, isMeasured: true }, baseline: 15000 })
    expect(claude.categories.map((category: { id: string }) => category.id)).toEqual(['plugins', 'user', 'mcp'])
    expect(claude.used).toEqual([
      { name: 'write', uses: 3 },
      { name: 'ship', uses: 1 },
    ])
    const text = formatAgent(claude)
    expect(text).toContain('Claude Code · 2 skills · 1 plugin · 1 connector')
    expect(text).toContain('New empty session: 15.0k tokens')
    expect(text).toContain('Used most: write (3), ship (1)')
  })

  it('says so for an agent with nothing found, and totals every agent', () => {
    const list = summarize(data)
    expect(formatAgent(list[1])).toContain('no plugins, skills or connectors')
    expect(formatAll(list)).toContain('Skillverse · 2 agents · 2 skills · 1 plugin · 1 connector')
  })
})
