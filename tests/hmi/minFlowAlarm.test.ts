// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K20 — MINIMUM-FLOW ALARM POLICY, AND THE LIFECYCLE IT ENTERS.
 *
 * K19 closed with the gap this phase exists for: minimum-flow protection lived
 * entirely on the instantaneous diagnostic path, while the product's ISA-18.2
 * alarm system — pending, active, acked, cleared, shelved, journalled — sat
 * beside it unused, because no engineering record could ask for a minimum-flow
 * alarm at all. Equipment records had no alarm section; only instrument
 * datasheets did.
 *
 * ── A LIMIT IS NOT AN ALARM ───────────────────────────────────────────────
 *
 * `duty.minFlow` is a manufacturer's figure about a machine. Whether a breach
 * of it calls an operator, how seriously, with what hysteresis and after how
 * long, is an operating-philosophy decision made by other people and routinely
 * absent. So they are separate records and separate objects, and a machine
 * with a limit and no policy gets NO ALARM — not a silent one, not a
 * medium-priority one, nothing.
 *
 * ── AND A PROTECTION IS NOT AN ALARM EITHER ───────────────────────────────
 *
 * K18 raises a setpoint; the alarm annunciates a breach. Neither implies the
 * other, and the two tests under §AA and §AB below are the ones that prove it:
 * protection ACTIVE and EFFECTIVE with the machine comfortably above its
 * minimum is NOT an alarm, and a machine short of its minimum with no override
 * running at all IS one.
 *
 * ── WHAT WAS NOT INVENTED ─────────────────────────────────────────────────
 *
 * No priority, no deadband width, no on-delay, no off-delay and no start-up
 * bypass timer. Each is a field an engineer may state and none has a default;
 * absent, the alarm runs at no priority at all (there is no alarm), or without
 * hysteresis, or immediately. The consequences — K19's ~154 crossings in 200 s,
 * and an annunciation during a normal pump start — are measured here rather
 * than papered over.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { alarmMessage, minFlowAlarms, priorityOf } from '../../src/hmi/sim/alarms'
import type { AlarmRecord } from '../../src/hmi/sim/alarms'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { pumpEdgeMap, pumpEnvelopes } from '../../src/hmi/sim/envelope'
import { processFor } from '../../src/model/processData'
import type { SolveResult } from '../../src/hmi/sim/hydraulic/solver'
import type { Scenario } from '../../src/hmi/sim/scenario'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The fixture: K15's plant, which every phase since has been measured on ──

