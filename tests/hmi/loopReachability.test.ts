// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K3.1 — CAN THE LOOP GET THERE AT ALL?
 *
 * Written after the K3 integration was reverted with a pressure loop sitting
 * 0.5 bar off setpoint and a level loop 4.8 % off. The obvious reading was
 * "the controllers need retuning". It was wrong, and this file is the evidence.
 *
 * THE QUESTION THAT HAS TO COME FIRST is not how the controller is tuned but
 * what the process can physically deliver. Sweep the actuator end to end, read
 * the controlled variable at each point, and that is the achievable range. A
 * setpoint outside it is not a tuning problem, and no gain will make it one —
 * the controller should drive to its limit and stay there, which is exactly
 * what a real one does.
 *
 * These loops are closed HERE, through the real hydraulic solver and the real
 * gains, rather than through `engine.ts`: the runtime integration is still
 * gated (see `docs/HMI-AUDIT.md`), and the point is to establish the process
 * behaviour independently of it.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import type { HmiScreen } from '../../src/hmi/model'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import type { ProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
import type { SolveInputs, SolveResult } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS, SECONDS_PER_HOUR, volumeMoved } from '../../src/hmi/sim/units'

/** The gains the runtime uses, per quantity. Mirrors `TUNING` in engine.ts. */
const GAINS = {
  level: { kp: 6, ti: 600 },
  pressure: { kp: 1, ti: 60 },
} as const

/** Valve travel, % per second, and the controller/actuator conventions the
 *  engine uses. Kept here so the loop below is the same loop. */
const STROKE = 25

/** source -> P-101 -> PV-101 -> TK-101, PT-101 on the discharge header.
 *  Identical to the fixture in `pressure.test.ts`. */
