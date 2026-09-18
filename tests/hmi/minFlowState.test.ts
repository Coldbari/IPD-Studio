// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K19 — MINIMUM-FLOW PROTECTION STATE AND ALARM SEMANTICS.
 *
 * K18 shipped the override and five words to describe it. This is the phase
 * that makes the WORDS correct, and it changes no physics: the same solver,
 * the same curve, the same `max(requested, minFlow)`, the same signed flow.
 *
 * ── THE THREE THINGS §4 REFUSES TO LET COLLAPSE ───────────────────────────
 *
 *   A. PROTECTION DEMAND       is the requested setpoint below the minimum?
 *   B. PROTECTION ACHIEVEMENT  is the machine passing the minimum?
 *   C. PUMP ENVELOPE           where is K13 saying the machine is being run?
 *
 * They are three different questions with three different answers and this
 * file exists largely to pin that they never become one. `overriding` answers
 * A and reads nothing but the setpoint and the record. `state` answers B. K13's
 * `EnvelopeState` answers C and is not replaced, not wrapped and not re-derived.
 *
 * ── WHAT K19 ACTUALLY CHANGED ─────────────────────────────────────────────
 *
 * ONE STATE, and it is a subtraction from UNABLE rather than an addition to
 * the vocabulary: `STANDING_BY`, for a demand that is not reaching the plant.
 * K18 reported UNABLE — in the warning colour — for a machine that was simply
 * switched off, which §12 forbids and which K16 had already decided the other
 * way round for authority. Measured before the change, on the lifecycle walk
 * below: six of thirteen points were a machine at rest being reported as a
 * protection that had failed.
 *
 * ONE FIELD, `inForce`, which publishes a branch the engine already had. In
 * MANUAL this runtime does not use the setpoint at all, so the override has no
 * path — K18 implemented exactly that and then published `overriding: true`
 * next to it, telling an operator in hand control that their setpoint was
 * being held up while their own output drove the machine.
 *
 * ── AND WHAT IT DELIBERATELY DID NOT ──────────────────────────────────────
 *
 * NO HYSTERESIS, NO ON-DELAY, NO FILTER, NO DEADBAND. The chatter K18 reported
 * is reproduced here rather than suppressed, and the tests at the bottom pin
 * WHICH of the four candidate signals crosses and which do not. The repository
 * does contain an ISA-18.2 deadband and on-delay — `TagDef.deadband` and
 * `TagDef.alarmDelay` — and they are NOT applicable, for reasons written down
 * beside the test that checks they were not reached for.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import {
  MIN_FLOW_LABEL, MIN_FLOW_SEVERITY, minFlowFindings, minFlowProtection,
} from '../../src/hmi/sim/minflow'
import type { MinFlowState } from '../../src/hmi/sim/minflow'
import { envelopeFindings, pumpEdgeMap, pumpEnvelopes } from '../../src/hmi/sim/envelope'
import { loopFindings } from '../../src/hmi/sim/authority'
import { buildSimModel } from '../../src/hmi/sim/engine'
import type { SolveResult } from '../../src/hmi/sim/hydraulic/solver'
import type { Scenario } from '../../src/hmi/sim/scenario'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The fixture: K15's plant, which is what the chatter was measured on ─────

const plant: HmiScreen = {
  id: 'k19', name: 'K19', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const reg = (opts: { minFlow?: string } = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %',
    ...(opts.minFlow !== undefined ? { 'duty.minFlow': opts.minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
})

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg({ minFlow: '20 m³/h' })) => {
  sim().exitRun(); sim().enterRun(plant, r)
}
const fic = () => sim().tags['FIC-1']!
const pump = () => sim().tags['P-1']!
const prot = () => sim().minFlow['FIC-1']
const env = () => sim().pumpEnvelopes['P-1']!
const loop = () => sim().loops['FIC-1']!
const lineUp = (sp?: number) => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag('FIC-1', 'SP', sp)
}
const holdAt = (barg: number) => sim().applyScenario({
  id: 's', name: `BL-D at ${barg} barg`,
  overrides: [{ kind: 'terminal-pressure', tag: 'BL-D', pressure: `${barg} barg` }],
} satisfies Scenario)

/** Every runtime finding an operator would see, as `severity:id` strings. */
const findings = (): string[] => [
  ...minFlowFindings(sim().minFlow),
  ...envelopeFindings(sim().pumpEnvelopes,
    new Map(Object.values(sim().minFlow).map((p) => [p.pump, p.tag]))),
  ...loopFindings(sim().loops),
].map((f) => `${f.severity}:${f.id}`)

/** How many times a sampled signal changed value across a window. */
const crossings = (xs: readonly string[]): number =>
  xs.reduce((n, v, i) => n + (i > 0 && v !== xs[i - 1] ? 1 : 0), 0)