const plant: HmiScreen = {
  id: 'k20', name: 'K20', theme: 'classic',
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

/** ...and the same plant with a pressure master above the flow loop — K17. */
const cascaded: HmiScreen = {
  ...plant,
  widgets: [
    ...plant.widgets,
    { id: 'pt', type: 'display', x: 900, y: 160, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 220, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }

/**
 * EVERY ALARM FIELD IS OMITTED UNLESS A TEST ASKS FOR IT. `alarm: undefined`
 * is not `alarm: 'medium'`, and most of this file depends on that.
 */
const reg = (opts: {
  minFlow?: string
  priority?: string
  deadband?: string
  delay?: string
  cascade?: boolean
} = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %',
    ...(opts.minFlow !== undefined ? { 'duty.minFlow': opts.minFlow } : {}),
    ...(opts.priority !== undefined ? { 'alarm.minFlowPriority': opts.priority } : {}),
    ...(opts.deadband !== undefined ? { 'alarm.minFlowDeadband': opts.deadband } : {}),
    ...(opts.delay !== undefined ? { 'alarm.minFlowDelay': opts.delay } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(opts.cascade
    ? { 'PIC-1': { key: 'PIC-1', kind: 'instrument' as const, fields: { 'signal.cascadeTo': 'FIC-1' } } }
    : {}),
})

/** The standard configured policy: a limit AND somebody's decision to alarm. */
const armed = (extra: Parameters<typeof reg>[0] = {}) =>
  reg({ minFlow: '20 m³/h', priority: 'high', ...extra })

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = armed(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const pump = () => sim().tags['P-1']!
const env = () => sim().pumpEnvelopes['P-1']!
const prot = () => sim().minFlow['FIC-1']
const lineUp = (sp?: number, tag = 'FIC-1') => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag(tag, 'SP', sp)
}
const holdAt = (barg: number) => sim().applyScenario({
  id: 's', name: `BL-D at ${barg} barg`,
  overrides: [{ kind: 'terminal-pressure', tag: 'BL-D', pressure: `${barg} barg` }],
} satisfies Scenario)

/** The minimum-flow alarm on P-1, whatever phase it is in. */
const minf = (): AlarmRecord | undefined => sim().alarms.find((a) => a.id === 'P-1:MINF')
/**
 * Acknowledge the START-UP annunciation, so a test about the SETTLED plant is
 * not reading the record a start legitimately left behind.
 *
 * This is not tidying up around an inconvenience — it IS the K20 behaviour, and
 * §K/§L pin it directly: with no on-delay stated, a pump start annunciates,
 * because the machine genuinely is below its minimum while the shaft
 * accelerates. A cleared alarm then stays listed until somebody acknowledges
 * it, exactly as every other alarm in this product does. An operator would
 * press ACK; so does this.
 */
const ackStartup = () => { if (minf() !== undefined) sim().ack('P-1:MINF') }
/** ...and its journal entries, oldest last the way the store keeps them. */
const minfEvents = () => sim().journal.filter(
  (e) => e.tag === 'P-1' && 'level' in e && e.level === 'MINF')

/**
 * The alarm judged directly, for the cases a running plant cannot be steered
 * into — an unconverged solve, an exact boundary value.
 */
const judge = (opts: {
  flow?: number
  limit?: number
  priority?: 'high' | 'medium' | 'low'
  deadband?: string
  delay?: string
  running?: boolean
  converged?: boolean
  prev?: AlarmRecord[]
  t?: number
}): AlarmRecord | undefined => {
  const r = reg({
    minFlow: `${opts.limit ?? 20} m³/h`,
    priority: opts.priority ?? 'high',
    ...(opts.deadband !== undefined ? { deadband: opts.deadband } : {}),
    ...(opts.delay !== undefined ? { delay: opts.delay } : {}),
  })
  const m = buildSimModel(plant, r)
  const edge = pumpEdgeMap(m.hydraulic).get('P-1')!
  const solve: SolveResult = opts.converged === false
    ? { pressure: {}, flow: {}, pipeFlow: {}, converged: false, iterations: 1,
        residual: 0, cavitating: [], undetermined: [] }
    : { pressure: {}, flow: { [edge]: opts.flow ?? 0 }, pipeFlow: {}, converged: true,
        iterations: 1, residual: 0, cavitating: [], undetermined: [] }
  const running = opts.running ?? true
  const envs = pumpEnvelopes(m.hydraulic, m.defs, { 'P-1': running ? { RUN: 1, RAMP: 1 } : {} },
    solve, pumpEdgeMap(m.hydraulic))
  return minFlowAlarms(m.defs, envs, opts.prev ?? [], opts.t ?? 0)
    .find((a) => a.id === 'P-1:MINF')
}

beforeEach(() => { start() })

// ── A, B, C, D. Configured, and not ─────────────────────────────────────────

describe('A, B, C, D — priority is the enable, and it is never invented', () => {
  it('A: a limit with NO alarm policy produces NO alarm at all', () => {
    start(reg({ minFlow: '55 m³/h' }))          // a minimum the plant cannot make
    lineUp(12); advance(300)
    expect(sim().defs['P-1']!.minFlowM3h).toBe(55)
    expect(env().state).toBe('BELOW MINIMUM FLOW')   // the CONDITION is real
    expect(sim().defs['P-1']!.minFlowAlarm).toBeUndefined()
    // ...and nothing annunciates it, because nobody asked for that
    expect(minf()).toBeUndefined()
    expect(minfEvents()).toEqual([])
  })

  it('B: a stated priority configures it, and it annunciates', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(300)
    expect(minf()).toMatchObject({ tag: 'P-1', level: 'MINF', phase: 'active' })
  })

  it('C: the configured priority is carried through exactly', () => {
    for (const p of ['high', 'medium', 'low'] as const) {
      start(reg({ minFlow: '55 m³/h', priority: p }))
      lineUp(12); advance(200)
      expect(sim().defs['P-1']!.minFlowAlarm!.priority).toBe(p)
      expect(minf()!.priority).toBe(p)
    }
  })

  it('D: a missing priority is NOT invented — not even as medium', () => {
    // the record states a deadband and a delay but never says how serious it is
    start(reg({ minFlow: '55 m³/h', deadband: '2 m³/h', delay: '5 s' }))
    lineUp(12); advance(200)
    // those two describe HOW an alarm behaves; there is no alarm to describe
    expect(sim().defs['P-1']!.minFlowAlarm).toBeUndefined()
    expect(minf()).toBeUndefined()
    // and the one function that COULD hand out a default refuses to
    expect(() => priorityOf('MINF')).toThrow(/comes from the record/)
  })

  it('an unrecognised priority is not a priority — it is not configured', () => {
    start(reg({ minFlow: '55 m³/h', priority: 'URGENT' }))
    lineUp(12); advance(100)
    expect(sim().defs['P-1']!.minFlowAlarm).toBeUndefined()
    expect(minf()).toBeUndefined()
  })
})

// ── E, F, G, H, I, J. The three refinements, and their absence ──────────────

describe('E-J — deadband, on-delay and off-delay: stated, absent, or absent', () => {
  it('E: a configured deadband is read, in the units the record states it in', () => {
    const p = processFor(reg({ minFlow: '20 m³/h', priority: 'high', deadband: '2 m³/h' }), 'P-1')
    expect(p.minFlowAlarm).toMatchObject({ priority: 'high', deadbandM3h: 2 })
    // ...and l/s converts, because `duty.minFlow` does
    const q = processFor(reg({ minFlow: '20 m³/h', priority: 'high', deadband: '1 l/s' }), 'P-1')
    expect(q.minFlowAlarm!.deadbandM3h).toBeCloseTo(3.6, 6)
  })

  it('E: and it widens the CLEAR threshold, never the trip threshold', () => {
    // trips at the limit exactly, as an undeadbanded alarm would
    expect(judge({ flow: 19.9, limit: 20, deadband: '3 m³/h' })!.phase).toBe('active')
    const standing = [judge({ flow: 19.9, limit: 20, deadband: '3 m³/h' })!]
    // ...and having tripped, does NOT clear at 21 — inside the 3 m³/h band
    expect(judge({ flow: 21, limit: 20, deadband: '3 m³/h', prev: standing, t: 1 })!.phase)
      .toBe('active')
    // ...but does at 23.1, above it
    expect(judge({ flow: 23.1, limit: 20, deadband: '3 m³/h', prev: standing, t: 1 })!.phase)
      .toBe('cleared')
  })

  it('F: a missing deadband is NOT invented — no span fraction, no anything', () => {
    const p = processFor(reg({ minFlow: '20 m³/h', priority: 'high' }), 'P-1')
    expect(p.minFlowAlarm).toEqual({ priority: 'high' })
    expect(p.minFlowAlarm!.deadbandM3h).toBeUndefined()
    // with none stated, the alarm clears the instant the flow comes back
    const standing = [judge({ flow: 19.9, limit: 20 })!]
    expect(judge({ flow: 20.01, limit: 20, prev: standing, t: 1 })!.phase).toBe('cleared')
  })

  it('G: a configured on-delay holds the alarm PENDING, unannunciated', () => {
    start(armed({ minFlow: '55 m³/h', delay: '10 s' }))
    expect(sim().defs['P-1']!.minFlowAlarm!.onDelayS).toBe(10)
    lineUp(12); advance(4)
    // the condition is true and the alarm is NOT yet an alarm
    expect(env().state).toBe('BELOW MINIMUM FLOW')
    expect(minf()!.phase).toBe('pending')
    expect(minfEvents()).toEqual([])          // §18: pending never journals
    advance(12)
    expect(minf()!.phase).toBe('active')
    expect(minfEvents().length).toBe(1)
  })

  it('G: a delay in minutes converts, because the record may state one', () => {
    const p = processFor(reg({ minFlow: '20 m³/h', priority: 'high', delay: '2 min' }), 'P-1')
    expect(p.minFlowAlarm!.onDelayS).toBe(120)
  })

  it('H: a missing on-delay is NOT invented — the alarm is immediate', () => {
    const p = processFor(reg({ minFlow: '20 m³/h', priority: 'high' }), 'P-1')
    expect(p.minFlowAlarm!.onDelayS).toBeUndefined()
    expect(judge({ flow: 5, limit: 20 })!.phase).toBe('active')
  })

  it('I, J: there is NO off-delay, stated or otherwise — see the K20 report', () => {
    /**
     * THE ARCHITECTURAL GAP, PINNED. This product's alarm lifecycle has an
     * on-delay (`pending`) and nothing on the other side: return-to-normal
     * goes straight to `cleared`. So there is no off-delay to configure, no
     * field for one, and nothing here invents either the mechanism or a value
     * for it. Adding one is a change to the alarm framework every alarm in the
     * product shares, which K20's scope excludes.
     */
    const p = processFor(
      reg({ minFlow: '20 m³/h', priority: 'high', delay: '5 s' }), 'P-1')
    expect(Object.keys(p.minFlowAlarm!).sort()).toEqual(['onDelayS', 'priority'])
    expect((p.minFlowAlarm as unknown as Record<string, unknown>).offDelayS).toBeUndefined()
    // and a cleared alarm clears on the tick the condition ends, with no dwell
    const standing = [judge({ flow: 5, limit: 20 })!]
    expect(judge({ flow: 25, limit: 20, prev: standing, t: 1 })!.phase).toBe('cleared')
  })

  it('a negative width or delay is not a value this model can act on', () => {
    const p = processFor(
      reg({ minFlow: '20 m³/h', priority: 'high', deadband: '-2 m³/h', delay: '-5 s' }), 'P-1')
    expect(p.minFlowAlarm).toEqual({ priority: 'high' })
  })
})

// ── K, L. Startup suppression ───────────────────────────────────────────────

describe('K, L — startup suppression is NOT CONFIGURED, and nothing was invented', () => {
  /**
   * K19 recorded that a normal pump start legitimately runs below minimum
   * while the shaft accelerates. Suppressing that needs a START-UP BYPASS
   * TIMER, which is a duration; no engineering record in this product states
   * one, so none exists and none was invented. The alarm annunciates during a
   * start, which is the physically true statement.
   *
   * The ON-DELAY is the mechanism that would cover it, and it is configurable
   * — which is why there is no second, hidden one beside it.
   */
  it('L: no start-up bypass field exists, and a start DOES annunciate', () => {
    start(armed({ minFlow: '20 m³/h' }))
    const raw = processFor(armed({ minFlow: '20 m³/h' }), 'P-1') as Record<string, unknown>
    for (const k of ['startupBypassS', 'startupInhibit', 'warmupS', 'permissive']) {
      expect(raw[k]).toBeUndefined()
    }
    lineUp(12)
    advance(1)
    // the shaft is ramping and the machine genuinely is not making 20 yet
    expect(env().flowM3h!).toBeLessThan(20)
    expect(minf()!.phase).toBe('active')
  })

  it('K: a configured ON-DELAY is what an engineer uses to cover a start', () => {
    // the same start, with a delay long enough to outlast the ramp
    start(armed({ minFlow: '20 m³/h', delay: '30 s' }))
    lineUp(12)
    advance(1)
    expect(minf()!.phase).toBe('pending')     // never annunciated
    advance(20)
    // by now the plant is above its minimum and the pending record is gone
    expect(env().flowM3h!).toBeGreaterThan(20)
    expect(minf()).toBeUndefined()
    expect(minfEvents()).toEqual([])          // §18: the start made NO events
  })
})

// ── M, N, O, P. The operating lifecycle ─────────────────────────────────────

describe('M, N, O, P — start, reach, violate, recover', () => {
  it('M, N: below minimum during a start, and clear once it is reached', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(1)
    expect(minf()!.phase).toBe('active')
    advance(300)
    // a loop controlling AT its minimum sits on it, so the alarm is either
    // standing or cleared — what matters is that the plant got there
    expect(env().flowM3h!).toBeGreaterThan(19)
  })

  it('O, P: a violation on a running plant, and its recovery', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(35); advance(300)
    ackStartup(); advance(30)
    expect(env().flowM3h!).toBeGreaterThan(20)
    expect(minf()).toBeUndefined()            // healthy: nothing standing
    holdAt(9); advance(60)                    // shut the plant in
    expect(env().flowM3h!).toBeLessThan(20)
    expect(minf()!.phase).toBe('active')
    holdAt(1); advance(200)                   // and line it back up
    expect(env().flowM3h!).toBeGreaterThan(20)
    expect(minf()!.phase).toBe('cleared')     // listed until acknowledged
  })
})

