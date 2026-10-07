import { defineConfig } from 'vitest/config'

// Vitest runs what needs no Claude Code: the pure modules, the version script
// and the web view server. Tests that load the plugin stay *.test.ts on
// `claude plugin test`.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.spec.ts'],
    environment: 'node',
  },
})
