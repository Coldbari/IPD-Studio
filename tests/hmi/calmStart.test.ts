// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K15 — A CONTROLLER THAT COMES UP ASKING FOR NOTHING.
 *
 * K14 closed by naming the defect it had just made dangerous: every controller
 * came up at `SP: 50`, the middle of the 0-100 span every tag once inherited.
 * On a 0-10 bar loop that asks for five times full scale, and a K14 speed loop
 * obeys it — slamming a machine to 100 % and sitting there, because a plant
 * was told to by a number nobody chose.
 *
 * Fifty was never engineering data. What IS engineering data is
 * `signal.setpoint`, which the record has carried since the datasheet work and
 * which `engineeringFor` has always read — and which was DROPPED at the
 * boundary into the runtime. That is the whole defect: the distinction between
 * a configured setpoint and a defaulted one existed in the model and did not
 * survive the crossing.
 *
 * ── PRECEDENCE, and it is the existing architecture's ─────────────────────
 *
 *  1. A RUNTIME WRITE — operator, or a scenario, which K8 routes through the
 *     same write path on purpose. Last write wins, as a DCS does.
 *  2. `signal.setpoint` ON THE RECORD. Never replaced by the plant's state.
 *  3. CALM START FROM THE MEASUREMENT. Error zero, output held, nothing moves
 *     until somebody asks.
 *  4. NOTHING. A loop whose PV is not bound to anything the simulation
 *     produces has no reading and no record, so its setpoint is UNAVAILABLE
 *     rather than invented, and the algorithm does not run.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel, initTags } from '../../src/hmi/sim/engine'
import { controllerSetpoint } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

/**
 * BL-S ─ P-1 ─ FV-1 ─ BL-D with PT-1 on the discharge, exactly K14's plant —
 * except the supply is at 1.8 barg, so a stopped plant sits at 2.8 bar
 * absolute and the calm-start setpoint is a number worth reading.
 */
const plant: HmiScreen = {
  id: 'k15c', name: 'K15 calm start', theme: 'classic',
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

/**
 * ...and one whose controller drives a VALVE and whose transmitter is bound to
 * nothing at all.
 *
 * A valve loop is the case that can exist: `wireControllers` pairs it by
 * family and loop without asking what the transmitter reads, where a SPEED
 * loop can only be wired from a bound pipe in the first place. So this is a
 * controller with a real final element and no measurement — which is where a
 * setpoint has neither a record nor a plant to come from.
 */
const unbound: HmiScreen = {
  ...plant,
  widgets: [
    ...plant.widgets
      .filter((w) => w.id !== 'fv')
      .map((w) => (w.id === 'pt' ? { ...w, props: { min: 0, max: 10, unit: 'bar' } } : w)),
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'PV-1', props: { throttle: true } },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' }
const reg = (picFields?: Record<string, string>): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: duty },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1.8 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1.8 barg' } },
  ...(picFields ? { 'PIC-1': { key: 'PIC-1', kind: 'instrument' as const, fields: picFields } } : {}),
})

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const pic = () => sim().tags['PIC-1']!
const pt = () => sim().tags['PT-1']!.PV!
const lineUp = () => { sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) }
const docOf = (r: Registry, screen: HmiScreen = plant): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [screen], registry: r })

beforeEach(() => { start() })

// ── A, D. Calm start ────────────────────────────────────────────────────────

describe('A — an unconfigured loop starts where the plant already is', () => {
  it('the setpoint at RUN is the measurement, not a number nobody set', () => {
    // a stopped plant fed from a 1.8 barg header sits at 2.8 bar absolute
    expect(pt()).toBeCloseTo(2.8, 1)
    expect(pic().SP).toBe(pt())
    expect(pic().SP).toBeCloseTo(2.8, 1)
    expect(pic().SP).not.toBe(50)
  })

  it('so nothing saturates, and nothing is asked to move', () => {
    expect(pic().MODE).toBe(1)                 // AUTO from the first frame
    const seeded = pic().OP!
    advance(30)
    expect(pic().SAT).toBe(0)
    // K16: with the machine stopped the loop has no authority, so its output
    // is HELD at the seed rather than driven anywhere by a plant it cannot
    // affect. Nothing has moved in thirty seconds.
    expect(pic().AUTH).toBe(0)
    expect(pic().OP).toBe(seeded)
    expect(sim().tags['P-1']!.RAMP).toBe(0)
  })

  it('and the controller reads its own measurement from the first frame too', () => {
    expect(pic().PV).toBe(pt())
    expect(pic().PV).not.toBe(0)
  })

  it('then an explicit setpoint resumes ordinary closed-loop behaviour', () => {
    lineUp(); advance(60)
    sim().writeTag('PIC-1', 'SP', 3.5)
    advance(400)
    const xs: number[] = []
    for (let i = 0; i < 20; i++) { advance(1); xs.push(pt()) }
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - 3.5)).toBeLessThan(0.12)
    expect(pic().SAT).toBe(0)
  })

  it('D: RESET puts it back, deterministically', () => {
    lineUp(); sim().writeTag('PIC-1', 'SP', 3.5); advance(200)
    expect(pic().SP).toBe(3.5)
    const first = { sp: 0, pv: 0 }
    sim().reset()
    first.sp = pic().SP!; first.pv = pic().PV!
    expect(first.sp).toBeCloseTo(2.8, 1)
    // ...and again, to the bit
    lineUp(); advance(50)
    sim().reset()
    expect(pic().SP).toBe(first.sp)
    expect(pic().PV).toBe(first.pv)
    expect(pic().OP).toBe(100)     // the drive's rest command, as K14 left it
    expect(pic().SAT).toBe(0)
  })
})

// ── B. An explicit setpoint is never overwritten ────────────────────────────

