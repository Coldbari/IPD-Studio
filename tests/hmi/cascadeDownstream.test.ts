// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K24 — CASCADE DOWNSTREAM CONSTRAINTS, AND WHICH ONES A MASTER MAY SEE.
 *
 * ── THE MEASUREMENT THAT DECIDED IT ───────────────────────────────────────
 *
 * K23 closed reporting that a master winds against a slave whose `spHigh`
 * caps the setpoint, and left it because §18 forbade choosing a new
 * anti-windup. K24's investigation showed no new anti-windup was needed.
 *
 * Three runs, identical plant, identical demand, only the slave's constraint
 * differing:
 *
 *     slave floored at 30 by...     master came to rest at
 *     ────────────────────────      ──────────────────────
 *     nothing                        OP 0.00   I  8.35   SAT -1
 *     duty.minFlow    (projected)    OP 48.99  I 62.37   SAT  0
 *     signal.spLow    (NOT)          OP 0.00   I 12.06   SAT -1
 *
 * The same fact about the slave produced opposite master behaviour, purely
 * because `duty.minFlow` predated the projection and `signal.spLow` did not.
 * K18 had already built the mechanism, written down its rationale, and said in
 * its own comment that a new constraint changes WHICH STOP rather than adding
 * one. K24 is that sentence applied to the two constraints K23 added.
 *
 * ── AND WHICH CONSTRAINTS DO NOT COUNT ────────────────────────────────────
 *
 * Only the ones that stop the SETPOINT BEING ACCEPTED. The investigation
 * measured all of them and three are deliberately excluded:
 *
 *     slave actuator saturated  the setpoint WAS accepted; the plant cannot
 *                               reach it, so the master's demand is genuine
 *     slave output-rate limited the setpoint WAS accepted and the slave is
 *                               moving toward it
 *     slave has no authority    K16/K17 already HOLD the master's integrator,
 *                               which is stronger than a stop
 *
 * ── AND `SAT` IS NOT THE WORD ─────────────────────────────────────────────
 *
 * A master resting at 50 % because its slave will not take more has half its
 * travel left. `SAT` keeps its K22 meaning — the controller's own configured
 * travel — and the new condition is published separately.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { loopFindings } from '../../src/hmi/sim/authority'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The K15 cascade fixture, which every phase since K17 has been measured on

const cascaded: HmiScreen = {
  id: 'k24', name: 'K24', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
    { id: 'pt', type: 'display', x: 900, y: 160, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 220, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' }
const SLAVE_MAX = 60

/** Nothing is stated unless a test asks. `slave` carries the slave's record. */
const reg = (slave: Record<string, string> = {}, minFlow?: string): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty, ...(minFlow !== undefined ? { 'duty.minFlow': minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'PIC-1': { key: 'PIC-1', kind: 'instrument', fields: { 'signal.cascadeTo': 'FIC-1' } },
  ...(Object.keys(slave).length > 0
    ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: slave } } : {}),
})

const sim = () => useSimStore.getState()
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }
const start = (r: Registry = reg()) => { sim().exitRun(); sim().enterRun(cascaded, r) }
const lineUp = () => { sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) }
const master = () => sim().tags['PIC-1']!
const slave = () => sim().tags['FIC-1']!
const mLoop = () => sim().loops['PIC-1']!
const sLoop = () => sim().loops['FIC-1']!
const spec = (tag: string, r: Registry) =>
  buildSimModel(cascaded, r).controllers.find((c) => c.tag === tag)!
const findings = () => loopFindings(sim().loops).map((f) => `${f.severity}:${f.id}`)

/**
 * Wind the master up hard, then drive its demand down. The only way to see a
 * FLOOR hold anything is to give the integrator somewhere to fall from.
 */
const windThenDrop = (r: Registry, to = 0.2) => {
  start(r)
  lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
  sim().writeTag('PIC-1', 'SP', to); advance(400)
}

beforeEach(() => { start() })

// ── A, B, C. The master's own limits, unchanged ─────────────────────────────

