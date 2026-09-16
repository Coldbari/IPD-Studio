// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K12 — THE SHAFT FRACTION BECOMES COMMANDABLE.
 *
 * K11 found that the affinity laws were already in the pump curve and the
 * solver already took a shaft fraction — but the runtime DERIVED that fraction
 * from `RUN` alone, so nothing could ask for part speed. This closes that,
 * and the change is one line of intent: the shaft chases a TARGET, and the
 * target is now the speed command instead of always being 1.
 *
 * Four things hold it together:
 *
 *  1. THE CURVE IS UNTOUCHED. `H = H₀·r²·(1 − (Q/1.5·Qr·r)²)` is the same
 *     equation it has been since K2. K12 makes `r` controllable; it does not
 *     replace anything.
 *  2. A DRIVE IS DECLARED, NEVER ASSUMED. A machine whose record says nothing
 *     is fixed-speed and behaves exactly as it always has — and a speed command
 *     on one does NOT quietly switch variable speed on. It is refused by name.
 *  3. THE SOLVER READS THE SHAFT, NOT THE COMMAND. Ask for 30 % and the plant
 *     goes on running at 74 % for as long as the drive takes to get there.
 *  4. A TRIP STILL WINS. There is no speed a machine can be asked for that
 *     keeps a tripped shaft turning.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { resolveEquipment, validateScenario } from '../../src/hmi/sim/scenario'
import type { Scenario } from '../../src/hmi/sim/scenario'
import { SHUT_LEAK_MAX } from '../../src/hmi/sim/hydraulic/solver'
import { processFor } from '../../src/model/processData'
import { pumpSpeedConfig } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

/** source → P-1 → FV-1 → TK-1, with PT and FT on the machine's own lines. */
const plant: HmiScreen = {
  id: 'k12', name: 'K12', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 600, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 40 } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2' } },
    { id: 'ft', type: 'display', x: 900, y: 90, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a3' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 118 }, { x: 196, y: 118 }], bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 596, y: 150 }], aId: 'fv', aPort: 'out', bId: 't', bPort: 'bottom' },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
/** A fixed-speed machine — a record that says nothing about a drive. */
const fixed: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment', fields: duty },
  'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
}
/** ...and the same machine on a drive, with a stated turndown. */
const vsd = (extra: Record<string, string> = {}): Registry => ({
  ...fixed,
  'P-1': { key: 'P-1', kind: 'equipment',
    fields: { ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %', ...extra } },
})

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (reg: Registry) => { sim().exitRun(); sim().enterRun(plant, reg) }
const lineUp = () => { sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) }
const scenario = (overrides: Scenario['overrides']): Scenario => ({ id: 's', name: 's', overrides })
const docOf = (reg: Registry): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [plant], registry: reg })

beforeEach(() => { start(vsd()) })

// ── A, B. Declared, never assumed ───────────────────────────────────────────

describe('A, B — a drive is a capability a record declares', () => {
  it('A: a machine that says nothing is FIXED SPEED, and has no speed signal', () => {
    start(fixed)
    expect(sim().defs['P-1']!.vsd).toBeUndefined()
    expect(sim().tags['P-1']!.SPD).toBeUndefined()
    lineUp(); advance(30)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)   // rated speed, as always
  })

  it('B: a machine that declares one gets a speed command, defaulted to rated', () => {
    expect(sim().defs['P-1']!.vsd).toBe(true)
    expect(sim().defs['P-1']!.minSpeedPct).toBe(20)
    expect(sim().tags['P-1']!.SPD).toBe(100)
  })

  it('the record is read, not guessed: yes/no both mean something, blank means neither', () => {
    expect(processFor(vsd(), 'P-1').vsd).toBe(true)
    expect(processFor({ 'P-1': { key: 'P-1', kind: 'equipment', fields: { ...duty, 'duty.vsd': 'no' } } }, 'P-1').vsd).toBe(false)
    expect(processFor(fixed, 'P-1').vsd).toBeUndefined()
  })
})

// ── C, D, E, H, I. Speed drives the plant ───────────────────────────────────