beforeEach(() => { start() })

// ── A-E, Z, AA. The five K18 states, defined exactly ────────────────────────

describe('A-E, Z, AA — each state, and the exact condition that produces it', () => {
  it('Z, AA: a record with NO minimum gets NOT_CONFIGURED and nothing invented', () => {
    start(reg())
    lineUp(12); advance(200)
    // there is no protection published at all, and the word for that is the word
    expect(prot()).toBeUndefined()
    expect(sim().defs['P-1']!.minFlowM3h).toBeUndefined()
    // AA: NOT zero, and not a fraction of the rated flow either
    expect(env().state).toBe('LIMIT UNKNOWN')
    expect(env().minFlowM3h).toBeUndefined()
  })

  it('B: INACTIVE — a limit exists and the setpoint already respects it', () => {
    lineUp(35); advance(200)
    expect(prot()!.limitM3h).toBe(20)
    expect(prot()!.overriding).toBe(false)
    expect(prot()!.state).toBe('INACTIVE')
    expect(MIN_FLOW_SEVERITY.INACTIVE).toBeUndefined()
  })

  it('C, D: ACTIVE — demand in force, and the SOLVE cannot say what came of it', () => {
    const m = buildSimModel(plant, reg({ minFlow: '20 m³/h' }))
    const broken: SolveResult = {
      pressure: {}, flow: {}, pipeFlow: {}, converged: false, iterations: 1,
      residual: 0, cavitating: [], undetermined: [],
    }
    const envs = pumpEnvelopes(m.hydraulic, m.defs, { 'P-1': { RUN: 1, RAMP: 1 } },
      broken, pumpEdgeMap(m.hydraulic))
    const p = minFlowProtection({
      'FIC-1': { tag: 'FIC-1', saturated: 0, authority: 'available',
        minFlow: { pump: 'P-1', limitM3h: 20, requestedSp: 12, effectiveSp: 20,
          overriding: true, inForce: true } },
    }, envs)
    expect(envs['P-1']!.state).toBe('UNKNOWN')
    expect(p['FIC-1']!.state).toBe('ACTIVE')
    // P: a solve nobody can trust NEVER claims achievement
    expect(p['FIC-1']!.state).not.toBe('EFFECTIVE')
  })

  it('D: EFFECTIVE — demand in force, plant able, and the machine IS passing it', () => {
    start(reg({ minFlow: '5 m³/h' }))
    lineUp(2); advance(400)
    expect(prot()!.overriding).toBe(true)
    expect(prot()!.state).toBe('EFFECTIVE')
    expect(env().flowM3h!).toBeGreaterThanOrEqual(5)
  })

  it('E: UNABLE — demand in force, plant ABLE to answer, and it did not', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    expect(loop().authority).toBe('available')   // the plant COULD have answered
    expect(prot()!.state).toBe('UNABLE')
    expect(MIN_FLOW_SEVERITY.UNABLE).toBe('warning')
  })
})

// ── F, G, H. The setpoint against the limit ─────────────────────────────────

describe('F, G, H — the demand axis, which reads no measurement at all', () => {
  it('F: a setpoint EXACTLY equal to the minimum is not an override', () => {
    lineUp(20); advance(5)
    expect(prot()!.requestedSp).toBe(20)
    expect(prot()!.effectiveSp).toBe(20)
    expect(prot()!.overriding).toBe(false)
    expect(prot()!.state).toBe('INACTIVE')
  })

  it('G: a setpoint just BELOW the minimum is, and is raised exactly to it', () => {
    lineUp(19.9); advance(5)
    expect(prot()!.overriding).toBe(true)
    expect(prot()!.effectiveSp).toBe(20)
    expect(fic().SP).toBe(19.9)      // and the operator's entry survives
  })

  it('H: a setpoint ABOVE the minimum is left completely alone', () => {
    lineUp(45); advance(5)
    expect(prot()!.effectiveSp).toBe(45)
    expect(prot()!.overriding).toBe(false)
  })

  it('the demand is decided WITHOUT the measurement — same SP, wrecked plant', () => {
    lineUp(12); advance(200)
    const before = { req: prot()!.requestedSp, eff: prot()!.effectiveSp, ov: prot()!.overriding }
    holdAt(10)            // shut the plant in; the flow collapses
    advance(60)
    expect(env().flowM3h!).toBeLessThan(20)
    // the COMMAND side did not move a millimetre
    expect({ req: prot()!.requestedSp, eff: prot()!.effectiveSp, ov: prot()!.overriding })
      .toEqual(before)
  })
})

// ── I, J, K, L, M. The achievement axis, against the SIGNED flow ────────────

