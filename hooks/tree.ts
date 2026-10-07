import type { Region } from './layout'

const FAMILY_MIN = 3
const FAMILY_FROM = 6

export const trimPrefix = (name: string, prefix: string) =>
  prefix && name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name

/** A family of skills sharing a name prefix, or one skill (prefix null); big families nest. */
export type Family = { prefix: string | null; ids: string[]; children?: Family[] }

/**
 * Splits skills into families by their first word ("deploy", "review") when at
 * least three share it; a family of six or more splits again on its next word
 * ("deploy" → "deploy-staging", "deploy-prod"). Small sets, and a word every skill
 * shares, stay flat. Prefixes are full ("deploy-staging"), so a leaf can trim them.
 */
export function familiesOf(skills: { id: string; name: string }[], base = ''): Family[] {
  const rest = (name: string) => trimPrefix(name, base)
  const singles = (list: { id: string; name: string }[]): Family[] =>
    [...list].sort((a, b) => a.name.localeCompare(b.name)).map(skill => ({ prefix: null, ids: [skill.id] }))
  if (skills.length < FAMILY_FROM) return singles(skills)

  const wordOf = (name: string) => {
    const parts = rest(name).split('-')
    return parts.length > 1 ? (parts[0] ?? '') : ''
  }
  const count = new Map<string, number>()
  for (const skill of skills) {
    const word = wordOf(skill.name)
    if (word) count.set(word, (count.get(word) ?? 0) + 1)
  }
  const isFamily = (word: string) => word !== '' && (count.get(word) ?? 0) >= FAMILY_MIN && (count.get(word) ?? 0) < skills.length

  const grouped = new Map<string, { id: string; name: string }[]>()
  const loose: { id: string; name: string }[] = []
  for (const skill of skills) {
    const word = wordOf(skill.name)
    if (isFamily(word)) grouped.set(word, [...(grouped.get(word) ?? []), skill])
    else loose.push(skill)
  }
  if (grouped.size === 0) return singles(skills)

  const families = [...grouped]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([word, members]): Family => {
      const prefix = `${base}${word}`
      const children = members.length >= FAMILY_FROM ? familiesOf(members, `${prefix}-`) : undefined
      const isNested = children?.some(child => child.prefix !== null) ?? false
      return { prefix, ids: members.map(member => member.id), ...(isNested && children ? { children } : {}) }
    })

  return [...families, ...singles(loose)]
}

/** Groups plugins sharing a first word ("team-…", "acme-…") under that root when two or more share it. */
export function byRoot<G extends { one: Region }>(groups: G[]): { root: string | null; groups: G[] }[] {
  const rootOf = (label: string) => (label.includes('-') ? (label.split('-')[0] ?? '') : '')
  const count = new Map<string, number>()
  for (const group of groups) count.set(rootOf(group.one.label), (count.get(rootOf(group.one.label)) ?? 0) + 1)
  const rooted = new Map<string, G[]>()
  const loose: G[] = []
  for (const group of groups) {
    const root = rootOf(group.one.label)
    if (root && (count.get(root) ?? 0) >= 2) rooted.set(root, [...(rooted.get(root) ?? []), group])
    else loose.push(group)
  }

  return [
    ...[...rooted].sort((a, b) => a[0].localeCompare(b[0])).map(([root, list]) => ({ root, groups: list })),
    ...loose.map(group => ({ root: null, groups: [group] })),
  ]
}
