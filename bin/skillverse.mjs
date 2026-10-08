#!/usr/bin/env node
// The skillverse command: the terminal app by default, and the web app.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

import { findRunning, LOG_FILE, portsFor, runHere, start, stop } from '../cli/server.mjs'

const HELP = `Skillverse: every skill your AI agents have, as a globe, a graph and a tree.

Usage:
  skillverse [--scan] [--snapshot WxH ...]   the terminal app (the default)
  skillverse run [web] [--port N] [--project DIR]
                                             start the web app in the background
  skillverse run --here [--dev] [--port N]   run it in this terminal (--dev: reload on change)
  skillverse open                            open the web app in the browser (starts it if needed)
  skillverse status                          is it running, and where
  skillverse stop                            stop the web app skillverse run started
  skillverse --version | --help

The port: --port, else SKILLVERSE_PORT, else the first free one of 4317-4320.
The Claude Code plugin sends its live events to the web app when it runs.
Log: ${LOG_FILE.replace(os.homedir(), '~')}`

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const value = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const version = () => JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function openInBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  spawn(opener, [url], { stdio: 'ignore', detached: true })
    .on('error', () => console.log(`Open ${url} in your browser.`))
    .unref()
}

async function main() {
  const [command] = argv
  if (flag('--help') || flag('-h') || command === 'help') return console.log(HELP)
  if (flag('--version') || flag('-v')) return console.log(version())

  const ports = portsFor(value('--port'))
  const project = value('--project') ?? process.cwd()

  switch (command) {
    case 'run': {
      if (flag('--here') || flag('--dev')) return runHere({ ports, project, isDev: flag('--dev') })
      const server = await start({ ports, project })
      console.log(server.isNew ? `Skillverse web app running at ${server.url}` : `Already running at ${server.url}`)
      console.log('skillverse open shows it, skillverse stop ends it.')
      return
    }
    case 'open': {
      const server = await start({ ports, project })
      console.log(`Opening ${server.url}`)
      return openInBrowser(server.url)
    }
    case 'status': {
      const server = await findRunning(ports)
      if (!server) {
        console.log('Not running. Start it with: skillverse run')
        process.exitCode = 1
        return
      }
      console.log(
        `Running at ${server.url}: web app ${server.version}, pid ${server.pid}, ${server.clients} page(s) open, ${server.seq} event(s)`,
      )
      return
    }
    case 'stop': {
      const port = await stop()
      console.log(port ? `Stopped the web app on port ${port}.` : 'No web app started by skillverse run is running.')
      return
    }
    default:
      if (command && !command.startsWith('-')) {
        console.error(`Unknown command: ${command}\n\n${HELP}`)
        process.exitCode = 2
        return
      }
      await import('../tui/skillverse.mjs')
  }
}

main().catch(error => {
  console.error(`skillverse: ${error.message}`)
  process.exitCode = 1
})
