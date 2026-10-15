import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ES module without types (web/ is JavaScript)
import { AGENT_TINTS, CATEGORY_COLORS, tintOf } from '../../web/js/palette.js'

describe('palette', () => {
  it('has the same category colours as the pane (hooks/layout.ts)', () => {
    const source = fs.readFileSync(new URL('../../hooks/layout.ts', import.meta.url), 'utf8')
    const block = source.slice(source.indexOf('const CATEGORY_COLORS'), source.indexOf('}', source.indexOf('const CATEGORY_COLORS')))
    const pane = Object.fromEntries([...block.matchAll(/(\w+): '(#[0-9a-f]{6})'/g)].map(([, id, color]) => [id, color]))
    expect(pane).toEqual(CATEGORY_COLORS)
  })

  it('never gives an agent a category hue', () => {
    const categories = new Set(Object.values(CATEGORY_COLORS))
    // Claude Code's orange is Project's, which the web app leaves out.
    const clashes = Object.entries(AGENT_TINTS).filter(([id, tint]) => id !== 'claude' && categories.has(tint))
    expect(clashes).toEqual([])
  })

  it('tints an unknown agent the same way every time', () => {
    expect(tintOf('codex')).toBe(AGENT_TINTS.codex)
    expect(tintOf({ id: 'codex' })).toBe(AGENT_TINTS.codex)
    expect(tintOf('some-new-agent')).toBe(tintOf('some-new-agent'))
    expect(Object.values(AGENT_TINTS)).toContain(tintOf('some-new-agent'))
  })
})
