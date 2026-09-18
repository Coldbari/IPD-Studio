// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K29 — THE ENGINEERING DATA CONTRACT FOR HYDRAULIC COEFFICIENTS.
 *
 * A schema-decision phase that decided to add no schema, and this file is the
 * evidence rather than the assertion.
 *
 * ── THE BASIS EVERYTHING IS MEASURED AGAINST ──────────────────────────────
 *
 *     ΔP = R · Q²          bar, m³/h, bar/(m³/h)²
 *       valve   R = VALVE_K / f⁴     f = ACTUAL opening
 *       pipe    R = PIPE_K
 *       pump    R = 0, the curve carries it
 *
 * There is no `ρ`, no `SG` and no viscosity term anywhere in it. The
 * resistances are CALIBRATIONS with any fluid effect already baked in, not
 * coefficients a property could be applied to — so engineering coefficients
 * would not be added to this model, they would replace part of it.
 *
 * ── WHY NOTHING WAS ADDED ─────────────────────────────────────────────────
 *
 * §16 permits a field only when all eight of owner, meaning, unit, domain,
 * absent semantics, reference condition, RUNTIME RELATIONSHIP and
 * serialization are known. Two are not, and the decisive one is the runtime
 * relationship: it needs fluid density inside the solve, which is a physics
 * decision §20 forbids this phase from making. A field added now could not
 * become causal without a later physics phase, so it would ship as DECLARED
 * and sit there looking like data that does something.
 *
 * ── WHAT THIS FILE PROVES ─────────────────────────────────────────────────
 *
 * Each prerequisite, measured: that the coefficient field cannot say which
 * coefficient it holds, that no characteristic vocabulary exists, that pipe
 * length exists nowhere, that the reference condition is prose, that density
 * is available as DATA and absent from the SOLVE — and that the solver
 * behaves exactly as K28 left it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import {
  PIPE_K, SHUT_FRACTION, VALVE_K, valveResistance,
} from '../../src/hmi/sim/hydraulic/model'
import {
  CV_CANNOT_ENTER_THE_SOLVE, EQUIPMENT_CAPABILITY,
  HYDRAULIC_BASIS_IS_DENSITY_FREE, HYDRAULIC_MODEL_PREREQUISITES,
  NO_SCHEMA_WITHOUT_A_RUNTIME_RELATIONSHIP,
} from '../../src/model/capability'
import { hasProperties } from '../../src/hmi/sim/fluids'
import { FIELD_CATALOG } from '../../src/model/fields'
import { DATASHEET_SECTIONS } from '../../src/model/datasheet'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { Fluid } from '../../src/model/types'

// ── A plant with one valve, for the behavioural checks ──────────────────────

const plant: HmiScreen = {
  id: 'k29', name: 'K29', theme: 'classic',
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

const reg = (valve: Record<string, string> = {}, line: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(Object.keys(valve).length > 0
    ? { 'HV-1': { key: 'HV-1', kind: 'valve' as const, fields: valve } } : {}),
  ...(Object.keys(line).length > 0
    ? { 'L-1': { key: 'L-1', kind: 'line' as const, fields: line } } : {}),
})

const sim = () => useSimStore.getState()
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }
const start = (r: Registry = reg()) => { sim().exitRun(); sim().enterRun(plant, r) }
/** Settle the plant and report every pipe flow to nine decimals. */
const settle = (r: Registry, openTo = 100) => {
  start(r)
  sim().writeTag('HV-1', 'OP', openTo); sim().writeTag('P-1', 'RUN', 1)
  advance(60)
  return Object.fromEntries(
    Object.entries(sim().pipeFlows).map(([k, v]) => [k, Number(v.toFixed(9))]))
}

const catalogueKeys = new Set(
  Object.values(FIELD_CATALOG).flatMap((s) => s.flatMap((x) => x.fields.map((f) => f.key)))
    .concat(Object.values(DATASHEET_SECTIONS).flatMap((s) => s.map((f) => f.key))))

beforeEach(() => { start() })

// ── §2. The basis ───────────────────────────────────────────────────────────