// ── Q, R, S, T. Not-in-alarm states ─────────────────────────────────────────

describe('Q, R, S, T — stopped, faulted, unsolved: none of them is an alarm', () => {
  it('Q: a STOPPED machine is not in minimum-flow alarm', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(300)
    sim().writeTag('P-1', 'RUN', 0); advance(40)
    expect(env().state).toBe('STOPPED')
    // K13 says STOPPED, K16 says de-energised (info), K19 says STANDING_BY.
    // A fourth surface calling it an alarm would undo all three.
    expect(prot()!.state).toBe('STANDING_BY')
    expect(minf()?.phase).not.toBe('active')
  })

  it('Q: and a machine that was never started raises nothing at all', () => {
    start(armed({ minFlow: '20 m³/h' }))
    sim().writeTag('FIC-1', 'SP', 12); advance(60)
    expect(env().state).toBe('STOPPED')
    expect(minf()).toBeUndefined()
    expect(minfEvents()).toEqual([])
  })

  it('R: a FAULTED machine is not in minimum-flow alarm either', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(300)
    sim().writeTag('P-1', 'FAULT', 1); advance(40)
    expect(env().state).toBe('STOPPED')
    expect(minf()?.phase).not.toBe('active')
    // ...and the TRIP alarm, which IS the right one, still annunciates
    expect(sim().alarms.find((a) => a.id === 'P-1:TRIP')?.phase).toBe('active')
  })

  it('S, T: an untrustworthy solve is NOT read as a low flow', () => {
    // §15: bad quality must never be interpreted as zero
    expect(judge({ converged: false, limit: 20 })).toBeUndefined()
    // and a standing alarm does not go on standing on a solve nobody can read
    const standing = [judge({ flow: 5, limit: 20 })!]
    expect(judge({ converged: false, limit: 20, prev: standing, t: 1 })!.phase).toBe('cleared')
  })

  it('T: an OUT-OF-SERVICE machine suppresses through the existing mechanism', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(200)
    expect(minf()!.phase).toBe('active')
    sim().toggleOos('P-1')
    expect(minf()!.sup).toBe('oos')
  })
})

