import { describe, expect, it } from 'vitest'
import { layoutGlobe, layoutGraph } from '../../hooks/layout'
import { assignRegions, linkSkills, type Skill } from '../../hooks/skills'
import { buildWebData, combineAgents } from '../../hooks/web'

describe('buildWebData', () => {
  it('turns links into indexes and cuts long bodies', () => {
    const skills: Skill[] = [
      {
        id: 'kit:create',
        name: 'create',
        plugin: 'kit',
        source: 'plugin',
        region: '',
        description: '',
        body: `see kit:refactor ${'x'.repeat(7000)}`,
        links: [],
      },
      { id: 'kit:refactor', name: 'refactor', plugin: 'kit', source: 'plugin', region: '', description: '', body: '', links: [] },
    ]
    assignRegions(skills)
    linkSkills(skills)
    const { regions, graph } = layoutGraph(skills)
    const data = buildWebData(skills, regions, graph, layoutGlobe(skills, regions), '2026-10-06T00:00:00.000Z')
    expect(data.skills[0]?.links).toEqual([1])
    expect(data.skills[0]?.body.length).toBeLessThan(6100)
    // The full length survives the cut, for the skill's token cost when it loads.
    expect(data.skills[0]?.chars).toBeGreaterThan(7000)
    expect(data.regions[0]?.count).toBe(2)
  })
})

describe('combineAgents', () => {
  const part = (id: string, names: string[]) => {
    const skills: Skill[] = names.map(name => ({
      id: name,
      name,
      source: 'userSettings',
      region: '',
      description: '',
      body: '',
      links: [],
    }))
    assignRegions(skills)
    linkSkills(skills)
    const { regions, graph } = layoutGraph(skills)
    return { id, label: id, from: 'scan' as const, data: buildWebData(skills, regions, graph, layoutGlobe(skills, regions), '') }
  }

  it('keeps each agent, shifts indexes, prefixes ids after the first, and links twins', () => {
    const data = combineAgents([part('claude', ['docs', 'lint']), part('empty', []), part('codex', ['docs'])], '')
    expect(data.agents?.map(agent => agent.id)).toEqual(['claude', 'codex'])
    expect(data.skills.map(skill => skill.id)).toEqual(['docs', 'lint', 'codex/docs'])
    expect(data.skills[2]?.agent).toBe(1)
    expect(data.regions[data.skills[2]?.region ?? -1]?.agent).toBe(1)
    expect(data.skills[0]?.twins).toEqual([2])
    expect(data.skills[2]?.twins).toEqual([0])
    expect(data.skills[1]?.twins).toBeUndefined()
  })

  it('carries the stats a session sent on its agent', () => {
    const measured = { ...part('claude', ['docs']), from: 'session' as const, stats: { listing: { tokens: 40, perSkill: { docs: 40 } } } }
    const data = combineAgents([measured, part('codex', ['docs'])], '')
    expect(data.agents?.[0]?.stats?.listing?.tokens).toBe(40)
    expect(data.agents?.[1]?.stats).toBeUndefined()
  })

  it('places each agent to the right of the one before', () => {
    const data = combineAgents([part('claude', ['a', 'b', 'c']), part('codex', ['d', 'e'])], '')
    const right = Math.max(...data.skills.filter(skill => skill.agent === 0).map(skill => skill.x))
    const left = Math.min(...data.skills.filter(skill => skill.agent === 1).map(skill => skill.x))
    expect(left).toBeGreaterThan(right)
  })
})
