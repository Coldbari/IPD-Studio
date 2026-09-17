// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K16 — A LOOP THAT KNOWS WHEN IT CANNOT DO ANYTHING.
 *
 * K15's calm start put every unconfigured loop ON its own measurement, and
 * that exposed something that had always been there: a PI loop with a noisy
 * transmitter and nothing it can do about the process INTEGRATES THE NOISE.
 * Conditional integration freezes the integrator at a stop only when the error
 * pushes further into it, so at the lower stop the downward half of the noise
 * is blocked and the upward half is not. Measured: 0.3 % of output after
 * twenty seconds, 21 % after thirty-six minutes, on a plant whose pump was
 * stopped the whole time. A calm screen slowly opening its own valves.
 *
 * ── WHAT K16 DOES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
 *
 *  1. AUTHORITY IS DERIVED, NOT INFERRED. Five things the runtime states —
 *     is there an actuator, is it in the runtime, is a driven one energised,
 *     is a valve stuck, can the solve stand behind the measurement — plus one
 *     that is sound rather than inferential: the machine the MEASUREMENT
 *     depends on, because a stopped pump BLOCKS in this model.
 *  2. NO AUTHORITY MEANS HOLD. The output and the integrator stay exactly
 *     where the plant left them. Not reset, not zeroed, not decayed.
 *  3. NO DEADBAND. Nothing here stops the loop responding to a real error.
 *  4. NOTHING WAS RETUNED. Every gain is the one K14 and K15 measured.
 *  5. AUTHORITY IS NOT SATURATION. A saturated loop is working and out of
 *     range; a loop with no authority is not working at all, and `SAT` is
 *     cleared rather than set so the two never read as the same thing.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { AUTHORITY_SEVERITY, authorityOf, loopFindings } from '../../src/hmi/sim/authority'
import type { ControlAuthority } from '../../src/hmi/sim/authority'
import { buildSimModel } from '../../src/hmi/sim/engine'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The fixtures ────────────────────────────────────────────────────────────

/** BL-S ─ P-1 ─ HV-9 ─ BL-D with PT-1 on the discharge: K14's plant. */
const plant: HmiScreen = {
  id: 'k16', name: 'K16', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 120, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** The same plant where the loop throttles a VALVE instead of the drive. */
const valveLoop: HmiScreen = {
  ...plant,
  widgets: plant.widgets.map((w) => (w.id === 'hv' ? { ...w, tag: 'PV-1' } : w)),
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const reg = (extra: Record<string, string> = {}, suction = '1 barg'): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment',
    fields: { ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %', ...extra } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': suction } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
})
/** A machine with no declared drive: K14 refuses the loop, so it drives nothing. */
const fixedSpeed: Registry = { ...reg(), 'P-1': { key: 'P-1', kind: 'equipment', fields: duty } }
/**
 * ...and a machine specified well past what its suction can supply, fed from a
 * near-vacuum header. The solve reports a node below absolute zero and
 * intermittently fails to converge — which is exactly the case a controller
 * must not act on.
 */
