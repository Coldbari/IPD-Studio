// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K26 — WHICH EQUIPMENT LIMITS AN ENGINEER OWNS, AND WHICH THIS MODEL ASSUMES.
 *
 * ── THE AUDIT THAT DECIDED IT ─────────────────────────────────────────────
 *
 * Every field the datasheets declare was cross-checked against what the
 * simulator actually consumes. The result, for the equipment side:
 *
 *     duty.minSpeed     ENGINEERING — consumed, and the one equipment limit
 *                       in this product with a real owner
 *     duty.speed        declared, NOT consumed — a rated speed in rpm
 *     actuation.*       five fields, none of them a stroke time
 *     maximum speed     NO FIELD ANYWHERE
 *     ramp / coast      NO FIELD ANYWHERE
 *     valve travel      NO FIELD ANYWHERE
 *
 * So `RAMP_S`, `COAST_S` and `STROKE_RATE` stay simulator assumptions and no
 * engineering field was invented for them. Adding `duty.rampTime` would create
 * a field every existing drawing leaves blank, which then falls back to the
 * constant it was meant to replace — and a constant reached through an empty
 * engineering field looks exactly like data somebody entered.
 *
 * ── AND THE THREE UNTRUTHS IT FOUND ───────────────────────────────────────
 *
 * All three were the same mistake: a model constant wearing a datasheet's
 * clothes.
 *
 *   1. A command above 100 % was reported as "outside the drive envelope its
 *      record declares" — on a record that declares only a MINIMUM. What 120 %
 *      violates is the pump curve's own domain, which no record states.
 *   2. `duty.minSpeed: -5 %` reached `TagDef.minSpeedPct` as -5 and would have
 *      shown a declared minimum speed of minus five per cent on a faceplate.
 *   3. `duty.minSpeed: 150 %` made the same finding report that the drive was
 *      "holding the shaft at 150 %" while the shaft was at 100 %.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { envelopeFindings } from '../../src/hmi/sim/envelope'
import {
  CONSTRAINTS, PHYSICAL_RATES_ARE_SIMULATOR_ASSUMPTIONS,
} from '../../src/hmi/sim/constraints'
import { processFor } from '../../src/model/processData'
import { FIELD_CATALOG } from '../../src/model/fields'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The K15 plant, and the same plant with no controller on the machine ─────

const plant: HmiScreen = {
  id: 'k26', name: 'K26', theme: 'classic',
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
/** No controller, so nothing rewrites `SPD` and a direct command survives. */
const noLoop: HmiScreen = { ...plant, widgets: plant.widgets.filter((w) => w.id !== 'fic') }

const reg = (extra: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', ...extra } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
})
const vsd = (extra: Record<string, string> = {}) => reg({ 'duty.minSpeed': '20 %', ...extra })

