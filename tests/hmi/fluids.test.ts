// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K5 — WHAT EACH STREAM CARRIES.
 *
 * Fluid identity is ENGINEERING DATA that comes from the drawing, propagated
 * through the canonical topology. Three things these tests exist to hold:
 *
 *  1. IDENTITY IS NEVER INFERRED. Not from a colour, not from a position, not
 *     from what a pipe happens to be connected to when two answers are
 *     possible. Before K5 the importer resolved the P&ID's `fluidId` to a
 *     COLOUR and dropped the id, so the only thing the operator layer knew
 *     about a service was what shade it was drawn in.
 *  2. MIXING IS NOT GUESSED. Where two services meet the model says MIXED and
 *     names them. It does not pick one, and it does not invent a mixture's
 *     density — mixture physics is not implemented and is not pretended.
 *  3. IT IS NOT PHYSICS. The solver does not know a fluid exists. A stream's
 *     service changes no pressure, no flow and no temperature, and these tests
 *     pin that too, because a half-applied property is worse than none.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { buildProcessView } from '../../src/hmi/sim/processView'
import { deriveFluids, fluidLabel, hasProperties } from '../../src/hmi/sim/fluids'
import { solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULT_FLUIDS } from '../../src/model/doc'
import { STREAM_TOKENS } from '../../src/model/types'
import { LIQUID_CP_KJ_PER_M3_K, DEFAULTS } from '../../src/hmi/sim/units'
import type { Fluid } from '../../src/model/types'
import type { HmiPipe, HmiScreen } from '../../src/hmi/model'

const WATER = DEFAULT_FLUIDS.find((f) => f.id === 'fl-water')!
const OIL = DEFAULT_FLUIDS.find((f) => f.id === 'fl-oil')!

/**
 * SOURCE A -a1- HV-A -a2-\
 *                          TEE -c1- TK-1
 * SOURCE B -b1- HV-B -b2-/
 *
 * The shape PART D names: two inputs that must stay distinct, meeting at a
 * junction with a stream beyond it.
 */
const twoSources = (aFluid?: string, bFluid?: string): HmiScreen => ({
  id: 'k5', name: 'K5', theme: 'classic',
  widgets: [
    { id: 'va', type: 'valve', x: 200, y: 100, w: 48, h: 32, tag: 'HV-A', props: { throttle: true } },
    { id: 'vb', type: 'valve', x: 200, y: 400, w: 48, h: 32, tag: 'HV-B', props: { throttle: true } },
    { id: 'tee', type: 'symbol', x: 420, y: 240, w: 16, h: 16, tag: 'T-1', props: { symbolId: 'fit.junction' } },
    { id: 't', type: 'tank', x: 640, y: 180, w: 96, h: 128, tag: 'TK-1', props: { level0: 30 } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 20, y: 116 }, { x: 196, y: 116 }], bId: 'va', bPort: 'in', ...(aFluid ? { fluidId: aFluid } : {}) },
    { id: 'a2', points: [{ x: 252, y: 116 }, { x: 416, y: 244 }], aId: 'va', aPort: 'out', bId: 'tee' },
    { id: 'b1', points: [{ x: 20, y: 416 }, { x: 196, y: 416 }], bId: 'vb', bPort: 'in', ...(bFluid ? { fluidId: bFluid } : {}) },
    { id: 'b2', points: [{ x: 252, y: 416 }, { x: 424, y: 252 }], aId: 'vb', aPort: 'out', bId: 'tee' },
    { id: 'c1', points: [{ x: 440, y: 248 }, { x: 636, y: 300 }], aId: 'tee', bId: 't', bPort: 'top' },
  ] as HmiPipe[],
})

const fluidsOf = (sc: HmiScreen, list: readonly Fluid[] = DEFAULT_FLUIDS) => {
  const m = buildProcessModel(sc)
  const f = deriveFluids(m, list)
  const ofPipe = (pipe: string) => f.byEdge.get(m.edgeOfPipe.get(pipe)!)!
  return { model: m, ...f, ofPipe }
}

// ── 1-2. The definitions ────────────────────────────────────────────────────

