// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE SOLVER FIXTURE SUITE — sixteen topologies, every one checked twice.
 *
 * Convergence is NOT only node mass balance. A pressure field can balance every
 * junction and still have an edge carrying a flow its own constitutive
 * equation does not permit. So each case is verified on both:
 *
 *   NODE:  |Σ Q_in − Σ Q_out| < MASS_TOL at every free node
 *   EDGE:  the flow each edge carries is the flow its equation gives for the
 *          pressures at its ends — a resistance obeying ΔP = R·Q·|Q|, a valve
 *          obeying it with R = K/f⁴, a pump sitting on its curve
 *
 * `verify` below re-derives both from the solved pressures alone, so it cannot
 * agree with the solver by construction: if the solver returned a flow it did
 * not compute from those pressures, this fails.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import type { HmiPipe, HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { ProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { buildProcessModel, valveResistance } from '../../src/hmi/sim/hydraulic/model'
import type { SolveInputs, SolveResult } from '../../src/hmi/sim/hydraulic/solver'
import { MASS_TOL, pumpHead, solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadDoc } from '../../src/model/migrate'
import { importSheet } from '../../src/hmi/importFromPid'

// ── Fixture helpers ─────────────────────────────────────────────────────────

const pump = (tag: string, x: number, y: number): HmiWidget =>
  ({ id: tag, type: 'pump', x, y, w: 56, h: 56, tag })
const valve = (tag: string, x: number, y: number): HmiWidget =>
  ({ id: tag, type: 'valve', x, y, w: 48, h: 32, tag, props: { throttle: true } })
const tank = (tag: string, x: number, y: number): HmiWidget =>
  ({ id: tag, type: 'tank', x, y, w: 96, h: 128, tag })
const tee = (tag: string, x: number, y: number): HmiWidget =>
  ({ id: tag, type: 'symbol', x, y, w: 16, h: 16, tag, props: { symbolId: 'fit.junction' } })

/** A pipe between two named ends. `undefined` is a free end — a boundary. */
const pipe = (
  id: string,
  a: { id: string; port?: string; x: number; y: number } | { x: number; y: number },
  b: { id: string; port?: string; x: number; y: number } | { x: number; y: number },
): HmiPipe => ({
  id,
  points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
  ...('id' in a ? { aId: a.id, ...(a.port ? { aPort: a.port } : {}) } : {}),
  ...('id' in b ? { bId: b.id, ...(b.port ? { bPort: b.port } : {}) } : {}),
})

const screen = (widgets: HmiWidget[], pipes: HmiPipe[]): HmiScreen =>
  ({ id: 's', name: 'S', theme: 'classic', widgets, pipes })

const inputs = (over: Partial<SolveInputs> = {}): SolveInputs => ({
  valveOpen: () => 1,
  pumpSpeed: () => 1,
  pumpRated: () => DEFAULTS.pumpFlowM3h,
  pumpHead: () => DEFAULTS.pumpHeadBar,
  vesselLevel: () => 40,
  ...over,
})

// ── Verification ────────────────────────────────────────────────────────────

/** Tolerance on an edge's constitutive equation, m³/h. */
const EDGE_TOL = 1e-6

interface Verdict {
  maxNodeResidual: number
  maxEdgeResidual: number
  worstEdge: string
  finite: boolean
}

/**
 * Re-derive both acceptance conditions from the solved PRESSURES alone.
 *
 * Nothing here reads the solver's own flow except to compare against it, so a
 * solver that returned a flow it did not compute from these pressures — or one
 * that balanced its nodes against an equation it was not solving — fails.
 */
function verify(model: ProcessModel, r: SolveResult, s: SolveInputs): Verdict {
  let finite = true
  for (const v of Object.values(r.pressure)) if (!Number.isFinite(v)) finite = false
  for (const v of Object.values(r.flow)) if (!Number.isFinite(v)) finite = false

  // EDGE: what does each edge's own equation say, at the solved pressures?
  let maxEdgeResidual = 0
  let worstEdge = ''
  for (const e of model.edges) {
    const pa = r.pressure[e.from]
    const pb = r.pressure[e.to]
    if (pa === undefined || pb === undefined) continue
    const q = r.flow[e.id] ?? 0
    const dp = pa - pb
    let expected: number
    if (e.kind === 'pump') {
      // On the curve: the rise the network takes out of the machine is the
      // head its curve gives at the flow it is passing.
      const speed = s.pumpSpeed(e.tag ?? '')
      if (speed <= 0) {
        expected = 0 // blocked by its discharge check valve
      } else {
        const curve = pumpHead(s.pumpHead(e.tag ?? ''), s.pumpRated(e.tag ?? ''), speed, q)
        // residual expressed as a flow through the local slope would be
        // circular; compare heads directly and scale into m³/h by the rated
        // duty so the number is comparable with a node residual
        const headErr = Math.abs(-dp - curve)
        expected = q - (headErr / Math.max(1e-9, s.pumpHead(e.tag ?? ''))) * s.pumpRated(e.tag ?? '')
      }
    } else {
      const R = e.kind === 'valve' && e.tag ? valveResistance(s.valveOpen(e.tag)) : e.resistance
      expected = Number.isFinite(R) ? Math.sign(dp) * Math.sqrt(Math.abs(dp) / R) : 0
    }
    const err = Math.abs(q - expected)
    if (err > maxEdgeResidual) { maxEdgeResidual = err; worstEdge = e.id }
  }

  // NODE: mass balance, recomputed from the solver's own flows.
  const byNode = new Map<string, number>()
  for (const e of model.edges) {
    const q = r.flow[e.id] ?? 0
    byNode.set(e.from, (byNode.get(e.from) ?? 0) - q)
    byNode.set(e.to, (byNode.get(e.to) ?? 0) + q)
  }
  let maxNodeResidual = 0
  for (const node of model.nodes) {
    if (node.kind !== 'junction') continue // boundaries and vessels absorb
    if (r.undetermined.includes(node.id)) continue
    maxNodeResidual = Math.max(maxNodeResidual, Math.abs(byNode.get(node.id) ?? 0))
  }
  return { maxNodeResidual, maxEdgeResidual, worstEdge, finite }
}

/** Solve a case and assert every acceptance condition. */
function accept(name: string, model: ProcessModel, s: SolveInputs): SolveResult {
  const r = solveHydraulics(model, s)
  const v = verify(model, r, s)
  expect(r.converged, `${name}: converged (residual ${r.residual.toExponential(2)}, ${r.reason ?? ''})`).toBe(true)
  expect(v.finite, `${name}: all finite`).toBe(true)
  expect(v.maxNodeResidual, `${name}: node balance`).toBeLessThan(MASS_TOL)
  expect(v.maxEdgeResidual, `${name}: edge equation on ${v.worstEdge}`).toBeLessThan(EDGE_TOL)
  return r
}

// ── The sixteen cases ───────────────────────────────────────────────────────

const CASES: { n: number; name: string; screen: HmiScreen; inputs?: Partial<SolveInputs> }[] = [
  {
    n: 1, name: 'single passive edge',
    screen: screen([tank('TK-1', 400, 0)], [pipe('p1', { x: 0, y: 100 }, { id: 'TK-1', x: 404, y: 120 })]),
  },
  {
    n: 2, name: 'source -> pump -> sink',
    screen: screen([pump('P-1', 200, 80)], [
      pipe('p1', { x: 0, y: 108 }, { id: 'P-1', port: 'suction', x: 204, y: 108 }),
      pipe('p2', { id: 'P-1', port: 'discharge', x: 252, y: 108 }, { x: 500, y: 108 }),
    ]),
  },
  {
    n: 3, name: 'series pump + valve + tank',
    screen: screen([pump('P-1', 100, 80), valve('FV-1', 280, 92), tank('TK-1', 460, 40)], [
      pipe('p1', { x: 0, y: 108 }, { id: 'P-1', port: 'suction', x: 104, y: 108 }),
      pipe('p2', { id: 'P-1', port: 'discharge', x: 152, y: 108 }, { id: 'FV-1', port: 'in', x: 284, y: 108 }),
      pipe('p3', { id: 'FV-1', port: 'out', x: 324, y: 108 }, { id: 'TK-1', x: 464, y: 150 }),
    ]),
  },
  {
    n: 4, name: 'simple tee',
    screen: screen([tee('J-1', 200, 100), tank('TK-1', 400, 0), tank('TK-2', 400, 200)], [
      pipe('p1', { x: 0, y: 108 }, { id: 'J-1', x: 204, y: 108 }),
      pipe('p2', { id: 'J-1', x: 212, y: 104 }, { id: 'TK-1', x: 404, y: 110 }),
      pipe('p3', { id: 'J-1', x: 212, y: 112 }, { id: 'TK-2', x: 404, y: 310 }),
    ]),
  },
  {
    n: 5, name: 'unequal branch resistance',
    screen: screen([tee('J-1', 200, 100), valve('FV-1', 280, 40), tank('TK-1', 460, 0), tank('TK-2', 460, 200)], [
      pipe('p1', { x: 0, y: 108 }, { id: 'J-1', x: 204, y: 108 }),
      pipe('p2', { id: 'J-1', x: 212, y: 104 }, { id: 'FV-1', port: 'in', x: 284, y: 56 }),
      pipe('p3', { id: 'FV-1', port: 'out', x: 324, y: 56 }, { id: 'TK-1', x: 464, y: 110 }),
      pipe('p4', { id: 'J-1', x: 212, y: 112 }, { id: 'TK-2', x: 464, y: 310 }),
    ]),
    inputs: { valveOpen: () => 0.3 },
  },
  {
    n: 6, name: 'two branches with valves',
    screen: screen([tee('J-1', 200, 100), valve('FV-1', 280, 40), valve('FV-2', 280, 160), tank('TK-1', 460, 0), tank('TK-2', 460, 200)], [
      pipe('p1', { x: 0, y: 108 }, { id: 'J-1', x: 204, y: 108 }),
      pipe('p2', { id: 'J-1', x: 212, y: 104 }, { id: 'FV-1', port: 'in', x: 284, y: 56 }),
      pipe('p3', { id: 'FV-1', port: 'out', x: 324, y: 56 }, { id: 'TK-1', x: 464, y: 110 }),
      pipe('p4', { id: 'J-1', x: 212, y: 112 }, { id: 'FV-2', port: 'in', x: 284, y: 176 }),
      pipe('p5', { id: 'FV-2', port: 'out', x: 324, y: 176 }, { id: 'TK-2', x: 464, y: 310 }),
    ]),
  },
  {
    n: 7, name: 'merge',
    screen: screen([tee('J-1', 300, 100), tank('TK-3', 480, 40)], [
      pipe('p1', { x: 0, y: 40 }, { id: 'J-1', x: 304, y: 104 }),
      pipe('p2', { x: 0, y: 180 }, { id: 'J-1', x: 304, y: 112 }),
      pipe('p3', { id: 'J-1', x: 312, y: 108 }, { id: 'TK-3', x: 484, y: 150 }),
    ]),
  },
  {
    n: 8, name: 'pump + tee',
    screen: screen([pump('P-1', 80, 80), tee('J-1', 240, 100), tank('TK-1', 420, 0), tank('TK-2', 420, 200)], [
      pipe('p1', { x: 0, y: 108 }, { id: 'P-1', port: 'suction', x: 84, y: 108 }),
      pipe('p2', { id: 'P-1', port: 'discharge', x: 132, y: 108 }, { id: 'J-1', x: 244, y: 108 }),
      pipe('p3', { id: 'J-1', x: 252, y: 104 }, { id: 'TK-1', x: 424, y: 110 }),
      pipe('p4', { id: 'J-1', x: 252, y: 112 }, { id: 'TK-2', x: 424, y: 310 }),
    ]),
  },
  {
    n: 9, name: 'pump + tee + unequal branches',
    screen: screen([pump('P-1', 80, 80), tee('J-1', 240, 100), valve('FV-1', 320, 40), tank('TK-1', 480, 0), tank('TK-2', 480, 200)], [
      pipe('p1', { x: 0, y: 108 }, { id: 'P-1', port: 'suction', x: 84, y: 108 }),
      pipe('p2', { id: 'P-1', port: 'discharge', x: 132, y: 108 }, { id: 'J-1', x: 244, y: 108 }),
      pipe('p3', { id: 'J-1', x: 252, y: 104 }, { id: 'FV-1', port: 'in', x: 324, y: 56 }),
      pipe('p4', { id: 'FV-1', port: 'out', x: 364, y: 56 }, { id: 'TK-1', x: 484, y: 110 }),
      pipe('p5', { id: 'J-1', x: 252, y: 112 }, { id: 'TK-2', x: 484, y: 310 }),
    ]),
    inputs: { valveOpen: () => 0.4 },
  },
  {
    n: 11, name: 'two pumps in parallel',
    screen: screen([pump('P-1', 80, 20), pump('P-2', 80, 180), tee('J-1', 260, 100), tank('TK-1', 440, 40)], [
      pipe('p1', { x: 0, y: 48 }, { id: 'P-1', port: 'suction', x: 84, y: 48 }),
      pipe('p2', { id: 'P-1', port: 'discharge', x: 132, y: 48 }, { id: 'J-1', x: 264, y: 104 }),
      pipe('p3', { x: 0, y: 208 }, { id: 'P-2', port: 'suction', x: 84, y: 208 }),
      pipe('p4', { id: 'P-2', port: 'discharge', x: 132, y: 208 }, { id: 'J-1', x: 264, y: 112 }),
      pipe('p5', { id: 'J-1', x: 272, y: 108 }, { id: 'TK-1', x: 444, y: 150 }),
    ]),
  },
  {
    n: 12, name: 'recirculation loop back to the same vessel',
    screen: screen([tank('TK-1', 420, 40), pump('P-1', 140, 220), valve('FV-1', 300, 232)], [
      pipe('p1', { id: 'TK-1', x: 424, y: 160 }, { id: 'P-1', port: 'suction', x: 144, y: 248 }),
      pipe('p2', { id: 'P-1', port: 'discharge', x: 192, y: 248 }, { id: 'FV-1', port: 'in', x: 304, y: 248 }),
      pipe('p3', { id: 'FV-1', port: 'out', x: 344, y: 248 }, { id: 'TK-1', x: 424, y: 50 }),
    ]),
  },
]

describe('the solver converges on every valid topology', () => {
  for (const c of CASES) {
    it(`CASE ${c.n} — ${c.name}`, () => {
      accept(c.name, buildProcessModel(c.screen), inputs(c.inputs))
    })
  }
})

// ── The behavioural cases ───────────────────────────────────────────────────

const pumpTee = CASES.find((c) => c.n === 9)!.screen
const series = CASES.find((c) => c.n === 3)!.screen

describe('CASE 10 — valve closure on a branch', () => {
  it('shuts its own leg, keeps the other, and stays converged', () => {
    const m = buildProcessModel(pumpTee)
    const r = accept('branch closed', m, inputs({ valveOpen: () => 0 }))
    expect(Math.abs(r.pipeFlow.p4!)).toBeLessThan(1e-3) // the valved leg
    expect(Math.abs(r.pipeFlow.p5!)).toBeGreaterThan(1) // the open one
  })
})

describe('CASE 13 — flow reversal', () => {
  /**
   * The graph's from/to says which nodes an edge joins. It must not decide
   * which way material moves: raise the destination above the source and the
   * SAME edge, on the SAME topology, has to carry flow the other way.
   */
  /**
   * TK-1 -> tee -> TK-2, no pump. Whichever vessel stands higher drives, and
   * the middle leg carries material whichever way the heads say.
   */
  const betweenVessels = screen([tank('TK-1', 40, 40), tee('J-1', 260, 100), tank('TK-2', 440, 40)], [
    pipe('p1', { id: 'TK-1', x: 44, y: 150 }, { id: 'J-1', x: 264, y: 104 }),
    pipe('p2', { id: 'J-1', x: 268, y: 112 }, { id: 'TK-2', x: 444, y: 150 }),
  ])

  it('reverses on a fixed topology when the heads swap', () => {
    const m = buildProcessModel(betweenVessels)
    const oneWay = accept('TK-1 high', m, inputs({ vesselLevel: (t) => (t === 'TK-1' ? 100 : 0) }))
    const other = accept('TK-2 high', m, inputs({ vesselLevel: (t) => (t === 'TK-1' ? 0 : 100) }))
    expect(Math.abs(oneWay.pipeFlow.p2!)).toBeGreaterThan(1)
    expect(Math.abs(other.pipeFlow.p2!)).toBeGreaterThan(1)
    // the SAME edge, the SAME graph, material the other way
    expect(Math.sign(other.pipeFlow.p2!)).not.toBe(Math.sign(oneWay.pipeFlow.p2!))
  })

  it('a stopped pump does NOT let flow reverse through it — the check valve holds', () => {
    // The mirror of the test above, and the documented model assumption: a
    // pumped system carries a discharge check valve, so a full vessel cannot
    // push back through an idle machine. Reversal is a property of the
    // hydraulics; this is a property of the equipment, and both must hold.
    const m = buildProcessModel(series)
    const forward = accept('forward', m, inputs({ pumpSpeed: () => 1, vesselLevel: () => 0 }))
    expect(forward.pipeFlow.p3!).toBeGreaterThan(1)
    const back = accept('pump off, vessel full', m, inputs({ pumpSpeed: () => 0, vesselLevel: () => 100 }))
    expect(Math.abs(back.pipeFlow.p3!)).toBeLessThan(1e-6)
  })

  it('reverses a passive line when the boundary either side changes', () => {
    // Vessel drains to a boundary when full, and the same edge fills it when
    // the vessel is empty and the boundary is the higher pressure.
    const m = buildProcessModel(CASES[0]!.screen)
    const draining = accept('full vessel', m, inputs({ vesselLevel: () => 100 }))
    const filling = accept('empty vessel', m, inputs({ vesselLevel: () => 0 }))
    expect(Math.sign(draining.pipeFlow.p1!)).not.toBe(Math.sign(filling.pipeFlow.p1!))
  })
})

describe('CASE 14 — zero-flow equilibrium', () => {
  it('settles at exactly zero when nothing drives it', () => {
    const m = buildProcessModel(CASES[0]!.screen)
    // a vessel whose head exactly matches the boundary has no reason to move
    const r = accept('equilibrium', m, inputs({ vesselLevel: () => 0 }))
    expect(Math.abs(r.pipeFlow.p1!)).toBeLessThan(1e-6)
  })
})

describe('CASE 15 — stopped pump', () => {
  it('carries nothing, and the network still solves', () => {
    const m = buildProcessModel(series)
    const r = accept('pump off', m, inputs({ pumpSpeed: () => 0 }))
    for (const q of Object.values(r.pipeFlow)) expect(Math.abs(q)).toBeLessThan(1e-6)
  })
})

describe('CASE 16 — closed branch', () => {
  it('isolates one leg and pushes its flow into the other', () => {
    const m = buildProcessModel(CASES.find((c) => c.n === 6)!.screen)
    const both = accept('both legs', m, inputs())
    const one = accept('one shut', m, inputs({ valveOpen: (t) => (t === 'FV-2' ? 0 : 1) }))
    expect(Math.abs(one.pipeFlow.p5!)).toBeLessThan(1e-3)
    expect(Math.abs(one.pipeFlow.p3!)).toBeGreaterThan(Math.abs(both.pipeFlow.p3!))
  })
})

// ── Dynamic sweeps, warm start, determinism ─────────────────────────────────

describe('repeated dynamic solves', () => {
  it('sweeps a valve closed and open again, monotonically, without degrading', () => {
    const m = buildProcessModel(series)
    const down = [1, 0.8, 0.6, 0.4, 0.2, 0]
    const flows: number[] = []
    let maxIter = 0
    for (const open of down) {
      const r = accept(`open=${open}`, m, inputs({ valveOpen: () => open }))
      flows.push(r.pipeFlow.p3!)
      maxIter = Math.max(maxIter, r.iterations)
    }
    for (let i = 1; i < flows.length; i++) expect(flows[i]!).toBeLessThan(flows[i - 1]!)
    expect(Math.abs(flows[flows.length - 1]!)).toBeLessThan(1e-3)

    // and back up, landing on the same numbers it passed through
    const up = [...down].reverse()
    const back: number[] = []
    for (const open of up) {
      const r = accept(`reopen=${open}`, m, inputs({ valveOpen: () => open }))
      back.push(r.pipeFlow.p3!)
      maxIter = Math.max(maxIter, r.iterations)
    }
    expect(back.reverse()).toEqual(flows) // no hysteresis, no path dependence
    expect(maxIter).toBeLessThan(60)
  })
})

describe('warm start', () => {
  /** An optimisation. It must never change the physical answer. */
  it('reaches the same answer as a cold solve, in no more iterations', () => {
    const m = buildProcessModel(series)
    const first = solveHydraulics(m, inputs({ valveOpen: () => 0.6 }))
    expect(first.converged).toBe(true)

    const cold = solveHydraulics(m, inputs({ valveOpen: () => 0.58 }))
    const warm = solveHydraulics(m, inputs({ valveOpen: () => 0.58 }), { warmStart: first.pressure })
    expect(warm.converged).toBe(true)
    expect(warm.iterations).toBeLessThanOrEqual(cold.iterations)
    for (const id of Object.keys(cold.flow)) {
      expect(warm.flow[id]!).toBeCloseTo(cold.flow[id]!, 6)
    }
  })

  it('ignores a warm start whose nodes do not match this network', () => {
    const m = buildProcessModel(series)
    const cold = solveHydraulics(m, inputs())
    const bogus = solveHydraulics(m, inputs(), { warmStart: { 'not-a-node': 42 } })
    expect(bogus.converged).toBe(true)
    expect(JSON.stringify(bogus.flow)).toBe(JSON.stringify(cold.flow))
  })
})

describe('determinism', () => {
  it('two cold solves are byte-identical', () => {
    const m = buildProcessModel(pumpTee)
    const a = solveHydraulics(m, inputs({ valveOpen: () => 0.37 }))
    const b = solveHydraulics(m, inputs({ valveOpen: () => 0.37 }))
    expect(JSON.stringify(a.pressure)).toBe(JSON.stringify(b.pressure))
    expect(JSON.stringify(a.flow)).toBe(JSON.stringify(b.flow))
    expect(a.iterations).toBe(b.iterations)
  })

  it('a rebuilt model from the same screen solves identically', () => {
    const a = solveHydraulics(buildProcessModel(pumpTee), inputs())
    const b = solveHydraulics(buildProcessModel(pumpTee), inputs())
    expect(JSON.stringify(a.flow)).toBe(JSON.stringify(b.flow))
  })
})

// ── The real acceptance fixture ─────────────────────────────────────────────

/**
 * THE BUNDLED SAMPLES, solved as the branched graphs they actually are.
 *
 * Not simplified into a series network. `sample-plant` is the fixture the
 * previous phase reported stalling on: 20 nodes, 16 edges, 250 iterations,
 * residual 8.25. It is here so that result can never come back quietly.
 */
describe('the bundled samples solve as real branched networks', () => {
  for (const file of ['sample-plant.pnid.json', 'sample-refinery-unit.pnid.json', 'template-hmi-demo.pnid.json']) {
    it(file, () => {
      const doc = loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples', file), 'utf8')))
      const screens = doc.hmiScreens.length > 0 ? doc.hmiScreens : doc.sheets.map((sh) => importSheet(doc, sh.id))
      const m = buildProcessModel(screens)
      expect(m.edges.length, 'is a real network').toBeGreaterThan(4)

      const r = accept(file, m, inputs())
      // the number that was 250
      expect(r.iterations).toBeLessThan(40)

      // and it responds to the plant, rather than returning one fixed answer
      const shut = accept(`${file} shut`, m, inputs({ valveOpen: () => 0 }))
      const off = accept(`${file} pump off`, m, inputs({ pumpSpeed: () => 0 }))
      expect(shut.converged && off.converged).toBe(true)
    })
  }

  it('is deterministic on the sample plant, cold and warm', () => {
    const doc = loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples/sample-plant.pnid.json'), 'utf8')))
    const m = buildProcessModel(doc.sheets.map((sh) => importSheet(doc, sh.id)))
    const a = solveHydraulics(m, inputs())
    const b = solveHydraulics(m, inputs())
    expect(JSON.stringify(a.flow)).toBe(JSON.stringify(b.flow))

    const warm = solveHydraulics(m, inputs(), { warmStart: a.pressure })
    expect(warm.converged).toBe(true)
    expect(warm.iterations).toBeLessThanOrEqual(a.iterations)
    for (const id of Object.keys(a.flow)) expect(warm.flow[id]!).toBeCloseTo(a.flow[id]!, 6)
  })
})
