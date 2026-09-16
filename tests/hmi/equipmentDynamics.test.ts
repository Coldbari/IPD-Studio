// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K11 — EQUIPMENT COMMANDS ARE PHYSICS, NOT DISPLAY.
 *
 * Almost nothing here is new. The pump curve, the valve resistance law, the
 * spin-up and coast-down, the stroke rate and the trip have been in the model
 * since K3, and this file is the evidence that the whole chain is causal:
 *
 *     command  →  actuator  →  conductance / head  →  SOLVE  →  measurement
 *
 * The one distinction it exists to hold is the one most easily lost:
 *
 *     PUMP STOP  ≠  FORCE EVERY PIPE FLOW TO ZERO
 *
 * A stopped pump's HEAD goes away. What the plant then does is the solver's
 * business — and if a boundary or a vessel can still move fluid, it will, and
 * that is correct rather than a leak.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { resolveEquipment } from '../../src/hmi/sim/scenario'
import type { Scenario } from '../../src/hmi/sim/scenario'
import { SHUT_LEAK_MAX, solveHydraulics, valveResistanceOf } from './equipmentDynamics.helpers'
// `solveHydraulics` is used to exercise the pump curve where speed actually lives
import { DEFAULTS } from '../../src/hmi/sim/units'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

/** BL-S ─a1─ P-1 ─a2─ FV-1 ─a3─ TK-1 ─a4─ LV-1 ─a5─ BL-D, PT/FT/LT/LIC. */
const plant: HmiScreen = {
  id: 'k11', name: 'K11', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 600, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 40 } },
    { id: 'lv', type: 'valve', x: 820, y: 180, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 1000, y: 180, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 1200, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2' } },
    { id: 'ft', type: 'display', x: 1200, y: 90, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a3' } },
    { id: 'lt', type: 'display', x: 1200, y: 140, w: 96, h: 40, tag: 'LT-1', props: { bindTank: 'TK-1' } },
    { id: 'lic', type: 'display', x: 1200, y: 190, w: 96, h: 40, tag: 'LIC-1', props: { controller: true } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 596, y: 150 }], aId: 'fv', aPort: 'out', bId: 't', bPort: 'bottom' },
    { id: 'a4', points: [{ x: 648, y: 165 }, { x: 816, y: 196 }], aId: 't', aPort: 'bottom', bId: 'lv', bPort: 'in' },
    { id: 'a5', points: [{ x: 872, y: 196 }, { x: 1004, y: 192 }], aId: 'lv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** BL-S above the plant, BL-D below it, so gravity alone can move something —
 *  which is what makes the "stop is not zero" distinction testable at all. */
const registry: Registry = {
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '3 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '0 barg' } },
  'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
  'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
}

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const manual = () => { sim().writeTag('LIC-1', 'MODE', 0); sim().writeTag('LIC-1', 'OP', 0) }
const lineUp = () => { manual(); sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) }
const model = () => buildSimModel(plant, registry)
const scenario = (overrides: Scenario['overrides']): Scenario => ({ id: 's', name: 's', overrides })

beforeEach(() => { sim().exitRun(); sim().enterRun(plant, registry) })

// ── A, B, I. The pump ───────────────────────────────────────────────────────

