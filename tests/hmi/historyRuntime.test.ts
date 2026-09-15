// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP F — history through the running simulation.
 *
 * The module tests prove the buffer. These prove the thing that matters to an
 * operator: that what is stored is the process the simulation actually ran,
 * stamped in simulation time, surviving a speed change, stopping when paused
 * and gone after a reset.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useSimStore } from '../../src/hmi/simStore'
import { COARSE_PERIOD_S, COARSE_WINDOW_S, FINE_WINDOW_S } from '../../src/hmi/sim/history'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

/** source -> P-101 -> LV-101 -> TK-101, with LT-101 and a level controller. */
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { level0: 20 } },
    { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-101' } },
    { id: 'lic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'LIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
}
const registry: Registry = {
  'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'construction.volume': '400 m³' } },
}

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt: number) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const win = (ref: string, span: number) => {
  const h = sim().history
  return h.getSeries(ref, h.latestT - span, h.latestT)
}

beforeEach(() => {
  sim().exitRun()
  sim().enterRun(screen, registry)
})

describe('what gets recorded', () => {
  it('a PV for every measurement, and SP/OP for controllers only', () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(120, 1)
    const refs = sim().history.refs().sort()
    expect(refs).toContain('TK-101.PV')
    expect(refs).toContain('LT-101.PV')
    expect(refs).toContain('LIC-101.PV')
    expect(refs).toContain('LIC-101.SP')
    expect(refs).toContain('LIC-101.OP')
    // a motor has no process variable, so it gets no phantom series
    expect(refs).not.toContain('P-101.PV')
    expect(refs).not.toContain('P-101.RUN')
  })

  it('the samples are the REAL simulation values, not a smoothed stand-in', () => {
    sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('LIC-101', 'MODE', 0)
    sim().writeTag('LIC-101', 'OP', 100)
    advance(600, 1)
    const level = win('TK-101.PV', 600)
    // the vessel genuinely filled, monotonically, from where it started
    expect(level.v[0]!).toBeGreaterThanOrEqual(20)
    expect(level.v[level.v.length - 1]!).toBeGreaterThan(level.v[0]!)
    for (let i = 1; i < level.v.length; i++) expect(level.v[i]!).toBeGreaterThanOrEqual(level.v[i - 1]! - 1e-9)
    // and the last recorded sample matches the live tag, to within a tick
    expect(Math.abs(level.v[level.v.length - 1]! - sim().tags['TK-101']!.PV!)).toBeLessThan(0.1)
  })

  it('PV, SP and OP stay distinct series', () => {
    sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('LIC-101', 'SP', 70)
    advance(300, 1)
    const pv = win('LIC-101.PV', 300)
    const sp = win('LIC-101.SP', 300)
    const op = win('LIC-101.OP', 300)
    expect(sp.v.every((v) => v === 70)).toBe(true)
    expect(pv.v.some((v) => v !== 70)).toBe(true)
    expect(op.v.some((v, i) => v !== pv.v[i])).toBe(true)
  })
})

describe('timestamps are simulation time', () => {
  it('a speed change does not distort the axis', () => {
    sim().tickOnce(1)   // 1x
    sim().tickOnce(1)
    sim().tickOnce(60)  // operator flips to 300x
    sim().tickOnce(60)
    const w = win('TK-101.PV', 1e6)
    expect(w.t).toEqual([1, 2, 62, 122])
    expect(sim().t).toBe(122)
  })

  it('a coarse step is one sample of process time, not a burst of catch-up', () => {
    for (let i = 0; i < 10; i++) sim().tickOnce(60) // ten minutes at 300x
    const w = win('TK-101.PV', 1e6)
    expect(w.t).toEqual([60, 120, 180, 240, 300, 360, 420, 480, 540, 600])
  })
})

describe('pause', () => {
  it('records nothing while the clock is not advancing', () => {
    advance(60, 1)
    const before = sim().history.version
    const samples = win('TK-101.PV', 1e6).v.length
    // pausing is simply the absence of ticks — the engine loop stops calling
    sim().playPause()
    expect(sim().playing).toBe(false)
    expect(sim().history.version).toBe(before)
    expect(win('TK-101.PV', 1e6).v).toHaveLength(samples)
  })

  it('resuming continues from the simulation time it stopped at, with no gap', () => {
    advance(60, 1)
    const tPause = sim().t
    sim().playPause()
    sim().playPause() // some wall-clock time passes; process time does not
    advance(10, 1)
    const w = win('TK-101.PV', 1e6)
    const around = w.t.filter((t) => t > tPause - 3 && t < tPause + 3)
    // consecutive one-second samples straight across the pause
    for (let i = 1; i < around.length; i++) expect(around[i]! - around[i - 1]!).toBeCloseTo(1)
  })
})

describe('reset', () => {
  it('leaves nothing of the previous run behind', () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(600, 1)
    expect(win('TK-101.PV', 1e6).v.length).toBeGreaterThan(30)

    sim().reset()
    expect(sim().t).toBe(0)
    expect(sim().history.latestT).toBe(0)
    expect(sim().history.version).toBe(0)
    expect(sim().history.refs()).toHaveLength(0)
    expect(win('TK-101.PV', 1e6).v).toHaveLength(0)
  })

  it('the new run starts a new timeline from the configured initial state', () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(600, 1)
    sim().reset()
    advance(10, 1)
    const w = win('TK-101.PV', 1e6)
    expect(w.t[0]).toBe(1)
    expect(w.v[0]).toBeCloseTo(20, 0) // back at level0, not where the old run ended
  })

  it('leaving RUN discards it too', () => {
    advance(60, 1)
    sim().exitRun()
    expect(sim().history.refs()).toHaveLength(0)
    expect(sim().historyVersion).toBe(0)
  })
})

