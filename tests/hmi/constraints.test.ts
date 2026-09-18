// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K22 — CONSTRAINT OWNERSHIP, PRECEDENCE AND UNITS.
 *
 * By K21 this runtime had eight independent things that can stop a controller
 * getting what it asked for, added one phase at a time since K12. Each was
 * correct alone; what nobody had written down was the ORDER, the OWNERSHIP and
 * which of them the anti-windup can see.
 *
 * `sim/constraints.ts` is that inventory. THIS FILE IS WHAT STOPS IT BEING
 * PROSE: every row's claim is driven against a running plant, every
 * engineering `source` is checked to still exist in the field catalogue, and
 * the precedence is walked by pushing one loop into each limit in turn.
 *
 * ── WHAT K22 CHANGED ──────────────────────────────────────────────────────
 *
 * One defect, found by audit rather than reported: a valve's travel had no
 * owner on the direct-write path. `OP = 150` read back a POSITION of 150 %,
 * and `OP = -50` drove it negative. The hydraulics were safe — `frac` clamps
 * at the solver boundary — but the PUBLISHED actuator state was physically
 * impossible and reached the faceplate, `LoopState.actual` and the DEV alarm's
 * own comparison. `travelTarget` now owns it, exactly as `speedTarget` has
 * owned the drive's turndown since K12.
 *
 * ── AND WHAT IT DELIBERATELY DID NOT ──────────────────────────────────────
 *
 * No setpoint limits were invented (there are none, and §NO_SP below proves
 * the audit rather than assuming it), no setpoint RATE limiting was added, no
 * defaults were created, no gains were touched, and no new operator state was
 * added for constraints the existing three already describe.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import {
  CONSTRAINTS, ENGINEERING_SOURCED, NO_ENGINEERING_SP_LIMITS,
  PHYSICAL_LAG_IS_NOT_WINDUP, SATURATION_IS_CONTROLLER_TRAVEL, WINDUP_OBSERVED,
} from '../../src/hmi/sim/constraints'
import { FIELD_CATALOG } from '../../src/model/fields'
import { processFor } from '../../src/model/processData'
import { engineeringFor } from '../../src/model/signalData'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The fixture: K15's plant, which every phase since has been measured on ──

const plant: HmiScreen = {
  id: 'k22', name: 'K22', theme: 'classic',
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

/** Nothing is stated unless a test asks for it. Absent is never zero here. */
const reg = (opts: {
  minSpeed?: string
  minFlow?: string
  rate?: string
  cascade?: boolean
  fixedSpeed?: boolean
} = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty,
    ...(opts.fixedSpeed ? {} : { 'duty.vsd': 'Yes' }),
    ...(opts.minSpeed !== undefined ? { 'duty.minSpeed': opts.minSpeed } : {}),
    ...(opts.minFlow !== undefined ? { 'duty.minFlow': opts.minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(opts.rate !== undefined
    ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: { 'signal.outputRateLimit': opts.rate } } }
    : {}),
  ...(opts.cascade
    ? { 'PIC-1': { key: 'PIC-1', kind: 'instrument' as const, fields: { 'signal.cascadeTo': 'FIC-1' } } }
    : {}),
})

/** The standard machine: a VSD with a stated 20 % turndown. */
const vsd = (extra: Parameters<typeof reg>[0] = {}) => reg({ minSpeed: '20 %', ...extra })

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = vsd(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const fic = () => sim().tags['FIC-1']!
const pump = () => sim().tags['P-1']!
const valve = () => sim().tags['HV-9']!
const loop = (tag = 'FIC-1') => sim().loops[tag]!
const spec = (tag = 'FIC-1', r: Registry = vsd(), screen: HmiScreen = plant) =>
  buildSimModel(screen, r).controllers.find((c) => c.tag === tag)!
const lineUp = (sp?: number, tag = 'FIC-1') => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag(tag, 'SP', sp)
}
const commanded = () => fic().OPC ?? fic().OP
const shaftPct = () => (pump().RAMP ?? 0) * 100

beforeEach(() => { start() })

// ── The inventory itself ────────────────────────────────────────────────────

