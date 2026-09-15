// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * PROCESS HISTORY — a time-bounded, fixed-memory store of what the plant did.
 *
 * WHAT IT REPLACES. History used to be `Record<string, number[]>` beside a
 * shared `number[]` time axis, rebuilt wholesale on every tick:
 *
 *     history[key] = [...(history[key] ?? []), v].slice(-1200)
 *
 * That is an allocation and a full copy per signal per tick — at 5 Hz and 500
 * signals, six hundred thousand element copies a second — and the 1200-sample
 * cap meant capacity was measured in SAMPLES, so the window it covered
 * depended on how fast the simulation happened to be running. Four minutes at
 * 1×, twenty at 5×.
 *
 * WHAT THIS IS. Capacity is measured in TIME. Two fixed-size ring buffers per
 * signal, written in place:
 *
 *   - FINE   1 sample/s for the last 5 minutes   (300 slots)
 *   - COARSE 1 sample/10 s for the last 60 minutes (360 slots)
 *
 * so a 60-minute trend costs 360 stored points rather than the 18 000 a flat
 * 1 Hz buffer would need. Nothing is averaged or interpolated on the way in or
 * on the way out: every point returned is a value the simulation actually
 * produced, at the simulation time it produced it. Decimation drops samples,
 * it never invents them.
 *
 * Deterministic, DOM-free and independent of React — the version counter is
 * how rendering finds out something changed, because the buffers themselves
 * are mutated in place and have stable identity by design.
 */

import type { Quality } from './quality'

/** Fine tier: one sample a second, covering the last five minutes. */
export const FINE_PERIOD_S = 1
export const FINE_WINDOW_S = 5 * 60
/** Coarse tier: one sample every ten seconds, covering the last hour. */
export const COARSE_PERIOD_S = 10
export const COARSE_WINDOW_S = 60 * 60

const FINE_CAP = Math.ceil(FINE_WINDOW_S / FINE_PERIOD_S)
const COARSE_CAP = Math.ceil(COARSE_WINDOW_S / COARSE_PERIOD_S)

/** The spans an operator can ask a trend for, in seconds. */
export const TREND_SPANS = [60, 300, 900, 3600] as const
export type TrendSpan = (typeof TREND_SPANS)[number]

/**
 * Quality stored as one byte per sample.
 *
 * The encoding lives HERE rather than in `sim/quality.ts` because it is a
 * storage concern — the quality model itself has no opinion about byte
 * layouts, and this keeps that module untouched. One byte per sample makes
 * retaining quality alongside every value cost about 4 % of the buffer, which
 * is cheap enough that there was no reason to defer it: a period when a
 * transmitter was FORCED or BAD stays visible in the trend rather than
 * blending into normal live data.
 */
const QUALITY_ORDER: readonly Quality[] = ['good', 'forced', 'stale', 'uncertain', 'bad']
export const qualityCode = (q: Quality | undefined): number => {
  const i = q === undefined ? 0 : QUALITY_ORDER.indexOf(q)
  return i < 0 ? 0 : i
}
export const qualityFromCode = (c: number): Quality => QUALITY_ORDER[c] ?? 'good'

/** One signal's samples in one tier. Three parallel typed arrays, written in
 *  place; `head` is the next slot and `size` how many are valid. */
interface Ring {
  t: Float64Array
  v: Float64Array
  q: Uint8Array
  head: number
  size: number
}

const makeRing = (cap: number): Ring => ({
  t: new Float64Array(cap),
  v: new Float64Array(cap),
  q: new Uint8Array(cap),
  head: 0,
  size: 0,
})

/**
 * Append a sample and drop whatever has aged out.
 *
 * TWO bounds, and the time one is the contract. The slot count caps memory;
 * `windowS` caps the span, and without it coverage would depend on how fast
 * the simulation happened to be running — 300 slots at one sample a second is
 * five minutes, but the same 300 slots at the one-per-minute rate a 300×
 * training run produces would quietly be five HOURS. That drifting window is
 * the defect this whole module replaces, and it would have come straight back.
 */
function push(r: Ring, t: number, v: number, q: number, windowS: number): void {
  r.t[r.head] = t
  r.v[r.head] = v
  r.q[r.head] = q
  r.head = (r.head + 1) % r.t.length
  if (r.size < r.t.length) r.size++
  // expire from the tail: anything older than the window is no longer held
  // the epsilon matches the acceptance test above: accumulated 0.2 s steps
  // land a hair past the boundary and would evict a sample that is exactly
  // one window old
  while (r.size > 1 && t - r.t[at(r, 0)]! > windowS + 1e-6) r.size--
}

/** Oldest-first index of the i-th valid sample. */
const at = (r: Ring, i: number): number => (r.head - r.size + i + r.t.length * 2) % r.t.length

interface Tier {
  periodS: number
  /** How far back this tier holds, in simulation seconds. The contract. */
  windowS: number
  /** Slot count: the MEMORY bound, sized for `windowS` at `periodS`. */
  cap: number
  /** Simulation time at which this tier will accept its next sample. */
  nextT: number
  rings: Map<string, Ring>
}

const makeTier = (periodS: number, windowS: number, cap: number): Tier =>
  ({ periodS, windowS, cap, nextT: -Infinity, rings: new Map() })

/** A window of real samples, oldest first. Plain arrays: the copy happens once
 *  per render at retrieval, never per tick, and the caller cannot reach into
 *  the stored buffers. */
export interface SeriesWindow {
  t: number[]
  v: number[]
  q: Quality[]
  /** False when any sample in the window was anything but a live good value —
   *  lets a trend mark the period rather than drawing it as normal data. */
  allGood: boolean
}

