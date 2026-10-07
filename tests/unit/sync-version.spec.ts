import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve('scripts/sync-version.mjs')

/** A throwaway repo holding just the files the script reads and writes. */
function makeRepo(version: string, pluginVersion = version): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillverse-version-'))
  fs.mkdirSync(path.join(dir, '.claude-plugin'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version }))
  fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'skillverse', version: pluginVersion }))
  fs.writeFileSync(
    path.join(dir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'skillverse', version: pluginVersion }] }),
  )
  fs.writeFileSync(
    path.join(dir, 'CHANGELOG.md'),
    [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Fixed',
      '',
      '- A fix.',
      '',
      '## [0.1.0] - 2026-10-07',
      '',
      '[Unreleased]: https://github.com/jonathanjuliani/skillverse/compare/v0.1.0...HEAD',
      '[0.1.0]: https://github.com/jonathanjuliani/skillverse/releases/tag/v0.1.0',
      '',
    ].join('\n'),
  )
  return dir
}

const run = (dir: string, ...args: string[]) => execFileSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
const json = (dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))

describe('sync-version', () => {
  let dir = ''
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  describe('releasing 0.2.0', () => {
    beforeEach(() => {
      dir = makeRepo('0.2.0', '0.1.0')
      run(dir)
    })

    it('copies the version into plugin.json and marketplace.json', () => {
      expect(json(dir, '.claude-plugin/plugin.json').version).toBe('0.2.0')
      expect(json(dir, '.claude-plugin/marketplace.json').plugins[0].version).toBe('0.2.0')
    })

    it('moves the Unreleased changes under a dated 0.2.0 section and links it', () => {
      const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')
      expect(changelog).toMatch(/## \[Unreleased\]\n\n## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}\n\n### Fixed\n\n- A fix\./)
      expect(changelog).toContain('[Unreleased]: https://github.com/jonathanjuliani/skillverse/compare/v0.2.0...HEAD')
      expect(changelog).toContain('[0.2.0]: https://github.com/jonathanjuliani/skillverse/compare/v0.1.0...v0.2.0')
    })

    it('passes the check against its tag', () => {
      expect(run(dir, '--check', 'v0.2.0')).toContain('matching the tag')
    })
  })

  it('fails the check when the plugin files lag behind package.json', () => {
    dir = makeRepo('0.2.0', '0.1.0')
    expect(() => run(dir, '--check')).toThrow(/versions differ/)
  })

  it('fails the check against a tag the files do not carry', () => {
    dir = makeRepo('0.1.0')
    expect(() => run(dir, '--check', 'v0.3.0')).toThrow(/tag v0\.3\.0 but the files say 0\.1\.0/)
  })
})
