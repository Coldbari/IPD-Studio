// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K25 — THE THREE WAYS A CASCADE'S DOWNSTREAM CAN FAIL TO DELIVER.
 *
 * K17 through K24 each added a piece of this, one phase at a time. K25 audited
 * them together for accidental coupling and found none; this file is what
 * stops that being an opinion.
 *
 *     A. UNAVAILABLE          the slave cannot act at all — MANUAL, or its own
 *                             authority lost. Master HOLDS outright.
 *     B. SETPOINT LIMITED     the slave works and REFUSES part of the setpoint.
 *                             Master stops at the projection.
 *     C. PHYSICALLY LIMITED   the slave ACCEPTED the setpoint in full and
 *                             cannot realise it. Master integrates onward,
 *                             because its demand is genuine.
 *
 * ── PRECEDENCE IS STRUCTURAL, NOT A RULE ──────────────────────────────────
 *
 *     A > B > C
 *
 * enforced by control flow: the authority branch `continue`s before the
 * algorithm runs, so a master whose slave is unavailable never computes
 * `dsLimited` at all. B and C COMPOSE rather than compete — a slave can refuse
 * part of a setpoint AND be saturated at what it accepted.
 *
 * ── AND THE DISTINCTION THAT MATTERS MOST ─────────────────────────────────
 *
 * B and C look identical from the plant and are opposite in the control room.
 * An actuator that has not reached its command is NEVER evidence that a
 * setpoint was refused:
 *
 *     refused setpoint    requested != effective   (read on the SETPOINT)
 *     lagging actuator    requested != actual      (read on the OUTPUT)
 *
 * ── NO IMPLEMENTATION ─────────────────────────────────────────────────────
 *
 * K25 changed no runtime behaviour. Everything below was already correct; what
 * was missing was a test that would notice if it stopped being.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { loopFindings } from '../../src/hmi/sim/authority'
import {
  DOWNSTREAM_CONDITIONS_ARE_THREE, PROJECTION_IS_ONE_LEVEL,
} from '../../src/hmi/sim/constraints'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The K15 cascade fixture, unchanged since K17 ────────────────────────────

const cascaded: HmiScreen = {
  id: 'k25', name: 'K25', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
    { id: 'pt', type: 'display', x: 900, y: 160, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 220, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' }

/** Nothing is stated unless a test asks. `slave` carries the slave's record. */
const reg = (slave: Record<string, string> = {}, minFlow?: string): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty, ...(minFlow !== undefined ? { 'duty.minFlow': minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'PIC-1': { key: 'PIC-1', kind: 'instrument', fields: { 'signal.cascadeTo': 'FIC-1' } },
  ...(Object.keys(slave).length > 0
    ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: slave } } : {}),
})

const sim = () => useSimStore.getState()
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }
const start = (r: Registry = reg()) => { sim().exitRun(); sim().enterRun(cascaded, r) }
const lineUp = () => { sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) }
const master = () => sim().tags['PIC-1']!
const slave = () => sim().tags['FIC-1']!
const mLoop = () => sim().loops['PIC-1']!
const sLoop = () => sim().loops['FIC-1']!
const findings = () => loopFindings(sim().loops).map((f) => `${f.severity}:${f.id}`)
/** Drive the master hard against whatever its slave will not take. */
const push = (r: Registry, sp = 9) => {
  start(r); lineUp(); sim().writeTag('PIC-1', 'SP', sp); advance(300)
}

beforeEach(() => { start() })

// ── The taxonomy ────────────────────────────────────────────────────────────

