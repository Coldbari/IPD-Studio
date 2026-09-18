// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K33 — THE STATIC SUCTION CHECK AND THE SOLVER NOW AGREE ABOUT PRESSURE.
 *
 * `model/suction.ts` claims in its own header to ask the EXISTING hydraulic
 * model a static question: same topology, same resistances, same constitutive
 * law. K32 found one place where it did not — the pressure it started from.
 *
 *   THE SOLVER fixes a source node at `vesselPressure + vesselHeadBar(level)`
 *   for a vessel, and at the terminal's own `pressureBar` for a boundary.
 *
 *   THE CHECK started from `atmosphere + vesselHeadBar(level)`, always.
 *
 * So a closed vessel at 10 barg, or a battery limit stated at 6 barg, was
 * checked as if it were open to the sky. `maxFlow` came out understated and a
 * perfectly good suction could be reported `insufficient`.
 *
 * K33 changes ONE expression: the base the static head is added to. Nothing
 * else moves — not the static head, not the resistances, not the law, not the
 * diagnostic vocabulary, and emphatically not the absence of an NPSH
 * calculation. These tests pin all of that in place around the correction.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import { buildIndex } from '../../src/model/projectIndex'
import { resetSuctionCache, suctionFor } from '../../src/model/suction'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { solveHydraulics, vesselHeadBar } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'
import { ATMOSPHERIC_BAR, operatingPressure } from '../../src/model/processData'
import type { HmiScreen } from '../../src/hmi/model'
import type { ProjectDoc, Fluid } from '../../src/model/types'
import type { Registry } from '../../src/model/registry'

// ── Two fixtures: a vessel-fed pump and a boundary-fed pump ─────────────────

const fromVessel = (): HmiScreen => ({
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

const fromBoundary = (): HmiScreen => ({
  ...createScreen(1), id: 'scr1', name: 'Unit',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 400, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 't', type: 'tank', x: 700, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 50 } },
  ],
  pipes: [
    { id: 's0', points: [{ x: 60, y: 112 }, { x: 396, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'd', points: [{ x: 460, y: 118 }, { x: 710, y: 150 }], aId: 'p', aPort: 'discharge', bId: 't', bPort: 'bottom' },
  ],
})

const PUMP = { 'P-1': { key: 'P-1', kind: 'equipment' as const, fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } } }
const at = (tag: string, pressure?: string): Registry => ({
  ...PUMP,
  ...(pressure !== undefined
    ? { [tag]: { key: tag, kind: 'equipment' as const, fields: { 'design.operatingPressure': pressure } } }
    : {}),
})

const docOf = (sc: HmiScreen, registry: Registry): ProjectDoc => {
  const d = createEmptyDoc('t')
  return { ...d, hmiScreens: [sc], registry }
}
const checkOf = (sc: HmiScreen, registry: Registry) => {
  resetSuctionCache()
  return suctionFor(buildIndex(docOf(sc, registry))).find((c) => c.tag === 'P-1')!
}

/**
 * What the SOLVER holds the pump's source node at. The authoritative number,
 * obtained by running the real solver over the real compiled model — not by
 * re-deriving the formula here, which would only prove this file agrees with
 * itself.
 */
const solverSourcePressure = (sc: HmiScreen, registry: Registry, fluids: Fluid[] = []): number => {
  const m = buildSimModel([sc], registry, fluids)
  const byName = new Map(m.defs.map((d) => [d.name, d]))
  const hyd = solveHydraulics(m.hydraulic, {
    valveOpen: () => 1,
    pumpSpeed: () => 0,                       // at rest: the sources still stand
    pumpRated: (p) => byName.get(p)?.ratedFlow ?? DEFAULTS.pumpFlowM3h,
    pumpHead: (p) => byName.get(p)?.head ?? DEFAULTS.pumpHeadBar,
    vesselLevel: (t) => byName.get(t)?.level0 ?? 0,
    vesselPressure: (t) => byName.get(t)?.vesselPressureBarA ?? DEFAULTS.atmosphericPressureBar,
  })
  // the node the pump draws from, walked back one edge to its source
  const pump = m.hydraulic.edges.find((e) => e.kind === 'pump')!
  const feed = m.hydraulic.edges.find((e) => e.id !== pump.id
    && (e.to === pump.from || e.from === pump.from))!
  const sourceId = feed.to === pump.from ? feed.from : feed.to
  return hyd.pressure[sourceId]!
}

// ═══ 1. The headline: the two paths agree ═══════════════════════════════════