// ── U, V, W, X, Y. The condition itself ─────────────────────────────────────

describe('U-Y, AP — the condition is signed, and covers every way of being short', () => {
  it('U, AP: REVERSE FLOW is in alarm, and no Math.abs hides it', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(200)
    holdAt(10); advance(60)
    expect(env().state).toBe('REVERSE FLOW')
    expect(env().flowM3h!).toBeLessThan(0)
    // the MAGNITUDE would have satisfied the limit; the signed number does not
    expect(Math.abs(env().flowM3h!)).toBeGreaterThan(20)
    expect(minf()!.phase).toBe('active')
    /**
     * The STANDING record keeps the value it tripped at, the way every alarm
     * in this product does — so the signed number is asserted on a freshly
     * judged one, where the trip value IS the reverse flow.
     */
    const fresh = judge({ flow: -25, limit: 20 })!
    expect(fresh.value).toBe(-25)
    expect(fresh.phase).toBe('active')
    expect(alarmMessage(fresh)).toContain('-25')
    expect(alarmMessage(fresh)).toContain('below minimum flow')
  })

  it('V: DEAD-HEAD is in alarm — the worst minimum-flow case there is', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(200)
    sim().writeTag('HV-9', 'OP', 0); advance(60)
    expect(env().state).toBe('DEAD-HEAD')
    expect(minf()!.phase).toBe('active')
    // ...and nothing trips or recirculates because of it
    expect(pump().RUN).toBe(1)
    expect(sim().tags['HV-9']!.OP).toBe(0)
  })

  it('W: flow EXACTLY at the minimum is not a violation — the test is >=', () => {
    expect(judge({ flow: 20, limit: 20 })).toBeUndefined()
    expect(judge({ flow: 20.001, limit: 20 })).toBeUndefined()
    expect(judge({ flow: 19.999, limit: 20 })!.phase).toBe('active')
  })

  it('X, Y: below is alarm, above is not', () => {
    expect(judge({ flow: 12, limit: 20 })!.phase).toBe('active')
    expect(judge({ flow: 25, limit: 20 })).toBeUndefined()
  })
})

