/** One skill as Skillverse knows it: where it came from, what it says, what it names. */
export type Skill = {
  /** `plugin:name` for a plugin's skill, `name` otherwise. */
  id: string
  name: string
  plugin?: string
  /** Where the engine says it came from (`plugin`, `userSettings`, ...). */
  source: string
  /** The region label: the plugin, or the source and name family. */
  region: string
  description: string
  /** The SKILL.md read, when one was found. */
  path?: string
  body: string
  /** Ids of the skills this one names. */
  links: string[]
}

const MAX_LINKS = 40

const SOURCE_LABELS: Record<string, string> = {
  userSettings: 'User',
  projectSettings: 'Project',
  localSettings: 'Local',
  policySettings: 'Managed',
  'built-in': 'Built-in',
  bundled: 'Built-in',
  mcp: 'MCP',
  syncedSkills: 'Synced',
  plugin: 'Plugin',
}

export function splitId(id: string): { plugin?: string; name: string } {
  const at = id.indexOf(':')

  return at < 0 ? { name: id } : { plugin: id.slice(0, at), name: id.slice(at + 1) }
}

export function joinPath(dir: string, rel: string): string {
  return `${dir.replace(/\/+$/, '')}/${rel.replace(/^\.\//, '').replace(/^\/+/, '')}`
}

/**
 * Splits a SKILL.md into its frontmatter fields and its body. Folded (`>`) and
 * literal (`|`) values are joined onto one line.
 */
export function parseSkillFile(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) {
    return { meta: {}, body: text }
  }

  const meta: Record<string, string> = {}
  const lines = (match[1] ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] ?? '')
    if (!field) {
      continue
    }

    let value = (field[2] ?? '').trim()
    if (/^[>|][-+]?$/.test(value)) {
      const parts: string[] = []
      while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1] ?? '')) {
        i++
        const part = (lines[i] ?? '').trim()
        if (part) {
          parts.push(part)
        }
      }
      value = parts.join(' ')
    } else {
      value = value.replace(/^(['"])(.*)\1$/, '$2')
    }
    meta[field[1] ?? ''] = value
  }

  return { meta, body: text.slice(match[0].length) }
}

/**
 * Fills each skill's `links` with the skills its text names: a full
 * `plugin:name`, a `/name`, or a bare hyphenated name. Bare names prefer a
 * skill of the same plugin when several share the name.
 */
export function linkSkills(skills: Skill[]): void {
  const byId = new Map(skills.map(skill => [skill.id.toLowerCase(), skill]))
  const byName = new Map<string, Skill[]>()
  for (const skill of skills) {
    const key = skill.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), skill])
  }

  for (const skill of skills) {
    const found = new Set<string>()
    const text = `${skill.description}\n${skill.body}`.toLowerCase()
    const tokens = /(\/?)\b([a-z0-9][a-z0-9_-]*(?::[a-z0-9_-]+)?)/g
    for (const match of text.matchAll(tokens)) {
      if (found.size >= MAX_LINKS) {
        break
      }

      const isSlashed = match[1] === '/'
      const token = match[2] ?? ''
      let target: Skill | undefined
      if (token.includes(':')) {
        target = byId.get(token)
      } else {
        const named = byName.get(token)
        if (named && (isSlashed || token.includes('-'))) {
          target = named.find(one => one.plugin === skill.plugin) ?? (named.length === 1 ? named[0] : undefined)
        }
      }
      if (target && target.id !== skill.id) {
        found.add(target.id)
      }
    }
    skill.links = [...found]
  }
}

/**
 * Gives every skill its region: its plugin, or for skills outside a plugin
 * their source, split by a shared name prefix (`docs`, `review-tools`) when
 * at least four skills share it.
 */
export function assignRegions(skills: Skill[]): void {
  const counts = new Map<string, number>()
  const loose = skills.filter(skill => !skill.plugin)
  for (const skill of loose) {
    const parts = skill.name.split('-')
    for (const prefix of [parts[0], parts.slice(0, 2).join('-')]) {
      if (prefix) {
        const key = `${skill.source}|${prefix}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }

  for (const skill of skills) {
    if (skill.plugin) {
      skill.region = skill.plugin
      continue
    }

    const parts = skill.name.split('-')
    const two = parts.length > 2 ? parts.slice(0, 2).join('-') : undefined
    const one = parts.length > 1 ? parts[0] : undefined
    const label = SOURCE_LABELS[skill.source] ?? skill.source
    const family =
      two && (counts.get(`${skill.source}|${two}`) ?? 0) >= 4
        ? two
        : one && (counts.get(`${skill.source}|${one}`) ?? 0) >= 4
          ? one
          : undefined
    skill.region = family ? `${label} · ${family}` : label
  }
}