export const EMPTY_WINDOW: SeriesWindow = { t: [], v: [], q: [], allGood: true }

/** What a renderer is allowed to do with history. */
export interface HistoryReader {
  /** Newest simulation timestamp recorded, or 0 before anything is. */
  readonly latestT: number
  /** Bumped whenever a sample lands. The React-facing change signal, because
   *  the buffers are mutated in place and keep stable identity. */
  readonly version: number
  /** Real samples in `[from, to]`, oldest first, at most `maxPoints` of them. */
  getSeries(ref: string, from: number, to: number, maxPoints?: number): SeriesWindow
  /** Every signal recorded so far. */
  refs(): string[]
}

export class History implements HistoryReader {
  private readonly fine = makeTier(FINE_PERIOD_S, FINE_WINDOW_S, FINE_CAP)
  private readonly coarse = makeTier(COARSE_PERIOD_S, COARSE_WINDOW_S, COARSE_CAP)
  private _latestT = 0
  private _version = 0

  get latestT(): number { return this._latestT }
  get version(): number { return this._version }

  /**
   * Offer one simulation instant to the store.
   *
   * `visit` is only invoked for tiers that will actually accept `t`, so a tick
   * that falls between sample periods costs one comparison and nothing else —
   * no array, no closure allocation per signal, no copy.
   *
   * Callers pass SIMULATION time. Nothing here reads a wall clock, which is
   * what makes a 300× run and a 1× run produce the same timestamps for the
   * same process history.
   */
  record(t: number, visit: (put: (ref: string, value: number, quality?: number) => void) => void): void {
    const tiers: Tier[] = []
    for (const tier of [this.fine, this.coarse]) {
      if (t + 1e-9 < tier.nextT) continue
      tiers.push(tier)
    }
    if (tiers.length === 0) return

    for (const tier of tiers) {
      // anchor the next slot to THIS sample, so a coarse step (300× hands the
      // store 60 s at a time) does not try to catch up with a burst
      tier.nextT = t + tier.periodS
    }
    const put = (ref: string, value: number, quality = 0): void => {
      if (!Number.isFinite(value)) return
      for (const tier of tiers) {
        let ring = tier.rings.get(ref)
        if (!ring) {
          ring = makeRing(tier.cap)
          tier.rings.set(ref, ring)
        }
        push(ring, t, value, quality, tier.windowS)
      }
    }
    visit(put)
    if (t > this._latestT) this._latestT = t
    this._version++
  }

  /**
   * Pick the tier that serves this window.
   *
   * A request no wider than the fine tier's coverage gets full resolution.
   * Anything wider goes coarse ONLY IF coarse actually reaches further back —
   * which it does not for the first five minutes of a run, when both tiers
   * start from the same first sample. Without that second condition an
   * hour-long trend would show a single point thirty seconds into a run while
   * the fine tier sat on thirty perfectly good ones.
   *
   * Either way every point returned is a real sample. The caller never has to
   * know which tier answered, which is the point of the split.
   */
  private tierFor(ref: string, from: number, to: number): Tier {
    if (to - from <= FINE_WINDOW_S) return this.fine
    const fine = this.fine.rings.get(ref)
    const coarse = this.coarse.rings.get(ref)
    if (!coarse || coarse.size === 0) return this.fine
    if (!fine || fine.size === 0) return this.coarse
    return coarse.t[at(coarse, 0)]! < fine.t[at(fine, 0)]! ? this.coarse : this.fine
  }

  getSeries(ref: string, from: number, to: number, maxPoints = Infinity): SeriesWindow {
    const tier = this.tierFor(ref, from, to)
    const ring = tier.rings.get(ref)
    if (!ring || ring.size === 0) return EMPTY_WINDOW

    // collect the in-window indices first, oldest-first, so decimation can be
    // a stride over REAL samples rather than a resampling
    const idx: number[] = []
    for (let i = 0; i < ring.size; i++) {
      const k = at(ring, i)
      const ts = ring.t[k]!
      if (ts < from) continue
      if (ts > to) break
      idx.push(k)
    }
    if (idx.length === 0) return EMPTY_WINDOW

    const stride = maxPoints >= idx.length ? 1 : Math.ceil(idx.length / Math.max(1, maxPoints))
    const t: number[] = []
    const v: number[] = []
    const q: Quality[] = []
    let allGood = true
    for (let i = 0; i < idx.length; i += stride) {
      const k = idx[i]!
      t.push(ring.t[k]!)
      v.push(ring.v[k]!)
      const qq = qualityFromCode(ring.q[k]!)
      if (qq !== 'good') allGood = false
      q.push(qq)
    }
    // always land on the newest sample so the right edge of a trend is current
    const last = idx[idx.length - 1]!
    if (t[t.length - 1] !== ring.t[last]) {
      t.push(ring.t[last]!)
      v.push(ring.v[last]!)
      const qq = qualityFromCode(ring.q[last]!)
      if (qq !== 'good') allGood = false
      q.push(qq)
    }
    return { t, v, q, allGood }
  }

  refs(): string[] {
    // the coarse tier sees every signal the fine tier does
    return [...this.coarse.rings.keys()]
  }

  /** Bytes of sample storage currently held. Bounded by construction:
   *  (signals) x (300 + 360) slots x 17 bytes, and nothing else grows. */
  bytes(): number {
    const perSlot = 8 + 8 + 1
    return (this.fine.rings.size * FINE_CAP + this.coarse.rings.size * COARSE_CAP) * perSlot
  }
}

/** A reader over nothing — edit mode, and anywhere a run has not started. */
export const EMPTY_HISTORY: HistoryReader = new History()