// ── Z, AA, AB. Protection and alarm are different things ────────────────────

describe('Z, AA, AB — a protection is not an alarm, and an alarm is not a protection', () => {
  it('AA, Z: protection ACTIVE and EFFECTIVE is NOT an alarm', () => {
    /**
     * The §5 case. The setpoint asked for 2, the record requires 5, the
     * override raised it, and the machine is comfortably passing 5. The
     * protection is doing exactly its job — and a protection doing its job is
     * not something to call an operator about.
     */
    start(armed({ minFlow: '5 m³/h' }))
    lineUp(2); advance(400)
    ackStartup()
    advance(200)
    expect(prot()!.overriding).toBe(true)         // the demand is in force
    expect(prot()!.state).toBe('EFFECTIVE')       // and it is being met
    expect(env().flowM3h!).toBeGreaterThan(5)
    // ...and NOTHING annunciates: a protection doing its job is not an alarm
    expect(minf()).toBeUndefined()
  })

  it('AB: an alarm with NO override running at all', () => {
    /**
     * The other half of §5. The setpoint already respects the limit, so K18
     * raises nothing — and the plant still cannot make it, so the machine is
     * genuinely below its minimum. An alarm gated on "is the override active"
     * would miss this entirely.
     */
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(20); advance(200)                      // asked for exactly the limit
    expect(prot()!.overriding).toBe(false)        // nothing was overridden
    expect(prot()!.state).toBe('INACTIVE')
    holdAt(9); advance(60)                        // and now the plant fails
    expect(env().flowM3h!).toBeLessThan(20)
    expect(prot()!.overriding).toBe(false)        // STILL no override
    expect(minf()!.phase).toBe('active')          // ...and an alarm all the same
  })

  it('the alarm exists for a machine with NO controller on it at all', () => {
    // it is a fact about the MACHINE, which is why it sits on the pump's tag
    expect(judge({ flow: 5, limit: 20 })).toMatchObject({ tag: 'P-1', level: 'MINF' })
  })
})