describe('C-E, H, I — speed changes the plant through the existing curve', () => {
  const settle = (spd: number) => {
    sim().writeTag('P-1', 'SPD', spd)
    advance(40)
    return {
      shaft: sim().tags['P-1']!.RAMP!,
      head: sim().pipePressures.a2! - sim().pipePressures.a1!,
      flow: Math.abs(sim().pipeFlows.a3!),
      pressure: sim().pipePressures.a2!,
    }
  }

  it('C-E: 100 / 60 / 30 / 20 give four different solutions, monotonically', () => {
    lineUp(); advance(30)
    const full = settle(100)
    const sixty = settle(60)
    const thirty = settle(30)
    const floor = settle(20)
    expect(full.shaft).toBeCloseTo(1, 6)
    expect(sixty.shaft).toBeCloseTo(0.6, 6)
    expect(thirty.shaft).toBeCloseTo(0.3, 6)
    expect(floor.shaft).toBeCloseTo(0.2, 6)     // E: the configured minimum
    // H, I: the hydraulics follow, through head
    for (const [a, b] of [[full, sixty], [sixty, thirty], [thirty, floor]]) {
      expect(b!.head).toBeLessThan(a!.head)
      expect(b!.flow).toBeLessThan(a!.flow)
      expect(b!.pressure).toBeLessThan(a!.pressure)
    }
  })

  it('the head falls as the SQUARE of speed, which is the curve doing it', () => {
    lineUp(); advance(30)
    const full = settle(100)
    const half = settle(50)
    // affinity: H ∝ r². At a different flow the match is not exact, but it is
    // far closer to a quarter than to a half — this is not a linear derating.
    const ratio = half.head / full.head
    expect(ratio).toBeLessThan(0.45)
    expect(ratio).toBeGreaterThan(0.1)
  })

  it('E: a command below the stated turndown is HELD at it, not obeyed', () => {
    lineUp(); advance(30)
    sim().writeTag('P-1', 'SPD', 5)
    advance(40)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.2, 6)
    // the COMMAND is still what was asked — the clamp is the machine's, and
    // the two are not conflated
    expect(sim().tags['P-1']!.SPD).toBe(5)
  })

  it('with no turndown stated, no limit is invented', () => {
    start(vsd({ 'duty.minSpeed': '' }))
    expect(sim().defs['P-1']!.minSpeedPct).toBeUndefined()
    lineUp(); advance(30)
    sim().writeTag('P-1', 'SPD', 5)
    advance(40)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.05, 6)
  })
})

// ── F, G. Command is not actual ─────────────────────────────────────────────

describe('F, G — the solver reads the SHAFT, and the shaft takes time', () => {
  it('F: command and actual differ throughout the ramp', () => {
    lineUp(); advance(30)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
    sim().writeTag('P-1', 'SPD', 30)
    sim().tickOnce(1)                 // RAMP_S = 2 s, so one second is half way
    const shaft = sim().tags['P-1']!.RAMP!
    expect(sim().tags['P-1']!.SPD).toBe(30)
    expect(shaft).toBeGreaterThan(0.3)      // NOT there yet
    expect(shaft).toBeLessThan(1)
    // and the plant is running at the SHAFT, not at the command
    const st = resolveEquipment(sim().tags, [], null, 'P-1', 'pump')!
    expect(st.speedCommand).toBe(30)
    expect(st.actual).toBeCloseTo(shaft, 9)
    advance(10)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.3, 6)
  })

  it('G: the head at that instant is the CURVE’s answer for the shaft it has', () => {
    lineUp(); advance(30)
    const fullHead = sim().pipePressures.a2! - sim().pipePressures.a1!
    sim().writeTag('P-1', 'SPD', 30)
    sim().tickOnce(1)
    const midHead = sim().pipePressures.a2! - sim().pipePressures.a1!
    advance(20)
    const endHead = sim().pipePressures.a2! - sim().pipePressures.a1!
    // strictly between: the drive is on its way and so is the plant
    expect(midHead).toBeLessThan(fullHead)
    expect(midHead).toBeGreaterThan(endHead)
  })
})

// ── J, K. Measurements ──────────────────────────────────────────────────────

