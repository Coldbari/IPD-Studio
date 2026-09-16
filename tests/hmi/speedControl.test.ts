// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K14 — ONE REAL CLOSED LOOP ON THE DRIVE.
 *
 * K12 made the shaft commandable and K13 made the envelope visible. This
 * closes the loop: a pressure controller that reads the transmitter an
 * operator reads and commands the speed of the machine making that pressure.
 *
 *     SP → error → OP → SPD → shaft dynamics → RAMP → pump curve
 *        → hydraulic solve → PT → (next tick) PV → error
 *
 * Four things hold it together:
 *
 *  1. ONE PI, THE EXISTING ONE. No second algorithm was written. What is new
 *     is an output RANGE, an output DESTINATION (`SPD`) and a tuning entry of
 *     its own. Nothing in `TUNING` was touched.
 *  2. THE COMMAND IS NOT THE SHAFT. The controller writes `SPD`; the drive
 *     still owns the step from command to `RAMP`, and the solver still reads
 *     only `RAMP`. K12's distinction survives a controller.
 *  3. ONE WRITER. In AUTO and in MANUAL the controller is the only thing that
 *     writes `SPD`, and the pump's own speed control is taken away while it
 *     owns the machine. Nothing "fights" over the command.
 *  4. CAPABILITY IS STILL DECLARED. A fixed-speed machine is not quietly made
 *     into a final control element; the loop is refused and reported.
 *
 * ── THE TUNING TARGET ─────────────────────────────────────────────────────
 *
 * `SPEED_TUNING` was measured against the fixture BELOW, not chosen, and the
 * target it was measured against is:
 *
 *   - STABLE: the loop reaches the setpoint and stays there.
 *   - BOUNDED OVERSHOOT: at most a fifth of the step.
 *   - NO SUSTAINED OSCILLATION: once settled, the spread is the transmitter's
 *     own noise rather than the loop hunting.
 *   - SETTLES: inside 150 s of process time on a step within reach.
 *
 * The gains sit at roughly half the gain at which this fixture goes unstable,
 * which is an ordinary gain margin and is why the bounds below are the bounds
 * they are. They are a starting point for a training simulation and NOT a
 * claim about any real plant: loop gain here depends on the duty point, the
 * valve resistance and the boundary pressures, all of which differ per plant.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel, speedLoopCandidate } from '../../src/hmi/sim/engine'
import { pumpHead } from '../../src/hmi/sim/hydraulic/solver'
import { pumpSpeedNoDrive } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

// ── The fixture the gains were measured against ─────────────────────────────

/**
 * BL-S ─ P-1 ─ FV-1 ─ BL-D, with PT-1 on the DISCHARGE and PIC-1 reading it.
 *
 * Two STATED boundaries so that K10 can move one and the loop has a real
 * disturbance to reject, and no control valve in the loop's family — which is
 * the case K14 exists for. `PIC-1` and `PT-1` pair on family P, loop 1; `P-1`
 * parses the same way and is deliberately NOT how the machine is found.
 */
const plant: HmiScreen = {
  id: 'k14', name: 'K14', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 120, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'fv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** The same plant with the transmitter moved to the machine's SUCTION. */
const onSuction: HmiScreen = {
  ...plant,
  widgets: plant.widgets.map((w) =>
    w.id === 'pt' ? { ...w, props: { ...w.props, bindPipe: 'a1' } } : w),
}

const HEAD_AT_RATED = 35 / 10.197
const RATED = 40
const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const reg = (extra: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment',
    fields: { ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %', ...extra } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
})
/** ...and the same plant whose machine has no drive on its record. */
const fixedSpeed: Registry = { ...reg(), 'P-1': { key: 'P-1', kind: 'equipment', fields: duty } }

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const pic = () => sim().tags['PIC-1']!
const pump = () => sim().tags['P-1']!
const pt = () => sim().tags['PT-1']!.PV!
const lineUp = (sp: number) => {
  sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  sim().writeTag('PIC-1', 'SP', sp)
}
const docOf = (r: Registry, screen: HmiScreen = plant): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [screen], registry: r })

/**
 * The transmitter's MEAN over a window, bar.
 *
 * "Has it come back to setpoint" is a question about where the reading sits,
 * and a single sample of a noisy instrument cannot answer it: the noise band
 * is as wide as any control tolerance worth asserting. Twenty seconds of
 * process time, averaged, is what an operator watching the trend would call
 * the value.
 */
