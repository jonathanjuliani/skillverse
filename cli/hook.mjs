// `skillverse hook <agent>`: what an agent's shell hook runs. It reads the
// hook's JSON on stdin, turns it into live events and posts them to the
// running web app. It never stands in the agent's way: it prints nothing (an
// agent may read a hook's stdout as its reply), always exits 0, and gives up
// after about a second.

import { toEvents } from './hook-events.mjs'
import { findRunning } from './server.mjs'

const GIVE_UP_MS = 1500
const MAX_INPUT = 1024 * 1024

/** Stdin as text, up to MAX_INPUT; '' when nothing comes. */
function readInput(stream = process.stdin) {
  return new Promise(resolve => {
    let text = ''
    stream.setEncoding('utf8')
    stream.on('data', chunk => {
      text += chunk
      if (text.length > MAX_INPUT) stream.destroy()
    })
    stream.on('end', () => resolve(text))
    stream.on('close', () => resolve(text))
    stream.on('error', () => resolve(text))
  })
}

/** Posts the events one hook call means; resolves to how many were sent (0 when the web app is not running). */
export async function sendHook(agent, text, ports, find = findRunning) {
  let input
  try {
    input = JSON.parse(text)
  } catch {
    return 0
  }
  const events = toEvents(agent, input)
  if (events.length === 0) return 0
  const server = await find(ports)
  if (!server) return 0
  await fetch(`${server.url}events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(events),
    signal: AbortSignal.timeout(800),
  })
  return events.length
}

/** Runs the hook for `agent`, then exits 0 whatever happened. */
export async function runHook(agent, ports) {
  setTimeout(() => process.exit(0), GIVE_UP_MS).unref()
  try {
    await sendHook(agent, await readInput(), ports)
  } catch {
    // The web app went away or answered oddly: the agent carries on either way.
  }
  process.exit(0)
}
