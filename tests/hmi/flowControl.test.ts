// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K15 — FLOW → VSD SPEED, THE SECOND LOOP TYPE.
 *
 * K14 built one closed loop and proved the chain. This adds the second on the
 * same machinery — the same PI, the same `SPD`, the same drive, the same
 * solver — and the only genuinely new engineering is WHICH MACHINE a flow
 * transmitter belongs to.
 *
 * ── WHY K14'S BINDING RULE CANNOT BE REUSED ───────────────────────────────
 *
 * `speedLoopCandidate` walks a PRESSURE ZONE: everywhere reachable without
 * crossing a pump. That is right for pressure, which is shared across a
 * junction, and wrong for flow, which DIVIDES at one. A transmitter past a tee
 * reads a fraction of the machine's output, and a loop built on it would be
 * controlling something it cannot see the whole of.
 *
 * So `flowLoopCandidate` walks THE MACHINE'S OWN STREAM — out from its
 * discharge, back from its suction — and stops at the first thing that makes
 * the flow no longer the pump's: a branch, a vessel, a battery limit. No
 * coordinate, no drawing order, no nearest-anything.
 *
 * ── ORIENTATION, AND THE GAP ──────────────────────────────────────────────
 *
 * `sense` is the sign a forward-pumping machine puts on the measured edge, and
 * the walk produces it for free. It is NOT the instrument's installed
 * orientation: this model has none, because `measurementOf` takes the
 * magnitude and no engineering record here states which way round a flow
 * element was fitted. That gap is real and is reported in `docs/HMI-AUDIT.md`
 * rather than filled with a guess. What the loop needs, and what it gets, is
 * the sign of the CONTROLLED STREAM from the topology.
 *
 * ── THE TUNING TARGET ─────────────────────────────────────────────────────
 *
 * Same target as K14, measured against the fixture below:
 * stable, overshoot at most a fifth of the step, no sustained oscillation, and
 * settled inside 150 s and inside the transmitter's own noise.
 *
 * NOT UNIVERSAL, and the limit is pinned by a test at the bottom of this file:
 * a fixed gain is a property of an operating point, and pushing this loop near
 * its machine's shutoff head — where the process gain runs away — produces a
 * bounded limit cycle rather than control. That is recorded, not hidden.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel, flowLoopCandidate } from '../../src/hmi/sim/engine'
import { pumpSpeedContended, pumpSpeedNoDrive } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

// ── The fixture the gains were measured against ─────────────────────────────

/**
 * BL-S ─ P-1 ─ HV-9 ─ BL-D, with FT-1 on the machine's own discharge line.
 *
 * The hand valve is `HV-9` on purpose: a valve sharing the loop's family and
 * number would be wired as the final element and K14's rule would never reach
 * the drive. This is the loop that has a transmitter, a machine, and nothing
 * to throttle.
 */