describe('A, B, I — a pump contributes head, and stopping removes it', () => {
  it('A: RUN develops head, and the discharge sits above the suction', () => {
    lineUp(); advance(60)
    const m = model().hydraulic
    const e = m.edges.find((x) => x.kind === 'pump')!
    expect(sim().pipeFlows.a2!).toBeGreaterThan(1)
    expect(sim().pipePressures.a2!).toBeGreaterThan(sim().pipePressures.a1!)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
    expect(e).toBeDefined()
  })

  it('B: STOP removes the HEAD, and the machine itself then blocks', () => {
    lineUp(); advance(60)
    const running = sim().pipePressures.a2!
    sim().writeTag('P-1', 'RUN', 0)
    advance(60)

    // the head is gone: the discharge is no longer lifted above the suction
    expect(sim().pipePressures.a2!).toBeLessThan(running)
    expect(sim().tags['P-1']!.RAMP!).toBeCloseTo(0, 6)

    /**
     * AND THE MACHINE BLOCKS ITS OWN LINE. That is a STATED ASSUMPTION of this
     * model, not an accident and not a forcing: a stopped pump is treated as a
     * huge finite resistance because a pumped system carries a discharge check
     * valve, and `docs/HMI.md` says so under "Assumptions, stated". BL-S is at
     * 3 barg on the far side and still cannot get through it.
     */
    expect(Math.abs(sim().pipeFlows.a1!)).toBeLessThan(SHUT_LEAK_MAX)
  })

  it('B: but STOPPING IS NOT ZEROING — the rest of the plant carries on', () => {
    // The distinction that matters, and the one most easily lost. The pump's
    // contribution goes; what the REST of the network does is the solver's
    // answer. TK-1 stands above BL-D, so it goes on draining by gravity with
    // the machine stopped, and nothing forced it either way.
    lineUp()
    // LIC-1 drives LV-1, so in MANUAL the DRAIN is opened through the
    // controller's own output — a write straight to the element is overwritten
    // on the next tick, which is the behaviour tested under §J below.
    sim().writeTag('LIC-1', 'OP', 100)
    advance(90)
    sim().writeTag('P-1', 'RUN', 0)
    advance(60)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0, 6)
    expect(Math.abs(sim().pipeFlows.a4!)).toBeGreaterThan(SHUT_LEAK_MAX)
    const held = sim().tags['TK-1']!.V!
    advance(120, 2)
    expect(sim().tags['TK-1']!.V!).toBeLessThan(held)   // still emptying
    expect(sim().hydraulic.converged).toBe(true)
  })

  it('I: a TRIP during operation redistributes the plant, causally', () => {
    lineUp(); advance(90)
    const before = {
      flow: sim().pipeFlows.a3!, pt: sim().tags['PT-1']!.PV!, ft: sim().tags['FT-1']!.PV!,
    }
    sim().writeTag('P-1', 'FAULT', 1)
    advance(30)

    // a trip opens the breaker: the COMMAND is cleared too, not just the shaft
    expect(sim().tags['P-1']!.RUN).toBe(0)
    expect(sim().tags['P-1']!.RAMP).toBe(0)
    expect(sim().pipeFlows.a3!).toBeLessThan(before.flow)
    // and the instruments followed the solve rather than being set
    expect(sim().tags['PT-1']!.PV!).not.toBe(before.pt)
    expect(sim().tags['FT-1']!.PV!).toBeCloseTo(Math.abs(sim().pipeFlows.a3!), 0)
  })

  it('a trip beats a RUN command: the breaker does not care what you asked for', () => {
    lineUp(); advance(60)
    sim().writeTag('P-1', 'FAULT', 1)
    sim().writeTag('P-1', 'RUN', 1)
    advance(30)
    expect(sim().tags['P-1']!.RAMP).toBe(0)
    expect(resolveEquipment(sim().tags, model().controllers, null, 'P-1', 'pump')!.source)
      .toBe('tripped')
  })
})

// ── C. Speed ────────────────────────────────────────────────────────────────