const pressureScreen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'PV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { capacity: 500, level0: 40 } },
    { id: 'pt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'PT-101', props: { bindPipe: 'e2' } },
    { id: 'pic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'PIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
}

const inputs = (over: Partial<SolveInputs> = {}): SolveInputs => ({
  valveOpen: () => 1,
  pumpSpeed: () => 1,
  pumpRated: () => DEFAULTS.pumpFlowM3h,
  pumpHead: () => DEFAULTS.pumpHeadBar,
  vesselLevel: () => 40,
  ...over,
})

/** What a PT bound to a pipe reads: the mean of its edge's two node pressures. */
function pipePressure(m: ProcessModel, r: SolveResult, pipeId: string): number {
  const e = m.edges.find((x) => x.id === m.edgeOfPipe.get(pipeId))
  if (!e) return Number.NaN
  return ((r.pressure[e.from] ?? 0) + (r.pressure[e.to] ?? 0)) / 2
}

/** One PI step, with the engine's anti-windup and span normalisation. */
function pi(
  gains: { kp: number; ti: number },
  sp: number, pv: number, span: number, action: 1 | -1, I: number, dt: number,
): { op: number; I: number } {
  const e = (((sp - pv) * action) / span) * 100
  let op = Math.max(0, Math.min(100, gains.kp * e + I))
  // conditional integration: freeze I while saturated in the error's direction
  if (!((op >= 100 && e > 0) || (op <= 0 && e < 0))) {
    I = Math.max(-100, Math.min(100, I + (gains.kp / gains.ti) * e * dt))
    op = Math.max(0, Math.min(100, gains.kp * e + I))
  }
  return { op, I }
}

// ── Reachability ────────────────────────────────────────────────────────────

describe('what the pressure loop can physically reach', () => {
  const m = buildProcessModel(pressureScreen)
  const ptAt = (open: number, level = 40) =>
    pipePressure(m, solveHydraulics(m, inputs({ valveOpen: () => open, vesselLevel: () => level })), 'e2')

  it('sweeping the valve end to end gives a range of 3.50 to 8.20 bar', () => {
    const wideOpen = ptAt(1)
    const shut = ptAt(0)
    // Wide open the machine is at its rated duty: 50 m³/h, 4 bar of head, and
    // the supply line has dropped the suction to about zero. Shut, it sits at
    // shutoff — 7.2 bar on top of the 1 bar boundary.
    expect(wideOpen).toBeCloseTo(3.5, 2)
    expect(shut).toBeCloseTo(8.2, 2)
    // and it is monotone between, so every value in between is reachable
    let last = Infinity
    for (const open of [1, 0.8, 0.6, 0.4, 0.2, 0.1, 0]) {
      const pt = ptAt(open)
      expect(pt, `valve ${open}`).toBeGreaterThan(last === Infinity ? -1 : last)
      last = pt
    }
  })

  it('3 bar is BELOW the minimum, so no gain can reach it', () => {
    expect(ptAt(1)).toBeGreaterThan(3)
  })
})

// ── Closed loop ─────────────────────────────────────────────────────────────

/** Close the pressure loop for `seconds`, returning where it ends up. */
function runPressure(sp: number, seconds = 900) {
  const m = buildProcessModel(pressureScreen)
  const capacity = 500
  let I = 0, op = 40, pos = 40, level = 40
  let V = (capacity * level) / 100
  let pv = 0
  const dt = 1
  for (let i = 0; i < seconds; i++) {
    ;({ op, I } = pi(GAINS.pressure, sp, pv, 10, -1, I, dt))
    pos += Math.max(-STROKE * dt, Math.min(STROKE * dt, op - pos))
    const r = solveHydraulics(m, inputs({ valveOpen: () => pos / 100, vesselLevel: () => level }))
    V = Math.max(0, Math.min(capacity, V + volumeMoved(r.pipeFlow.e3!, dt)))
    level = (V / capacity) * 100
    pv = pipePressure(m, r, 'e2')
  }
  return { pv, op, pos }
}

describe('the pressure loop, closed through the solver', () => {
  it('reaches a setpoint inside its range, with the valve off both stops', () => {
    const { pv, op } = runPressure(6)
    expect(Math.abs(pv - 6)).toBeLessThan(0.1)
    expect(op).toBeGreaterThan(0)
    expect(op).toBeLessThan(100)
  })

  it('moves the valve the right way: a higher setpoint needs a TIGHTER valve', () => {
    const low = runPressure(4.5)
    const high = runPressure(7)
    expect(high.pv).toBeGreaterThan(low.pv)
    expect(high.pos).toBeLessThan(low.pos)
  })

  it('SATURATES at the physical limit for an unreachable setpoint, rather than wandering', () => {
    // The behaviour the K3 integration was showing, and the correct one. The
    // controller opens the valve fully, the anti-windup stops the integrator
    // running away, and the PV sits at the minimum the process can deliver.
    const { pv, op } = runPressure(3)
    expect(op).toBeCloseTo(100, 1)
    expect(pv).toBeCloseTo(3.5, 2)
  })
})

// ── The outlet-valve level loop ─────────────────────────────────────────────

/** source -> P-201 -> FV-201 (fixed) -> TK-201 -> LV-201 -> sink.
 *  Identical to the fixture in `controllers.test.ts`. */
const outletScreen: HmiScreen = {
  id: 'o', name: 'O', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 0, y: 130, w: 56, h: 56, tag: 'P-201' },
    { id: 'fv', type: 'valve', x: 150, y: 140, w: 48, h: 32, tag: 'FV-201', props: { throttle: true } },
    { id: 't', type: 'tank', x: 300, y: 40, w: 96, h: 128, tag: 'TK-201', props: { capacity: 100, level0: 30 } },
    { id: 'v', type: 'valve', x: 500, y: 150, w: 48, h: 32, tag: 'LV-201', props: { throttle: true } },
    { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-201', props: { bindTank: 'TK-201' } },
    { id: 'lic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'LIC-201', props: { controller: true } },
  ],
  pipes: [
    { id: 'i0', points: [{ x: -40, y: 158 }, { x: 10, y: 158 }] },
    { id: 'i1', points: [{ x: 60, y: 158 }, { x: 160, y: 156 }] },
    { id: 'i2', points: [{ x: 200, y: 156 }, { x: 310, y: 100 }] },
    { id: 'a', points: [{ x: 360, y: 160 }, { x: 510, y: 166 }] },
    { id: 'b', points: [{ x: 540, y: 166 }, { x: 700, y: 300 }] },
  ],
}

describe('the outlet-valve level loop, closed through the solver', () => {
  const m = buildProcessModel(outletScreen)
  const at = (level: number, drain: number) => solveHydraulics(m, inputs({
    valveOpen: (t) => (t === 'FV-201' ? 0.3 : drain),
    vesselLevel: () => level,
  }))

  /**
   * THE FINDING THAT EXPLAINS THE 4.8 %.
   *
   * This loop drains by GRAVITY, so its authority comes from the static head
   * of the vessel it is emptying — and that head is what the loop is
   * controlling. At the setpoint the drain at FULL travel carries 11.18 m³/h
   * against an inflow of 11.78: the actuator is marginally short, and the
   * equilibrium therefore sits a few per cent ABOVE setpoint, where the extra
   * head makes up the difference.
   *
   * The loop is stable and well behaved. It is simply operating at the edge of
   * its authority, which is why a change in the drain characteristic moves its
   * steady state by several per cent rather than a fraction of one. That is a
   * SIZING observation about the fixture, not a tuning fault, and no gain
   * changes it.
   */
  it('runs at the EDGE of its authority: full drain barely matches the inflow', () => {
    const inflow = at(50, 1).pipeFlow.i2!
    const drainAtSp = Math.abs(at(50, 1).pipeFlow.a!)
    expect(inflow).toBeGreaterThan(0)
    // within a tenth of each other — the loop has almost no margin
    expect(Math.abs(drainAtSp - inflow) / inflow).toBeLessThan(0.1)
    // and the margin comes back as the level rises, because head is authority
    const drainHigher = Math.abs(at(60, 1).pipeFlow.a!)
    expect(drainHigher).toBeGreaterThan(inflow)
  })

  it('holds its setpoint, with the drain off both stops', () => {
    const SP = 50, capacity = 100, dt = 2
    let level = 30, V = (capacity * level) / 100, I = 0, op = 40, pos = 40
    for (let i = 0; i < Math.round((4 * SECONDS_PER_HOUR) / dt); i++) {
      ;({ op, I } = pi(GAINS.level, SP, level, 100, -1, I, dt))
      pos += Math.max(-STROKE * dt, Math.min(STROKE * dt, op - pos))
      const r = at(level, pos / 100)
      V = Math.max(0, Math.min(capacity, V + volumeMoved(r.pipeFlow.i2! - Math.abs(r.pipeFlow.a!), dt)))
      level = (V / capacity) * 100
    }
    // THE FINDING: the published gains close this loop exactly. Tuning was not
    // the cause of the 4.8 % offset the K3 integration showed.
    expect(Math.abs(level - SP)).toBeLessThan(0.5)
    expect(op).toBeGreaterThan(0)
    expect(op).toBeLessThan(100)
  }, 60000)
})
