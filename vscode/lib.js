// What the extension decides without VS Code: which planet an editor is, and
// the panel's address. Kept apart so the tests can load it.

/** The agent each VS Code-based editor is, by its URI scheme; VS Code's own agent is Copilot. */
const EDITOR_AGENTS = {
  vscode: 'copilot',
  'vscode-insiders': 'copilot',
  cursor: 'cursor',
  windsurf: 'windsurf',
  antigravity: 'antigravity',
}

/** The planet to open on: the setting, else this editor's own agent, else every agent (''). */
function agentFor(uriScheme, setting = '') {
  return setting || EDITOR_AGENTS[uriScheme] || ''
}

/** The ports to look at: the setting alone, or the ones `skillverse run` tries. */
function portsFor(setting) {
  return Number.isInteger(setting) && setting > 0 ? [setting] : [4317, 4318, 4319, 4320]
}

/** The web view, embedded and on the agent's planet. */
function panelUrl(port, agent) {
  const params = new URLSearchParams({ embed: '1' })
  if (agent) params.set('agent', agent)
  return `http://localhost:${port}/?${params}`
}

/** The first port a Skillverse web app answers on, or undefined. */
async function findPort(ports, fetchImpl = fetch) {
  for (const port of ports) {
    try {
      const response = await fetchImpl(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(800) })
      if ((await response.json())?.skillverse === true) return port
    } catch {
      // Nothing there, or not Skillverse.
    }
  }
  return undefined
}

module.exports = { agentFor, findPort, panelUrl, portsFor }
