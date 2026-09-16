// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP K3 — THE RUNTIME RUNS ON THE SOLVE.
 *
 * `hydraulic.test.ts` and `hydraulicCases.test.ts` prove the solver against
 * networks built by hand. This file proves the OTHER half: that the running
 * plant — screens compiled by `buildSimModel`, ticked through `simStore`, read
 * by the operator surfaces — takes every flow, every pressure and every level
 * from that solve and from nothing else.
 *
 * The defect this replaces was not a wrong number. It was TWO sources of
 * truth: a conductance model that produced branch flows for the HMI, and a
 * pressure model that produced pressures for the transmitters, neither
 * constrained by the other. A valve could be shut in one and passing in the
 * other and nothing in the product could tell.
 *
 * So the assertions here are causal chains rather than values. Each one names
 * the step it is about — the valve moved, THEREFORE the resistance changed,
 * THEREFORE the pump moved along its curve, THEREFORE the transmitter read it
 * — so that a plausible-looking number produced some other way fails.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { MASS_TOL, SHUT_LEAK_MAX } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS, volumeMoved } from '../../src/hmi/sim/units'
import { makeRng } from '../../src/hmi/sim/noise'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadDoc } from '../../src/model/migrate'
import { importSheet } from '../../src/hmi/importFromPid'

/**
 * THE REPRESENTATIVE PLANT. One pump feeding two vessels through a tee:
 *
 *        ┌── e3a ── PV-101 ── e4a ── TK-101 ── e5 ── LV-101 ── e6 ── (boundary)
 *   (b) ─ e1 ─ P-101 ─ e2 ─ TEE
 *        └── e3b ── HV-102 ── e4b ── TK-102
 *
 *   PT-101 on e2, the discharge header      PIC-101 → PV-101   (pressure loop)
 *   FT-101 on e3a, the controlled leg       LIC-101 → LV-101   (level loop)
 *   LT-101 on TK-101, TT-101 on TK-101, LT-102 on TK-102
 *
 * Branched on purpose: a tee is where a single-path model and a network model
 * give different answers, and where the two-sources-of-truth defect showed.
 * Every attachment is DECLARED — this fixture is about the runtime, not about
 * how well geometry guesses a nozzle.
 */