describe('C — speed is in the curve already, and changing it changes the plant', () => {
  /**
   * THERE IS NO RUNTIME SPEED COMMAND, and that is the finding.
   *
   * The curve takes a shaft fraction and the affinity laws are in it — head as
   * speed², capacity as speed — but the runtime DERIVES that fraction from
   * `RUN` alone: it ramps to 1 while commanded and coasts to 0 when not. There
   * is no variable-speed setpoint anywhere in the engineering model, so writing
   * `RAMP` is overwritten by the equipment dynamics on the very next tick.
   *
   * §4 says to test speed where it is already represented and NOT to invent it
   * where it is not. So it is tested where it lives — in the curve, through the
   * solver's own input — and the missing operator control is documented rather
   * than fabricated.
   */
  it('the curve obeys the affinity laws, at the level where speed exists', () => {
    const m = model().hydraulic
    const at = (speed: number) => solveHydraulics(m, {
      valveOpen: () => 1, pumpSpeed: () => speed,
      pumpRated: () => 40, pumpHead: () => 35 / 10.197,
      vesselLevel: () => 40,
    })
    const full = at(1)
    const half = at(0.5)
    const e = m.edges.find((x) => x.kind === 'pump')!
    const head = (r: ReturnType<typeof solveHydraulics>) => r.pressure[e.to]! - r.pressure[e.from]!
    expect(head(half)).toBeLessThan(head(full))
    expect(half.pipeFlow.a2!).toBeLessThan(full.pipeFlow.a2!)
    // monotone all the way down
    let last = Infinity
    for (const r of [1, 0.8, 0.6, 0.4, 0.2]) {
      const q = at(r).pipeFlow.a2!
      expect(q, `speed ${r}`).toBeLessThan(last)
      last = q
    }
    expect(at(0).pipeFlow.a2!).toBeLessThan(SHUT_LEAK_MAX)
  })

  it('and the RUNTIME feeds that input from the shaft, which is derived from RUN', () => {
    lineUp(); advance(60)
    const full = sim().pipeFlows.a2!
    sim().writeTag('P-1', 'RUN', 0)
    sim().tickOnce(1)                       // coasting: RAMP is between 0 and 1
    const coasting = sim().tags['P-1']!.RAMP!
    expect(coasting).toBeGreaterThan(0)
    expect(coasting).toBeLessThan(1)
    // a part-speed shaft delivers part flow, through the same curve
    expect(Math.abs(sim().pipeFlows.a2!)).toBeLessThan(Math.abs(full))
  })

  it('spin-up and coast-down are real time, not a switch', () => {
    manual(); sim().writeTag('FV-1', 'OP', 100)
    sim().writeTag('P-1', 'RUN', 1)
    advance(1)
    const part = sim().tags['P-1']!.RAMP!
    expect(part).toBeGreaterThan(0)
    expect(part).toBeLessThan(1)   // RAMP_S = 2 s, so one second is half way
    advance(5)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
    sim().writeTag('P-1', 'RUN', 0)
    advance(1)
    const coasting = sim().tags['P-1']!.RAMP!
    expect(coasting).toBeGreaterThan(0)   // still turning, still pumping
    expect(coasting).toBeLessThan(1)
  })
})

// ── D-H. The valve ──────────────────────────────────────────────────────────

describe('D-H — a valve is a conductance, and the numbers prove it', () => {
  it('the resistance law is the one the model states, and it is not linear', () => {
    // Q ∝ f² at fixed ΔP, so halving the opening does NOT halve the flow
    expect(valveResistanceOf(0.5) / valveResistanceOf(1)).toBeCloseTo(16, 6)
    expect(valveResistanceOf(0.25) / valveResistanceOf(1)).toBeCloseTo(256, 6)
  })

  it('D-G: 100 → 50 → 25 → 0 reduces the solved flow at each step', () => {
    lineUp(); advance(60)
    const at = (op: number) => {
      sim().writeTag('FV-1', 'OP', op)
      advance(30)
      return Math.abs(sim().pipeFlows.a3!)
    }
    const full = at(100)
    const half = at(50)
    const quarter = at(25)
    const shut = at(0)
    expect(half).toBeLessThan(full)
    expect(quarter).toBeLessThan(half)
    expect(shut).toBeLessThan(SHUT_LEAK_MAX)     // K3/K3.2 blocked-element ceiling
    // NOT linear: half the opening is not half the flow
    expect(Math.abs(half / full - 0.5)).toBeGreaterThan(0.02)
  })

  it('H: reopening is symmetric — nothing latches', () => {
    lineUp(); advance(60)
    sim().writeTag('FV-1', 'OP', 100)
    advance(30)
    const before = Math.abs(sim().pipeFlows.a3!)
    sim().writeTag('FV-1', 'OP', 0)
    advance(30)
    expect(Math.abs(sim().pipeFlows.a3!)).toBeLessThan(SHUT_LEAK_MAX)
    sim().writeTag('FV-1', 'OP', 25)
    advance(30)
    expect(Math.abs(sim().pipeFlows.a3!)).toBeGreaterThan(SHUT_LEAK_MAX)
    sim().writeTag('FV-1', 'OP', 100)
    advance(30)
    expect(Math.abs(sim().pipeFlows.a3!)).toBeCloseTo(before, 1)
  })

  it('the HYDRAULICS read the POSITION, not the command — a stuck valve proves it', () => {
    lineUp(); advance(60)
    const open = Math.abs(sim().pipeFlows.a3!)
    sim().writeTag('FV-1', 'STUCK', 1)
    sim().writeTag('FV-1', 'OP', 0)      // commanded shut, and it does not move
    advance(60)
    expect(sim().tags['FV-1']!.POS).toBeCloseTo(100, 6)
    expect(Math.abs(sim().pipeFlows.a3!)).toBeCloseTo(open, 1)
    const st = resolveEquipment(sim().tags, model().controllers, null, 'FV-1', 'valve')!
    expect(st.command).toBe(0)
    expect(st.actual).toBeCloseTo(100, 6)
    expect(st.deviating).toBe(true)
  })

  it('an actuator takes time: the position lags the command at a stated rate', () => {
    lineUp(); advance(60)
    sim().writeTag('FV-1', 'OP', 0)
    sim().tickOnce(1)                     // STROKE_RATE = 25 %/s
    expect(sim().tags['FV-1']!.POS!).toBeCloseTo(75, 6)
    sim().tickOnce(1)
    expect(sim().tags['FV-1']!.POS!).toBeCloseTo(50, 6)
  })
})

