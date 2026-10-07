#!/usr/bin/env node
// One version for Skillverse, kept in package.json, .claude-plugin/plugin.json
// and .claude-plugin/marketplace.json.
//
//   node scripts/sync-version.mjs
//       Copies package.json's version into the plugin files and turns the
//       CHANGELOG's Unreleased section into a dated section for it. `pnpm
//       version <patch|minor|major>` runs this (the "version" script) before
//       it commits and tags, so one command releases all three files.
//
//   node scripts/sync-version.mjs --check [vX.Y.Z]
//       Fails when the three versions differ; given a tag, also when they
//       differ from it or the CHANGELOG has no section for it. CI runs this.

import fs from 'node:fs'

const REPO = 'https://github.com/jonathanjuliani/skillverse'
const PLUGIN = '.claude-plugin/plugin.json'
const MARKETPLACE = '.claude-plugin/marketplace.json'
const CHANGELOG = 'CHANGELOG.md'

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const write = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
const fail = message => {
  console.error(`sync-version: ${message}`)
  process.exit(1)
}

const version = read('package.json').version
const [mode, tagArg] = process.argv.slice(2)

if (mode === '--check') {
  const found = {
    'package.json': version,
    [PLUGIN]: read(PLUGIN).version,
    [MARKETPLACE]: read(MARKETPLACE).plugins?.find(plugin => plugin.name === 'skillverse')?.version,
  }
  const differing = Object.entries(found).filter(([, value]) => value !== version)
  if (differing.length > 0) {
    fail(
      `versions differ: ${Object.entries(found)
        .map(([file, value]) => `${file} ${value}`)
        .join(', ')}. Run: node scripts/sync-version.mjs`,
    )
  }
  const tag = tagArg?.replace(/^refs\/tags\//, '').replace(/^v/, '')
  if (tag && tag !== version) fail(`tag v${tag} but the files say ${version}`)
  if (tag && !fs.readFileSync(CHANGELOG, 'utf8').includes(`## [${version}]`)) fail(`${CHANGELOG} has no "## [${version}]" section`)
  console.log(`sync-version: ${version} in package.json, plugin.json and marketplace.json${tag ? ', matching the tag' : ''}`)
  process.exit(0)
}

const plugin = read(PLUGIN)
plugin.version = version
write(PLUGIN, plugin)

const marketplace = read(MARKETPLACE)
for (const entry of marketplace.plugins ?? []) if (entry.name === 'skillverse') entry.version = version
write(MARKETPLACE, marketplace)

let changelog = fs.readFileSync(CHANGELOG, 'utf8')
if (!changelog.includes(`## [${version}]`)) {
  if (!changelog.includes('## [Unreleased]')) fail(`${CHANGELOG} has no "## [Unreleased]" section to release`)
  const today = new Date().toISOString().slice(0, 10)
  // The newest released version, from the first version link, before this one is added.
  const previous = /^\[(\d+\.\d+\.\d+)\]: /m.exec(changelog)?.[1]
  changelog = changelog.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${today}`)
  changelog = changelog.replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n[${version}]: ${previous ? `${REPO}/compare/v${previous}...v${version}` : `${REPO}/releases/tag/v${version}`}`,
  )
  fs.writeFileSync(CHANGELOG, changelog)
}

console.log(`sync-version: ${version} written to plugin.json, marketplace.json and ${CHANGELOG}`)