const settledAt = (seconds = 20): number => {
  const xs: number[] = []
  for (let i = 0; i < seconds; i++) { advance(1); xs.push(pt()) }
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * THE TRANSMITTER'S OWN NOISE FLOOR, bar.
 *
 * 0.8 % of a 10 bar span is 0.08 bar, and the peak-to-peak spread over a
 * window is a little more. Nothing about a settled loop can be asserted
 * tighter than this, and a band tighter than this would be asserting that the
 * simulator has no measurement noise — which it deliberately does.
 */
const NOISE_BAND = 0.12

beforeEach(() => { start() })

// ── A. The loop is refused where the record refuses it ──────────────────────

describe('A — a fixed-speed machine is not quietly made a final element', () => {
  it('the controller is wired to its transmitter and to NOTHING else', () => {
    const m = buildSimModel(plant, fixedSpeed)
    const c = m.controllers.find((x) => x.tag === 'PIC-1')!
    expect(c.pvTag).toBe('PT-1')
    expect(c.outTag).toBeUndefined()
    expect(c.outKind).toBeUndefined()
  })

  it('the machine is found, and its RECORD is what refuses', () => {
    const m = buildSimModel(plant, fixedSpeed)
    const cand = speedLoopCandidate(m.defs.find((d) => d.name === 'PT-1')!, m.defs, m.hydraulic)!
    expect(cand.pump).toBe('P-1')       // the topology found it
    expect(cand.vsd).toBe(false)        // the record declined it
  })

  it('and it is REPORTED rather than left silent', () => {
    const out = pumpSpeedNoDrive.run(buildIndex(docOf(fixedSpeed)))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('PIC-1')
    expect(out[0]!.message).toContain('P-1')
    expect(out[0]!.message).toContain('does not declare a variable speed drive')
    // and says nothing at all once the record declares one
    expect(pumpSpeedNoDrive.run(buildIndex(docOf(reg())))).toEqual([])
  })

  it('the machine runs exactly as it always did, at rated', () => {
    start(fixedSpeed)
    lineUp(3); advance(30)
    expect(pump().SPD).toBeUndefined()      // no drive, no speed command
    expect(pump().RAMP).toBeCloseTo(1, 6)
  })
})

// ── B, F. The loop, wired ───────────────────────────────────────────────────

describe('B, F — a pressure controller commanding a drive', () => {
  it('is wired to the machine the TOPOLOGY says makes the pressure', () => {
    const c = sim().controllers.find((x) => x.tag === 'PIC-1')!
    expect(c).toMatchObject({
      pvTag: 'PT-1', outTag: 'P-1', outKind: 'pump', action: 1,
      outMin: 20, outMax: 100,          // the turndown the record states
    })
  })

  it('a transmitter on the SUCTION side inverts the loop, because physics does', () => {
    const m = buildSimModel(onSuction, reg())
    const c = m.controllers.find((x) => x.tag === 'PIC-1')!
    expect(c.outTag).toBe('P-1')
    // faster machine, lower suction pressure: the output must move the other way
    expect(c.action).toBe(-1)
  })

  it('F: the output IS the speed command, tick for tick', () => {
    lineUp(3); advance(60)
    expect(pump().SPD).toBeCloseTo(pic().OP!, 9)
    expect(pic().OP!).toBeGreaterThan(20)
    expect(pic().OP!).toBeLessThan(100)
  })

  it('it does NOT write the shaft: command and actual are still two things', () => {
    // `RAMP_S` is 2 s, so a one-second tick can move the shaft 50 points and a
    // small correction arrives inside it. To SEE the drive, the command has to
    // move further than the drive can follow — which is what a setpoint change
    // big enough to drive the output from one stop to the other does.
    lineUp(9); advance(200)
    expect(pump().SPD).toBe(100)
    sim().writeTag('PIC-1', 'SP', 0.5)
    sim().tickOnce(0.2)
    // The command has dropped by most of its travel in one 0.2 s tick. The
    // drive can move a tenth of its travel in that time and has moved exactly
    // that — so the two are tens of per cent apart, and it is the SHAFT the
    // hydraulic model is reading.
    expect(pump().SPD!).toBeLessThan(50)
    expect(pump().RAMP!).toBeCloseTo(0.9, 6)
    expect(pump().SPD! / 100 - pump().RAMP!).toBeLessThan(-0.4)
    expect(sim().pumpEnvelopes['P-1']!.shaft).toBeCloseTo(pump().RAMP!, 9)
  })
})

// ── C, D, R, S. Manual and automatic ────────────────────────────────────────

describe('C, D, R, S — the two modes, and getting between them', () => {
  it('D: in AUTO the controller owns the speed', () => {
    lineUp(3); advance(200)
    expect(pic().MODE).toBe(1)
    expect(pt()).toBeCloseTo(3, 0)
    expect(pump().SPD).toBeCloseTo(pic().OP!, 9)
  })

  it('C: in MANUAL the operator\'s output is the speed', () => {
    lineUp(3); advance(60)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 40)
    advance(20)
    expect(pump().SPD).toBe(40)
    expect(pump().RAMP).toBeCloseTo(0.4, 6)
    // the plant followed, and the controller is no longer chasing the setpoint
    expect(pt()).toBeLessThan(3)
  })

  it('§14: there is exactly ONE writer of SPD, and it is the controller', () => {
    lineUp(3); advance(60)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 40); advance(10)
    expect(pump().SPD).toBe(40)
    // an operator write straight at the machine does not survive a tick: the
    // faceplate takes the control away for exactly this reason
    sim().writeTag('P-1', 'SPD', 95)
    sim().tickOnce(1)
    expect(pump().SPD).toBe(40)
  })

  it('S: AUTO → MANUAL is bumpless — the output is held exactly', () => {
    lineUp(3); advance(200)
    const held = pic().OP!
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().tickOnce(1)
    expect(pic().OP).toBe(held)
    expect(pump().SPD).toBe(held)
  })

  it('R: MANUAL → AUTO is bumpless — it resumes from the speed the plant is at', () => {
    lineUp(3); advance(60)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 40); advance(30)
    const from = pump().SPD!
    sim().writeTag('PIC-1', 'MODE', 1)
    sim().tickOnce(1)
    // the integrator was tracking the operator, so the first AUTO execution
    // steps by the PROPORTIONAL term and not from zero
    expect(Math.abs(pump().SPD! - from)).toBeLessThan(5)
    // ...and then it goes and does its job
    advance(250)
    expect(pt()).toBeCloseTo(3, 0)
  })

  it('a loop coming up in MANUAL leaves the machine where K12 puts it', () => {
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    advance(20)
    // seeded from the machine's own rest command, not from an output of zero
    expect(pic().OP).toBe(100)
    expect(pump().RAMP).toBeCloseTo(1, 6)
  })
})

