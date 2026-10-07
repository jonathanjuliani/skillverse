import { describe, expect, it } from 'vitest'
import { assignRegions, linkSkills, parseSkillFile, type Skill } from '../../hooks/skills'

const skill = (id: string, body = '', source = 'plugin'): Skill => {
  const at = id.indexOf(':')
  return {
    id,
    name: at < 0 ? id : id.slice(at + 1),
    ...(at < 0 ? {} : { plugin: id.slice(0, at) }),
    source,
    region: '',
    description: '',
    body,
    links: [],
  }
}

describe('parseSkillFile', () => {
  it('joins a folded description onto one line and returns the body after the frontmatter', () => {
    const parsed = parseSkillFile('---\nname: demo\ndescription: >\n  first line\n  second line\n---\n# Body\n')
    expect(parsed.meta.name).toBe('demo')
    expect(parsed.meta.description).toBe('first line second line')
    expect(parsed.body).toBe('# Body\n')
  })

  it('treats a file without frontmatter as all body', () => {
    expect(parseSkillFile('# Just a body\n')).toEqual({ meta: {}, body: '# Just a body\n' })
  })
})

describe('linkSkills', () => {
  it('links full ids, slash names and hyphenated names, but not bare words', () => {
    const skills = [
      skill('kit:create', 'Then run kit:verify-before-done, see /refactor, and create things.'),
      skill('kit:verify-before-done'),
      skill('kit:refactor'),
      skill('team:create'),
    ]
    linkSkills(skills)
    expect(skills[0]?.links.sort()).toEqual(['kit:refactor', 'kit:verify-before-done'])
  })
})

describe('assignRegions', () => {
  it('makes each plugin a region and groups loose skills by a family of four or more', () => {
    const skills = [
      skill('kit:create'),
      ...['docs-a', 'docs-b', 'docs-c', 'docs-d'].map(id => skill(id, '', 'projectSettings')),
      skill('caveman', '', 'userSettings'),
    ]
    assignRegions(skills)
    expect(skills.map(one => one.region)).toEqual(['kit', 'Project · docs', 'Project · docs', 'Project · docs', 'Project · docs', 'User'])
  })
})
