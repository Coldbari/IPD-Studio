// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K34 — THE SUCTION DIAGNOSTIC'S SEMANTICS, AND THE VESSEL-HEAD DECISION.
 *
 * ── PART A ────────────────────────────────────────────────────────────────
 *
 * K33 connected the suction check to the real source pressure, which made a
 * case reachable that had been rare before: a plant specified so far past its
 * suction that the nozzle would have to sit BELOW ABSOLUTE ZERO. The check
 * itself is right — that duty is impossible and `insufficient` is the correct
 * verdict — but the message stated the impossible pressure as though the nozzle
 * would sit there, which `hydraulic/solver.ts` already forbids in its own
 * contract: a negative absolute pressure "must be presented as INVALID rather
 * than as a reading". It now reports the SHORTFALL instead.
 *
 * The same message also claimed "the model has no fluid". K31 made that false.
 * The CHECK has no fluid — it is pure capacity — and that is what the sentence
 * was always about, so it now says so.
 *
 * No equation changed, no severity changed, no state changed.
 *
 * ── PART B: THE DECISION ──────────────────────────────────────────────────
 *
 * THE VESSEL STATIC HEAD IS A CALIBRATED PRESSURE, not a physical hydrostatic
 * head. Decided from the data model, not from which reading sounds better:
 * `duty.head` is stated by an engineer in metres, so K31 may convert it;
 * `tankFullHeadBar` is stated by nobody, has no height behind it and no height
 * field anywhere in the catalogue, and is typed in bar. There is no length here
 * to convert, so nothing converts one.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import { buildIndex } from '../../src/model/projectIndex'
import { resetSuctionCache, suctionFor } from '../../src/model/suction'
import { pumpSuctionInsufficient } from '../../src/validate/rules/process'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { solveHydraulics, vesselHeadBar } from '../../src/hmi/sim/hydraulic/solver'
import { tankPressureBar } from '../../src/hmi/sim/process'
import { DEFAULTS } from '../../src/hmi/sim/units'
import { ATMOSPHERIC_BAR } from '../../src/model/processData'
import {
  EQUIPMENT_CAPABILITY, VESSEL_HEAD_IS_CALIBRATED_PRESSURE,
} from '../../src/model/capability'
import { FIELD_CATALOG } from '../../src/model/fields'
import type { HmiScreen } from '../../src/hmi/model'
import type { ProjectDoc, Fluid } from '../../src/model/types'
import type { Registry } from '../../src/model/registry'

// ── Fixture ─────────────────────────────────────────────────────────────────

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
const reg = (capacity: string, vesselPressure?: string): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': capacity, 'duty.head': '35 m' } },
  ...(vesselPressure !== undefined
    ? { 'TK-0': { key: 'TK-0', kind: 'equipment' as const, fields: { 'design.operatingPressure': vesselPressure } } }
    : {}),
})
const docOf = (r: Registry): ProjectDoc => ({ ...createEmptyDoc('t'), hmiScreens: [plant()], registry: r })
const caseOf = (capacity: string, vesselPressure?: string) => {
  resetSuctionCache()
  const ix = buildIndex(docOf(reg(capacity, vesselPressure)))
  const s = suctionFor(ix).find((c) => c.tag === 'P-1')!
  const f = pumpSuctionInsufficient.run(ix)
  return { ...s, message: f[0]?.message, findings: f.length }
}

// ═══ PART A ═════════════════════════════════════════════════════════════════