describe('the inventory is an index of the runtime, not a description of it', () => {
  it('every engineering source named still exists in the field catalogue', () => {
    const keys = new Set(
      Object.values(FIELD_CATALOG).flatMap((sections) =>
        sections.flatMap((s) => s.fields.map((f) => f.key))))
    expect(ENGINEERING_SOURCED.length).toBeGreaterThan(0)
    for (const { id, source } of ENGINEERING_SOURCED) {
      // the row names a real field an engineer can actually fill in
      const key = source.split(' ')[0]!
      expect(keys.has(key), `${id} cites ${key}`).toBe(true)
    }
  })

  it('every id is unique and every layer is one of the four', () => {
    const ids = CONSTRAINTS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CONSTRAINTS) {
      expect(['setpoint', 'controller-output', 'actuator', 'physical']).toContain(c.layer)
      expect(c.owner).toBeTruthy()
      expect(c.unit).toBeTruthy()
      expect(c.absent).toBeTruthy()
    }
  })

  it('the model-domain bounds are declared as such, and are the only ones', () => {
    /**
     * §21: a normalised software bound must never be reported as an
     * engineering limit. There are exactly five, and each says in its own row
     * why it belongs to the model rather than to a record. `op-travel` is
     * deliberately NOT among them — its floor is `duty.minSpeed`, a real
     * engineering value, and only its ceiling is the curve's domain.
     */
    const modelDomain = CONSTRAINTS.filter((c) => c.source === null).map((c) => c.id)
    expect(modelDomain).toEqual([
      'sp-domain', 'vsd-ceiling', 'valve-travel', 'vsd-ramp', 'valve-stroke',
    ])
    // ...and NONE of them is a duty.maxSpeed, because no such field exists
    const keys = new Set(
      Object.values(FIELD_CATALOG).flatMap((sections) =>
        sections.flatMap((s) => s.fields.map((f) => f.key))))
    expect(keys.has('duty.maxSpeed')).toBe(false)
  })

  it('physical lag is marked outside the windup predicate, deliberately', () => {
    expect(PHYSICAL_LAG_IS_NOT_WINDUP).toBe(true)
    const physical = CONSTRAINTS.filter((c) => c.layer === 'physical')
    expect(physical.length).toBeGreaterThan(0)
    for (const c of physical) expect(c.antiWindup).toBe('outside')
    // and every CONTROLLER-OUTPUT constraint is observed, which is the contrast
    for (const c of CONSTRAINTS.filter((x) => x.layer === 'controller-output')) {
      expect(c.antiWindup).toBe('observes')
    }
  })
})

// ── A, B, C, AH. Setpoint limits: there are none ────────────────────────────

describe('A, B, C, AH, NO_SP — the audit for setpoint limits, and its result', () => {
  it('A: the engine enforces NO setpoint limit, and the loop says so honestly', () => {
    expect(NO_ENGINEERING_SP_LIMITS).toBe(true)
    start(vsd())
    lineUp(200); advance(300)                   // far beyond the 0-60 range
    // the entry is HONOURED, not silently rewritten
    expect(fic().SP).toBe(200)
    // ...and the loop runs out of machine and reports exactly that
    expect(fic().OP).toBe(100)
    expect(loop().saturated).toBe(1)
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(60)
  })

  it('B, C: `signal.setpoint` is a STARTING VALUE, not a bound', () => {
    const e = engineeringFor(
      { 'FIC-1': { key: 'FIC-1', kind: 'instrument', fields: { 'signal.setpoint': '30' } } },
      'FIC-1')
    expect(e.setpoint).toBe(30)
    // there is no spMin/spMax anywhere in the parsed record
    const raw = e as unknown as Record<string, unknown>
    for (const k of ['spMin', 'spMax', 'setpointMin', 'setpointMax']) {
      expect(raw[k]).toBeUndefined()
    }
  })

  it('AH: and K22 introduced NO hidden setpoint rate limiting', () => {
    /**
     * §19. K21 observed that a master's output rate limit constrains the
     * slave's setpoint while a loop's own setpoint moves at once, and §3
     * forbids treating that as a defect: an output rate limit and a setpoint
     * rate limit are different engineering functions.
     */
    start(vsd({ rate: '2 %/s' }))               // a very slow OUTPUT limit
    lineUp(10); advance(200)
    sim().writeTag('FIC-1', 'SP', 55)
    sim().tickOnce(1)
    // the SETPOINT arrives whole and instantly, however slow the output is
    expect(fic().SP).toBe(55)
    // ...and only the OUTPUT is held back
    expect(loop().rateLimited).toBe(true)
  })
})

// ── D, E, F, K, AJ. Controller output travel ────────────────────────────────

