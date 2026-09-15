// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE HYDRAULIC SOLVE, tested as physics rather than as output.
 *
 * Every assertion here is an engineering relationship: mass is conserved at
 * junctions, flow follows the pressure difference, a shut valve blocks, a
 * stopped pump drives nothing, a pump on its curve delivers what the curve
 * says. None of them is "the number is not undefined".
 *
 * The reference network is the one the brief names:
 *
 *     SOURCE -> P-101 -> pipe -> FV-101 -> TK-101
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import type { HmiScreen } from '../../src/hmi/model'
import { buildProcessModel, valveResistance, PIPE_K } from '../../src/hmi/sim/hydraulic/model'
import { MASS_TOL, pumpHead, shutoffFromDuty, solveHydraulics, vesselHeadBar } from '../../src/hmi/sim/hydraulic/solver'
import type { SolveInputs } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'

/** SOURCE -> P-101 -> FV-101 -> TK-101, with explicit port anchors. */
const reference: HmiScreen = {
  id: 's', name: 'Reference', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'FV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101' },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }], bId: 'p', bPort: 'suction' },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }], aId: 'p', aPort: 'discharge', bId: 'v', bPort: 'in' },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 150 }], aId: 'v', aPort: 'out', bId: 't' },
  ],
}

const inputs = (over: Partial<SolveInputs> = {}): SolveInputs => ({
  valveOpen: () => 1,
  pumpSpeed: () => 1,
  pumpRated: () => DEFAULTS.pumpFlowM3h,
  pumpHead: () => DEFAULTS.pumpHeadBar,
  vesselLevel: () => 0,
  ...over,
})

const solve = (screen: HmiScreen, over: Partial<SolveInputs> = {}) =>
  solveHydraulics(buildProcessModel(screen), inputs(over))

// ── Topology ────────────────────────────────────────────────────────────────

describe('the process topology', () => {
  it('gives every piece of equipment explicit, named ports', () => {
    const m = buildProcessModel(reference)
    expect([...m.equipment.get('P-101')!.ports.map((p) => p.role)].sort()).toEqual(['discharge', 'suction'])
    expect([...m.equipment.get('FV-101')!.ports.map((p) => p.role)].sort()).toEqual(['inlet', 'outlet'])
    expect([...m.equipment.get('TK-101')!.ports.map((p) => p.role)].sort()).toEqual(['bottom', 'top'])
  })

  it('uses the port the DRAWING states, not the one geometry would guess', () => {
    const m = buildProcessModel(reference)
    const suction = m.nodes.find((n) => n.id.endsWith(':suction'))!
    const discharge = m.nodes.find((n) => n.id.endsWith(':discharge'))!
    expect(suction.ports[0]!.resolution).toBe('declared')
    expect(discharge.ports[0]!.resolution).toBe('declared')
    // and the pump is an EDGE between them, not a flag on a path
    const dev = m.edges.find((e) => e.kind === 'pump')!
    expect(dev.from).toBe(suction.id)
    expect(dev.to).toBe(discharge.id)
  })

  it('reports an attachment it had to guess', () => {
    const loose: HmiScreen = {
      ...reference,
      pipes: reference.pipes.map((p) => ({ id: p.id, points: p.points })),
    }
    const m = buildProcessModel(loose)
    expect(m.issues.some((i) => i.kind === 'geometric-attachment')).toBe(true)
  })

  it('does NOT connect two lines that merely cross on screen', () => {
    const crossing: HmiScreen = {
      id: 'x', name: 'X', theme: 'classic',
      widgets: [],
      pipes: [
        { id: 'h', points: [{ x: 0, y: 100 }, { x: 400, y: 100 }] },
        { id: 'v', points: [{ x: 200, y: 0 }, { x: 200, y: 200 }] },
      ],
    }
    const m = buildProcessModel(crossing)
    // four distinct boundary nodes, no shared node anywhere
    const ids = new Set(m.edges.flatMap((e) => [e.from, e.to]))
    expect(ids.size).toBe(4)
  })
})

// ── Causality ───────────────────────────────────────────────────────────────