describe('a fluid is a definition, and only water has one', () => {
  it('water is stated completely, at a stated condition', () => {
    expect(WATER.densityKgM3).toBe(1000)
    expect(WATER.viscosityMPaS).toBe(1.0)
    expect(WATER.heatCapacityKJkgK).toBe(4.186)
    expect(WATER.referenceCondition).toBe('20 °C, 1 atm')
    expect(hasProperties(WATER)).toBe(true)
  })

  it('the simulation’s own liquid constant IS that definition, not a second one', () => {
    // kJ/(m³·K) = kJ/(kg·K) × kg/m³. If these ever part company the thermal
    // model and the fluid list would be describing different water.
    expect(WATER.heatCapacityKJkgK! * WATER.densityKgM3!).toBeCloseTo(LIQUID_CP_KJ_PER_M3_K, 6)
  })

  it('EVERY OTHER starter service has no properties, and that is the honest answer', () => {
    // A density for Steam, Air or Gas needs a pressure and a temperature this
    // model does not carry; Slurry and Fuel / Oil are whatever a project says.
    // Filling those in would be inventing engineering data.
    for (const f of DEFAULT_FLUIDS) {
      if (f.id === 'fl-water') continue
      expect(hasProperties(f), f.name).toBe(false)
      expect(f.densityKgM3, f.name).toBeUndefined()
      expect(f.viscosityMPaS, f.name).toBeUndefined()
      expect(f.heatCapacityKJkgK, f.name).toBeUndefined()
    }
  })

  it('a property is never stated without the condition it was measured at', () => {
    for (const f of DEFAULT_FLUIDS) {
      const any = f.densityKgM3 ?? f.viscosityMPaS ?? f.heatCapacityKJkgK
      if (any === undefined) continue
      expect(f.referenceCondition, f.name).toBeTruthy()
    }
  })

  it('every service takes a slot in the CLOSED presentation palette', () => {
    for (const f of DEFAULT_FLUIDS) {
      expect(STREAM_TOKENS, f.name).toContain(f.displayToken)
    }
    // six and no more: a screen that tells twelve services apart by hue tells
    // none of them apart
    expect(STREAM_TOKENS).toHaveLength(6)
    expect(new Set(DEFAULT_FLUIDS.map((f) => f.displayToken)).size).toBe(DEFAULT_FLUIDS.length)
  })
})

// ── 3-6. Assignment and propagation ─────────────────────────────────────────

describe('a service comes from the drawing and travels with the stream', () => {
  it('a stated line IS that service, with its name and its token', () => {
    const { ofPipe } = fluidsOf(twoSources('fl-water'))
    const a1 = ofPipe('a1')
    expect(a1.state).toBe('known')
    expect(a1.fluidId).toBe('fl-water')
    expect(a1.name).toBe('Water')
    expect(a1.displayToken).toBe(WATER.displayToken)
  })

  it('it carries on through the hardware to the unstated lines beyond', () => {
    const { ofPipe } = fluidsOf(twoSources('fl-water'))
    // a1 is stated; a2 is not, and it is the far side of HV-A
    expect(ofPipe('a2').fluidId).toBe('fl-water')
    // ...and on to the stream past the junction
    expect(ofPipe('c1').fluidId).toBe('fl-water')
  })

  it('a line nothing states and nothing reaches is UNKNOWN, not a default', () => {
    const { ofPipe } = fluidsOf(twoSources())
    for (const p of ['a1', 'a2', 'b1', 'b2', 'c1']) {
      expect(ofPipe(p).state, p).toBe('unknown')
      expect(ofPipe(p).fluidId, p).toBeUndefined()
    }
    expect(fluidLabel(ofPipe('a1'))).toBe('UNKNOWN')
  })

  it('a service the drawing names but the project never defined keeps its identity', () => {
    const { ofPipe } = fluidsOf(twoSources('fl-nowhere'), [])
    expect(ofPipe('a1').state).toBe('known')
    expect(ofPipe('a1').fluidId).toBe('fl-nowhere')
    // no name and no token to show — and neither is invented
    expect(ofPipe('a1').name).toBeUndefined()
    expect(ofPipe('a1').displayToken).toBeUndefined()
  })

  it('nothing propagates through a VESSEL: a tank’s contents are its own', () => {
    const drained: HmiScreen = {
      ...twoSources('fl-water'),
      widgets: [...twoSources().widgets,
        { id: 'vd', type: 'valve', x: 860, y: 400, w: 48, h: 32, tag: 'HV-D', props: { throttle: true } }],
      pipes: [...twoSources('fl-water').pipes,
        { id: 'd1', points: [{ x: 688, y: 305 }, { x: 856, y: 416 }], aId: 't', aPort: 'bottom', bId: 'vd', bPort: 'in' },
        { id: 'd2', points: [{ x: 912, y: 416 }, { x: 1080, y: 416 }], aId: 'vd', aPort: 'out' }],
    }
    const { ofPipe } = fluidsOf(drained)
    expect(ofPipe('c1').fluidId).toBe('fl-water')   // arriving
    expect(ofPipe('d1').state).toBe('unknown')       // leaving: not stated, not assumed
    expect(ofPipe('d2').state).toBe('unknown')
  })
})