// ── E, G–K. The whole chain, link by link ───────────────────────────────────

describe('E, G, H, I, J, K — every link in the loop, measured', () => {
  it('G, H, I: SPD → RAMP → the curve → the solve', () => {
    lineUp(3); advance(200)
    const spd = pump().SPD!
    const shaft = pump().RAMP!
    // G: the drive got where it was told to go
    expect(shaft).toBeCloseTo(spd / 100, 6)
    const envelope = sim().pumpEnvelopes['P-1']!
    // H: the curve was read at the SHAFT
    expect(envelope.shaft).toBeCloseTo(shaft, 9)
    expect(envelope.riseBar).toBeCloseTo(
      pumpHead(HEAD_AT_RATED, RATED, shaft, envelope.flowM3h!), 3)
    // I: the solve answered with a flow the machine is actually passing
    expect(envelope.flowM3h!).toBeGreaterThan(0)
    expect(sim().hydraulic.converged).toBe(true)
  })

  it('J: the transmitter reads the node the solve produced, within its band', () => {
    lineUp(3); advance(200)
    const solved = sim().pipePressures['a2']!
    expect(Math.abs(pt() - solved) / solved).toBeLessThan(0.01)
  })

  it('K, §3: the controller consumes the PREVIOUS tick\'s measurement', () => {
    lineUp(3); advance(200)
    const wasPV = sim().tags['PT-1']!.PV!
    const wasOP = pic().OP!

    sim().writeTag('FV-1', 'OP', 20)      // a large, sudden disturbance
    sim().tickOnce(1)
    // TICK N: the transmitter has moved...
    const madeAtN = sim().tags['PT-1']!.PV!
    expect(Math.abs(madeAtN - wasPV)).toBeGreaterThan(0.2)
    // ...and the controller is still holding the reading it had BEFORE it
    expect(pic().PV).toBeCloseTo(wasPV, 9)
    expect(Math.abs(pic().OP! - wasOP)).toBeLessThan(1)   // integrator only

    sim().tickOnce(1)
    // TICK N+1: it consumes exactly what tick N produced, and reacts
    expect(pic().PV).toBeCloseTo(madeAtN, 9)
    expect(pic().OP!).toBeLessThan(wasOP - 1)             // action, at last
  })

  it('E: the controller never reads head, boundary or node pressure directly', () => {
    lineUp(3); advance(200)
    // WHAT IT READS is the transmitter — the one an operator reads, noise and
    // all — as that transmitter stood on the previous tick. Not the clean
    // solved node it was derived from, and not the machine's own head.
    const transmitter = sim().tags['PT-1']!.PV!
    sim().tickOnce(1)
    expect(pic().PV).toBe(transmitter)
    expect(pic().PV).not.toBe(sim().pipePressures['a2'])
    expect(pic().PV).not.toBe(sim().pumpEnvelopes['P-1']!.riseBar)
    // the boundary it is discharging into is nowhere in its input either
    expect(pic().PV).not.toBe(sim().terminals['BL-D']?.barA)
  })
})