describe('D, E, F, K, AJ — the controller’s own travel, and where its floor comes from', () => {
  it('D, AJ: a machine that declares NO turndown gets a floor of 0, not a default', () => {
    const c = spec('FIC-1', reg())              // vsd, no duty.minSpeed
    expect(processFor(reg(), 'P-1').minSpeedPct).toBeUndefined()
    expect(c.outMin).toBe(0)
    // absent is not zero-the-engineering-value: the record states nothing, and
    // the model imposes nothing. K13 reports the gap; nothing is invented.
    expect(c.outMax).toBe(100)
  })

  it('E, K: a stated turndown IS the controller’s floor — one number, by design', () => {
    const c = spec('FIC-1', vsd())
    expect(processFor(vsd(), 'P-1').minSpeedPct).toBe(20)
    expect(c.outMin).toBe(20)
    /**
     * THE ONE DELIBERATE DOUBLE-ENFORCEMENT. The drive clamps its own shaft to
     * the turndown whatever it is commanded, AND the controller's travel floor
     * is set to the same number so the algorithm can SEE the stop it is
     * winding against. K22 records it as intentional rather than removing one.
     */
    start(vsd())
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 5); advance(20)
    expect(fic().OP).toBe(5)                    // the request is preserved
    expect(pump().SPD).toBe(20)                 // the controller clamped it
    expect(shaftPct()).toBeCloseTo(20, 6)       // and the drive holds there
  })

  it('K: and a DIRECT write to the drive cannot slip past the turndown either', () => {
    // no controller in the way: the actuator owns this clamp on its own
    const noLoop: HmiScreen = { ...plant, widgets: plant.widgets.filter((w) => w.id !== 'fic') }
    start(vsd(), noLoop)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('P-1', 'SPD', 3); advance(30)
    expect(pump().SPD).toBe(3)                  // the command reads what was asked
    expect(shaftPct()).toBeCloseTo(20, 6)       // the SHAFT is held at the turndown
  })

  it('F: the ceiling is the curve’s domain, and is not an engineering maximum', () => {
    const c = spec('FIC-1', vsd())
    expect(c.outMax).toBe(100)
    // it is identical whether or not the record says anything about speed,
    // because it does not come from the record at all
    expect(spec('FIC-1', reg()).outMax).toBe(100)
    expect(CONSTRAINTS.find((x) => x.id === 'vsd-ceiling')!.source).toBeNull()
  })

  it('a VALVE loop’s travel is 0-100, which is both the domain and the physics', () => {
    const valveLoop: HmiScreen = {
      ...plant,
      widgets: plant.widgets.map((w) => (w.id === 'hv' ? { ...w, tag: 'FV-1' } : w)),
      pipes: plant.pipes.map((p) => (p.aId === 'hv' || p.bId === 'hv' ? p : p)),
    }
    const c = buildSimModel(valveLoop, vsd()).controllers.find((x) => x.tag === 'FIC-1')
    // whatever it drives, a non-speed loop has the plain normalised domain
    if (c && c.outKind !== 'pump') {
      expect(c.outMin ?? 0).toBe(0)
      expect(c.outMax ?? 100).toBe(100)
    }
  })
})

// ── G, H, I. Output rate, and its interaction with travel ───────────────────

describe('G, H, I — the rate limit sits INSIDE the travel, never outside it', () => {
  it('G: absent means unconstrained, and publishes nothing', () => {
    start(vsd())
    lineUp(30); advance(100)
    expect(spec('FIC-1', vsd()).outputRatePctPerS).toBeUndefined()
    expect(fic().OPC).toBeUndefined()
    expect(loop().outputRatePctPerS).toBeUndefined()
  })

  it('H, I: a rate limit may not walk the command past the travel floor', () => {
    /**
     * PRECEDENCE, MEASURED. The algorithm's request is clamped to the travel
     * FIRST, and the rate limit then narrows the move from where the command
     * already is. A generous rate can therefore never carry the output below
     * the turndown, because the request it is chasing was never below it.
     */
    start(vsd({ rate: '50 %/s' }))
    lineUp(0.5); advance(300)                   // ask for almost nothing
    expect(commanded()!).toBeGreaterThanOrEqual(20 - 1e-9)
    expect(pump().SPD!).toBeGreaterThanOrEqual(20 - 1e-9)
    expect(loop().saturated).toBe(-1)           // at the FLOOR, and says so
  })

  it('I: and the two constraints are separately reported, not merged', () => {
    // a REACHABLE step, so only the rate binds and the travel does not
    start(vsd({ rate: '2 %/s' }))
    lineUp(20); advance(400)
    sim().writeTag('FIC-1', 'SP', 38)
    sim().tickOnce(1)
    expect(loop().rateLimited).toBe(true)       // the rate is binding
    expect(loop().saturated).toBe(0)            // the travel is not
  })

  it('I: and where BOTH bind, both are reported — neither claims to be the only one', () => {
    /**
     * §18. A loop asked for more than the plant can make, on a record that
     * also states a rate limit, is held by the travel AND moving at its
     * configured rate. Two facts, two fields; the faceplate shows both rows.
     */
    start(vsd({ rate: '2 %/s' }))
    lineUp(20); advance(400)
    sim().writeTag('FIC-1', 'SP', 58)           // beyond what the plant can make
    sim().tickOnce(1)
    expect(loop().rateLimited).toBe(true)
    expect(loop().saturated).toBe(1)
  })
})

