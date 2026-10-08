import { defineConfig } from 'vitest/config'

// Vitest runs what needs no Claude Code: the pure modules, the version script
// and the web view server. Tests that load the plugin stay *.test.ts on
// `claude plugin test`.
export default defineConfig({
  // Not tsconfig.json: it extends .claude-plugin/types/, which Claude Code
  // writes locally and git does not keep, so a fresh checkout (CI) has none.
  tsconfig: 'tsconfig.test.json',
  test: {
    include: ['tests/unit/**/*.spec.ts'],
    environment: 'node',
  },
})