describe('I-M, AB — the achievement axis, and the sign a magnitude would destroy', () => {
  it('K: flow above the minimum is EFFECTIVE', () => {
    start(reg({ minFlow: '5 m³/h' }))
    lineUp(2); advance(400)
    expect(env().flowM3h!).toBeGreaterThan(5)
    expect(prot()!.state).toBe('EFFECTIVE')
  })

  it('J: flow below it, on a machine that could have made it, is UNABLE', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    expect(env().flowM3h!).toBeLessThan(55)
    expect(prot()!.state).toBe('UNABLE')
  })

  it('I: the comparison is >=, so flow EXACTLY at the minimum is achievement', () => {
    const at = (flow: number, limit: number): MinFlowState => {
      const m = buildSimModel(plant, reg({ minFlow: `${limit} m³/h` }))
      const edge = pumpEdgeMap(m.hydraulic).get('P-1')!
      const solve: SolveResult = {
        pressure: { }, flow: { [edge]: flow }, pipeFlow: {}, converged: true,
        iterations: 1, residual: 0, cavitating: [], undetermined: [],
      }
      const e = pumpEnvelopes(m.hydraulic, m.defs, { 'P-1': { RUN: 1, RAMP: 1 } },
        solve, pumpEdgeMap(m.hydraulic))
      return minFlowProtection({
        'FIC-1': { tag: 'FIC-1', saturated: 0, authority: 'available',
          minFlow: { pump: 'P-1', limitM3h: limit, requestedSp: 12, effectiveSp: limit,
            overriding: true, inForce: true } },
      }, e)['FIC-1']!.state
    }
    expect(at(20, 20)).toBe('EFFECTIVE')       // the boundary belongs to success
    expect(at(19.999, 20)).toBe('UNABLE')
    expect(at(20.001, 20)).toBe('EFFECTIVE')
  })

  it('L, AB: REVERSE FLOW cannot satisfy a positive minimum — no Math.abs', () => {
    lineUp(12); advance(200)
    holdAt(10); advance(60)
    expect(env().state).toBe('REVERSE FLOW')
    expect(prot()!.actualM3h!).toBeLessThan(0)
    // the magnitude WOULD have satisfied it; the signed number does not
    expect(Math.abs(prot()!.actualM3h!)).toBeGreaterThan(20)
    expect(prot()!.state).toBe('UNABLE')
    expect(prot()!.state).not.toBe('EFFECTIVE')
  })

  it('M: DEAD-HEAD claims nothing, and nothing trips or recirculates', () => {
    lineUp(12); advance(200)
    sim().writeTag('HV-9', 'OP', 0); advance(60)
    expect(env().state).toBe('DEAD-HEAD')
    expect(prot()!.state).toBe('UNABLE')
    expect(prot()!.state).not.toBe('EFFECTIVE')
    expect(pump().RUN).toBe(1)                 // §10: no automatic trip
    expect(sim().tags['HV-9']!.OP).toBe(0)     // §10: no invented recirculation
  })
})

// ── N, O, Q. Authority: the machine that cannot answer ──────────────────────

describe('N, O, Q — a machine that is switched off has not FAILED a protection', () => {
  /**
   * §12, and the defect K19 exists for. A stopped pump read UNABLE in the
   * WARNING colour from the first tick of the simulation. K16 had already
   * decided the principle the other way — de-energised is INFORMATION — and
   * this brings the protection into line with it.
   */
  it('N: a STOPPED machine is STANDING_BY, and that is not a finding', () => {
    // a limit the turndown floors the plant above, so the BEFORE state is
    // steady rather than a coin flip on the boundary — see Q
    start(reg({ minFlow: '5 m³/h' }))
    lineUp(2); advance(200)
    expect(prot()!.state).toBe('EFFECTIVE')
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(loop().authority).toBe('de-energised')
    expect(prot()!.state).toBe('STANDING_BY')
    expect(prot()!.state).not.toBe('EFFECTIVE')     // §11: never claims success
    expect(MIN_FLOW_SEVERITY.STANDING_BY).toBeUndefined()
    // and the WARNING an operator would otherwise have been shown is gone
    expect(findings()).not.toContain('warning:min-flow:FIC-1:min-flow-unable')
  })

  it('O: a FAULTED machine is the same answer, and the trip is not touched', () => {
    lineUp(12); advance(200)
    sim().writeTag('P-1', 'FAULT', 1); advance(30)
    expect(prot()!.state).toBe('STANDING_BY')
    expect(pump().FAULT).toBe(1)          // §11: no reset
    expect(fic().MODE).toBe(1)            // §11: no mode change
  })

  /**
   * A LIMIT THE TURNDOWN FLOORS THE PLANT ABOVE, deliberately. A loop
   * controlling TO its minimum sits exactly ON it, and its achievement verdict
   * is then a coin flip from sample to sample — that is the chatter, measured
   * in its own section below. Asserting EFFECTIVE at a single tick there would
   * be asserting the toss. At 5 m³/h the drive reaches its 20 % turndown
   * first, the flow rests comfortably above the limit, and the verdict holds
   * still long enough to be a test of RECOVERY rather than of noise.
   */
  it('Q: authority RESTORED recovers on the ordinary tick — no reset, no bump', () => {
    start(reg({ minFlow: '5 m³/h' }))
    lineUp(2); advance(300)
    expect(prot()!.state).toBe('EFFECTIVE')
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(prot()!.state).toBe('STANDING_BY')
    const held = { OP: fic().OP, I: fic().I, MODE: fic().MODE }
    // the integrator was HELD while there was no authority — K16, untouched
    advance(30)
    expect({ OP: fic().OP, I: fic().I, MODE: fic().MODE }).toEqual(held)
    sim().writeTag('P-1', 'RUN', 1); advance(300)
    expect(loop().authority).toBe('available')
    expect(prot()!.state).toBe('EFFECTIVE')
    expect(fic().MODE).toBe(1)            // §11: mode never changed
  })

  it('the demand itself is UNAFFECTED by losing authority — §3 is preserved', () => {
    lineUp(12); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    // EFFECTIVE SP IS STILL THE MINIMUM. The protection has asked and the
    // plant cannot answer; it has not stopped asking.
    expect(prot()!.effectiveSp).toBe(20)
    expect(prot()!.requestedSp).toBe(12)
    expect(prot()!.overriding).toBe(true)
    // ...and the flow is NOT clamped to make the protection look successful
    expect(prot()!.actualM3h).toBe(0)
  })
})