describe('§A — what `suctionAtRated < 0` means, and what the message says', () => {
  /**
   * The six required cases. Measured, not asserted from the formula: R = 4e-4
   * for the single suction pipe, level 50 % so the static head is 0.15 bar.
   *
   *   1. atmosphere, adequate      1.15 bar, loss 0.64  -> +0.51  ok
   *   2. atmosphere, insufficient  1.15 bar, loss 3.24  -> -2.09  insufficient
   *   3. pressurised, adequate    11.15 bar, loss 0.64  -> +10.51 ok
   *   4. pressurised, insufficient 11.15 bar, loss 36   -> -24.85 insufficient
   *   5. under-atmospheric          0.17 bar, loss 0.64 -> -0.47  insufficient
   *   6. exactly at threshold      1.15 bar, loss 1.15  ->  0     ok
   */
  it('1: atmospheric source, adequate suction — no finding', () => {
    const c = caseOf('40 m³/h')
    expect(c.sourcePressure).toBeCloseTo(1.15, 9)
    expect(c.suctionAtRated).toBeCloseTo(0.51, 9)
    expect(c.state).toBe('ok')
    expect(c.findings).toBe(0)
  })

  it('2: atmospheric source, insufficient — reports the SHORTFALL, not a reading', () => {
    const c = caseOf('90 m³/h')
    expect(c.sourcePressure).toBeCloseTo(1.15, 9)
    expect(c.suctionAtRated).toBeCloseTo(-2.09, 9)
    expect(c.state).toBe('insufficient')
    expect(c.message).toMatch(/would need 2\.09 bar more than the source has/)
    expect(c.message).toMatch(/below zero bar absolute/)
    expect(c.message).toMatch(/not a condition the plant can reach/)
    // and it never claims the nozzle SITS there
    expect(c.message).not.toMatch(/nozzle would sit at -/)
  })

  it('3: PRESSURISED source, adequate — the diagnostic does not assume atmosphere', () => {
    const c = caseOf('40 m³/h', '10 barg')
    expect(c.sourcePressure).toBeCloseTo(11.15, 9)
    expect(c.suctionAtRated).toBeCloseTo(10.51, 9)
    expect(c.state).toBe('ok')
    expect(c.findings).toBe(0)
    // the same duty that is fine here would also be fine vented; the proof that
    // pressure is doing work is that the CAPACITY rose with it
    expect(c.maxFlow).toBeGreaterThan(caseOf('40 m³/h').maxFlow!)
  })

  it('4: PRESSURISED source, insufficient — the message quotes the real pressure', () => {
    const c = caseOf('300 m³/h', '10 barg')
    expect(c.suctionAtRated).toBeCloseTo(-24.85, 9)
    expect(c.state).toBe('insufficient')
    expect(c.message).toMatch(/on 11\.15 bar/)        // NOT 1.00 bar
    expect(c.message).not.toMatch(/on 1\.15 bar/)
    expect(c.message).toMatch(/would need 24\.85 bar more/)
  })

  it('5: UNDER-ATMOSPHERIC source, insufficient', () => {
    const c = caseOf('40 m³/h', '0.02 bara')
    expect(c.sourcePressure).toBeCloseTo(0.17, 9)
    expect(c.suctionAtRated).toBeCloseTo(-0.47, 9)
    expect(c.state).toBe('insufficient')
    expect(c.message).toMatch(/on 0\.17 bar/)
    expect(c.message).toMatch(/would need 0\.47 bar more/)
  })

  it('6: exactly at the threshold is ok, not insufficient', () => {
    // `maxFlow` for this fixture; a path that can pass exactly its rated flow is
    // AT its capability, not beyond it — the rule `suction.ts` already states
    const exact = caseOf('40 m³/h').maxFlow!
    const c = caseOf(`${exact} m³/h`)
    expect(c.suctionAtRated).toBeCloseTo(0, 9)
    expect(c.state).toBe('ok')
    expect(c.findings).toBe(0)
  })

  it('§A: the state and severity are untouched by K34', () => {
    expect(pumpSuctionInsufficient.severity).toBe('warning')
    expect(pumpSuctionInsufficient.id).toBe('pump-suction-insufficient')
    for (const c of [caseOf('90 m³/h'), caseOf('300 m³/h', '10 barg'), caseOf('40 m³/h', '0.02 bara')]) {
      expect(c.state).toBe('insufficient')
    }
  })

  it('§A, §6: the NPSH disclaimer survives, and is now true', () => {
    const c = caseOf('90 m³/h')
    expect(c.message).toMatch(/not an NPSH calculation/)
    // K31 gave the PRODUCT a fluid; the CHECK still has none, which is the
    // claim the sentence was always making
    expect(c.message).toMatch(/this check has no fluid, vapour pressure or elevation/)
    expect(c.message).not.toMatch(/the model has no fluid/)
  })
})

// ═══ PART B / C — the decision, recorded ════════════════════════════════════

