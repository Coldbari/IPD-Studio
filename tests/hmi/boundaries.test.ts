// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K6 — WHAT HOLDS A PRESSURE AT THE EDGE OF THE DRAWING.
 *
 * Every hydraulic network needs somewhere its pressures are fixed rather than
 * solved. This model has three such places, and until K6 all three silently
 * took ONE constant called `supplyPressureBar` — a name that implied a supply
 * header and produced the reasonable-sounding, wrong expectation that a free
 * pipe end could push.
 *
 * It cannot, any more than the air can fill a vented tank. The constant is now
 * `atmosphericPressureBar` and each of the three places says which condition it
 * is:
 *
 *   atmospheric    a free pipe end — the deterministic fallback
 *   vessel-vapour  a vessel's vapour space: atmospheric if vented, held if the
 *                  engineering record states an operating pressure
 *   vessel-liquid  that vapour pressure PLUS the static head above the nozzle
 *
 * WHAT IS NOT HERE is a SOURCE or a SINK. Which end supplies and which receives
 * is an outcome of the solve — the sign of the flow — and making it a property
 * of the topology would let a drawing dictate a direction the pressures
 * contradict. These tests exist partly to hold that line.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { MASS_TOL, SHUT_LEAK_MAX, solveHydraulics, vesselHeadBar } from '../../src/hmi/sim/hydraulic/solver'
import type { SolveInputs } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'
import { ATMOSPHERIC_BAR, operatingPressure, processFor } from '../../src/model/processData'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import { boundaryRole, buildProcessView } from '../../src/hmi/sim/processView'

const inputs = (over: Partial<SolveInputs> = {}): SolveInputs => ({
  valveOpen: () => 1, pumpSpeed: () => 1,
  pumpRated: () => DEFAULTS.pumpFlowM3h, pumpHead: () => DEFAULTS.pumpHeadBar,
  vesselLevel: () => 50,
  ...over,
})

/** TK-A ─p1─ HV-1 ─p2─ TK-B. Two vessels either side of a hand valve, so the
 *  only thing that can drive anything is the difference between them. */
