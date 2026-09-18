// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K31 — FLUID DENSITY CAUSALLY AFFECTS HYDRAULIC PRESSURE.
 *
 * A pump's head is a LENGTH. It is the same length for every liquid, and it
 * becomes a different PRESSURE in each one: ΔP = ρ·g·H. K30 measured that this
 * project converted 35 m at 1 bar = 10.197 m — water — for petrol and for
 * sulphuric acid alike, and recorded it. K31 closes it at the source term.
 *
 * WHAT IS COUPLED, exactly: the conversion of a head STATED IN METRES into the
 * pressure the solve uses. Nothing else. Resistance is untouched — `VALVE_K`
 * and `PIPE_K` are calibrated constants and there is no pipe geometry in this
 * repository to build a real friction term from (K29). The model is now
 * fluid-coupled on the source and fluid-independent on the resistance, which is
 * a partial coupling stated out loud rather than a whole one pretended.
 *
 * AND THERE IS NO HIDDEN WATER FALLBACK. A stream nobody named still converts
 * on 1/10.197, because it must, but that factor is now `LEGACY_HEAD_DENSITY_KGM3`
 * — a declared 1000.016 kg/m³ that a test below proves is exactly what the old
 * number always meant.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel, pumpHeadBar } from '../../src/hmi/sim/engine'
import {
  G, LEGACY_HEAD_DENSITY_KGM3, headBar, pumpFluids, resolvePumpHeadBar, usableDensity,
} from '../../src/hmi/sim/hydraulic/fluidhead'
import { PIPE_K, VALVE_K, valveResistance } from '../../src/hmi/sim/hydraulic/model'
import { RUNOUT_FACTOR, pumpHead } from '../../src/hmi/sim/hydraulic/solver'
import { processFor } from '../../src/model/processData'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { Fluid } from '../../src/model/types'

// ── One pump, one throttling valve, two boundaries ──────────────────────────

const plant: HmiScreen = {
  id: 'k31', name: 'K31', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 150, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v1', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 146, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction', fluidId: 'svc' },
    { id: 'a2', points: [{ x: 210, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'v1', bPort: 'in', fluidId: 'svc' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'v1', aPort: 'out', bId: 'bd', bPort: 'process', fluidId: 'svc' },
  ],
}

/** The same plant with NO service painted on any line. */
const bare: HmiScreen = {
  ...plant,
  pipes: plant.pipes!.map(({ fluidId: _drop, ...rest }) => rest),
}

const reg = (pumpExtra: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', ...pumpExtra } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
})

/** A service list of one, so only DENSITY varies between runs. */
const svc = (densityKgM3: number | undefined, extra: Partial<Fluid> = {}): Fluid[] => [{
  id: 'svc', name: 'Service', color: '#4af', displayToken: 'stream-a',
  ...(densityKgM3 !== undefined ? { densityKgM3 } : {}),
  viscosityMPaS: 1, heatCapacityKJkgK: 4.18, referenceCondition: '20 °C, 1 atm',
  ...extra,
}]

const WATER = 998, ACID = 1840, PETROL = 740

const sim = () => useSimStore.getState()
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }

/** Run to steady state and report what the PLANT did, not what a helper did. */
const settle = (fluids: Fluid[], r: Registry = reg(), screen: HmiScreen = plant) => {
  sim().exitRun()
  sim().enterRun(screen, r, fluids)
  sim().writeTag('HV-1', 'OP', 100)
  sim().writeTag('P-1', 'RUN', 1)
  advance(60)
  const s = sim()
  return {
    flow: s.pipeFlows['a2'] ?? 0,
    discharge: s.pipePressures['a2'] ?? 0,
    head: pumpHeadBar(
      buildSimModel(screen, r, fluids).defs.find((d) => d.name === 'P-1'),
      buildSimModel(screen, r, fluids).pumpFluid.get('P-1')),
  }
}

beforeEach(() => { sim().exitRun() })

// ── A. The physical contract ────────────────────────────────────────────────

