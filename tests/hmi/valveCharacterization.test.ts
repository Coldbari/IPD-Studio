// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K28 — VALVE CHARACTERIZATION, AND WHY Cv CANNOT ENTER THE SOLVE.
 *
 * ── WHAT THE SOLVER DOES ──────────────────────────────────────────────────
 *
 *     ΔP = R · Q²        R in bar / (m³/h)²
 *     valve             R = VALVE_K / f⁴     f = ACTUAL opening, 0..1
 *     pipe              R = PIPE_K
 *     fitting           R = PIPE_K / 10
 *     pump              R = 0, the curve carries it
 *
 * `VALVE_K` is ONE CONSTANT FOR EVERY VALVE. Measured below: a branch whose
 * two legs state Cv 40 and Cv 200 splits the flow exactly 50/50, to nine
 * decimal places.
 *
 * ── AND WHY IT STAYS THAT WAY ─────────────────────────────────────────────
 *
 * The coefficient form is `ΔP = SG·(Q/Kv)²`, so `R = SG/Kv²`. Three things
 * that conversion needs are absent, and any one is sufficient:
 *
 *   1. WHICH COEFFICIENT. The field is labelled `Cv / Kv` and stores a
 *      free-form string. The two differ by ~1.156 and nothing says which a
 *      number is.
 *   2. THE REFERENCE CONDITION. None is recorded.
 *   3. THE SPECIFIC GRAVITY. `SG` is in the equation; the solver's own header
 *      says it solves one incompressible fluid at one density, and
 *      `sim/fluids.ts` says the solver does not know a fluid exists.
 *
 * Assuming water at 15 °C to close the gap would produce numbers that look
 * right and are attributable to nothing anybody recorded.
 *
 * ── SO K28 CHANGED NO PHYSICS ─────────────────────────────────────────────
 *
 * What it did was measure the current model precisely enough that the next
 * phase has a baseline, and prove behaviourally that both fields are inert.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import {
  PIPE_K, SHUT_FRACTION, VALVE_K, valveResistance,
} from '../../src/hmi/sim/hydraulic/model'
import { CV_CANNOT_ENTER_THE_SOLVE, EQUIPMENT_CAPABILITY } from '../../src/model/capability'
import { hasProperties } from '../../src/hmi/sim/fluids'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── Three topologies: one valve, two in series, two on a branch ─────────────

