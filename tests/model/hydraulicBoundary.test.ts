// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K30 — THE HYDRAULIC PHYSICS BOUNDARY, DECIDED AND PINNED.
 *
 * ── THE DECISION ──────────────────────────────────────────────────────────
 *
 * THE HYDRAULIC MODEL IS FLUID-INDEPENDENT. It does not consume
 * `Fluid.densityKgM3` and is not intended to. Every resistance is a CALIBRATED
 * SIMULATOR COEFFICIENT with any fluid effect already baked in — not an
 * engineering pipe or valve coefficient, and never to be described as one.
 *
 * The product therefore claims TRAINING AND DEMONSTRATION PROCESS SIMULATION:
 * a plant that responds causally, in the right direction, with the right
 * shapes. Not an engineering hydraulic calculation, and not a prediction of a
 * particular manufacturer's equipment.
 *
 * ── THE ONE PLACE A DENSITY ALREADY SITS ──────────────────────────────────
 *
 * `duty.head` is stated in METRES, as a pump curve is written, and converts at
 * 1 bar = 10.197 m — which is WATER. Measured below: a machine stated at 35 m
 * delivers 3.432 bar for every fluid, against 6.315 bar on sulphuric acid
 * (+84 %) and 2.540 bar on petrol (−26 %).
 *
 * It is RECORDED as an assumption rather than corrected. Correcting only that
 * would make the model partly fluid-aware, which is the state `sim/fluids.ts`
 * warns about by name: a half-applied correction is worse than none, because
 * the numbers still look right.
 *
 * ── SO NOTHING CHANGED, AND THIS FILE PROVES IT ───────────────────────────
 *
 * A decision phase that alters no equation still has to demonstrate that it
 * altered no equation.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import {
  PIPE_K, SHUT_FRACTION, VALVE_K, valveResistance,
} from '../../src/hmi/sim/hydraulic/model'
import {
  RUNOUT_FACTOR, pumpHead, shutoffFromDuty, vesselHeadBar,
} from '../../src/hmi/sim/hydraulic/solver'
import {
  EQUIPMENT_CAPABILITY, HYDRAULICS_ARE_FLUID_INDEPENDENT,
  HYDRAULIC_BOUNDARY_IS_DECLARED,
} from '../../src/model/capability'
import { ATMOSPHERIC_BAR, operatingPressure, processFor } from '../../src/model/processData'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── One valve, one pump, two boundaries ─────────────────────────────────────

const plant: HmiScreen = {
  id: 'k30', name: 'K30', theme: 'classic',
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

const reg = (valve: Record<string, string> = {}, pumpExtra: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', ...pumpExtra } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(Object.keys(valve).length > 0
    ? { 'HV-1': { key: 'HV-1', kind: 'valve' as const, fields: valve } } : {}),
})

const sim = () => useSimStore.getState()
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }
const start = (r: Registry = reg()) => { sim().exitRun(); sim().enterRun(plant, r) }
const settle = (r: Registry, openTo = 100) => {
  start(r)
  sim().writeTag('HV-1', 'OP', openTo); sim().writeTag('P-1', 'RUN', 1)
  advance(60)
  return Object.fromEntries(
    Object.entries(sim().pipeFlows).map(([k, v]) => [k, Number(v.toFixed(9))]))
}

beforeEach(() => { start() })

// ── The decision itself ─────────────────────────────────────────────────────

describe('§4, §2 — the decision, and the claim it supports', () => {
  it('the boundary is declared, not merely implied', () => {
    expect(HYDRAULICS_ARE_FLUID_INDEPENDENT).toBe(true)
    expect(HYDRAULIC_BOUNDARY_IS_DECLARED).toBe(true)
  })

  it('§16: the metres→bar water basis is now recorded as an ASSUMPTION', () => {
    const f = EQUIPMENT_CAPABILITY.find((x) => x.id === 'HEAD metres → bar')!
    expect(f.cls).toBe('ASSUMPTION')
    expect(f.meaning).toContain('WATER')
    expect(f.absent).toBeNull()                    // an assumption has no absent state
  })

  it('§4: and the assumption it records is real, and this is its size', () => {
    /**
     * `duty.head` in metres is a pump datasheet's own unit. Converting at
     * 10.197 m per bar is water; the real pressure scales with density.
     */
    const headBar = processFor(reg(), 'P-1').headBar!
    expect(headBar).toBeCloseTo(35 / 10.197, 9)    // ~3.432 bar, for every fluid
    const g = 9.80665
    expect(35 * 1840 * g / 1e5).toBeCloseTo(6.315, 2)   // sulphuric acid, +84 %
    expect(35 * 740 * g / 1e5).toBeCloseTo(2.540, 2)    // petrol, −26 %
  })

  it('§4: stating the head in BAR bypasses the conversion entirely', () => {
    expect(processFor(reg({}, { 'duty.head': '3.432 bar' }), 'P-1').headBar)
      .toBeCloseTo(3.432, 9)
  })
})