const sim = () => useSimStore.getState()
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }
const start = (r: Registry = vsd(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const pump = () => sim().tags['P-1']!
const valve = () => sim().tags['HV-9']!
const shaftPct = () => (pump().RAMP ?? 0) * 100
const env = () => sim().pumpEnvelopes['P-1']!
const speedFinding = () => envelopeFindings(sim().pumpEnvelopes)
  .find((f) => f.id.endsWith('pump-speed-out-of-envelope'))
const lineUp = () => { sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) }
/** A hand-driven machine, so `OP` is ours and the drive is the only lag. */
const byHand = (op: number, r: Registry = vsd()) => {
  start(r); lineUp()
  sim().writeTag('FIC-1', 'MODE', 0); sim().writeTag('FIC-1', 'OP', op); advance(60)
}

beforeEach(() => { start() })

// ── §2, §11. Ownership, audited against the catalogue ───────────────────────

describe('§2, §11 — what the record owns, and what this model assumes', () => {
  const keys = new Set(
    Object.values(FIELD_CATALOG).flatMap((sections) =>
      sections.flatMap((s) => s.fields.map((f) => f.key))))

  it('the classification is recorded, not merely believed', () => {
    expect(PHYSICAL_RATES_ARE_SIMULATOR_ASSUMPTIONS).toBe(true)
  })

  it('§4: there is NO maximum-speed field, and K26 added none', () => {
    for (const k of ['duty.maxSpeed', 'duty.speedMax', 'duty.ratedSpeedPct']) {
      expect(keys.has(k)).toBe(false)
    }
    // the 100 % ceiling is the CURVE's domain, recorded as such
    expect(CONSTRAINTS.find((c) => c.id === 'vsd-ceiling')!.source).toBeNull()
  })

  it('§5, §6: there is NO ramp, coast or stroke-time field either', () => {
    for (const k of ['duty.rampTime', 'duty.coastTime', 'duty.accelTime',
      'actuation.strokeTime', 'actuation.strokeRate', 'actuation.speed']) {
      expect(keys.has(k)).toBe(false)
    }
    // ...and the runtime records all three as model-owned, not record-owned
    for (const id of ['vsd-ramp', 'valve-stroke', 'valve-travel']) {
      expect(CONSTRAINTS.find((c) => c.id === id)!.source).toBeNull()
    }
  })

  it('`duty.speed` is a RATED SPEED in rpm, and is not read as a ceiling', () => {
    expect(keys.has('duty.speed')).toBe(true)          // the field exists…
    const p = processFor(reg({ 'duty.speed': '2950 rpm' }), 'P-1')
    // …and nothing in the process model consumes it. Reading it as a per cent
    // would be the same category error as reading minFlow as a minimum speed.
    expect((p as unknown as Record<string, unknown>).speedRpm).toBeUndefined()
    expect(p.minSpeedPct).toBeUndefined()
  })

  it('§3: `duty.minSpeed` has ONE owner and two deliberate enforcers', () => {
    const c = buildSimModel(plant, vsd()).controllers.find((x) => x.tag === 'FIC-1')!
    expect(processFor(vsd(), 'P-1').minSpeedPct).toBe(20)
    expect(c.outMin).toBe(20)                          // the controller's floor…
    // …and the actuator's own clamp, which a direct write cannot slip past
    start(vsd(), noLoop)
    lineUp(); sim().writeTag('P-1', 'SPD', 3); advance(30)
    expect(pump().SPD).toBe(3)                         // the command is left visible
    expect(shaftPct()).toBeCloseTo(20, 6)              // the shaft is not
  })
})

// ── A-D, U. The turndown, and what is not one ───────────────────────────────

describe('A-D, U — absent, zero, negative, above the ceiling, unreadable', () => {
  const turndown = (v?: string) =>
    processFor(v === undefined ? reg() : reg({ 'duty.minSpeed': v }), 'P-1').minSpeedPct

  it('A: absent means no turndown, and none is imposed', () => {
    expect(turndown()).toBeUndefined()
    expect(buildSimModel(plant, reg()).controllers.find((c) => c.tag === 'FIC-1')!.outMin)
      .toBe(0)
  })

  it('B: a stated turndown is read, in per cent', () => {
    expect(turndown('20 %')).toBe(20)
    expect(turndown('20')).toBe(20)                    // bare numbers are per cent
    expect(turndown('37.5 %')).toBe(37.5)
  })

  it('C: ZERO is a real statement and is kept — a drive with no turndown', () => {
    expect(turndown('0 %')).toBe(0)
    // identical in effect to stating nothing, which is correct: both mean no
    // floor. That is `absent ≠ zero` holding rather than failing — the two
    // differ in what the RECORD says and agree in what the plant does.
    expect(buildSimModel(plant, reg({ 'duty.minSpeed': '0 %' })).controllers
      .find((c) => c.tag === 'FIC-1')!.outMin).toBe(0)
  })

  it('D: a NEGATIVE turndown is not a fraction of anything, and is refused', () => {
    /**
     * K26 FOUND THIS. Before, -5 reached `TagDef.minSpeedPct` and would have
     * put "minimum speed -5 %" on a machine's faceplate. The controller and
     * the actuator each clamped it away, so the PHYSICS was always safe and
     * the PUBLISHED value was not.
     */
    expect(turndown('-5 %')).toBeUndefined()
    start(reg({ 'duty.minSpeed': '-5 %' }))
    lineUp(); advance(20)
    expect(sim().defs['P-1']!.minSpeedPct).toBeUndefined()
    expect(env().minSpeedPct).toBeUndefined()
  })

  it('D: a turndown ABOVE the curve’s ceiling describes no band, and is refused', () => {
    /**
     * A floor above the only ceiling this model has. The pump curve is defined
     * AT rated speed, so there is no speed above it to turn down from — and
     * before K26 this made the envelope report a drive "holding the shaft at
     * 150 %" while the shaft was at 100 %.
     */
    expect(turndown('150 %')).toBeUndefined()
    start(vsd({ 'duty.minSpeed': '150 %' }), noLoop)
    lineUp(); advance(30)
    expect(sim().defs['P-1']!.minSpeedPct).toBeUndefined()
    expect(shaftPct()).toBeCloseTo(100, 6)
    expect(speedFinding()).toBeUndefined()             // nothing to be outside of
  })

  it('D, V, W: an unreadable value, or one in another unit, is not a turndown', () => {
    expect(turndown('abc')).toBeUndefined()
    expect(turndown('')).toBeUndefined()
    expect(turndown('20 rpm')).toBeUndefined()         // not a percentage
    expect(turndown('100 %')).toBe(100)                // the boundary is INSIDE
  })

  it('U: refused means ABSENT — never clamped into range', () => {
    // silently turning -5 into 0, or 150 into 100, would publish a limit
    // nobody wrote. The machine behaves as if the field were blank.
    for (const bad of ['-5 %', '150 %', 'abc']) {
      expect(turndown(bad)).toBeUndefined()
    }
  })
})

// ── E-H. The speed command, and which limit it crossed ──────────────────────

describe('E-H — a command above rated, and a command below the turndown', () => {
  it('E: with no turndown stated there is no envelope to be outside of', () => {
    start(reg(), noLoop)
    lineUp(); advance(20)
    expect(env().speedOutOfEnvelope).toBe(false)
    expect(speedFinding()).toBeUndefined()
  })

  it('G: a command ABOVE rated names the CURVE, and does not blame the record', () => {
    /**
     * THE K26 DEFECT. The record declares a minimum of 20 and no maximum at
     * all; 120 % does not violate 20. What it violates is the model's own
     * curve domain — and the old message said "outside the drive envelope its
     * record declares (minimum 20 %)", which is a model constant wearing a
     * datasheet's clothes.
     */
    start(vsd(), noLoop)
    lineUp(); sim().writeTag('P-1', 'SPD', 120); advance(20)
    expect(pump().SPD).toBe(120)                       // the command is left visible
    expect(shaftPct()).toBeCloseTo(100, 6)             // the shaft is not
    const f = speedFinding()!
    expect(f.message).toContain('above rated')
    expect(f.message).toContain('no maximum is stated on the record')
    expect(f.message).not.toContain('minimum 20')      // it did not cross that
    expect(f.message).toContain('The shaft is at 100 %')
  })

  it('H: a command BELOW the turndown names the RECORD, because it is the record’s', () => {
    start(vsd(), noLoop)
    lineUp(); sim().writeTag('P-1', 'SPD', 5); advance(20)
    const f = speedFinding()!
    expect(f.message).toContain('below the minimum of 20 %')
    expect(f.message).toContain('its record declares')
    expect(f.message).toContain('The shaft is at 20 %')
    expect(f.severity).toBe('warning')
  })

  it('the shaft is reported from the SHAFT, not from the limit it is heading for', () => {
    // mid-ramp the two differ, and the old wording claimed the drive was
    // already holding a speed it had not reached
    start(vsd(), noLoop)
    lineUp(); advance(30)                              // settled at 100 %
    sim().writeTag('P-1', 'SPD', 5)
    sim().tickOnce(1)
    expect(shaftPct()).toBeCloseTo(50, 6)              // still on its way down
    expect(speedFinding()!.message).toContain('The shaft is at 50 %')
  })
})

// ── I, J, K, L, M. The physical rates, measured ─────────────────────────────

describe('I-M — RAMP_S, COAST_S, and how they meet the controller', () => {
  it('I: the drive covers full travel in RAMP_S — 50 points of speed a second', () => {
    byHand(20)
    expect(shaftPct()).toBeCloseTo(20, 6)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1); expect(shaftPct()).toBeCloseTo(70, 6)
    sim().tickOnce(1); expect(shaftPct()).toBeCloseTo(100, 6)
  })

  it('I: and it governs a commanded SLOW-DOWN at the same rate, both ways', () => {
    byHand(100)
    sim().writeTag('FIC-1', 'OP', 20)
    sim().tickOnce(1); expect(shaftPct()).toBeCloseTo(50, 6)
    sim().tickOnce(1); expect(shaftPct()).toBeCloseTo(20, 6)
  })

  it('J: COAST_S is a DIFFERENT rate — a de-energised shaft is not a driven one', () => {
    byHand(100)
    sim().writeTag('P-1', 'RUN', 0)
    sim().tickOnce(1); expect(shaftPct()).toBeCloseTo(100 / 1.5, 4)   // ~66.7
    sim().tickOnce(1); expect(shaftPct()).toBeCloseTo(100 / 3, 4)     // ~33.3
    sim().tickOnce(1); expect(shaftPct()).toBeCloseTo(0, 6)
    // asymmetric with RAMP_S, and deliberately so
    expect(100 / 3).not.toBeCloseTo(50, 1)
  })

  it('J: a FAULT takes the shaft out at once — a breaker is not a ramp', () => {
    byHand(100)
    sim().writeTag('P-1', 'FAULT', 1)
    sim().tickOnce(1)
    expect(pump().RAMP).toBe(0)
  })

  it('K, §13: the controller rate and the physical ramp are two lags in series', () => {
    const r = { ...vsd(),
      'FIC-1': { key: 'FIC-1', kind: 'instrument' as const,
        fields: { 'signal.outputRateLimit': '10 %/s' } } }
    byHand(20, r)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    expect(sim().tags['FIC-1']!.OP).toBe(100)          // the request
    expect(sim().tags['FIC-1']!.OPC).toBeCloseTo(30, 6) // the control layer held it
    expect(shaftPct()).toBeCloseTo(30, 6)              // the drive could keep up
  })

  it('L: the turndown floors the controller and the shaft, at the same number', () => {
    byHand(5)
    expect(sim().tags['FIC-1']!.OP).toBe(5)            // the operator's entry
    expect(pump().SPD).toBe(20)                        // the controller clamped it
    expect(shaftPct()).toBeCloseTo(20, 6)
  })

  it('M: and with no maximum to configure, the ceiling is the controller’s travel', () => {
    byHand(100)
    expect(pump().SPD).toBe(100)
    expect(buildSimModel(plant, vsd()).controllers
      .find((c) => c.tag === 'FIC-1')!.outMax).toBe(100)
  })
})