const twoVessels: HmiScreen = {
  id: 'b', name: 'B', theme: 'classic',
  widgets: [
    { id: 'a', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-A', props: { level0: 50 } },
    { id: 'v', type: 'valve', x: 300, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 'b', type: 'tank', x: 600, y: 0, w: 96, h: 128, tag: 'TK-B', props: { level0: 50 } },
  ],
  pipes: [
    { id: 'p1', points: [{ x: 48, y: 120 }, { x: 296, y: 116 }], aId: 'a', aPort: 'bottom', bId: 'v', bPort: 'in' },
    { id: 'p2', points: [{ x: 352, y: 116 }, { x: 648, y: 120 }], aId: 'v', aPort: 'out', bId: 'b', bPort: 'bottom' },
  ],
}

/** A vessel draining to a free end: TK-A ─d1─ HV-2 ─d2─ (atmosphere). */
const toAtmosphere = (nozzle: 'bottom' | 'top'): HmiScreen => ({
  id: 'd', name: 'D', theme: 'classic',
  widgets: [
    { id: 'a', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-A', props: { level0: 50 } },
    { id: 'v', type: 'valve', x: 300, y: 100, w: 48, h: 32, tag: 'HV-2', props: { throttle: true } },
  ],
  pipes: [
    { id: 'd1', points: [{ x: 48, y: 120 }, { x: 296, y: 116 }], aId: 'a', aPort: nozzle, bId: 'v', bPort: 'in' },
    { id: 'd2', points: [{ x: 352, y: 116 }, { x: 700, y: 116 }], aId: 'v', aPort: 'out' },
  ],
})

/** A pressure a vessel's record can state. Gauge, the way a datasheet does. */
const atBarg = (tag: string, barg: number): Registry =>
  ({ [tag]: { key: tag, kind: 'equipment', fields: { 'design.operatingPressure': `${barg} barg` } } })

/** Solve a screen with vessel pressures taken from a registry, as the runtime
 *  does — never from anywhere else. */
const solveWith = (sc: HmiScreen, reg?: Registry, over: Partial<SolveInputs> = {}) => {
  const m = buildSimModel(sc, reg)
  const byName = new Map(m.defs.map((d) => [d.name, d]))
  return {
    model: m,
    r: solveHydraulics(m.hydraulic, inputs({
      vesselPressure: (t) => byName.get(t)?.vesselPressureBarA ?? DEFAULTS.atmosphericPressureBar,
      ...over,
    })),
  }
}

// ── The boundary conditions are named ───────────────────────────────────────

describe('every fixed node says which condition holds it', () => {
  it('a free pipe end is ATMOSPHERIC, and carries the pressure of the air', () => {
    const m = buildProcessModel(toAtmosphere('bottom'))
    const free = m.nodes.filter((n) => n.kind === 'boundary')
    expect(free.length).toBeGreaterThan(0)
    for (const n of free) {
      expect(n.boundary).toBe('atmospheric')
      expect(n.pressureBar).toBe(DEFAULTS.atmosphericPressureBar)
    }
  })

  it('a vessel’s two nozzles are two DIFFERENT conditions', () => {
    const m = buildProcessModel(twoVessels)
    const nodes = m.vesselNodes.get('TK-A')!.map((id) => m.nodes.find((n) => n.id === id)!)
    expect(nodes.map((n) => n.boundary).sort()).toEqual(['vessel-liquid', 'vessel-vapour'])
    // and the liquid one carries no fixed figure, because its pressure moves
    // with the level and is computed each solve
    expect(nodes.find((n) => n.boundary === 'vessel-liquid')!.pressureBar).toBeUndefined()
  })

  it('a junction is INTERNAL — the solver determines it', () => {
    const m = buildProcessModel(twoVessels)
    for (const n of m.nodes) {
      if (n.kind === 'junction') expect(n.boundary, n.id).toBe('internal')
    }
  })

  it('there is no SOURCE and no SINK: direction is the solve’s to decide', () => {
    const kinds = new Set(buildProcessModel(twoVessels).nodes.map((n) => n.boundary))
    expect([...kinds].sort()).toEqual(['internal', 'vessel-liquid', 'vessel-vapour'])
    expect(kinds).not.toContain('source')
    expect(kinds).not.toContain('sink')
  })

  it('the engineering side and the simulator agree on what an atmosphere is', () => {
    // stated twice on purpose — `model/` must not import the simulator — so
    // this is what stops them drifting
    expect(ATMOSPHERIC_BAR).toBe(DEFAULTS.atmosphericPressureBar)
  })
})

// ── A. Equal pressure ───────────────────────────────────────────────────────

describe('A — equal pressures move nothing', () => {
  it('two vented vessels at the same level: no flow, in either direction', () => {
    const { r } = solveWith(twoVessels)
    expect(r.converged).toBe(true)
    expect(Math.abs(r.pipeFlow.p1!)).toBeLessThan(MASS_TOL)
    expect(Math.abs(r.pipeFlow.p2!)).toBeLessThan(MASS_TOL)
  })

  it('a vented vessel’s VAPOUR space against the air: no flow', () => {
    // E, and the point of it: this is a stated physical boundary — vapour space
    // at one atmosphere, air at one atmosphere — and not an accident of two
    // numbers happening to be equal.
    const { model, r } = solveWith(toAtmosphere('top'))
    const top = model.hydraulic.nodes.find((n) => n.boundary === 'vessel-vapour')!
    const air = model.hydraulic.nodes.find((n) => n.boundary === 'atmospheric')!
    expect(r.pressure[top.id]).toBe(DEFAULTS.atmosphericPressureBar)
    expect(r.pressure[air.id]).toBe(DEFAULTS.atmosphericPressureBar)
    expect(Math.abs(r.pipeFlow.d1!)).toBeLessThan(SHUT_LEAK_MAX)
  })
})

// ── B, C. Pressure drives flow, and the sign follows it ─────────────────────

describe('B, C — the higher pressure drives, whichever end it is on', () => {
  it('B: a vessel held ABOVE atmosphere discharges to the air', () => {
    const { r } = solveWith(toAtmosphere('bottom'), atBarg('TK-A', 1))
    expect(r.converged).toBe(true)
    // drawn TK-A -> valve -> air, so a positive flow is outward
    expect(r.pipeFlow.d1!).toBeGreaterThan(1)
    expect(r.pipeFlow.d2!).toBeGreaterThan(1)
  })

  it('B: and it discharges HARDER the higher it is held', () => {
    const q = (barg: number) => solveWith(toAtmosphere('bottom'), atBarg('TK-A', barg)).r.pipeFlow.d1!
    const zero = q(0)
    const one = q(1)
    const two = q(2)
    expect(one).toBeGreaterThan(zero)
    expect(two).toBeGreaterThan(one)
  })

  it('C: pressurise the FAR vessel and the SAME line runs backwards', () => {
    const forward = solveWith(twoVessels, atBarg('TK-A', 2)).r
    const reverse = solveWith(twoVessels, atBarg('TK-B', 2)).r
    // p1 is drawn TK-A -> HV-1, so positive is A-to-B
    expect(forward.pipeFlow.p1!).toBeGreaterThan(1)
    expect(reverse.pipeFlow.p1!).toBeLessThan(-1)
    // the same magnitude, because the network is symmetric — only the sign
    // changed, which is the whole point of carrying one
    expect(Math.abs(reverse.pipeFlow.p1!)).toBeCloseTo(Math.abs(forward.pipeFlow.p1!), 6)
  })

  it('C: nothing clamps the reversal — the flow is genuinely negative', () => {
    const { r } = solveWith(twoVessels, atBarg('TK-B', 2))
    expect(r.pipeFlow.p1!).toBeLessThan(0)
    expect(r.pipeFlow.p2!).toBeLessThan(0)
    expect(Object.values(r.flow).some((q) => q < 0)).toBe(true)
  })
})

// ── D. A pump can overpower a passive boundary ──────────────────────────────

describe('D — a pumped header turns a passive boundary into a destination', () => {
  /** (air) ─s1─ P-1 ─s2─ TEE ─s3─ (air). A machine between two free ends. */
  const pumped: HmiScreen = {
    id: 'p', name: 'P', theme: 'classic',
    widgets: [
      { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
      { id: 'j', type: 'symbol', x: 420, y: 110, w: 16, h: 16, tag: 'T-1', props: { symbolId: 'fit.junction' } },
    ],
    pipes: [
      { id: 's1', points: [{ x: 0, y: 118 }, { x: 196, y: 118 }], bId: 'p', bPort: 'suction' },
      { id: 's2', points: [{ x: 260, y: 118 }, { x: 416, y: 118 }], aId: 'p', aPort: 'discharge', bId: 'j' },
      { id: 's3', points: [{ x: 440, y: 118 }, { x: 700, y: 118 }], aId: 'j' },
    ],
  }

  it('the passive end receives, and that is represented rather than hidden', () => {
    const { r } = solveWith(pumped)
    expect(r.converged).toBe(true)
    // s3 is drawn away from the tee, and the machine pushes out through it
    expect(r.pipeFlow.s3!).toBeGreaterThan(1)
    // the suction end supplies: drawn INTO the pump, so positive
    expect(r.pipeFlow.s1!).toBeGreaterThan(1)
    // mass balances across the machine
    expect(Math.abs(r.pipeFlow.s1! - r.pipeFlow.s3!)).toBeLessThan(MASS_TOL)
  })

  it('a pump is a SOURCE OF HEAD, not a pressure boundary', () => {
    const m = buildProcessModel(pumped)
    // it is an EDGE between two internal nodes — nothing about it is fixed
    const pump = m.edges.find((e) => e.kind === 'pump')!
    for (const id of [pump.from, pump.to]) {
      expect(m.nodes.find((n) => n.id === id)!.boundary).toBe('internal')
    }
    // and it raises the pressure it is given rather than replacing it
    const running = solveWith(pumped).r
    const stopped = solveWith(pumped, undefined, { pumpSpeed: () => 0 }).r
    expect(running.pressure[pump.to]! - running.pressure[pump.from]!).toBeGreaterThan(1)
    expect(Math.abs(stopped.pressure[pump.to]! - stopped.pressure[pump.from]!)).toBeLessThan(0.2)
  })
})

// ── F, G. Vessels and suction ───────────────────────────────────────────────

describe('F, G — nozzle role decides what a connection sees', () => {
  it('F: a BOTTOM nozzle drains by gravity; a TOP one does not', () => {
    const bottom = solveWith(toAtmosphere('bottom')).r
    const top = solveWith(toAtmosphere('top')).r
    expect(bottom.pipeFlow.d1!).toBeGreaterThan(1)
    expect(Math.abs(top.pipeFlow.d1!)).toBeLessThan(SHUT_LEAK_MAX)
  })

  it('F: and it drains harder the fuller it is, because that is the head', () => {
    const q = (level: number) =>
      solveWith(toAtmosphere('bottom'), undefined, { vesselLevel: () => level }).r.pipeFlow.d1!
    expect(q(90)).toBeGreaterThan(q(50))
    expect(q(50)).toBeGreaterThan(q(10))
  })

  it('G: a pump takes the pressure its suction vessel actually offers', () => {
    const fed: HmiScreen = {
      id: 'g', name: 'G', theme: 'classic',
      widgets: [
        { id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-S', props: { level0: 50 } },
        { id: 'p', type: 'pump', x: 300, y: 90, w: 56, h: 56, tag: 'P-S' },
      ],
      pipes: [
        { id: 'g1', points: [{ x: 48, y: 120 }, { x: 296, y: 118 }], aId: 't', aPort: 'bottom', bId: 'p', bPort: 'suction' },
        { id: 'g2', points: [{ x: 360, y: 118 }, { x: 700, y: 118 }], aId: 'p', aPort: 'discharge' },
      ],
    }
    const m = buildSimModel(fed)
    const suction = m.hydraulic.edges.find((e) => e.kind === 'pump')!.from
    // vented: the vessel offers atmosphere plus its own head, minus the line
    const vented = solveWith(fed, undefined, { pumpSpeed: () => 0 }).r
    expect(vented.pressure[suction]!).toBeCloseTo(
      DEFAULTS.atmosphericPressureBar + vesselHeadBar(50), 3)
    // held at 2 barg: the machine is offered two bar more, and it is the
    // VESSEL's record that decided it, not the drawing
    const held = solveWith(fed, atBarg('TK-S', 2), { pumpSpeed: () => 0 }).r
    expect(held.pressure[suction]! - vented.pressure[suction]!).toBeCloseTo(2, 6)
  })

  it('H: too much duty for the suction still cavitates, and still says so', () => {
    const starved: HmiScreen = {
      id: 'h', name: 'H', theme: 'classic',
      widgets: [{ id: 'p', type: 'pump', x: 300, y: 90, w: 56, h: 56, tag: 'P-H' }],
      pipes: [
        { id: 'h1', points: [{ x: 0, y: 118 }, { x: 296, y: 118 }], bId: 'p', bPort: 'suction' },
        { id: 'h2', points: [{ x: 360, y: 118 }, { x: 700, y: 118 }], aId: 'p', aPort: 'discharge' },
      ],
    }
    const m = buildProcessModel(starved)
    const r = solveHydraulics(m, inputs({ pumpRated: () => 400, pumpHead: () => 9 }))
    expect(r.cavitating.length).toBeGreaterThan(0)
    // reported, not clamped: the pressure is still the negative number the
    // equations produced, and the flag is what says not to read it
    const node = r.cavitating[0]!
    expect(r.pressure[node]!).toBeLessThan(0)
  })
})

// ── Capacity, compatibility, and preservation ───────────────────────────────

describe('what a boundary does NOT promise', () => {
  it('a fixed-pressure node has UNLIMITED capacity, and that is a known assumption', () => {
    // Drain a vessel to the air for an hour of process time and the air is
    // unchanged — it absorbs whatever arrives. The same is true in reverse.
    // There is no reservoir model here; a boundary is a pressure, not an
    // inventory, and nothing in the product pretends otherwise.
    const { model, r } = solveWith(toAtmosphere('bottom'), atBarg('TK-A', 3))
    const air = model.hydraulic.nodes.find((n) => n.boundary === 'atmospheric')!
    expect(r.pipeFlow.d2!).toBeGreaterThan(1)
    expect(r.pressure[air.id]).toBe(DEFAULTS.atmosphericPressureBar)
    // ...and it is still exactly one atmosphere however hard it is pushed
    const harder = solveWith(toAtmosphere('bottom'), atBarg('TK-A', 20)).r
    expect(harder.pressure[air.id]).toBe(DEFAULTS.atmosphericPressureBar)
  })
})

describe('a record states the pressure; nothing else does', () => {
  it('an operating pressure is read as GAUGE unless it says otherwise', () => {
    // a datasheet that says "3 bar" means 3 barg, and absolute is 4
    expect(operatingPressure('3 barg')).toBeCloseTo(3 + ATMOSPHERIC_BAR, 9)
    expect(operatingPressure('3 bar')).toBeCloseTo(3 + ATMOSPHERIC_BAR, 9)
    expect(operatingPressure('3 bara')).toBeCloseTo(3, 9)
    expect(operatingPressure('1 atm')).toBeCloseTo(1.01325, 5)
    expect(operatingPressure(undefined)).toBeUndefined()
    expect(operatingPressure('')).toBeUndefined()
  })

  it('it is NEVER taken from the design rating', () => {
    const reg: Registry = {
      'TK-R': { key: 'TK-R', kind: 'equipment', fields: { 'design.pressure': '10 barg' } },
    }
    // a rating is what the vessel withstands, not what it runs at; reading it
    // as an operating condition would sit the vapour space at relief
    expect(processFor(reg, 'TK-R').designPressureBar).toBe(10)
    expect(processFor(reg, 'TK-R').operatingPressureBarA).toBeUndefined()
  })

  it('a vessel whose record says NOTHING is vented — silence is not unknown', () => {
    const m = buildSimModel(twoVessels)
    for (const d of m.defs) {
      if (d.kind !== 'tank') continue
      expect(d.vesselPressureBarA, d.name).toBeUndefined()
    }
    const { r } = solveWith(twoVessels)
    const top = buildProcessModel(twoVessels).nodes.find((n) => n.boundary === 'vessel-vapour')!
    expect(r.pressure[top.id]).toBe(DEFAULTS.atmosphericPressureBar)
  })

  it('LEGACY: a drawing with no boundary metadata solves exactly as it did', () => {
    // the whole point of the fallback. Every bundled drawing predates K6 and
    // states nothing; each must be untouched by it.
    const plain = solveWith(twoVessels).r
    const explicitlyVented = solveWith(twoVessels, undefined, {
      vesselPressure: () => DEFAULTS.atmosphericPressureBar,
    }).r
    for (const k of Object.keys(plain.pipeFlow)) {
      expect(explicitlyVented.pipeFlow[k], k).toBe(plain.pipeFlow[k])
    }
    for (const k of Object.keys(plain.pressure)) {
      expect(explicitlyVented.pressure[k], k).toBe(plain.pressure[k])
    }
  })

  it('the PROCESS VIEW follows the sign, so a boundary can read either way', () => {
    // K6's whole visible consequence, through the rule both operator screens
    // share. Nothing in the HMI decides this; it reads what the solve produced.
    const view = buildProcessView(
      buildSimModel(toAtmosphere('bottom')).hydraulic,
      buildSimModel(toAtmosphere('bottom')).defs, [])
    const air = view.nodes.find((n) => n.kind === 'boundary')!
    const role = (reg?: Registry) => {
      const { r } = solveWith(toAtmosphere('bottom'), reg)
      return boundaryRole(air, view.edges,
        (e) => e.pipeIds.reduce((v, pid) => (v !== 0 ? v : (r.pipeFlow[pid] ?? 0)), 0),
        SHUT_LEAK_MAX)
    }
    // a vented vessel at 50 % drains to the air: the air RECEIVES
    expect(role()).toBe('DESTINATION')
    // hold the vessel at 3 barg and it drains harder — still a destination
    expect(role(atBarg('TK-A', 3))).toBe('DESTINATION')
    // and with the vessel empty, nothing moves and the air is neither
    const { r } = solveWith(toAtmosphere('bottom'), undefined, { vesselLevel: () => 0 })
    expect(boundaryRole(air, view.edges,
      (e) => e.pipeIds.reduce((v, pid) => (v !== 0 ? v : (r.pipeFlow[pid] ?? 0)), 0),
      SHUT_LEAK_MAX)).toBe('BOUNDARY')
  })

  it('PRESERVATION: naming the conditions changed no topology', () => {
    const m = buildProcessModel(twoVessels)
    expect(m.nodes).toHaveLength(6)   // 2 vessels x 2 nozzles, + valve inlet/outlet
    expect(m.edges).toHaveLength(3)   // 2 pipes + the valve
    expect([...m.edgeOfPipe.keys()].sort()).toEqual(['p1', 'p2'])
    expect(m.vesselNodes.get('TK-A')).toHaveLength(2)
    expect(m.vesselNodes.get('TK-B')).toHaveLength(2)
    // every edge endpoint is a node that exists
    const ids = new Set(m.nodes.map((n) => n.id))
    expect(m.edges.flatMap((e) => [e.from, e.to]).filter((n) => !ids.has(n))).toEqual([])
  })
})
