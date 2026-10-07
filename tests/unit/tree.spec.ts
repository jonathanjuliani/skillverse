import { describe, expect, it } from 'vitest'
import { byRoot, familiesOf, trimPrefix } from '../../hooks/tree'

describe('byRoot', () => {
  it('gathers plugins sharing a first word under a root and leaves a loner single', () => {
    const group = (label: string) => ({ one: { label, color: '#fff', ids: [], x: 0, y: 0, radius: 1 } })
    const roots = byRoot([group('team-payments'), group('team-platform'), group('acme-a11y'), group('acme-database'), group('kit')])
    expect(roots.map(r => [r.root, r.groups.length])).toEqual([
      ['acme', 2],
      ['team', 2],
      [null, 1],
    ])
  })
})

describe('familiesOf', () => {
  const named = (names: string[]) => names.map(name => ({ id: name, name }))

  it('folds skills sharing a first word into families, and splits a big family on its next word', () => {
    const parts = familiesOf(
      named([
        'deploy-staging-db',
        'deploy-staging-web',
        'deploy-staging-check',
        'deploy-prod-db',
        'deploy-prod-web',
        'deploy-prod-check',
        'deploy-rollback',
        'review-api-a',
        'review-api-b',
        'review-x',
        'fix-typo',
      ]),
    )
    expect(parts.map(p => [p.prefix, p.ids.length])).toEqual([
      ['deploy', 7],
      ['review', 3],
      [null, 1],
    ])
    expect(parts[0]?.children?.map(p => [p.prefix, p.ids.length])).toEqual([
      ['deploy-prod', 3],
      ['deploy-staging', 3],
      [null, 1],
    ])
  })

  it('keeps a small plugin flat', () => {
    expect(familiesOf(named(['create', 'refactor', 'forms'])).every(p => p.prefix === null)).toBe(true)
  })
})

describe('trimPrefix', () => {
  it('drops a family prefix from a skill name', () => {
    expect(trimPrefix('deploy-staging-db', 'deploy-staging-')).toBe('db')
  })
})