// ── N-T. The valve ──────────────────────────────────────────────────────────

describe('N-T — valve travel, stroke rate, and a stuck actuator', () => {
  it('N, §7: there are no engineering travel limits, and 0-100 is the domain', () => {
    expect(CONSTRAINTS.find((c) => c.id === 'valve-travel')!.source).toBeNull()
  })

  it('P: a command beyond travel leaves the COMMAND visible and the POSITION physical', () => {
    start()
    sim().writeTag('HV-9', 'OP', 150); advance(20)
    expect(valve().OP).toBe(150)
    expect(valve().POS).toBe(100)
    sim().writeTag('HV-9', 'OP', -50); advance(20)
    expect(valve().OP).toBe(-50)
    expect(valve().POS).toBe(0)
  })

  it('Q, §6: STROKE_RATE is 25 %/s and SYMMETRIC — opening and closing alike', () => {
    start()
    sim().writeTag('HV-9', 'OP', 0); advance(30)
    sim().writeTag('HV-9', 'OP', 100)
    sim().tickOnce(1); expect(valve().POS).toBe(25)
    sim().tickOnce(1); expect(valve().POS).toBe(50)
    sim().writeTag('HV-9', 'OP', 0)
    sim().tickOnce(1); expect(valve().POS).toBe(25)
    sim().tickOnce(1); expect(valve().POS).toBe(0)
  })

  it('Q: it stops AT the ends rather than overshooting them', () => {
    start()
    sim().writeTag('HV-9', 'OP', 100); advance(20)
    expect(valve().POS).toBe(100)
    advance(20)
    expect(valve().POS).toBe(100)
  })

  it('R, §6: the controller rate and STROKE_RATE stay separate', () => {
    // a controller allowed to move FASTER than the valve can stroke: the
    // command arrives whole and the actuator is the binding lag
    start()
    sim().writeTag('HV-9', 'OP', 0); advance(30)
    sim().writeTag('HV-9', 'OP', 100)
    sim().tickOnce(1)
    expect(valve().OP).toBe(100)                       // the command, in full
    expect(valve().POS).toBe(25)                       // the actuator's own rate
  })

  it('S: a STUCK valve does not move, and its command is still visible', () => {
    start()
    sim().writeTag('HV-9', 'OP', 50); advance(30)
    const held = valve().POS
    sim().writeTag('HV-9', 'STUCK', 1)
    sim().writeTag('HV-9', 'OP', 100); advance(30)
    expect(valve().OP).toBe(100)
    expect(valve().POS).toBe(held)
  })

  it('T: requested, commanded and actual stay three numbers', () => {
    start()
    sim().writeTag('HV-9', 'OP', 0); advance(30)
    sim().writeTag('HV-9', 'OP', 150)
    sim().tickOnce(1)
    expect(valve().OP).toBe(150)                       // requested
    expect(valve().POS).toBe(25)                       // actual, mid-stroke
    // and the command the actuator is chasing is the CLAMPED one, which is why
    // no DEV alarm is raised for a valve at its own stop
    advance(20)
    expect(valve().POS).toBe(100)
    expect(valve().DEVT).toBe(0)
  })
})