const plant: HmiScreen = {
  id: 'u1', name: 'Unit 1', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 200, w: 56, h: 56, tag: 'P-101' },
    { id: 'tee', type: 'symbol', x: 240, y: 220, w: 16, h: 16, tag: 'T-101', props: { symbolId: 'fit.junction' } },
    { id: 'pv', type: 'valve', x: 340, y: 100, w: 48, h: 32, tag: 'PV-101', props: { throttle: true } },
    { id: 'hv', type: 'valve', x: 340, y: 320, w: 48, h: 32, tag: 'HV-102', props: { throttle: true } },
    { id: 't1', type: 'tank', x: 520, y: 60, w: 96, h: 128, tag: 'TK-101', props: { level0: 30 } },
    { id: 't2', type: 'tank', x: 520, y: 280, w: 96, h: 128, tag: 'TK-102', props: { level0: 10 } },
    { id: 'lv', type: 'valve', x: 700, y: 180, w: 48, h: 32, tag: 'LV-101', props: { throttle: true } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-101', props: { bindPipe: 'e2' } },
    { id: 'ft', type: 'display', x: 900, y: 90, w: 96, h: 40, tag: 'FT-101', props: { bindPipe: 'e3a' } },
    { id: 'lt1', type: 'display', x: 900, y: 140, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-101' } },
    { id: 'lt2', type: 'display', x: 900, y: 190, w: 96, h: 40, tag: 'LT-102', props: { bindTank: 'TK-102' } },
    { id: 'tt', type: 'display', x: 900, y: 240, w: 96, h: 40, tag: 'TT-101', props: { bindTank: 'TK-101' } },
    { id: 'pic', type: 'display', x: 900, y: 290, w: 96, h: 40, tag: 'PIC-101', props: { controller: true } },
    { id: 'lic', type: 'display', x: 900, y: 340, w: 96, h: 40, tag: 'LIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 228 }, { x: 96, y: 228 }], bId: 'p', bPort: 'suction' },
    { id: 'e2', points: [{ x: 160, y: 228 }, { x: 236, y: 228 }], aId: 'p', aPort: 'discharge', bId: 'tee' },
    { id: 'e3a', points: [{ x: 248, y: 216 }, { x: 248, y: 116 }, { x: 336, y: 116 }], aId: 'tee', bId: 'pv', bPort: 'in' },
    { id: 'e3b', points: [{ x: 248, y: 240 }, { x: 248, y: 336 }, { x: 336, y: 336 }], aId: 'tee', bId: 'hv', bPort: 'in' },
    { id: 'e4a', points: [{ x: 392, y: 116 }, { x: 516, y: 170 }], aId: 'pv', aPort: 'out', bId: 't1', bPort: 'bottom' },
    { id: 'e4b', points: [{ x: 392, y: 336 }, { x: 516, y: 390 }], aId: 'hv', aPort: 'out', bId: 't2', bPort: 'bottom' },
    { id: 'e5', points: [{ x: 620, y: 180 }, { x: 696, y: 196 }], aId: 't1', aPort: 'bottom', bId: 'lv', bPort: 'in' },
    { id: 'e6', points: [{ x: 752, y: 196 }, { x: 900, y: 460 }], aId: 'lv', aPort: 'out' },
  ],
}

/** Engineering data off the records, the way a specified plant states it. */
const registry: Registry = {
  'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
  'TK-102': { key: 'TK-102', kind: 'equipment', fields: { 'construction.volume': '100 m³' } },
  // 40 m³/h at 35 m, and that ceiling is not arbitrary. At 50 m³/h this
  // suction line drops `P-101`'s suction below absolute zero and the solve
  // says so — see test 17, which uses a machine deliberately specified past
  // what its suction can supply. A fixture meant to exercise the healthy case
  // has to be a plant that can actually run.
  'P-101': { key: 'P-101', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
}

/** Full-scale noise on a transmitter, ±, as a fraction of span. Mirrors
 *  `NOISE_FRACTION` in engine.ts: a reading is checked against the process to
 *  within its own instrument error and no tighter. */
const NOISE_BAND = 0.008 / 2

const sim = () => useSimStore.getState()
/** Advance `seconds` of PROCESS time. `tick` sub-steps, so `dt` is a cost knob
 *  and not a physics one. */
const advance = (seconds: number, dt = 2) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const pv = (tag: string) => sim().tags[tag]!.PV!
/** Put the plant in a lined-up, pump-running state with both loops in MANUAL,
 *  so a test owns every actuator it depends on. */
const lineUp = (pvOpen = 60, hvOpen = 60, lvOpen = 0) => {
  sim().writeTag('PIC-101', 'MODE', 0); sim().writeTag('PIC-101', 'OP', pvOpen)
  sim().writeTag('LIC-101', 'MODE', 0); sim().writeTag('LIC-101', 'OP', lvOpen)
  sim().writeTag('HV-102', 'OP', hvOpen)
  sim().writeTag('P-101', 'RUN', 1)
}

beforeEach(() => {
  sim().exitRun()
  sim().enterRun(plant, registry)
})

// ── 1-2. The drawing survives compilation ───────────────────────────────────

describe('the drawing compiles without losing anything', () => {
  it('every drawn pipe becomes exactly one hydraulic edge, and every edge has a pipe or a device', () => {
    const m = buildSimModel(plant, registry)
    // COUNTS BEFORE AND AFTER. Nothing may vanish between the P&ID and the
    // network the plant is simulated on: a dropped line is a flow path the
    // operator can see and the physics cannot.
    for (const p of plant.pipes) {
      const edgeId = m.hydraulic.edgeOfPipe.get(p.id)
      expect(edgeId, `pipe ${p.id} has no edge`).toBeDefined()
      expect(m.hydraulic.edges.filter((e) => e.id === edgeId), `pipe ${p.id}`).toHaveLength(1)
    }
    expect(new Set(m.hydraulic.edgeOfPipe.values()).size).toBe(plant.pipes.length)
    // and the four inline devices are edges of their own: a valve or a pump is
    // a CONDUCTOR between two nodes, not a flag on a line
    // ...and so is the TEE: a fitting has no behaviour but it still passes
    // fluid, so it compiles to a passthrough conductor rather than vanishing
    // into a node. Five drawn devices, five edges.
    const deviceTags = m.hydraulic.edges.filter((e) => e.kind !== 'pipe').map((e) => e.tag).sort()
    expect(deviceTags).toEqual(['HV-102', 'LV-101', 'P-101', 'PV-101', 'T-101'])
  })

  it('every tagged widget that carries a process role reaches the running plant', () => {
    const drawn = plant.widgets.filter((w) => w.tag).map((w) => w.tag!)
    for (const tag of drawn) {
      // either it is a tag the simulation runs, or it is a fitting with no
      // behaviour of its own — never silently absent
      const known = tag in sim().defs || sim().tags[tag] !== undefined ||
        buildSimModel(plant, registry).hydraulic.equipment.has(tag)
      expect(known, `${tag} disappeared between the drawing and the run`).toBe(true)
    }
    expect(sim().defs['TK-101']!.capacity).toBe(200)
    expect(sim().defs['TK-102']!.capacity).toBe(100)
    expect(sim().defs['P-101']!.ratedFlow).toBe(40)
  })
})

// ── 3-7. Causality ──────────────────────────────────────────────────────────

describe('flow follows pressure through the running plant', () => {
  it('3. a calm start moves nothing: no line above the blocked-element leak', () => {
    advance(20)
    for (const [id, f] of Object.entries(sim().pipeFlows)) {
      expect(Math.abs(f), `pipe ${id}`).toBeLessThan(SHUT_LEAK_MAX)
    }
    // 30.000 rather than 30.000000: LIC-101 comes up in AUTO with its output
    // at 40 %, so LV-101 is 40 % open for the one second its actuator takes to
    // stroke shut. That second moves 5e-5 % of a 200 m³ vessel — a tenth of a
    // litre — and then the line is dead. A real start-up transient, measured
    // rather than tolerated blindly.
    expect(pv('TK-101')).toBeCloseTo(30, 3)
    expect(pv('TK-102')).toBeCloseTo(10, 6)
  })

  it('4. starting the pump develops flow in BOTH legs of the tee, and FT-101 reads its own edge', () => {
    lineUp()
    advance(60, 1)
    const flows = sim().pipeFlows
    expect(flows.e3a!).toBeGreaterThan(1)
    expect(flows.e3b!).toBeGreaterThan(1)
    // the transmitter reads THE EDGE IT IS INSTALLED IN, magnitude — not a sum
    // over every path through the line, which is what the branch model did
    const ft = sim().defs['FT-101']!
    expect(Math.abs(pv('FT-101') - Math.abs(flows.e3a!)))
      .toBeLessThan((ft.max - ft.min) * NOISE_BAND)
  })

  it('5. the tee conserves mass: the two legs add up to the header', () => {
    lineUp(80, 35)
    advance(60, 1)
    const f = sim().pipeFlows
    expect(Math.abs(f.e2! - (f.e3a! + f.e3b!))).toBeLessThan(MASS_TOL)
    // and the split is UNEVEN, because the two legs have different resistance
    expect(Math.abs(f.e3a! - f.e3b!)).toBeGreaterThan(1)
  })

  it('6. flow is NOT linear in valve position — it follows the resistance law', () => {
    const at = (open: number) => {
      sim().exitRun(); sim().enterRun(plant, registry)
      lineUp(open, 0)
      advance(60, 1)
      return sim().pipeFlows.e3a!
    }
    const full = at(100)
    const half = at(50)
    expect(half / full).toBeGreaterThan(0.1)
    expect(half / full).toBeLessThan(0.99)
    expect(Math.abs(half / full - 0.5)).toBeGreaterThan(0.02) // a linear model gives exactly 0.5
  })

  it('7. closing PV-101 raises the discharge pressure, because the pump rides up its curve', () => {
    const at = (open: number) => {
      sim().exitRun(); sim().enterRun(plant, registry)
      lineUp(open, 0)
      advance(60, 1)
      return { p: pv('PT-101'), q: sim().pipeFlows.e2!, header: sim().pipePressures.e2! }
    }
    const open = at(100)
    const shut = at(15)
    expect(shut.q).toBeLessThan(open.q)          // 1. less flow
    expect(shut.p).toBeGreaterThan(open.p)       // 2. further up the curve
    expect(shut.p).toBeCloseTo(shut.header, 1)   // 3. and PT-101 is reading THAT line
  })
})

// ── 8-11. Inventory ─────────────────────────────────────────────────────────

describe('a vessel holds a VOLUME, and its level is derived from it', () => {
  it('8. the level rises by exactly the volume the solved flow delivered', () => {
    lineUp(70, 0)
    advance(60, 1)
    const q = sim().pipeFlows.e4a!
    const before = pv('TK-101')
    advance(600, 2)
    const after = pv('TK-101')
    // m³ = m³/h × s / 3600, over the vessel's real capacity in m³. Against the
    // VESSEL, not LT-101: a law about the process should not be checked
    // through an instrument's noise.
    expect(after - before).toBeCloseTo((volumeMoved(q, 600) / 200) * 100, 0)
    expect(Math.abs(pv('LT-101') - after)).toBeLessThan(0.6) // and the instrument agrees
  })

  it('9. inventory is the STATE: a written level sticks instead of springing back', () => {
    sim().writeTag('TK-101', 'PV', 75)
    expect(sim().tags['TK-101']!.V).toBeCloseTo(150, 6) // 75 % of 200 m³
    advance(10)
    expect(pv('TK-101')).toBeCloseTo(75, 1)
  })

  it('10. a FULL vessel stops taking flow — the mass is not quietly destroyed', () => {
    sim().writeTag('TK-102', 'PV', 99.5)
    lineUp(0, 100)
    advance(900, 2)
    expect(pv('TK-102')).toBeCloseTo(100, 6)
    expect(Math.abs(sim().pipeFlows.e4b!)).toBeLessThan(SHUT_LEAK_MAX)
  })

  it('11. an EMPTY vessel stops giving it up, and never goes negative', () => {
    sim().writeTag('TK-101', 'PV', 0)
    lineUp(0, 0, 100)              // drain wide open on an empty vessel...
    sim().writeTag('P-101', 'RUN', 0) // ...and nothing feeding it
    advance(900, 2)
    // The vessel gives up nothing: the drain carries less than the ceiling on
    // what a blocked element can pass, whatever its valve is doing.
    expect(Math.abs(sim().pipeFlows.e5!)).toBeLessThan(SHUT_LEAK_MAX)
    // Its level holds at zero to that same ceiling — bounded by the model's
    // own number rather than by a tolerance picked to fit. Fifteen minutes of
    // `SHUT_LEAK_MAX` into 200 m³ is 5e-5 %; what actually accumulates from
    // the blocked pump and the shut PV-101 is 3e-7 %, half a millilitre.
    expect(pv('TK-101')).toBeLessThan((volumeMoved(SHUT_LEAK_MAX, 900) / 200) * 100)
    expect(pv('TK-101')).toBeGreaterThanOrEqual(0)

    // and from just above empty it approaches zero rather than crashing
    // through it: the head driving the drain IS the level, so the rate falls
    // with it. This is the asymptote, not the gate.
    sim().writeTag('TK-101', 'PV', 0.2)
    advance(900, 2)
    expect(pv('TK-101')).toBeLessThan(0.2)
    expect(pv('TK-101')).toBeGreaterThanOrEqual(0)
  })
})

// ── 12. Direction ───────────────────────────────────────────────────────────

describe('a line carries a DIRECTION, and the runtime keeps it', () => {
  it('12. a leg reverses when the pressures say so, and pipeFlows carries the sign', () => {
    // pump running: the header feeds TK-101 through e4a
    lineUp(100, 0)
    advance(120, 1)
    const forward = sim().pipeFlows.e4a!
    expect(forward).toBeGreaterThan(1)

    // now stop the pump and leave TK-101 high over an empty TK-102: the only
    // pressure left in the network is TK-101's own head, so the same line runs
    // backwards, out of the vessel it was filling a moment ago
    sim().writeTag('P-101', 'RUN', 0)
    sim().writeTag('P-101', 'RAMP', 0)
    sim().writeTag('TK-101', 'PV', 90)
    sim().writeTag('TK-102', 'PV', 2)
    sim().writeTag('HV-102', 'OP', 100)
    advance(120, 1)
    const reversed = sim().pipeFlows.e4a!
    expect(reversed).toBeLessThan(-0.5)
    // and the vessels moved the way the sign says
    expect(pv('TK-101')).toBeLessThan(90)
    expect(pv('TK-102')).toBeGreaterThan(2)
    // the transmitter still reads a magnitude: a flow element does not know
    // which way round it was installed
    expect(pv('FT-101')).toBeGreaterThanOrEqual(0)
  })
})

// ── 13-14. The loops close on the solve ─────────────────────────────────────

describe('the control loops close through the hydraulic model', () => {
  it('13. the pressure loop holds a reachable setpoint with the valve off both stops', { timeout: 30000 }, () => {
    lineUp(60, 40)
    advance(60, 1)
    const reach = pv('PT-101')
    sim().writeTag('PIC-101', 'SP', reach)
    sim().writeTag('PIC-101', 'MODE', 1)
    advance(1800, 2)
    expect(Math.abs(pv('PT-101') - reach)).toBeLessThan(0.3)
    expect(sim().tags['PIC-101']!.OP!).toBeGreaterThan(0)
    expect(sim().tags['PIC-101']!.OP!).toBeLessThan(100)
  })

  it('14. the level loop moves its drain valve to hold TK-101', { timeout: 60000 }, () => {
    // THE INFLOW IS SIZED TO WHAT THE DRAIN CAN REJECT. LV-101 discharges on
    // TK-101's static head alone, and at 50 % of a 200 m³ vessel that is
    // 11.2 m³/h wide open and 3.0 m³/h at 40 % travel. PV-101 at 20 % puts
    // 4.9 m³/h in, which the drain holds at roughly half its travel: authority
    // in both directions, which is what makes this a test of modulation.
    lineUp(20, 0, 0)
    sim().writeTag('TK-101', 'PV', 45) // start near SP; 200 m³ fills slowly
    sim().writeTag('LIC-101', 'MODE', 1)
    sim().writeTag('LIC-101', 'SP', 50)
    advance(6 * 3600, 4)
    expect(Math.abs(pv('TK-101') - 50)).toBeLessThan(4)
    expect(sim().tags['LIC-101']!.OP!).toBeGreaterThan(2)
    expect(sim().tags['LIC-101']!.OP!).toBeLessThan(98)
  })
})

// ── 15-18. The runtime says what it does not know ───────────────────────────

describe('the solve publishes its own limits, and quality carries them', () => {
  it('15. the hydraulic status is published, and a healthy plant converges inside MASS_TOL', () => {
    lineUp(70, 70, 50)
    advance(60, 1)
    const h = sim().hydraulic
    expect(h.converged).toBe(true)
    expect(h.residual).toBeLessThan(MASS_TOL)
    expect(h.cavitating).toEqual([])
    expect(h.undetermined).toEqual([])
    expect(h.iterations).toBeGreaterThanOrEqual(0)
  })

  it('16. an instrument on a line with NO PATH TO A BOUNDARY reads UNCERTAIN, not a number', () => {
    // two valves wired only to each other: the network fixes the pressure
    // DIFFERENCES around the ring and not its level, so there is no pressure
    // to report. The old model would have printed the held value as a reading.
    const island: HmiScreen = {
      id: 'i', name: 'I', theme: 'classic',
      widgets: [
        { id: 'a', type: 'valve', x: 100, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
        { id: 'b', type: 'valve', x: 300, y: 100, w: 48, h: 32, tag: 'HV-2', props: { throttle: true } },
        { id: 'pt', type: 'display', x: 500, y: 40, w: 96, h: 40, tag: 'PT-9', props: { bindPipe: 'p1' } },
      ],
      pipes: [
        { id: 'p1', points: [{ x: 152, y: 116 }, { x: 296, y: 116 }], aId: 'a', aPort: 'out', bId: 'b', bPort: 'in' },
        { id: 'p2', points: [{ x: 96, y: 116 }, { x: 60, y: 200 }, { x: 360, y: 200 }, { x: 352, y: 116 }], aId: 'a', aPort: 'in', bId: 'b', bPort: 'out' },
      ],
    }
    sim().exitRun(); sim().enterRun(island)
    sim().tickOnce(1)
    expect(sim().hydraulic.undetermined.length).toBeGreaterThan(0)
    expect(sim().quality['PT-9']!.q).toBe('uncertain')
    expect(sim().quality['PT-9']!.why).toMatch(/boundary/i)
  })

  it('17. an instrument on a CAVITATING suction reads UNCERTAIN, not a confident negative', () => {
    // a 400 m³/h machine behind a nearly-shut suction valve pulls the line
    // below absolute zero. The model cannot represent that — real liquid
    // cavitates — so the number is reported with the flag, not on its own.
    const starved: HmiScreen = {
      id: 'c', name: 'C', theme: 'classic',
      widgets: [
        { id: 'sv', type: 'valve', x: 60, y: 100, w: 48, h: 32, tag: 'SV-1', props: { throttle: true } },
        { id: 'p', type: 'pump', x: 250, y: 90, w: 56, h: 56, tag: 'P-9' },
        { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-9', props: { level0: 20 } },
        { id: 'pt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'PT-9', props: { bindPipe: 'c2' } },
      ],
      pipes: [
        { id: 'c1', points: [{ x: 0, y: 116 }, { x: 56, y: 116 }], bId: 'sv', bPort: 'in' },
        { id: 'c2', points: [{ x: 112, y: 116 }, { x: 246, y: 118 }], aId: 'sv', aPort: 'out', bId: 'p', bPort: 'suction' },
        { id: 'c3', points: [{ x: 310, y: 118 }, { x: 510, y: 150 }], aId: 'p', aPort: 'discharge', bId: 't', bPort: 'bottom' },
      ],
    }
    const reg: Registry = { 'P-9': { key: 'P-9', kind: 'equipment', fields: { 'duty.capacity': '400 m³/h', 'duty.head': '90 m' } } }
    sim().exitRun(); sim().enterRun(starved, reg)
    sim().writeTag('SV-1', 'OP', 8); sim().writeTag('SV-1', 'POS', 8)
    sim().writeTag('P-9', 'RUN', 1); sim().writeTag('P-9', 'RAMP', 1)
    advance(20, 1)
    expect(sim().hydraulic.cavitating.length).toBeGreaterThan(0)
    expect(sim().quality['PT-9']!.q).toBe('uncertain')
    expect(sim().quality['PT-9']!.why).toMatch(/absolute zero/i)
  })

  it('18. a healthy instrument is still GOOD — the flags are not a blanket', () => {
    lineUp(70, 70, 50)
    advance(60, 1)
    for (const tag of ['PT-101', 'FT-101', 'LT-101', 'LT-102', 'TT-101']) {
      expect(sim().quality[tag]!.q, tag).toBe('good')
    }
  })
})

// ── 19-20. One source of truth ──────────────────────────────────────────────

describe('the solve is the only place a flow comes from', () => {
  it('19. every flow the store publishes IS the solver’s, to the last bit', () => {
    // Drive the store and a bare `tick` through the SAME sequence with the
    // same seed, and require the published map to be bit-identical to the
    // solve's. "Close to" would pass a second calculation that happened to
    // agree; identity will not.
    const m = buildSimModel(plant, registry)
    let tags = initTags(m)
    const rng = makeRng(1234) // the seed simStore uses
    const drive = (t: typeof tags) => {
      t['PIC-101']!.MODE = 0; t['PIC-101']!.OP = 70
      t['LIC-101']!.MODE = 0; t['LIC-101']!.OP = 40
      t['HV-102']!.OP = 55
      t['P-101']!.RUN = 1
    }
    drive(tags)
    // including the warm start, because the store threads one: carrying a
    // converged field forward moves the answer by a fraction of `MASS_TOL`
    // (test 20), and this test is about identity, so the two paths have to
    // hand the solver the same starting point as well as the same inputs.
    let r = tick(m, tags, 1, rng)
    for (let i = 0; i < 30; i++) {
      r = tick(m, r.tags, 1, rng, r.hydraulic.converged ? { warmStart: r.hydraulic.pressure } : undefined)
    }

    sim().exitRun(); sim().enterRun(plant, registry)
    sim().writeTag('PIC-101', 'MODE', 0); sim().writeTag('PIC-101', 'OP', 70)
    sim().writeTag('LIC-101', 'MODE', 0); sim().writeTag('LIC-101', 'OP', 40)
    sim().writeTag('HV-102', 'OP', 55); sim().writeTag('P-101', 'RUN', 1)
    for (let i = 0; i < 31; i++) sim().tickOnce(1)

    for (const p of plant.pipes) {
      expect(sim().pipeFlows[p.id], `pipe ${p.id}`).toBe(r.hydraulic.pipeFlow[p.id])
    }
    // and the branch flows the thermal model reads are the MAGNITUDES of the
    // same numbers, not a second calculation that could disagree
    for (const b of m.net.branches) {
      const first = b.pipeIds[0]
      if (first === undefined) continue
      expect(r.branchFlows[b.id]).toBe(Math.abs(r.hydraulic.pipeFlow[first] ?? 0))
    }
  })

  it('20. the warm start is an optimisation: it moves the iteration count, never the answer', () => {
    const m = buildSimModel(plant, registry)
    const seed = () => {
      const t = initTags(m)
      t['PIC-101']!.MODE = 0; t['PIC-101']!.OP = 65
      t['LIC-101']!.MODE = 0; t['LIC-101']!.OP = 30
      t['HV-102']!.OP = 45
      t['P-101']!.RUN = 1
      return t
    }
    let cold = tick(m, seed(), 1, makeRng(3))
    for (let i = 0; i < 30; i++) cold = tick(m, cold.tags, 1, makeRng(3))
    let warm = tick(m, seed(), 1, makeRng(3))
    for (let i = 0; i < 30; i++) {
      warm = tick(m, warm.tags, 1, makeRng(3),
        warm.hydraulic.converged ? { warmStart: warm.hydraulic.pressure } : undefined)
    }
    // TO WITHIN `MASS_TOL`, which is the resolution the answer is defined to
    // and not a tolerance chosen to make this pass. Newton stops when the
    // worst junction residual is under `MASS_TOL`, so two converged solves of
    // the same network are the same answer to that precision — a tenth of a
    // millilitre an hour — and demanding more of them would be demanding
    // something the solver never claimed.
    for (const p of plant.pipes) {
      const d = Math.abs(warm.hydraulic.pipeFlow[p.id]! - cold.hydraulic.pipeFlow[p.id]!)
      expect(d, `pipe ${p.id}`).toBeLessThan(MASS_TOL)
    }
    expect(Math.abs(warm.tags['TK-101']!.V! - cold.tags['TK-101']!.V!)).toBeLessThan(MASS_TOL)
    expect(warm.hydraulic.iterations).toBeLessThanOrEqual(cold.hydraulic.iterations)
  })
})

// ── 21-22. It stays honest over time ────────────────────────────────────────

describe('nothing degrades over a long run', () => {
  it('21. every published number stays finite and in range through a shift', { timeout: 60000 }, () => {
    lineUp(55, 45, 0)
    sim().writeTag('LIC-101', 'MODE', 1)
    sim().writeTag('LIC-101', 'SP', 60)
    advance(8 * 3600, 10)
    const finite = (label: string, o: Record<string, number>) => {
      for (const [k, v] of Object.entries(o)) expect(Number.isFinite(v), `${label}.${k} = ${v}`).toBe(true)
    }
    finite('pipeFlows', sim().pipeFlows)
    finite('pipePressures', sim().pipePressures)
    finite('branchFlows', sim().branchFlows)
    finite('equipFlows', sim().equipFlows)
    for (const [tag, sigs] of Object.entries(sim().tags)) finite(tag, sigs)
    for (const t of ['TK-101', 'TK-102']) {
      expect(pv(t)).toBeGreaterThanOrEqual(0)
      expect(pv(t)).toBeLessThanOrEqual(100)
    }
    expect(sim().hydraulic.converged).toBe(true)
  })

  it('22. RESET puts the plant back exactly where it started', () => {
    lineUp(80, 80, 20)
    advance(1200, 2)
    expect(pv('TK-101')).not.toBeCloseTo(30, 1)
    sim().reset()
    expect(pv('TK-101')).toBeCloseTo(30, 6)
    expect(pv('TK-102')).toBeCloseTo(10, 6)
    expect(sim().tags['P-101']!.RUN).toBe(0)
    expect(sim().t).toBe(0)
    expect(sim().pipeFlows).toEqual({})
    expect(sim().hydraulic.converged).toBe(true)
    // and it runs calm from there: a stale pressure field from the old state
    // must not be carried into the new solve
    advance(20)
    for (const f of Object.values(sim().pipeFlows)) expect(Math.abs(f)).toBeLessThan(SHUT_LEAK_MAX)
  })
})

/** The supply boundary, stated here so a change to it fails loudly. */
it('the boundary pressure every free end sits at is the one documented', () => {
  expect(DEFAULTS.supplyPressureBar).toBe(1)
})

// ── 23. Preservation, on the real drawings ──────────────────────────────────

describe('nothing disappears between the P&ID and the plant that is simulated', () => {
  /**
   * The compilation from drawing to process model is where a line can be lost
   * silently: an end that attaches to nothing, a device the port schema has no
   * entry for, a symbol that is not in the library when the model is built.
   * A lost line is worse than a wrong one — the operator can see it on the
   * screen and the physics cannot, so it never flows and nothing says why.
   *
   * These are the bundled samples, counted on both sides of the compile.
   */
  for (const file of ['sample-plant.pnid.json', 'sample-refinery-unit.pnid.json', 'template-hmi-demo.pnid.json']) {
    it(`${file}: every pipe and every device survives compilation`, () => {
      const doc = loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples', file), 'utf8')))
      const screens = doc.hmiScreens.length > 0 ? doc.hmiScreens : doc.sheets.map((sh) => importSheet(doc, sh.id))
      const list = Array.isArray(screens) ? screens : [screens]
      const m = buildSimModel(list)

      // PIPES: one edge each, none shared, none missing.
      const drawnPipes = list.flatMap((sc) => sc.pipes.map((p) => p.id))
      expect(m.hydraulic.edgeOfPipe.size).toBe(drawnPipes.length)
      for (const id of drawnPipes) expect(m.hydraulic.edgeOfPipe.get(id), `pipe ${id}`).toBeDefined()
      expect(new Set(m.hydraulic.edgeOfPipe.values()).size).toBe(drawnPipes.length)

      // DEVICES: every widget the port schema recognises becomes equipment
      // with at least one port. A piece of equipment with no port cannot be
      // connected to anything, which is the silent-loss case.
      for (const [tag, eq] of m.hydraulic.equipment) {
        expect(eq.ports.length, `${tag} has no ports`).toBeGreaterThan(0)
      }

      // and the network the plant runs on is solvable and finite
      const tags = initTags(m)
      const r = tick(m, tags, 1, makeRng(5))
      for (const [id, f] of Object.entries(r.hydraulic.pipeFlow)) {
        expect(Number.isFinite(f), `${file} pipe ${id} = ${f}`).toBe(true)
      }
      for (const [id, p] of Object.entries(r.hydraulic.pressure)) {
        expect(Number.isFinite(p), `${file} node ${id} = ${p}`).toBe(true)
      }
    })
  }
})