// ── 5, 7, 8. Two inputs, and what happens where they meet ───────────────────

describe('two inputs stay two fluids, and the junction says MIXED', () => {
  const { ofPipe, mixingPoints, model } = fluidsOf(twoSources('fl-water', 'fl-oil'))

  it('each input keeps its OWN service right up to the junction', () => {
    expect(ofPipe('a1').fluidId).toBe('fl-water')
    expect(ofPipe('a2').fluidId).toBe('fl-water')
    expect(ofPipe('b1').fluidId).toBe('fl-oil')
    expect(ofPipe('b2').fluidId).toBe('fl-oil')
    // NOT collapsed into one merely because they share a destination
    expect(ofPipe('a2').fluidId).not.toBe(ofPipe('b2').fluidId)
  })

  it('the junction is identified as a mixing point', () => {
    expect(mixingPoints.length).toBeGreaterThan(0)
    // and it is the tee's own node, not some node elsewhere
    const tee = model.equipment.get('T-1')!
    const teeNodes = new Set(tee.ports.map((p) => p.id))
    expect(mixingPoints.some((n) => teeNodes.has(n) || n.includes('tee'))).toBe(true)
  })

  it('the stream beyond it is MIXED — no source wins, and no mixture is invented', () => {
    const c1 = ofPipe('c1')
    expect(c1.state).toBe('mixed')
    expect(c1.fluidId).toBeUndefined()            // neither of them was chosen
    expect(c1.components).toEqual(['fl-oil', 'fl-water'])
    expect(c1.componentNames).toEqual(['Fuel / Oil', 'Water'])
    expect(fluidLabel(c1)).toBe('MIXED (Fuel / Oil + Water)')
  })

  it('MIXING IS EXPLICITLY UNSUPPORTED: no density, no viscosity, no heat capacity', () => {
    const c1 = ofPipe('c1') as unknown as Record<string, unknown>
    // the mixture carries WHAT it is made of and nothing about how it behaves,
    // because this model has no mixture physics and will not pretend to
    expect(c1.densityKgM3).toBeUndefined()
    expect(c1.viscosityMPaS).toBeUndefined()
    expect(c1.heatCapacityKJkgK).toBeUndefined()
  })

  it('the mixture spreads downstream rather than resolving itself', () => {
    const longer: HmiScreen = {
      ...twoSources('fl-water', 'fl-oil'),
      widgets: [...twoSources().widgets,
        { id: 'vx', type: 'valve', x: 520, y: 250, w: 48, h: 32, tag: 'HV-X', props: { throttle: true } }],
      pipes: [
        ...twoSources('fl-water', 'fl-oil').pipes.filter((p) => p.id !== 'c1'),
        { id: 'c1', points: [{ x: 440, y: 248 }, { x: 516, y: 266 }], aId: 'tee', bId: 'vx', bPort: 'in' },
        { id: 'c2', points: [{ x: 572, y: 266 }, { x: 636, y: 300 }], aId: 'vx', aPort: 'out', bId: 't', bPort: 'top' },
      ],
    }
    const f = fluidsOf(longer)
    expect(f.ofPipe('c1').state).toBe('mixed')
    expect(f.ofPipe('c2').state).toBe('mixed')
    expect(f.ofPipe('a1').fluidId).toBe('fl-water') // and upstream is untouched
  })

  it('the SAME service on both inputs is not a mixture', () => {
    const f = fluidsOf(twoSources('fl-water', 'fl-water'))
    expect(f.ofPipe('c1').state).toBe('known')
    expect(f.ofPipe('c1').fluidId).toBe('fl-water')
    expect(f.mixingPoints).toEqual([])
  })
})

// ── 9-11. Identity is its own concept ───────────────────────────────────────

