// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * MANIFOLDS: a header that fans out, and two feeds that fan in.
 *
 * This file used to test `solveFlows`, which split a pump's rating across its
 * open legs in proportion to their conductance. That model is gone — K3.2
 * removed it rather than keeping it beside the hydraulic solve — and a
 * proportional split is not what a tee does anyway: it is an assumption ABOUT
 * the answer, imposed instead of solved.
 *
 * The claims survive and get stronger. Where the old tests asserted a ratio
 * this one asserts MASS BALANCE at the junction and the ORDERING the physics
 * requires, both re-derived from the solved pressure field.
 *
 * `buildNetwork` is still live — the thermal model and the topology view read
 * its branches — so its enumeration is still tested here directly.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import type { HmiPipe, HmiScreen, HmiWidget } from '../../src/hmi/model'
import { buildNetwork } from '../../src/hmi/sim/network'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { MASS_TOL, SHUT_LEAK_MAX, solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
import type { SolveInputs } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'

const W = (id: string, type: HmiWidget['type'], x: number, y: number, w: number, h: number, tag?: string, props?: HmiWidget['props']): HmiWidget =>
  ({ id, type, x, y, w, h, tag, props })
const P = (id: string, pts: [number, number][]): HmiPipe => ({ id, points: pts.map(([x, y]) => ({ x, y })) })
const screen = (widgets: HmiWidget[], pipes: HmiPipe[]): HmiScreen =>
  ({ id: 's', name: 'S', theme: 'classic', widgets, pipes })

// manifold: source -> P-1 -> junction -> two valved legs -> TK-A / TK-B
const manifold = screen(
  [
    W('p1', 'pump', 100, 80, 56, 56, 'P-1'),
    W('j1', 'symbol', 300, 100, 12, 12, undefined, { symbolId: 'fit.junction' }),
    W('va', 'valve', 500, 40, 48, 32, 'LV-A', { throttle: true }),
    W('vb', 'valve', 500, 160, 48, 32, 'LV-B', { throttle: true }),
    W('ta', 'tank', 700, 20, 96, 96, 'TK-A'),
    W('tb', 'tank', 700, 140, 96, 96, 'TK-B'),
  ],
  [
    P('e1', [[0, 106], [100, 106]]),
    P('e2', [[160, 106], [300, 106]]),
    P('e3', [[312, 106], [312, 56], [500, 56]]),
    P('e4', [[550, 56], [700, 56]]),
    P('e5', [[312, 106], [312, 176], [500, 176]]),
    P('e6', [[550, 176], [700, 176]]),
  ],
)

const inputs = (open: { a: number; b: number }, over: Partial<SolveInputs> = {}): SolveInputs => ({
  valveOpen: (tag) => (tag === 'LV-A' ? open.a : open.b),
  pumpSpeed: () => 1,
  pumpRated: () => DEFAULTS.pumpFlowM3h,
  pumpHead: () => DEFAULTS.pumpHeadBar,
  vesselLevel: () => 50,
  ...over,
})

describe('a header that fans out', () => {
  const net = buildNetwork(manifold)
  const m = buildProcessModel(manifold)

  it('enumerates BOTH legs of the manifold (the v1 walker lost one)', () => {
    expect(net.branches).toHaveLength(2)
    const tanks = net.branches.map((b) => (b.to.kind === 'tank' ? b.to.tag : b.to.kind)).sort()
    expect(tanks).toEqual(['TK-A', 'TK-B'])
    for (const b of net.branches) expect(b.pumps).toEqual(['P-1'])
  })

  it('the junction BALANCES: what arrives down the header leaves down the legs', () => {
    const r = solveHydraulics(m, inputs({ a: 1, b: 1 }))
    expect(r.converged).toBe(true)
    // Not a ratio anyone chose — the conservation law itself, to the tolerance
    // the solve is defined to.
    expect(Math.abs(r.pipeFlow.e2! - (r.pipeFlow.e3! + r.pipeFlow.e5!))).toBeLessThan(MASS_TOL)
    // and the two legs are topologically identical — same valve, same number
    // of runs — so they carry EXACTLY the same flow. Pipe resistance in this
    // model is a calibrated constant rather than a function of the drawn
    // length (an HMI pipe carries neither diameter nor length), which is
    // documented, and this is where that shows.
    expect(r.pipeFlow.e3!).toBeCloseTo(r.pipeFlow.e5!, 9)
    expect(r.pipeFlow.e3!).toBeGreaterThan(1)
  })

  it('closing one leg sends the flow down the other', () => {
    const both = solveHydraulics(m, inputs({ a: 1, b: 1 }))
    const shut = solveHydraulics(m, inputs({ a: 0, b: 1 }))
    expect(Math.abs(shut.pipeFlow.e3!)).toBeLessThan(SHUT_LEAK_MAX)
    // and the open leg carries MORE than it did sharing the header — the
    // machine slides back down its curve as the path in front of it opens up
    expect(shut.pipeFlow.e5!).toBeGreaterThan(both.pipeFlow.e5!)
    expect(Math.abs(shut.pipeFlow.e2! - shut.pipeFlow.e5!)).toBeLessThan(MASS_TOL)
  })

  it('a half-open leg carries less, and the header carries the sum either way', () => {
    const r = solveHydraulics(m, inputs({ a: 0.5, b: 1 }))
    expect(r.pipeFlow.e3!).toBeLessThan(r.pipeFlow.e5!)
    expect(r.pipeFlow.e3!).toBeGreaterThan(0.5)
    expect(Math.abs(r.pipeFlow.e2! - (r.pipeFlow.e3! + r.pipeFlow.e5!))).toBeLessThan(MASS_TOL)
    // NOT the conductance model's 1/3 : 2/3. A valve's resistance goes as f⁻⁴
    // and the legs share a pump that responds to the total, so the split is
    // an output of the network rather than a ratio imposed on it.
    expect(Math.abs(r.pipeFlow.e3! / (r.pipeFlow.e3! + r.pipeFlow.e5!) - 1 / 3)).toBeGreaterThan(0.02)
  })

  it('a plugged pipe throttles only the leg crossing it', () => {
    const r = solveHydraulics(m, inputs({ a: 1, b: 1 }, { pipeFactor: (id) => (id === 'e4' ? 0.25 : 1) }))
    expect(r.pipeFlow.e3!).toBeLessThan(r.pipeFlow.e5!)
    // the clean leg is not merely unharmed, it picks up what the plugged one
    // gave up — the pump's duty point moved
    const clean = solveHydraulics(m, inputs({ a: 1, b: 1 }))
    expect(r.pipeFlow.e5!).toBeGreaterThan(clean.pipeFlow.e5!)
  })
})

describe('two feeds that fan in', () => {
  // two tanks gravity-feed one pump into a sink
  const fanIn = screen(
    [
      W('ta', 'tank', 0, 0, 96, 96, 'TK-A'),
      W('tb', 'tank', 0, 200, 96, 96, 'TK-B'),
      W('p1', 'pump', 300, 100, 56, 56, 'P-1'),
    ],
    [
      P('e1', [[96, 90], [300, 128]]),
      P('e2', [[96, 290], [300, 128]]),
      P('e3', [[356, 128], [600, 128]]),
    ],
  )

  it('both inlets reach the pump, and what they bring is what it discharges', () => {
    const net = buildNetwork(fanIn)
    expect(net.branches).toHaveLength(2)
    const r = solveHydraulics(buildProcessModel(fanIn), inputs({ a: 1, b: 1 }))
    expect(r.converged).toBe(true)
    expect(Math.abs(r.pipeFlow.e1! + r.pipeFlow.e2! - r.pipeFlow.e3!)).toBeLessThan(MASS_TOL)
    expect(r.pipeFlow.e3!).toBeGreaterThan(1)
  })
})
