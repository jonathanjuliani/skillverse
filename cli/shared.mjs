// What the CLI, the terminal app and the server share: the plugin's modules,
// the cache folder, the ports, and safe JSON reads.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Where Skillverse keeps its files: the plugin's skill list, the server's pid and log. */
export const CACHE_DIR = path.join(os.homedir(), '.cache', 'skillverse')

/** The ports Skillverse serves on, first free one wins; SKILLVERSE_PORT or --port picks one. */
export const DEFAULT_PORTS = [4317, 4318, 4319, 4320]

/**
 * Imports one of the plugin's shared modules: the TypeScript source in a clone
 * (hooks/*.ts; Node 22.18+ runs it), else the build the npm package carries
 * (tui/lib), so a stale build never shadows the code being edited.
 */
export async function load(name) {
  const source = new URL(`../hooks/${name}.ts`, import.meta.url)
  return import(fs.existsSync(source) ? source.href : `../tui/lib/${name}.js`)
}

/** A JSON file's value, or undefined when it is missing or not JSON (both normal here). */
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}