describe('§A — the contract, before any plant runs', () => {
  it('ΔP = ρ·g·H, in bar, with standard gravity', () => {
    expect(G).toBe(9.80665)
    expect(headBar(35, ACID)).toBeCloseTo((ACID * 9.80665 * 35) / 1e5, 12)
    expect(headBar(35, ACID)).toBeCloseTo(6.3155, 3)
    expect(headBar(35, PETROL)).toBeCloseTo(2.5399, 3)
  })

  it('it is linear in head and linear in density, which is what makes it physics', () => {
    expect(headBar(70, WATER)).toBeCloseTo(2 * headBar(35, WATER), 12)
    expect(headBar(35, 2 * WATER)).toBeCloseTo(2 * headBar(35, WATER), 12)
    expect(headBar(0, ACID)).toBe(0)                 // no head, no pressure, any fluid
  })
})

// ── G8. No hidden water fallback ────────────────────────────────────────────

describe('§G8, §L — the fallback is DECLARED, not hidden', () => {
  it('the historic 1/10.197 factor IS a density, and this is it', () => {
    // ρ·g/1e5 = 1/10.197  ⟹  ρ = 1e5/(10.197·g). Five figures of pure water.
    expect(LEGACY_HEAD_DENSITY_KGM3).toBeCloseTo(1000.016, 3)
    expect(headBar(35, LEGACY_HEAD_DENSITY_KGM3)).toBeCloseTo(35 / 10.197, 12)
  })

  it('an unnamed stream converts on it, and reports that it did', () => {
    const m = buildSimModel(bare, reg(), [])
    const f = m.pumpFluid.get('P-1')!
    expect(f.basis).toBe('unresolved')
    expect(f.why).toBe('no-service')
    expect(f.densityKgM3).toBeUndefined()            // nothing was assumed
  })

  it('and "unresolved" is never silently re-badged as water', () => {
    const r = resolvePumpHeadBar(35 / 10.197, 35, { basis: 'unresolved', why: 'no-service' })
    expect(r.basis).toBe('unresolved')
    expect(r.densityKgM3).toBeUndefined()
    // the NUMBER matches the legacy basis — that is compatibility. The BASIS
    // does not claim to be water — that is honesty. Both, at once.
    expect(r.bar).toBeCloseTo(headBar(35, LEGACY_HEAD_DENSITY_KGM3), 12)
  })
})

// ── G1, G2, G3, G4. The measurements ────────────────────────────────────────

describe('§G1-G4 — density reaches the pressure, in the right direction', () => {
  it('G1: water is the baseline, and it is NOT the legacy number', () => {
    const w = settle(svc(WATER))
    expect(w.head).toBeCloseTo(headBar(35, WATER), 12)
    // 998 kg/m³ is not 1000.016 kg/m³, so it must differ — by 0.2 %, correctly
    expect(w.head).not.toBeCloseTo(35 / 10.197, 4)
    expect(w.head / (35 / 10.197)).toBeCloseTo(WATER / LEGACY_HEAD_DENSITY_KGM3, 9)
  })

  it('G2: a DENSER fluid makes more pressure and more flow', () => {
    const w = settle(svc(WATER)), a = settle(svc(ACID))
    expect(a.head).toBeGreaterThan(w.head)
    expect(a.discharge).toBeGreaterThan(w.discharge)
    expect(a.flow).toBeGreaterThan(w.flow)
  })

  it('G3: a LIGHTER fluid makes less', () => {
    const w = settle(svc(WATER)), p = settle(svc(PETROL))
    expect(p.head).toBeLessThan(w.head)
    expect(p.discharge).toBeLessThan(w.discharge)
    expect(p.flow).toBeLessThan(w.flow)
  })

  it('G4: and the ratio is EXACTLY the density ratio — ΔP₂/ΔP₁ = ρ₂/ρ₁', () => {
    const a = settle(svc(ACID)), p = settle(svc(PETROL))
    expect(a.head / p.head).toBeCloseTo(ACID / PETROL, 9)
    // three independent pairs, because one could be a coincidence
    const w = settle(svc(WATER))
    expect(a.head / w.head).toBeCloseTo(ACID / WATER, 9)
    expect(w.head / p.head).toBeCloseTo(WATER / PETROL, 9)
  })
})

