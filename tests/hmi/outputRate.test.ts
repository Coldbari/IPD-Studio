// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K21 — CONTROLLER OUTPUT RATE LIMITING.
 *
 * ── FOUR VALUES THAT WERE THREE, AND MUST NOT BE ONE ──────────────────────
 *
 *     requested OP   what the algorithm — or the operator's hand — asked for
 *     commanded OP   what the rate limit allowed, and the element was told
 *     SPD            the speed command the drive received
 *     actual         how far the shaft has physically got
 *
 * Before K21 the first two were the same variable. `OP` is now the REQUEST and
 * `OPC` the COMMAND, and `OPC` is written only where a limit is configured, so
 * a plant whose records state none behaves byte-for-byte as it did through
 * K14-K20.
 *
 * ── A CONTROL CONSTRAINT, NOT AN ACTUATOR ONE ─────────────────────────────
 *
 * K12's drive already takes `RAMP_S` to move the shaft and a valve already
 * strokes at `STROKE_RATE`. Those are what the HARDWARE does with a command.
 * This is how fast the COMMAND itself may change, both apply at once, and
 * §S/§T below measure them as two distinct lags in series. Nothing in K21
 * derives one from the other — §3 forbids it precisely because they are so
 * easy to confuse.
 *
 * ── AND NO NEW ANTI-WINDUP ────────────────────────────────────────────────
 *
 * The existing conditional integration already asks "is the output against a
 * stop the error is pushing it further into?", and K18 already established
 * that the answer is to change WHICH stop. K21 does the same a third time: the
 * stops become the rate window intersected with the configured travel. `kp`,
 * `ti` and `ki` are untouched, and §AJ pins that.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { engineeringFor } from '../../src/model/signalData'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The fixture: K15's plant, which every phase since has been measured on ──

const plant: HmiScreen = {
  id: 'k21', name: 'K21', theme: 'classic',
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

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }

/**
 * `rate: undefined` is NOT `rate: 0`, and most of this file depends on it. The
 * record simply does not mention an output rate limit unless a test asks.
 */