// ── J. The control loop is closed through the solver ────────────────────────

describe('J — controller → actuator → solver → measurement, and round again', () => {
  it('the loop closes through the hydraulics and nothing short-circuits it', () => {
    // The inflow is sized to what a gravity drain can reject, exactly as K3.2
    // §11 established: an over-fed vessel saturates its drain and the loop
    // correctly parks above setpoint, which is a different test from this one.
    sim().writeTag('FV-1', 'OP', 18)
    sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('LIC-1', 'MODE', 1)
    sim().writeTag('LIC-1', 'SP', 45)
    advance(6 * 3600, 4)

    // the controller moved its final element off both stops
    const op = sim().tags['LIC-1']!.OP!
    expect(op).toBeGreaterThan(0)
    expect(op).toBeLessThan(100)
    // the element followed it
    expect(sim().tags['LV-1']!.OP).toBeCloseTo(op, 6)
    // the drain is passing what the SOLVE says, and the level moved toward SP
    expect(Math.abs(sim().pipeFlows.a4!)).toBeGreaterThan(SHUT_LEAK_MAX)
    expect(Math.abs(sim().tags['TK-1']!.PV! - 45)).toBeLessThan(8)
    /**
     * And the controller's PV is the INSTRUMENT's reading rather than the
     * vessel's own level — within one tick, because a controller acts on the
     * last measurement available to it. That one-tick lag is real: a DCS reads
     * what the transmitter last reported, not what the process is doing this
     * instant, and the loop is stable across it.
     */
    const lt = sim().defs['LT-1']!
    expect(Math.abs(sim().tags['LIC-1']!.PV! - sim().tags['LT-1']!.PV!))
      .toBeLessThan((lt.max - lt.min) * 0.02)
    expect(sim().tags['LIC-1']!.PV).not.toBe(sim().tags['TK-1']!.PV)
  })

  it('a controller in AUTO owns its element: an operator write is overwritten', () => {
    sim().writeTag('LIC-1', 'MODE', 1)
    advance(10)
    sim().writeTag('LV-1', 'OP', 77)
    advance(2)
    // this is why a DCS makes you go to MANUAL first, and the source says so
    expect(sim().tags['LV-1']!.OP).not.toBe(77)
    expect(resolveEquipment(sim().tags, model().controllers, null, 'LV-1', 'valve')!.source)
      .toBe('controller')
  })

  it('in MANUAL the operator owns it, and the source says that too', () => {
    manual()
    sim().writeTag('LIC-1', 'OP', 62)
    advance(5)
    expect(sim().tags['LV-1']!.OP).toBeCloseTo(62, 6)
    expect(resolveEquipment(sim().tags, model().controllers, null, 'LV-1', 'valve')!.source)
      .toBe('operator')
  })

  it('a scenario naming an element is reported as the scenario’s', () => {
    manual()
    const s = scenario([{ kind: 'signal', tag: 'FV-1', signal: 'OP', value: 40 }])
    sim().applyScenario(s)
    advance(5)
    expect(resolveEquipment(sim().tags, model().controllers, s, 'FV-1', 'valve')!.source)
      .toBe('scenario')
  })
})