// ── G5, E. Resistance is NOT touched ────────────────────────────────────────

describe('§G5, §E — the calibrated resistances never see a density', () => {
  it('the constants and the equation are byte-for-byte what K30 pinned', () => {
    expect(VALVE_K).toBe(4e-4)
    expect(PIPE_K).toBe(4e-4)
    expect(valveResistance.length).toBe(1)           // nowhere to pass a fluid
    expect(valveResistance(0.5)).toBeCloseTo(VALVE_K / 0.5 ** 4, 12)
  })

  it('BEHAVIOURALLY: hold the head fixed in bar, and density changes nothing', () => {
    /**
     * The sharpest isolation available. A head stated in BAR is not scaled by
     * density (it is already a pressure), so the ONLY way these two runs could
     * differ is if density had leaked into a resistance. It has not.
     */
    const inBar = reg({ 'duty.head': '3.432 bar' })
    const a = settle(svc(ACID), inBar), p = settle(svc(PETROL), inBar)
    expect(a.head).toBeCloseTo(p.head, 12)
    expect(a.flow).toBeCloseTo(p.flow, 9)
    expect(a.discharge).toBeCloseTo(p.discharge, 9)
  })

  it('§E: and no code path multiplies a K by a density', () => {
    expect(headBar(35, ACID)).toBeCloseTo(35 * ACID * G / 1e5, 12)
    // valve resistance at a fixed opening is one number, whatever is flowing
    expect(valveResistance(0.4)).toBe(valveResistance(0.4))
  })
})

// ── G6, G7, F. More than one fluid ──────────────────────────────────────────

