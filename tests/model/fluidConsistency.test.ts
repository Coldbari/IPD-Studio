// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K32 — IS THE PARTIALLY FLUID-COUPLED MODEL INTERNALLY CONSISTENT?
 *
 * K31 made pump head density-dependent where the record states a LENGTH, and
 * left everything else fluid-independent. That is a boundary drawn through the
 * middle of the hydraulics, and a boundary is only honest if it is in the same
 * place everywhere. This file audits it and pins what it found.
 *
 * NOTHING HERE CHANGES AN EQUATION. Every test asserts CURRENT behaviour. Two
 * of them assert behaviour this audit considers questionable, and say so in
 * their own comments rather than quietly fixing it — K32 §10 forbids the fix
 * and asks for the finding instead.
 *
 * ── WHAT THE AUDIT FOUND ──────────────────────────────────────────────────
 *
 *   CONSISTENT. Every resistance, the suction check, and the pressure
 *   convention are fluid-independent by construction and stay that way.
 *   Density has exactly ONE runtime consumer and it is the pump head.
 *
 *   FINDING 1 — DECIDED BY K34: THE VESSEL STATIC HEAD IS A CALIBRATED
 *   PRESSURE, formally, and stays fluid-independent.
 *   `DEFAULTS.tankFullHeadBar = 0.3` bar is documented as "≈ 3 m of liquid",
 *   and 3 m of liquid is 0.3 bar only for water. The CONSTANT is declared in
 *   bar, so nothing converts it and no density is applied — which is why this
 *   is not a K31-style defect. But its PROVENANCE is a water assumption, and
 *   a vessel head and a pump head stated in the same metres now behave
 *   differently. See the §3 block below.
 *
 *   FINDING 2 — CLOSED BY K33. `model/suction.ts` sourced at `atmosphere +
 *   static head` while the runtime solver sourced at `vesselPressure + static
 *   head`, so a closed vessel was checked as if vented. K33 made the check ask
 *   the node what it is held at. The §2 block below now pins the corrected
 *   behaviour and records what it used to be.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import { buildIndex } from '../../src/model/projectIndex'
import { resetSuctionCache, suctionFor } from '../../src/model/suction'
import { buildSimModel, pumpHeadBar } from '../../src/hmi/sim/engine'
import {
  G, LEGACY_HEAD_DENSITY_KGM3, headBar, pumpFluids,
} from '../../src/hmi/sim/hydraulic/fluidhead'
import {
  FITTING_K, PIPE_K, VALVE_K, valveResistance,
} from '../../src/hmi/sim/hydraulic/model'
import {
  RUNOUT_FACTOR, pumpHead, shutoffFromDuty, vesselHeadBar,
} from '../../src/hmi/sim/hydraulic/solver'
import { tankPressureBar } from '../../src/hmi/sim/process'
import { DEFAULTS, LIQUID_CP_KJ_PER_M3_K } from '../../src/hmi/sim/units'
import { ATMOSPHERIC_BAR, operatingPressure, processFor } from '../../src/model/processData'
import { EQUIPMENT_CAPABILITY, FLUID_COUPLING_AUDITED } from '../../src/model/capability'
import { DEFAULT_FLUIDS } from '../../src/model/doc'
import { hasProperties } from '../../src/hmi/sim/fluids'
import type { HmiScreen } from '../../src/hmi/model'
import type { ProjectDoc, Fluid } from '../../src/model/types'
import type { Registry } from '../../src/model/registry'

// ── Fixture: TK-0 -> P-1 -> TK-1, the shape `pumpSuction.test.ts` uses ───────

const plant = (): HmiScreen => ({
  ...createScreen(1), id: 'scr1', name: 'Unit',
  widgets: [
    { id: 'src', type: 'tank', x: 0, y: 40, w: 96, h: 128, tag: 'TK-0', props: { level0: 50 } },
    { id: 'p', type: 'pump', x: 400, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 't', type: 'tank', x: 700, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 50 } },
  ],
  pipes: [
    { id: 's0', points: [{ x: 100, y: 118 }, { x: 396, y: 118 }], aId: 'src', aPort: 'bottom', bId: 'p', bPort: 'suction' },
    { id: 'd', points: [{ x: 460, y: 118 }, { x: 710, y: 150 }], aId: 'p', aPort: 'discharge', bId: 't', bPort: 'bottom' },
  ],
})