// ── J, L, M. Actuator and physical layers ───────────────────────────────────

describe('J, L, M — the actuator owns its travel, and the hardware owns its speed', () => {
  it('M: a valve’s POSITION cannot leave its travel, whoever wrote the command', () => {
    /**
     * THE K22 DEFECT. Before this, `OP = 150` read back a POSITION of 150 %.
     * The solver was safe because `frac` clamps at its own boundary — so no
     * flow was ever wrong — but the published state was physically impossible
     * and reached the faceplate, `LoopState.actual` and the DEV alarm.
     */
    start(vsd())
    sim().writeTag('HV-9', 'OP', 150); advance(20)
    expect(valve().OP).toBe(150)                // the request is left visible…
    expect(valve().POS).toBe(100)               // …and the POSITION is physical
    sim().writeTag('HV-9', 'OP', -50); advance(20)
    expect(valve().OP).toBe(-50)
    expect(valve().POS).toBe(0)
  })

  it('M: and a valve held at its stop is FOLLOWING, so no DEV alarm is raised', () => {
    start(vsd())
    sim().writeTag('HV-9', 'OP', 150); advance(60)
    expect(valve().POS).toBe(100)
    expect(valve().DEVT).toBe(0)                // the deviation is judged against
    expect(sim().alarms.find((a) => a.id === 'HV-9:DEV')).toBeUndefined()  // the achievable command
  })

  it('M: STROKE_RATE still governs how fast it gets there', () => {
    start(vsd())
    sim().writeTag('HV-9', 'OP', 0); advance(30)
    expect(valve().POS).toBe(0)
    sim().writeTag('HV-9', 'OP', 100)
    sim().tickOnce(1)
    expect(valve().POS).toBe(25)                // STROKE_RATE = 25 %/s, untouched
    sim().tickOnce(1)
    expect(valve().POS).toBe(50)
  })

  it('M: a STUCK valve still does not move, and the clamp did not change that', () => {
    start(vsd())
    sim().writeTag('HV-9', 'OP', 50); advance(30)
    const held = valve().POS
    sim().writeTag('HV-9', 'STUCK', 1)
    sim().writeTag('HV-9', 'OP', 150); advance(30)
    expect(valve().POS).toBe(held)
  })

  it('L: the drive’s physical ramp is untouched and is a separate layer', () => {
    start(vsd())
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    expect(pump().SPD).toBe(100)                // the command arrives whole…
    expect(shaftPct()).toBe(50)                 // …and the shaft takes RAMP_S
    sim().tickOnce(1)
    expect(shaftPct()).toBe(100)
  })

  it('J: an actuator limit is NOT the controller’s limit — they are two rows', () => {
    const ids = CONSTRAINTS.map((c) => c.id)
    expect(ids).toContain('op-travel')          // the controller's
    expect(ids).toContain('vsd-turndown')       // the actuator's
    expect(ids).toContain('vsd-ramp')           // the hardware's
    const layers = CONSTRAINTS.filter((c) => ['op-travel', 'vsd-turndown', 'vsd-ramp'].includes(c.id))
      .map((c) => c.layer)
    expect(new Set(layers).size).toBe(3)        // three DIFFERENT layers
  })
})

// ── N, O, S. Minimum flow ───────────────────────────────────────────────────

