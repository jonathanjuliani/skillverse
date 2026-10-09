import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const { agentFor, findPort, panelUrl, portsFor } = createRequire(import.meta.url)('../../vscode/lib.js')

describe('the VS Code extension', () => {
  it("opens on the editor's own agent, unless the setting picks one", () => {
    expect(agentFor('vscode')).toBe('copilot')
    expect(agentFor('cursor')).toBe('cursor')
    expect(agentFor('antigravity')).toBe('antigravity')
    expect(agentFor('some-fork')).toBe('')
    expect(agentFor('cursor', 'codex')).toBe('codex')
  })

  it("embeds the web view on the agent's planet, on the port the setting or skillverse run picked", () => {
    expect(panelUrl(4318, 'cursor')).toBe('http://localhost:4318/?embed=1&agent=cursor')
    expect(panelUrl(4317, '')).toBe('http://localhost:4317/?embed=1')
    expect(portsFor(5000)).toEqual([5000])
    expect(portsFor(null)).toEqual([4317, 4318, 4319, 4320])
  })

  it('finds the port a Skillverse web app answers on, and nothing else', async () => {
    const answers: Record<string, unknown> = {
      'http://localhost:4318/health': { skillverse: true },
      'http://localhost:4317/health': { other: true },
    }
    const fake = async (url: string) => {
      if (!(url in answers)) throw new Error('refused')
      return { json: async () => answers[url] }
    }
    expect(await findPort([4317, 4318], fake)).toBe(4318)
    expect(await findPort([4319], fake)).toBeUndefined()
  })
})