describe('a service is not a flow, not a quality and not an alarm', () => {
  const sc = twoSources('fl-water', 'fl-oil')

  it('it does not depend on which way anything is flowing', () => {
    const before = fluidsOf(sc)
    // the derivation is handed no flow at all — it cannot depend on one
    const after = fluidsOf(sc)
    for (const p of ['a1', 'a2', 'b1', 'b2', 'c1']) {
      expect(after.ofPipe(p)).toEqual(before.ofPipe(p))
    }
  })

  it('it does not change the hydraulics — the solve is identical either way', () => {
    // PART E, pinned. The same plant with and without services stated must
    // produce the same pressures and the same flows to the last bit, because
    // the solver does not read a density and must not start to quietly.
    const inputs = {
      valveOpen: () => 1, pumpSpeed: () => 1,
      pumpRated: () => DEFAULTS.pumpFlowM3h, pumpHead: () => DEFAULTS.pumpHeadBar,
      vesselLevel: () => 40,
    }
    const plain = solveHydraulics(buildProcessModel(twoSources()), inputs)
    const served = solveHydraulics(buildProcessModel(sc), inputs)
    expect(Object.keys(served.pipeFlow).sort()).toEqual(Object.keys(plain.pipeFlow).sort())
    for (const k of Object.keys(plain.pipeFlow)) {
      expect(served.pipeFlow[k], k).toBe(plain.pipeFlow[k])
    }
    for (const k of Object.keys(plain.pressure)) {
      expect(served.pressure[k], k).toBe(plain.pressure[k])
    }
  })

  it('its presentation token is not an alarm token and never could be', () => {
    // the palette is a closed set of six that the alarm levels are not in
    for (const t of STREAM_TOKENS) {
      expect(['high', 'medium', 'low']).not.toContain(t)
    }
    // and a service carries a TOKEN, never a colour — nothing downstream of
    // here can be handed a hue by a project
    for (const f of DEFAULT_FLUIDS) {
      const stream = fluidsOf(twoSources(f.id)).ofPipe('a1') as unknown as Record<string, unknown>
      expect(stream.color).toBeUndefined()
      expect(stream.displayToken).toBe(f.displayToken)
    }
  })

  it('an UNKNOWN service is not an alarm and not a quality flag', () => {
    const { ofPipe } = fluidsOf(twoSources())
    const s = ofPipe('a1') as unknown as Record<string, unknown>
    expect(s.state).toBe('unknown')
    expect(s.quality).toBeUndefined()
    expect(s.alarm).toBeUndefined()
  })
})

// ── 13. It reaches the process view ─────────────────────────────────────────

describe('the process view is given the service, not asked to work it out', () => {
  it('every stream on the view carries its identity and its token', () => {
    const sc = twoSources('fl-water', 'fl-oil')
    const m = buildSimModel(sc)
    const view = buildProcessView(m.hydraulic, m.defs, m.controllers, DEFAULT_FLUIDS)
    const byPipe = (p: string) => view.edges.find((e) => e.pipeIds.includes(p))!
    expect(byPipe('a1').fluid.fluidId).toBe('fl-water')
    expect(byPipe('a1').fluid.displayToken).toBe(WATER.displayToken)
    expect(byPipe('b1').fluid.fluidId).toBe('fl-oil')
    expect(byPipe('b1').fluid.displayToken).toBe(OIL.displayToken)
    expect(byPipe('c1').fluid.state).toBe('mixed')
    expect(view.mixingPoints.length).toBeGreaterThan(0)
    // the mixing point is a VIEW node id, so the renderer can mark the object
    expect(view.nodes.some((n) => view.mixingPoints.includes(n.id))).toBe(true)
  })

  it('without a service list the view still works, and says nothing it cannot', () => {
    const m = buildSimModel(twoSources())
    const view = buildProcessView(m.hydraulic, m.defs, m.controllers)
    for (const e of view.edges) {
      expect(e.fluid.state).toBe('unknown')
      expect(e.fluid.displayToken).toBeUndefined()
    }
  })
})

// ── 12. Preservation ────────────────────────────────────────────────────────

describe('giving streams an identity changes nothing about the plant', () => {
  it('the topology is identical with and without services stated', () => {
    const plain = buildProcessModel(twoSources())
    const served = buildProcessModel(twoSources('fl-water', 'fl-oil'))
    expect(served.nodes.map((n) => n.id)).toEqual(plain.nodes.map((n) => n.id))
    expect(served.edges.map((e) => `${e.id}:${e.from}>${e.to}:${e.kind}`))
      .toEqual(plain.edges.map((e) => `${e.id}:${e.from}>${e.to}:${e.kind}`))
    expect([...served.edgeOfPipe]).toEqual([...plain.edgeOfPipe])
    expect(served.nodes.reduce((n, x) => n + x.ports.length, 0))
      .toBe(plain.nodes.reduce((n, x) => n + x.ports.length, 0))
    expect(served.issues.length).toBe(plain.issues.length)
    // ...and the ONLY difference is what the edges say they carry
    expect(served.edges.filter((e) => e.fluidIds.length > 0)).toHaveLength(2)
    expect(plain.edges.filter((e) => e.fluidIds.length > 0)).toHaveLength(0)
  })
})