describe('§3 — three conditions, three responses, none of them each other', () => {
  it('the taxonomy and the boundary are recorded, not merely believed', () => {
    expect(DOWNSTREAM_CONDITIONS_ARE_THREE).toBe(true)
    expect(PROJECTION_IS_ONE_LEVEL).toBe(true)
  })

  it('A: UNAVAILABLE — the master holds outright, and says why', () => {
    push(reg())
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(sLoop().authority).toBe('de-energised')
    expect(mLoop().authority).toBe('downstream')
    // HELD, which is stronger than a stop: nothing moves at all
    const held = { OP: master().OP, I: master().I }
    advance(120)
    expect({ OP: master().OP, I: master().I }).toEqual(held)
    expect(mLoop().saturated).toBe(0)
    expect(findings()).toContain('info:authority:PIC-1:downstream')
  })

  it('B: SETPOINT LIMITED — the master stops at the projection, not at its stop', () => {
    push(reg({ 'signal.spHigh': '30' }))
    expect(sLoop().spLimit!.limiting).toBe(true)
    expect(mLoop().downstreamLimited).toBe(true)
    expect(mLoop().saturated).toBe(0)              // it has travel left
    expect(master().OP!).toBeLessThan(70)
    expect(findings()).toContain('info:cascade-downstream-limited:PIC-1')
  })

  it('C: PHYSICALLY LIMITED — the master integrates on, because its demand is real', () => {
    push(reg())
    expect(sLoop().spLimit).toBeUndefined()        // the setpoint was ACCEPTED
    expect(slave().SP).toBe(60)                    // ...in full
    expect(sLoop().saturated).toBe(1)              // the SLAVE ran out of machine
    expect(mLoop().downstreamLimited).toBeUndefined()
    expect(mLoop().saturated).toBe(1)              // and the master used its range
    expect(findings()).toContain('info:cascade-setpoint-limited:PIC-1')
  })
})

// ── §11. The distinction that matters most ──────────────────────────────────

describe('§11, §15 — a refused setpoint and a lagging actuator are read differently', () => {
  it('a REFUSED setpoint shows on the SETPOINT: requested != effective', () => {
    push(reg({ 'signal.spHigh': '30' }))
    expect(sLoop().spLimit!.requested).toBeGreaterThan(30)
    expect(sLoop().spLimit!.limited).toBe(30)
    expect(mLoop().effectiveSp).toBe(30)           // what the slave carries
    expect(mLoop().commandedSp!).toBeGreaterThan(30) // what the master asked
  })

  it('a LAGGING actuator shows on the OUTPUT: requested != actual', () => {
    // a big hand step on the slave, caught mid-ramp
    start(reg())
    lineUp()
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 20); advance(60)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    expect(sLoop().requested).toBe(100)            // the command
    expect(sLoop().actual).toBe(70)                // the shaft, mid-ramp
    // ...and NOTHING about the setpoint was refused
    expect(sLoop().spLimit).toBeUndefined()
  })

  it('an unreached actuator is NEVER evidence that a setpoint was refused', () => {
    /**
     * A WORKING cascade, caught mid-ramp. The slave accepts its setpoint in
     * full and its shaft is still on the way to the command — which propagates
     * nothing upstream, because nothing was refused.
     */
    start(reg())
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(300)   // settle low
    sim().writeTag('PIC-1', 'SP', 9)                           // then step hard
    let everLagged = false
    let everPropagated = false
    for (let i = 0; i < 60; i++) {
      sim().tickOnce(1)
      if (sLoop().requested !== sLoop().actual) everLagged = true
      if (mLoop().downstreamLimited !== undefined) everPropagated = true
    }
    expect(everLagged).toBe(true)                 // the shaft did lag its command
    expect(everPropagated).toBe(false)            // ...and NOTHING went upstream
    expect(sLoop().spLimit).toBeUndefined()       // because nothing was refused
    expect(mLoop().authority).toBe('available')
  })
})

// ── §5. Precedence, and what composes ───────────────────────────────────────