describe('a full hour of process time', () => {
  it('stays bounded and serves every operator span', () => {
    sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('LIC-101', 'MODE', 0)
    sim().writeTag('LIC-101', 'OP', 60)
    // 70 process-minutes at the 300x step the speed control actually hands it
    advance(70 * 60, 60)
    expect(sim().t).toBe(70 * 60)

    const h = sim().history
    expect(h.latestT).toBeCloseTo(70 * 60, 0)

    for (const span of [60, 300, 900, 3600]) {
      const w = h.getSeries('TK-101.PV', h.latestT - span, h.latestT, 200)
      expect(w.v.length, `${span}s`).toBeGreaterThan(0)
      expect(w.v.length, `${span}s stays drawable`).toBeLessThanOrEqual(201)
      for (let i = 1; i < w.t.length; i++) expect(w.t[i]!).toBeGreaterThan(w.t[i - 1]!)
      expect(w.t[w.t.length - 1]!).toBeLessThanOrEqual(h.latestT)
    }

    // An hour back is retrievable; the first five minutes have aged out.
    //
    // Sixty samples, not six hundred: at the 300x speed this run used, the
    // simulation itself only produces one state every sixty process-seconds,
    // so that is the finest history that exists to store. Resolution is bounded
    // by the simulation step, not by the buffer — and an hour-long chart wants
    // about sixty points anyway. Run at 1x and the same hour is stored at the
    // coarse tier's full 10 s resolution.
    // 61, not 60: the window is inclusive at both ends, so an hour spaced at
    // sixty seconds catches the sample at each edge
    expect(h.getSeries('TK-101.PV', h.latestT - COARSE_WINDOW_S, h.latestT).v.length).toBe(61)
    expect(h.getSeries('TK-101.PV', 0, 300).v).toHaveLength(0)

    // memory is what the window costs and nothing more
    const held = h.bytes()
    advance(30 * 60, 60)
    expect(h.bytes()).toBe(held)
  })

  it('every signal in the plant survives the hour, still in order', () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(70 * 60, 60)
    for (const ref of sim().history.refs()) {
      const w = sim().history.getSeries(ref, 0, 1e9)
      expect(w.v.length, ref).toBeGreaterThan(0)
      for (let i = 1; i < w.t.length; i++) expect(w.t[i]!, ref).toBeGreaterThan(w.t[i - 1]!)
    }
  })
})

describe('resolution follows the simulation step', () => {
  it('an hour run at 1x stores the coarse tier’s full 10 s detail', () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(70 * 60, 1) // 1x: the store sees a state every second
    const h = sim().history
    const hour = h.getSeries('TK-101.PV', h.latestT - COARSE_WINDOW_S, h.latestT)
    expect(hour.v.length).toBe(COARSE_WINDOW_S / COARSE_PERIOD_S)
    // and the last five minutes are still there at 1 Hz
    expect(h.getSeries('TK-101.PV', h.latestT - 300, h.latestT).v.length).toBe(300)
  })
})

describe('many signals', () => {
  it('a hundred-tag plant records without copying its history each tick', () => {
    const widgets = Array.from({ length: 100 }, (_, i) => ({
      id: `d${i}`, type: 'display' as const, x: 0, y: 0, w: 96, h: 40,
      tag: `PT-${i}`, props: { base: i },
    }))
    sim().exitRun()
    sim().enterRun({ id: 'big', name: 'Big', theme: 'classic', widgets, pipes: [] })
    const h = sim().history
    advance(FINE_WINDOW_S, 1)
    const full = h.bytes()
    expect(h.refs()).toHaveLength(100)

    // identity never changes — nothing is rebuilt, only written into
    advance(COARSE_WINDOW_S, 10)
    expect(sim().history).toBe(h)
    expect(h.bytes()).toBe(full)
    expect(h.getSeries('PT-50.PV', h.latestT - 60, h.latestT).v.length).toBeGreaterThan(0)
  })

  it('a tick between sample periods does no history work at all', () => {
    advance(10, 1)
    const v = sim().history.version
    sim().tickOnce(0.2)
    sim().tickOnce(0.2)
    expect(sim().history.version).toBe(v)
    sim().tickOnce(0.6)
    expect(sim().history.version).toBe(v + 1)
  })
})

describe('quality is retained alongside the values', () => {
  it('a forced period is marked, and a clean window is not', () => {
    advance(20, 1)
    expect(win('LT-101.PV', 20).allGood).toBe(true)
    sim().writeTag('LT-101', 'FORCED', 1)
    advance(20, 1)
    const w = win('LT-101.PV', 10)
    expect(w.allGood).toBe(false)
    expect(w.q.every((q) => q === 'forced')).toBe(true)
  })

  it('a failed instrument is recorded as BAD, not as ordinary data', () => {
    advance(10, 1)
    sim().writeTag('LT-101', 'BAD', 1)
    advance(10, 1)
    expect(win('LT-101.PV', 5).q.every((q) => q === 'bad')).toBe(true)
  })

  it('a controller setpoint carries no quality — it is intent, not measurement', () => {
    sim().writeTag('LT-101', 'BAD', 1)
    advance(20, 1)
    expect(win('LIC-101.SP', 20).allGood).toBe(true)
  })
})