const plant: HmiScreen = {
  id: 'k15f', name: 'K15 flow', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 120, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const widgets = (edit: (w: HmiWidget) => HmiWidget): HmiWidget[] => plant.widgets.map(edit)
const on = (pipe: string): HmiScreen => ({
  ...plant,
  widgets: widgets((w) => (w.id === 'ft' ? { ...w, props: { ...w.props, bindPipe: pipe } } : w)),
})

/** The same plant with the discharge line DRAWN backwards. */
const drawnBackwards: HmiScreen = {
  ...plant,
  pipes: plant.pipes.map((p) => (p.id === 'a2'
    ? { ...p, points: [...p.points].reverse(), aId: 'hv', aPort: 'in', bId: 'p', bPort: 'discharge' }
    : p)),
}

/** ...and one where a tee divides the flow before the transmitter reaches it. */
const branched: HmiScreen = {
  id: 'k15fb', name: 'K15 branched', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 200, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 160, y: 190, w: 56, h: 56, tag: 'P-1' },
    { id: 'tee', type: 'symbol', x: 320, y: 210, w: 16, h: 16, tag: 'T-1', props: { symbolId: 'fit.junction' } },
    { id: 'ba', type: 'equip', x: 600, y: 100, w: 48, h: 24, tag: 'BL-A', props: { symbolId: 'bl.terminal' } },
    { id: 'bb', type: 'equip', x: 600, y: 320, w: 48, h: 24, tag: 'BL-B', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'leg', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 120, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'suc', points: [{ x: 0, y: 212 }, { x: 156, y: 218 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'hdr', points: [{ x: 220, y: 218 }, { x: 316, y: 218 }], aId: 'p', aPort: 'discharge', bId: 'tee' },
    { id: 'leg', points: [{ x: 328, y: 206 }, { x: 596, y: 112 }], aId: 'tee', bId: 'ba', bPort: 'process' },
    { id: 'leg2', points: [{ x: 328, y: 230 }, { x: 596, y: 332 }], aId: 'tee', bId: 'bb', bPort: 'process' },
  ],
}

/** ...and one with a PRESSURE loop on the same machine, to contend with. */
const contended: HmiScreen = {
  ...plant,
  widgets: [
    ...plant.widgets,
    { id: 'pt', type: 'display', x: 900, y: 200, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 260, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const reg = (extra: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment',
    fields: { ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %', ...extra } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-A': { key: 'BL-A', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-B': { key: 'BL-B', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
})
const fixedSpeed: Registry = { ...reg(), 'P-1': { key: 'P-1', kind: 'equipment', fields: duty } }

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const fic = () => sim().tags['FIC-1']!
const pump = () => sim().tags['P-1']!
const ft = () => sim().tags['FT-1']!.PV!
const lineUp = (sp?: number) => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag('FIC-1', 'SP', sp)
}
const docOf = (r: Registry, screen: HmiScreen = plant): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [screen], registry: r })
const candidateOn = (screen: HmiScreen, r: Registry = reg()) => {
  const m = buildSimModel(screen, r)
  return flowLoopCandidate(m.defs.find((d) => d.name === 'FT-1')!, m.defs, m.hydraulic)
}

/** The transmitter's mean over a window — see K14: one noisy sample cannot
 *  answer "is it on setpoint". */
const settledAt = (seconds = 30): number => {
  const xs: number[] = []
  for (let i = 0; i < seconds; i++) { advance(1); xs.push(ft()) }
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
/** 0.8 % of a 60 m³/h span, with a little room for the peak-to-peak. */
const NOISE_BAND = 0.7

beforeEach(() => { start() })

// ── E, F. The loop, and how the machine is found ────────────────────────────

describe('E, F — a flow controller finds its machine through the topology', () => {
  it('E: it is wired, to the drive, with the turndown as its floor', () => {
    expect(sim().controllers.find((c) => c.tag === 'FIC-1')).toMatchObject({
      pvTag: 'FT-1', outTag: 'P-1', outKind: 'pump', action: 1,
      outMin: 20, outMax: 100,
    })
  })

  it('F: a transmitter on the machine\'s own stream belongs to it', () => {
    expect(candidateOn(plant)).toMatchObject({ pump: 'P-1', vsd: true, ambiguous: false })
    // ...from either side of the machine: it is one stream
    expect(candidateOn(on('a1'))).toMatchObject({ pump: 'P-1', vsd: true })
    expect(candidateOn(on('a3'))).toMatchObject({ pump: 'P-1', vsd: true })
  })

  it('F: and one PAST A BRANCH does not — the flow there is not the machine\'s', () => {
    expect(candidateOn(branched)).toBeUndefined()
    const m = buildSimModel(branched, reg())
    expect(m.controllers.find((c) => c.tag === 'FIC-1')!.outTag).toBeUndefined()
  })

  it('F: the binding survives the drawing being moved', () => {
    // every coordinate shifted; the connectivity is untouched
    const moved: HmiScreen = {
      ...plant,
      widgets: widgets((w) => ({ ...w, x: w.x + 4000, y: w.y + 2500 })),
      pipes: plant.pipes.map((p) => ({
        ...p, points: p.points.map((pt) => ({ x: pt.x + 4000, y: pt.y + 2500 })),
      })),
    }
    expect(candidateOn(moved)).toMatchObject({ pump: 'P-1', vsd: true })
  })

  it('a machine with no declared drive is refused and reported', () => {
    const m = buildSimModel(plant, fixedSpeed)
    expect(m.controllers.find((c) => c.tag === 'FIC-1')!.outTag).toBeUndefined()
    const out = pumpSpeedNoDrive.run(buildIndex(docOf(fixedSpeed)))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('the flow through P-1')
    expect(out[0]!.message).toContain('does not declare a variable speed drive')
  })
})

// ── G. Orientation ──────────────────────────────────────────────────────────

describe('G — the sign of the controlled stream comes out of the walk', () => {
  it('a line drawn with the flow has sense +1', () => {
    expect(candidateOn(plant)!.sense).toBe(1)
    expect(candidateOn(on('a1'))!.sense).toBe(1)
  })

  it('the SAME line drawn backwards has sense −1, and the loop is unchanged', () => {
    const back = candidateOn(drawnBackwards)!
    expect(back.pump).toBe('P-1')
    expect(back.sense).toBe(-1)
    // the DIRECTION the drawing was drawn in does not change the control
    expect(back.action).toBe(1)
    // and the plant runs identically, because the transmitter reads a magnitude
    start(reg(), drawnBackwards)
    lineUp(25); advance(400)
    expect(Math.abs(settledAt() - 25)).toBeLessThan(NOISE_BAND)
  })

  it('Q: and the transmitter is reading the edge it is installed in', () => {
    lineUp(25); advance(400)
    const solved = Math.abs(sim().pipeFlows['a2']!)
    expect(Math.abs(ft() - solved) / solved).toBeLessThan(0.02)
    // it is the machine's own flow, because the transmitter is on its stream
    expect(Math.abs(solved - Math.abs(sim().pumpEnvelopes['P-1']!.flowM3h!))).toBeLessThan(1e-6)
  })
})

// ── H. Controller action, measured ──────────────────────────────────────────

describe('H — the action is measured, not inherited from K14', () => {
  it('more speed is more flow, across the whole range', () => {
    lineUp()
    sim().writeTag('FIC-1', 'MODE', 0)
    const seen: { op: number; ft: number }[] = []
    for (const op of [20, 40, 60, 80, 100]) {
      sim().writeTag('FIC-1', 'OP', op)
      advance(40)
      seen.push({ op, ft: ft() })
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.ft, `${seen[i]!.op} % vs ${seen[i - 1]!.op} %`).toBeGreaterThan(seen[i - 1]!.ft)
    }
    // the process gain this loop was tuned against: about 0.7 % of a 60 m³/h
    // span per % of output, and very nearly a straight line, because capacity
    // goes as speed where head goes as speed squared
    const gain = (seen[4]!.ft - seen[0]!.ft) / (100 - 20) / 60 * 100
    expect(gain).toBeGreaterThan(0.6)
    expect(gain).toBeLessThan(0.8)
    expect(sim().controllers.find((c) => c.tag === 'FIC-1')!.action).toBe(1)
  })
})

// ── I. Step response ────────────────────────────────────────────────────────

function stepResponse(from: number, to: number, dt = 1) {
  start()
  lineUp(from)
  advance(400, dt)
  const began = ft()
  sim().writeTag('FIC-1', 'SP', to)
  let settle = Number.POSITIVE_INFINITY
  let peak = began
  const trace: number[] = []
  for (let i = 0; i < Math.round(300 / dt); i++) {
    advance(dt, dt)
    const v = ft()
    trace.push(v)
    if (to > from ? v > peak : v < peak) peak = v
    settle = Math.abs(v - to) <= NOISE_BAND
      ? (Number.isFinite(settle) ? settle : (i + 1) * dt)
      : Number.POSITIVE_INFINITY
  }
  const tail = trace.slice(-40)
  return {
    began, settle, final: ft(),
    overshoot: ((to > from ? peak - to : to - peak) / Math.abs(to - from)) * 100,
    spread: Math.max(...tail) - Math.min(...tail),
  }
}

describe('I — the step response, against the stated tuning target', () => {
  for (const [from, to] of [[20, 30], [30, 20], [15, 38]] as const) {
    it(`${from} → ${to} m³/h: stable, bounded overshoot, settles`, () => {
      const r = stepResponse(from, to)
      expect(r.began, 'started at the old setpoint').toBeCloseTo(from, 0)
      expect(r.final, 'arrived at the new one').toBeCloseTo(to, 0)
      expect(r.settle, 'settled within 150 s').toBeLessThanOrEqual(150)
      expect(r.overshoot, 'overshoot under a fifth of the step').toBeLessThan(20)
      expect(r.spread, 'settled spread is the transmitter\'s noise').toBeLessThan(1.5)
    })
  }

  it('and the tuning is not an artefact of the step the tests integrate at', () => {
    const r = stepResponse(20, 30, 0.2)
    expect(r.final).toBeCloseTo(30, 0)
    expect(r.settle).toBeLessThanOrEqual(150)
    expect(r.overshoot).toBeLessThan(20)
  })

  it('R: and the whole chain moved, command and shaft still apart', () => {
    lineUp(20); advance(400)
    const before = {
      op: fic().OP!, spd: pump().SPD!, ramp: pump().RAMP!,
      head: sim().pumpEnvelopes['P-1']!.riseBar!, ft: ft(),
    }
    sim().writeTag('FIC-1', 'SP', 34)
    // one second into a two-second ramp: the command has moved further than
    // the drive has, and the solver is reading the drive
    sim().tickOnce(1)
    expect(pump().SPD!).toBeGreaterThan(before.spd)
    expect(sim().pumpEnvelopes['P-1']!.shaft).toBeCloseTo(pump().RAMP!, 9)
    advance(400)
    expect(fic().OP!).toBeGreaterThan(before.op)
    expect(pump().RAMP!).toBeGreaterThan(before.ramp)
    expect(sim().pumpEnvelopes['P-1']!.riseBar!).toBeGreaterThan(before.head)
    expect(ft()).toBeGreaterThan(before.ft)
  })
})

// ── J. Disturbance rejection ────────────────────────────────────────────────

describe('J — the loop puts the flow back after a disturbance it never saw', () => {
  it('a valve closing on it', () => {
    lineUp(25); advance(400)
    const op = fic().OP!
    sim().writeTag('HV-9', 'OP', 70)
    sim().tickOnce(1); advance(2)
    expect(ft(), 'genuinely disturbed').toBeLessThan(25 - NOISE_BAND)
    advance(400)
    expect(fic().OP!).toBeGreaterThan(op + 5)
    expect(Math.abs(settledAt() - 25)).toBeLessThan(NOISE_BAND)
  })

  it('a K10 boundary pressure rising in front of it', () => {
    lineUp(25); advance(400)
    const op = fic().OP!
    sim().applyScenario({ id: 's', name: 'BL-D up', overrides: [
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '1.8 barg' }] })
    sim().tickOnce(1); advance(2)
    expect(ft()).toBeLessThan(25 - NOISE_BAND)
    advance(400)
    expect(fic().OP!).toBeGreaterThan(op + 5)
    expect(pump().RAMP!).toBeGreaterThan(op / 100)
    expect(Math.abs(settledAt() - 25)).toBeLessThan(NOISE_BAND)
  })
})

// ── K, L. Saturation ────────────────────────────────────────────────────────

describe('K, L — running out of machine, in both directions', () => {
  it('K: a flow the plant cannot make saturates at 100 %', () => {
    lineUp(55); advance(400)
    expect(fic().OP).toBe(100)
    expect(fic().SAT).toBe(1)
    expect(pump().RAMP).toBeCloseTo(1, 6)
    expect(ft()).toBeLessThan(55)              // no flow was manufactured
    expect(Math.abs(fic().I!)).toBeLessThanOrEqual(100)
  })

  it('L: a flow below what the drive will run at holds at the TURNDOWN', () => {
    lineUp(3); advance(500)
    expect(fic().OP).toBe(20)                  // the record's own minimum speed
    expect(fic().SAT).toBe(-1)
    expect(pump().SPD).toBe(20)
    expect(pump().RAMP).toBeCloseTo(0.2, 6)
    expect(ft()).toBeGreaterThan(3)            // still passing more than asked
    expect(Math.abs(fic().I!)).toBeLessThanOrEqual(100)
  })

  it('with NO turndown stated, none is invented', () => {
    const noMin = reg()
    delete (noMin['P-1'] as { fields: Record<string, string> }).fields['duty.minSpeed']
    start(noMin)
    expect(sim().controllers.find((c) => c.tag === 'FIC-1')!.outMin).toBe(0)
    lineUp(3); advance(500)
    expect(fic().OP!).toBeLessThan(20)
    expect(fic().OP!).toBeGreaterThanOrEqual(0)
  })

  it('and the integrator stays bounded while it sits on a stop', () => {
    lineUp(55); advance(60)
    const early = fic().I!
    advance(900)
    expect(Number.isFinite(fic().I!)).toBe(true)
    expect(Math.abs(fic().I!)).toBeLessThanOrEqual(100)
    expect(fic().I!).toBeGreaterThanOrEqual(early - 1e-9)
    // and it comes off the stop rather than unwinding for minutes
    sim().writeTag('FIC-1', 'SP', 25)
    advance(200)
    expect(Math.abs(settledAt() - 25)).toBeLessThan(NOISE_BAND)
  })
})

// ── M. The envelope is not suppressed ───────────────────────────────────────

describe('M — K13 still reports what K15 causes', () => {
  it('a controller holding the machine below its stated minimum flow is not excused', () => {
    start(reg({ 'duty.minFlow': '20 m³/h' }))
    lineUp(12); advance(500)
    const e = sim().pumpEnvelopes['P-1']!
    expect(e.flowM3h!).toBeLessThan(20)
    expect(e.state).toBe('BELOW MINIMUM FLOW')
    // the loop caused it, is still in AUTO, and nothing backed off to hide it
    expect(fic().MODE).toBe(1)
    expect(pump().SPD).toBeCloseTo(fic().OP!, 9)
    expect(Math.abs(settledAt() - 12)).toBeLessThan(NOISE_BAND)
  })

  it('and nothing trips, throttles or recirculates', () => {
    start(reg({ 'duty.minFlow': '20 m³/h' }))
    lineUp(12); advance(600)
    expect(sim().pumpEnvelopes['P-1']!.state).toBe('BELOW MINIMUM FLOW')
    expect(pump().RUN).toBe(1)
    expect(pump().FAULT ?? 0).toBe(0)
    expect(sim().tags['HV-9']!.OP).toBe(100)
  })

  it('and with NO minimum stated the controller manufactures no constraint', () => {
    lineUp(12); advance(500)
    expect(sim().defs['P-1']!.minFlowM3h).toBeUndefined()
    expect(sim().pumpEnvelopes['P-1']!.state).toBe('LIMIT UNKNOWN')
    expect(Math.abs(settledAt() - 12)).toBeLessThan(NOISE_BAND)
  })
})

// ── N, O. Modes ─────────────────────────────────────────────────────────────

describe('N, O — MANUAL and AUTO, on the same architecture K14 uses', () => {
  it('O: AUTO → MANUAL holds the output exactly', () => {
    lineUp(25); advance(400)
    const held = fic().OP!
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().tickOnce(1)
    expect(fic().OP).toBe(held)
    expect(pump().SPD).toBe(held)
  })

  it('N: MANUAL → AUTO resumes from the speed the plant is at', () => {
    lineUp(25); advance(200)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 40); advance(60)
    expect(pump().SPD).toBe(40)
    const from = pump().SPD!
    sim().writeTag('FIC-1', 'MODE', 1)
    sim().tickOnce(1)
    expect(Math.abs(pump().SPD! - from)).toBeLessThan(10)
    advance(500)
    expect(Math.abs(settledAt() - 25)).toBeLessThan(NOISE_BAND)
  })

  it('exactly ONE writer of SPD, in either mode', () => {
    lineUp(25); advance(200)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 40); advance(10)
    sim().writeTag('P-1', 'SPD', 95)        // an operator reaching past the loop
    sim().tickOnce(1)
    expect(pump().SPD).toBe(40)
  })
})