describe('A, B, C — a master’s own travel still stops it, exactly as K17 shipped', () => {
  it('A: an unconstrained cascade projects nothing at all', () => {
    const m = spec('PIC-1', reg())
    expect(m.dsFloorPct).toBeUndefined()
    expect(m.dsCeilPct).toBeUndefined()
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 4); advance(300)
    expect(mLoop().downstreamLimited).toBeUndefined()   // nothing published
  })

  it('B: the master at its OWN output ceiling is SATURATED, and says so', () => {
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(300)
    expect(master().OP).toBe(100)
    expect(mLoop().saturated).toBe(1)
    expect(findings()).toContain('info:cascade-setpoint-limited:PIC-1')
    // its integrator is frozen by its own travel stop, as it always was
    const held = master().I
    advance(200)
    expect(master().I).toBe(held)
  })

  it('C: and at its own FLOOR, likewise', () => {
    windThenDrop(reg())
    expect(master().OP).toBe(0)
    expect(mLoop().saturated).toBe(-1)
  })
})

// ── D, E, F. The slave's setpoint limits, now projected ─────────────────────

describe('D, E, F — the slave’s setpoint limits, on the master’s own scale', () => {
  it('D: a slave `spHigh` becomes a CEILING on the master’s output', () => {
    const m = spec('PIC-1', reg({ 'signal.spHigh': '30' }))
    expect(m.dsCeilPct).toBeCloseTo((30 / SLAVE_MAX) * 100, 9)
    expect(m.dsFloorPct).toBeUndefined()
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(200)
    expect(mLoop().downstreamLimited).toBe(true)
    expect(mLoop().saturated).toBe(0)                  // NOT its own travel
    expect(master().OP!).toBeLessThan(60)              // held near the 50 % map
    const held = master().I
    advance(200)
    expect(master().I).toBe(held)                      // and frozen there
  })

  it('E: a slave `spLow` becomes a FLOOR — the case K23 measured and left', () => {
    const m = spec('PIC-1', reg({ 'signal.spLow': '30' }))
    expect(m.dsFloorPct).toBeCloseTo((30 / SLAVE_MAX) * 100, 9)
    windThenDrop(reg({ 'signal.spLow': '30' }))
    /**
     * K23 MEASURED OP 0.00 AND I 12.06 HERE. The same slave floored at 30 by
     * `duty.minFlow` came to rest at OP 48.99 with I 62.37, because that one
     * constraint had been projected and this one had not.
     */
    expect(master().OP!).toBeGreaterThan(40)
    expect(master().I!).toBeGreaterThan(50)
    expect(mLoop().saturated).toBe(0)
    expect(mLoop().downstreamLimited).toBe(true)
  })

  it('F: both stated give a band, and the master is held at whichever binds', () => {
    const m = spec('PIC-1', reg({ 'signal.spLow': '15', 'signal.spHigh': '45' }))
    expect(m.dsFloorPct).toBeCloseTo(25, 9)
    expect(m.dsCeilPct).toBeCloseTo(75, 9)
    start(reg({ 'signal.spLow': '15', 'signal.spHigh': '45' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
    expect(mLoop().downstreamLimited).toBe(true)
    expect(master().OP!).toBeLessThan(85)
  })

  it('a limit at the very end of the slave’s range is not a stop at all', () => {
    // spHigh AT the top of the range constrains nothing the master could reach
    const m = spec('PIC-1', reg({ 'signal.spHigh': '60' }))
    expect(m.dsCeilPct).toBeUndefined()
    const n = spec('PIC-1', reg({ 'signal.spLow': '0' }))
    expect(n.dsFloorPct).toBeUndefined()
  })
})

// ── G. Minimum flow ─────────────────────────────────────────────────────────

describe('G — minimum flow was already projected, and still is', () => {
  it('G: K18’s floor is unchanged, and is now one of two sources', () => {
    const m = spec('PIC-1', reg({}, '20 m³/h'))
    expect(m.dsFloorPct).toBeCloseTo((20 / SLAVE_MAX) * 100, 9)
    windThenDrop(reg({}, '30 m³/h'))
    // the K23 reference measurement: OP ~49, I ~62, and NOT saturated
    expect(master().OP!).toBeGreaterThan(40)
    expect(master().I!).toBeGreaterThan(50)
    expect(mLoop().saturated).toBe(0)
  })

  it('G: with BOTH a minimum flow and an spLow, the HIGHER floor binds', () => {
    const higherSp = spec('PIC-1', reg({ 'signal.spLow': '40' }, '20 m³/h'))
    expect(higherSp.dsFloorPct).toBeCloseTo((40 / SLAVE_MAX) * 100, 9)
    const higherFlow = spec('PIC-1', reg({ 'signal.spLow': '10' }, '20 m³/h'))
    expect(higherFlow.dsFloorPct).toBeCloseTo((20 / SLAVE_MAX) * 100, 9)
  })

  it('G: the slave’s effective setpoint still comes from K18, untouched', () => {
    start(reg({}, '30 m³/h'))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(300)
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(30)
    expect(sim().minFlow['FIC-1']!.overriding).toBe(true)
  })
})

// ── H, I, J, K. The constraints a master deliberately does NOT see ──────────

describe('H, I, J, K — accepted setpoints, and why three constraints are excluded', () => {
  it('H: a SATURATED SLAVE ACTUATOR is not a downstream stop — the demand is real', () => {
    /**
     * The setpoint was accepted IN FULL; the plant simply cannot reach it. The
     * master's demand is genuine, so it SHOULD wind to its own ceiling — and
     * the measurement shows it behaving identically to the unconstrained case.
     */
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(300)
    expect(slave().SP).toBe(60)                        // accepted in full
    expect(sLoop().saturated).toBe(1)                  // the SLAVE is maxed out
    expect(mLoop().downstreamLimited).toBeUndefined()  // and the master sees nothing
    expect(mLoop().saturated).toBe(1)                  // it correctly used its range
  })

  it('I: a RATE-LIMITED SLAVE is not one either — it is moving toward the demand', () => {
    start(reg({ 'signal.outputRateLimit': '1 %/s' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(100)
    sim().writeTag('PIC-1', 'SP', 8); advance(10)
    expect(sLoop().rateLimited).toBe(true)             // the slave is crawling
    expect(sLoop().spLimit).toBeUndefined()            // ...but it TOOK the setpoint
    expect(mLoop().downstreamLimited).toBeUndefined()
    // and the master is integrating normally through the transient
    const before = master().I
    advance(5)
    expect(master().I).not.toBe(before)
  })

  it('J: a slave with NO AUTHORITY is handled by K16/K17, not by a stop', () => {
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 4); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(60)
    expect(sLoop().authority).toBe('de-energised')
    expect(mLoop().authority).toBe('downstream')       // K17's verdict
    expect(mLoop().downstreamLimited).toBeUndefined()  // NOT this mechanism
    // the master's integrator is HELD, which is stronger than a stop
    const held = { OP: master().OP, I: master().I }
    advance(100)
    expect({ OP: master().OP, I: master().I }).toEqual(held)
  })

  it('K: and authority restored resumes on the ordinary tick', () => {
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 4); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(60)
    sim().writeTag('P-1', 'RUN', 1); advance(400)
    expect(mLoop().authority).toBe('available')
    expect(sLoop().authority).toBe('available')
  })
})

// ── L. Recovery, against the K23 baseline ───────────────────────────────────

describe('L — recovery, which is the whole point', () => {
  it('L: the setpoint moves on the FIRST tick after the demand drops', () => {
    /**
     * THE K23 BASELINE, MEASURED: with the master wound to OP 100 against a
     * slave capped at 30, dropping the demand left the slave's setpoint pinned
     * at 30 for FIFTY TICKS while the master unwound 71 -> 53. Fifty seconds
     * of a loop not responding, on a plant whose own lags are a few seconds.
     *
     * The master is now held where the limit stops it, so there is nothing
     * useless to unwind and the setpoint starts moving immediately.
     */
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(300)
    expect(sLoop().spLimit!.limited).toBe(30)
    const pinned = sLoop().spLimit!.limited

    sim().writeTag('PIC-1', 'SP', 2.2)
    let movedAt = -1
    for (let i = 0; i < 100 && movedAt < 0; i++) {
      advance(1)
      if (sLoop().spLimit!.limited !== pinned) movedAt = i
    }
    // K23 measured 50 ticks of dead time here
    expect(movedAt).toBeGreaterThanOrEqual(0)
    expect(movedAt).toBeLessThan(5)
  })

  it('L: and the loop settles where it should afterwards', () => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(300)
    sim().writeTag('PIC-1', 'SP', 2.2); advance(600)
    expect(mLoop().downstreamLimited).toBe(false)      // the limit released
    expect(sLoop().spLimit!.limiting).toBe(false)
  })
})

// ── M, N, O, P. Modes ───────────────────────────────────────────────────────

describe('M, N, O, P — every cascade mode combination', () => {
  const modes = (m: number, s: number) => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp()
    sim().writeTag('PIC-1', 'MODE', m); sim().writeTag('FIC-1', 'MODE', s)
    sim().writeTag('PIC-1', 'SP', 9)
    advance(200)
  }

  it('M: master AUTO / slave AUTO — the projection acts', () => {
    modes(1, 1)
    expect(mLoop().downstreamLimited).toBe(true)
    expect(mLoop().saturated).toBe(0)
  })

  it('N: master MANUAL / slave AUTO — the hand output still maps, and is still limited', () => {
    modes(0, 1)
    expect(master().MODE).toBe(0)
    // a hand output ABOVE the slave's limit: the map still applies, and so
    // does the slave's own setpoint limit
    sim().writeTag('PIC-1', 'OP', 90); advance(20)
    expect(slave().SP!).toBeGreaterThan(30)        // the master wrote 54
    expect(sLoop().spLimit!.limited).toBe(30)      // the slave carries 30
    // ...and there is no master integration to stop, because MANUAL runs no
    // algorithm — the projection is an anti-windup stop and has nothing to do
    expect(mLoop().downstreamLimited ?? false).toBe(false)
  })

  it('O: master AUTO / slave MANUAL — K17 holds the master, and still does', () => {
    modes(1, 0)
    // a slave in MANUAL is not following, which is K17's `downstream`
    expect(mLoop().authority).toBe('downstream')
    const held = { OP: master().OP, I: master().I }
    advance(100)
    expect({ OP: master().OP, I: master().I }).toEqual(held)
  })

  it('P: both MANUAL — no algorithm runs, and the integrators TRACK', () => {
    modes(0, 0)
    expect(master().MODE).toBe(0)
    expect(slave().MODE).toBe(0)
    /**
     * An integrator in MANUAL is not frozen, it TRACKS: `I = OP - kp·e`, the
     * bumpless-transfer line K14 wrote, so returning to AUTO resumes without a
     * kick. It therefore moves as the measurement moves, and asserting it
     * constant would be asserting that bumpless transfer is broken.
     *
     * What matters here is that the outputs are the operator's and nothing the
     * cascade does changes them.
     */
    const held = { mOP: master().OP, sOP: slave().OP }
    advance(100)
    expect({ mOP: master().OP, sOP: slave().OP }).toEqual(held)
    expect(mLoop().downstreamLimited ?? false).toBe(false)
  })

  it('the transfer back to AUTO is still bumpless', () => {
    modes(0, 1)
    const before = master().OP
    sim().writeTag('PIC-1', 'MODE', 1)
    sim().tickOnce(1)
    expect(Math.abs(master().OP! - before!)).toBeLessThan(15)
  })
})

// ── Q, R, S, T, U. States and diagnostics ───────────────────────────────────

describe('Q-U — four values, three states, and one new informational row', () => {
  it('Q: requested, commanded and actual stay separate through a cascade', () => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
    // the master's request, and the setpoint the slave is carrying
    expect(mLoop().commandedSp).toBeGreaterThan(30)   // what the master asked
    expect(mLoop().effectiveSp).toBe(30)             // what the slave carries
    // the slave's own four
    expect(sLoop().spLimit!.requested).toBeGreaterThan(30)
    expect(sLoop().spLimit!.limited).toBe(30)
    expect(sLoop().requested).toBeDefined()
    expect(sLoop().actual).toBeDefined()
  })

  it('R: SAT keeps its K22 meaning — the controller’s OWN travel', () => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
    expect(mLoop().downstreamLimited).toBe(true)
    expect(mLoop().saturated).toBe(0)
    expect(master().SAT).toBe(0)
    // ...and the master genuinely has travel left, which is why
    expect(master().OP!).toBeLessThan(100)
  })

  it('S, T: RATE LIMITED and NO AUTHORITY remain their own things', () => {
    start(reg({ 'signal.outputRateLimit': '1 %/s', 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(100)
    sim().writeTag('PIC-1', 'SP', 8); advance(5)
    expect(sLoop().rateLimited).toBe(true)          // the slave's output
    expect(sLoop().authority).toBe('available')     // not an authority question
  })

  it('U: the operator is told WHY the master has stopped pushing', () => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
    const f = findings()
    expect(f).toContain('info:cascade-downstream-limited:PIC-1')
    // INFORMATION, never a fault: a cascade respecting a configured limit is
    // the system working
    expect(f.some((x) => x.startsWith('warning:') || x.startsWith('error:'))).toBe(false)
    const row = loopFindings(sim().loops)
      .find((x) => x.id === 'cascade-downstream-limited:PIC-1')!
    expect(row.message).toContain('FIC-1')
    expect(row.message).toContain('has travel left')
  })

  it('U: and the row does NOT claim saturation the master has not reached', () => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
    // K17's saturation row is for the master's own range and must stay silent
    expect(findings()).not.toContain('info:cascade-setpoint-limited:PIC-1')
  })

  it('U: with the slave unconstrained, the OLD row is the one that speaks', () => {
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(300)
    expect(findings()).toContain('info:cascade-setpoint-limited:PIC-1')
    expect(findings()).not.toContain('info:cascade-downstream-limited:PIC-1')
  })
})

// ── V. Determinism ──────────────────────────────────────────────────────────

describe('V — the same inputs give the same cascade, twice', () => {
  it('V: deterministic through the projection and its release', () => {
    const run = () => {
      start(reg({ 'signal.spLow': '10', 'signal.spHigh': '40' }, '15 m³/h'))
      lineUp(); sim().writeTag('PIC-1', 'SP', 9)
      const trace: string[] = []
      for (let i = 0; i < 250; i++) {
        advance(1)
        if (i === 120) sim().writeTag('PIC-1', 'SP', 1)
        trace.push([master().OP, master().I, slave().SP, sLoop().spLimit?.limited,
          mLoop().downstreamLimited]
          .map((x) => (typeof x === 'number' ? x.toFixed(9) : String(x))).join(','))
      }
      return trace
    }
    const a = run()
    expect(run()).toEqual(a)
    expect(new Set(a).size).toBeGreaterThan(20)
  })
})

// ── W-AA. Every phase before K24 ────────────────────────────────────────────

describe('W-AA — K17 through K23, unchanged', () => {
  it('W: K17 cascade wiring and its map', () => {
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 4); advance(300)
    expect(mLoop().cascadeTo).toBe('FIC-1')
    expect(sLoop().cascadeFrom).toBe('PIC-1')
    expect(slave().SP!).toBeGreaterThanOrEqual(0)
    expect(slave().SP!).toBeLessThanOrEqual(SLAVE_MAX)
  })

  it('X: K18 minimum-flow override', () => {
    start(reg({}, '20 m³/h'))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(300)
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(20)
    expect(sim().minFlow['FIC-1']!.inForce).toBe(true)
  })

  it('Y: K21 output-rate limiting on the slave', () => {
    start(reg({ 'signal.outputRateLimit': '5 %/s' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 4); advance(200)
    expect(sLoop().outputRatePctPerS).toBe(5)
  })

  it('Z: K22 — SAT is the controller’s travel, and physical lag is not windup', () => {
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(300)
    expect(mLoop().saturated).toBe(1)
    expect(sLoop().saturated).toBe(1)
  })

  it('AA: K23 setpoint limits still limit the SLAVE’s own setpoint', () => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
    expect(sLoop().spLimit).toMatchObject({ high: 30, limited: 30, limiting: true })
    expect(slave().SP!).toBeGreaterThan(30)          // the master's request survives
  })
})