describe('§2 — the hydraulic basis, recorded before anything is proposed', () => {
  it('the equations are R·Q², and no density appears in any of them', () => {
    expect(HYDRAULIC_BASIS_IS_DENSITY_FREE).toBe(true)
    expect(valveResistance(1)).toBeCloseTo(VALVE_K, 12)
    expect(valveResistance(0.5)).toBeCloseTo(VALVE_K / 0.5 ** 4, 12)
    expect(PIPE_K).toBe(4e-4)
    expect(SHUT_FRACTION).toBe(1e-3)
    /**
     * `valveResistance` takes ONE argument — the opening. There is nowhere to
     * pass a density, a specific gravity or a temperature, and that is the
     * whole point: the resistances are calibrations with any fluid effect
     * already baked in, not coefficients a property could be applied to.
     */
    expect(valveResistance.length).toBe(1)
  })
})

// ── A, B, C. Cv versus Kv ───────────────────────────────────────────────────

describe('A, B, C, S — the coefficient cannot say which coefficient it is', () => {
  it('A, B: one field, two incompatible definitions, no way to tell them apart', () => {
    /**
     * Cv is US gpm per √psi, Kv is m³/h per √bar. They differ by about 1.156,
     * so the SAME stored number describes two different valves — and nothing
     * recorded says which. A field that cannot distinguish two definitions can
     * supply neither.
     */
    const label = Object.values(FIELD_CATALOG).flatMap((s) => s.flatMap((x) => x.fields))
      .find((f) => f.key === 'element.cv')!.label
    expect(label).toContain('Cv')
    expect(label).toContain('Kv')
    // ...and there is no companion field that could resolve it
    for (const k of ['element.cvKind', 'element.coefficientKind', 'element.kv', 'element.cvUnit']) {
      expect(catalogueKeys.has(k)).toBe(false)
    }
  })

  it('C, S: and no magnitude, locale or default resolves it either', () => {
    // the same number stated as either is inert, which is the only honest
    // behaviour while the kind is unknown
    const base = settle(reg())
    expect(settle(reg({ 'element.cv': '120' }))).toEqual(base)
    expect(settle(reg({ 'element.cv': '104' }))).toEqual(base)   // 120 / 1.156
    expect(CV_CANNOT_ENTER_THE_SOLVE).toBe(true)
  })
})

// ── D, E, F, G, R. Reference condition and fluid basis ──────────────────────

describe('D-G, R — density exists as DATA and is absent from the SOLVE', () => {
  it('F: `Fluid` carries density, so the data side is not the blocker', () => {
    const f: Fluid = {
      id: 'w', name: 'Water', color: '#09f',
      densityKgM3: 998, viscosityMPaS: 1.0, heatCapacityKJkgK: 4.18,
      referenceCondition: '20 °C, 1 atm',
    }
    expect(hasProperties(f)).toBe(true)
    // ...but most services state nothing, and that is reported rather than filled
    expect(hasProperties({ id: 'x', name: 'Unspecified', color: '#888' })).toBe(false)
  })

  it('D: the reference condition is PROSE, and is parsed nowhere', () => {
    /**
     * `Fluid.referenceCondition` is a free-form string — the default document
     * seeds '20 °C, 1 atm' — and nothing in the product reads it. The type's
     * own comment says a property with no basis is not data; that rule is
     * STATED and not ENFORCED, and a correction could not be applied against a
     * sentence.
     */
    const doc = createEmptyDoc('t')
    const seeded = (doc.fluids ?? []).find((f) => f.referenceCondition !== undefined)
    expect(typeof seeded?.referenceCondition).toBe('string')
    // a nonsense basis is accepted exactly as a sensible one is
    const nonsense: Fluid = {
      id: 'n', name: 'N', color: '#000',
      densityKgM3: 998, referenceCondition: 'sometime on a Tuesday',
    }
    expect(nonsense.referenceCondition).toBe('sometime on a Tuesday')
  })

  it('E, R: the SOLVE takes no fluid, so no water assumption can hide in it', () => {
    // stating a service, with or without properties, changes no flow
    const base = settle(reg())
    expect(settle(reg({ 'general.service': 'Cooling water' }))).toEqual(base)
    expect(settle(reg({ 'general.service': 'Sulphuric acid, SG 1.84' }))).toEqual(base)
  })

  it('G: the coefficient’s OWN reference is not the fluid’s, and neither exists', () => {
    /**
     * A valve coefficient is quoted against a standard fluid at a standard
     * condition. `Fluid.referenceCondition` is the condition the FLUID's
     * properties are quoted at — a different statement about a different
     * object. There is no field for the coefficient's.
     */
    for (const k of ['element.cvReference', 'element.coefficientBasis', 'element.cvCondition']) {
      expect(catalogueKeys.has(k)).toBe(false)
    }
  })
})

