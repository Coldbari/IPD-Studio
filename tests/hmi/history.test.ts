// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP F — the history store itself.
 *
 * The audit found capacity measured in SAMPLES (1200 of them), so the window
 * it covered depended on how fast the simulation happened to be running, and a
 * full array copy per signal per tick to maintain it. These tests pin the
 * replacement: capacity in TIME, fixed memory, real samples only.
 */

import { describe, expect, it } from 'vitest'
import {
  COARSE_PERIOD_S, COARSE_WINDOW_S, FINE_PERIOD_S, FINE_WINDOW_S,
  History, TREND_SPANS, qualityCode, qualityFromCode,
} from '../../src/hmi/sim/history'

/** Record `seconds` of one signal at `period`, values = the timestamp. */
function ramp(seconds: number, period = 1, ref = 'LT-101.PV'): History {
  const h = new History()
  for (let t = 0; t <= seconds; t += period) h.record(t, (put) => put(ref, t))
  return h
}

describe('recording', () => {
  it('stores what it is given, in order', () => {
    const h = new History()
    h.record(0, (put) => put('PT-1.PV', 4))
    h.record(1, (put) => put('PT-1.PV', 5))
    h.record(2, (put) => put('PT-1.PV', 6))
    const w = h.getSeries('PT-1.PV', 0, 10)
    expect(w.t).toEqual([0, 1, 2])
    expect(w.v).toEqual([4, 5, 6])
    expect(h.latestT).toBe(2)
  })

  it('samples at the tier period, not at every offered instant', () => {
    // 5 Hz ticks: the fine tier takes one a second, which is the whole point —
    // the old buffer kept all five and filled up five times as fast
    const h = new History()
    for (let i = 1; i <= 25; i++) h.record(i * 0.2, (put) => put('X.PV', i))
    const w = h.getSeries('X.PV', 0, FINE_WINDOW_S)
    // rounded: the 0.2 steps are the TEST's floating-point accumulation, not
    // anything the buffer did to the timestamps it was handed
    expect(w.t.map((t) => Math.round(t * 10) / 10)).toEqual([0.2, 1.2, 2.2, 3.2, 4.2])
  })

  it('an instant between sample periods costs nothing — the visitor is not even called', () => {
    const h = new History()
    let visits = 0
    const rec = (t: number) => h.record(t, (put) => { visits++; put('X.PV', t) })
    rec(0)
    expect(visits).toBe(1)
    rec(0.2); rec(0.4); rec(0.6); rec(0.8)
    expect(visits, 'four ticks inside one sample period allocate nothing').toBe(1)
    rec(1.0)
    expect(visits).toBe(2)
  })

  it('refuses a value that is not a number rather than poisoning the buffer', () => {
    const h = new History()
    h.record(0, (put) => { put('X.PV', Number.NaN); put('Y.PV', 1) })
    expect(h.getSeries('X.PV', 0, 10).v).toHaveLength(0)
    expect(h.getSeries('Y.PV', 0, 10).v).toEqual([1])
  })

  it('a signal first seen mid-run records from then on, without disturbing the others', () => {
    const h = new History()
    for (let t = 0; t <= 5; t++) h.record(t, (put) => { put('A.PV', t); if (t >= 3) put('B.PV', t * 10) })
    expect(h.getSeries('A.PV', 0, 60).t).toEqual([0, 1, 2, 3, 4, 5])
    expect(h.getSeries('B.PV', 0, 60).t).toEqual([3, 4, 5])
    expect(h.getSeries('B.PV', 0, 60).v).toEqual([30, 40, 50])
  })
})

describe('the ring wraps and drops the oldest', () => {
  it('a full fine buffer keeps exactly its window, oldest first', () => {
    const h = ramp(FINE_WINDOW_S + 120) // two minutes past full
    const w = h.getSeries('LT-101.PV', h.latestT - FINE_WINDOW_S, h.latestT)
    expect(w.t).toHaveLength(FINE_WINDOW_S / FINE_PERIOD_S)
    // chronological, and the newest is the latest recorded
    for (let i = 1; i < w.t.length; i++) expect(w.t[i]!).toBeGreaterThan(w.t[i - 1]!)
    expect(w.t[w.t.length - 1]).toBe(h.latestT)
    // the values are the timestamps, so wraparound cannot have shuffled them
    expect(w.v).toEqual(w.t)
  })

  it('samples older than the window are gone, not merely hidden', () => {
    const h = ramp(FINE_WINDOW_S + 120)
    // ask for the very beginning: those samples aged out of the fine tier
    expect(h.getSeries('LT-101.PV', 0, 30).v).toHaveLength(0)
    // but the coarse tier still has that era
    const old = h.getSeries('LT-101.PV', 0, COARSE_WINDOW_S)
    expect(old.t[0]).toBe(0)
  })

  it('the coarse tier bounds an hour, and drops what falls out of it', () => {
    const h = ramp(COARSE_WINDOW_S + 600, COARSE_PERIOD_S)
    const w = h.getSeries('LT-101.PV', 0, h.latestT)
    expect(w.t).toHaveLength(COARSE_WINDOW_S / COARSE_PERIOD_S)
    expect(w.t[0]).toBeGreaterThanOrEqual(600)
  })
})