describe('§5 — A > B > C, and B composes with C rather than competing', () => {
  it('UNAVAILABLE outranks SETPOINT LIMITED, structurally', () => {
    /**
     * The authority branch `continue`s before the algorithm runs, so a master
     * whose slave is unavailable never computes `dsLimited` at all. The
     * operator gets one row naming the real problem rather than two competing
     * explanations.
     */
    push(reg({ 'signal.spHigh': '30' }))
    expect(mLoop().downstreamLimited).toBe(true)        // B, while available
    sim().writeTag('P-1', 'RUN', 0); advance(60)
    expect(mLoop().authority).toBe('downstream')        // A takes over
    expect(mLoop().downstreamLimited).toBeUndefined()   // ...and B stands down
    expect(findings()).not.toContain('info:cascade-downstream-limited:PIC-1')
    expect(findings()).toContain('info:authority:PIC-1:downstream')
  })

  it('UNAVAILABLE outranks PHYSICAL LIMITATION too', () => {
    push(reg())
    expect(mLoop().saturated).toBe(1)
    sim().writeTag('P-1', 'FAULT', 1); advance(40)
    expect(mLoop().authority).toBe('downstream')
    expect(mLoop().saturated).toBe(0)                   // SAT cleared, K16's rule
    const held = { OP: master().OP, I: master().I }
    advance(60)
    expect({ OP: master().OP, I: master().I }).toEqual(held)
  })

  it('SETPOINT LIMITED and PHYSICAL LIMITATION coexist, and are both reported', () => {
    // spHigh near the top of the range AND a demand the plant cannot make
    push(reg({ 'signal.spHigh': '55' }))
    expect(sLoop().spLimit!.limiting).toBe(true)        // the slave refused part
    expect(sLoop().saturated).toBe(1)                   // ...and maxed out at the rest
    expect(mLoop().downstreamLimited).toBe(true)        // the master sees the refusal
    expect(mLoop().saturated).toBe(0)                   // and not a saturation of its own
  })

  it('SETPOINT LIMITED and RATE LIMITED coexist, and stay separate', () => {
    start(reg({ 'signal.spHigh': '30', 'signal.outputRateLimit': '1 %/s' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(100)
    sim().writeTag('PIC-1', 'SP', 9); advance(8)
    expect(sLoop().spLimit!.limiting).toBe(true)        // the setpoint WAS refused
    expect(sLoop().rateLimited).toBe(true)              // ...and the output is crawling
    expect(mLoop().downstreamLimited).toBe(true)        // only the refusal propagates
  })
})

// ── §12. Rate limiting does not propagate ───────────────────────────────────

describe('§12 — a rate-limited slave accepted the demand, so nothing goes upstream', () => {
  it('the slave takes the setpoint in full while its output crawls', () => {
    start(reg({ 'signal.outputRateLimit': '1 %/s' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(100)
    sim().writeTag('PIC-1', 'SP', 8); advance(8)
    expect(sLoop().rateLimited).toBe(true)
    expect(sLoop().spLimit).toBeUndefined()             // nothing was refused
    expect(mLoop().downstreamLimited).toBeUndefined()
    // ...and the master keeps integrating through the transient, as it must
    const before = master().I
    advance(5)
    expect(master().I).not.toBe(before)
  })
})

// ── §6, §7. Authority, MANUAL and the transfers ─────────────────────────────

describe('§6, §7 — MANUAL is unavailability, and the transfers stay bumpless', () => {
  it('a slave in MANUAL is DOWNSTREAM UNAVAILABLE, not setpoint-limited', () => {
    start(reg({ 'signal.spHigh': '30' }))
    lineUp(); sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'SP', 9); advance(100)
    expect(sLoop().mode).toBe('MANUAL')
    expect(sLoop().authority).toBe('available')         // the SLAVE is fine
    expect(mLoop().authority).toBe('downstream')        // the MASTER is not followed
    expect(mLoop().downstreamLimited).toBeUndefined()
  })

  it('a slave that is de-energised is the same master state, different cause', () => {
    push(reg())
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(sLoop().authority).toBe('de-energised')
    expect(mLoop().authority).toBe('downstream')
    // two rows: one for the slave's own cause, one for the master's consequence
    expect(findings()).toContain('info:authority:FIC-1:de-energised')
    expect(findings()).toContain('info:authority:PIC-1:downstream')
  })

  it('AUTO → MANUAL on the master holds its output where the plant left it', () => {
    push(reg({ 'signal.spHigh': '30' }))
    const before = master().OP
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().tickOnce(1)
    expect(master().OP).toBe(before)
  })

  it('MANUAL → AUTO on the master is bumpless, downstream-limited or not', () => {
    for (const r of [reg(), reg({ 'signal.spHigh': '30' })]) {
      start(r); lineUp(); sim().writeTag('PIC-1', 'SP', 4); advance(200)
      sim().writeTag('PIC-1', 'MODE', 0)
      sim().writeTag('PIC-1', 'OP', 45); advance(30)
      const before = master().OP!
      sim().writeTag('PIC-1', 'MODE', 1)
      sim().tickOnce(1)
      expect(Math.abs(master().OP! - before)).toBeLessThan(15)
    }
  })

  it('MANUAL → AUTO on the SLAVE restores the master’s authority', () => {
    start(reg())
    lineUp(); sim().writeTag('FIC-1', 'MODE', 0); sim().writeTag('PIC-1', 'SP', 4)
    advance(100)
    expect(mLoop().authority).toBe('downstream')
    sim().writeTag('FIC-1', 'MODE', 1); advance(5)
    expect(mLoop().authority).toBe('available')
  })

  it('and authority restored resumes from the held state', () => {
    push(reg())
    sim().writeTag('P-1', 'RUN', 0); advance(40)
    const held = master().I
    sim().writeTag('P-1', 'RUN', 1); advance(5)
    expect(mLoop().authority).toBe('available')
    // it resumes FROM the held integrator rather than from a manufactured one
    expect(Math.abs(master().I! - held!)).toBeLessThan(10)
  })
})

// ── §13. Minimum flow in the chain ──────────────────────────────────────────

describe('§13 — minimum flow, the setpoint limits, and the refused pair', () => {
  const SLAVE_MAX = 60
  const spec = (r: Registry) =>
    buildSimModel(cascaded, r).controllers.find((c) => c.tag === 'PIC-1')!
  const slaveSpec = (r: Registry) =>
    buildSimModel(cascaded, r).controllers.find((c) => c.tag === 'FIC-1')!

  it('minFlow BELOW the requested setpoint changes nothing', () => {
    start(reg({}, '10 m³/h'))
    lineUp(); sim().writeTag('PIC-1', 'SP', 5); advance(300)
    expect(sim().minFlow['FIC-1']!.overriding).toBe(false)
  })

  it('minFlow ABOVE it raises the effective setpoint, and floors the master', () => {
    expect(spec(reg({}, '30 m³/h')).dsFloorPct).toBeCloseTo((30 / SLAVE_MAX) * 100, 9)
    start(reg({}, '30 m³/h'))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(300)
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(30)
    expect(sim().minFlow['FIC-1']!.overriding).toBe(true)
  })

  it('minFlow EQUAL to spHigh is not a contradiction, and both are carried', () => {
    const s = slaveSpec(reg({ 'signal.spHigh': '25' }, '25 m³/h'))
    expect(s.minFlow).toBe(25)
    expect(s.spHigh).toBe(25)
    expect(s.minFlowProblem).toBeUndefined()
  })

  it('minFlow ABOVE spHigh stays REFUSED — K23’s rule, unchanged', () => {
    const s = slaveSpec(reg({ 'signal.spHigh': '25' }, '30 m³/h'))
    expect(s.minFlow).toBeUndefined()
    expect(s.minFlowProblem).toContain('setpoint maximum of 25')
    // ...and the master's floor comes only from the SP limit that survived
    const m = spec(reg({ 'signal.spHigh': '25' }, '30 m³/h'))
    expect(m.dsFloorPct).toBeUndefined()
    expect(m.dsCeilPct).toBeCloseTo((25 / SLAVE_MAX) * 100, 9)
  })

  it('the HIGHEST floor binds when minFlow and spLow both apply', () => {
    expect(spec(reg({ 'signal.spLow': '40' }, '20 m³/h')).dsFloorPct)
      .toBeCloseTo((40 / SLAVE_MAX) * 100, 9)
    expect(spec(reg({ 'signal.spLow': '10' }, '20 m³/h')).dsFloorPct)
      .toBeCloseTo((20 / SLAVE_MAX) * 100, 9)
  })
})

// ── §9, §10. The composition boundary ───────────────────────────────────────

describe('§9, §10 — one level, by explicit refusal rather than by accident', () => {
  it('a three-level cascade is REFUSED at wiring time, with a reason', () => {
    /**
     * A middle controller would drive another controller's setpoint, so its
     * `outKind` would be `cascade` — and `cascadeProblem` refuses any slave
     * that is not driving a variable speed drive. The boundary is stated, not
     * stumbled into.
     */
    const threeLevel: Registry = {
      ...reg(),
      'PIC-1': { key: 'PIC-1', kind: 'instrument', fields: { 'signal.cascadeTo': 'FIC-1' } },
      'FIC-1': { key: 'FIC-1', kind: 'instrument', fields: { 'signal.cascadeTo': 'PIC-1' } },
    }
    const m = buildSimModel(cascaded, threeLevel)
    const problems = m.controllers.map((c) => c.cascadeProblem).filter(Boolean)
    expect(problems.length).toBeGreaterThan(0)          // refused, not built
  })

  it('the projection is derived from the slave’s STATIC record, at wiring time', () => {
    /**
     * Which is exactly why it does not compose: a master of a master would
     * need its slave's EFFECTIVE accepted interval, and that is a runtime
     * quantity that moves as the level below it moves. See
     * `PROJECTION_IS_ONE_LEVEL`.
     */
    const withLimit = buildSimModel(cascaded, reg({ 'signal.spHigh': '30' }))
      .controllers.find((c) => c.tag === 'PIC-1')!
    // it exists before a single tick has run
    expect(withLimit.dsCeilPct).toBeCloseTo(50, 9)
  })
})

// ── §4, §14. One meaning each, and no duplicate rows ────────────────────────

describe('§4, §14 — every flag means one thing, and no row says another’s job', () => {
  it('there is no generic "limited" — each state is its own field', () => {
    push(reg({ 'signal.spHigh': '30' }))
    const m = mLoop()
    // the master's own travel, the downstream refusal, and its authority are
    // three separate published facts
    expect(m.saturated).toBe(0)
    expect(m.downstreamLimited).toBe(true)
    expect(m.authority).toBe('available')
    expect(m.rateLimited ?? false).toBe(false)
  })

  it('the operator is never told MASTER SATURATED when it is not', () => {
    push(reg({ 'signal.spHigh': '30' }))
    expect(mLoop().saturated).toBe(0)
    expect(findings()).not.toContain('info:cascade-setpoint-limited:PIC-1')
    expect(findings()).toContain('info:cascade-downstream-limited:PIC-1')
  })

  it('and the two cascade rows never both fire for one condition', () => {
    for (const r of [reg(), reg({ 'signal.spHigh': '30' })]) {
      push(r)
      const f = findings()
      const both = f.includes('info:cascade-setpoint-limited:PIC-1')
        && f.includes('info:cascade-downstream-limited:PIC-1')
      expect(both).toBe(false)
    }
  })

  it('nothing here is a warning or an error — configured constraints are not faults', () => {
    for (const r of [reg(), reg({ 'signal.spHigh': '30' }), reg({}, '30 m³/h')]) {
      push(r)
      expect(findings().some((x) => x.startsWith('warning:') || x.startsWith('error:')))
        .toBe(false)
    }
  })
})

// ── §16, §17 AI. Anti-windup, and determinism ───────────────────────────────

describe('§16 — the predicate fires for refusals and not for physical limits', () => {
  it('it HOLDS at a setpoint refusal', () => {
    push(reg({ 'signal.spHigh': '30' }))
    const held = master().I
    advance(200)
    expect(master().I).toBe(held)
  })

  it('it HOLDS at a floor, from either source', () => {
    for (const r of [reg({ 'signal.spLow': '30' }), reg({}, '30 m³/h')]) {
      start(r); lineUp(); sim().writeTag('PIC-1', 'SP', 9); advance(250)
      sim().writeTag('PIC-1', 'SP', 0.2); advance(300)
      expect(mLoop().saturated).toBe(0)          // held by the SLAVE, not its own stop
      const held = master().I
      advance(150)
      expect(master().I).toBe(held)
    }
  })

  it('it does NOT fire for a saturated slave actuator', () => {
    push(reg())
    expect(mLoop().downstreamLimited).toBeUndefined()
    // the master reached its OWN ceiling, which is the correct stop here
    expect(mLoop().saturated).toBe(1)
  })

  it('it does NOT fire for a rate-limited slave', () => {
    start(reg({ 'signal.outputRateLimit': '1 %/s' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(100)
    sim().writeTag('PIC-1', 'SP', 8); advance(8)
    expect(mLoop().downstreamLimited).toBeUndefined()
  })

  it('AI: deterministic through every state and every transition', () => {
    const run = () => {
      start(reg({ 'signal.spLow': '10', 'signal.spHigh': '40' }, '15 m³/h'))
      lineUp(); sim().writeTag('PIC-1', 'SP', 9)
      const trace: string[] = []
      for (let i = 0; i < 300; i++) {
        advance(1)
        if (i === 80) sim().writeTag('P-1', 'RUN', 0)
        if (i === 140) sim().writeTag('P-1', 'RUN', 1)
        if (i === 200) sim().writeTag('PIC-1', 'SP', 1)
        trace.push([master().OP, master().I, slave().SP, mLoop().authority,
          mLoop().downstreamLimited, mLoop().saturated]
          .map((x) => (typeof x === 'number' ? x.toFixed(9) : String(x))).join(','))
      }
      return trace
    }
    const a = run()
    expect(run()).toEqual(a)
    expect(new Set(a).size).toBeGreaterThan(20)
  })
})

// ── AC-AH. Every phase before K25 ───────────────────────────────────────────

describe('AC-AH — K17 through K24, unchanged by this audit', () => {
  it('AC: K17 cascade wiring and its map', () => {
    push(reg(), 4)
    expect(mLoop().cascadeTo).toBe('FIC-1')
    expect(sLoop().cascadeFrom).toBe('PIC-1')
    expect(slave().SP!).toBeGreaterThanOrEqual(0)
    expect(slave().SP!).toBeLessThanOrEqual(60)
  })

  it('AD: K18/K19 minimum-flow protection and its states', () => {
    start(reg({}, '20 m³/h'))
    lineUp(); sim().writeTag('PIC-1', 'SP', 1); advance(300)
    expect(sim().minFlow['FIC-1']!.inForce).toBe(true)
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(sim().minFlow['FIC-1']!.state).toBe('STANDING_BY')
  })

  it('AE: K21 output-rate limiting stays the slave’s own affair', () => {
    start(reg({ 'signal.outputRateLimit': '5 %/s' }))
    lineUp(); sim().writeTag('PIC-1', 'SP', 4); advance(200)
    expect(sLoop().outputRatePctPerS).toBe(5)
    expect(mLoop().outputRatePctPerS).toBeUndefined()
  })

  it('AF: K22 — SAT is the controller’s own travel, everywhere', () => {
    push(reg())
    expect(mLoop().saturated).toBe(1)
    expect(sLoop().saturated).toBe(1)
  })

  it('AG: K23 setpoint limits still bound the slave’s own setpoint', () => {
    push(reg({ 'signal.spHigh': '30' }))
    expect(sLoop().spLimit).toMatchObject({ high: 30, limited: 30, limiting: true })
    expect(slave().SP!).toBeGreaterThan(30)        // the master's request survives
  })

  it('AH: K24 projection and its diagnostic', () => {
    push(reg({ 'signal.spHigh': '30' }))
    expect(mLoop().downstreamLimited).toBe(true)
    expect(mLoop().effectiveSp).toBe(30)
    expect(findings()).toContain('info:cascade-downstream-limited:PIC-1')
  })
})