describe('§B, §C — the vessel head is a calibrated pressure, and it is recorded', () => {
  it('the decision is declared', () => {
    expect(VESSEL_HEAD_IS_CALIBRATED_PRESSURE).toBe(true)
  })

  it('the evidence the decision rests on: there is no height field to convert', () => {
    /**
     * The decisive fact, asserted rather than asserted-about. If a vessel height
     * or elevation ever enters the catalogue this test fails, which is exactly
     * when the decision should be revisited.
     */
    const keys = Object.values(FIELD_CATALOG)
      .flatMap((sections) => sections.flatMap((sec) => sec.fields.map((f) => f.key.toLowerCase())))
    expect(keys.length).toBeGreaterThan(50)          // the catalogue really is loaded
    for (const k of keys) {
      expect(k).not.toMatch(/height|elevation|datum/)
    }
  })

  it('the capability row states the decision and the reason', () => {
    const f = EQUIPMENT_CAPABILITY.find((x) => x.id === 'tankFullHeadBar')!
    expect(f.cls).toBe('ASSUMPTION')
    expect(f.meaning).toContain('CALIBRATED PRESSURE')
    expect(f.meaning).toContain('FLUID-INDEPENDENT')
    expect(f.unit).toBe('bar at 100 % level')
  })
})

// ═══ PART D — the ten regressions ═══════════════════════════════════════════

describe('§D — nothing moved that was not meant to', () => {
  const heavy: Fluid[] = [{
    id: 'acid', name: 'Acid', color: '#cc0', densityKgM3: 1840,
    viscosityMPaS: 25, heatCapacityKJkgK: 1.4, referenceCondition: '20 °C, 1 atm',
  }]

  it('1: the vessel head is exactly 0.3 bar, still', () => {
    expect(DEFAULTS.tankFullHeadBar).toBe(0.3)
    expect(vesselHeadBar(100)).toBeCloseTo(0.3, 12)
    expect(vesselHeadBar(50)).toBeCloseTo(0.15, 12)
    expect(tankPressureBar(100)).toBeCloseTo(0.3, 12)
  })

  it('2, 7: fluid density does not alter it, and takes no new consumer', () => {
    expect(vesselHeadBar.length).toBe(1)
    expect(tankPressureBar.length).toBe(1)
    // and end to end: the solved vessel node is identical with and without a
    // dense service on the drawing
    const withF = solvedSource(heavy), without = solvedSource([])
    expect(withF).toBeCloseTo(without, 12)
  })

  it('3: the K33 source-pressure correction is intact', () => {
    expect(caseOf('40 m³/h', '10 barg').sourcePressure).toBeCloseTo(11 + vesselHeadBar(50), 9)
    expect(caseOf('40 m³/h').sourcePressure).toBeCloseTo(ATMOSPHERIC_BAR + vesselHeadBar(50), 9)
  })

  it('4: the vessel head is added exactly once', () => {
    // 10 barg -> 11 bara, plus 0.15 at half level. Twice would be 11.30.
    const c = caseOf('40 m³/h', '10 barg')
    expect(c.sourcePressure).toBeCloseTo(11.15, 9)
    expect(c.sourcePressure).not.toBeCloseTo(11.30, 6)
    expect(c.sourcePressure).not.toBeCloseTo(11.00, 6)
  })

  it('10: the solver still holds that node where it always did', () => {
    expect(solvedSource([])).toBeCloseTo(ATMOSPHERIC_BAR + vesselHeadBar(50), 9)
  })
})

/** The pressure the real solver fixes the source vessel's bottom nozzle at. */
function solvedSource(fluids: Fluid[]): number {
  const m = buildSimModel([plant()], reg('40 m³/h'), fluids)
  const byName = new Map(m.defs.map((d) => [d.name, d]))
  const hyd = solveHydraulics(m.hydraulic, {
    valveOpen: () => 1, pumpSpeed: () => 0,
    pumpRated: (p) => byName.get(p)?.ratedFlow ?? DEFAULTS.pumpFlowM3h,
    pumpHead: (p) => byName.get(p)?.head ?? DEFAULTS.pumpHeadBar,
    vesselLevel: (t) => byName.get(t)?.level0 ?? 0,
    vesselPressure: (t) => byName.get(t)?.vesselPressureBarA ?? DEFAULTS.atmosphericPressureBar,
  })
  const node = m.hydraulic.nodes.find((n) => n.kind === 'vessel' && n.tag === 'TK-0' && n.liquid)!
  return hyd.pressure[node.id]!
}