// ── AC, AD, AE, AF. Cascade, mode ───────────────────────────────────────────

describe('AC, AD, AE, AF — who asked for the flow does not decide the alarm', () => {
  it('AC: under a cascade master, the alarm still judges the MACHINE', () => {
    start(armed({ minFlow: '20 m³/h', cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 1); advance(300)
    // K17's chain is intact and K18 still owns the FIC's setpoint
    expect(sim().loops['PIC-1']!.cascadeTo).toBe('FIC-1')
    expect(prot()!.effectiveSp).toBe(20)
    // whatever the master asked for, the alarm is about what the machine made
    const short = env().flowM3h! < 20
    expect(minf() !== undefined).toBe(short || minf()?.phase === 'cleared')
  })

  it('AD: the same machine with no master at all behaves identically', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(300)
    expect(sim().loops['FIC-1']!.cascadeFrom).toBeUndefined()
    expect(minf()!.phase).toBe('active')
  })

  it('AE, AF: MANUAL and AUTO make no difference to the alarm', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(300)
    expect(minf()!.phase).toBe('active')
    sim().writeTag('FIC-1', 'MODE', 0); advance(30)
    // K19 says the PROTECTION is standing by — it has no setpoint path in hand
    expect(prot()!.state).toBe('STANDING_BY')
    // ...and the MACHINE is still below its minimum, so the alarm still stands
    expect(minf()!.phase).toBe('active')
  })
})

// ── AG, AH, AI, AJ, AK, AL, AM. The lifecycle and the journal ───────────────

