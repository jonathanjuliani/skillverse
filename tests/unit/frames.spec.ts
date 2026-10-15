import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ES module without types (web/ is JavaScript)
import { createGovernor, createLoop, createScheduler } from '../../web/js/frames.js'

const clock = () => {
  let t = 0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('createScheduler', () => {
  it('starts idle and draws nothing', () => {
    const c = clock()
    const s = createScheduler({ now: c.now })
    expect(s.state()).toBe('idle')
    expect(s.shouldDraw()).toBe(false)
  })

  it('draws every frame after input, then drifts, then stops', () => {
    const c = clock()
    const s = createScheduler({ now: c.now, idleAfter: 8000 })
    s.wake(1000)
    expect(s.state()).toBe('active')
    expect(s.shouldDraw()).toBe(true)
    c.advance(16)
    expect(s.shouldDraw()).toBe(true)
    c.advance(2000)
    expect(s.state()).toBe('ambient')
    c.advance(7000)
    expect(s.state()).toBe('idle')
    expect(s.shouldDraw()).toBe(false)
  })

  it('draws ambient drift at a lower rate', () => {
    const c = clock()
    const s = createScheduler({ now: c.now, ambientFps: 30 })
    s.wake(0)
    c.advance(1)
    let drawn = 0
    for (let k = 0; k < 60; k++) {
      if (s.shouldDraw()) drawn++
      c.advance(1000 / 60)
    }
    expect(drawn).toBeGreaterThan(25)
    expect(drawn).toBeLessThanOrEqual(31)
  })

  it('goes straight to idle with no drift (reduced motion, Motion off)', () => {
    const c = clock()
    const s = createScheduler({ now: c.now, isDrifting: () => false })
    s.wake(500)
    c.advance(600)
    expect(s.state()).toBe('idle')
  })

  it('wakes again for a live event', () => {
    const c = clock()
    const s = createScheduler({ now: c.now })
    s.wake(100)
    c.advance(20000)
    expect(s.state()).toBe('idle')
    s.wake(1500)
    expect(s.shouldDraw()).toBe(true)
  })
})

describe('createGovernor', () => {
  it('steps down once frames stay slow, and never back up', () => {
    const g = createGovernor({ slowMs: 20, slowFor: 2000, levels: 2 })
    let t = 0
    const run = (ms: number, frames: number) => {
      const changes = []
      for (let k = 0; k < frames; k++) {
        t += ms
        const level = g.sample(ms, t)
        if (level !== null) changes.push(level)
      }
      return changes
    }
    expect(run(16, 200)).toEqual([])
    expect(run(30, 100)).toEqual([1])
    expect(run(10, 500)).toEqual([])
    expect(g.level).toBe(1)
    expect(run(30, 200)).toEqual([2])
    expect(run(60, 200)).toEqual([])
    expect(g.level).toBe(2)
  })

  it('ignores a short spike', () => {
    const g = createGovernor({ slowMs: 20, slowFor: 2000 })
    let t = 0
    for (let k = 0; k < 20; k++) {
      t += 50
      g.sample(50, t)
    }
    for (let k = 0; k < 200; k++) {
      t += 16
      g.sample(16, t)
    }
    expect(g.level).toBe(0)
  })
})

describe('createLoop', () => {
  /** A fake requestAnimationFrame: frames run only when `tick` says so. */
  const frames = () => {
    let queue: (() => void)[] = []
    return {
      request: (f: () => void) => queue.push(f),
      cancel: () => {
        queue = []
      },
      tick: () => {
        const now = queue
        queue = []
        for (const f of now) f()
      },
      get pending() {
        return queue.length
      },
    }
  }

  it('keeps one loop when the view wakes itself while drawing', () => {
    const c = clock()
    const raf = frames()
    const scheduler = createScheduler({ now: c.now })
    let steps = 0
    const loop = createLoop({
      scheduler,
      request: raf.request,
      cancel: raf.cancel,
      step: () => {
        steps++
        // Camera controls report a change while drawing, which wakes the view again.
        loop.wake(300)
      },
    })
    loop.wake(1000)
    for (let k = 0; k < 10; k++) {
      expect(raf.pending).toBe(1)
      raf.tick()
      c.advance(16)
    }
    expect(steps).toBe(10)
  })

  it('stops asking for frames once idle, and starts again when woken', () => {
    const c = clock()
    const raf = frames()
    const scheduler = createScheduler({ now: c.now, isDrifting: () => false })
    const loop = createLoop({ scheduler, request: raf.request, cancel: raf.cancel, step: () => {} })
    loop.wake(100)
    raf.tick()
    c.advance(200)
    raf.tick()
    expect(raf.pending).toBe(0)
    loop.wake(100)
    expect(raf.pending).toBe(1)
    loop.stop()
    expect(raf.pending).toBe(0)
  })
})