const single: HmiScreen = {
  id: 'k28a', name: 'one valve', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 150, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v1', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 146, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 210, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'v1', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'v1', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const series: HmiScreen = {
  id: 'k28b', name: 'two in series', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 150, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v1', type: 'valve', x: 320, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 'v2', type: 'valve', x: 500, y: 100, w: 48, h: 32, tag: 'HV-2', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 146, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 210, y: 118 }, { x: 316, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'v1', bPort: 'in' },
    { id: 'a3', points: [{ x: 372, y: 116 }, { x: 496, y: 116 }], aId: 'v1', aPort: 'out', bId: 'v2', bPort: 'in' },
    { id: 'a4', points: [{ x: 552, y: 116 }, { x: 700, y: 112 }], aId: 'v2', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const branch: HmiScreen = {
  id: 'k28c', name: 'two on a branch', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 200, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 150, y: 190, w: 56, h: 56, tag: 'P-1' },
    { id: 'tee', type: 'symbol', x: 320, y: 210, w: 16, h: 16, tag: 'T-1', props: { symbolId: 'fit.junction' } },
    { id: 'v1', type: 'valve', x: 450, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 'v2', type: 'valve', x: 450, y: 320, w: 48, h: 32, tag: 'HV-2', props: { throttle: true } },
    { id: 'ba', type: 'equip', x: 650, y: 100, w: 48, h: 24, tag: 'BL-A', props: { symbolId: 'bl.terminal' } },
    { id: 'bb', type: 'equip', x: 650, y: 320, w: 48, h: 24, tag: 'BL-B', props: { symbolId: 'bl.terminal' } },
  ],
  pipes: [
    { id: 'suc', points: [{ x: 0, y: 212 }, { x: 146, y: 218 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'hdr', points: [{ x: 210, y: 218 }, { x: 316, y: 218 }], aId: 'p', aPort: 'discharge', bId: 'tee' },
    { id: 'u1', points: [{ x: 328, y: 206 }, { x: 446, y: 116 }], aId: 'tee', bId: 'v1', bPort: 'in' },
    { id: 'u2', points: [{ x: 502, y: 116 }, { x: 650, y: 112 }], aId: 'v1', aPort: 'out', bId: 'ba', bPort: 'process' },
    { id: 'd1', points: [{ x: 328, y: 230 }, { x: 446, y: 336 }], aId: 'tee', bId: 'v2', bPort: 'in' },
    { id: 'd2', points: [{ x: 502, y: 336 }, { x: 650, y: 332 }], aId: 'v2', aPort: 'out', bId: 'bb', bPort: 'process' },
  ],
}

/** `valves` maps a valve tag to whatever its record states. */
const reg = (valves: Record<string, Record<string, string>> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-A': { key: 'BL-A', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-B': { key: 'BL-B', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...Object.fromEntries(Object.entries(valves)
    .map(([k, f]) => [k, { key: k, kind: 'valve' as const, fields: f }])),
})

const sim = () => useSimStore.getState()
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }
const start = (screen: HmiScreen, r: Registry = reg()) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const flows = () => Object.fromEntries(
  Object.entries(sim().pipeFlows).map(([k, v]) => [k, Number(v.toFixed(9))]))

/** Line every valve up, run the pump, settle, and report every pipe flow. */
const settle = (screen: HmiScreen, r: Registry, valves: string[]) => {
  start(screen, r)
  for (const v of valves) sim().writeTag(v, 'OP', 100)
  sim().writeTag('P-1', 'RUN', 1)
  advance(60)
  return flows()
}

beforeEach(() => { start(single) })

// ── §2, §6. The current element model, stated exactly ───────────────────────

describe('§2, §6 — the element equation, and what K actually is', () => {
  it('A: the valve resistance is K/f⁴, and K is not dimensionless', () => {
    // bar / (m³/h)² — a resistance in the pressure balance, not a multiplier
    expect(VALVE_K).toBe(4e-4)
    expect(valveResistance(1)).toBeCloseTo(VALVE_K, 12)
    expect(valveResistance(0.5)).toBeCloseTo(VALVE_K / 0.5 ** 4, 12)
    // it IS position-dependent, and that dependence is the characteristic
    expect(valveResistance(0.5) / valveResistance(1)).toBeCloseTo(16, 9)
  })

  it('A: a pipe and a fitting carry a fixed K, with no geometry behind them', () => {
    expect(PIPE_K).toBe(4e-4)
    // `PIPE_K`'s own comment records that diameter would enter if a record
    // ever held one; until then it is a calibration, not a calculation
  })

  it('§10: a shut valve is not zero flow — it is SHUT_FRACTION, for conditioning', () => {
    expect(SHUT_FRACTION).toBe(1e-3)
    expect(valveResistance(0)).toBeCloseTo(VALVE_K / SHUT_FRACTION ** 4, 4)
    start(single)
    sim().writeTag('HV-1', 'OP', 0); sim().writeTag('P-1', 'RUN', 1)
    advance(40)
    const q = Math.abs(sim().pipeFlows['a3'] ?? 0)
    expect(q).toBeGreaterThan(0)                    // not exactly zero…
    expect(q).toBeLessThan(0.001)                   // …and shut to any observer
  })

  it('A: the baseline this phase measured, so the next one has one', () => {
    const f = settle(single, reg(), ['HV-1'])
    expect(f['a3']).toBeGreaterThan(30)
    /**
     * ...and it is the same number through every pipe on a series path, to the
     * SOLVER'S OWN tolerance. A Newton solve converges to `MASS_TOL`, not to
     * the last bit: the measured spread across a settled series path is about
     * 1e-7 m³/h, which is three orders inside the 6e-5 the engine documents.
     * Asserting nine decimals here would be asserting an exact arithmetic the
     * solver never promised.
     */
    const s = settle(series, reg(), ['HV-1', 'HV-2'])
    expect(s['a2']).toBeCloseTo(s['a4']!, 5)
  })
})

// ── B-I, T, U. The two fields are inert ─────────────────────────────────────

describe('B-I, T, U — Cv and characteristic change nothing, whatever they say', () => {
  const base = settle(single, reg(), ['HV-1'])

  const cases: Record<string, Record<string, string>> = {
    'C: a plausible Cv': { 'element.cv': '120' },
    'D: an unreadable Cv': { 'element.cv': 'about a hundred' },
    'E: a zero Cv': { 'element.cv': '0' },
    'F: a negative Cv': { 'element.cv': '-50' },
    'H: a stated characteristic': { 'element.characteristic': 'Equal percentage' },
    'I: an unknown characteristic': { 'element.characteristic': 'Parabolic-ish' },
    'both together': { 'element.cv': '250', 'element.characteristic': 'Linear' },
  }

  it('B, G: with neither stated the plant settles somewhere definite', () => {
    expect(base['a3']).toBeGreaterThan(30)
    expect(settle(single, reg(), ['HV-1'])).toEqual(base)
  })

  for (const [name, fields] of Object.entries(cases)) {
    it(`${name} changes no flow anywhere`, () => {
      expect(settle(single, reg({ 'HV-1': fields }), ['HV-1'])).toEqual(base)
    })
  }

  it('T, U: and there is no hidden default for either — both stay DECLARED', () => {
    expect(CV_CANNOT_ENTER_THE_SOLVE).toBe(true)
    for (const id of ['element.cv', 'element.characteristic']) {
      expect(EQUIPMENT_CAPABILITY.find((f) => f.id === id)!.cls).toBe('DECLARED')
    }
  })

  it('the throttled curve is the same shape whatever the record says', () => {
    const sweep = (fields: Record<string, string>) => {
      start(single, reg({ 'HV-1': fields }))
      sim().writeTag('P-1', 'RUN', 1)
      const out: number[] = []
      for (const pos of [100, 75, 50, 25]) {
        sim().writeTag('HV-1', 'OP', pos); advance(40)
        out.push(Number((sim().pipeFlows['a3'] ?? 0).toFixed(9)))
      }
      return out
    }
    const plain = sweep({})
    expect(sweep({ 'element.cv': '30', 'element.characteristic': 'Linear' })).toEqual(plain)
    // ...and the shape is the model's own K/f⁴, which falls steeply
    expect(plain[0]!).toBeGreaterThan(plain[3]!)
  })
})

// ── J, K, L, M. Which position drives the hydraulics ────────────────────────

describe('J-M, §8, §9 — the ACTUAL position, never the command', () => {
  it('J, K: the command goes at once and the FLOW follows the position down', () => {
    /**
     * §8 calls this critical, and it is: a solver reading the command would
     * make a valve shut instantly and a plant respond to something that had
     * not happened yet. The flow tracks `POS`, which strokes.
     */
    start(single)
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    advance(40)
    const open = sim().pipeFlows['a3']!
    sim().writeTag('HV-1', 'OP', 0)                 // slam the command shut
    const trace: { pos: number; q: number }[] = []
    for (let i = 0; i < 4; i++) {
      sim().tickOnce(1)
      trace.push({ pos: sim().tags['HV-1']!.POS!, q: sim().pipeFlows['a3']! })
    }
    expect(sim().tags['HV-1']!.OP).toBe(0)          // the command is already 0
    expect(trace[0]!.pos).toBe(75)                  // the position is not
    // the flow fell WITH the position, not with the command
    expect(trace[0]!.q).toBeLessThan(open)
    expect(trace[1]!.q).toBeLessThan(trace[0]!.q)
    expect(trace[2]!.q).toBeLessThan(trace[1]!.q)
    expect(trace[3]!.pos).toBe(0)
  })

  it('L: STROKE_RATE governs how fast the position — and so the flow — moves', () => {
    start(single)
    sim().writeTag('HV-1', 'OP', 0); advance(30)
    sim().writeTag('HV-1', 'OP', 100)
    sim().tickOnce(1); expect(sim().tags['HV-1']!.POS).toBe(25)
    sim().tickOnce(1); expect(sim().tags['HV-1']!.POS).toBe(50)
  })

  it('M: a STUCK valve holds its position, and the flow holds with it', () => {
    start(single)
    sim().writeTag('HV-1', 'OP', 50); sim().writeTag('P-1', 'RUN', 1); advance(40)
    const held = { pos: sim().tags['HV-1']!.POS, q: flows()['a3'] }
    sim().writeTag('HV-1', 'STUCK', 1)
    sim().writeTag('HV-1', 'OP', 100); advance(40)
    expect(sim().tags['HV-1']!.OP).toBe(100)        // the command moved
    expect(sim().tags['HV-1']!.POS).toBe(held.pos)  // the valve did not
    expect(flows()['a3']).toBeCloseTo(held.q!, 6)   // ...and neither did the flow
  })
})

// ── N, O, P, Q, R. Topologies ───────────────────────────────────────────────

describe('N-R, §12 — one valve, two in series, two on a branch, and a pump', () => {
  it('N, R: one valve in series with a pump', () => {
    const f = settle(single, reg(), ['HV-1'])
    expect(f['a1']).toBeCloseTo(f['a3']!, 9)        // one path, one flow
  })

  it('O, P: two in series pass the same flow, and Cv does not change it', () => {
    const plain = settle(series, reg(), ['HV-1', 'HV-2'])
    expect(plain['a2']).toBeCloseTo(plain['a4']!, 5)   // the solver's tolerance
    const stated = settle(series, reg({
      'HV-1': { 'element.cv': '120', 'element.characteristic': 'Linear' },
      'HV-2': { 'element.cv': '12' },
    }), ['HV-1', 'HV-2'])
    expect(stated).toEqual(plain)
  })

  it('Q: a branch splits by RESISTANCE — and every valve has the same one', () => {
    /**
     * THE MOST TELLING MEASUREMENT IN THIS PHASE. Two legs whose records state
     * Cv 40 and Cv 200 — a five-to-one valve — split the flow exactly evenly,
     * because `VALVE_K` is one constant for both. That is not a defect; it is
     * the model saying precisely what it models, and precisely why wiring Cv
     * in would be a physics change rather than a convenience.
     */
    const plain = settle(branch, reg(), ['HV-1', 'HV-2'])
    expect(plain['u1']).toBeCloseTo(plain['d1']!, 9)          // an even split
    expect(plain['hdr']).toBeCloseTo(plain['u1']! + plain['d1']!, 6)

    const stated = settle(branch, reg({
      'HV-1': { 'element.cv': '40' },
      'HV-2': { 'element.cv': '200' },
    }), ['HV-1', 'HV-2'])
    expect(stated).toEqual(plain)                             // still even
    expect(stated['u1']).toBeCloseTo(stated['d1']!, 9)
  })

  it('Q: and the split DOES move when the thing the model reads moves', () => {
    // the control: the branch is not simply insensitive
    start(branch)
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('HV-2', 'OP', 30)
    sim().writeTag('P-1', 'RUN', 1); advance(60)
    const f = flows()
    expect(f['u1']!).toBeGreaterThan(f['d1']! * 2)
  })
})

// ── V. Fluid properties ─────────────────────────────────────────────────────

describe('V, §11 — the density a Cv conversion needs is not there', () => {
  it('V: the solver carries no fluid, and most services state no density', () => {
    /**
     * `ΔP = SG·(Q/Kv)²`. `SG` is in the equation; the solver's own header says
     * it solves one incompressible fluid at one density, and `sim/fluids.ts`
     * says the solver does not know a fluid exists and that wiring density in
     * is a physics change to be validated as one.
     */
    expect(hasProperties(undefined)).toBe(false)
    expect(hasProperties({ name: 'Water' } as never)).toBe(false)
    // a service with every property stated is the exception, not the rule
    expect(hasProperties({
      name: 'Water', densityKgM3: 1000, viscosityMPaS: 1, heatCapacityKJkgK: 4.18,
    } as never)).toBe(true)
  })

  it('V: and stating a fluid on the line changes no flow — K5’s rule, intact', () => {
    const plain = settle(single, reg(), ['HV-1'])
    const withService = settle(single, {
      ...reg(),
      'HV-1': { key: 'HV-1', kind: 'valve', fields: { 'general.service': 'Cooling water' } },
    }, ['HV-1'])
    expect(withService).toEqual(plain)
  })
})

// ── S, W. Determinism, and the K model unchanged ────────────────────────────

describe('S, W — deterministic, and no physics was touched', () => {
  it('S: the same plant and the same commands give the same flows', () => {
    const run = () => {
      start(branch)
      sim().writeTag('P-1', 'RUN', 1)
      const trace: string[] = []
      for (let i = 0; i < 120; i++) {
        if (i === 0) { sim().writeTag('HV-1', 'OP', 100); sim().writeTag('HV-2', 'OP', 100) }
        if (i === 40) sim().writeTag('HV-2', 'OP', 20)
        if (i === 80) sim().writeTag('HV-1', 'OP', 45)
        sim().tickOnce(1)
        trace.push(Object.values(flows()).map((v) => v.toFixed(9)).join(','))
      }
      return trace
    }
    const a = run()
    expect(run()).toEqual(a)
    /**
     * Eleven distinct states across 120 ticks: the plant settles between each
     * commanded change and then holds. That is what a determinism check wants
     * — a trace which genuinely moves, reproducing exactly.
     */
    expect(new Set(a).size).toBeGreaterThan(5)
  })

  it('W: the resistance constants are exactly what they were', () => {
    expect(VALVE_K).toBe(4e-4)
    expect(PIPE_K).toBe(4e-4)
    expect(SHUT_FRACTION).toBe(1e-3)
  })
})

// ── X-AD. Every phase before K28 ────────────────────────────────────────────

describe('X-AD — K21 through K27, unchanged by a hydraulic audit', () => {
  const loop: HmiScreen = {
    ...single,
    widgets: [
      ...single.widgets,
      { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
      { id: 'fic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
    ],
  }
  const vsdReg = (fic: Record<string, string> = {}): Registry => ({
    ...reg(),
    'P-1': { key: 'P-1', kind: 'equipment', fields: {
      'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
    ...(Object.keys(fic).length > 0
      ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: fic } } : {}),
  })

  it('X: K21 output-rate limiting', () => {
    start(loop, vsdReg({ 'signal.outputRateLimit': '10 %/s' }))
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0); sim().writeTag('FIC-1', 'OP', 40); advance(60)
    sim().writeTag('FIC-1', 'OP', 90); sim().tickOnce(1)
    expect(sim().tags['FIC-1']!.OPC).toBeCloseTo(50, 6)
  })

  it('Y: K22 — SAT is the controller’s own travel', () => {
    start(loop, vsdReg())
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 58); advance(400)
    expect(sim().loops['FIC-1']!.saturated).toBe(1)
  })

  it('Z: K23 setpoint limits', () => {
    start(loop, vsdReg({ 'signal.spHigh': '30' }))
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 50); advance(100)
    expect(sim().loops['FIC-1']!.spLimit!.limited).toBe(30)
  })

  it('AA, AB: K24/K25 — no cascade here, so no downstream state', () => {
    start(loop, vsdReg())
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 30); advance(200)
    expect(sim().loops['FIC-1']!.downstreamLimited).toBeUndefined()
  })

  it('AC: K26 — a valve position stays inside its travel', () => {
    start(single)
    sim().writeTag('HV-1', 'OP', 150); advance(20)
    expect(sim().tags['HV-1']!.OP).toBe(150)
    expect(sim().tags['HV-1']!.POS).toBe(100)
  })

  it('AD: K27 — the classification still holds for both fields', () => {
    for (const id of ['element.cv', 'element.characteristic']) {
      const f = EQUIPMENT_CAPABILITY.find((x) => x.id === id)!
      expect(f.cls).toBe('DECLARED')
      expect(f.absent).toBe('nothing changes')
    }
  })
})