// ── L. Step response (§8) ───────────────────────────────────────────────────

/** Settle time, overshoot and settled spread for one setpoint step. */
function stepResponse(from: number, to: number, dt = 1) {
  start()
  lineUp(from)
  advance(400, dt)
  const began = pt()
  sim().writeTag('PIC-1', 'SP', to)
  let settle = Number.POSITIVE_INFINITY
  let peak = began
  const trace: number[] = []
  for (let i = 0; i < Math.round(240 / dt); i++) {
    advance(dt, dt)
    const pv = pt()
    trace.push(pv)
    if (to > from ? pv > peak : pv < peak) peak = pv
    settle = Math.abs(pv - to) <= NOISE_BAND
      ? (Number.isFinite(settle) ? settle : (i + 1) * dt)
      : Number.POSITIVE_INFINITY
  }
  const tail = trace.slice(-40)
  return {
    began, settle, final: pt(),
    overshoot: ((to > from ? peak - to : to - peak) / Math.abs(to - from)) * 100,
    spread: Math.max(...tail) - Math.min(...tail),
  }
}

describe('L — the step response, against the stated tuning target', () => {
  /** The measured limits of what this plant can actually make. */
  it('the setpoints below are inside what the machine can reach', () => {
    lineUp(9); advance(300)               // ask for more than it has
    expect(pic().SAT).toBe(1)
    const most = pt()
    expect(most).toBeGreaterThan(3.6)
    expect(most).toBeLessThan(4.1)
  })

  for (const [from, to] of [[2.6, 3.2], [3.2, 2.6], [2.3, 3.6]] as const) {
    it(`${from} → ${to} bar: stable, bounded overshoot, settles`, () => {
      const r = stepResponse(from, to)
      expect(r.began, 'started at the old setpoint').toBeCloseTo(from, 1)
      expect(r.final, 'arrived at the new one').toBeCloseTo(to, 1)
      expect(r.settle, 'settled within 150 s').toBeLessThanOrEqual(150)
      expect(r.overshoot, 'overshoot under a fifth of the step').toBeLessThan(20)
      expect(r.spread, 'settled spread is the transmitter\'s noise').toBeLessThan(0.25)
    })
  }

  it('and the tuning is not an artefact of the step the tests integrate at', () => {
    const r = stepResponse(2.6, 3.2, 0.2)
    expect(r.final).toBeCloseTo(3.2, 1)
    expect(r.settle).toBeLessThanOrEqual(150)
    expect(r.overshoot).toBeLessThan(20)
  })

  it('the whole chain moved, not just the setpoint', () => {
    lineUp(2.6); advance(300)
    const before = {
      op: pic().OP!, spd: pump().SPD!, ramp: pump().RAMP!,
      head: sim().pumpEnvelopes['P-1']!.riseBar!, pt: pt(),
    }
    sim().writeTag('PIC-1', 'SP', 3.2); advance(300)
    expect(pic().OP!).toBeGreaterThan(before.op)
    expect(pump().SPD!).toBeGreaterThan(before.spd)
    expect(pump().RAMP!).toBeGreaterThan(before.ramp)
    expect(sim().pumpEnvelopes['P-1']!.riseBar!).toBeGreaterThan(before.head)
    expect(pt()).toBeGreaterThan(before.pt)
  })
})