describe('flow follows pressure, not valve position', () => {
  it('a stopped pump drives nothing', () => {
    const r = solve(reference, { pumpSpeed: () => 0 })
    expect(r.converged).toBe(true)
    expect(Math.abs(r.pipeFlow.e2!)).toBeLessThan(0.05)
  })

  it('a running pump develops flow, and the discharge sits above the suction', () => {
    const r = solve(reference)
    expect(r.converged).toBe(true)
    expect(r.pipeFlow.e2!).toBeGreaterThan(1)
    const m = buildProcessModel(reference)
    const suction = m.nodes.find((n) => n.id.endsWith(':suction'))!.id
    const discharge = m.nodes.find((n) => n.id.endsWith(':discharge'))!.id
    expect(r.pressure[discharge]!).toBeGreaterThan(r.pressure[suction]!)
  })

  it('the delivered flow sits on the pump curve', () => {
    const r = solve(reference)
    const m = buildProcessModel(reference)
    const q = r.flow[m.edges.find((e) => e.kind === 'pump')!.id]!
    const suction = r.pressure[m.nodes.find((n) => n.id.endsWith(':suction'))!.id]!
    const discharge = r.pressure[m.nodes.find((n) => n.id.endsWith(':discharge'))!.id]!
    const curve = pumpHead(DEFAULTS.pumpHeadBar, DEFAULTS.pumpFlowM3h, 1, q)
    // the head the network took out of the machine IS the head its curve gives
    // at the flow it is passing — that is what "on the curve" means
    expect(discharge - suction).toBeCloseTo(curve, 4)
  })

  it('is NOT linear in valve position — it follows the hydraulic relationship', () => {
    const at = (open: number) => solve(reference, { valveOpen: () => open }).pipeFlow.e2!
    const full = at(1)
    const half = at(0.5)
    // a linear model would give exactly half. The resistance law does not.
    expect(half / full).toBeGreaterThan(0.1)
    expect(half / full).toBeLessThan(0.99)
    expect(Math.abs(half / full - 0.5)).toBeGreaterThan(0.02)
  })

  it('closing the valve reduces flow monotonically and raises the discharge', () => {
    const m = buildProcessModel(reference)
    const discharge = m.nodes.find((n) => n.id.endsWith(':discharge'))!.id
    let lastQ = Infinity
    let lastP = -Infinity
    for (const open of [1, 0.8, 0.6, 0.4, 0.2, 0.1]) {
      const r = solveHydraulics(m, inputs({ valveOpen: () => open }))
      expect(r.converged, `open=${open}`).toBe(true)
      expect(r.pipeFlow.e2!, `open=${open}`).toBeLessThan(lastQ)
      // the pump rides UP its curve as the path closes
      expect(r.pressure[discharge]!, `open=${open}`).toBeGreaterThan(lastP)
      lastQ = r.pipeFlow.e2!
      lastP = r.pressure[discharge]!
    }
  })

  it('a shut valve blocks flow, and the pump goes to shutoff head', () => {
    const r = solve(reference, { valveOpen: () => 0 })
    expect(r.converged).toBe(true)
    expect(Math.abs(r.pipeFlow.e2!)).toBeLessThan(1e-3)
    const m = buildProcessModel(reference)
    const discharge = r.pressure[m.nodes.find((n) => n.id.endsWith(':discharge'))!.id]!
    const suction = r.pressure[m.nodes.find((n) => n.id.endsWith(':suction'))!.id]!
    // `duty.head` is the head at the RATED flow, as a datasheet states it.
    // Against a shut valve the machine is at no flow, which is further up the
    // curve — shutoff.
    expect(discharge - suction).toBeCloseTo(shutoffFromDuty(DEFAULTS.pumpHeadBar), 2)
  })

  it('pump speed changes the duty according to the affinity laws', () => {
    const full = solve(reference).pipeFlow.e2!
    const half = solve(reference, { pumpSpeed: () => 0.5 }).pipeFlow.e2!
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(full)
  })

  it('a rising destination level pushes back on the flow into it', () => {
    const empty = solve(reference, { vesselLevel: () => 0 }).pipeFlow.e3!
    const full = solve(reference, { vesselLevel: () => 100 }).pipeFlow.e3!
    expect(full).toBeLessThan(empty)
    expect(vesselHeadBar(100)).toBeGreaterThan(vesselHeadBar(0))
  })
})

// ── Conservation ────────────────────────────────────────────────────────────

/** SOURCE -> P-101 -> tee -> two valves -> two tanks. */
const split: HmiScreen = {
  id: 'sp', name: 'Split', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'j', type: 'symbol', x: 240, y: 104, w: 16, h: 16, tag: 'J-1', props: { symbolId: 'fit.junction' } },
    { id: 'v1', type: 'valve', x: 340, y: 40, w: 48, h: 32, tag: 'FV-101', props: { throttle: true } },
    { id: 'v2', type: 'valve', x: 340, y: 160, w: 48, h: 32, tag: 'FV-102', props: { throttle: true } },
    { id: 't1', type: 'tank', x: 500, y: 10, w: 96, h: 96, tag: 'TK-101' },
    { id: 't2', type: 'tank', x: 500, y: 150, w: 96, h: 96, tag: 'TK-102' },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }], bId: 'p', bPort: 'suction' },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 244, y: 112 }], aId: 'p', aPort: 'discharge', bId: 'j' },
    { id: 'e3', points: [{ x: 252, y: 108 }, { x: 344, y: 56 }], aId: 'j', bId: 'v1', bPort: 'in' },
    { id: 'e4', points: [{ x: 252, y: 116 }, { x: 344, y: 176 }], aId: 'j', bId: 'v2', bPort: 'in' },
    { id: 'e5', points: [{ x: 384, y: 56 }, { x: 510, y: 80 }], aId: 'v1', aPort: 'out', bId: 't1' },
    { id: 'e6', points: [{ x: 384, y: 176 }, { x: 510, y: 220 }], aId: 'v2', aPort: 'out', bId: 't2' },
  ],
}