// ── Y-AB. The states this phase must not have touched ───────────────────────

describe('Y-AB — a physical lag is still not a controller state', () => {
  it('Y, §8: a lagging shaft does not saturate the controller', () => {
    byHand(20)
    sim().writeTag('FIC-1', 'MODE', 1); sim().writeTag('FIC-1', 'SP', 30)
    sim().tickOnce(1)
    expect(sim().loops['FIC-1']!.saturated).toBe(0)
  })

  it('Z: nor does it rate-limit it', () => {
    byHand(20)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    expect(shaftPct()).toBeCloseTo(70, 6)              // mid-ramp
    expect(sim().loops['FIC-1']!.rateLimited ?? false).toBe(false)
  })

  it('AA: nor does it cost the loop its authority', () => {
    byHand(20)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    expect(sim().loops['FIC-1']!.authority).toBe('available')
  })

  it('AB, §16: and it never becomes a downstream limitation', () => {
    byHand(20)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    expect(sim().loops['FIC-1']!.downstreamLimited).toBeUndefined()
  })
})

// ── AC-AH. Everything before K26 ────────────────────────────────────────────

describe('AC-AH — K21 through K25, and determinism', () => {
  it('AC: K21 output-rate limiting', () => {
    const r = { ...vsd(),
      'FIC-1': { key: 'FIC-1', kind: 'instrument' as const,
        fields: { 'signal.outputRateLimit': '10 %/s' } } }
    byHand(40, r)
    sim().writeTag('FIC-1', 'OP', 90)
    sim().tickOnce(1)
    expect(sim().tags['FIC-1']!.OPC).toBeCloseTo(50, 6)
  })

  it('AD: K22 — SAT is the controller’s own travel', () => {
    start(vsd()); lineUp(); sim().writeTag('FIC-1', 'SP', 58); advance(400)
    expect(sim().loops['FIC-1']!.saturated).toBe(1)
  })

  it('AE: K23 setpoint limits', () => {
    const r = { ...vsd(),
      'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: { 'signal.spHigh': '30' } } }
    start(r); lineUp(); sim().writeTag('FIC-1', 'SP', 50); advance(100)
    expect(sim().loops['FIC-1']!.spLimit!.limited).toBe(30)
  })

  it('AF, AG: K24/K25 — the taxonomy is untouched by an equipment audit', () => {
    start(vsd()); lineUp(); sim().writeTag('FIC-1', 'SP', 30); advance(200)
    const l = sim().loops['FIC-1']!
    expect(l.downstreamLimited).toBeUndefined()        // no cascade here
    expect(l.authority).toBe('available')
  })

  it('AH: deterministic through every rate and every clamp', () => {
    const run = () => {
      start(vsd())
      lineUp(); sim().writeTag('FIC-1', 'MODE', 0)
      const trace: string[] = []
      for (let i = 0; i < 150; i++) {
        if (i === 10) sim().writeTag('FIC-1', 'OP', 100)
        if (i === 50) sim().writeTag('FIC-1', 'OP', 5)
        if (i === 90) sim().writeTag('HV-9', 'OP', 150)
        if (i === 120) sim().writeTag('P-1', 'RUN', 0)
        sim().tickOnce(1)
        trace.push([pump().SPD, shaftPct(), valve().OP, valve().POS]
          .map((x) => (typeof x === 'number' ? x.toFixed(9) : String(x))).join(','))
      }
      return trace
    }
    const a = run()
    expect(run()).toEqual(a)
    /**
     * Eight distinct states across 150 ticks: the plant reaches each commanded
     * rest quickly and then holds, which is what a determinism check WANTS to
     * see — it is asserting that a trace which genuinely moves reproduces
     * exactly, not that a motionless one does.
     */
    expect(new Set(a).size).toBeGreaterThan(5)
  })
})