describe('§1, §10.1 — solver and suction start from the same pressure', () => {
  const cases: ReadonlyArray<readonly [string, HmiScreen, Registry]> = [
    ['A. vessel, vented (default)', fromVessel(), at('TK-0')],
    ['B. vessel, elevated 10 barg', fromVessel(), at('TK-0', '10 barg')],
    ['C. vessel, reduced 0.5 bara', fromVessel(), at('TK-0', '0.5 bara')],
    ['D. boundary, default', fromBoundary(), at('BL-S')],
    ['E. boundary, 6 barg', fromBoundary(), at('BL-S', '6 barg')],
    ['F. boundary, 2 bara', fromBoundary(), at('BL-S', '2 bara')],
  ]
  for (const [label, sc, registry] of cases) {
    it(`${label}: check === solver`, () => {
      const check = checkOf(sc, registry)
      expect(check.sourcePressure).toBeCloseTo(solverSourcePressure(sc, registry), 9)
    })
  }
})

// ═══ 2-5. Each variation, with its arithmetic spelled out ═══════════════════

describe('§4, §10.2-10.5 — every source pressure propagates', () => {
  it('10.2: atmospheric is unchanged from before K33', () => {
    // the regression that matters most: every drawing that states nothing must
    // behave exactly as it always has
    expect(checkOf(fromVessel(), at('TK-0')).sourcePressure)
      .toBeCloseTo(ATMOSPHERIC_BAR + vesselHeadBar(50), 12)
    expect(checkOf(fromBoundary(), at('BL-S')).sourcePressure)
      .toBeCloseTo(ATMOSPHERIC_BAR, 12)
  })

  it('10.3: an ELEVATED vessel pressure raises the source and the capacity', () => {
    const vented = checkOf(fromVessel(), at('TK-0'))
    const high = checkOf(fromVessel(), at('TK-0', '10 barg'))
    expect(high.sourcePressure).toBeCloseTo(11 + vesselHeadBar(50), 9)
    expect(high.sourcePressure! - vented.sourcePressure!).toBeCloseTo(10, 9)
    // more pressure means the path can pass more, through the EXISTING law
    expect(high.maxFlow).toBeGreaterThan(vented.maxFlow!)
    expect(high.suctionAtRated).toBeGreaterThan(vented.suctionAtRated!)
  })

  it('10.4: a REDUCED vessel pressure lowers them', () => {
    const vented = checkOf(fromVessel(), at('TK-0'))
    const low = checkOf(fromVessel(), at('TK-0', '0.5 bara'))
    expect(low.sourcePressure).toBeCloseTo(0.5 + vesselHeadBar(50), 9)
    expect(low.maxFlow).toBeLessThan(vented.maxFlow!)
    expect(low.suctionAtRated).toBeLessThan(vented.suctionAtRated!)
  })

  it('10.5: an explicit TERMINAL pressure propagates', () => {
    const dflt = checkOf(fromBoundary(), at('BL-S'))
    const held = checkOf(fromBoundary(), at('BL-S', '6 barg'))
    expect(held.sourcePressure).toBeCloseTo(7, 9)      // no static head: a
    expect(dflt.sourcePressure).toBeCloseTo(1, 9)      // terminal has no level
    expect(held.maxFlow).toBeGreaterThan(dflt.maxFlow!)
  })

  it('a low source can still make a duty unreachable — the diagnostic still fires', () => {
    // the vocabulary and severity are untouched; only the number feeding them
    // changed. A genuinely starved suction must still be caught.
    const starved = checkOf(fromVessel(), at('TK-0', '0.02 bara'))
    expect(starved.state).toBe('insufficient')
    expect(starved.maxFlow).toBeLessThan(starved.ratedFlow)
  })
})

// ═══ 5. Gauge / absolute ════════════════════════════════════════════════════

describe('§5, §10.6-10.7 — the conversion happens exactly once', () => {
  it('10.6: barg is converted once, on the engineering side', () => {
    // 6 barg -> 7 bara at `operatingPressure`, and NOT again anywhere after it
    expect(operatingPressure('6 barg')).toBe(7)
    expect(checkOf(fromBoundary(), at('BL-S', '6 barg')).sourcePressure).toBeCloseTo(7, 9)
    // a second application would give 8; a missing one would give 6
    expect(checkOf(fromBoundary(), at('BL-S', '6 barg')).sourcePressure).not.toBeCloseTo(8, 6)
    expect(checkOf(fromBoundary(), at('BL-S', '6 barg')).sourcePressure).not.toBeCloseTo(6, 6)
  })

  it('10.7: bara stays absolute — no atmosphere is added', () => {
    expect(operatingPressure('2 bara')).toBe(2)
    expect(checkOf(fromBoundary(), at('BL-S', '2 bara')).sourcePressure).toBeCloseTo(2, 9)
    expect(checkOf(fromVessel(), at('TK-0', '2 bara')).sourcePressure)
      .toBeCloseTo(2 + vesselHeadBar(50), 9)
  })

  it('a bare number is GAUGE, matching K6/K7 everywhere else', () => {
    expect(checkOf(fromBoundary(), at('BL-S', '6')).sourcePressure).toBeCloseTo(7, 9)
  })

  it('and the default atmosphere is the one shared constant', () => {
    expect(DEFAULTS.atmosphericPressureBar).toBe(ATMOSPHERIC_BAR)
  })
})