// ── MANUAL: a demand with no path ───────────────────────────────────────────

describe('MANUAL — the protection acts on a setpoint this runtime does not use', () => {
  /**
   * K18's engine already skipped the algorithm in MANUAL and then published
   * `overriding: true` beside it. The faceplate therefore told an operator in
   * hand control that the protection was holding their setpoint at 20 while
   * their own output drove the machine. Nothing about the ENGINE changes here;
   * `inForce` reports the branch it already took.
   */
  it('the demand is published, and reported as NOT IN FORCE', () => {
    lineUp(12); advance(200)
    expect(prot()!.inForce).toBe(true)
    sim().writeTag('FIC-1', 'MODE', 0); advance(5)
    expect(prot()!.inForce).toBe(false)
    expect(prot()!.state).toBe('STANDING_BY')
    // ...and the numbers the operator needs are all still on the plate
    expect(prot()!.limitM3h).toBe(20)
    expect(prot()!.requestedSp).toBe(12)
    expect(prot()!.overriding).toBe(true)   // it WOULD override, in AUTO
  })

  it('a hand output above the minimum is still not the protection working', () => {
    lineUp(12); advance(200)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 60); advance(60)
    expect(env().flowM3h!).toBeGreaterThan(20)   // the machine IS passing it
    expect(pump().SPD).toBe(60)                  // ...because the OPERATOR did
    expect(prot()!.state).not.toBe('EFFECTIVE')
    expect(prot()!.state).toBe('STANDING_BY')
  })

  it('and MANUAL with a setpoint that respects the limit is plain INACTIVE', () => {
    lineUp(35); advance(100)
    sim().writeTag('FIC-1', 'MODE', 0); advance(5)
    // nothing would have been overridden anyway, so nothing is "standing by"
    expect(prot()!.overriding).toBe(false)
    expect(prot()!.state).toBe('INACTIVE')
  })

  it('the return to AUTO is still bumpless against the EFFECTIVE setpoint', () => {
    lineUp(12); advance(300)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 45); advance(30)
    const before = pump().SPD!
    sim().writeTag('FIC-1', 'MODE', 1); advance(1)
    expect(Math.abs(pump().SPD! - before)).toBeLessThan(5)
    expect(prot()!.inForce).toBe(true)
  })
})

// ── R, S, T, U. The whole lifecycle, in one causal sequence ─────────────────