// ── M. Disturbance rejection (§9) ───────────────────────────────────────────

describe('M — a boundary that moves, and a loop that puts it back', () => {
  it('rejects a discharge-pressure disturbance it never saw coming', () => {
    lineUp(3); advance(300)
    const settled = { pv: pt(), op: pic().OP! }
    expect(settled.pv).toBeCloseTo(3, 0)

    // K10 moves the battery limit the machine discharges into. Nothing told
    // the controller; it can only find out through its transmitter.
    sim().applyScenario({ id: 's', name: 'BL-D up', overrides: [
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '2.5 barg' }] })
    sim().tickOnce(1)
    const kicked = pt()
    expect(kicked, 'the plant was genuinely disturbed').toBeGreaterThan(settled.pv + 0.3)

    advance(300)
    // the loop slowed the machine down and brought the pressure back
    expect(pic().OP!).toBeLessThan(settled.op - 5)
    expect(pump().RAMP!).toBeLessThan(settled.op / 100)
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
  })

  it('and rejects a valve disturbance the same way', () => {
    lineUp(3); advance(300)
    const op = pic().OP!
    sim().writeTag('FV-1', 'OP', 35)
    sim().tickOnce(1)
    expect(pt()).toBeGreaterThan(3 + NOISE_BAND)
    advance(300)
    expect(pic().OP!).toBeLessThan(op)
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
  })
})

// ── N, O, P, Q. Saturation and windup ───────────────────────────────────────

describe('N, O, P, Q — running out of machine, in both directions', () => {
  it('N: a setpoint above what the plant can make saturates at 100 %', () => {
    lineUp(9); advance(300)
    expect(pic().OP).toBe(100)
    expect(pic().SAT).toBe(1)
    expect(pump().SPD).toBe(100)
    expect(pump().RAMP).toBeCloseTo(1, 6)
    // the curve is defined to rated speed, and nothing asks for more
    expect(sim().pumpEnvelopes['P-1']!.shaft).toBeLessThanOrEqual(1)
  })

  it('Q: and the integrator stays bounded while it sits there', () => {
    lineUp(9)
    advance(30)
    const early = pic().I!
    advance(600)                         // ten more minutes hard against the stop
    expect(Number.isFinite(pic().I!)).toBe(true)
    expect(Math.abs(pic().I!)).toBeLessThanOrEqual(100)
    expect(pic().I!).toBeGreaterThanOrEqual(early - 1e-9)
  })

  it('Q: and it comes off the stop promptly rather than unwinding for minutes', () => {
    lineUp(9); advance(600)
    sim().writeTag('PIC-1', 'SP', 2.6)
    advance(150)
    expect(Math.abs(settledAt() - 2.6)).toBeLessThan(NOISE_BAND)
  })

  it('O: a setpoint below what the drive will run at holds at the TURNDOWN', () => {
    lineUp(0.5); advance(400)
    expect(pic().OP).toBe(20)            // the record's own minimum speed
    expect(pic().SAT).toBe(-1)
    expect(pump().SPD).toBe(20)
    expect(pump().RAMP).toBeCloseTo(0.2, 6)
    expect(Math.abs(pic().I!)).toBeLessThanOrEqual(100)
  })

  it('P: with NO turndown stated, none is invented — the floor is zero', () => {
    const noMin = reg()
    delete (noMin['P-1'] as { fields: Record<string, string> }).fields['duty.minSpeed']
    start(noMin)
    expect(sim().controllers.find((c) => c.tag === 'PIC-1')!.outMin).toBe(0)
    lineUp(0.5); advance(400)
    expect(pic().OP!).toBeLessThan(20)   // below where a stated turndown would have held it
    expect(pic().OP!).toBeGreaterThanOrEqual(0)
  })
})

// ── T. The envelope is not suppressed ───────────────────────────────────────

