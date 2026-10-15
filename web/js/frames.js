// When a view draws, and at what quality. A view that sits beside an editor is
// idle most of the time, so it draws only while something moves: every frame
// while you drag, fly or hover or an effect plays (active), a few frames a
// second for slow drift (ambient), and none at all after a while with nothing
// happening (idle). The governor lowers quality when frames get slow, and only
// ever steps down within a page load, so it cannot flicker. Both take the
// clock as an argument, so they can be tested without a browser.

/**
 * `now` returns milliseconds. `isDrifting` says whether there is slow motion
 * worth drawing when nothing else happens (off with reduced motion or Motion off).
 */
export function createScheduler({ now, isDrifting = () => true, idleAfter = 8000, ambientFps = 30 }) {
  let activeUntil = Number.NEGATIVE_INFINITY
  let lastWake = Number.NEGATIVE_INFINITY
  let lastFrame = Number.NEGATIVE_INFINITY
  const scheduler = {
    /** Something happened: draw every frame for `ms`, then drift until idle. */
    wake(ms = 1200) {
      const t = now()
      lastWake = t
      activeUntil = Math.max(activeUntil, t + ms)
    },
    /** 'active', 'ambient' or 'idle'. */
    state() {
      const t = now()
      if (t < activeUntil) return 'active'
      if (t - lastWake < idleAfter && isDrifting()) return 'ambient'
      return 'idle'
    },
    /** Whether to draw a frame now; records it when so. */
    shouldDraw() {
      const t = now()
      const current = scheduler.state()
      if (current === 'idle') return false
      if (current === 'ambient' && t - lastFrame < 1000 / ambientFps - 2) return false
      lastFrame = t
      return true
    },
  }
  return scheduler
}

/**
 * One drawing loop: `step` runs once per animation frame while the scheduler
 * is not idle, and the loop stops when it is. Waking it, even from inside
 * `step`, never starts a second loop (two loops double every frame).
 * `request` and `cancel` are requestAnimationFrame and cancelAnimationFrame.
 */
export function createLoop({ scheduler, step, request, cancel }) {
  let id = 0
  const run = () => {
    id = 0
    step()
    if (!id && scheduler.state() !== 'idle') id = request(run)
  }
  return {
    wake(ms) {
      scheduler.wake(ms)
      if (!id) id = request(run)
    },
    stop() {
      if (id) cancel(id)
      id = 0
    },
  }
}

/**
 * Watches frame times while drawing every frame. When the average stays over
 * `slowMs` for `slowFor` milliseconds it steps quality down one level (up to
 * `levels`), and returns the new level from `sample`; otherwise null.
 */
export function createGovernor({ slowMs = 20, slowFor = 2000, levels = 2 } = {}) {
  let average = 0
  let slowSince = null
  let level = 0
  return {
    get level() {
      return level
    },
    sample(frameMs, t) {
      if (level >= levels) return null
      average = average ? average * 0.9 + frameMs * 0.1 : frameMs
      if (average <= slowMs) {
        slowSince = null
        return null
      }
      slowSince ??= t
      if (t - slowSince < slowFor) return null
      level += 1
      slowSince = null
      average = 0
      return level
    },
  }
}