describe('R, S, T, U — startup, shutdown, coast-down and restart', () => {
  it('walks the lifecycle and never reports a failure for a machine at rest', () => {
    const seen: { label: string; state: MinFlowState; envState: string; warned: boolean }[] = []
    const mark = (label: string) => seen.push({
      label, state: prot()!.state, envState: env().state,
      warned: findings().some((f) => f.startsWith('warning:min-flow')),
    })

    // R: simulation start, pump stopped, a minimum declared, SP below it.
    // The limit is one the drive's turndown floors the plant ABOVE, so the
    // achievement verdict is steady — see Q for why that matters here.
    start(reg({ minFlow: '5 m³/h' }))
    sim().writeTag('FIC-1', 'SP', 2); advance(1)
    mark('start, stopped')
    lineUp(2); advance(1); mark('starting')
    advance(500); mark('settled')
    // S, T: shutdown and coast-down
    sim().writeTag('P-1', 'RUN', 0); advance(1); mark('coasting')
    advance(40); mark('stopped')
    // U: restart
    sim().writeTag('P-1', 'RUN', 1); advance(400); mark('restarted')

    const byLabel = Object.fromEntries(seen.map((s) => [s.label, s]))
    // A MACHINE AT REST IS NEVER A PROTECTION FAILURE — §12, four times over
    expect(byLabel['start, stopped']!.state).toBe('STANDING_BY')
    expect(byLabel['coasting']!.state).toBe('STANDING_BY')
    expect(byLabel['stopped']!.state).toBe('STANDING_BY')
    for (const label of ['start, stopped', 'coasting', 'stopped']) {
      expect(byLabel[label]!.warned).toBe(false)
    }
    // ...and the running plant is reported on its merits
    expect(byLabel['settled']!.state).toBe('EFFECTIVE')
    expect(byLabel['restarted']!.state).toBe('EFFECTIVE')
    // K13 keeps its own vocabulary throughout, and it is not this one
    expect(byLabel['stopped']!.envState).toBe('STOPPED')
    expect(byLabel['settled']!.envState).toBe('NORMAL')
  })

  it('a stopped pump produces K16\'s INFO and no protection row of its own', () => {
    lineUp(12); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    const f = findings()
    expect(f).toContain('info:authority:FIC-1:de-energised')
    // §14: one gap, one row. The protection does not say it a second time.
    expect(f.filter((x) => x.includes('min-flow'))).toEqual([])
  })
})

// ── V. K13 and K18 stay distinct ────────────────────────────────────────────

describe('V — the envelope and the protection are two answers, not one', () => {
  it('the §4 case: demand ACTIVE, achievement EFFECTIVE, envelope NORMAL', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500)
    // all three questions, all three answered, and none of them "just normal"
    expect(prot()!.overriding).toBe(true)          // A. the demand exists
    expect(prot()!.requestedSp).toBe(12)
    expect(prot()!.effectiveSp).toBe(20)
    expect(env().flowM3h!).toBeGreaterThan(19)     // B. and it is being met
    expect(env().state).toBe('NORMAL')             // C. K13's own verdict
    expect(prot()!.state).not.toBe('INACTIVE')
  })

  it('K18 UNABLE beside K13 BELOW MINIMUM FLOW — the same instant, two subjects', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    expect(prot()!.state).toBe('UNABLE')
    expect(env().state).toBe('BELOW MINIMUM FLOW')
  })

  it('K18 STANDING_BY beside K13 STOPPED', () => {
    lineUp(12); advance(200)
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(prot()!.state).toBe('STANDING_BY')
    expect(env().state).toBe('STOPPED')
  })

  it('K13 still answers for a machine with NO protecting loop at all', () => {
    // the whole reason K13's row cannot be gated on a loop's SAT the way
    // K18's is: there may be no loop
    const m = buildSimModel(plant, reg({ minFlow: '55 m³/h' }))
    const edge = pumpEdgeMap(m.hydraulic).get('P-1')!
    const solve: SolveResult = {
      pressure: {}, flow: { [edge]: 10 }, pipeFlow: {}, converged: true,
      iterations: 1, residual: 0, cavitating: [], undetermined: [],
    }
    const e = pumpEnvelopes(m.hydraulic, m.defs, { 'P-1': { RUN: 1, RAMP: 1 } },
      solve, pumpEdgeMap(m.hydraulic))
    expect(e['P-1']!.state).toBe('BELOW MINIMUM FLOW')
    // no protection map at all, and the machine is still described
    expect(envelopeFindings(e).map((f) => f.id))
      .toContain('envelope:P-1:pump-below-min-flow')
  })
})

// ── W, X, Y. The findings themselves ────────────────────────────────────────

