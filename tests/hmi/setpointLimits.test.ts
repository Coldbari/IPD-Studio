// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K23 — ENGINEERING SETPOINT LIMITS, AND THE SIX RANGES THAT ARE NOT ONE.
 *
 * K22's audit found six paths that can produce a controller setpoint and
 * recorded that they disagreed: the faceplate clamped an operator's entry to
 * the CALIBRATED RANGE at the widget, K17 mapped a master's output onto that
 * same range, and a scenario or a direct write was bounded by nothing at all.
 * The same loop could therefore be driven to different setpoints depending on
 * who asked.
 *
 * ── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
 *
 * Not the clamping. The CONFLATION. A calibrated range is a CAPABILITY
 * statement — what an instrument can measure. An operating limit is an
 * AUTHORITY statement — what a loop may be asked for. A transmitter ranged
 * 0-60 m³/h may sit on a loop nobody is permitted to run below 10, and until
 * K23 there was nowhere to say so.
 *
 *     signal.range     what the instrument can MEASURE      (capability)
 *     signal.spLow/High what the loop may be ASKED for      (authority)
 *     signal.setpoint  where the loop STARTS                (initial value)
 *
 * ── AND THE ONE PLACE THE LIMIT ACTS ──────────────────────────────────────
 *
 * Where the setpoint is READ, not where it is written, so an operator, a
 * scenario, a direct write and a cascade master all meet it exactly once. The
 * faceplate's own clamp is now cosmetic; the engine is the constraint.
 *
 * `SP` is never rewritten — the operator's entry survives, exactly as K15
 * requires and exactly as K18 leaves it alone — and both numbers are published
 * so the plate can show what was asked beside what is being held.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { engineeringFor } from '../../src/model/signalData'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { Scenario } from '../../src/hmi/sim/scenario'

// ── The fixture: K15's plant, which every phase since has been measured on ──