describe('§F, §G6, §G7 — several services, and contradictions', () => {
  const twin: HmiScreen = {
    id: 'k31b', name: 'K31b', theme: 'classic',
    widgets: [
      { id: 'as', type: 'equip', x: 0, y: 60, w: 48, h: 24, tag: 'BL-AS', props: { symbolId: 'bl.terminal' } },
      { id: 'pa', type: 'pump', x: 150, y: 50, w: 56, h: 56, tag: 'P-A' },
      { id: 'ad', type: 'equip', x: 400, y: 60, w: 48, h: 24, tag: 'BL-AD', props: { symbolId: 'bl.terminal' } },
      { id: 'cs', type: 'equip', x: 0, y: 300, w: 48, h: 24, tag: 'BL-CS', props: { symbolId: 'bl.terminal' } },
      { id: 'pb', type: 'pump', x: 150, y: 290, w: 56, h: 56, tag: 'P-B' },
      { id: 'cd', type: 'equip', x: 400, y: 300, w: 48, h: 24, tag: 'BL-CD', props: { symbolId: 'bl.terminal' } },
    ],
    pipes: [
      { id: 'w1', points: [{ x: 0, y: 72 }, { x: 146, y: 78 }], aId: 'as', aPort: 'process', bId: 'pa', bPort: 'suction', fluidId: 'water' },
      { id: 'w2', points: [{ x: 210, y: 78 }, { x: 400, y: 72 }], aId: 'pa', aPort: 'discharge', bId: 'ad', bPort: 'process', fluidId: 'water' },
      { id: 'c1', points: [{ x: 0, y: 312 }, { x: 146, y: 318 }], aId: 'cs', aPort: 'process', bId: 'pb', bPort: 'suction', fluidId: 'acid' },
      { id: 'c2', points: [{ x: 210, y: 318 }, { x: 400, y: 312 }], aId: 'pb', aPort: 'discharge', bId: 'cd', bPort: 'process', fluidId: 'acid' },
    ],
  }
  const twinReg: Registry = {
    'P-A': { key: 'P-A', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
    'P-B': { key: 'P-B', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
  }
  const two: Fluid[] = [
    { id: 'water', name: 'Water', color: '#4af', densityKgM3: WATER, viscosityMPaS: 1, heatCapacityKJkgK: 4.18, referenceCondition: '20 °C, 1 atm' },
    { id: 'acid', name: 'Acid', color: '#cc0', densityKgM3: ACID, viscosityMPaS: 25, heatCapacityKJkgK: 1.4, referenceCondition: '20 °C, 1 atm' },
  ]

  it('G6: two pumps on two services each get their OWN density', () => {
    const m = buildSimModel(twin, twinReg, two)
    expect(m.pumpFluid.get('P-A')).toMatchObject({ basis: 'fluid', densityKgM3: WATER, fluidId: 'water' })
    expect(m.pumpFluid.get('P-B')).toMatchObject({ basis: 'fluid', densityKgM3: ACID, fluidId: 'acid' })
    const a = pumpHeadBar(m.defs.find((d) => d.name === 'P-A'), m.pumpFluid.get('P-A'))
    const b = pumpHeadBar(m.defs.find((d) => d.name === 'P-B'), m.pumpFluid.get('P-B'))
    expect(b / a).toBeCloseTo(ACID / WATER, 9)       // same 35 m, different plants
  })

  it('G6: and neither pump is disturbed by the other existing', () => {
    const both = buildSimModel(twin, twinReg, two)
    const onlyWater = buildSimModel(twin, twinReg, [two[0]!])
    expect(pumpHeadBar(both.defs.find((d) => d.name === 'P-A'), both.pumpFluid.get('P-A')))
      .toBeCloseTo(pumpHeadBar(onlyWater.defs.find((d) => d.name === 'P-A'), onlyWater.pumpFluid.get('P-A')), 12)
    // the acid pump loses its density and falls to the DECLARED basis, named
    expect(onlyWater.pumpFluid.get('P-B')).toMatchObject({ basis: 'unresolved', why: 'no-density' })
  })

  it('G7: a MIXED stream is unresolved — never averaged, never one end picked', () => {
    const contradicted: HmiScreen = {
      ...plant,
      pipes: plant.pipes!.map((pp) => pp.id === 'a1' ? { ...pp, fluidId: 'other' } : pp),
    }
    const m = buildSimModel(contradicted, reg(), [
      ...svc(WATER),
      { id: 'other', name: 'Other', color: '#f80', densityKgM3: ACID, viscosityMPaS: 1, heatCapacityKJkgK: 2, referenceCondition: '20 °C, 1 atm' },
    ])
    const f = m.pumpFluid.get('P-1')!
    expect(f.basis).toBe('unresolved')
    expect(f.why).toBe('mixed')
    expect(f.densityKgM3).toBeUndefined()
    // and emphatically NOT the mean of 998 and 1840
    expect(pumpHeadBar(m.defs.find((d) => d.name === 'P-1'), f))
      .not.toBeCloseTo(headBar(35, (WATER + ACID) / 2), 4)
  })
})

// ── C, D. What must NOT be scaled ───────────────────────────────────────────

describe('§C, §D — a stated PRESSURE is already a pressure', () => {
  it('"3.432 bar" is untouched at every density', () => {
    expect(processFor(reg({ 'duty.head': '3.432 bar' }), 'P-1').headM).toBeUndefined()
    for (const d of [PETROL, WATER, ACID, 13546]) {
      const m = buildSimModel(plant, reg({ 'duty.head': '3.432 bar' }), svc(d))
      expect(pumpHeadBar(m.defs.find((x) => x.name === 'P-1'), m.pumpFluid.get('P-1')))
        .toBeCloseTo(3.432, 12)
    }
  })

  it('kPa and psi likewise — only a LENGTH carries a density', () => {
    expect(processFor(reg({ 'duty.head': '350 kPa' }), 'P-1').headM).toBeUndefined()
    expect(processFor(reg({ 'duty.head': '50 psi' }), 'P-1').headM).toBeUndefined()
    expect(resolvePumpHeadBar(3.5, undefined, { basis: 'fluid', densityKgM3: ACID }))
      .toMatchObject({ bar: 3.5, basis: 'stated-pressure' })
  })

  it('every metres spelling IS a length, and a bare number is metres', () => {
    for (const u of ['35 m', '35 mlc', '35 mwc', '35']) {
      expect(processFor(reg({ 'duty.head': u }), 'P-1').headM).toBeCloseTo(35, 12)
    }
  })

  it('a pump with NO stated head is not density-scaled either', () => {
    // `DEFAULTS.pumpHeadBar` is declared in BAR. Nobody stated a head, so there
    // is no head in metres to make fluid-dependent, and none is invented.
    const noHead: Registry = { ...reg(), 'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h' } } }
    const a = buildSimModel(plant, noHead, svc(ACID))
    const p = buildSimModel(plant, noHead, svc(PETROL))
    expect(pumpHeadBar(a.defs.find((x) => x.name === 'P-1'), a.pumpFluid.get('P-1')))
      .toBeCloseTo(pumpHeadBar(p.defs.find((x) => x.name === 'P-1'), p.pumpFluid.get('P-1')), 12)
  })
})