describe('W, X, Y — what reaches the Diagnostics page, and what must not', () => {
  it('X: a healthy EFFECTIVE protection produces NO warning or error at all', () => {
    start(reg({ minFlow: '5 m³/h' }))
    lineUp(2); advance(400)
    expect(prot()!.state).toBe('EFFECTIVE')
    const bad = findings().filter((f) => f.startsWith('warning:') || f.startsWith('error:'))
    expect(bad).toEqual([])
  })

  it('X: INACTIVE and STANDING_BY produce nothing either', () => {
    lineUp(35); advance(200)
    expect(prot()!.state).toBe('INACTIVE')
    expect(findings().filter((f) => f.includes('min-flow'))).toEqual([])
    /**
     * ...and stopping the machine with that same setpoint does NOT become
     * STANDING_BY: there was never a demand to stand by, because 35 already
     * respects the 20 the record asks for. `!overriding` is tested before
     * anything about the plant for exactly this reason.
     */
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(prot()!.state).toBe('INACTIVE')
    // a setpoint BELOW the limit on that same stopped machine is the other answer
    sim().writeTag('FIC-1', 'SP', 12); advance(5)
    expect(prot()!.state).toBe('STANDING_BY')
    expect(findings().filter((f) => f.includes('min-flow'))).toEqual([])
  })

  it('Y: a RUNTIME failure is never reported as a CONFIGURATION error', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    expect(prot()!.state).toBe('UNABLE')
    const f = findings()
    expect(f).toContain('warning:min-flow:FIC-1:min-flow-unable')
    // the RECORD is not what is wrong, so nothing says the limit is misconfigured
    expect(f.some((x) => x.includes('not-configured'))).toBe(false)
    expect(f.some((x) => x.includes('min-flow-unknown'))).toBe(false)
  })

  it('W: no duplicate findings — every id appears exactly once', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    const ids = findings()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('§13: the two rows for one condition are plainly DIFFERENT statements', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    const all = [
      ...minFlowFindings(sim().minFlow),
      ...envelopeFindings(sim().pumpEnvelopes,
        new Map(Object.values(sim().minFlow).map((p) => [p.pump, p.tag]))),
    ]
    const machine = all.find((f) => f.id.endsWith('pump-below-min-flow'))!
    const loopRow = all.find((f) => f.id.endsWith('min-flow-unable'))!
    // different SUBJECTS: one is the machine, one is the loop
    expect(machine.tag).toBe('P-1')
    expect(loopRow.tag).toBe('FIC-1')
    // the machine's row describes an OPERATING POINT and names where to go next
    expect(machine.message).toContain('Source: engineering record')
    expect(machine.message).toContain('FIC-1 carries this machine\'s minimum-flow protection')
    // the loop's row describes a DEMAND that was refused
    expect(loopRow.message).toContain('is asking for')
    expect(loopRow.message).toContain('the LOOP\'s report')
  })
})

// ── AH, AI, AJ, AK. The chatter, reproduced rather than suppressed ──────────

describe('AH, AI, AJ — the K18 boundary crossing, and exactly what crosses', () => {
  /**
   * K18 REPORTED: mean 19.998, range 19.66-20.38, 140 state crossings in 200 s.
   * K19 REPRODUCES IT — measured on this fixture at 154 crossings in 200 s,
   * mean 19.99, range 19.57-20.46 — and then separates the four signals K18's
   * report treated as one sentence.
   *
   * A loop CONTROLLING EXACTLY ON its minimum sits on it, which means half the
   * samples are a hair under. That is what a plant at its limit does, and §8
   * forbids filtering it away.
   */
  const measure = (ticks = 200) => {
    const s = { state: [] as string[], envState: [] as string[], overriding: [] as string[],
      effSp: [] as string[], sat: [] as string[], minFlowRows: [] as string[],
      envRows: [] as string[] }
    const flows: number[] = []
    for (let i = 0; i < ticks; i++) {
      advance(1)
      s.state.push(prot()!.state)
      s.envState.push(env().state)
      s.overriding.push(String(prot()!.overriding))
      s.effSp.push(String(prot()!.effectiveSp))
      s.sat.push(String(loop().saturated))
      s.minFlowRows.push(minFlowFindings(sim().minFlow).map((f) => f.id).join('|'))
      s.envRows.push(envelopeFindings(sim().pumpEnvelopes).map((f) => f.id).join('|'))
      flows.push(env().flowM3h!)
    }
    return { ...s, flows }
  }

  it('AH: the boundary IS crossed, many times, and the flow straddles the limit', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500)
    const m = measure()
    const mean = m.flows.reduce((a, b) => a + b, 0) / m.flows.length
    expect(Math.abs(mean - 20)).toBeLessThan(0.5)     // it is sitting ON the limit
    expect(Math.min(...m.flows)).toBeLessThan(20)     // ...from below
    expect(Math.max(...m.flows)).toBeGreaterThan(20)  // ...and from above
    expect(crossings(m.state)).toBeGreaterThan(50)    // K18 measured 140; this run ~154
  })

  it('AI: the OVERRIDE ITSELF does not chatter — the thing that moves the machine', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500)
    const m = measure()
    /**
     * PROOF, not assertion. `max` of two continuous quantities is continuous,
     * and the override reads NO measurement — only the setpoint and the record
     * — so there is nothing noisy in its inputs at all.
     */
    expect(crossings(m.overriding)).toBe(0)
    expect(new Set(m.overriding)).toEqual(new Set(['true']))
    expect(crossings(m.effSp)).toBe(0)
    expect(new Set(m.effSp)).toEqual(new Set(['20']))
    // and the drive is never commanded by a flipping boolean
    expect(crossings(m.sat)).toBe(0)
  })

  it('AJ: what chatters is the ACHIEVEMENT verdict and K13\'s envelope, in lockstep', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500)
    const m = measure()
    // THE STATE: EFFECTIVE <-> UNABLE, and nothing else
    expect(new Set(m.state)).toEqual(new Set(['EFFECTIVE', 'UNABLE']))
    // K13's envelope crosses in EXACT lockstep — same signed flow, same limit
    expect(new Set(m.envState)).toEqual(new Set(['NORMAL', 'BELOW MINIMUM FLOW']))
    expect(crossings(m.envState)).toBe(crossings(m.state))
    // ...so this is a property K18 made REACHABLE, not one it introduced
  })

  it('AJ: K18\'s own diagnostic row does NOT chatter — it is gated on SAT', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500)
    const m = measure()
    // a loop oscillating ON setpoint is not saturated; one that has run out of
    // machine is. K14's published saturation, reused rather than thresholded.
    expect(crossings(m.minFlowRows)).toBe(0)
    expect(new Set(m.minFlowRows)).toEqual(new Set(['']))
  })

  it('AJ: K13\'s row DOES chatter, and cannot be gated the same way', () => {
    start(reg({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500)
    const m = measure()
    /**
     * THE ONE OPERATOR-VISIBLE ROW THAT FLAPS. `pump-below-min-flow` follows
     * the envelope exactly, because K13 is DETECTION and an instantaneous
     * detector on a signal that straddles its threshold flaps by construction.
     *
     * It cannot borrow K18's gate: `SAT` belongs to a LOOP and this row
     * belongs to a MACHINE, which may have no loop on it at all — the test in
     * §V above pins that. Suppressing it needs a deadband or an on-delay, and
     * the test below says why neither was invented here.
     */
    expect(crossings(m.envRows)).toBeGreaterThan(50)
    expect(new Set(m.envRows)).toEqual(new Set(['envelope:P-1:pump-below-min-flow', '']))
  })
})