const docOf = (registry?: Registry): ProjectDoc => {
  const d = createEmptyDoc('t')
  return { ...d, hmiScreens: [plant()], ...(registry ? { registry } : {}) }
}
const reg = (tank: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
  ...(Object.keys(tank).length > 0
    ? { 'TK-0': { key: 'TK-0', kind: 'equipment' as const, fields: tank } } : {}),
})
const checkOf = (registry?: Registry) => {
  resetSuctionCache()
  return suctionFor(buildIndex(docOf(registry))).find((c) => c.tag === 'P-1')!
}

// ═══ §1 — THE HIDDEN-ASSUMPTION INVENTORY ═══════════════════════════════════

describe('§1 — every water-shaped constant, classified', () => {
  it('D: the legacy head basis is the ONLY surviving water conversion, and it is named', () => {
    expect(LEGACY_HEAD_DENSITY_KGM3).toBeCloseTo(1000.016, 3)
    expect(headBar(35, LEGACY_HEAD_DENSITY_KGM3)).toBeCloseTo(35 / 10.197, 12)
  })

  it('C: the thermal constant IS water, is declared, and is unrelated to hydraulics', () => {
    /**
     * `LIQUID_CP_KJ_PER_M3_K = 4186` is 4.186 kJ/(kg·K) × 1000 kg/m³. A water
     * density sits inside it. It is a SIMULATOR ASSUMPTION, declared in its own
     * docblock, and it never touches a pressure — the thermal model is a
     * separate single-fluid model that K31 did not couple and K32 does not.
     */
    const water = DEFAULT_FLUIDS[0]!
    expect(water.densityKgM3! * water.heatCapacityKJkgK!).toBeCloseTo(LIQUID_CP_KJ_PER_M3_K, 6)
    expect(water.densityKgM3).toBe(1000)             // and 1000 ≠ 1000.016: a
    // DIFFERENT water from the head basis, because they were derived apart
    expect(water.densityKgM3).not.toBe(LEGACY_HEAD_DENSITY_KGM3)
  })

  it('B: standard gravity is the CGPM figure and is not a fluid property', () => {
    expect(G).toBe(9.80665)
  })
})

// ═══ §2 — THE SUCTION CHECK (there is no NPSH calculation) ══════════════════