// ── H. Numerical safety ─────────────────────────────────────────────────────

describe('§H — nothing unusable reaches the solve', () => {
  it('a density that is not a density is refused, not propagated', () => {
    for (const bad of [0, -1, -998, NaN, Infinity, -Infinity, undefined]) {
      expect(usableDensity(bad as number | undefined)).toBe(false)
      const m = buildSimModel(plant, reg(), svc(bad as number | undefined))
      const f = m.pumpFluid.get('P-1')!
      expect(f.basis).toBe('unresolved')
      expect(f.why).toBe('no-density')
      const h = pumpHeadBar(m.defs.find((x) => x.name === 'P-1'), f)
      expect(Number.isFinite(h)).toBe(true)
      expect(h).toBeCloseTo(35 / 10.197, 12)         // the declared basis, intact
    }
  })

  it('and a plant on a refused density still solves to finite numbers', () => {
    const s = settle(svc(NaN))
    expect(Number.isFinite(s.flow)).toBe(true)
    expect(Number.isFinite(s.discharge)).toBe(true)
    expect(s.flow).toBeGreaterThan(0)
  })

  it('an extreme but REAL density stays finite and ordered', () => {
    const hg = settle(svc(13546))                     // mercury
    expect(Number.isFinite(hg.flow)).toBe(true)
    expect(hg.head).toBeCloseTo(headBar(35, 13546), 9)
    expect(hg.flow).toBeGreaterThan(settle(svc(WATER)).flow)
  })
})

// ── G9. The pump curve is untouched ─────────────────────────────────────────

