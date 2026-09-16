// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K10 — A BOUNDARY THAT MOVES DURING A RUN.
 *
 * K7 gave a terminal a pressure from its record; K8 let a scenario hold it
 * somewhere else. Both are STILL for the length of a run. A utility header that
 * sags when the neighbouring unit starts up is neither.
 *
 * So a terminal may DECLARE, on its engineering record, that its pressure
 * moves — constant, step or ramp — and the declaration is evaluated against the
 * simulation's own clock. Three properties hold it together:
 *
 *  1. IT IS DETERMINISTIC. A signal is a pure function of its declaration and
 *     the time. No state, no clock of its own, no randomness — so the same run
 *     twice is the same run, which is the only thing that makes a moving
 *     boundary usable for training.
 *  2. IT IS CAUSAL. The boundary goes into the solve and everything else comes
 *     back out of it. Nothing writes a PT, an FT, a level or a pump flow to
 *     represent the change.
 *  3. IT IS OPT-IN. A terminal that declares nothing is static, and every
 *     drawing made before this one is untouched.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { evaluateSignal, resolveTerminal } from '../../src/hmi/sim/scenario'
import type { Scenario } from '../../src/hmi/sim/scenario'
import { boundarySignal, seconds } from '../../src/model/processData'
import type { BoundarySignal } from '../../src/model/processData'
import { terminalBadSignal } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