describe('J, K — the instruments read the solve, at every speed', () => {
  it('FT and PT track their own quantities across the whole range', () => {
    lineUp(); advance(30)
    const ft = sim().defs['FT-1']!
    const pt = sim().defs['PT-1']!
    for (const spd of [100, 70, 40, 20]) {
      sim().writeTag('P-1', 'SPD', spd)
      advance(40)
      expect(Math.abs(sim().tags['FT-1']!.PV! - Math.abs(sim().pipeFlows.a3!)))
        .toBeLessThan((ft.max - ft.min) * 0.008)
      expect(Math.abs(sim().tags['PT-1']!.PV! - sim().pipePressures.a2!))
        .toBeLessThan((pt.max - pt.min) * 0.008)
    }
  })

  it('a speed command never appears as a measurement', () => {
    lineUp(); advance(30)
    sim().writeTag('P-1', 'SPD', 63)
    advance(40)
    expect(sim().tags['FT-1']!.PV!).not.toBeCloseTo(63, 0)
    expect(sim().tags['PT-1']!.PV!).not.toBeCloseTo(63, 0)
  })
})

// ── L, M, N. The existing state machine stays authoritative ─────────────────

describe('L-N — STOP, RUN and FAULT are unchanged and still win', () => {
  it('L, M: STOP coasts to rest whatever the speed command says, and RUN resumes to it', () => {
    lineUp()
    sim().writeTag('P-1', 'SPD', 60)
    advance(40)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.6, 6)

    sim().writeTag('P-1', 'RUN', 0)
    advance(30)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0, 6)
    expect(sim().tags['P-1']!.SPD).toBe(60)   // the command is remembered

    sim().writeTag('P-1', 'RUN', 1)
    advance(40)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.6, 6)  // back to what was asked
  })

  it('N: a FAULT holds the shaft at zero, whatever speed is commanded', () => {
    lineUp()
    sim().writeTag('P-1', 'SPD', 80)
    advance(40)
    sim().writeTag('P-1', 'FAULT', 1)
    sim().writeTag('P-1', 'SPD', 100)
    sim().writeTag('P-1', 'RUN', 1)
    advance(30)
    expect(sim().tags['P-1']!.RAMP).toBe(0)
    expect(Math.abs(sim().pipeFlows.a2!)).toBeLessThan(SHUT_LEAK_MAX)
    expect(resolveEquipment(sim().tags, [], null, 'P-1', 'pump')!.source).toBe('tripped')
  })
})

// ── O, P. Invalid commands ──────────────────────────────────────────────────