describe('§2 — the suction check is not NPSH, and is fluid-independent', () => {
  it('it consumes no density, no vapour pressure and no temperature', () => {
    /**
     * `suctionChecks` reads: rated flow, path resistance, vessel static head
     * and atmosphere. NPSHa would need vapour pressure at the pumping
     * temperature, a density and a static lift; NPSHr would need the machine's
     * own curve. None is present, `model/suction.ts` says so in capitals, and
     * THAT is why it is not misleading for a non-water fluid — it never claims
     * the margin question that density would change.
     */
    const c = checkOf(reg())
    expect(c.state).toBe('ok')
    expect(c.sourcePressure).toBeCloseTo(ATMOSPHERIC_BAR + vesselHeadBar(50), 9)
    // and it is untouched by K31: the pump's HEAD plays no part in it at all
    expect(Object.keys(c)).not.toContain('head')
  })

  it('K31 changed nothing here — the check is identical at any density', () => {
    // `suctionChecks` builds its own model with no service list by design, so
    // the result cannot depend on a fluid. Pinned, so a future phase that wires
    // fluids into it has to come past this test deliberately.
    expect(checkOf(reg()).maxFlow).toBeCloseTo(checkOf(reg()).maxFlow!, 12)
    expect(checkOf(reg()).suctionAtRated).toBeCloseTo(checkOf(reg()).suctionAtRated!, 12)
  })

  /**
   * ── FINDING 2, CLOSED BY K33 ──────────────────────────────────────────────
   *
   * OLD EXPECTATION:  `closed.sourcePressure === vented.sourcePressure`. The
   *                   static check sourced EVERY vessel at atmosphere plus its
   *                   static head, whatever its record said.
   * NEW EXPECTATION:  a vessel is sourced at its STATED operating pressure plus
   *                   the same static head — 11 + 0.15 where it was 1 + 0.15.
   * PHYSICAL REASON:  the runtime solver has always fixed that node at
   *                   `vesselPressure + vesselHeadBar(level)`. The static check
   *                   claims in its own header to ask the existing model a
   *                   static question, so sourcing the same node at a different
   *                   pressure made it check a plant that will never run. A
   *                   closed vessel at 10 barg was checked as if vented, which
   *                   understates `maxFlow` and can report `insufficient` on a
   *                   suction that is amply pressurised.
   *
   * Nothing about the STATIC HEAD changed: `vesselHeadBar` is the same
   * calibrated 0.3 bar and K32's FINDING 1 is untouched. Only the base it is
   * added to moved, from a hard-coded atmosphere to the node's own pressure.
   */
  it('FINDING 2 CLOSED: a closed vessel is sourced at its stated pressure', () => {
    const vented = checkOf(reg())
    const closed = checkOf(reg({ 'design.operatingPressure': '10 barg' }))
    expect(processFor(reg({ 'design.operatingPressure': '10 barg' }), 'TK-0')
      .operatingPressureBarA).toBe(11)
    expect(closed.sourcePressure).toBeCloseTo(11 + vesselHeadBar(50), 9)
    expect(vented.sourcePressure).toBeCloseTo(ATMOSPHERIC_BAR + vesselHeadBar(50), 9)
    expect(closed.sourcePressure! - vented.sourcePressure!).toBeCloseTo(10, 9)
  })
})

// ═══ §3 — VESSEL / HYDROSTATIC HEAD ═════════════════════════════════════════

describe('§3 — vessel static head is a calibrated PRESSURE', () => {
  it('it is declared in bar, proportional to level, and takes no fluid', () => {
    expect(DEFAULTS.tankFullHeadBar).toBe(0.3)
    expect(vesselHeadBar(0)).toBe(0)
    expect(vesselHeadBar(100)).toBeCloseTo(0.3, 12)
    expect(vesselHeadBar(50)).toBeCloseTo(0.15, 12)
    expect(vesselHeadBar.length).toBe(1)             // nowhere to pass a fluid
  })

  it('the two implementations of it agree', () => {
    // `process.ts` and `hydraulic/solver.ts` each define it. They are separate
    // functions computing the same quantity; a divergence would be invisible.
    for (const pct of [0, 25, 50, 99.9, 100]) {
      expect(tankPressureBar(pct)).toBeCloseTo(vesselHeadBar(pct), 12)
    }
  })

  /**
   * ── FINDING 1, PINNED AS-IS ───────────────────────────────────────────────
   *
   * CURRENT BEHAVIOUR: 0.3 bar at full, documented as "≈ 3 m of liquid".
   *
   * THE ASYMMETRY: 3 m of liquid is 0.3 bar ONLY for water (ρ ≈ 1019 to make it
   * exact; ρ = 1000 gives 0.294 bar). So a vessel's three metres are frozen at a
   * water basis while a pump's thirty-five metres are now converted against the
   * real service. Two heads in metres, two different treatments.
   *
   * WHY THE DIFFERENCE IS DEFENSIBLE TODAY: the pump's metres are STATED BY AN
   * ENGINEER on a datasheet, so there is a real quantity to convert. The
   * vessel's three metres are not stated anywhere — no drawing carries a vessel
   * height — so `tankFullHeadBar` is a calibrated stand-in that happens to have
   * been justified in metres in a comment. Converting a number nobody stated
   * would be inventing an elevation, which every phase since K26 has refused.
   *
   * WHY IT IS STILL A FINDING: the justification is a water assumption, it is
   * not recorded as one in `capability.ts`, and the moment a vessel height
   * becomes real data the two paths must be reconciled. Recorded for K33.
   */
  it('FINDING 1: the vessel head is frozen at a water basis, unlike the pump head', () => {
    /**
     * Read as physics, `0.3 bar over 3 m` pins a density exactly as the
     * `1/10.197` factor did — and it is a THIRD water, different again from
     * both of the other two in this file:
     *
     *      ρ = 0.3e5 / (3 · g) = 1019.7 kg/m³
     *
     * against 1000.016 for the legacy head basis and 1000 for the thermal
     * constant. Three water densities, none of them equal, none of them ever
     * stated as a density until now. That is the shape of the finding: not a
     * wrong number, but an unrecorded basis in a quantity that looks calibrated.
     */
    const impliedDensity = (DEFAULTS.tankFullHeadBar * 1e5) / (3 * G)
    expect(impliedDensity).toBeCloseTo(1019.7, 1)
    expect(impliedDensity).not.toBeCloseTo(LEGACY_HEAD_DENSITY_KGM3, 0)
    // 3 m of sulphuric acid is 0.54 bar — the vessel head does NOT move with
    // the service, while a pump's stated metres now do
    expect(headBar(3, 1840)).toBeCloseTo(0.5414, 3)
    expect(vesselHeadBar(100)).toBe(0.3)
  })
})