const cavitating: Registry = reg({ 'duty.capacity': '200 m³/h' }, '0.05 bara')

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const pic = () => sim().tags['PIC-1']!
const pump = () => sim().tags['P-1']!
const loop = () => sim().loops['PIC-1']!
const lineUp = (sp = 3, valve = 'HV-9') => {
  sim().writeTag(valve, 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  sim().writeTag('PIC-1', 'SP', sp)
}

beforeEach(() => { start() })

// ── A. Healthy ──────────────────────────────────────────────────────────────

describe('A — a loop that can reach its process says so, and regulates', () => {
  it('authority is available, and the loop holds setpoint', () => {
    lineUp(); advance(300)
    expect(loop().authority).toBe('available')
    expect(pic().AUTH).toBe(1)
    expect(pic().PV!).toBeCloseTo(3, 0)
    expect(loop().mode).toBe('AUTO')
    expect(loopFindings(sim().loops), 'a working loop is not a finding').toEqual([])
  })

  it('and the integrator is doing real work, not sitting still', () => {
    lineUp(); advance(300)
    const before = pic().I!
    sim().writeTag('PIC-1', 'SP', 2.4)
    advance(200)
    expect(Math.abs(pic().I! - before)).toBeGreaterThan(5)
  })
})

// ── B, C, D, E, F. Every way authority is lost ──────────────────────────────

describe('B, C, D, E, F — the conditions the runtime can actually state', () => {
  it('B: a stopped machine', () => {
    lineUp(); advance(300)
    sim().writeTag('P-1', 'RUN', 0)
    advance(5)
    expect(loop().authority).toBe('de-energised')
    expect(loop().blockedBy).toBe('P-1')
    expect(pic().AUTH).toBe(0)
  })

  it('C: a tripped machine', () => {
    lineUp(); advance(300)
    sim().writeTag('P-1', 'FAULT', 1)
    advance(5)
    expect(loop().authority).toBe('de-energised')
    expect(pump().RUN).toBe(0)                 // the trip opened the breaker
    expect(pic().AUTH).toBe(0)
  })

  it('D: a loop with no final element at all', () => {
    start(fixedSpeed)
    expect(sim().controllers.find((c) => c.tag === 'PIC-1')!.outTag).toBeUndefined()
    lineUp(); advance(60)
    expect(loop().authority).toBe('no-actuator')
    expect(loop().actuator).toBeUndefined()
    expect(pic().AUTH).toBe(0)
  })

  it('E: a stuck valve — including one stuck where it was asked to be', () => {
    start(reg(), valveLoop)
    lineUp(3, 'PV-1'); advance(200)
    expect(loop().authority).toBe('available')
    sim().writeTag('PV-1', 'STUCK', 1)
    advance(5)
    expect(loop().authority).toBe('stuck')
    expect(AUTHORITY_SEVERITY.stuck).toBe('warning')
  })

  it('F: a solve the measurement cannot stand behind', () => {
    start(cavitating)
    lineUp(); advance(20)
    const seen: { converged: boolean; authority: ControlAuthority }[] = []
    for (let i = 0; i < 40; i++) {
      advance(1)
      seen.push({ converged: sim().hydraulic.converged, authority: loop().authority })
    }
    // the plant really does defeat the solver here
    expect(seen.some((s) => !s.converged), 'the fixture produces failed solves').toBe(true)
    expect(seen.some((s) => s.authority === 'unsolved')).toBe(true)
    // ...and the loop sees it ONE TICK LATER, because it judges the solve that
    // produced the reading it is acting on. K11's latency, unchanged.
    for (let i = 1; i < seen.length; i++) {
      if (seen[i]!.authority === 'unsolved') {
        expect(seen[i - 1]!.converged, `tick ${i}`).toBe(false)
      }
    }
    expect(sim().hydraulic.cavitating.length).toBeGreaterThan(0)
  })

  it('a stopped machine is NORMAL and reads as information, not a fault', () => {
    lineUp(); advance(60)
    sim().writeTag('P-1', 'RUN', 0); advance(5)
    const f = loopFindings(sim().loops)
    expect(f).toHaveLength(1)
    expect(f[0]!.severity).toBe('info')
    expect(f[0]!.tag).toBe('PIC-1')
    expect(f[0]!.message).toContain('P-1')
    expect(f[0]!.message).toContain('held where the plant left them')
  })
})

// ── G, H, L. Hold, and coming back ──────────────────────────────────────────

describe('G, H, L — held, exactly, and resumed without a kick', () => {
  it('G: the output and the integrator do not move for half an hour', () => {
    lineUp(); advance(300)
    expect(loop().authority).toBe('available')
    sim().writeTag('P-1', 'RUN', 0)
    advance(5)
    const held = { op: pic().OP!, i: pic().I! }
    expect(held.op).toBeGreaterThan(50)        // it was doing real work
    advance(1800)                              // thirty minutes of noise
    expect(pic().OP).toBe(held.op)
    expect(pic().I).toBe(held.i)
    // and the MEASUREMENT kept moving the whole time — nothing was frozen but
    // the controller's own state. It reads the PREVIOUS tick's transmitter, as
    // it always has, which is why the two differ here by one tick.
    const seen = pic().PV!
    sim().tickOnce(1)
    expect(pic().PV).toBe(seen === sim().tags['PT-1']!.PV ? seen : pic().PV)
    expect(pic().PV).not.toBe(sim().tags['PT-1']!.PV)
    expect(pic().OP).toBe(held.op)     // and still held, through all of it
  })

  it('G: and that is the DEFECT this phase exists for, measured', () => {
    // K15 measured 21 % of output accumulated in thirty-six minutes on a
    // stopped plant. Here the same thirty-six minutes move it by nothing.
    lineUp(); advance(60)
    sim().writeTag('P-1', 'RUN', 0); advance(5)
    const op = pic().OP!
    advance(2160)
    expect(pic().OP! - op).toBe(0)
  })

  it('H, L: AUTO → no authority → AUTO resumes from where it was', () => {
    lineUp(); advance(300)
    const regulating = { op: pic().OP!, i: pic().I! }

    sim().writeTag('P-1', 'RUN', 0)
    advance(600)
    expect(loop().authority).toBe('de-energised')
    expect(pic().I).toBe(regulating.i)

    sim().writeTag('P-1', 'RUN', 1)
    sim().tickOnce(1)
    expect(loop().authority).toBe('available')
    // the integrator picked up from where it was, moved by ONE ordinary step
    // and not by thirty minutes of accumulated noise
    expect(Math.abs(pic().I! - regulating.i)).toBeLessThan(5)

    advance(400)
    const xs: number[] = []
    for (let i = 0; i < 20; i++) { advance(1); xs.push(sim().tags['PT-1']!.PV!) }
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - 3)).toBeLessThan(0.12)
  })

  it('H: the machine is left where the loop last commanded it', () => {
    lineUp(); advance(300)
    const spd = pump().SPD!
    sim().writeTag('P-1', 'RUN', 0); advance(600)
    // the speed REFERENCE is unchanged; the shaft is at rest because the
    // drive is not enabled, which is K12's distinction and not a new one
    expect(pump().SPD).toBe(spd)
    expect(pump().RAMP).toBe(0)
  })
})