describe('O, P — an unusable command is refused, never coerced', () => {
  it('O: NaN and Infinity leave the machine at rated rather than at zero', () => {
    lineUp(); advance(30)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      sim().writeTag('P-1', 'SPD', bad)
      advance(20)
      expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
      expect(Number.isFinite(sim().tags['P-1']!.RAMP!)).toBe(true)
      for (const v of Object.values(sim().pipeFlows)) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('P: a scenario asking a FIXED-SPEED machine for a speed is refused by name', () => {
    start(fixed)
    const m = buildSimModel(plant, fixed)
    const s = scenario([{ kind: 'signal', tag: 'P-1', signal: 'SPD', value: 60 }])
    const problems = validateScenario(m.hydraulic, s, m.defs)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.tag).toBe('P-1')
    expect(problems[0]!.reason).toMatch(/no variable speed drive/i)
    // ...and it does NOT quietly switch the behaviour on
    sim().applyScenario(s)
    lineUp(); advance(40)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
  })

  it('P: a command outside the stated range is reported, and held at the end', () => {
    const m = buildSimModel(plant, vsd())
    for (const v of [5, 140]) {
      const problems = validateScenario(m.hydraulic,
        scenario([{ kind: 'signal', tag: 'P-1', signal: 'SPD', value: v }]), m.defs)
      expect(problems, String(v)).toHaveLength(1)
      expect(problems[0]!.reason).toMatch(/outside its 20-100 % range/i)
    }
    // an in-range one says nothing
    expect(validateScenario(m.hydraulic,
      scenario([{ kind: 'signal', tag: 'P-1', signal: 'SPD', value: 60 }]), m.defs)).toEqual([])
  })

  it('a record that configures a drive it has not declared is a finding', () => {
    const half: Registry = { ...fixed,
      'P-1': { key: 'P-1', kind: 'equipment', fields: { ...duty, 'duty.minSpeed': '20 %' } } }
    const out = pumpSpeedConfig.run(buildIndex(docOf(half)))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toMatch(/does not declare a variable speed drive/i)
    // a properly declared one says nothing, and so does a plain machine
    expect(pumpSpeedConfig.run(buildIndex(docOf(vsd())))).toEqual([])
    expect(pumpSpeedConfig.run(buildIndex(docOf(fixed)))).toEqual([])
  })

  it('an unreadable or out-of-range turndown is a finding too', () => {
    for (const bad of ['low', '-10 %', '140 %']) {
      const reg: Registry = { ...fixed,
        'P-1': { key: 'P-1', kind: 'equipment', fields: { ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': bad } } }
      expect(pumpSpeedConfig.run(buildIndex(docOf(reg))), bad).toHaveLength(1)
    }
  })
})

// ── Q, R, S. Scenario, determinism, legacy ──────────────────────────────────

describe('Q-S — through the existing scenario path, reproducibly', () => {
  it('Q: a scenario commands speed through the SAME path an operator uses', () => {
    lineUp(); advance(30)
    const full = Math.abs(sim().pipeFlows.a3!)
    const s = scenario([{ kind: 'signal', tag: 'P-1', signal: 'SPD', value: 50 }])
    sim().applyScenario(s)
    advance(40)
    expect(sim().tags['P-1']!.SPD).toBe(50)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.5, 6)
    expect(Math.abs(sim().pipeFlows.a3!)).toBeLessThan(full)
    expect(resolveEquipment(sim().tags, [], s, 'P-1', 'pump')!.source).toBe('scenario')
    // the journal carries it like any other command
    expect(sim().journal.some((j) => j.tag === 'P-1' && 'sig' in j && j.sig === 'SPD')).toBe(true)
  })

  it('Q: and the ENGINEERING RECORD is untouched by any of it', () => {
    const before = JSON.stringify(vsd())
    sim().applyScenario(scenario([{ kind: 'signal', tag: 'P-1', signal: 'SPD', value: 40 }]))
    lineUp(); advance(120)
    expect(JSON.stringify(vsd())).toBe(before)
  })

  it('R: the same speed sequence twice gives the same run', () => {
    const once = () => {
      start(vsd())
      lineUp(); advance(30)
      for (const spd of [100, 60, 30, 60, 100]) {
        sim().writeTag('P-1', 'SPD', spd)
        advance(30)
      }
      return JSON.stringify({ f: sim().pipeFlows, p: sim().pipePressures, t: sim().tags })
    }
    expect(once()).toBe(once())
  })

  it('S: a legacy drawing with no drive data behaves exactly as before', () => {
    const run = (reg: Registry) => {
      start(reg); lineUp(); advance(120)
      return JSON.stringify(sim().pipeFlows)
    }
    const plain = run(fixed)
    // a drive declared on a DIFFERENT machine changes nothing here
    const elsewhere: Registry = { ...fixed,
      'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³', 'duty.vsd': 'Yes' } } }
    expect(run(elsewhere)).toBe(plain)
  })

  it('the 100 → 60 → 30 → 60 → 100 transition moves the plant each time', () => {
    start(vsd())
    lineUp(); advance(30)
    const seen: number[] = []
    for (const spd of [100, 60, 30, 60, 100]) {
      sim().writeTag('P-1', 'SPD', spd)
      advance(40)
      seen.push(Math.abs(sim().pipeFlows.a3!))
    }
    expect(seen[1]!).toBeLessThan(seen[0]!)
    expect(seen[2]!).toBeLessThan(seen[1]!)
    expect(seen[3]!).toBeGreaterThan(seen[2]!)
    expect(seen[4]!).toBeGreaterThan(seen[3]!)
    /**
     * And it comes back to where it started — NOTHING LATCHED — to within a
     * fraction of a per cent. Not exactly, and the residual is real: the vessel
     * has been filling for three minutes, so its bottom nozzle pushes back
     * slightly harder on the way up than it did on the way down. A drive that
     * returned to EXACTLY the old number would mean the plant had forgotten
     * what it had been doing.
     */
    expect(Math.abs(seen[4]! - seen[0]!) / seen[0]!).toBeLessThan(0.002)
    expect(Math.abs(seen[3]! - seen[1]!) / seen[1]!).toBeLessThan(0.002)
  })
})