const reg = (opts: {
  rate?: string
  masterRate?: string
  minFlow?: string
  cascade?: boolean
} = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %',
    ...(opts.minFlow !== undefined ? { 'duty.minFlow': opts.minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(opts.rate !== undefined
    ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: { 'signal.outputRateLimit': opts.rate } } }
    : {}),
  ...(opts.cascade || opts.masterRate !== undefined
    ? { 'PIC-1': { key: 'PIC-1', kind: 'instrument' as const, fields: {
        ...(opts.cascade ? { 'signal.cascadeTo': 'FIC-1' } : {}),
        ...(opts.masterRate !== undefined ? { 'signal.outputRateLimit': opts.masterRate } : {}) } } }
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
const pump = () => sim().tags['P-1']!
const loop = (tag = 'FIC-1') => sim().loops[tag]!
const lineUp = (sp?: number, tag = 'FIC-1') => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag(tag, 'SP', sp)
}
/** The command the element was actually given, %. */
const commanded = () => fic().OPC ?? fic().OP
/** The shaft, as a percentage — K12's own number, never the command. */
const shaftPct = () => (pump().RAMP ?? 0) * 100

/**
 * Settle an AUTO loop, then step its setpoint hard.
 *
 * A SPEED LOOP DOES NOT START FROM ZERO. K15's calm start seeds `OP` and `I`
 * at the speed the machine is already at — 100 % for a VSD, because that is
 * where the curve's duty point is defined — so a freshly started loop asking
 * for 100 % is asking for exactly what it already commands and there is
 * nothing for a rate limit to catch. §AA pins that as the correct startup
 * behaviour. To see the limiter bind in AUTO the loop must first be settled
 * somewhere and then asked to move.
 */
const settleThenStep = (from: number, to: number) => {
  lineUp(from); advance(400)
  sim().writeTag('FIC-1', 'SP', to)
}

beforeEach(() => { start() })

// ── A, B, C, AK. The engineering source ─────────────────────────────────────

describe('A, B, C, AK — the record states it, or nothing does', () => {
  const rateOf = (v: string): number | undefined => engineeringFor(
    { 'FIC-1': { key: 'FIC-1', kind: 'instrument', fields: { 'signal.outputRateLimit': v } } },
    'FIC-1').outputRateLimitPctPerS

  it('C: the unit is explicit, and every spelling of one rate agrees', () => {
    // 10 %/s, said four ways
    expect(rateOf('10 %/s')).toBe(10)
    expect(rateOf('10 % / s')).toBe(10)
    expect(rateOf('600 %/min')).toBe(10)
    expect(rateOf('36000 %/h')).toBe(10)
    // ...and a bare number is %/s, the output's own unit, by declared rule
    expect(rateOf('10')).toBe(10)
    expect(rateOf('2.5 %/s')).toBe(2.5)
  })

  it('C: a rate of something that is NOT the output is refused, not converted', () => {
    // there is no conversion between a flow and an output position
    expect(rateOf('2 m3/h/s')).toBeUndefined()
    expect(rateOf('10 %/fortnight')).toBeUndefined()
    expect(rateOf('fast')).toBeUndefined()
  })

  it('AK: zero and negative are NOT rate limits, and neither is invented away', () => {
    // a zero rate would freeze the output for ever, which is a trip
    expect(rateOf('0 %/s')).toBeUndefined()
    expect(rateOf('-5 %/s')).toBeUndefined()
  })

  it('A, AK: with nothing stated there is NO limit and no default', () => {
    const c = buildSimModel(plant, reg()).controllers.find((x) => x.tag === 'FIC-1')!
    expect(c.outputRatePctPerS).toBeUndefined()
    expect(sim().defs['FIC-1']!.outputRateLimitPctPerS).toBeUndefined()
    lineUp(30); advance(50)
    // no second signal on the tag, and nothing published on the loop
    expect(fic().OPC).toBeUndefined()
    expect(loop().outputRatePctPerS).toBeUndefined()
    expect(loop().rateLimited).toBeUndefined()
    expect(loop().requestedOp).toBeUndefined()
  })

  it('B: a stated limit is wired onto that controller, in %/s', () => {
    start(reg({ rate: '5 %/s' }))
    const c = buildSimModel(plant, reg({ rate: '5 %/s' })).controllers.find((x) => x.tag === 'FIC-1')!
    expect(c.outputRatePctPerS).toBe(5)
    lineUp(30); advance(5)
    expect(loop().outputRatePctPerS).toBe(5)
  })

  it('AK: nothing is derived from the drive ramp, the stroke rate or the tuning', () => {
    // K12's RAMP_S is 2 s and STROKE_RATE is 25 %/s. Neither becomes a limit.
    start(reg())
    lineUp(30); advance(50)
    expect(loop().outputRatePctPerS).toBeUndefined()
    expect(sim().defs['FIC-1']!.outputRateLimitPctPerS).toBeUndefined()
  })
})

// ── D, E, F, G, H, I, J. The equation ───────────────────────────────────────

describe('D-J — the rate limiter itself, one timestep at a time', () => {
  /** MANUAL is the cleanest bench for the equation: the request is whatever we
   *  type, so `commanded` is a pure function of the limit and the timestep. */
  const bench = (rate: string, from: number, to: number) => {
    start(reg({ rate }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', from)
    advance(60)                                   // settle the command at `from`
    expect(commanded()).toBeCloseTo(from, 6)
    sim().writeTag('FIC-1', 'OP', to)
  }

  it('D: a step UP moves by exactly rate × dt per tick', () => {
    bench('10 %/s', 40, 90)
    sim().tickOnce(1); expect(commanded()).toBeCloseTo(50, 6)
    sim().tickOnce(1); expect(commanded()).toBeCloseTo(60, 6)
    sim().tickOnce(1); expect(commanded()).toBeCloseTo(70, 6)
  })

  it('E: a step DOWN is limited identically, and symmetrically', () => {
    bench('10 %/s', 90, 40)
    sim().tickOnce(1); expect(commanded()).toBeCloseTo(80, 6)
    sim().tickOnce(1); expect(commanded()).toBeCloseTo(70, 6)
  })

  it('F: a move EXACTLY at the limit passes through unrestricted', () => {
    bench('10 %/s', 40, 50)
    sim().tickOnce(1)
    expect(commanded()).toBeCloseTo(50, 6)
    expect(loop().rateLimited).toBe(false)      // it was allowed in full
  })

  it('F: and one hair beyond it is held to the limit', () => {
    bench('10 %/s', 40, 50.5)
    sim().tickOnce(1)
    expect(commanded()).toBeCloseTo(50, 6)
    expect(loop().rateLimited).toBe(true)
  })

  it('G: the delta scales with the SIMULATION timestep, not a clock', () => {
    bench('10 %/s', 40, 90)
    sim().tickOnce(0.5); expect(commanded()).toBeCloseTo(45, 6)
    sim().tickOnce(2); expect(commanded()).toBeCloseTo(65, 6)
    sim().tickOnce(0.25); expect(commanded()).toBeCloseTo(67.5, 6)
  })

  it('H: and it accumulates across many timesteps until the request is met', () => {
    bench('10 %/s', 40, 90)
    advance(5)
    expect(commanded()).toBeCloseTo(90, 6)
    advance(10)
    expect(commanded()).toBeCloseTo(90, 6)      // and then stays there
    expect(loop().rateLimited).toBe(false)
  })

  it('I, J: the REQUEST is untouched throughout — only the command is limited', () => {
    bench('10 %/s', 40, 90)
    for (let i = 0; i < 3; i++) {
      sim().tickOnce(1)
      expect(fic().OP).toBe(90)                 // the operator's entry survives
      expect(loop().requestedOp).toBe(90)
    }
    expect(commanded()).toBeCloseTo(70, 6)
    expect(loop().requested).toBeCloseTo(70, 6)
  })

  it('L: the configured output travel still bounds the command', () => {
    // the drive's 20 % turndown is the loop's `outMin`, and a rate limit does
    // not let an output walk below a stop it was never allowed past
    start(reg({ rate: '50 %/s' }))
    lineUp(0.5); advance(200)
    expect(commanded()!).toBeGreaterThanOrEqual(20 - 1e-9)
    expect(pump().SPD!).toBeGreaterThanOrEqual(20 - 1e-9)
  })
})

// ── K, M, N, O, P, Q. Three distinct states ─────────────────────────────────

describe('K-Q — rate-limited, saturated and unauthorised are three things', () => {
  it('K: the actuator stays independently observable behind the command', () => {
    start(reg({ rate: '4 %/s' }))
    settleThenStep(20, 55)
    sim().tickOnce(1)
    const r = loop().requestedOp!
    const cmd = loop().requested!
    const act = loop().actual!
    // three DIFFERENT numbers: the algorithm asked, the limiter allowed, the
    // shaft has got this far
    expect(r).toBeGreaterThan(cmd)
    expect(act).toBeCloseTo(shaftPct(), 6)
    expect(act).not.toBe(r)
  })

  it('N: RATE LIMITED without SATURATED — plenty of machine, just not yet', () => {
    start(reg({ rate: '3 %/s' }))
    settleThenStep(20, 50)
    sim().tickOnce(1)
    expect(loop().rateLimited).toBe(true)
    expect(loop().saturated).toBe(0)            // nowhere near a travel stop
    expect(fic().SAT).toBe(0)
  })

  it('M, N: SATURATED without RATE LIMITED — at the stop, and allowed to be', () => {
    // ask for more than the plant can make, with a rate generous enough that
    // the output reaches its ceiling and rests there
    start(reg({ rate: '50 %/s' }))
    lineUp(58); advance(300)
    expect(loop().saturated).toBe(1)
    expect(loop().rateLimited).toBe(false)
    expect(fic().SAT).toBe(1)
  })

  it('O, P: NO AUTHORITY is neither, and K16\'s HOLD is unchanged', () => {
    start(reg({ rate: '5 %/s' }))
    lineUp(45); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(5)
    expect(loop().authority).toBe('de-energised')
    // a loop with no authority is not saturated and is not rate limited
    expect(loop().saturated).toBe(0)
    expect(loop().rateLimited).toBe(false)
    // ...and the OUTPUT and the INTEGRATOR are held exactly where they were
    const held = { OP: fic().OP, OPC: fic().OPC, I: fic().I, SPD: pump().SPD }
    advance(60)
    expect({ OP: fic().OP, OPC: fic().OPC, I: fic().I, SPD: pump().SPD }).toEqual(held)
  })

  it('Q: and authority restored resumes from the held command, no jump', () => {
    start(reg({ rate: '5 %/s' }))
    lineUp(45); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    const heldCmd = commanded()!
    sim().writeTag('P-1', 'RUN', 1)
    sim().tickOnce(1)
    // the first tick back may move by at most one rate-limited step
    expect(Math.abs(commanded()! - heldCmd)).toBeLessThanOrEqual(5 + 1e-9)
    advance(300)
    expect(loop().authority).toBe('available')
  })

  it('a rate-limited loop still HAS authority — they are never conflated', () => {
    start(reg({ rate: '2 %/s' }))
    settleThenStep(20, 50)
    sim().tickOnce(1)
    expect(loop().rateLimited).toBe(true)
    expect(loop().authority).toBe('available')
  })
})

// ── R. MANUAL ───────────────────────────────────────────────────────────────

describe('R — MANUAL, per the semantics the output path already established', () => {
  /**
   * §8 was answered from the existing architecture rather than by preference.
   * `lo` and `hi` — this controller's OTHER configured output constraints —
   * have always clamped a hand command, so a constraint on the output path
   * binds in MANUAL. The minimum-flow override does not, because it acts on
   * the SETPOINT and MANUAL does not use one. Two different answers, each from
   * what the constraint acts upon.
   */
  it('R: a hand command is rate-limited, and the slider keeps its own value', () => {
    start(reg({ rate: '10 %/s' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 30); advance(60)
    sim().writeTag('FIC-1', 'OP', 80)
    sim().tickOnce(1)
    expect(fic().OP).toBe(80)                   // the operator's entry survives
    expect(commanded()).toBeCloseTo(40, 6)      // ...and the drive was told 40
    expect(pump().SPD).toBeCloseTo(40, 6)
    expect(loop().rateLimited).toBe(true)
  })

  it('R: with NO limit configured a hand command reaches the drive at once', () => {
    start(reg())
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 30); advance(20)
    sim().writeTag('FIC-1', 'OP', 80)
    sim().tickOnce(1)
    expect(pump().SPD).toBe(80)                 // K14/K15 behaviour, untouched
  })

  it('R: the return to AUTO is bumpless against the COMMANDED output', () => {
    start(reg({ rate: '10 %/s' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 30); advance(200)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 80)
    advance(2)                                  // mid-way through a limited move
    const before = commanded()!
    sim().writeTag('FIC-1', 'MODE', 1)
    sim().tickOnce(1)
    // no kick: AUTO resumes from where the plant actually is
    expect(Math.abs(commanded()! - before)).toBeLessThanOrEqual(10 + 1e-9)
  })
})

// ── S, T. The physical ramp is still the physical ramp ──────────────────────

describe('S, T — two lags in series, and neither replaced the other', () => {
  it('S: K12\'s drive ramp is untouched with no rate limit configured', () => {
    start(reg())
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    // the COMMAND arrives whole and instantly...
    expect(pump().SPD).toBe(100)
    // ...and the SHAFT still lags behind it, exactly as K12 made it
    expect(shaftPct()).toBeLessThan(100)
    expect(shaftPct()).toBeGreaterThan(0)
  })

  /**
   * BOTH MECHANISMS EXIST AND ARE INDEPENDENT, and which one you SEE binding
   * depends on the numbers. K12's drive covers its full travel in `RAMP_S`
   * = 2 s, so it moves 50 points of speed per second.
   *
   *   a limit TIGHTER than that  — the control layer binds, the drive keeps up
   *   a limit LOOSER than that   — the drive binds, exactly as before K21
   *
   * That is the honest statement of §11: K21 added a layer, it did not replace
   * one, and neither was derived from the other.
   */
  const handStep = (rate: string | undefined, from: number, to: number) => {
    start(rate === undefined ? reg() : reg({ rate }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', from); advance(60)
    sim().writeTag('FIC-1', 'OP', to)
    sim().tickOnce(1)
  }

  it('T: a limit TIGHTER than the drive — the control layer is what binds', () => {
    handStep('10 %/s', 30, 100)
    expect(fic().OP).toBe(100)                  // the request
    expect(commanded()).toBeCloseTo(40, 6)      // the control layer held it
    // the drive could have moved 50 points this tick and only needed 10, so it
    // arrives — the CONTROL limit is the binding constraint, not the hardware
    expect(shaftPct()).toBeCloseTo(40, 6)
  })

  it('T: a limit LOOSER than the drive — the physical ramp is what binds', () => {
    handStep('90 %/s', 20, 100)
    expect(commanded()).toBeCloseTo(100, 6)     // the control layer allowed it all
    expect(shaftPct()).toBeLessThan(100)        // ...and the shaft still lags
    expect(shaftPct()).toBeCloseTo(70, 6)       // 20 + 50 points of travel
  })

  it('T: and with NO limit the drive behaves exactly as it did before K21', () => {
    handStep(undefined, 20, 100)
    expect(pump().SPD).toBe(100)
    expect(shaftPct()).toBeCloseTo(70, 6)       // the same 50 points
  })
})

// ── U, V. Cascade ───────────────────────────────────────────────────────────

describe('U, V — each controller\'s limit applies to its own output', () => {
  it('U: a limit on the SLAVE limits the speed command, not the master\'s setpoint', () => {
    start(reg({ rate: '4 %/s', cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 4); advance(200)
    expect(sim().loops['PIC-1']!.cascadeTo).toBe('FIC-1')
    // the SLAVE carries the limit
    expect(loop('FIC-1').outputRatePctPerS).toBe(4)
    // ...and the MASTER carries none, because its record states none
    expect(loop('PIC-1').outputRatePctPerS).toBeUndefined()
    expect(sim().tags['PIC-1']!.OPC).toBeUndefined()
  })

  it('U: a limit on the MASTER limits the master\'s own output — the slave\'s SP', () => {
    start(reg({ masterRate: '2 %/s', cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 2); advance(100)
    expect(loop('PIC-1').outputRatePctPerS).toBe(2)
    expect(loop('FIC-1').outputRatePctPerS).toBeUndefined()
    // the master's output is a per cent; the slave's SP is engineering units
    expect(sim().tags['PIC-1']!.OPC).toBeDefined()
    expect(sim().tags['FIC-1']!.OPC).toBeUndefined()
  })

  it('U: two records state two limits, and they are independent', () => {
    start(reg({ rate: '4 %/s', masterRate: '2 %/s', cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 4); advance(100)
    expect(loop('PIC-1').outputRatePctPerS).toBe(2)
    expect(loop('FIC-1').outputRatePctPerS).toBe(4)
  })

  it('V: a merely rate-limited slave does NOT make the master unavailable', () => {
    start(reg({ rate: '2 %/s', cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 1); advance(30)
    sim().writeTag('PIC-1', 'SP', 6)            // a big step, slowly followed
    advance(3)
    expect(loop('FIC-1').rateLimited).toBe(true)
    /**
     * A HEALTHY ACTUATOR PATH, MOVING AT ITS CONFIGURED RATE. K17's
     * `downstream` authority is for a slave in MANUAL or one that cannot reach
     * its own process — not for one that is simply taking the time its record
     * says it may take. Classifying this as unavailability would hold the
     * master's integrator through every ordinary transient.
     */
    expect(loop('PIC-1').authority).toBe('available')
    expect(loop('FIC-1').authority).toBe('available')
    const before = sim().tags['PIC-1']!.I
    advance(3)
    expect(sim().tags['PIC-1']!.I).not.toBe(before)   // still integrating
  })
})

// ── W, X. Minimum flow ──────────────────────────────────────────────────────

describe('W, X — the setpoint constraint and the output constraint, in order', () => {
  it('W: minimum flow still acts on the SETPOINT, the rate limit on the OUTPUT', () => {
    start(reg({ rate: '5 %/s', minFlow: '20 m³/h' }))
    lineUp(12); advance(400)
    const p = sim().minFlow['FIC-1']!
    // K18's override, untouched: the setpoint is raised and SP is not written
    expect(p.requestedSp).toBe(12)
    expect(p.effectiveSp).toBe(20)
    expect(fic().SP).toBe(12)
    // ...and the rate limit sits downstream of the algorithm that used it
    expect(loop().outputRatePctPerS).toBe(5)
    expect(sim().pumpEnvelopes['P-1']!.flowM3h!).toBeGreaterThan(19)
  })

  it('W: the override is not rate-limited — a setpoint is not an output', () => {
    start(reg({ rate: '1 %/s', minFlow: '20 m³/h' }))
    lineUp(12)
    sim().tickOnce(1)
    // the effective setpoint is AT the minimum on the very first tick, however
    // slowly the output is allowed to chase it
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(20)
  })

  it('X: and the same limit on a loop with no master at all', () => {
    start(reg({ rate: '5 %/s' }))
    lineUp(40); advance(400)
    expect(loop().cascadeFrom).toBeUndefined()
    expect(loop().outputRatePctPerS).toBe(5)
    expect(Math.abs(sim().tags['FT-1']!.PV! - 40)).toBeLessThan(1.5)
  })
})

// ── Y, Z, AF. Distinctness, determinism ─────────────────────────────────────

describe('Y, Z, AF — four values, and the same answer twice', () => {
  it('Y: four values, separately observable, and never collapsed into one', () => {
    /**
     * WHICH PAIRS DIFFER DEPENDS ON THE PLANT; that they are FOUR SEPARATE
     * VALUES does not. Here the setpoint pair differ because the minimum-flow
     * override is holding the loop above what it was asked for, and the output
     * pair differ because the rate limit is holding the command below what the
     * algorithm asked for. The shaft happens to have caught the command,
     * because a 3 %/s limit is far tighter than the drive's 50 points a second
     * — which is itself the §11 point, measured in §T.
     */
    start(reg({ rate: '3 %/s', minFlow: '20 m³/h' }))
    lineUp(12); advance(400)
    sim().writeTag('FIC-1', 'SP', 50)           // ask for a move it cannot make at once
    sim().tickOnce(1)
    const p = sim().minFlow['FIC-1']!
    const l = loop()
    // the SETPOINT pair — K18's, untouched by K21
    expect(p.requestedSp).toBe(50)
    expect(p.effectiveSp).toBe(50)              // above the minimum, so unchanged
    // the OUTPUT pair — K21's
    expect(l.requestedOp).toBeGreaterThan(l.requested!)
    // ...and the actuator, published on its own and read from the shaft
    expect(l.actual).toBeCloseTo(shaftPct(), 6)
    expect(l.actual).not.toBe(l.requestedOp)
  })

  it('Y: and with the setpoint BELOW the minimum, all four are distinct', () => {
    start(reg({ rate: '90 %/s', minFlow: '20 m³/h' }))
    lineUp(12); advance(400)
    sim().writeTag('FIC-1', 'SP', 55)
    sim().tickOnce(1)
    const p = sim().minFlow['FIC-1']!
    const l = loop()
    sim().writeTag('FIC-1', 'SP', 12)           // back below the minimum
    sim().tickOnce(1)
    expect(sim().minFlow['FIC-1']!.requestedSp).toBe(12)
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(20)   // raised
    // a LOOSE rate limit lets the command through and the DRIVE becomes the
    // lag, so command and shaft separate instead
    expect(p.effectiveSp).toBe(55)
    expect(l.actual).not.toBe(l.requested)
  })

  it('Z, AF: the same inputs give the same commands, tick for tick', () => {
    const run = () => {
      start(reg({ rate: '4 %/s' }))
      lineUp(15)
      const trace: string[] = []
      for (let i = 0; i < 200; i++) {
        advance(1)
        if (i === 80) sim().writeTag('FIC-1', 'SP', 45)
        trace.push([fic().OP, fic().OPC, pump().SPD, shaftPct(), loop().rateLimited]
          .map((x) => (typeof x === 'number' ? x.toFixed(9) : String(x))).join(','))
      }
      return trace
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
    expect(new Set(a).size).toBeGreaterThan(50)   // it genuinely moved
  })
})

// ── AA, AB, AC, AD, AE. The lifecycle ───────────────────────────────────────

describe('AA-AE — start, stop, restart, fault, recover', () => {
  it('AA: calm-start is unchanged — no jump caused by the limiter existing', () => {
    start(reg({ rate: '5 %/s' }))
    sim().tickOnce(1)
    // K15's calm start: the loop is given its own measurement, and nothing
    // moves. The command equals the request at t=0, so there is nothing for a
    // rate limiter to catch up from.
    expect(fic().OPC ?? 0).toBe(fic().OP ?? 0)
    expect(loop().rateLimited).toBe(false)
  })

  it('AB, AC: shutdown holds the command, and a restart resumes from it', () => {
    start(reg({ rate: '5 %/s' }))
    lineUp(40); advance(300)
    const running = commanded()!
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(commanded()).toBe(running)           // held, not zeroed or decayed
    sim().writeTag('P-1', 'RUN', 1); advance(300)
    expect(loop().authority).toBe('available')
    expect(Math.abs(sim().tags['FT-1']!.PV! - 40)).toBeLessThan(2)
  })

  it('AD, AE: a fault holds it too, and recovery walks back at the configured rate', () => {
    start(reg({ rate: '5 %/s' }))
    lineUp(40); advance(300)
    sim().writeTag('P-1', 'FAULT', 1); advance(20)
    const held = commanded()!
    expect(pump().RAMP).toBe(0)                 // the shaft is out, K12's rule
    advance(20)
    expect(commanded()).toBe(held)              // and the command has not drifted
    sim().writeTag('P-1', 'FAULT', 0)
    sim().writeTag('P-1', 'RUN', 1)
    sim().tickOnce(1)
    expect(Math.abs(commanded()! - held)).toBeLessThanOrEqual(5 + 1e-9)
  })
})

// ── AG, AH, AI, AJ, AL. Nothing else moved ──────────────────────────────────

describe('AG-AL — the measurement, the plant and the tuning are untouched', () => {
  it('AG, §20: the PROCESS responds to the COMMAND, never to the request', () => {
    /**
     * THE CAUSALITY CHAIN, end to end. A loop with a slow rate limit is asked
     * for a large step. If anything shortcut the limiter — if the request
     * reached `SPD`, or the solve, or the transmitter — the plant would arrive
     * early. It does not.
     */
    start(reg({ rate: '2 %/s' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 25); advance(120)
    const settled = sim().tags['FT-1']!.PV!
    sim().writeTag('FIC-1', 'OP', 100)          // ask for everything, at once
    sim().tickOnce(1)
    // request 100, command 27, and every stage downstream follows the COMMAND
    expect(fic().OP).toBe(100)                  // the request
    expect(commanded()).toBeCloseTo(27, 6)      // the command
    expect(pump().SPD).toBeCloseTo(27, 6)       // ...and the DRIVE got the command
    expect(pump().SPD).not.toBe(100)            // never the request
    // the shaft follows the command it was given, and the process follows the
    // shaft — so the plant is nowhere near where a request of 100 would put it
    expect(shaftPct()).toBeLessThanOrEqual(27 + 1e-9)
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(settled + 12)
  })

  it('AH, AI: the hydraulics and the pump curve are the same with and without', () => {
    // one plant, one hand command, held long enough for both to settle
    const settle = (r: Registry) => {
      start(r)
      sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
      sim().writeTag('FIC-1', 'MODE', 0)
      sim().writeTag('FIC-1', 'OP', 70); advance(400)
      return { spd: pump().SPD, flow: sim().pumpEnvelopes['P-1']!.flowM3h }
    }
    const withLimit = settle(reg({ rate: '3 %/s' }))
    const without = settle(reg())
    // the limiter changes WHEN the command arrives, never WHERE it settles
    expect(withLimit.spd).toBeCloseTo(without.spd!, 9)
    expect(withLimit.flow).toBeCloseTo(without.flow!, 9)
  })

  it('AJ: the controller gains are identical with a rate limit configured', () => {
    const c = (r: Registry) => buildSimModel(plant, r).controllers.find((x) => x.tag === 'FIC-1')!
    const gains = (x: Record<string, unknown>) =>
      ({ kp: x.kp, ti: x.ti, outMin: x.outMin, outMax: x.outMax, action: x.action })
    expect(gains(c(reg({ rate: '3 %/s' })) as never)).toEqual(gains(c(reg()) as never))
  })

  it('AL: no journal spam — a rate-limited move writes nothing at all', () => {
    start(reg({ rate: '2 %/s' }))
    lineUp(15); advance(100)
    const before = sim().journal.length
    sim().writeTag('FIC-1', 'SP', 50)           // one command, one entry
    advance(200)                                // 200 ticks of rate limiting
    const added = sim().journal.length - before
    expect(added).toBeLessThanOrEqual(2)
    // and nothing in the journal mentions rate limiting, because it is not an
    // event — it is a state the faceplate shows
    expect(sim().journal.some((e) => 'sig' in e && String(e.sig).includes('RATE'))).toBe(false)
  })
})

// ── AM-AR. Everything before K21 ────────────────────────────────────────────

describe('AM-AR — K14 through K20, unchanged with no limit configured', () => {
  it('AM, AN: an unconfigured loop settles exactly where K15 left it', () => {
    start(reg())
    lineUp(30); advance(500)
    expect(Math.abs(sim().tags['FT-1']!.PV! - 30)).toBeLessThan(0.7)
    expect(fic().OPC).toBeUndefined()           // no second signal exists
  })

  it('AO: K16 authority and its HOLD, unchanged', () => {
    start(reg())
    lineUp(30); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(5)
    expect(loop().authority).toBe('de-energised')
    const held = { OP: fic().OP, I: fic().I }
    advance(60)
    expect({ OP: fic().OP, I: fic().I }).toEqual(held)
  })

  it('AP: K17 cascade, unchanged', () => {
    start(reg({ cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 4); advance(300)
    expect(sim().loops['PIC-1']!.cascadeTo).toBe('FIC-1')
    expect(sim().loops['FIC-1']!.cascadeFrom).toBe('PIC-1')
    expect(sim().tags['PIC-1']!.OPC).toBeUndefined()
  })

  it('AQ: K18/K19 minimum flow, unchanged', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(400)
    const p = sim().minFlow['FIC-1']!
    expect(p.requestedSp).toBe(12)
    expect(p.effectiveSp).toBe(20)
    expect(p.overriding).toBe(true)
    expect(p.inForce).toBe(true)
    expect(fic().SP).toBe(12)
  })

  it('AR: K20 alarms, unchanged', () => {
    start({
      ...reg({ minFlow: '55 m³/h' }),
      'P-1': { key: 'P-1', kind: 'equipment', fields: {
        ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %',
        'duty.minFlow': '55 m³/h', 'alarm.minFlowPriority': 'high' } },
    })
    lineUp(12); advance(300)
    expect(sim().alarms.find((a) => a.id === 'P-1:MINF')?.phase).toBe('active')
  })
})