// ── I. Requested versus actual ──────────────────────────────────────────────

describe('I — what was asked for is never what the actuator became', () => {
  it('a drive mid-ramp reports both, and TRACKING while they differ', () => {
    lineUp(3.8); advance(400)
    expect(loop().tracking).toBe(false)
    sim().writeTag('PIC-1', 'SP', 1.5)
    sim().tickOnce(0.2)
    expect(loop().requested).toBe(pic().OP)
    expect(loop().actual).toBeCloseTo((pump().RAMP ?? 0) * 100, 9)
    expect(loop().requested).not.toBeCloseTo(loop().actual!, 1)
    expect(loop().tracking).toBe(true)
    advance(60)
    expect(loop().tracking).toBe(false)         // arrived; a ramp is not a fault
  })

  it('a stopped machine is tracking too: commanded somewhere, turning nowhere', () => {
    lineUp(); advance(300)
    sim().writeTag('P-1', 'RUN', 0); advance(10)
    expect(loop().requested!).toBeGreaterThan(50)
    expect(loop().actual).toBe(0)
    expect(loop().tracking).toBe(true)
  })

  it('a valve loop reports its stroked POSITION, not its command', () => {
    start(reg(), valveLoop)
    lineUp(3, 'PV-1'); advance(200)
    expect(loop().actual).toBe(sim().tags['PV-1']!.POS)
    expect(loop().actual).not.toBe(undefined)
  })
})

// ── J. Saturation is a different thing ──────────────────────────────────────