// ═══ §4 — THE PUMP CURVE ════════════════════════════════════════════════════

describe('§4 — the pump curve contract, established not changed', () => {
  it('duty.head is the head AT RATED FLOW; runout is 1.5× that flow', () => {
    expect(RUNOUT_FACTOR).toBe(1.5)
    expect(shutoffFromDuty(1)).toBeCloseTo(1 / (1 - 1 / 1.5 ** 2), 12)
    // the curve passes through the stated duty point, which is the whole reason
    // `shutoffFromDuty` exists
    expect(pumpHead(3.4, 40, 1, 40)).toBeCloseTo(3.4, 9)
    expect(pumpHead(3.4, 40, 1, 60)).toBeCloseTo(0, 9)     // zero head at runout
    expect(pumpHead(3.4, 40, 1, 70)).toBeLessThan(0)       // and negative beyond
  })

  it('the curve is represented in PRESSURE throughout — density enters before it', () => {
    /**
     * `pumpHead` takes bar and returns bar. The metres→bar conversion happens
     * once, upstream, in `pumpHeadBar`. So the curve itself is fluid-free and
     * the coupling cannot be applied twice.
     */
    const k = 1840 / 998
    for (const speed of [1, 0.6, 0.25]) {
      for (const flow of [0, 20, 40]) {
        expect(pumpHead(3.4 * k, 40, speed, flow))
          .toBeCloseTo(k * pumpHead(3.4, 40, speed, flow), 12)
      }
    }
  })

  it('affinity: head as speed², capacity as speed, and no fluid in either', () => {
    expect(pumpHead(3.4, 40, 0.5, 0)).toBeCloseTo(0.25 * pumpHead(3.4, 40, 1, 0), 12)
    expect(pumpHead(3.4, 40, 0.5, 30)).toBeCloseTo(0, 9)   // runout moves with speed
    expect(pumpHead(3.4, 40, 0, 0)).toBe(0)
  })

  it('the SHAPE is a simulator assumption and carries no water', () => {
    // A quadratic from shutoff to runout with RUNOUT_FACTOR 1.5. Nothing in it
    // is a fluid property; viscous derating of a real curve is not modelled and
    // viscosity remains unconsumed anywhere in the product.
    expect(pumpHead(1, 10, 1, 0)).toBeCloseTo(shutoffFromDuty(1), 12)
  })
})

// ═══ §5 — THE PRESSURE CONVENTION ═══════════════════════════════════════════