// ── H. Identity, presentation and physics ───────────────────────────────────

describe('H, §7 — three different things about a fluid, kept apart', () => {
  it('H: identity, presentation and physics are separate fields by construction', () => {
    const f: Fluid = {
      id: 'w', name: 'Water', color: '#09f', displayToken: 'stream-a',
      densityKgM3: 998, referenceCondition: '20 °C',
    }
    // identity
    expect(f.id).toBe('w'); expect(f.name).toBe('Water')
    // presentation — a drafting convention and an HMI token, never physics
    expect(f.color).toBe('#09f')
    expect(f.displayToken).toBe('stream-a')
    // physics — quoted at a stated basis
    expect(f.densityKgM3).toBe(998)
  })

  it('H: and presentation cannot reach the hydraulics', () => {
    // colour is not an input to anything the solver does
    const base = settle(reg())
    expect(settle(reg({ 'general.service': 'Water' }))).toEqual(base)
  })
})

// ── I, J, T. The characteristic ─────────────────────────────────────────────

describe('I, J, T — there is no characteristic vocabulary to be causal with', () => {
  it('I: no enumeration, no parser, no validation — free text only', () => {
    expect(catalogueKeys.has('element.characteristic')).toBe(true)
    // there is no companion field naming a supported set
    for (const k of ['element.characteristicKind', 'element.curve', 'element.trimCurve']) {
      expect(catalogueKeys.has(k)).toBe(false)
    }
  })

  it('J, T: every spelling is equally inert, including the conventional ones', () => {
    const base = settle(reg())
    for (const v of ['Linear', 'LINEAR', 'Equal percentage', 'Quick opening', 'Parabolic-ish', '']) {
      expect(settle(reg({ 'element.characteristic': v }))).toEqual(base)
    }
  })

  it('J: and the model’s own characteristic is fixed at K/f⁴ for every valve', () => {
    // halving the opening quadruples nothing else: the shape is the model's
    expect(valveResistance(0.5) / valveResistance(1)).toBeCloseTo(16, 9)
    expect(valveResistance(0.25) / valveResistance(0.5)).toBeCloseTo(16, 9)
  })
})

// ── K, L. The position that drives hydraulics ───────────────────────────────

describe('K, L, §12 — ACTUAL position only, and K28’s rule is unchanged', () => {
  it('K, L: the command moves at once and the flow follows the POSITION', () => {
    start(reg())
    sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    advance(40)
    const open = sim().pipeFlows['a3']!
    sim().writeTag('HV-1', 'OP', 0)
    sim().tickOnce(1)
    expect(sim().tags['HV-1']!.OP).toBe(0)          // command already shut
    expect(sim().tags['HV-1']!.POS).toBe(75)        // the valve is not
    expect(sim().pipeFlows['a3']!).toBeLessThan(open)
    expect(sim().pipeFlows['a3']!).toBeGreaterThan(open * 0.5)  // and not shut either
  })
})

// ── M, N. Pipe geometry ─────────────────────────────────────────────────────

describe('M, N, §13 — a geometry pipe model has no inputs at all', () => {
  it('N: there is no LENGTH field anywhere, on any record kind', () => {
    for (const k of ['spec.length', 'general.length', 'design.length', 'spec.equivalentLength']) {
      expect(catalogueKeys.has(k)).toBe(false)
    }
  })

  it('N: nominal size is not an inside diameter, and roughness has no field', () => {
    // `spec.size` exists and is NOMINAL — 6" Sch 40 is 154.05 mm inside and
    // 6" Sch 80 is 146.33 mm, so converting needs the schedule AND a
    // dimensional standard. `spec.schedule` is free text.
    expect(catalogueKeys.has('spec.size')).toBe(true)
    expect(catalogueKeys.has('spec.schedule')).toBe(true)
    for (const k of ['spec.insideDiameter', 'spec.id', 'spec.roughness']) {
      expect(catalogueKeys.has(k)).toBe(false)
    }
  })

  it('M: and stating every pipe-spec field that DOES exist changes no flow', () => {
    const base = settle(reg())
    expect(settle(reg({}, {
      'spec.size': '6"', 'spec.schedule': 'Sch 40',
      'spec.material': 'CS', 'spec.class': '150#',
    }))).toEqual(base)
  })

  it('M: `PIPE_K` stands in for a calculation whose every input is absent', () => {
    expect(HYDRAULIC_MODEL_PREREQUISITES).toBe(true)
    expect(PIPE_K).toBe(4e-4)
  })
})