describe('AG-AM — the existing lifecycle, entered rather than reimplemented', () => {
  it('AG, AH: pending → active, and pending never reaches the journal', () => {
    start(armed({ minFlow: '55 m³/h', delay: '8 s' }))
    lineUp(12); advance(3)
    expect(minf()!.phase).toBe('pending')
    expect(minfEvents()).toEqual([])
    advance(10)
    expect(minf()!.phase).toBe('active')
    expect(minfEvents().map((e) => 'what' in e && e.what)).toEqual(['ALARM'])
  })

  it('AI: acknowledgement is the ordinary one, through the ordinary action', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(200)
    expect(minf()!.phase).toBe('active')
    sim().ack('P-1:MINF')
    expect(minf()!.phase).toBe('acked')
    expect(minfEvents().some((e) => 'what' in e && e.what === 'ACK')).toBe(true)
  })

  it('AJ: return-to-normal clears it, and it stays listed until acknowledged', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(35); advance(300); ackStartup(); advance(10)
    holdAt(9); advance(60)
    expect(minf()!.phase).toBe('active')
    holdAt(1); advance(200)
    expect(minf()!.phase).toBe('cleared')
    sim().ack('P-1:MINF')
    expect(minf()).toBeUndefined()            // acked + normal -> gone
  })

  it('AJ: an ACKED alarm that returns to normal drops silently', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(35); advance(300); ackStartup(); advance(10)
    holdAt(9); advance(60)
    sim().ack('P-1:MINF')
    expect(minf()!.phase).toBe('acked')
    holdAt(1); advance(200)
    expect(minf()).toBeUndefined()
  })

  it('AK: shelving works, through the existing suppression', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(200)
    expect(minf()!.phase).toBe('active')
    sim().shelve('P-1:MINF', 10)
    expect(minf()!.sup).toBe('shelved')
    sim().unshelve('P-1:MINF')
    expect(minf()!.sup).toBeUndefined()
  })

  it('AL: it lands in the ONE journal, beside every other alarm', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(200)
    const ev = minfEvents()
    expect(ev.length).toBeGreaterThan(0)
    expect(ev[0]).toMatchObject({ tag: 'P-1', level: 'MINF', what: 'ALARM' })
    // the same list the TRIP and the limit alarms use — there is only one
    sim().writeTag('P-1', 'FAULT', 1); advance(5)
    expect(sim().journal.some((e) => 'level' in e && e.level === 'TRIP')).toBe(true)
  })

  it('AM: a standing alarm writes ONE event, not one per tick', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    // 400 ticks of a condition that never lets up
    expect(env().state).toBe('BELOW MINIMUM FLOW')
    expect(minfEvents().length).toBe(1)
    // ...and the record kept its ORIGINAL timestamp rather than being remade
    const first = minf()!.since
    advance(100)
    expect(minf()!.since).toBe(first)
  })
})

// ── AN, AO. The chatter, and what it does to the journal ────────────────────

describe('AN, AO — the K19 crossing, and its effect on the annunciator', () => {
  const crossings = (xs: readonly string[]): number =>
    xs.reduce((n, v, i) => n + (i > 0 && v !== xs[i - 1] ? 1 : 0), 0)

  it('AN, AO: the condition still crosses, and the OVERRIDE still does not', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500)
    const states: string[] = []
    const overriding: string[] = []
    for (let i = 0; i < 200; i++) {
      advance(1)
      states.push(env().state)
      overriding.push(String(prot()!.overriding))
    }
    // K19's measurement, reproduced: the instantaneous condition crosses
    expect(crossings(states)).toBeGreaterThan(50)
    expect(new Set(states)).toEqual(new Set(['NORMAL', 'BELOW MINIMUM FLOW']))
    // ...and the thing that moves the machine does not, exactly as before
    expect(crossings(overriding)).toBe(0)
  })

  /**
   * Annunciator transitions over a window, counted on the RECORD rather than
   * on the journal: the journal is capped at 200 entries, so a saturated one
   * would report a flapping alarm and a quiet one as the same number.
   */
  const annunciations = (ticks: number): number => {
    const phases: string[] = []
    for (let i = 0; i < ticks; i++) { advance(1); phases.push(minf()?.phase ?? 'none') }
    return crossings(phases)
  }

  it('AN: WITHOUT a deadband the annunciator follows it — measured, not hidden', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(500); ackStartup()
    /**
     * THE HONEST NUMBER. With no engineering deadband stated, the alarm tracks
     * the instantaneous condition and flaps with it. This is REPORTED rather
     * than fixed: the width that would stop it is a control-design decision,
     * and the next test shows the field that carries it doing exactly that job
     * the moment somebody states one.
     */
    expect(annunciations(200)).toBeGreaterThan(10)
  })

  it('AN: WITH a stated deadband the same plant settles', () => {
    // 2 m³/h — an engineering value, stated on the record, not chosen here
    start(armed({ minFlow: '20 m³/h', deadband: '2 m³/h' }))
    lineUp(12); advance(500); ackStartup()
    expect(annunciations(200)).toBeLessThanOrEqual(2)
  })
})