/** BL-S ─a1─ P-1 ─a2─ FV-1 ─a3─ TK-1 ─a4─ LV-1 ─a5─ BL-D, with PT and FT. */
const plant: HmiScreen = {
  id: 'k10', name: 'K10', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 600, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 40 } },
    { id: 'lv', type: 'valve', x: 820, y: 180, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 1000, y: 180, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 1200, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2' } },
    { id: 'ft', type: 'display', x: 1200, y: 90, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a3' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 596, y: 150 }], aId: 'fv', aPort: 'out', bId: 't', bPort: 'bottom' },
    { id: 'a4', points: [{ x: 648, y: 165 }, { x: 816, y: 196 }], aId: 't', aPort: 'bottom', bId: 'lv', bPort: 'in' },
    { id: 'a5', points: [{ x: 872, y: 196 }, { x: 1004, y: 192 }], aId: 'lv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** A record for one terminal. `extra` carries the signal declaration. */
const rec = (tag: string, barg: string, extra: Record<string, string> = {}) => ({
  [tag]: { key: tag, kind: 'equipment' as const,
    fields: { 'design.operatingPressure': barg, ...extra } },
})
const base: Registry = {
  ...rec('BL-S', '3 barg'), ...rec('BL-D', '1 barg'),
  'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
}
/** ...and the same plant where BL-S steps or ramps. */
const stepped: Registry = { ...base,
  ...rec('BL-S', '3 barg', {
    'design.boundarySignal': 'step',
    'design.boundarySignalTo': '1 barg',
    'design.boundarySignalAt': '120 s',
  }) }
const ramped: Registry = { ...base,
  ...rec('BL-S', '3 barg', {
    'design.boundarySignal': 'ramp',
    'design.boundarySignalTo': '1 barg',
    'design.boundarySignalAt': '60 s',
    'design.boundarySignalOver': '60 s',
  }) }

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const lineUp = () => {
  sim().writeTag('FV-1', 'OP', 100)
  sim().writeTag('LV-1', 'OP', 100)
  sim().writeTag('P-1', 'RUN', 1)
}
const start = (reg: Registry) => { sim().exitRun(); sim().enterRun(plant, reg) }
const scenario = (overrides: Scenario['overrides']): Scenario =>
  ({ id: 's', name: 's', overrides })
const docOf = (reg: Registry): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [plant], registry: reg })

beforeEach(() => { start(base) })

// ── A, B, C. Static stays static; a declaration opts in ─────────────────────

describe('A-C — a terminal moves only if its record says it does', () => {
  it('A: a terminal that declares nothing is STATIC, exactly as in K7-K9', () => {
    const m = buildProcessModel(plant, base)
    expect(m.nodes.find((n) => n.tag === 'BL-S')!.signal).toBeUndefined()
    expect(sim().terminals['BL-S']).toEqual({ source: 'engineering', barA: 4 })
    lineUp(); advance(300, 2)
    // five minutes later it has not moved an inch
    expect(sim().terminals['BL-S']).toEqual({ source: 'engineering', barA: 4 })
  })

  it('B: a declared terminal carries its signal on the topology, compiled once', () => {
    const m = buildProcessModel(plant, stepped)
    const sig = m.nodes.find((n) => n.tag === 'BL-S')!.signal as BoundarySignal
    expect(sig.kind).toBe('step')
    expect(sig.fromBarA).toBe(4)   // 3 barg
    expect(sig.toBarA).toBe(2)     // 1 barg
    expect(sig.atS).toBe(120)
  })

  it('C: CONSTANT is a declaration that it does not move', () => {
    const reg: Registry = { ...base,
      ...rec('BL-S', '3 barg', { 'design.boundarySignal': 'constant' }) }
    start(reg)
    expect(sim().terminals['BL-S']!.source).toBe('signal')
    expect(sim().terminals['BL-S']!.signal).toBe('constant')
    advance(600, 5)
    expect(sim().terminals['BL-S']!.barA).toBe(4)
  })

  it('the signal is a pure function of the declaration and the clock', () => {
    const step: BoundarySignal = { kind: 'step', fromBarA: 4, toBarA: 2, atS: 120, overS: 0 }
    expect(evaluateSignal(step, 0)).toBe(4)
    expect(evaluateSignal(step, 119.9)).toBe(4)
    expect(evaluateSignal(step, 120)).toBe(4)     // at, not yet past
    expect(evaluateSignal(step, 120.1)).toBe(2)
    expect(evaluateSignal(step, 1e6)).toBe(2)
    const ramp: BoundarySignal = { kind: 'ramp', fromBarA: 4, toBarA: 2, atS: 60, overS: 60 }
    expect(evaluateSignal(ramp, 60)).toBe(4)
    expect(evaluateSignal(ramp, 90)).toBeCloseTo(3, 9)
    expect(evaluateSignal(ramp, 120)).toBe(2)
    expect(evaluateSignal(ramp, 999)).toBe(2)
  })
})

// ── D, H, I, J. The STEP, and what it does to the plant ─────────────────────

describe('D, H-J — a step changes the plant, and the instruments follow', () => {
  it('before and after are different solutions, and the change is causal', () => {
    start(stepped)
    lineUp()
    advance(60)
    const before = {
      terminal: sim().terminals['BL-S']!.barA,
      suction: sim().pipePressures.a1!,
      flow: sim().pipeFlows.a3!,
      pt: sim().tags['PT-1']!.PV!,
      ft: sim().tags['FT-1']!.PV!,
    }
    expect(before.terminal).toBe(4)
    expect(sim().terminals['BL-S']!.source).toBe('signal')

    advance(120) // past t = 120 s
    expect(sim().terminals['BL-S']!.barA).toBe(2)

    // A != B, everywhere the plant is hydraulically coupled to that boundary
    expect(sim().pipePressures.a1!).toBeLessThan(before.suction)
    expect(sim().pipeFlows.a3!).toBeLessThan(before.flow)
    // I, J: the measurements FOLLOW the solve rather than being written
    expect(sim().tags['PT-1']!.PV!).toBeLessThan(before.pt)
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(before.ft)
    expect(sim().tags['PT-1']!.PV!).toBeCloseTo(sim().pipePressures.a2!, 1)
    expect(sim().tags['FT-1']!.PV!).toBeCloseTo(Math.abs(sim().pipeFlows.a3!), 0)
    // ...and the PT is nowhere near the boundary's own number
    expect(sim().tags['PT-1']!.PV!).not.toBeCloseTo(2, 1)
  })

  it('the vessel fills more slowly afterwards, because less is arriving', () => {
    start(stepped)
    lineUp(); advance(60)
    const v0 = sim().tags['TK-1']!.V!
    advance(30)
    const fast = sim().tags['TK-1']!.V! - v0
    advance(120)               // past the step
    const v1 = sim().tags['TK-1']!.V!
    advance(30)
    const slow = sim().tags['TK-1']!.V! - v1
    expect(slow).toBeLessThan(fast)
    expect(slow).toBeGreaterThan(0)
  })
})

// ── E, N. The RAMP ──────────────────────────────────────────────────────────

describe('E, N — a ramp evolves deterministically; the plant does what it does', () => {
  it('the BOUNDARY moves linearly, and is sampled on the engine’s own clock', () => {
    start(ramped)
    lineUp()
    advance(60)
    expect(sim().terminals['BL-S']!.barA).toBeCloseTo(4, 6)
    advance(30)  // t = 90, half way through a 60 s ramp
    expect(sim().terminals['BL-S']!.barA).toBeCloseTo(3, 6)
    advance(30)  // t = 120, arrived
    expect(sim().terminals['BL-S']!.barA).toBeCloseTo(2, 6)
    advance(60)  // and stays
    expect(sim().terminals['BL-S']!.barA).toBeCloseTo(2, 6)
  })

  it('the PLANT’s response is whatever the solver produces — not assumed linear', () => {
    start(ramped)
    lineUp(); advance(60)
    const q0 = sim().pipeFlows.a3!
    advance(30); const q1 = sim().pipeFlows.a3!
    advance(30); const q2 = sim().pipeFlows.a3!
    // it falls throughout, which is all that is claimed
    expect(q1).toBeLessThan(q0)
    expect(q2).toBeLessThan(q1)
    // and it is NOT a straight line, because the resistance law is not one
    const firstHalf = q0 - q1
    const secondHalf = q1 - q2
    expect(Math.abs(firstHalf - secondHalf)).toBeGreaterThan(1e-6)
  })

  it('N: a ramp over zero seconds is a step, not a division by nothing', () => {
    const instant: BoundarySignal = { kind: 'ramp', fromBarA: 4, toBarA: 2, atS: 10, overS: 0 }
    expect(evaluateSignal(instant, 9)).toBe(4)
    expect(evaluateSignal(instant, 10)).toBe(4)
    expect(evaluateSignal(instant, 11)).toBe(2)
    expect(Number.isFinite(evaluateSignal(instant, 10.000001))).toBe(true)
  })
})

// ── F, G. Precedence ────────────────────────────────────────────────────────

describe('F, G — all four precedence cases, and the record is never touched', () => {
  const m = () => buildProcessModel(plant, stepped)

  it('static + no scenario → engineering', () => {
    expect(resolveTerminal(buildProcessModel(plant, base), 'BL-S', null, 500).source).toBe('engineering')
  })
  it('static + scenario → scenario', () => {
    const r = resolveTerminal(buildProcessModel(plant, base), 'BL-S',
      scenario([{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '9 barg' }]), 500)
    expect(r.source).toBe('scenario')
    expect(r.barA).toBe(10)
  })
  it('runtime-variable + no scenario → signal', () => {
    const r = resolveTerminal(m(), 'BL-S', null, 500)
    expect(r.source).toBe('signal')
    expect(r.barA).toBe(2)
  })
  it('runtime-variable + scenario → SCENARIO WINS, and the signal is still shown', () => {
    // The brief's list puts the signal first and its sentence says the scenario
    // must win. The sentence is the instruction, and it is also the safer rule:
    // an operator who has pinned a boundary should not be overruled by a ramp
    // they cannot see. What they are overriding stays visible.
    const r = resolveTerminal(m(), 'BL-S',
      scenario([{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '9 barg' }]), 500)
    expect(r.source).toBe('scenario')
    expect(r.barA).toBe(10)
    expect(r.signal).toBe('step')
  })

  it('G: none of it writes to the engineering record', () => {
    const before = JSON.stringify(ramped)
    start(ramped)
    sim().applyScenario(scenario([{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '7 barg' }]))
    lineUp(); advance(300, 2)
    expect(JSON.stringify(ramped)).toBe(before)
    // and the topology still carries the record's own starting value
    expect(buildProcessModel(plant, ramped).nodes.find((n) => n.tag === 'BL-S')!.pressureBar).toBe(4)
  })
})

// ── K. Determinism ──────────────────────────────────────────────────────────

describe('K — the same run twice is the same run', () => {
  it('a ramping plant is bit-identical on a repeat', () => {
    const once = () => {
      start(ramped)
      lineUp()
      advance(240, 2)
      return JSON.stringify({
        f: sim().pipeFlows, p: sim().pipePressures, t: sim().tags, term: sim().terminals,
      })
    }
    expect(once()).toBe(once())
  })

  it('and a step lands at the same instant every time', () => {
    const at = () => {
      start(stepped)
      lineUp()
      let crossed = -1
      for (let i = 0; i < 200; i++) {
        sim().tickOnce(1)
        if (crossed < 0 && sim().terminals['BL-S']!.barA === 2) crossed = sim().t
      }
      return crossed
    }
    expect(at()).toBe(at())
    expect(at()).toBeGreaterThan(120)
    expect(at()).toBeLessThanOrEqual(122)
  })
})

// ── L, O. Several boundaries, and direction ─────────────────────────────────

describe('L, O — independent boundaries, and direction stays the solver’s', () => {
  it('L: two terminals move independently, with no global plant pressure', () => {
    const both: Registry = { ...base,
      ...rec('BL-S', '3 barg', {
        'design.boundarySignal': 'step', 'design.boundarySignalTo': '2 barg', 'design.boundarySignalAt': '60 s' }),
      ...rec('BL-D', '1 barg', {
        'design.boundarySignal': 'step', 'design.boundarySignalTo': '4 barg', 'design.boundarySignalAt': '120 s' }) }
    start(both)
    lineUp(); advance(30)
    expect(sim().terminals['BL-S']!.barA).toBe(4)
    expect(sim().terminals['BL-D']!.barA).toBe(2)

    advance(60)   // t ≈ 90: only BL-S has stepped
    expect(sim().terminals['BL-S']!.barA).toBe(3)
    expect(sim().terminals['BL-D']!.barA).toBe(2)

    advance(60)   // t ≈ 150: both have
    expect(sim().terminals['BL-S']!.barA).toBe(3)
    expect(sim().terminals['BL-D']!.barA).toBe(5)
  })

  it('O: a boundary rising above the plant REVERSES its line, on its own', () => {
    const rising: Registry = { ...base,
      ...rec('BL-D', '0 barg', {
        'design.boundarySignal': 'step', 'design.boundarySignalTo': '5 barg', 'design.boundarySignalAt': '90 s' }) }
    start(rising)
    lineUp(); advance(60)
    expect(sim().pipeFlows.a5!).toBeGreaterThan(0)   // draining
    advance(90)
    expect(sim().terminals['BL-D']!.barA).toBe(6)
    expect(sim().pipeFlows.a5!).toBeLessThan(0)      // and now feeding
  })

  it('no SOURCE or SINK was introduced anywhere', () => {
    const kinds = new Set(buildProcessModel(plant, stepped).nodes.map((n) => n.boundary))
    expect(kinds).not.toContain('source')
    expect(kinds).not.toContain('sink')
  })
})

// ── M. Malformed declarations ───────────────────────────────────────────────

describe('M — a declaration that cannot be used is reported, never guessed at', () => {
  const badly = (extra: Record<string, string>): Registry =>
    ({ ...base, ...rec('BL-S', '3 barg', extra) })
  const problems = (reg: Registry) => terminalBadSignal.run(buildIndex(docOf(reg)))

  it('every malformed shape is caught and named', () => {
    const cases: [string, Record<string, string>][] = [
      ['unknown kind', { 'design.boundarySignal': 'sawtooth' }],
      ['step with no target', { 'design.boundarySignal': 'step' }],
      ['step with a nonsense target', { 'design.boundarySignal': 'step', 'design.boundarySignalTo': 'lots' }],
      ['ramp with no duration', { 'design.boundarySignal': 'ramp', 'design.boundarySignalTo': '1 barg' }],
      ['negative duration', { 'design.boundarySignal': 'ramp', 'design.boundarySignalTo': '1 barg', 'design.boundarySignalOver': '-60 s' }],
      ['NaN target', { 'design.boundarySignal': 'step', 'design.boundarySignalTo': 'NaN' }],
      ['infinite target', { 'design.boundarySignal': 'step', 'design.boundarySignalTo': 'Infinity' }],
      ['bad unit', { 'design.boundarySignal': 'step', 'design.boundarySignalTo': '3 furlongs' }],
      ['bad time unit', { 'design.boundarySignal': 'step', 'design.boundarySignalTo': '1 barg', 'design.boundarySignalAt': 'soon' }],
    ]
    for (const [name, extra] of cases) {
      expect(typeof boundarySignal(badly(extra)['BL-S']!.fields), name).toBe('string')
      expect(problems(badly(extra)), name).toHaveLength(1)
    }
  })

  it('a runtime-variable terminal with NO operating pressure to start from', () => {
    const reg: Registry = { ...base,
      'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.boundarySignal': 'ramp' } } }
    expect(problems(reg)).toHaveLength(1)
    expect(problems(reg)[0]!.message).toMatch(/needs an Operating pressure/i)
  })

  it('the plant still solves, at the stated pressure, and NOTHING becomes NaN', () => {
    const reg = badly({ 'design.boundarySignal': 'step', 'design.boundarySignalTo': 'NaN' })
    start(reg)
    lineUp(); advance(200, 2)
    const r = sim().terminals['BL-S']!
    expect(r.source).toBe('invalid')
    expect(r.barA).toBe(4)                        // the record's value, not zero
    expect(Number.isFinite(r.barA)).toBe(true)
    for (const v of Object.values(sim().pipePressures)) expect(Number.isFinite(v)).toBe(true)
    for (const v of Object.values(sim().pipeFlows)) expect(Number.isFinite(v)).toBe(true)
    expect(sim().hydraulic.converged).toBe(true)
  })

  it('a scenario override still wins over a malformed declaration', () => {
    const reg = badly({ 'design.boundarySignal': 'sawtooth' })
    start(reg)
    sim().applyScenario(scenario([{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '6 barg' }]))
    expect(sim().terminals['BL-S']!.source).toBe('scenario')
    expect(sim().terminals['BL-S']!.barA).toBe(7)
    expect(sim().scenarioProblems).toEqual([])
  })

  it('a VALID declaration produces no finding', () => {
    expect(problems(stepped)).toEqual([])
    expect(problems(ramped)).toEqual([])
    expect(problems(base)).toEqual([])            // static: nothing declared
  })

  it('time is read with units, and a bare number is seconds', () => {
    expect(seconds('60 s')).toBe(60)
    expect(seconds('60')).toBe(60)
    expect(seconds('2 min')).toBe(120)
    expect(seconds('1 h')).toBe(3600)
    expect(seconds('soon')).toBeUndefined()
    expect(seconds(undefined)).toBeUndefined()
  })
})