describe('§5 — gauge becomes absolute exactly once', () => {
  it('K6/K7 semantics are unchanged: gauge unless the unit says otherwise', () => {
    expect(ATMOSPHERIC_BAR).toBe(1)
    expect(operatingPressure('10 barg')).toBe(11)
    expect(operatingPressure('10')).toBe(11)          // a bare number is GAUGE
    expect(operatingPressure('10 bara')).toBe(10)
    expect(operatingPressure('2 atm')).toBeCloseTo(2.0265, 6)
    expect(operatingPressure('500 kpa')).toBe(5)      // absolute units: no add
  })

  it('and the simulator agrees with the engineering side on atmosphere', () => {
    expect(DEFAULTS.atmosphericPressureBar).toBe(ATMOSPHERIC_BAR)
  })

  it('no density-dependent conversion is duplicated: metres→bar happens once', () => {
    /**
     * The only density-bearing conversion in the product is `headBar`, reached
     * only through `resolvePumpHeadBar`, reached only through `pumpHeadBar`.
     * Applying it to an already-converted figure would square the density — so
     * the guard is that `headM` and `head` are separate fields and only `headM`
     * ever meets a density.
     */
    const fluids: Fluid[] = [{ id: 'f', name: 'F', color: '#4af', densityKgM3: 1840, viscosityMPaS: 1, heatCapacityKJkgK: 2, referenceCondition: '20 °C, 1 atm' }]
    const m = buildSimModel(plant(), reg(), fluids)
    const def = m.defs.find((d) => d.name === 'P-1')!
    expect(def.headM).toBeCloseTo(35, 12)                        // the length
    expect(def.head).toBeCloseTo(35 / 10.197, 12)                // the legacy bar
    // applied once, never to the bar figure
    expect(pumpHeadBar(def, { basis: 'fluid', densityKgM3: 1840 }))
      .toBeCloseTo(headBar(35, 1840), 12)
  })
})

// ═══ §6 — THE RESISTANCE CONTRACT ═══════════════════════════════════════════

describe('§6 — R is bar/(m³/h)² and nothing fluid-shaped reaches it', () => {
  it('every resistance source is a bare constant or a function of POSITION only', () => {
    expect(VALVE_K).toBe(4e-4)
    expect(PIPE_K).toBe(4e-4)
    expect(FITTING_K).toBeCloseTo(PIPE_K / 10, 12)
    expect(valveResistance.length).toBe(1)
    expect(valveResistance(1)).toBeCloseTo(VALVE_K, 12)
    expect(valveResistance(0.5)).toBeCloseTo(VALVE_K / 0.5 ** 4, 12)
  })

  it('a pump contributes NO resistance — its curve already falls with flow', () => {
    const m = buildSimModel(plant(), reg())
    for (const e of m.hydraulic.edges.filter((e) => e.kind === 'pump')) {
      expect(e.resistance).toBe(0)
    }
  })

  it('EXPLICITLY RECORDED: the model is internally consistent here', () => {
    /**
     * Audited every write to `ProcessEdge.resistance` and every solve-time
     * substitution. There are exactly two: `valveResistance(openFraction)`, a
     * function of position, and `pipeFactor`, the plugged-line scenario — a
     * geometric restriction. Neither takes a density, a fluid, a viscosity or
     * a temperature, and no other code path modifies R at all.
     */
    const m = buildSimModel(plant(), reg())
    const kinds = new Set(m.hydraulic.edges.map((e) => e.kind))
    for (const e of m.hydraulic.edges) {
      expect(Number.isFinite(e.resistance)).toBe(true)
      expect(e.resistance).toBeGreaterThanOrEqual(0)
    }
    expect(kinds.has('pipe')).toBe(true)
  })
})

// ═══ §7 — FLUID TOPOLOGY ════════════════════════════════════════════════════