describe('the window is TIME, whatever the sample rate', () => {
  it('a slow sample rate does not silently stretch the window', () => {
    // 300 slots at one sample a MINUTE would be five hours if capacity were
    // counted in slots. It is counted in seconds, so it is still five minutes.
    const h = new History()
    for (let t = 0; t <= 6 * 3600; t += 60) h.record(t, (put) => put('X.PV', t))
    const fine = h.getSeries('X.PV', h.latestT - FINE_WINDOW_S, h.latestT)
    expect(fine.t[0]!).toBeGreaterThanOrEqual(h.latestT - FINE_WINDOW_S)
    // nothing older than the coarse window survives anywhere
    expect(h.getSeries('X.PV', 0, 3600).v).toHaveLength(0)
    const all = h.getSeries('X.PV', 0, 1e9)
    expect(h.latestT - all.t[0]!).toBeLessThanOrEqual(COARSE_WINDOW_S)
  })

  it('a fast sample rate does not shrink it either', () => {
    const h = new History()
    for (let i = 0; i <= 5 * 3600 * 5; i++) h.record(i * 0.2, (put) => put('X.PV', i))
    const all = h.getSeries('X.PV', 0, 1e9)
    // The oldest held sample is one window back, within a sample or two.
    // Sampling anchors each period to the sample that was actually taken
    // rather than to a fixed grid — that is what stops a coarse 60 s step
    // firing a catch-up burst — so the spacing drifts slightly and the reach
    // lands just inside the window rather than exactly on it.
    const reach = h.latestT - all.t[0]!
    expect(reach).toBeLessThanOrEqual(COARSE_WINDOW_S)
    expect(reach).toBeGreaterThan(COARSE_WINDOW_S - 2 * COARSE_PERIOD_S)
  })

  it('one sample always survives, so a paused plant still shows its last value', () => {
    const h = new History()
    h.record(0, (put) => put('X.PV', 7))
    h.record(10 * COARSE_WINDOW_S, (put) => put('X.PV', 9))
    expect(h.getSeries('X.PV', 0, 1e9).v).toEqual([9])
  })
})

describe('memory is bounded by construction', () => {
  it('stops growing once the rings are full, however long it runs', () => {
    const h = ramp(FINE_WINDOW_S)
    const full = h.bytes()
    for (let t = FINE_WINDOW_S + 1; t <= 6 * COARSE_WINDOW_S; t++) h.record(t, (put) => put('LT-101.PV', t))
    expect(h.bytes()).toBe(full)
    expect(h.latestT).toBe(6 * COARSE_WINDOW_S)
  })

  it('scales linearly in signals and not at all in run length', () => {
    const many = new History()
    for (let t = 0; t <= 120; t++) {
      many.record(t, (put) => { for (let i = 0; i < 10; i++) put(`TAG-${i}.PV`, i + t) })
    }
    const after120 = many.bytes()
    for (let t = 121; t <= 4000; t++) {
      many.record(t, (put) => { for (let i = 0; i < 10; i++) put(`TAG-${i}.PV`, i + t) })
    }
    expect(many.bytes()).toBe(after120)
    expect(many.bytes()).toBe(10 * ramp(120).bytes())
  })
})

