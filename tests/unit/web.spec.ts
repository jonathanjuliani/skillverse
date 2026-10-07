import { describe, expect, it } from 'vitest'
import { layoutGlobe, layoutGraph } from '../../hooks/layout'
import { assignRegions, linkSkills, type Skill } from '../../hooks/skills'
import { buildWebData } from '../../hooks/web'

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
    expect(data.regions[0]?.count).toBe(2)
  })
})