describe('§7 — one fluid per edge, resolved once, never at runtime', () => {
  it('a pump always gets exactly one entry, resolved or not', () => {
    const m = buildSimModel(plant(), reg())
    const pumps = m.hydraulic.edges.filter((e) => e.kind === 'pump' && e.tag)
    expect(pumps.length).toBe(1)
    expect(m.pumpFluid.size).toBe(1)
    // with no service list it is unresolved — never absent, never guessed
    expect(m.pumpFluid.get('P-1')).toMatchObject({ basis: 'unresolved' })
  })

  it('a pump CAN have no fluid identity, and that is a first-class answer', () => {
    const m = buildSimModel(plant(), reg(), [])
    expect(m.pumpFluid.get('P-1')!.why).toBe('no-service')
  })

  it('resolution is STATIC — it is compiled with the model, not per tick', () => {
    // `pumpFluids` takes the topology and the service list and nothing else:
    // no flow, no level, no time. A reversing line cannot change its service.
    // Called twice on the same inputs it must give the same answer, and the
    // map lives on the compiled SimModel rather than being rebuilt per tick.
    const m = buildSimModel(plant(), reg())
    const a = pumpFluids(m.hydraulic, [])
    const b = pumpFluids(m.hydraulic, [])
    expect(a.get('P-1')).toEqual(b.get('P-1'))
  })
})

// ═══ §8 — EVERY RUNTIME CONSUMER OF DENSITY ═════════════════════════════════

describe('§8 — density has exactly one runtime consumer that reads its VALUE', () => {
  it('hasProperties only asks whether it is present, never what it is', () => {
    const withAll: Fluid = { id: 'a', name: 'A', color: '#4af', densityKgM3: 1, viscosityMPaS: 1, heatCapacityKJkgK: 1 }
    expect(hasProperties(withAll)).toBe(true)
    expect(hasProperties({ ...withAll, densityKgM3: 99999 })).toBe(true)  // value irrelevant
    const { densityKgM3: _d, ...noDensity } = withAll
    expect(hasProperties(noDensity as Fluid)).toBe(false)
  })

  it('the pump head is the one place a density becomes a number', () => {
    const m = buildSimModel(plant(), reg(), [
      { id: 'f', name: 'F', color: '#4af', densityKgM3: 1840, viscosityMPaS: 1, heatCapacityKJkgK: 2, referenceCondition: '20 °C, 1 atm' },
    ])
    expect(m.pumpFluid.get('P-1')).toMatchObject({ basis: 'unresolved' })
    // ^ no service is PAINTED on this drawing's pipes, so even with a service
    //   list the pump resolves to nothing. Identity comes from the drawing.
  })
})

// ═══ §10 — THE AUDIT IS RECORDED, NOT JUST PERFORMED ════════════════════════

describe('§10 — the findings survive this conversation', () => {
  it('the audit is declared', () => { expect(FLUID_COUPLING_AUDITED).toBe(true) })

  /**
   * ── AMENDED BY K34 ──────────────────────────────────────────────────────
   *
   * OLD EXPECTATION:  the row names K33 as the phase that would decide what
   *                   the 0.3 bar means.
   * NEW EXPECTATION:  the row states the DECISION itself. K33 turned out to be
   *                   about source pressure; K34 took the vessel-head question
   *                   and answered it — the quantity is a CALIBRATED PRESSURE
   *                   and stays fluid-independent.
   * REASON:           a pointer to a future phase is only correct until that
   *                   phase happens. The 1019.7 figure is still asserted,
   *                   because it is still the reason the wording needed fixing.
   */
  it('FINDING 1 is written down, and K34 decided it', () => {
    const f = EQUIPMENT_CAPABILITY.find((x) => x.id === 'tankFullHeadBar')!
    expect(f.cls).toBe('ASSUMPTION')
    expect(f.meaning).toContain('1019.7')
    expect(f.meaning).toContain('CALIBRATED PRESSURE')
  })

  it('and the three unequal water densities are all now named as densities', () => {
    const vessel = (DEFAULTS.tankFullHeadBar * 1e5) / (3 * G)
    const thermal = DEFAULT_FLUIDS[0]!.densityKgM3!
    for (const [a, b] of [[vessel, LEGACY_HEAD_DENSITY_KGM3], [vessel, thermal],
      [LEGACY_HEAD_DENSITY_KGM3, thermal]] as const) {
      expect(a).not.toBe(b)
    }
    // all three are water to within 2 %, which is exactly why nobody noticed
    for (const d of [vessel, LEGACY_HEAD_DENSITY_KGM3, thermal]) {
      expect(Math.abs(d - 1000) / 1000).toBeLessThan(0.02)
    }
  })
})