describe('T — K13 still reports what K14 causes', () => {
  it('a controller that runs the machine below its stated minimum flow is not excused', () => {
    start(reg({ 'duty.minFlow': '25 m³/h' }))
    lineUp(2.3); advance(300)
    const e = sim().pumpEnvelopes['P-1']!
    expect(e.flowM3h!).toBeLessThan(25)
    expect(e.state).toBe('BELOW MINIMUM FLOW')
    // the controller did this, and the diagnostic says so anyway
    expect(pic().MODE).toBe(1)
    expect(pump().SPD).toBeCloseTo(pic().OP!, 9)
  })

  it('and K14 does NOT trip, throttle or otherwise act on that', () => {
    start(reg({ 'duty.minFlow': '25 m³/h' }))
    lineUp(2.3); advance(400)
    expect(sim().pumpEnvelopes['P-1']!.state).toBe('BELOW MINIMUM FLOW')
    expect(pump().RUN).toBe(1)
    expect(pump().FAULT ?? 0).toBe(0)
    expect(pump().RAMP!).toBeGreaterThan(0)
  })

  it('§13: with no minimum stated, the controller manufactures no constraint', () => {
    lineUp(2.3); advance(300)
    expect(sim().defs['P-1']!.minFlowM3h).toBeUndefined()
    expect(sim().pumpEnvelopes['P-1']!.state).toBe('LIMIT UNKNOWN')
    // and the loop is not quietly held above some invented flow
    expect(Math.abs(settledAt() - 2.3)).toBeLessThan(NOISE_BAND)
  })
})

// ── U, V. Determinism and legacy ────────────────────────────────────────────

describe('U, V — the same run twice, and everything older unchanged', () => {
  it('U: two identical runs give identical controller trajectories', () => {
    const run = () => {
      start()
      lineUp(3)
      const trace: string[] = []
      for (let i = 0; i < 40; i++) {
        advance(5)
        trace.push([pic().PV, pic().OP, pic().I, pic().SAT, pump().SPD, pump().RAMP]
          .map((v) => (v ?? 0).toFixed(9)).join('|'))
      }
      return trace
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
    expect(new Set(a).size, 'and it actually moved').toBeGreaterThan(20)
  })

  it('U: RESET returns the controller to its defined initial state', () => {
    lineUp(3); advance(200)
    expect(pic().OP!).toBeLessThan(100)
    sim().reset()
    expect(pic().OP).toBe(100)           // the seed, which is the machine's rest command
    expect(pic().I).toBe(100)
    expect(pic().SAT).toBe(0)
    expect(pic().MODE).toBe(1)
    expect(sim().t).toBe(0)
  })

  it('§16: controller state lives in the runtime, never in the record', () => {
    const r = reg()
    const before = JSON.stringify(r)
    start(r)
    lineUp(3); advance(200)
    sim().writeTag('PIC-1', 'SP', 2.6); advance(100)
    expect(JSON.stringify(r)).toBe(before)
  })

  it('V: a valve-driven loop still drives its valve, untouched', () => {
    // the loop that existed before K14: a controller with a valve in its
    // family. K14 must not take it away and give it a pump.
    const withValve: HmiScreen = {
      ...plant,
      widgets: plant.widgets.map((w) => (w.id === 'fv' ? { ...w, tag: 'PV-1' } : w)),
    }
    const m = buildSimModel(withValve, reg())
    const c = m.controllers.find((x) => x.tag === 'PIC-1')!
    expect(c.outTag).toBe('PV-1')
    expect(c.outKind).toBe('valve')
    expect(c.outMin).toBeUndefined()     // 0-100, exactly as before
    expect(c.outMax).toBeUndefined()
  })

  it('§17: both speeds are trended, and the command does not replace the shaft', () => {
    lineUp(3); advance(60)
    sim().writeTag('PIC-1', 'SP', 2.4); advance(60)
    const spd = sim().history.getSeries('P-1.SPD', 0, 1e12, 500)
    const ramp = sim().history.getSeries('P-1.RAMP', 0, 1e12, 500)
    expect(spd.t.length).toBeGreaterThan(5)
    expect(ramp.t.length).toBe(spd.t.length)
    // two distinct series: a drive that takes time is visible in the trend
    expect([...ramp.v]).not.toEqual([...spd.v])
    expect(sim().history.getSeries('PIC-1.SP', 0, 1e12, 500).t.length).toBeGreaterThan(5)
    expect(sim().history.getSeries('PIC-1.OP', 0, 1e12, 500).t.length).toBeGreaterThan(5)
  })
})