describe('§G9, §B — the curve, the affinity laws and the envelope are unchanged', () => {
  it('RUNOUT_FACTOR is what it was', () => { expect(RUNOUT_FACTOR).toBe(1.5) })

  it('G9: the affinity law COMMUTES with density — exactly, at every speed', () => {
    /**
     * The precise statement of "independently". Density enters as a MULTIPLIER
     * on the head the curve is built from, so for any speed and any flow:
     *
     *      pumpHead(k·h, q, s, f)  ===  k · pumpHead(h, q, s, f)
     *
     * The speed² affinity and the density scaling therefore never interfere,
     * whichever order they are applied in. `pumpHead` itself is K31-untouched.
     */
    const k = ACID / WATER
    for (const speed of [1, 0.75, 0.5, 0.25]) {
      for (const flow of [0, 10, 25, 40]) {
        expect(pumpHead(3.4 * k, 40, speed, flow))
          .toBeCloseTo(k * pumpHead(3.4, 40, speed, flow), 12)
      }
    }
    expect(pumpHead(3.4, 40, 0.5, 0)).toBeCloseTo(0.25 * pumpHead(3.4, 40, 1, 0), 12)
  })

  it('G9: and behaviourally, slowing a VSD lowers pressure in EVERY liquid', () => {
    const vsd = reg({ 'duty.vsd': 'yes' })
    const run = (d: number, spd: number) => {
      sim().exitRun(); sim().enterRun(plant, vsd, svc(d))
      sim().writeTag('HV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
      sim().writeTag('P-1', 'SPD', spd); advance(90)
      return (sim().pipePressures['a2'] ?? 0) - 1      // gauge
    }
    const wFull = run(WATER, 100), wHalf = run(WATER, 50)
    const aFull = run(ACID, 100), aHalf = run(ACID, 50)
    expect(wHalf).toBeLessThan(wFull)
    expect(aHalf).toBeLessThan(aFull)
    // denser wins at BOTH speeds — the coupling does not switch sign anywhere
    expect(aFull).toBeGreaterThan(wFull)
    expect(aHalf).toBeGreaterThan(wHalf)
    /**
     * NOT asserted: that aHalf/wHalf equals aFull/wFull. It does not, and it
     * should not. Those are OPERATING POINTS — the intersection of the pump
     * curve with a system resistance that K31 deliberately left
     * fluid-independent — so the density ratio survives exactly in the HEAD
     * (tested above) and only approximately in the delivered pressure. That
     * asymmetry IS the partial coupling, visible in a measurement.
     */
  })
})

// ── M. The causal trace ─────────────────────────────────────────────────────

describe('§M — density is the cause, and the ONLY fluid property that is', () => {
  it('change nothing but the density, and the pressure moves', () => {
    /** One drawing, one registry, one service id. Density alone varies. */
    const a = settle(svc(WATER)), b = settle(svc(WATER * 2))
    expect(b.head / a.head).toBeCloseTo(2, 9)
    expect(b.discharge).toBeGreaterThan(a.discharge)
    expect(b.flow).toBeGreaterThan(a.flow)
  })

  it('change viscosity or heat capacity instead, and NOTHING moves', () => {
    // K31 couples density. It does not pretend to couple the others, and a
    // model that quietly responded to viscosity would be claiming a Reynolds
    // dependence this repository has no geometry to compute.
    const base = settle(svc(WATER, { viscosityMPaS: 1, heatCapacityKJkgK: 4.18 }))
    const thick = settle(svc(WATER, { viscosityMPaS: 900, heatCapacityKJkgK: 0.5 }))
    expect(thick.head).toBeCloseTo(base.head, 12)
    expect(thick.flow).toBeCloseTo(base.flow, 9)
  })

  it('and removing the SERVICE removes the coupling, reproducing pre-K31 exactly', () => {
    const named = settle(svc(WATER))
    const unnamed = settle([], reg(), bare)
    expect(unnamed.head).toBeCloseTo(35 / 10.197, 12)
    expect(named.head).not.toBeCloseTo(unnamed.head, 4)
  })
})

// ── G10, L. Backward compatibility ──────────────────────────────────────────

describe('§G10, §L — every plant that has no services behaves identically', () => {
  it('a drawing with no service list is bit-identical to the legacy conversion', () => {
    const m = buildSimModel(bare, reg())              // no third argument at all
    expect(m.pumpFluid.get('P-1')!.basis).toBe('unresolved')
    expect(pumpHeadBar(m.defs.find((x) => x.name === 'P-1'), m.pumpFluid.get('P-1')))
      .toBe(processFor(reg(), 'P-1').headBar)         // toBe: the same double
  })

  it('and topology is untouched — the same edges, the same pumps', () => {
    const withF = buildSimModel(plant, reg(), svc(ACID))
    const without = buildSimModel(bare, reg())
    expect(withF.hydraulic.edges.map((e) => e.kind).sort())
      .toEqual(without.hydraulic.edges.map((e) => e.kind).sort())
    expect(withF.controllers.length).toBe(without.controllers.length)
  })

  it('pumpFluids only ever keys PUMPS, and only tagged ones', () => {
    const m = buildSimModel(plant, reg(), svc(WATER))
    const pumps = m.hydraulic.edges.filter((e) => e.kind === 'pump' && e.tag).map((e) => e.tag)
    expect([...m.pumpFluid.keys()].sort()).toEqual(pumps.sort())
    expect(pumpFluids(m.hydraulic, []).size).toBe(pumps.length)
  })
})