// ── P. Legacy ───────────────────────────────────────────────────────────────

describe('P — drawings made before any of this are untouched', () => {
  it('a plant with no terminals at all has nothing to resolve', () => {
    const legacy: HmiScreen = {
      ...plant, id: 'legacy',
      widgets: plant.widgets.filter((w) => !w.tag?.startsWith('BL-')),
      pipes: plant.pipes.map((p) =>
        p.id === 'a1' ? { id: 'a1', points: p.points, bId: 'p', bPort: 'suction' }
        : p.id === 'a5' ? { id: 'a5', points: p.points, aId: 'lv', aPort: 'out' } : p),
    }
    sim().exitRun(); sim().enterRun(legacy, base)
    expect(sim().terminals).toEqual({})
    lineUp(); advance(120)
    expect(sim().hydraulic.converged).toBe(true)
  })

  it('a static-terminal plant solves identically to how it did before K10', () => {
    const run = (reg: Registry) => {
      start(reg); lineUp(); advance(200, 2)
      return JSON.stringify(sim().pipeFlows)
    }
    // the same drawing with and without the signal FIELDS present on a
    // DIFFERENT terminal must not move the static one
    const elsewhere: Registry = { ...base,
      ...rec('BL-D', '1 barg', { 'design.boundarySignal': 'constant' }) }
    expect(sim().terminals['BL-S']).toEqual({ source: 'engineering', barA: 4 })
    expect(run(elsewhere)).toBe(run(base))
  })
})