// ── AK, AL. The engineering basis that does not exist ───────────────────────

describe('AK, AL — no hysteresis, no on-delay, and no invented constant', () => {
  /**
   * §7 AND §23. The repository DOES contain an ISA-18.2 hysteresis and an
   * on-delay: `TagDef.deadband` and `TagDef.alarmDelay`, per measurement tag,
   * used by `evalAlarms` for the LL/L/H/HH limits. They were found, considered,
   * and are NOT APPLICABLE here, for three reasons:
   *
   *   1. THEY BELONG TO A DIFFERENT LIMIT. They are the hysteresis on a TAG's
   *      own configured alarm thresholds. `duty.minFlow` is not one of those:
   *      it is a field on the MACHINE's equipment record.
   *   2. THEY BELONG TO A DIFFERENT SIGNAL. The comparison here is against the
   *      SIGNED pump-edge flow from the solve. The FT beside it reads a
   *      magnitude, and §9 is the whole reason the protection is not judged on
   *      it.
   *   3. THEIR FALLBACK IS A CODE DEFAULT. Absent a stated value, `deadband`
   *      becomes 1 % of span and `alarmDelay` becomes 0. Reaching for a number
   *      nobody chose for this purpose is the invention §7 forbids, dressed up
   *      as reuse.
   *
   * No `duty.minFlowDeadband`, `duty.minFlowDelay` or minimum-flow alarm
   * setting exists on the equipment record. So the instantaneous, physically
   * meaningful state is preserved and the gap is reported instead.
   */
  it('the equipment record states a minimum and NOTHING about how to debounce it', () => {
    const d = buildSimModel(plant, reg({ minFlow: '20 m³/h' })).defs
      .find((x) => x.name === 'P-1')!
    expect(d.minFlowM3h).toBe(20)
    /**
     * ...AND NOTHING ELSE. No width, no delay, no persistence and no alarm
     * setting for this limit exists anywhere on the equipment record. The cast
     * is through `unknown` because TypeScript already knows these fields do
     * not exist on `TagDef` — which is itself half the point — and this pins
     * that nothing is arriving at runtime that the type does not describe.
     */
    const raw = d as unknown as Record<string, unknown>
    for (const k of ['minFlowDeadband', 'minFlowDelay', 'minFlowHysteresis',
      'minFlowOnDelay', 'minFlowAlarm', 'minFlowPriority']) {
      expect(raw[k]).toBeUndefined()
    }
  })

  it('and the tag\'s ISA-18.2 knobs were not quietly borrowed for it', () => {
    /**
     * THE EXPERIMENT. A 6 m³/h deadband and a 10 s on-delay, written onto the
     * flow tag and the controller — both far wider than the ±0.5 m³/h of noise
     * the loop is riding. If the protection had reached for either, the
     * crossing would collapse. It does not move at all, because `stateOf`
     * reads the signed solve flow and `duty.minFlow` and nothing else.
     *
     * The knobs are not being criticised. They do their own job — hysteresis
     * on THIS TAG's configured LL/L/H/HH thresholds — and that job is not this
     * one.
     */
    const knobbed: HmiScreen = {
      ...plant,
      widgets: plant.widgets.map((w) => (w.id === 'ft' || w.id === 'fic'
        ? { ...w, props: { ...w.props, deadband: 6, alarmDelay: 10 } } : w)),
    }
    sim().exitRun(); sim().enterRun(knobbed, reg({ minFlow: '20 m³/h' }))
    // the knobs really did land on the compiled tags
    expect(sim().defs['FT-1']!.deadband).toBe(6)
    expect(sim().defs['FT-1']!.alarmDelay).toBe(10)

    lineUp(12); advance(500)
    const states: string[] = []
    for (let i = 0; i < 200; i++) { advance(1); states.push(prot()!.state) }
    // UNCHANGED. No hidden filter, no borrowed width, no borrowed delay.
    expect(crossings(states)).toBeGreaterThan(50)
    expect(new Set(states)).toEqual(new Set(['EFFECTIVE', 'UNABLE']))
  })
})