describe('J — saturation and no-authority are never the same state', () => {
  it('a saturated loop is WORKING and out of range', () => {
    lineUp(9); advance(300)
    expect(loop().authority).toBe('available')
    expect(loop().saturated).toBe(1)
    expect(pic().SAT).toBe(1)
    expect(Math.abs(pic().I!)).toBeLessThanOrEqual(100)
    expect(loopFindings(sim().loops), 'saturation is not an authority finding').toEqual([])
  })

  it('a loop with no authority is NOT saturated, whatever its output rests at', () => {
    lineUp(9); advance(300)
    expect(pic().SAT).toBe(1)
    sim().writeTag('P-1', 'RUN', 0)
    advance(5)
    // the output is still sitting at 100 — and that is no longer a statement
    // that the setpoint is unreachable, because nothing is trying
    expect(pic().OP).toBe(100)
    expect(pic().SAT).toBe(0)
    expect(loop().saturated).toBe(0)
    expect(loop().authority).toBe('de-energised')
  })

  it('and the anti-windup K14 measured is untouched at both stops', () => {
    lineUp(9); advance(60)
    const early = pic().I!
    advance(900)
    expect(pic().I!).toBeGreaterThanOrEqual(early - 1e-9)
    expect(Math.abs(pic().I!)).toBeLessThanOrEqual(100)
    sim().writeTag('PIC-1', 'SP', 0.5); advance(600)
    expect(pic().SAT).toBe(-1)
    expect(pic().OP).toBe(20)                  // the record's own turndown
    expect(Math.abs(pic().I!)).toBeLessThanOrEqual(100)
  })
})

// ── K. Modes ────────────────────────────────────────────────────────────────

describe('K — MANUAL is not a fault, and the transfer is still bumpless', () => {
  it('MANUAL reports its authority and does not act on it', () => {
    lineUp(); advance(300)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 40)
    advance(20)
    expect(loop().mode).toBe('MANUAL')
    expect(loop().authority).toBe('available')
    expect(pump().SPD).toBe(40)                // the operator still commands
    expect(loopFindings(sim().loops), 'MANUAL is not a finding').toEqual([])
  })

  it('MANUAL → AUTO is bumpless, exactly as K14 left it', () => {
    lineUp(); advance(200)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 40); advance(30)
    const from = pump().SPD!
    sim().writeTag('PIC-1', 'MODE', 1)
    sim().tickOnce(1)
    expect(Math.abs(pump().SPD! - from)).toBeLessThan(5)
  })

  it('MANUAL with no authority holds the operator\'s output too', () => {
    lineUp(); advance(200)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 40); advance(10)
    sim().writeTag('P-1', 'RUN', 0); advance(60)
    expect(loop().authority).toBe('de-energised')
    expect(loop().mode).toBe('MANUAL')
    expect(pic().OP).toBe(40)                  // still the operator's number
    expect(pump().SPD).toBe(40)
  })
})

// ── M. Determinism ──────────────────────────────────────────────────────────