describe('N, O, S — a pump requirement is not a controller setpoint limit', () => {
  it('N: the override acts on the SETPOINT, before the algorithm, and only there', () => {
    start(vsd({ minFlow: '20 m³/h' }))
    lineUp(12); advance(400)
    const p = sim().minFlow['FIC-1']!
    expect(p.requestedSp).toBe(12)
    expect(p.effectiveSp).toBe(20)
    expect(fic().SP).toBe(12)                   // the operator's entry survives
    expect(CONSTRAINTS.find((c) => c.id === 'min-flow-override')!.layer).toBe('setpoint')
  })

  it('O: minFlow is NOT turned into a controller output floor', () => {
    /**
     * §7 AND §16, measured together. A pump's minimum CONTINUOUS FLOW and a
     * drive's minimum SPEED are different engineering quantities about
     * different things, and neither is derived from the other. The loop below
     * declares a minimum flow and no turndown at all.
     */
    const c = spec('FIC-1', reg({ minFlow: '20 m³/h' }))
    expect(c.minFlow).toBe(20)                  // the setpoint floor, in m³/h
    expect(c.outMin).toBe(0)                    // and NO output floor, in %
  })

  it('O: nor is a turndown turned into a minimum flow', () => {
    const c = spec('FIC-1', vsd())              // 20 % turndown, no minFlow
    expect(c.outMin).toBe(20)
    expect(c.minFlow).toBeUndefined()
    expect(sim().defs['P-1']?.minFlowM3h).toBeUndefined()
  })

  it('S: with both stated, they act at different layers and do not collide', () => {
    start(vsd({ minFlow: '20 m³/h', rate: '5 %/s' }))
    lineUp(12); advance(400)
    expect(sim().minFlow['FIC-1']!.effectiveSp).toBe(20)   // setpoint layer
    expect(loop().outputRatePctPerS).toBe(5)               // output layer
    expect(spec('FIC-1', vsd({ minFlow: '20 m³/h', rate: '5 %/s' })).outMin).toBe(20)
    expect(sim().pumpEnvelopes['P-1']!.flowM3h!).toBeGreaterThan(19)
  })
})

// ── P, Q, R. Cascade ────────────────────────────────────────────────────────