describe('B — a configured setpoint survives RUN and RESET', () => {
  it('`signal.setpoint` is read, and the plant\'s state does not replace it', () => {
    start(reg({ 'signal.setpoint': '3.5' }))
    expect(sim().defs['PIC-1']!.setpoint).toBe(3.5)
    expect(pic().SP).toBe(3.5)
    expect(pt()).toBeCloseTo(2.8, 1)          // and the plant is NOT at 3.5
    expect(pic().SP).not.toBe(pt())
  })

  it('RESET restores the RECORD\'s setpoint, not the operator\'s last one', () => {
    start(reg({ 'signal.setpoint': '3.5' }))
    sim().writeTag('PIC-1', 'SP', 2.9)
    expect(pic().SP).toBe(2.9)                 // a runtime write wins while it lasts
    sim().reset()
    expect(pic().SP).toBe(3.5)                 // and the record wins the restart
  })

  it('and the loop goes and holds it', () => {
    start(reg({ 'signal.setpoint': '3.5' }))
    lineUp(); advance(400)
    const xs: number[] = []
    for (let i = 0; i < 20; i++) { advance(1); xs.push(pt()) }
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - 3.5)).toBeLessThan(0.12)
  })

  it('a setpoint of ZERO is a setpoint, not an absence', () => {
    start(reg({ 'signal.setpoint': '0' }))
    expect(sim().defs['PIC-1']!.setpoint).toBe(0)
    expect(pic().SP).toBe(0)                   // NOT calm-started to 2.8
  })
})

// ── C. An impossible setpoint is still honoured ─────────────────────────────

describe('C — the operator may still ask for the impossible', () => {
  it('a stated setpoint far off scale is used as stated and saturates', () => {
    start(reg({ 'signal.setpoint': '50' }))
    expect(pic().SP).toBe(50)                  // NOT clamped to the 0-10 range
    lineUp(); advance(200)
    expect(pic().OP).toBe(100)
    expect(pic().SAT).toBe(1)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
    // the machine is at its stop and the plant makes what it makes — no
    // pressure was manufactured to meet the request
    expect(pt()).toBeLessThan(10)
    expect(Math.abs(pic().I!)).toBeLessThanOrEqual(100)
  })

  it('and it is reported rather than corrected', () => {
    const out = controllerSetpoint.run(buildIndex(docOf(reg({ 'signal.setpoint': '50' }))))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('outside its 0-10 range')
    expect(out[0]!.message).toContain('nothing here changes it')
    // a sane one says nothing
    expect(controllerSetpoint.run(buildIndex(docOf(reg({ 'signal.setpoint': '3.5' }))))).toEqual([])
  })

  it('an operator asking for the impossible at runtime saturates the same way', () => {
    lineUp(); advance(60)
    sim().writeTag('PIC-1', 'SP', 9)
    advance(300)
    expect(pic().SAT).toBe(1)
    expect(pic().OP).toBe(100)
    const wound = pic().I!
    advance(600)
    expect(pic().I!).toBeCloseTo(wound, 6)     // anti-windup still holds it
  })
})

// ── Precedence step 4 — nothing to start from ───────────────────────────────

describe('a loop with no measurement has no setpoint, and says so', () => {
  it('SP is UNAVAILABLE rather than invented', () => {
    start(reg(), unbound)
    expect(pic().SP).toBeUndefined()
    expect(sim().tags['PIC-1']!.SP).toBeUndefined()
  })

  it('and the algorithm does not run on one — the element is held', () => {
    start(reg(), unbound)
    expect(sim().controllers.find((c) => c.tag === 'PIC-1')!.outTag).toBe('PV-1')
    sim().writeTag('P-1', 'RUN', 1)
    const op = pic().OP!
    advance(300)
    expect(pic().OP).toBe(op)                  // held, not driven
    expect(pic().SAT).toBe(0)
    expect(sim().tags['PV-1']!.OP).toBe(op)    // and passed straight through
  })

  it('a configured setpoint still reaches it, measurement or no measurement', () => {
    start(reg({ 'signal.setpoint': '3.5' }), unbound)
    expect(pic().SP).toBe(3.5)
  })

  it('and the gap is reported', () => {
    const out = controllerSetpoint.run(buildIndex(docOf(reg(), unbound)))
    expect(out).toHaveLength(1)
    expect(out[0]!.entityKey).toBe('PIC-1')
    expect(out[0]!.message).toContain('no configured setpoint')
    expect(out[0]!.message).toContain('not bound')
  })
})

// ── Regression: everything that already worked ──────────────────────────────

describe('nothing that already had a setpoint changed', () => {
  it('a level loop still holds the setpoint it is given', () => {
    const screen: HmiScreen = {
      id: 'lvl', name: 'L', theme: 'classic',
      widgets: [
        { id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'LT-1', props: { level0: 40 } },
        { id: 'v', type: 'valve', x: 200, y: 0, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
        { id: 'c', type: 'display', x: 400, y: 0, w: 96, h: 40, tag: 'LIC-1', props: { controller: true } },
      ],
      pipes: [],
    }
    const m = buildSimModel(screen)
    const tags = initTags(m)
    // calm start: the loop asks for the level it finds, so error is zero
    expect(tags['LIC-1']!.SP).toBe(40)
    expect(tags['LIC-1']!.PV).toBe(40)
    expect(tags['LIC-1']!.MODE).toBe(1)
  })

  it('a fixed-speed plant is untouched by any of this', () => {
    const fixed: Registry = { ...reg(),
      'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } } }
    start(fixed)
    expect(sim().controllers.find((c) => c.tag === 'PIC-1')!.outTag).toBeUndefined()
    lineUp(); advance(60)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
    expect(sim().tags['P-1']!.SPD).toBeUndefined()
  })
})