// ── A, B, C, D. The equations, unchanged ────────────────────────────────────

describe('A-D — every resistance is exactly what it was', () => {
  it('A, B: the valve equation and its constant', () => {
    expect(VALVE_K).toBe(4e-4)
    expect(SHUT_FRACTION).toBe(1e-3)
    expect(valveResistance(1)).toBeCloseTo(VALVE_K, 12)
    expect(valveResistance(0.5)).toBeCloseTo(VALVE_K / 0.5 ** 4, 12)
    expect(valveResistance(0)).toBeCloseTo(VALVE_K / SHUT_FRACTION ** 4, 4)
    // and it still takes ONE argument: there is nowhere to pass a fluid
    expect(valveResistance.length).toBe(1)
  })

  it('C, D: the pipe and fitting constants', () => {
    expect(PIPE_K).toBe(4e-4)
    // a fitting is a tenth of a pipe run, by construction
    expect(PIPE_K / 10).toBeCloseTo(4e-5, 12)
  })
})

// ── E. The pump curve ───────────────────────────────────────────────────────

describe('E, §10 — the pump curve: two engineering inputs, one assumed shape', () => {
  it('E: the curve is unchanged, and takes no density', () => {
    expect(RUNOUT_FACTOR).toBe(1.5)
    // head at rated flow is what a datasheet states; shutoff follows from it
    const shutoff = shutoffFromDuty(3.432)
    expect(shutoff).toBeCloseTo(3.432 / (1 - 1 / 1.5 ** 2), 9)
    // at the rated flow the machine makes its stated head
    expect(pumpHead(3.432, 40, 1, 40)).toBeCloseTo(3.432, 6)
    // at no flow it makes shutoff, and beyond runout it resists
    expect(pumpHead(3.432, 40, 1, 0)).toBeCloseTo(shutoff, 9)
    expect(pumpHead(3.432, 40, 1, 40 * 1.5 * 1.2)).toBeLessThan(0)
    // four arguments, none of them a fluid property
    expect(pumpHead.length).toBe(4)
  })

  it('§10: the affinity scaling is the model’s own — head as speed²', () => {
    const full = pumpHead(3.432, 40, 1, 0)
    const half = pumpHead(3.432, 40, 0.5, 0)
    expect(half).toBeCloseTo(full * 0.25, 9)
    expect(pumpHead(3.432, 40, 0, 10)).toBe(0)        // stopped makes no head
  })

  it('§10: it is a HYBRID — engineering inputs, an assumed shape', () => {
    // the two inputs are ENGINEERING and classified as such
    for (const id of ['duty.head', 'duty.capacity']) {
      expect(EQUIPMENT_CAPABILITY.find((f) => f.id === id)!.cls).toBe('ENGINEERING')
    }
    // ...and RUNOUT_FACTOR is nobody's datasheet figure
    expect(RUNOUT_FACTOR).toBe(1.5)
  })
})

// ── F, G, H, I, J, K. Nothing about a fluid or a record reaches the solve ───

describe('F-K — identity, colour, density, Cv, characteristic, geometry: all inert', () => {
  const base = settle(reg())

  it('F, G: a stated service changes no flow, whatever it is', () => {
    for (const v of ['Cooling water', 'Sulphuric acid', 'Petrol']) {
      expect(settle(reg({ 'general.service': v }))).toEqual(base)
    }
  })

  it('H: and no density reaches the hydraulics from any record', () => {
    // there is no density field on a valve or a line to begin with, and the
    // solve takes none: the resistances are calibrations, not coefficients
    expect(valveResistance.length).toBe(1)
    expect(settle(reg({ 'process.density': '1840 kg/m³' }))).toEqual(base)
  })

  it('I, J: Cv and characteristic remain inert, as K28/K29 established', () => {
    expect(settle(reg({ 'element.cv': '120' }))).toEqual(base)
    expect(settle(reg({ 'element.characteristic': 'Equal percentage' }))).toEqual(base)
  })

  it('K: and pipe-spec geometry likewise', () => {
    expect(settle(reg({ 'element.size': '6"' }))).toEqual(base)
  })
})