// ═══ 6, 7. The boundaries K33 must not cross ════════════════════════════════

describe('§6, §10.10 — there is still no NPSH calculation', () => {
  it('the result carries no vapour pressure, no margin, no NPSHr', () => {
    const c = checkOf(fromVessel(), at('TK-0', '10 barg'))
    for (const k of ['vapourPressure', 'npsha', 'npshr', 'margin', 'cavitationMargin', 'temperature']) {
      expect(Object.keys(c)).not.toContain(k)
    }
  })

  it('the vocabulary is exactly the three states it always was', () => {
    for (const [sc, r] of [[fromVessel(), at('TK-0')], [fromVessel(), at('TK-0', '10 barg')],
      [fromBoundary(), at('BL-S', '6 barg')], [fromVessel(), at('TK-0', '0.02 bara')]] as const) {
      expect(['ok', 'insufficient', 'unsupplied']).toContain(checkOf(sc, r).state)
    }
  })
})

describe('§7, §10.9 — the vessel static head is untouched', () => {
  it('it is still the calibrated 0.3 bar, not ρgh', () => {
    expect(DEFAULTS.tankFullHeadBar).toBe(0.3)
    expect(vesselHeadBar(100)).toBeCloseTo(0.3, 12)
    expect(vesselHeadBar(50)).toBeCloseTo(0.15, 12)
    expect(vesselHeadBar.length).toBe(1)
  })

  it('K33 moved the BASE, never the head added to it', () => {
    // the difference between any two vessel cases is exactly the difference in
    // stated pressure — the head contributes identically to both
    const a = checkOf(fromVessel(), at('TK-0', '3 bara'))
    const b = checkOf(fromVessel(), at('TK-0', '8 bara'))
    expect(b.sourcePressure! - a.sourcePressure!).toBeCloseTo(5, 9)
    expect(a.sourcePressure! - 3).toBeCloseTo(vesselHeadBar(50), 9)
  })
})

describe('§10.8 — no fluid-density dependency entered the suction check', () => {
  it('a stated service with a density changes nothing', () => {
    const heavy: Fluid[] = [{
      id: 'acid', name: 'Acid', color: '#cc0', densityKgM3: 1840,
      viscosityMPaS: 25, heatCapacityKJkgK: 1.4, referenceCondition: '20 °C, 1 atm',
    }]
    // `suctionChecks` compiles its own model with no service list by design.
    // Proven here against the solver, which DOES take one: the source node
    // pressure is the same either way, because a source pressure is not a head.
    const r = at('TK-0', '10 barg')
    expect(solverSourcePressure(fromVessel(), r, heavy))
      .toBeCloseTo(solverSourcePressure(fromVessel(), r, []), 12)
    expect(checkOf(fromVessel(), r).sourcePressure)
      .toBeCloseTo(solverSourcePressure(fromVessel(), r, heavy), 9)
  })
})

// ═══ 11. Everything else is as it was ═══════════════════════════════════════

describe('§10.11 — only the source pressure changed', () => {
  it('resistance, rated flow and the law are identical', () => {
    const vented = checkOf(fromVessel(), at('TK-0'))
    const high = checkOf(fromVessel(), at('TK-0', '10 barg'))
    expect(high.resistance).toBeCloseTo(vented.resistance!, 12)
    expect(high.ratedFlow).toBe(vented.ratedFlow)
    expect(high.ratedDefaulted).toBe(vented.ratedDefaulted)
    expect(high.source).toEqual(vented.source)
    // and the law relating them is untouched: maxFlow = √(P/R)
    expect(high.maxFlow).toBeCloseTo(Math.sqrt(high.sourcePressure! / high.resistance!), 6)
    expect(high.suctionAtRated)
      .toBeCloseTo(high.sourcePressure! - high.resistance! * high.ratedFlow ** 2, 9)
  })

  it('an unsupplied suction is still unsupplied — no source, no pressure', () => {
    const orphan: HmiScreen = {
      ...createScreen(1), id: 'scr1', name: 'Unit',
      widgets: [{ id: 'p', type: 'pump', x: 400, y: 90, w: 56, h: 56, tag: 'P-1' }],
      pipes: [],
    }
    expect(checkOf(orphan, PUMP).state).toBe('unsupplied')
    expect(checkOf(orphan, PUMP).sourcePressure).toBeUndefined()
  })
})