// ── K, L. Measurement integrity ─────────────────────────────────────────────

describe('K, L — instruments read the solved state and nothing else', () => {
  it('FT tracks its own edge and PT its own line, across every equipment state', () => {
    lineUp()
    const ftDef = sim().defs['FT-1']!
    const ptDef = sim().defs['PT-1']!
    const band = (d: { max: number; min: number }) => (d.max - d.min) * 0.008
    for (const step of [
      () => sim().writeTag('FV-1', 'OP', 100),
      () => sim().writeTag('FV-1', 'OP', 40),
      () => sim().writeTag('P-1', 'RAMP', 0.5),
      () => sim().writeTag('P-1', 'RUN', 0),
      () => sim().writeTag('FV-1', 'OP', 0),
    ]) {
      step()
      advance(40)
      expect(Math.abs(sim().tags['FT-1']!.PV! - Math.abs(sim().pipeFlows.a3!)))
        .toBeLessThan(band(ftDef))
      expect(Math.abs(sim().tags['PT-1']!.PV! - sim().pipePressures.a2!))
        .toBeLessThan(band(ptDef))
    }
  })

  it('a commanded value is never injected into an instrument', () => {
    lineUp(); advance(60)
    sim().writeTag('FV-1', 'OP', 63)
    advance(30)
    // FT reads m³/h, not the 63 % it was commanded to
    expect(sim().tags['FT-1']!.PV!).not.toBeCloseTo(63, 0)
    expect(sim().tags['FT-1']!.PV!).toBeCloseTo(Math.abs(sim().pipeFlows.a3!), 0)
  })
})

// ── M. Reversal ─────────────────────────────────────────────────────────────

describe('M — an equipment state can reverse a line, and the sign carries it', () => {
  it('stopping the pump lets the higher boundary push back through it', () => {
    lineUp(); advance(90)
    expect(sim().pipeFlows.a1!).toBeGreaterThan(0)   // BL-S feeding in
    const forward = sim().pipeFlows.a3!
    expect(forward).toBeGreaterThan(0)

    // shut the drain, stop the machine, and drop the supply below the vessel
    sim().writeTag('LV-1', 'OP', 0)
    sim().writeTag('P-1', 'RUN', 0)
    sim().applyScenario(scenario([{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '0 barg' }]))
    advance(120)
    // the vessel now stands above the supply, so the feed line runs backwards
    expect(sim().pipeFlows.a3!).toBeLessThan(0)
    expect(sim().hydraulic.converged).toBe(true)
  })
})

// ── N. Degenerate networks ──────────────────────────────────────────────────