// ── P. Two loops on one drive ───────────────────────────────────────────────

describe('P — two controllers on one machine is a configuration, not a race', () => {
  it('NEITHER is wired: there is no defensible winner', () => {
    const m = buildSimModel(contended, reg())
    expect(m.controllers.find((c) => c.tag === 'FIC-1')!.outTag).toBeUndefined()
    expect(m.controllers.find((c) => c.tag === 'PIC-1')!.outTag).toBeUndefined()
    // both still track their own measurements
    expect(m.controllers.find((c) => c.tag === 'FIC-1')!.pvTag).toBe('FT-1')
    expect(m.controllers.find((c) => c.tag === 'PIC-1')!.pvTag).toBe('PT-1')
  })

  it('and the machine is left alone rather than fought over', () => {
    start(reg(), contended)
    lineUp(); advance(200)
    // nothing is commanding it, so it sits where K12 puts a running drive
    expect(pump().SPD).toBe(100)
    expect(pump().RAMP).toBeCloseTo(1, 6)
  })

  it('P: it is reported, naming both loops and the machine', () => {
    const out = pumpSpeedContended.run(buildIndex(docOf(reg(), contended)))
    expect(out).toHaveLength(1)
    expect(out[0]!.entityKey).toBe('P-1')
    expect(out[0]!.message).toContain('FIC-1')
    expect(out[0]!.message).toContain('PIC-1')
    expect(out[0]!.message).toContain('neither is connected')
    // one loop alone says nothing
    expect(pumpSpeedContended.run(buildIndex(docOf(reg())))).toEqual([])
  })
})