describe('retrieval', () => {
  it('serves each of the operator spans', () => {
    const h = ramp(COARSE_WINDOW_S, FINE_PERIOD_S)
    expect(TREND_SPANS).toEqual([60, 300, 900, 3600])
    for (const span of TREND_SPANS) {
      const w = h.getSeries('LT-101.PV', h.latestT - span, h.latestT)
      expect(w.v.length, `${span}s span`).toBeGreaterThan(1)
      // every point lies inside the window that was asked for
      for (const t of w.t) {
        expect(t).toBeGreaterThanOrEqual(h.latestT - span)
        expect(t).toBeLessThanOrEqual(h.latestT)
      }
      // and stays chronological
      for (let i = 1; i < w.t.length; i++) expect(w.t[i]!).toBeGreaterThan(w.t[i - 1]!)
    }
  })

  it('a short span gets the fine tier; an hour gets the coarse one', () => {
    const h = ramp(COARSE_WINDOW_S, FINE_PERIOD_S)
    const minute = h.getSeries('LT-101.PV', h.latestT - 60, h.latestT)
    const hour = h.getSeries('LT-101.PV', h.latestT - 3600, h.latestT)
    expect(minute.v.length).toBeGreaterThan(50)        // ~1 Hz detail
    expect(hour.v.length).toBeLessThan(400)            // ~0.1 Hz, not 3600 points
    expect(hour.t[1]! - hour.t[0]!).toBeCloseTo(COARSE_PERIOD_S)
  })

  it('early in a run a long span still gets full detail, not one lonely point', () => {
    // both tiers start from the same first sample, so there is nothing coarser
    // to fall back to and no reason to pretend there is
    const h = ramp(30)
    expect(h.getSeries('LT-101.PV', 0, 3600).v.length).toBe(31)
  })

  it('an unknown signal is empty, not an error', () => {
    expect(ramp(10).getSeries('NOPE.PV', 0, 100)).toMatchObject({ t: [], v: [] })
  })

  it('does not mutate what it returns from, however often it is called', () => {
    const h = ramp(60)
    const a = h.getSeries('LT-101.PV', 0, 60)
    a.v[0] = 999
    a.t.push(1e9)
    const b = h.getSeries('LT-101.PV', 0, 60)
    expect(b.v[0]).toBe(0)
    expect(b.t).toHaveLength(61)
  })
})

describe('decimation drops samples, it never invents them', () => {
  const h = ramp(300)

  it('every returned value is one that was actually recorded', () => {
    const w = h.getSeries('LT-101.PV', 0, 300, 20)
    expect(w.v.length).toBeLessThanOrEqual(21)
    // values are the timestamps, so a fabricated point would be a non-integer
    for (const v of w.v) expect(Number.isInteger(v)).toBe(true)
    for (let i = 0; i < w.t.length; i++) expect(w.v[i]).toBe(w.t[i])
  })

  it('stays chronological and keeps the newest sample on the right edge', () => {
    const w = h.getSeries('LT-101.PV', 0, 300, 7)
    for (let i = 1; i < w.t.length; i++) expect(w.t[i]!).toBeGreaterThan(w.t[i - 1]!)
    expect(w.t[w.t.length - 1]).toBe(300)
  })

  it('asking for more points than exist returns them all, undecimated', () => {
    // 0..300 is 301 offered samples into a 300-slot ring, so the oldest has
    // already aged out — the ring holds exactly its window and no more
    expect(h.getSeries('LT-101.PV', 0, 300, 10_000).v).toHaveLength(300)
  })
})

describe('quality travels with the sample', () => {
  it('round-trips through the one-byte encoding', () => {
    for (const q of ['good', 'forced', 'stale', 'uncertain', 'bad'] as const) {
      expect(qualityFromCode(qualityCode(q))).toBe(q)
    }
    expect(qualityCode(undefined)).toBe(0)
    expect(qualityFromCode(99)).toBe('good')
  })

  it('a period when a transmitter was forced does not read back as normal data', () => {
    const h = new History()
    for (let t = 0; t <= 10; t++) {
      h.record(t, (put) => put('PT-1.PV', 4, qualityCode(t >= 5 && t <= 7 ? 'forced' : 'good')))
    }
    const all = h.getSeries('PT-1.PV', 0, 10)
    expect(all.allGood).toBe(false)
    expect(all.q[6]).toBe('forced')
    // and a window clear of it reads clean
    expect(h.getSeries('PT-1.PV', 0, 4).allGood).toBe(true)
  })

  it('a bad period is distinguishable from a stale one', () => {
    const h = new History()
    h.record(0, (put) => put('X.PV', 1, qualityCode('bad')))
    h.record(1, (put) => put('X.PV', 1, qualityCode('stale')))
    expect(h.getSeries('X.PV', 0, 10).q).toEqual(['bad', 'stale'])
  })
})

describe('the version counter', () => {
  it('moves only when a sample actually lands', () => {
    const h = new History()
    expect(h.version).toBe(0)
    h.record(0, (put) => put('X.PV', 1))
    expect(h.version).toBe(1)
    h.record(0.2, (put) => put('X.PV', 2)) // inside the sample period
    expect(h.version).toBe(1)
    h.record(1, (put) => put('X.PV', 3))
    expect(h.version).toBe(2)
  })

  it('identity is stable — which is exactly why the counter exists', () => {
    const h = new History()
    const before = h
    h.record(0, (put) => put('X.PV', 1))
    expect(h).toBe(before)
  })
})