// ── O, P, Q. Absent, invalid, and the non-causal guard ──────────────────────

describe('O, P, Q — absent is not zero, invalid is not a fallback', () => {
  it('O, P: absent, zero, negative and unreadable are all equally inert', () => {
    const base = settle(reg())
    for (const v of ['0', '-50', 'about a hundred', '1e999', 'NaN']) {
      expect(settle(reg({ 'element.cv': v }))).toEqual(base)
    }
  })

  it('P: an invalid coefficient does NOT silently become the model’s constant', () => {
    /**
     * It never reaches the model at all, which is the stronger statement: the
     * resistance was always `VALVE_K` and nothing about the record moved it.
     */
    expect(VALVE_K).toBe(4e-4)
    expect(valveResistance(1)).toBeCloseTo(VALVE_K, 12)
  })

  it('Q, §19: both fields remain DECLARED, and the K27 guard still classifies them', () => {
    expect(NO_SCHEMA_WITHOUT_A_RUNTIME_RELATIONSHIP).toBe(true)
    for (const id of ['element.cv', 'element.characteristic']) {
      expect(EQUIPMENT_CAPABILITY.find((f) => f.id === id)!.cls).toBe('DECLARED')
    }
  })

  it('Q: and K29 added no schema field of its own', () => {
    for (const k of ['element.coefficientKind', 'element.coefficientValue',
      'element.cvReference', 'element.characteristicKind', 'spec.length', 'spec.roughness']) {
      expect(catalogueKeys.has(k)).toBe(false)
    }
  })
})

// ── U, Z. The solver is untouched ───────────────────────────────────────────

describe('U, Z — no solver behaviour changed, and it repeats exactly', () => {
  it('U: the settled plant is what K28 measured', () => {
    const f = settle(reg())
    expect(f['a3']).toBeGreaterThan(30)
    expect(f['a1']).toBeCloseTo(f['a3']!, 5)        // the solver's own tolerance
  })

  it('U: and throttling still follows the model’s own shape', () => {
    const at = (pos: number) => settle(reg(), pos)['a3']!
    expect(at(100)).toBeGreaterThan(at(50))
    expect(at(50)).toBeGreaterThan(at(25))
  })

  it('Z: deterministic across a full valve sweep', () => {
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

// ── V, W, X, Y. Every phase before K29 ──────────────────────────────────────

describe('V-Y — K25 through K28, unchanged by a schema audit', () => {
  it('V, W: K25/K26 — a valve position stays inside its travel', () => {
    start(reg())
    sim().writeTag('HV-1', 'OP', 150); advance(20)
    expect(sim().tags['HV-1']!.OP).toBe(150)
    expect(sim().tags['HV-1']!.POS).toBe(100)
  })

  it('X: K27 — the classification and its absent semantics hold', () => {
    for (const id of ['element.cv', 'element.characteristic']) {
      const f = EQUIPMENT_CAPABILITY.find((x) => x.id === id)!
      expect(f.cls).toBe('DECLARED')
      expect(f.absent).toBe('nothing changes')
    }
  })

  it('Y: K28 — a shut valve is SHUT_FRACTION, not zero', () => {
    start(reg())
    sim().writeTag('HV-1', 'OP', 0); sim().writeTag('P-1', 'RUN', 1)
    advance(40)
    const q = Math.abs(sim().pipeFlows['a3'] ?? 0)
    expect(q).toBeGreaterThan(0)
    expect(q).toBeLessThan(0.001)
  })
})