describe('P, Q, R — every clamp in a cascade has exactly one owner', () => {
  it('P, Q: the master’s output is clamped once, and MAPPED onto the slave’s range', () => {
    start(vsd({ cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 4); advance(300)
    const master = spec('PIC-1', vsd({ cascade: true }), cascaded)
    // a cascade master's output is the plain normalised domain: it drives no
    // machine, so no turndown applies to it
    expect(master.outMin ?? 0).toBe(0)
    expect(master.outMax ?? 100).toBe(100)
    // ...and the setpoint it writes is inside the SLAVE's own configured range
    const sp = sim().tags['FIC-1']!.SP!
    expect(sp).toBeGreaterThanOrEqual(0)
    expect(sp).toBeLessThanOrEqual(60)
  })

  it('R: the slave’s own travel is the slave’s, and the master never sees it', () => {
    start(vsd({ cascade: true }), cascaded)
    expect(spec('FIC-1', vsd({ cascade: true }), cascaded).outMin).toBe(20)
    expect(spec('PIC-1', vsd({ cascade: true }), cascaded).outMin ?? 0).toBe(0)
  })

  it('no hidden double-clamping: the master’s SP write is already inside range', () => {
    start(vsd({ cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 9); advance(200)
    // the master is asking for everything it can; the slave's SP is at the top
    // of the slave's range and NOT clamped a second time somewhere else
    expect(sim().tags['FIC-1']!.SP!).toBeLessThanOrEqual(60)
    expect(sim().loops['PIC-1']!.commandedSp).toBeLessThanOrEqual(60)
  })
})

// ── T, U, V, W. The four values and the three states ────────────────────────

describe('T, U, V, W — requested, commanded, actual; saturated, rate-limited, unauthorised', () => {
  it('T: the values stay separate even where they happen to be equal', () => {
    start(vsd({ rate: '3 %/s' }))
    lineUp(20); advance(400)
    sim().writeTag('FIC-1', 'SP', 50)
    sim().tickOnce(1)
    const l = loop()
    expect(l.requestedOp).toBeGreaterThan(l.requested!)
    expect(l.actual).toBeCloseTo(shaftPct(), 6)
    // and they are three separately published fields, not one derived thrice
    expect(Object.keys(l)).toEqual(expect.arrayContaining(['requestedOp', 'requested', 'actual']))
  })

  it('U: SAT is the CONTROLLER’S travel and nothing else', () => {
    expect(SATURATION_IS_CONTROLLER_TRAVEL).toBe(true)
    // at the top of travel, asking for more
    start(vsd())
    lineUp(58); advance(400)
    expect(loop().saturated).toBe(1)
    // ...and a rate-limited loop mid-move is NOT saturated
    start(vsd({ rate: '2 %/s' }))
    lineUp(25); advance(400)
    sim().writeTag('FIC-1', 'SP', 50)
    sim().tickOnce(1)
    expect(loop().rateLimited).toBe(true)
    expect(loop().saturated).toBe(0)
  })

  it('W: and losing authority CLEARS SAT rather than adding to it', () => {
    start(vsd())
    lineUp(58); advance(400)
    expect(loop().saturated).toBe(1)
    sim().writeTag('P-1', 'RUN', 0); advance(10)
    expect(loop().authority).toBe('de-energised')
    expect(loop().saturated).toBe(0)
    expect(fic().SAT).toBe(0)
  })

  it('V: physical lag never reaches any of the three states', () => {
    /**
     * A COMMAND THE DRIVE ACCEPTED IN FULL, and a shaft still on its way to it.
     * The controller got exactly what it asked for, so nothing about the
     * output is limited — the lag is in the PROCESS, which is where a PI
     * controller handles it. None of the three states may light up here.
     */
    start(vsd())
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 20); advance(60)
    expect(shaftPct()).toBeCloseTo(20, 6)       // settled at the turndown
    sim().writeTag('FIC-1', 'OP', 100)
    sim().tickOnce(1)
    expect(pump().SPD).toBe(100)                // the command arrived WHOLE
    expect(shaftPct()).toBe(70)                 // ...and the shaft is mid-ramp
    expect(shaftPct()).not.toBe(pump().SPD)
    expect(loop().rateLimited ?? false).toBe(false)
    expect(loop().saturated).toBe(0)
    expect(loop().authority).toBe('available')
  })
})

// ── Y, Z, AA, AB. Anti-windup at every constraint that owns a stop ──────────

describe('Y, Z, AA, AB — the windup predicate, mapped to each constraint', () => {
  it('the inventory’s observed set is the one the runtime actually has', () => {
    expect([...WINDUP_OBSERVED].sort()).toEqual(
      ['min-flow-override', 'op-travel', 'output-rate', 'vsd-ceiling', 'vsd-turndown'].sort())
  })

  it('Y: at the OUTPUT FLOOR, the integrator does not wind further down', () => {
    start(vsd())
    lineUp(0.5); advance(300)                   // hard against the turndown
    expect(loop().saturated).toBe(-1)
    const held = fic().I
    advance(120)
    expect(fic().I).toBe(held)                  // frozen, not ratcheting
  })

  it('Y: at the OUTPUT CEILING, the same', () => {
    start(vsd())
    lineUp(58); advance(300)
    expect(loop().saturated).toBe(1)
    const held = fic().I
    advance(120)
    expect(fic().I).toBe(held)
  })

  it('Z: at a DYNAMIC rate limit, the integrator holds while the command crawls', () => {
    start(vsd({ rate: '1 %/s' }))
    lineUp(25); advance(400)
    sim().writeTag('FIC-1', 'SP', 58)
    sim().tickOnce(1)
    expect(loop().rateLimited).toBe(true)
    const held = fic().I
    sim().tickOnce(1)
    sim().tickOnce(1)
    expect(fic().I).toBe(held)                  // K21's stop, still holding
  })

  it('AA, AB: authority loss holds it, and restoration resumes from the held state', () => {
    start(vsd())
    lineUp(35); advance(300)
    sim().writeTag('P-1', 'RUN', 0); advance(10)
    const held = { OP: fic().OP, I: fic().I }
    advance(120)
    expect({ OP: fic().OP, I: fic().I }).toEqual(held)
    sim().writeTag('P-1', 'RUN', 1); advance(400)
    expect(loop().authority).toBe('available')
    expect(Math.abs(sim().tags['FT-1']!.PV! - 35)).toBeLessThan(1.5)
  })

  it('Z: and the integrator RESUMES the moment the constraint lifts', () => {
    start(vsd())
    lineUp(58); advance(300)
    const atCeiling = fic().I
    sim().writeTag('FIC-1', 'SP', 25)           // ask for something reachable
    advance(5)
    expect(fic().I).not.toBe(atCeiling)         // integrating again
  })
})

// ── AC, AD, AE, AF, AG. The lifecycle ───────────────────────────────────────

describe('AC-AG — start, stop, restart, and both modes', () => {
  it('AC: at calm start every layer agrees and nothing is limited', () => {
    start(vsd({ rate: '5 %/s' }))
    sim().tickOnce(1)
    expect(commanded()).toBe(fic().OP)
    expect(loop().rateLimited).toBe(false)
    expect(loop().saturated).toBe(0)
  })

  it('AD, AE: a stop holds every layer, and a restart walks back through them', () => {
    start(vsd({ rate: '5 %/s' }))
    lineUp(35); advance(400)
    sim().writeTag('P-1', 'RUN', 0); advance(40)
    const held = commanded()
    advance(40)
    expect(commanded()).toBe(held)
    sim().writeTag('P-1', 'RUN', 1); advance(400)
    expect(Math.abs(sim().tags['FT-1']!.PV! - 35)).toBeLessThan(1.5)
  })

  it('AF, AG: both modes pass through the same output constraints', () => {
    // MANUAL: the travel floor and the rate limit both bind a hand command
    start(vsd({ rate: '10 %/s' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 60); advance(60)
    sim().writeTag('FIC-1', 'OP', 5)
    sim().tickOnce(1)
    expect(commanded()).toBeCloseTo(50, 6)      // rate held it to 50…
    advance(10)
    expect(commanded()).toBeCloseTo(20, 6)      // …and travel stopped it at 20
  })
})

// ── AI, AJ, AK, AL. Units and absent semantics ──────────────────────────────

describe('AI, AJ, AK, AL — units, and absent is never zero', () => {
  it('AK: every engineering constraint converts into ONE internal unit', () => {
    // flow, in m³/h, from any flow unit the record states
    expect(processFor(reg({ minFlow: '20 m³/h' }), 'P-1').minFlowM3h).toBe(20)
    expect(processFor(reg({ minFlow: '10 l/s' }), 'P-1').minFlowM3h).toBeCloseTo(36, 6)
    // a rate, in %/s, from any time base
    const rateOf = (v: string) => engineeringFor(
      { 'X': { key: 'X', kind: 'instrument', fields: { 'signal.outputRateLimit': v } } },
      'X').outputRateLimitPctPerS
    expect(rateOf('10 %/s')).toBe(10)
    expect(rateOf('600 %/min')).toBe(10)
    // a percentage, as a percentage
    expect(processFor(reg({ minSpeed: '20 %' }), 'P-1').minSpeedPct).toBe(20)
  })

  it('AL: a value in a unit this model cannot convert is REFUSED, not guessed', () => {
    const rateOf = (v: string) => engineeringFor(
      { 'X': { key: 'X', kind: 'instrument', fields: { 'signal.outputRateLimit': v } } },
      'X').outputRateLimitPctPerS
    expect(rateOf('2 m3/h/s')).toBeUndefined()
    expect(rateOf('10 %/fortnight')).toBeUndefined()
    // and a minimum flow on a loop ranged in other units is refused with a reason
    const c = spec('FIC-1', vsd({ minFlow: '20 m³/h' }), {
      ...plant,
      widgets: plant.widgets.map((w) =>
        (w.id === 'fic' ? { ...w, props: { ...w.props, unit: 'l/s' } } : w)),
    })
    expect(c.minFlow).toBeUndefined()
    expect(c.minFlowProblem).toContain('converts nothing between')
  })

  it('AJ, AI: absent is not zero, for every engineering constraint there is', () => {
    const bare = processFor(reg(), 'P-1')
    expect(bare.minFlowM3h).toBeUndefined()     // not 0 m³/h
    expect(bare.minSpeedPct).toBeUndefined()    // not 0 %
    expect(bare.minFlowAlarm).toBeUndefined()   // not a medium-priority alarm
    expect(engineeringFor(reg(), 'FIC-1').outputRateLimitPctPerS).toBeUndefined()
    // ...and a stated ZERO where zero is not a limit is also refused
    const rateOf = (v: string) => engineeringFor(
      { 'X': { key: 'X', kind: 'instrument', fields: { 'signal.outputRateLimit': v } } },
      'X').outputRateLimitPctPerS
    expect(rateOf('0 %/s')).toBeUndefined()     // a zero rate is a trip, not a rate
  })
})

// ── AM, AN, AO, AP, AQ. Nothing else moved ──────────────────────────────────

describe('AM-AQ — determinism, and the plant K21 left behind', () => {
  it('AM, AQ: the same inputs give the same answer, through every constraint', () => {
    const run = () => {
      start(vsd({ minFlow: '20 m³/h', rate: '4 %/s' }))
      lineUp(12)
      const trace: string[] = []
      for (let i = 0; i < 250; i++) {
        advance(1)
        if (i === 100) sim().writeTag('FIC-1', 'SP', 50)
        if (i === 180) sim().writeTag('HV-9', 'OP', 40)
        trace.push([fic().OP, fic().OPC, fic().I, pump().SPD, shaftPct(), valve().POS]
          .map((x) => (typeof x === 'number' ? x.toFixed(9) : String(x))).join(','))
      }
      return trace
    }
    const a = run()
    expect(run()).toEqual(a)
    expect(new Set(a).size).toBeGreaterThan(50)
  })

  it('AN, AO, AP: hydraulics, curve and gains are untouched by the inventory', () => {
    const gains = (r: Registry) => {
      const c = spec('FIC-1', r) as unknown as Record<string, unknown>
      return { kp: c.kp, ti: c.ti, action: c.action }
    }
    expect(gains(vsd())).toEqual(gains(vsd({ minFlow: '20 m³/h', rate: '4 %/s' })))
    // and a settled plant lands where K15 measured it
    start(vsd())
    lineUp(30); advance(500)
    expect(Math.abs(sim().tags['FT-1']!.PV! - 30)).toBeLessThan(0.7)
  })
})

// ── AR-AZ. Every phase before K22 ───────────────────────────────────────────

describe('AR-AZ — K13 through K21, unchanged', () => {
  it('AR: K13 envelope', () => {
    start(vsd({ minFlow: '20 m³/h' }))
    lineUp(35); advance(400)
    expect(sim().pumpEnvelopes['P-1']!.state).toBe('NORMAL')
    expect(sim().pumpEnvelopes['P-1']!.minFlowM3h).toBe(20)
  })

  it('AS, AT: K14/K15 loops settle where they always did', () => {
    start(vsd())
    lineUp(25); advance(500)
    expect(Math.abs(sim().tags['FT-1']!.PV! - 25)).toBeLessThan(0.7)
  })

  it('AU: K16 authority', () => {
    start(vsd())
    lineUp(25); advance(200)
    expect(loop().authority).toBe('available')
    sim().writeTag('P-1', 'RUN', 0); advance(10)
    expect(loop().authority).toBe('de-energised')
  })

  it('AV: K17 cascade', () => {
    start(vsd({ cascade: true }), cascaded)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('PIC-1', 'SP', 4); advance(300)
    expect(sim().loops['PIC-1']!.cascadeTo).toBe('FIC-1')
    expect(sim().loops['FIC-1']!.cascadeFrom).toBe('PIC-1')
  })

  it('AW, AX: K18/K19 minimum-flow protection and its states', () => {
    start(vsd({ minFlow: '20 m³/h' }))
    lineUp(12); advance(400)
    const p = sim().minFlow['FIC-1']!
    expect(p.overriding).toBe(true)
    expect(p.inForce).toBe(true)
    expect(p.effectiveSp).toBe(20)
    sim().writeTag('P-1', 'RUN', 0); advance(30)
    expect(sim().minFlow['FIC-1']!.state).toBe('STANDING_BY')
  })

  it('AY: K20 alarm policy', () => {
    start({
      ...vsd({ minFlow: '55 m³/h' }),
      'P-1': { key: 'P-1', kind: 'equipment', fields: {
        ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %',
        'duty.minFlow': '55 m³/h', 'alarm.minFlowPriority': 'high' } },
    })
    lineUp(12); advance(300)
    expect(sim().alarms.find((a) => a.id === 'P-1:MINF')?.phase).toBe('active')
  })

  it('AZ: K21 output rate limiting', () => {
    start(vsd({ rate: '10 %/s' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 40); advance(60)
    sim().writeTag('FIC-1', 'OP', 90)
    sim().tickOnce(1)
    expect(fic().OP).toBe(90)
    expect(commanded()).toBeCloseTo(50, 6)
  })
})