const plant: HmiScreen = {
  id: 'k23', name: 'K23', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** ...and the same plant with a pressure master above the flow loop — K17. */
const cascaded: HmiScreen = {
  ...plant,
  widgets: [
    ...plant.widgets,
    { id: 'pt', type: 'display', x: 900, y: 160, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 220, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' }

/** Nothing is stated unless a test asks. Absent is never zero here. */
const reg = (opts: {
  spLow?: string
  spHigh?: string
  setpoint?: string
  minFlow?: string
  cascade?: boolean
  masterSpLow?: string
} = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty, ...(opts.minFlow !== undefined ? { 'duty.minFlow': opts.minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(opts.spLow !== undefined || opts.spHigh !== undefined || opts.setpoint !== undefined
    ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: {
        ...(opts.spLow !== undefined ? { 'signal.spLow': opts.spLow } : {}),
        ...(opts.spHigh !== undefined ? { 'signal.spHigh': opts.spHigh } : {}),
        ...(opts.setpoint !== undefined ? { 'signal.setpoint': opts.setpoint } : {}) } } }
    : {}),
  ...(opts.cascade || opts.masterSpLow !== undefined
    ? { 'PIC-1': { key: 'PIC-1', kind: 'instrument' as const, fields: {
        ...(opts.cascade ? { 'signal.cascadeTo': 'FIC-1' } : {}),
        ...(opts.masterSpLow !== undefined ? { 'signal.spLow': opts.masterSpLow } : {}) } } }
    : {}),
})

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const fic = () => sim().tags['FIC-1']!
const loop = (tag = 'FIC-1') => sim().loops[tag]!
const spec = (tag = 'FIC-1', r: Registry = reg(), screen: HmiScreen = plant) =>
  buildSimModel(screen, r).controllers.find((c) => c.tag === tag)!
const lineUp = (sp?: number, tag = 'FIC-1') => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag(tag, 'SP', sp)
}
/** The setpoint the ALGORITHM was given, after the engineering limits. */
const limited = () => loop().spLimit?.limited ?? fic().SP

beforeEach(() => { start() })

// ── The three ranges, kept apart ────────────────────────────────────────────

describe('§2 — a calibrated range, an operating limit and a starting value', () => {
  it('the calibrated range is a CAPABILITY and constrains nothing in the engine', () => {
    /**
     * K22's behaviour, deliberately preserved. This loop's transmitter is
     * ranged 0-60 and states NO operating limit, so a setpoint of 200 is
     * honoured and the loop tells the operator it cannot get there.
     */
    start(reg())
    lineUp(200); advance(300)
    expect(sim().defs['FIC-1']!.max).toBe(60)   // the calibrated range
    expect(sim().defs['FIC-1']!.spHigh).toBeUndefined()
    expect(fic().SP).toBe(200)                  // honoured, not rewritten
    expect(loop().saturated).toBe(1)            // ...and reported unreachable
    expect(loop().spLimit).toBeUndefined()      // nothing published
  })

  it('an operating limit is an AUTHORITY statement and is NOT the range', () => {
    const e = engineeringFor(reg({ spLow: '10', spHigh: '45' }), 'FIC-1')
    expect(e.spLow).toBe(10)
    expect(e.spHigh).toBe(45)
    // ...and it did not touch the calibrated range, which this record omits
    expect(e.min).toBeUndefined()
    expect(e.max).toBeUndefined()
    // the compiled tag keeps the two apart
    start(reg({ spLow: '10', spHigh: '45' }))
    expect(sim().defs['FIC-1']!.min).toBe(0)    // from the widget: capability
    expect(sim().defs['FIC-1']!.max).toBe(60)
    expect(sim().defs['FIC-1']!.spLow).toBe(10) // from the record: authority
    expect(sim().defs['FIC-1']!.spHigh).toBe(45)
  })

  it('K: `signal.setpoint` remains a STARTING VALUE and is not a limit', () => {
    start(reg({ setpoint: '30' }))
    sim().tickOnce(1)
    expect(fic().SP).toBe(30)
    expect(loop().spLimit).toBeUndefined()      // it configured no limits
    // ...and it can still be moved anywhere afterwards
    sim().writeTag('FIC-1', 'SP', 55); advance(5)
    expect(fic().SP).toBe(55)
  })

  it('K, §9: a starting value OUTSIDE the limits starts there and is then held', () => {
    /**
     * The starting value is not normalised — the record states where the loop
     * starts and that is what `SP` reads. What the ALGORITHM is given is the
     * limited value, from the very first tick, and both are visible. Silently
     * rewriting the record's own number would hide a configuration mistake.
     */
    start(reg({ setpoint: '55', spHigh: '45' }))
    sim().tickOnce(1)
    expect(fic().SP).toBe(55)                   // the record's own value
    expect(loop().spLimit!.limiting).toBe(true)
    expect(limited()).toBe(45)                  // ...and the loop controls to 45
  })
})

// ── A, B, C, D, E, F, G, H. The limits themselves ───────────────────────────

describe('A-H — one side, the other, both, and the exact boundaries', () => {
  it('A, Q: with neither stated there is NO limit and nothing is published', () => {
    const c = spec('FIC-1', reg())
    expect(c.spLow).toBeUndefined()
    expect(c.spHigh).toBeUndefined()
    start(reg())
    lineUp(30); advance(50)
    expect(loop().spLimit).toBeUndefined()
  })

  it('B: a LOW limit alone binds below and leaves the top open', () => {
    start(reg({ spLow: '15' }))
    lineUp(5); advance(5)
    expect(fic().SP).toBe(5)                    // the entry survives
    expect(limited()).toBe(15)
    expect(loop().spLimit!.high).toBeUndefined()
    sim().writeTag('FIC-1', 'SP', 300); advance(5)
    expect(limited()).toBe(300)                 // nothing caps it
  })

  it('C: a HIGH limit alone binds above and leaves the bottom open', () => {
    start(reg({ spHigh: '45' }))
    lineUp(55); advance(5)
    expect(limited()).toBe(45)
    expect(loop().spLimit!.low).toBeUndefined()
    sim().writeTag('FIC-1', 'SP', -20); advance(5)
    expect(limited()).toBe(-20)                 // nothing floors it
  })

  it('D: both stated give a band, and inside it nothing happens', () => {
    start(reg({ spLow: '10', spHigh: '45' }))
    lineUp(30); advance(5)
    expect(limited()).toBe(30)
    expect(loop().spLimit!.limiting).toBe(false)
  })

  it('E, F: the boundaries themselves are INSIDE the band', () => {
    start(reg({ spLow: '10', spHigh: '45' }))
    lineUp(10); advance(5)
    expect(limited()).toBe(10)
    expect(loop().spLimit!.limiting).toBe(false)
    sim().writeTag('FIC-1', 'SP', 45); advance(5)
    expect(limited()).toBe(45)
    expect(loop().spLimit!.limiting).toBe(false)
  })

  it('G, H: and a hair outside either one is held, with both numbers published', () => {
    start(reg({ spLow: '10', spHigh: '45' }))
    lineUp(9.9); advance(5)
    expect(loop().spLimit).toMatchObject({ requested: 9.9, limited: 10, limiting: true })
    sim().writeTag('FIC-1', 'SP', 45.1); advance(5)
    expect(loop().spLimit).toMatchObject({ requested: 45.1, limited: 45, limiting: true })
  })

  it('the plant actually controls to the LIMITED value, not the requested one', () => {
    start(reg({ spHigh: '25' }))
    lineUp(50); advance(500)
    expect(fic().SP).toBe(50)
    expect(Math.abs(sim().tags['FT-1']!.PV! - 25)).toBeLessThan(1.5)
  })
})

// ── I, J. Every path meets the same limit ───────────────────────────────────

describe('I, J — operator, scenario and direct write reach one constraint', () => {
  it('I: the operator path', () => {
    start(reg({ spHigh: '40' }))
    lineUp(58); advance(5)
    expect(limited()).toBe(40)
  })

  it('J: the SCENARIO path — which K22 found bypassed everything', () => {
    start(reg({ spHigh: '40' }))
    lineUp(20); advance(20)
    sim().applyScenario({
      id: 's', name: 'push the loop', overrides: [
        { kind: 'signal', tag: 'FIC-1', signal: 'SP', value: 58 },
      ],
    } satisfies Scenario)
    advance(5)
    expect(fic().SP).toBe(58)                   // the scenario said what it meant
    expect(limited()).toBe(40)                  // ...and the engineering limit held
    expect(loop().spLimit!.limiting).toBe(true)
  })

  it('J: and a DIRECT write is bounded identically — one constraint, one place', () => {
    start(reg({ spLow: '15', spHigh: '40' }))
    lineUp(); advance(5)
    for (const [asked, held] of [[58, 40], [2, 15], [30, 30]] as const) {
      sim().writeTag('FIC-1', 'SP', asked); advance(2)
      expect(limited()).toBe(held)
      expect(fic().SP).toBe(asked)              // never rewritten, on any path
    }
  })
})

// ── L, M, N. Cascade ────────────────────────────────────────────────────────

describe('L, M, N — a master’s output limit is not a slave’s setpoint limit', () => {
  it('L, M: a master drives its slave, and the SLAVE’s limits bound the result', () => {
    start(reg({ cascade: true, spHigh: '30' }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 9); advance(300)   // master asks for everything
    expect(sim().loops['PIC-1']!.cascadeTo).toBe('FIC-1')
    // the master's map can reach 60 — the slave's calibrated range — and the
    // slave's OPERATING limit stops it at 30
    expect(sim().tags['FIC-1']!.SP!).toBeGreaterThan(30)
    expect(limited()).toBe(30)
    expect(loop('FIC-1').spLimit!.limiting).toBe(true)
  })

  it('N: the MASTER’s own limits bound what the master may be asked for', () => {
    start(reg({ cascade: true, masterSpLow: '3' }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 1); advance(50)
    expect(sim().tags['PIC-1']!.SP).toBe(1)          // the entry survives
    expect(sim().loops['PIC-1']!.spLimit).toMatchObject({ low: 3, limited: 3, limiting: true })
    // ...and the SLAVE carries none, because its record states none
    expect(loop('FIC-1').spLimit).toBeUndefined()
  })

  /**
   * K24 CORRECTED THIS TEST, by closing the gap it was written to document.
   *
   *   OLD expectation: the master ran to its OWN output ceiling and reported
   *        `SAT +1`, having wound across the whole unusable half of its range
   *        against a setpoint the slave never accepted. K23 measured that,
   *        pinned it here as a baseline, and left it — §18 of the K23 brief
   *        listed "requires new anti-windup" as a hard stop.
   *   NEW expectation: the master is held at the slave's `spHigh` projected
   *        onto its own output scale, and reports `downstreamLimited` with
   *        `SAT` at 0.
   *   REASON: K24's investigation showed no new anti-windup was needed. K18
   *        had already built this exact projection for `duty.minFlow`, and the
   *        measurement proved the two cases were the same fact treated
   *        differently only because one predated the mechanism — a slave
   *        floored at 30 by `minFlow` left the master at OP 49, and the same
   *        slave floored at 30 by `spLow` ran it to OP 0.
   *   AND `SAT` IS THE POINT: the master has half its travel left. Reporting
   *        saturation would tell an operator it has run out of RANGE when it
   *        has run out of SLAVE.
   */
  it('L: the master is held by its SLAVE’s limit, and is not saturated', () => {
    start(reg({ cascade: true, spHigh: '30' }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 9); advance(100)
    // the slave's 30 of its 0-60 range is 50 % on the master's output scale
    expect(spec('PIC-1', reg({ cascade: true, spHigh: '30' }), cascaded).dsCeilPct)
      .toBeCloseTo(50, 9)
    const settled = sim().tags['PIC-1']!.I
    expect(sim().loops['PIC-1']!.downstreamLimited).toBe(true)
    expect(sim().loops['PIC-1']!.saturated).toBe(0)   // NOT its own travel
    advance(300)
    expect(sim().tags['PIC-1']!.I).toBe(settled)      // and it stopped there
    expect(limited()).toBe(30)
    // the master's output rests around the projection rather than at 100
    expect(sim().tags['PIC-1']!.OP!).toBeLessThan(60)
  })

  it('N: and the master’s OUTPUT limit is a different constraint entirely', () => {
    const master = spec('PIC-1', reg({ cascade: true, masterSpLow: '3' }), cascaded)
    expect(master.spLow).toBe(3)                     // what it may be ASKED for
    expect(master.outMin ?? 0).toBe(0)               // what it may OUTPUT
    expect(master.outMax ?? 100).toBe(100)
  })
})

// ── O, P. Minimum flow ──────────────────────────────────────────────────────

describe('O, P — the protection, the limits, and the contradiction', () => {
  it('O: a minimum flow ABOVE the low limit simply wins, as K18 always did', () => {
    start(reg({ minFlow: '20 m³/h', spLow: '5' }))
    lineUp(8); advance(400)
    // the SP limit raised nothing (8 > 5), and the protection then raised it
    expect(loop().spLimit!.limiting).toBe(false)
    expect(sim().minFlow['FIC-1']!.requestedSp).toBe(8)
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(20)
    expect(sim().minFlow['FIC-1']!.overriding).toBe(true)
  })

  it('O: and where the LOW LIMIT is higher, it is the one that binds', () => {
    start(reg({ minFlow: '20 m³/h', spLow: '30' }))
    lineUp(8); advance(400)
    expect(limited()).toBe(30)                       // the SP limit acted first
    // ...and the protection had nothing left to do: 30 already exceeds 20
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(30)
    expect(sim().minFlow['FIC-1']!.overriding).toBe(false)
  })

  it('P, §8: a minimum ABOVE the high limit is a CONTRADICTION, and is refused', () => {
    /**
     * Neither wins, because neither should. Letting the protection through
     * would make a configured maximum not a maximum; capping the protection
     * would silently weaken a machine-protection function to satisfy an
     * operating limit. The record is asking for two incompatible things and
     * the honest answer is to say so — exactly what K18 already does with a
     * minimum stated in units it cannot convert.
     */
    const c = spec('FIC-1', reg({ minFlow: '30 m³/h', spHigh: '25' }))
    expect(c.minFlow).toBeUndefined()                // not in service
    expect(c.minFlowProblem).toContain('minimum flow of 30')
    expect(c.minFlowProblem).toContain('setpoint maximum of 25')

    start(reg({ minFlow: '30 m³/h', spHigh: '25' }))
    lineUp(10); advance(200)
    // NOTHING is assumed in its place, and the state says NOT_CONFIGURED
    expect(sim().minFlow['FIC-1']!.state).toBe('NOT_CONFIGURED')
    expect(sim().minFlow['FIC-1']!.limitM3h).toBeUndefined()
    expect(limited()).toBe(10)                       // the loop runs where it was put
    // ...and K13 goes on describing the MACHINE regardless: the record is not
    // wrong about the pump, it is wrong about this pair
    expect(sim().pumpEnvelopes['P-1']!.minFlowM3h).toBe(30)
    expect(sim().pumpEnvelopes['P-1']!.state).toBe('BELOW MINIMUM FLOW')
  })

  it('P: a minimum EQUAL to the high limit is not a contradiction', () => {
    const c = spec('FIC-1', reg({ minFlow: '25 m³/h', spHigh: '25' }))
    expect(c.minFlow).toBe(25)
    expect(c.minFlowProblem).toBeUndefined()
  })

  it('P: and the effective setpoint can therefore never exceed the high limit', () => {
    start(reg({ minFlow: '25 m³/h', spHigh: '25' }))
    lineUp(5); advance(200)
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(25)
    expect(sim().minFlow['FIC-1']!.effectiveSp!).toBeLessThanOrEqual(25)
  })
})

// ── Q, R, S. Absent, units, invalid ─────────────────────────────────────────

describe('Q, R, S — absent is not zero, and a pair that crosses is not a range', () => {
  it('Q: absent on either side is NOT zero and NOT the calibrated end', () => {
    const e = engineeringFor(reg({ spLow: '10' }), 'FIC-1')
    expect(e.spLow).toBe(10)
    expect(e.spHigh).toBeUndefined()             // not 60, not 100, not 0
    const f = engineeringFor(reg({ spHigh: '45' }), 'FIC-1')
    expect(f.spLow).toBeUndefined()              // not 0
    expect(f.spHigh).toBe(45)
  })

  it('Q: a stated ZERO is a real limit, because zero flow is a real setpoint', () => {
    // the contrast with an absent limit, and the reason `absent ≠ zero` matters
    const e = engineeringFor(reg({ spLow: '0' }), 'FIC-1')
    expect(e.spLow).toBe(0)
    const c = spec('FIC-1', reg({ spLow: '0' }))
    expect(c.spLow).toBe(0)
    start(reg({ spLow: '0' }))
    lineUp(-5); advance(5)
    expect(limited()).toBe(0)                    // it binds
  })

  it('R: the limits are in the TAG’s own unit, like every setpoint in this product', () => {
    // bare numbers, exactly as `signal.setpoint` and `alarm.LL` are, because
    // the tag declares its unit once
    const e = engineeringFor(reg({ spLow: '10', spHigh: '45' }), 'FIC-1')
    expect(e.spLow).toBe(10)
    expect(e.spHigh).toBe(45)
    start(reg({ spLow: '10', spHigh: '45' }))
    lineUp(30); advance(5)
    expect(sim().defs['FIC-1']!.unit).toBe('m³/h')
  })

  it('S: a low ABOVE its own high describes no band, so neither is carried', () => {
    const c = spec('FIC-1', reg({ spLow: '45', spHigh: '10' }))
    expect(c.spLow).toBeUndefined()
    expect(c.spHigh).toBeUndefined()
    start(reg({ spLow: '45', spHigh: '10' }))
    lineUp(30); advance(5)
    expect(loop().spLimit).toBeUndefined()       // the loop runs unlimited
    expect(limited()).toBe(30)
  })

  it('S: an unreadable value is not a limit either', () => {
    const e = engineeringFor(
      { 'FIC-1': { key: 'FIC-1', kind: 'instrument', fields: { 'signal.spLow': 'low' } } },
      'FIC-1')
    expect(e.spLow).toBeUndefined()
  })
})

// ── T. Determinism ──────────────────────────────────────────────────────────

describe('T — the same inputs give the same setpoints', () => {
  it('T: deterministic through every path and every limit', () => {
    const run = () => {
      start(reg({ spLow: '10', spHigh: '45', minFlow: '20 m³/h' }))
      lineUp(12)
      const trace: string[] = []
      for (let i = 0; i < 200; i++) {
        advance(1)
        if (i === 60) sim().writeTag('FIC-1', 'SP', 5)
        if (i === 120) sim().writeTag('FIC-1', 'SP', 58)
        trace.push([fic().SP, loop().spLimit?.limited, sim().minFlow['FIC-1']?.effectiveSp,
          fic().OP].map((x) => (typeof x === 'number' ? x.toFixed(9) : String(x))).join(','))
      }
      return trace
    }
    const a = run()
    expect(run()).toEqual(a)
    expect(new Set(a).size).toBeGreaterThan(10)
  })

  it('§12: no setpoint RATE limiting was introduced — a change arrives whole', () => {
    start(reg({ spLow: '10', spHigh: '45' }))
    lineUp(12); advance(100)
    sim().writeTag('FIC-1', 'SP', 44)
    sim().tickOnce(1)
    expect(limited()).toBe(44)                   // one tick, whole step
  })
})

// ── U-Z. Every phase before K23 ─────────────────────────────────────────────

describe('U-Z — K14 through K22, unchanged with no limits configured', () => {
  it('U, V: K14/K15 loops settle where they always did', () => {
    start(reg())
    lineUp(25); advance(500)
    expect(Math.abs(sim().tags['FT-1']!.PV! - 25)).toBeLessThan(0.7)
  })

  it('W: K17 cascade, and its map is untouched', () => {
    start(reg({ cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 4); advance(300)
    expect(sim().loops['PIC-1']!.cascadeTo).toBe('FIC-1')
    expect(sim().loops['FIC-1']!.cascadeFrom).toBe('PIC-1')
    expect(sim().loops['FIC-1']!.spLimit).toBeUndefined()
  })

  it('X: K18/K19 minimum flow, byte-for-byte, with no SP limits stated', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(400)
    const p = sim().minFlow['FIC-1']!
    expect(p.requestedSp).toBe(12)
    expect(p.effectiveSp).toBe(20)
    expect(p.overriding).toBe(true)
    expect(p.inForce).toBe(true)
    expect(fic().SP).toBe(12)
    expect(loop().spLimit).toBeUndefined()
  })

  it('Y: K21 output rate limiting is a different layer and still works', () => {
    const r = {
      ...reg({ spHigh: '45' }),
      'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: {
        'signal.spHigh': '45', 'signal.outputRateLimit': '10 %/s' } },
    }
    start(r)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 40); advance(60)
    sim().writeTag('FIC-1', 'OP', 90)
    sim().tickOnce(1)
    expect(fic().OPC).toBeCloseTo(50, 6)         // the OUTPUT limit, unchanged
    expect(loop().spLimit!.high).toBe(45)        // ...beside the SETPOINT limit
  })

  it('Z: K22’s constraint inventory still holds, and SAT still means travel', () => {
    start(reg())
    lineUp(200); advance(300)
    // the K22 case, preserved exactly: no SP limit configured, so no clamp
    expect(fic().SP).toBe(200)
    expect(loop().saturated).toBe(1)
    expect(loop().spLimit).toBeUndefined()
  })
})