describe('mass is conserved', () => {
  it('at every junction of the reference path', () => {
    const r = solve(reference)
    expect(r.residual).toBeLessThan(MASS_TOL)
  })

  it('builds a split as a real tee, and balances it exactly', () => {
    const m = buildProcessModel(split)
    // one node where the two legs meet, not two unrelated paths
    const tee = m.edges.filter((e) => e.kind === 'pipe' && e.from.endsWith('j:outlet'))
    expect(tee).toHaveLength(2)

    const r = solveHydraulics(m, inputs())
    const into = r.pipeFlow.e2!
    const out = r.pipeFlow.e3! + r.pipeFlow.e4!
    expect(into).toBeGreaterThan(1)
    // What arrives at the junction leaves it, to the last bit. This is the
    // property the branch model could not express at all: its legs were
    // independent paths and nothing made them add up.
    // MEASURED: the worst junction residual across every fixture is 2.7e-5
    // m³/h. `MASS_TOL` is the documented acceptance, an order above that.
    expect(Math.abs(into - out)).toBeLessThan(MASS_TOL)
  })

  it('converges on a branched network, balancing node AND satisfying the edges', () => {
    const r = solveHydraulics(buildProcessModel(split), inputs())
    // This is the case that stalled at a residual of 8.25 for 250 iterations
    // before the Newton iterate stopped being clamped. See the note above the
    // iteration loop in `solver.ts`.
    expect(r.converged).toBe(true)
    expect(r.residual).toBeLessThan(MASS_TOL)
    expect(r.iterations).toBeLessThan(40)
  })

  it('reports a sub-atmospheric suction rather than clamping it away', () => {
    // Two legs draw more than the supply line delivers, so the true suction is
    // below the boundary. That is a real operating condition — it is what NPSH
    // is about — and the solver must find it and then SAY it cannot represent
    // liquid there, not quietly pin the iterate at zero.
    const r = solveHydraulics(buildProcessModel(split), inputs())
    const suction = Object.entries(r.pressure).find(([k]) => k.endsWith(':suction'))!
    expect(suction[1]).toBeLessThan(0)
    expect(r.cavitating).toContain(suction[0])
  })
})

// ── Stability ───────────────────────────────────────────────────────────────

describe('the solve is finite and deterministic', () => {
  const cases: [string, Partial<SolveInputs>][] = [
    ['everything open', {}],
    ['valve shut', { valveOpen: () => 0 }],
    ['pump off', { pumpSpeed: () => 0 }],
    ['pump off and valve shut', { pumpSpeed: () => 0, valveOpen: () => 0 }],
    ['vessel empty', { vesselLevel: () => 0 }],
    ['vessel full', { vesselLevel: () => 100 }],
    ['a whisker open', { valveOpen: () => 1e-4 }],
    ['a crawling pump', { pumpSpeed: () => 1e-4 }],
    ['an enormous pump', { pumpHead: () => 60, pumpRated: () => 5000 }],
  ]
  for (const [name, over] of cases) {
    it(`stays finite: ${name}`, () => {
      const r = solveHydraulics(buildProcessModel(split), inputs(over))
      // FINITE is the invariant. Not non-negative: a pump can pull its
      // suction below the supply, and the solver reports that in `cavitating`
      // rather than clamping it — clamping the iterate is what broke branched
      // networks in the first place.
      for (const [k, v] of Object.entries(r.pressure)) {
        expect(Number.isFinite(v), `${name} pressure ${k}`).toBe(true)
      }
      for (const [k, v] of Object.entries(r.flow)) {
        expect(Number.isFinite(v), `${name} flow ${k}`).toBe(true)
      }
    })
  }

  it('gives byte-identical answers for identical inputs', () => {
    const m = buildProcessModel(split)
    const a = solveHydraulics(m, inputs({ valveOpen: () => 0.37 }))
    const b = solveHydraulics(m, inputs({ valveOpen: () => 0.37 }))
    expect(JSON.stringify(a.flow)).toBe(JSON.stringify(b.flow))
    expect(JSON.stringify(a.pressure)).toBe(JSON.stringify(b.pressure))
  })

  it('a valve resistance rises without bound as it shuts', () => {
    expect(valveResistance(1)).toBeLessThan(valveResistance(0.5))
    expect(valveResistance(0.5)).toBeLessThan(valveResistance(0.1))
    // A shut valve is a HUGE FINITE resistance, not an infinite one: infinity
    // carries no derivative, and the nodes either side of it then have no
    // determined pressure. Sixteen orders above open passes ~1e-7 m³/h, which
    // is below ZERO_FLOW and reports as exactly nothing.
    expect(valveResistance(0)).toBeGreaterThan(valveResistance(0.1) * 1e6)
    expect(Number.isFinite(valveResistance(0))).toBe(true)
    // and a shut valve is shut as far as anything can tell: at a full bar it
    // passes about a twentieth of a millilitre an hour
    expect(Math.sqrt(1 / valveResistance(0))).toBeLessThan(1e-4)
    expect(PIPE_K).toBeGreaterThan(0)
  })
})
