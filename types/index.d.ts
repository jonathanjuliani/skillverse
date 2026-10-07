/** A skill's id: `plugin:name` for a plugin's skill, `name` otherwise. */
export type SkillId = string

declare module 'claude-code' {
  interface PluginState {
    skillverse: {
      selected: SkillId | null
      expanded: string[]
      /** Tree categories the person collapsed (Plugins, Your skills, ...). */
      closed: string[]
      query: string
      indexedAt: number
      /** The web view's URL once served, or a status line while it is written. */
      web: string
      /** Skills selected before the current one, for Back. */
      history: SkillId[]
      /** Bumped when the context figures or skill counts change. */
      statsAt: number
    }
  }
}