// ── L. The physical position ────────────────────────────────────────────────

describe('L — the ACTUAL position is still the hydraulic one', () => {
  it('L: the command shuts at once and the flow follows the position', () => {
    start(reg())
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    advance(40)
    const open = sim().pipeFlows['a3']!
    sim().writeTag('HV-1', 'OP', 0)
    sim().tickOnce(1)
    expect(sim().tags['HV-1']!.OP).toBe(0)
    expect(sim().tags['HV-1']!.POS).toBe(75)
    expect(sim().pipeFlows['a3']!).toBeLessThan(open)
    expect(sim().pipeFlows['a3']!).toBeGreaterThan(open * 0.5)
  })
})

// ── §14. The pressure basis ─────────────────────────────────────────────────

describe('§14 — one pressure basis, and no second convention', () => {
  it('a record is GAUGE unless its unit says otherwise', () => {
    expect(ATMOSPHERIC_BAR).toBe(1)
    expect(operatingPressure('1 barg')).toBeCloseTo(2, 9)      // gauge → absolute
    expect(operatingPressure('2 bara')).toBeCloseTo(2, 9)      // already absolute
    expect(operatingPressure('1 atm')).toBeCloseTo(1.01325, 9)
    expect(operatingPressure('100 kpa')).toBeCloseTo(1, 9)
    // a bare `bar` is read as gauge, which is how a datasheet writes one
    expect(operatingPressure('1 bar')).toBeCloseTo(2, 9)
  })

  it('and a vessel’s static head is the only elevation the model has', () => {
    expect(vesselHeadBar(0)).toBe(0)
    expect(vesselHeadBar(100)).toBeGreaterThan(0)
    expect(vesselHeadBar(50)).toBeCloseTo(vesselHeadBar(100) / 2, 9)
  })
})

// ── M-Q. Every phase before K30 ─────────────────────────────────────────────

describe('M-Q — K25 through K29, unchanged by a decision', () => {
  it('M, N: K25/K26 — a valve position stays inside its travel', () => {
    start(reg())
    sim().writeTag('HV-1', 'OP', 150); advance(20)
    expect(sim().tags['HV-1']!.OP).toBe(150)
    expect(sim().tags['HV-1']!.POS).toBe(100)
  })

  it('N: K26 — an invalid turndown is refused, not clamped', () => {
    expect(processFor(reg({}, { 'duty.minSpeed': '150 %' }), 'P-1').minSpeedPct)
      .toBeUndefined()
    expect(processFor(reg({}, { 'duty.minSpeed': '20 %' }), 'P-1').minSpeedPct).toBe(20)
  })

  it('O, P, Q: K27/K28/K29 — the classification guards still hold', () => {
    for (const id of ['element.cv', 'element.characteristic', 'duty.speed']) {
      expect(EQUIPMENT_CAPABILITY.find((f) => f.id === id)!.cls).toBe('DECLARED')
    }
    for (const id of ['VALVE_K', 'PIPE_K', 'RAMP_S', 'HEAD metres → bar']) {
      expect(EQUIPMENT_CAPABILITY.find((f) => f.id === id)!.cls).toBe('ASSUMPTION')
    }
  })
})

// ── R. Determinism ──────────────────────────────────────────────────────────

describe('R — deterministic, as it always was', () => {
  it('R: the same plant and commands give the same flows, twice', () => {
    const run = () => {
      start(reg())
      sim().writeTag('P-1', 'RUN', 1)
      const trace: string[] = []
      for (let i = 0; i < 120; i++) {
        if (i === 0) sim().writeTag('HV-1', 'OP', 100)
        if (i === 40) sim().writeTag('HV-1', 'OP', 35)
        if (i === 80) sim().writeTag('HV-1', 'OP', 0)
        sim().tickOnce(1)
        trace.push((sim().pipeFlows['a3'] ?? 0).toFixed(9))
      }
      return trace
    }
    const a = run()
    expect(run()).toEqual(a)
    expect(new Set(a).size).toBeGreaterThan(5)
  })
})