// ── AQ, AR, AS, AT. Nothing else moved ──────────────────────────────────────

describe('AQ-AT — the measurement, the hydraulics and the clock are untouched', () => {
  it('AQ: the PV is never clamped to make the alarm agree with the setpoint', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(300)
    expect(minf()!.phase).toBe('active')
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(55)
    expect(env().flowM3h!).toBeLessThan(55)
    expect(prot()!.actualM3h).toBe(env().flowM3h)
  })

  it('AR, AS: the solve and the gains are identical with the policy present', () => {
    const withPolicy = buildSimModel(plant, armed({ minFlow: '20 m³/h', delay: '5 s' }))
    const without = buildSimModel(plant, reg({ minFlow: '20 m³/h' }))
    const c = (m: typeof withPolicy) => m.controllers.find((x) => x.tag === 'FIC-1')!
    const gains = (x: Record<string, unknown>) =>
      ({ kp: x.kp, ti: x.ti, outMin: x.outMin, outMax: x.outMax, action: x.action, minFlow: x.minFlow })
    expect(gains(c(withPolicy) as never)).toEqual(gains(c(without) as never))
    // the alarm policy reaches the ALARM and nothing else
    expect(withPolicy.defs.find((d) => d.name === 'P-1')!.minFlowM3h)
      .toBe(without.defs.find((d) => d.name === 'P-1')!.minFlowM3h)
  })

  it('AT: the same inputs give the same alarms and the same journal, twice', () => {
    const run = () => {
      start(armed({ minFlow: '20 m³/h', deadband: '2 m³/h', delay: '4 s' }))
      lineUp(12)
      const trace: string[] = []
      for (let i = 0; i < 300; i++) {
        advance(1)
        trace.push([minf()?.phase ?? '-', minf()?.since ?? '-', env().state].join(','))
      }
      return { trace, events: minfEvents().length }
    }
    const a = run()
    const b = run()
    expect(b.trace).toEqual(a.trace)
    expect(b.events).toBe(a.events)
    expect(new Set(a.trace).size).toBeGreaterThan(1)   // it actually moved
  })
})

// ── AU-AZ. Everything before K20 ────────────────────────────────────────────

describe('AU-AZ — K13 through K19, unchanged', () => {
  it('AU: K13 keeps its own envelope vocabulary and its own findings', () => {
    start(armed({ minFlow: '55 m³/h' }))
    lineUp(12); advance(300)
    expect(env().state).toBe('BELOW MINIMUM FLOW')
    expect(env().minFlowM3h).toBe(55)
    // the alarm did not replace, wrap or re-derive the envelope: it reports
    // K13's own signed number, against K13's own limit
    expect(minf()!.limit).toBe(env().minFlowM3h)
    expect(minf()!.value).toBeLessThan(55)
    expect(minf()!.unit).toBe('m³/h')
  })

  it('AX, AZ: K16 authority and K18/K19 protection are untouched by the policy', () => {
    start(armed({ minFlow: '20 m³/h' }))
    lineUp(12); advance(300)
    expect(sim().loops['FIC-1']!.authority).toBe('available')
    expect(prot()!.effectiveSp).toBe(20)
    expect(prot()!.requestedSp).toBe(12)
    expect(sim().tags['FIC-1']!.SP).toBe(12)      // the operator's entry survives
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(sim().loops['FIC-1']!.authority).toBe('de-energised')
    expect(prot()!.state).toBe('STANDING_BY')
  })

  it('AZ: and with no minimum stated at all, nothing anywhere changes', () => {
    start(reg())
    lineUp(12); advance(300)
    expect(sim().defs['P-1']!.minFlowM3h).toBeUndefined()
    expect(sim().defs['P-1']!.minFlowAlarm).toBeUndefined()
    expect(env().state).toBe('LIMIT UNKNOWN')
    expect(prot()).toBeUndefined()
    expect(minf()).toBeUndefined()
  })
})
