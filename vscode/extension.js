// Skillverse in VS Code, Cursor, Windsurf and Antigravity: a side panel that
// shows the running Skillverse web app, embedded and on this editor's planet,
// and a status bar item that opens it. When the web app is not running, the
// panel offers to start it in a terminal (which has the shell's PATH).

const vscode = require('vscode')
const { agentFor, findPort, panelUrl, portsFor } = require('./lib.js')

const VIEW = 'skillverse.panel'

const settings = () => vscode.workspace.getConfiguration('skillverse')
const currentAgent = () => agentFor(vscode.env.uriScheme, settings().get('agent'))

const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function page({ frame, cspSource }) {
  const csp = `default-src 'none'; frame-src http://localhost:* http://127.0.0.1:* https:; style-src 'unsafe-inline' ${cspSource}; script-src 'unsafe-inline'`
  const style = `<style>
    html, body { margin: 0; padding: 0; height: 100%; background: #04060c; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    iframe { border: 0; width: 100%; height: 100vh; display: block; }
    .empty { padding: 16px; line-height: 1.5; }
    button { margin: 8px 8px 0 0; padding: 6px 12px; border: 0; border-radius: 4px; cursor: pointer;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    code { font-family: var(--vscode-editor-font-family); }
  </style>`
  const body = frame
    ? `<iframe src="${escapeHtml(frame)}" title="Skillverse" allow="clipboard-write"></iframe>`
    : `<div class="empty">
        <p>The Skillverse web app is not running.</p>
        <p>Start it to see every agent's skills here, and watch them load live.</p>
        <button id="start">Start it</button><button id="retry">Try again</button>
        <p>Not installed yet? <code>npm i -g @jonathanjuliani/skillverse</code></p>
      </div>
      <script>
        const vscode = acquireVsCodeApi()
        document.getElementById('start').onclick = () => vscode.postMessage('start')
        document.getElementById('retry').onclick = () => vscode.postMessage('retry')
      </script>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${style}</head><body>${body}</body></html>`
}

class Panel {
  /** @param {vscode.WebviewView} view */
  async resolveWebviewView(view) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.onDidReceiveMessage(message => {
      if (message === 'start') startWebApp().then(() => this.render())
      if (message === 'retry') this.render()
    })
    await this.render()
  }

  async render() {
    if (!this.view) return
    const port = await findPort(portsFor(settings().get('port')))
    let frame
    if (port) frame = (await vscode.env.asExternalUri(vscode.Uri.parse(panelUrl(port, currentAgent())))).toString(true)
    this.view.webview.html = page({ frame, cspSource: this.view.webview.cspSource })
  }
}

/** Runs `skillverse run` in a terminal, then waits a moment for the web app to answer. */
async function startWebApp() {
  const terminal = vscode.window.createTerminal({ name: 'Skillverse' })
  terminal.sendText('skillverse run')
  terminal.show(true)
  const ports = portsFor(settings().get('port'))
  for (let waited = 0; waited < 8000; waited += 500) {
    if (await findPort(ports)) return
    await new Promise(done => setTimeout(done, 500))
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const panel = new Panel()
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
  item.text = '$(globe) Skillverse'
  item.tooltip = 'Open the Skillverse panel: your agents’ skills, live'
  item.command = 'skillverse.open'
  item.show()

  context.subscriptions.push(
    item,
    vscode.window.registerWebviewViewProvider(VIEW, panel, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('skillverse.open', () => vscode.commands.executeCommand(`${VIEW}.focus`)),
    vscode.commands.registerCommand('skillverse.reload', () => panel.render()),
    vscode.commands.registerCommand('skillverse.openInBrowser', async () => {
      const port = await findPort(portsFor(settings().get('port')))
      if (!port) return vscode.window.showInformationMessage('The Skillverse web app is not running. Start it with: skillverse run')
      const url = panelUrl(port, currentAgent()).replace('embed=1&', '').replace('?embed=1', '')
      vscode.env.openExternal(vscode.Uri.parse(url))
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('skillverse')) panel.render()
    }),
  )
}

function deactivate() {}

module.exports = { activate, deactivate }