// ── AC, AD, AE, AF, AG. Nothing else moved ──────────────────────────────────

describe('AC-AG — the measurement, the hydraulics and the clock are untouched', () => {
  it('AC: the PV is never modified to make the protection look successful', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    // §3's worked example: a demand of 55 the plant cannot meet
    expect(prot()!.effectiveSp).toBe(55)
    expect(prot()!.state).toBe('UNABLE')
    // the FT reads the plant, NOT the setpoint
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(55)
    // ...and the signed solve flow is the plant's too
    expect(env().flowM3h!).toBeLessThan(55)
  })

  it('AD: the actual flow is never clamped to the minimum', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    expect(prot()!.actualM3h!).toBeLessThan(55)
    expect(prot()!.actualM3h).toBe(env().flowM3h)   // K13's number, not a copy
  })

  it('AE: the controller gains are the ones K15 measured, with and without a limit', () => {
    const withLimit = buildSimModel(plant, reg({ minFlow: '20 m³/h' }))
      .controllers.find((c) => c.tag === 'FIC-1')!
    const without = buildSimModel(plant, reg())
      .controllers.find((c) => c.tag === 'FIC-1')!
    const gainsOf = (c: Record<string, unknown>) =>
      ({ kp: c.kp, ti: c.ti, outMin: c.outMin, outMax: c.outMax, action: c.action })
    expect(gainsOf(withLimit as never)).toEqual(gainsOf(without as never))
  })

  it('AF, AG: no second clock — the same input sequence gives the same output', () => {
    const run = () => {
      start(reg({ minFlow: '20 m³/h' }))
      lineUp(12)
      const trace: string[] = []
      for (let i = 0; i < 300; i++) {
        advance(1)
        trace.push([prot()!.state, prot()!.effectiveSp, env().flowM3h!.toFixed(6),
          fic().OP!.toFixed(6), loop().authority].join(','))
      }
      return trace
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
    // and it visited more than one state, so the equality means something
    expect(new Set(a.map((x) => x.split(',')[0])).size).toBeGreaterThan(1)
  })

  it('AG: determinism holds across the full lifecycle, not just the steady state', () => {
    const run = () => {
      start(reg({ minFlow: '20 m³/h' }))
      const trace: string[] = []
      const step = (n: number) => { for (let i = 0; i < n; i++) { advance(1); trace.push(prot()!.state) } }
      sim().writeTag('FIC-1', 'SP', 12); step(5)
      lineUp(12); step(100)
      sim().writeTag('FIC-1', 'MODE', 0); step(20)
      sim().writeTag('FIC-1', 'MODE', 1); step(50)
      sim().writeTag('P-1', 'RUN', 0); step(30)
      sim().writeTag('P-1', 'RUN', 1); step(100)
      return trace
    }
    expect(run()).toEqual(run())
  })
})

// ── The operator surface vocabulary ─────────────────────────────────────────

describe('§17 — every state has a word, and only UNABLE takes the alarm palette', () => {
  it('each state maps to a label and a severity, with no gaps', () => {
    const all: MinFlowState[] = [
      'NOT_CONFIGURED', 'INACTIVE', 'STANDING_BY', 'ACTIVE', 'EFFECTIVE', 'UNABLE',
    ]
    for (const s of all) {
      expect(MIN_FLOW_LABEL[s]).toBeTruthy()
      expect(MIN_FLOW_LABEL[s]).not.toContain('_')     // a plate is not an enum
    }
    // ONE state carries the warning tone. A protection that is working, one
    // with nothing to do, and one whose machine is off, are not faults.
    const warned = all.filter((s) => MIN_FLOW_SEVERITY[s] === 'warning')
    expect(warned).toEqual(['UNABLE'])
    expect(all.filter((s) => MIN_FLOW_SEVERITY[s] === 'error')).toEqual([])
  })
})