// ── S, T. Determinism and legacy ────────────────────────────────────────────

describe('S, T — the same run twice, and everything older unchanged', () => {
  it('S: SP, PV, OP, SPD, RAMP, head, flow and envelope all repeat', () => {
    const run = () => {
      start()
      lineUp(20)
      const trace: string[] = []
      for (let i = 0; i < 30; i++) {
        advance(10)
        if (i === 12) sim().writeTag('FIC-1', 'SP', 32)
        const e = sim().pumpEnvelopes['P-1']!
        trace.push([fic().SP, fic().PV, fic().OP, fic().I, fic().SAT,
          pump().SPD, pump().RAMP, e.riseBar, e.flowM3h]
          .map((v) => (v ?? 0).toFixed(9)).join('|') + '|' + e.state)
      }
      return trace
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
    expect(new Set(a).size, 'and it actually moved').toBeGreaterThan(25)
  })

  it('S: and the engineering record is untouched by all of it', () => {
    const r = reg()
    const before = JSON.stringify(r)
    start(r)
    lineUp(25); advance(300)
    sim().writeTag('FIC-1', 'SP', 32); advance(200)
    expect(JSON.stringify(r)).toBe(before)
  })

  it('§17: both speeds are trended beside the loop\'s own signals', () => {
    lineUp(20); advance(60)
    sim().writeTag('FIC-1', 'SP', 32); advance(60)
    const series = (ref: string) => sim().history.getSeries(ref, 0, 1e12, 500)
    for (const ref of ['FIC-1.SP', 'FIC-1.OP', 'FIC-1.PV', 'P-1.SPD', 'P-1.RAMP']) {
      expect(series(ref).t.length, ref).toBeGreaterThan(5)
    }
    // the command did not replace the shaft
    expect([...series('P-1.RAMP').v]).not.toEqual([...series('P-1.SPD').v])
  })

  it('T: a fixed-speed machine runs exactly as it always did', () => {
    start(fixedSpeed)
    lineUp(); advance(60)
    expect(pump().SPD).toBeUndefined()
    expect(pump().RAMP).toBeCloseTo(1, 6)
  })

  it('T: and a flow loop WITH a valve in its family still drives the valve', () => {
    const withValve: HmiScreen = {
      ...plant,
      widgets: widgets((w) => (w.id === 'hv' ? { ...w, tag: 'FV-1' } : w)),
    }
    const m = buildSimModel(withValve, reg())
    const c = m.controllers.find((x) => x.tag === 'FIC-1')!
    expect(c.outTag).toBe('FV-1')
    expect(c.outKind).toBe('valve')
    expect(c.outMin).toBeUndefined()
  })
})

// ── The limit of one fixed gain, pinned rather than hidden ──────────────────

describe('a fixed gain is a property of an operating point', () => {
  it('pushed near the machine\'s shutoff head, the loop hunts — and says nothing else', () => {
    lineUp(25); advance(400)
    expect(Math.abs(settledAt() - 25)).toBeLessThan(NOISE_BAND)

    /**
     * BL-D at 2.5 barg leaves a 1.5 bar adverse head. The machine makes
     * 6.18·r² bar of shutoff head, so below about half speed it delivers
     * nothing at all and just above it the flow rises almost vertically. The
     * process gain there is several times what this loop was tuned for, the
     * loop gain goes above one, and the result is a LIMIT CYCLE.
     *
     * Pinned here deliberately. It is not a defect in the loop, the solver or
     * the drive — it is what a single fixed gain means on a centrifugal
     * machine, and the honest thing is to record where it stops working rather
     * than to tune this fixture until the boundary never moves.
     */
    sim().applyScenario({ id: 's', name: 'BL-D hard', overrides: [
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '2.5 barg' }] })
    advance(400)
    const xs: number[] = []
    for (let i = 0; i < 120; i++) { advance(1); xs.push(ft()) }
    const spread = Math.max(...xs) - Math.min(...xs)
    expect(spread, 'it is hunting, not holding').toBeGreaterThan(5)

    // BOUNDED, though: it oscillates between real operating points and never
    // diverges, and every number stays finite and physical
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThan(60)
    expect(fic().OP!).toBeLessThanOrEqual(100)
    expect(Math.abs(fic().I!)).toBeLessThanOrEqual(100)
    expect(sim().hydraulic.converged).toBe(true)
  })
})