describe('M — the same run twice, authority and all', () => {
  it('every published number and every state repeats', () => {
    const run = () => {
      start()
      lineUp()
      const trace: string[] = []
      for (let i = 0; i < 40; i++) {
        advance(10)
        if (i === 10) sim().writeTag('P-1', 'RUN', 0)
        if (i === 25) sim().writeTag('P-1', 'RUN', 1)
        const l = loop()
        trace.push([pic().SP, pic().PV, pic().OP, pic().I, pic().SAT, pic().AUTH,
          pump().SPD, pump().RAMP, l.requested, l.actual]
          .map((v) => (v ?? 0).toFixed(9)).join('|')
          + `|${l.authority}|${l.mode}|${l.tracking}|${l.blockedBy ?? ''}`)
      }
      return trace
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
    expect(new Set(a.map((x) => x.split('|')[10])).size, 'authority actually changed')
      .toBeGreaterThan(1)
  })
})

// ── N, O, P. Regression ─────────────────────────────────────────────────────

describe('N, O, P — everything K14, K15 and the legacy plant still do', () => {
  it('N: the K14 pressure loop still regulates and rejects a disturbance', () => {
    lineUp(); advance(400)
    const op = pic().OP!
    sim().applyScenario({ id: 's', name: 'BL-D up', overrides: [
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '2.5 barg' }] })
    sim().tickOnce(1)
    expect(sim().tags['PT-1']!.PV!).toBeGreaterThan(3.3)
    advance(400)
    expect(pic().OP!).toBeLessThan(op - 5)
    const xs: number[] = []
    for (let i = 0; i < 20; i++) { advance(1); xs.push(sim().tags['PT-1']!.PV!) }
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - 3)).toBeLessThan(0.12)
  })

  it('O: a K15 flow loop is wired, has authority and regulates', () => {
    const flowPlant: HmiScreen = {
      ...plant,
      widgets: plant.widgets.map((w) =>
        w.id === 'pt' ? { ...w, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } }
        : w.id === 'pic' ? { ...w, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } }
        : w),
    }
    start(reg(), flowPlant)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 25)
    advance(400)
    expect(sim().loops['FIC-1']!.authority).toBe('available')
    const xs: number[] = []
    for (let i = 0; i < 30; i++) { advance(1); xs.push(sim().tags['FT-1']!.PV!) }
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - 25)).toBeLessThan(0.7)
  })

  it('§10: two loops on one drive are still both refused, with no hidden priority', () => {
    const both: HmiScreen = {
      ...plant,
      widgets: [...plant.widgets,
        { id: 'ft', type: 'display', x: 900, y: 200, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
        { id: 'fic', type: 'display', x: 900, y: 260, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } }],
    }
    const m = buildSimModel(both, reg())
    expect(m.controllers.find((c) => c.tag === 'PIC-1')!.outTag).toBeUndefined()
    expect(m.controllers.find((c) => c.tag === 'FIC-1')!.outTag).toBeUndefined()
    start(reg(), both)
    lineUp(); advance(60)
    // both report the same thing, and neither is quietly preferred
    expect(sim().loops['PIC-1']!.authority).toBe('no-actuator')
    expect(sim().loops['FIC-1']!.authority).toBe('no-actuator')
    expect(pump().SPD).toBe(100)
  })

  it('P: a legacy fixed-speed machine runs exactly as it always did', () => {
    start(fixedSpeed)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    advance(60)
    expect(pump().SPD).toBeUndefined()
    expect(pump().RAMP).toBeCloseTo(1, 6)
  })
})

// ── The derivation itself ───────────────────────────────────────────────────

describe('the precedence, asked directly', () => {
  const running = { RUN: 1, FAULT: 0 }
  const stopped = { RUN: 0, FAULT: 0 }

  it('no binding outranks everything', () => {
    expect(authorityOf({}).authority).toBe('no-actuator')
    expect(authorityOf({ outTag: 'P-1' }).authority).toBe('no-actuator')
  })

  it('a de-energised actuator outranks a stuck one and an unsolved reading', () => {
    expect(authorityOf({
      outTag: 'P-1', outKind: 'pump', element: stopped, pvFault: 'unconverged',
    })).toEqual({ authority: 'de-energised', blockedBy: 'P-1' })
  })

  it('a healthy valve with a STOPPED machine behind its measurement', () => {
    expect(authorityOf({
      outTag: 'PV-1', outKind: 'valve', element: { POS: 40 },
      driverTag: 'P-1', driver: stopped,
    })).toEqual({ authority: 'de-energised', blockedBy: 'P-1' })
  })

  it('a stuck valve, whatever its machine is doing', () => {
    expect(authorityOf({
      outTag: 'PV-1', outKind: 'valve', element: { POS: 40, STUCK: 1 },
      driverTag: 'P-1', driver: running,
    }).authority).toBe('stuck')
  })

  it('an untrustworthy reading, when everything else is fine', () => {
    expect(authorityOf({
      outTag: 'P-1', outKind: 'pump', element: running, pvFault: 'cavitating',
    }).authority).toBe('unsolved')
  })

  it('and available when nothing is wrong', () => {
    expect(authorityOf({
      outTag: 'P-1', outKind: 'pump', element: running, driverTag: 'P-1', driver: running,
    })).toEqual({ authority: 'available' })
  })

  it('a heater is judged the same way a pump is', () => {
    expect(authorityOf({ outTag: 'E-1', outKind: 'heater', element: stopped }).authority)
      .toBe('de-energised')
    expect(authorityOf({ outTag: 'E-1', outKind: 'heater', element: running }).authority)
      .toBe('available')
  })

  it('a VALVE is never de-energised by its own state — only by its machine', () => {
    expect(authorityOf({ outTag: 'PV-1', outKind: 'valve', element: { POS: 0 } }).authority)
      .toBe('available')
  })
})