describe('N — a network that cannot be solved says so rather than inventing one', () => {
  it('an isolated fragment is reported UNDETERMINED, not given a plausible pressure', () => {
    const stranded: HmiScreen = {
      ...plant, id: 'stranded',
      widgets: [...plant.widgets,
        { id: 'x', type: 'valve', x: 1400, y: 500, w: 48, h: 32, tag: 'HV-X', props: { throttle: true } },
        { id: 'y', type: 'valve', x: 1560, y: 500, w: 48, h: 32, tag: 'HV-Y', props: { throttle: true } }],
      // a RING of two valves joined only to each other: no free end, no
      // vessel, no terminal, so nothing fixes its pressure LEVEL
      pipes: [...plant.pipes,
        { id: 'z1', points: [{ x: 1452, y: 516 }, { x: 1560, y: 516 }], aId: 'x', aPort: 'out', bId: 'y', bPort: 'in' },
        { id: 'z2', points: [{ x: 1396, y: 516 }, { x: 1380, y: 620 }, { x: 1620, y: 620 }, { x: 1612, y: 516 }], aId: 'x', aPort: 'in', bId: 'y', bPort: 'out' }],
    }
    sim().exitRun(); sim().enterRun(stranded, registry)
    advance(20)
    expect(sim().hydraulic.undetermined.length).toBeGreaterThan(0)
    // the determined part still solves, and nothing is NaN anywhere
    expect(sim().hydraulic.converged).toBe(true)
    for (const v of Object.values(sim().pipePressures)) expect(Number.isFinite(v)).toBe(true)
    for (const v of Object.values(sim().pipeFlows)) expect(Number.isFinite(v)).toBe(true)
  })

  it('a fully blocked line is ZERO-FLOW and determined, which is different', () => {
    manual()
    sim().writeTag('FV-1', 'OP', 0)
    sim().writeTag('LV-1', 'OP', 0)
    advance(30)
    expect(sim().hydraulic.converged).toBe(true)
    expect(sim().hydraulic.undetermined).toEqual([])
    expect(Math.abs(sim().pipeFlows.a3!)).toBeLessThan(SHUT_LEAK_MAX)
  })
})

// ── O, P. Determinism and legacy ────────────────────────────────────────────

describe('O, P — reproducible, and older drawings unaffected', () => {
  it('O: the same commands in the same order give the same run', () => {
    const once = () => {
      sim().exitRun(); sim().enterRun(plant, registry)
      lineUp(); advance(60)
      sim().writeTag('FV-1', 'OP', 40); advance(40)
      sim().writeTag('P-1', 'RUN', 0); advance(40)
      sim().writeTag('P-1', 'RUN', 1); advance(40)
      return JSON.stringify({ f: sim().pipeFlows, p: sim().pipePressures, t: sim().tags })
    }
    expect(once()).toBe(once())
  })

  it('P: a drawing with no terminals behaves as it always did', () => {
    const legacy: HmiScreen = {
      ...plant, id: 'legacy',
      widgets: plant.widgets.filter((w) => !w.tag?.startsWith('BL-')),
      pipes: plant.pipes.map((p) =>
        p.id === 'a1' ? { id: 'a1', points: p.points, bId: 'p', bPort: 'suction' }
        : p.id === 'a5' ? { id: 'a5', points: p.points, aId: 'lv', aPort: 'out' } : p),
    }
    sim().exitRun(); sim().enterRun(legacy, registry)
    manual(); sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    advance(60)
    expect(sim().pipeFlows.a2!).toBeGreaterThan(1)
    for (const n of buildProcessModel(legacy).nodes.filter((x) => x.kind === 'boundary')) {
      expect(n.boundary).toBe('atmospheric')
      expect(n.pressureBar).toBe(DEFAULTS.atmosphericPressureBar)
    }
  })
})

// ── §12. States are not alarms ──────────────────────────────────────────────

describe('§12 — a stopped pump is not an alarm, and a shut valve is not either', () => {
  it('neither raises anything by itself', () => {
    manual()
    sim().writeTag('FV-1', 'OP', 0)
    sim().writeTag('P-1', 'RUN', 0)
    advance(60)
    expect(sim().alarms.filter((a) => a.tag === 'P-1' || a.tag === 'FV-1')).toEqual([])
  })

  it('but a TRIP does, because the existing device logic says so', () => {
    lineUp(); advance(30)
    sim().writeTag('P-1', 'FAULT', 1)
    advance(5)
    expect(sim().alarms.some((a) => a.tag === 'P-1')).toBe(true)
  })

  it('and every command lands in the journal the operator can read back', () => {
    lineUp(); advance(10)
    sim().writeTag('FV-1', 'OP', 35)
    advance(2)
    expect(sim().journal.some((j) => j.tag === 'FV-1' && j.what === 'CMD')).toBe(true)
  })
})
