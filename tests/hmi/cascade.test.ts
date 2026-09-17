// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K17 — ONE REAL CASCADE.
 *
 *     PIC-1 (pressure) → FIC-1.SP → FIC-1 (flow) → P-101.SPD → shaft
 *       → pump curve → hydraulic solve → PT/FT → next tick
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────
 *
 * The master does not touch the drive. Ever. `PIC-1 → P-101.SPD` is not
 * prevented by a check; it is impossible by construction, because
 * `wirePumps` and `wireFlowPumps` skip any controller whose record declares a
 * cascade, so a master's output has nowhere to go but the slave's setpoint.
 *
 * ── DECLARED, NEVER INFERRED ──────────────────────────────────────────────
 *
 * `signal.cascadeTo` on the master's record and nothing else. Two loops that
 * happen to measure the same plant and reach the same machine are a CONTENTION
 * — which K15 already refuses and reports — and not a hierarchy to guess at.
 * The very fixture below proves it: remove the declaration and the two loops
 * fight over P-101 and K15 unwires both.
 *
 * ── A REFUSED CASCADE DRIVES NOTHING ──────────────────────────────────────
 *
 * A declaration that cannot be honoured leaves the master with no output at
 * all. It deliberately does not fall back to the drive: the fallback IS the
 * shortcut this phase replaces, and it would put two writers on one machine.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { loopFindings } from '../../src/hmi/sim/authority'
import { cascadeInvalid } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

// ── The fixture the master's gains were measured against ────────────────────

/**
 * BL-S ─ P-101 ─ HV-9 ─ BL-D, with PT-1 and FT-1 both on the machine's own
 * discharge line: the pressure the machine makes, and the flow it is passing.
 */
const plant: HmiScreen = {
  id: 'k17', name: 'K17', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
    { id: 'ft', type: 'display', x: 900, y: 160, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 220, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const without = (...ids: string[]): HmiScreen =>
  ({ ...plant, widgets: plant.widgets.filter((w) => !ids.includes(w.id)) })

const SLAVE_MIN = 0
const SLAVE_MAX = 60
const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const reg = (master: Record<string, string> = { 'signal.cascadeTo': 'FIC-1' },
             slave: Record<string, string> = {}): Registry => ({
  'P-101': { key: 'P-101', kind: 'equipment',
    fields: { ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(Object.keys(master).length > 0
    ? { 'PIC-1': { key: 'PIC-1', kind: 'instrument' as const, fields: master } } : {}),
  ...(Object.keys(slave).length > 0
    ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: slave } } : {}),
})
/** ...and the same plant whose machine declares no drive. */
const fixedSpeed = (): Registry =>
  ({ ...reg(), 'P-101': { key: 'P-101', kind: 'equipment', fields: duty } })

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg(), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const master = () => sim().tags['PIC-1']!
const slave = () => sim().tags['FIC-1']!
const pump = () => sim().tags['P-101']!
const pt = () => sim().tags['PT-1']!.PV!
const lineUp = (sp?: number) => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-101', 'RUN', 1)
  if (sp !== undefined) sim().writeTag('PIC-1', 'SP', sp)
}
const docOf = (r: Registry, screen: HmiScreen = plant): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [screen], registry: r })
const ctl = (tag: string, screen: HmiScreen = plant, r: Registry = reg()) =>
  buildSimModel(screen, r).controllers.find((c) => c.tag === tag)
/** The transmitter's mean over a window: one noisy sample cannot say where a
 *  loop settled. Same helper K14 and K15 use. */
const settledAt = (seconds = 30): number => {
  const xs: number[] = []
  for (let i = 0; i < seconds; i++) { advance(1); xs.push(pt()) }
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
/** 0.8 % of a 10 bar span, with room for the peak-to-peak. */
const NOISE_BAND = 0.15

beforeEach(() => { start() })

// ── A, B, C, AG. The link, and who writes the drive ─────────────────────────

describe('A, B, C — the declaration, the link, and exactly one writer', () => {
  it('A, B: the master is wired to the SLAVE, and the slave to the drive', () => {
    expect(ctl('PIC-1')).toMatchObject({
      pvTag: 'PT-1', outTag: 'FIC-1', outKind: 'cascade', cascadeTo: 'FIC-1',
    })
    expect(ctl('FIC-1')).toMatchObject({
      pvTag: 'FT-1', outTag: 'P-101', outKind: 'pump', cascadeFrom: 'PIC-1',
      outMin: 20, outMax: 100,
    })
    expect(ctl('PIC-1')!.cascadeProblem).toBeUndefined()
  })

  it('C, AG: the master has NO path to the drive at all', () => {
    const m = buildSimModel(plant, reg())
    const writers = m.controllers.filter((c) => c.outTag === 'P-101')
    expect(writers.map((c) => c.tag)).toEqual(['FIC-1'])
    expect(m.controllers.find((c) => c.tag === 'PIC-1')!.outTag).not.toBe('P-101')
  })

  it('AG: and an operator moving the master in MANUAL reaches the drive only via the slave', () => {
    lineUp(3); advance(400)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 70)
    sim().tickOnce(1)
    // the master's number became a SETPOINT, in the slave's units
    expect(slave().SP).toBeCloseTo(SLAVE_MIN + 0.70 * (SLAVE_MAX - SLAVE_MIN), 6)
    // the drive took the SLAVE's output, which is its own number entirely
    expect(pump().SPD).toBe(slave().OP)
    expect(pump().SPD).not.toBe(70)
  })

  it('the SAME plant without the declaration is a CONTENTION, not a cascade', () => {
    // K15's rule, unchanged: two loops reaching one machine, neither wired
    const m = buildSimModel(plant, reg({}))
    expect(m.controllers.find((c) => c.tag === 'PIC-1')!.outTag).toBeUndefined()
    expect(m.controllers.find((c) => c.tag === 'FIC-1')!.outTag).toBeUndefined()
  })
})

// ── D–I. Everything a declaration can get wrong ─────────────────────────────

describe('D, E, F, G, H, I — a cascade that cannot be built is refused', () => {
  const refused = (r: Registry, screen: HmiScreen = plant) => {
    const c = buildSimModel(screen, r).controllers.find((x) => x.tag === 'PIC-1')!
    expect(c.outTag, 'a refused master drives NOTHING').toBeUndefined()
    expect(c.cascadeProblem).toBeDefined()
    return c.cascadeProblem!
  }

  it('D, E: a slave that is not on the plant, or is not a loop', () => {
    expect(refused(reg({ 'signal.cascadeTo': 'FIC-9' }))).toContain('not on this plant')
    expect(refused(reg({ 'signal.cascadeTo': 'FT-1' }))).toContain('is not a control loop')
  })

  it('F: a slave with no measurement to control', () => {
    // FIC-1 with no FT-1 in its family is never given a PV, so never a spec
    expect(refused(reg(), without('ft'))).toMatch(/not a control loop|no measurement/)
  })

  it('G: a slave that drives nothing', () => {
    // no machine on the plant for the slave to command
    expect(refused(reg(), without('p'))).toMatch(/drives nothing|no measurement/)
  })

  it('H: a slave whose final element is NOT a variable speed drive', () => {
    // the machine is there and its record declares no drive, so K15 refuses it
    // and the cascade has nothing to sit on top of
    expect(refused(fixedSpeed())).toContain('drives nothing')
  })

  it('I: a cycle, including the degenerate one', () => {
    expect(refused(reg({ 'signal.cascadeTo': 'PIC-1' }))).toContain('names itself')
    const both = reg({ 'signal.cascadeTo': 'FIC-1' }, { 'signal.cascadeTo': 'PIC-1' })
    const m = buildSimModel(plant, both)
    const problems = m.controllers.filter((c) => c.cascadeProblem !== undefined)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.some((c) => c.cascadeProblem!.includes('is a loop'))).toBe(true)
    // and NOBODY ends up driving the machine off the back of a refused cascade
    expect(m.controllers.filter((c) => c.outTag === 'P-101')).toHaveLength(0)
  })

  it('a refused cascade is a CONFIGURATION finding, and says it drives nothing', () => {
    const out = cascadeInvalid.run(buildIndex(docOf(reg({ 'signal.cascadeTo': 'FIC-9' }))))
    expect(out).toHaveLength(1)
    expect(out[0]!.entityKey).toBe('PIC-1')
    expect(out[0]!.message).toContain('FIC-9')
    expect(out[0]!.message).toContain('drives nothing')
    expect(out[0]!.message).toContain('NOT quietly connected to the drive')
    // a healthy one says nothing at all
    expect(cascadeInvalid.run(buildIndex(docOf(reg())))).toEqual([])
  })
})

// ── J, K, L, M. The four mode combinations ──────────────────────────────────

describe('J, K, L, M — master and slave, in every combination', () => {
  it('J: MASTER AUTO + SLAVE AUTO regulates the pressure through the flow loop', () => {
    lineUp(3); advance(600)
    expect(master().MODE).toBe(1)
    expect(slave().MODE).toBe(1)
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
    // ...and every link carries a real number
    expect(master().OP!).toBeGreaterThan(0)
    expect(slave().SP!).toBeGreaterThan(0)
    expect(pump().SPD!).toBeGreaterThan(20)
    expect(pump().RAMP!).toBeGreaterThan(0.2)
  })

  it('K: MASTER MANUAL + SLAVE AUTO — the operator sets the flow demand', () => {
    lineUp(3); advance(400)
    sim().writeTag('PIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 50)
    advance(200)
    expect(slave().SP).toBeCloseTo(30, 6)          // 50 % of the slave's 0-60
    // the slave went and got it
    expect(sim().tags['FT-1']!.PV!).toBeCloseTo(30, 0)
    expect(sim().loops['FIC-1']!.authority).toBe('available')
  })

  it('L: MASTER AUTO + SLAVE MANUAL — the slave drives, the master holds', () => {
    lineUp(3); advance(600)
    const held = { op: master().OP!, i: master().I! }
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 45)
    advance(300)
    // the SLAVE's operator output is what reaches the drive
    expect(pump().SPD).toBe(45)
    // and the master has not wound up against a slave that is not listening
    expect(sim().loops['PIC-1']!.authority).toBe('downstream')
    expect(master().OP).toBe(held.op)
    expect(master().I).toBe(held.i)
    // it is explicitly NOT reset
    expect(master().I).not.toBe(0)
  })

  it('M: BOTH MANUAL — each operator number goes exactly where it should', () => {
    lineUp(3); advance(400)
    sim().writeTag('PIC-1', 'MODE', 0); sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('PIC-1', 'OP', 40); sim().writeTag('FIC-1', 'OP', 55)
    advance(60)
    expect(slave().SP).toBeCloseTo(24, 6)          // the master's 40 %, in m³/h
    expect(pump().SPD).toBe(55)                    // the slave's own number
    expect(master().OP).toBe(40)
  })
})

// ── N, O. Transfer ──────────────────────────────────────────────────────────

describe('N, O — putting the cascade in and taking it out', () => {
  it('O: taking the slave to MANUAL changes nothing about the plant on that tick', () => {
    lineUp(3); advance(600)
    const before = { spd: pump().SPD!, op: slave().OP!, i: slave().I! }
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().tickOnce(1)
    // THE PLANT does not move: the output is passed straight through and the
    // drive is given the same number it already had.
    expect(slave().OP).toBe(before.op)
    expect(pump().SPD).toBe(before.spd)
    // The integrator is a different matter, and it is SUPPOSED to move: K14's
    // MANUAL branch re-tracks it to `OP − kp·e` every tick so that returning
    // to AUTO resumes from the operator's number. Tracking, not resetting.
    expect(slave().I).not.toBe(0)
    expect(Math.abs(slave().I! - before.i)).toBeLessThan(2)
  })

  it('N: and putting it back is bumpless, because the SP was never abandoned', () => {
    lineUp(3); advance(600)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 45); advance(120)
    const from = pump().SPD!
    // the master went on writing the setpoint the whole time, so the slave
    // comes back to a demand it has been tracking rather than a stale one
    const sp = slave().SP!
    sim().writeTag('FIC-1', 'MODE', 1)
    sim().tickOnce(1)
    // the setpoint moves by the master's PROPORTIONAL term as it takes control
    // again — a few m³/h on a 60 m³/h range, not a jump to an end of it
    expect(Math.abs(slave().SP! - sp)).toBeLessThan(6)
    expect(Math.abs(pump().SPD! - from)).toBeLessThan(15)
    advance(600)
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
  })

  it('and the master resumes from the output it held', () => {
    lineUp(3); advance(600)
    const held = master().I!
    sim().writeTag('FIC-1', 'MODE', 0); advance(600)
    expect(master().I).toBe(held)
    sim().writeTag('FIC-1', 'MODE', 1)
    sim().tickOnce(1)
    expect(Math.abs(master().I! - held)).toBeLessThan(5)
  })
})

// ── P–V. Authority through the chain ────────────────────────────────────────

describe('P, Q, R, S, T, U, V — K16 authority, through a cascade', () => {
  it('P: both ends have authority on a healthy plant', () => {
    lineUp(3); advance(400)
    expect(sim().loops['PIC-1']!.authority).toBe('available')
    expect(sim().loops['FIC-1']!.authority).toBe('available')
    expect(loopFindings(sim().loops)).toEqual([])
  })

  it('Q, U, V: a stopped machine holds BOTH, and neither is reset', () => {
    lineUp(3); advance(600)
    const held = {
      mOp: master().OP!, mI: master().I!, sOp: slave().OP!, sI: slave().I!,
    }
    sim().writeTag('P-101', 'RUN', 0)
    advance(1800)
    expect(sim().loops['FIC-1']!.authority).toBe('de-energised')
    expect(sim().loops['PIC-1']!.authority).toBe('downstream')
    // V: the slave holds — K16, unchanged
    expect(slave().OP).toBe(held.sOp)
    expect(slave().I).toBe(held.sI)
    // U: and the master does NOT go on demanding more of a slave that cannot act
    expect(master().OP).toBe(held.mOp)
    expect(master().I).toBe(held.mI)
  })

  it('R: a tripped machine is the same', () => {
    lineUp(3); advance(400)
    sim().writeTag('P-101', 'FAULT', 1)
    advance(10)
    expect(sim().loops['FIC-1']!.authority).toBe('de-energised')
    expect(sim().loops['PIC-1']!.authority).toBe('downstream')
  })

  it('S: a solve the slave cannot stand behind stops the chain too', () => {
    const starved: Registry = { ...reg(),
      'P-101': { key: 'P-101', kind: 'equipment', fields: {
        'duty.capacity': '200 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
      'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '0.05 bara' } } }
    start(starved)
    // a pressure setpoint this plant cannot reach, so the cascade asks the
    // machine for everything and it genuinely outruns its own suction
    lineUp(6)
    advance(20)
    const seen: { converged: boolean; authority: string }[] = []
    for (let i = 0; i < 40; i++) {
      advance(1)
      seen.push({ converged: sim().hydraulic.converged, authority: sim().loops['FIC-1']!.authority })
    }
    expect(seen.some((x) => !x.converged), 'the fixture defeats the solver').toBe(true)
    expect(seen.some((x) => x.authority === 'unsolved')).toBe(true)
    // one tick after the failure, as K16 established
    for (let i = 1; i < seen.length; i++) {
      if (seen[i]!.authority === 'unsolved') expect(seen[i - 1]!.converged, `tick ${i}`).toBe(false)
    }
  })

  it('T: and the whole chain comes back when the machine does', () => {
    lineUp(3); advance(600)
    const wanted = master().I!
    sim().writeTag('P-101', 'RUN', 0); advance(900)
    sim().writeTag('P-101', 'RUN', 1)
    sim().tickOnce(1)
    expect(sim().loops['FIC-1']!.authority).toBe('available')
    // the MASTER learns of it on the NEXT tick: it runs first, so the slave's
    // verdict it reads is the one from a moment ago. The same one-tick
    // relationship every other input to a controller has.
    expect(sim().loops['PIC-1']!.authority).toBe('downstream')
    sim().tickOnce(1)
    expect(sim().loops['PIC-1']!.authority).toBe('available')
    // no half-hour of accumulated demand waiting for it
    expect(Math.abs(master().I! - wanted)).toBeLessThan(5)
    advance(600)
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
  })

  it('the unavailable slave is reported as RUNTIME, not as a bad record', () => {
    lineUp(3); advance(400)
    sim().writeTag('P-101', 'RUN', 0); advance(10)
    const f = loopFindings(sim().loops)
    const pic = f.find((x) => x.tag === 'PIC-1')!
    expect(pic.severity).toBe('info')            // a stopped pump is normal
    expect(pic.message).toContain('FIC-1')
    expect(pic.message).toContain('not following it')
    // and the CONFIGURATION is fine: nothing is wrong with the records
    expect(cascadeInvalid.run(buildIndex(docOf(reg())))).toEqual([])
  })
})

// ── W, X, Y. Requested against actual, at both levels ───────────────────────

describe('W, X, Y — what was asked for, and what was carried', () => {
  it('W: the slave reports its output against the SHAFT, not against itself', () => {
    lineUp(3); advance(600)
    const l = sim().loops['FIC-1']!
    expect(l.requested).toBe(slave().OP)
    expect(l.actual).toBeCloseTo((pump().RAMP ?? 0) * 100, 9)
    sim().writeTag('P-101', 'RUN', 0); advance(6)
    expect(sim().loops['FIC-1']!.actual).toBe(0)   // commanded somewhere, turning nowhere
    expect(sim().loops['FIC-1']!.tracking).toBe(true)
  })

  it('X: the master reports the setpoint it COMMANDED against the EFFECTIVE one', () => {
    lineUp(3); advance(600)
    const l = sim().loops['PIC-1']!
    expect(l.commandedSp).toBeCloseTo(
      SLAVE_MIN + (master().OP! / 100) * (SLAVE_MAX - SLAVE_MIN), 6)
    expect(l.effectiveSp).toBe(slave().SP)
    expect(l.commandedSp).toBeCloseTo(l.effectiveSp!, 6)   // the link is working
    expect(l.cascadeTo).toBe('FIC-1')
    expect(sim().loops['FIC-1']!.cascadeFrom).toBe('PIC-1')
  })

  it('Y: a master at the end of its slave\'s CONFIGURED range says so', () => {
    lineUp(9); advance(600)                        // more pressure than the plant makes
    expect(master().SAT).toBe(1)
    expect(sim().loops['PIC-1']!.commandedSp).toBeCloseTo(SLAVE_MAX, 6)
    const f = loopFindings(sim().loops).find((x) => x.id.startsWith('cascade-setpoint-limited'))!
    expect(f.tag).toBe('PIC-1')
    expect(f.severity).toBe('info')
    expect(f.message).toContain('60.0')
    expect(f.message).toContain('invents a wider one')
    // the machine is genuinely at its stop, and no flow was manufactured
    expect(pump().RAMP).toBeCloseTo(1, 6)
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(SLAVE_MAX)
  })

  it('and the slave reports ITS own saturation separately', () => {
    lineUp(9); advance(600)
    expect(slave().SAT).toBe(1)                    // asked for 60, can make 43
    expect(sim().loops['FIC-1']!.saturated).toBe(1)
  })
})

// ── Z, AA, AB. Causality ────────────────────────────────────────────────────

describe('Z, AA, AB — the whole chain moves, and nothing short-circuits it', () => {
  it('Z: a pressure setpoint step propagates through every link', () => {
    lineUp(2.5); advance(600)
    const before = {
      mOp: master().OP!, sp: slave().SP!, sOp: slave().OP!,
      spd: pump().SPD!, ramp: pump().RAMP!, head: sim().pumpEnvelopes['P-101']!.riseBar!,
      q: sim().pumpEnvelopes['P-101']!.flowM3h!, ft: sim().tags['FT-1']!.PV!, pt: pt(),
    }
    sim().writeTag('PIC-1', 'SP', 3.2)
    advance(600)

    expect(master().OP!, 'master output').toBeGreaterThan(before.mOp)
    expect(slave().SP!, 'slave setpoint').toBeGreaterThan(before.sp)
    expect(slave().OP!, 'slave output').toBeGreaterThan(before.sOp)
    expect(pump().SPD!, 'speed command').toBeGreaterThan(before.spd)
    expect(pump().RAMP!, 'shaft').toBeGreaterThan(before.ramp)
    expect(sim().pumpEnvelopes['P-101']!.riseBar!, 'pump head').toBeGreaterThan(before.head)
    expect(sim().pumpEnvelopes['P-101']!.flowM3h!, 'solved flow').toBeGreaterThan(before.q)
    expect(sim().tags['FT-1']!.PV!, 'FT').toBeGreaterThan(before.ft)
    expect(pt(), 'PT').toBeGreaterThan(before.pt)
    expect(Math.abs(settledAt() - 3.2)).toBeLessThan(NOISE_BAND)
  })

  it('Z: and the slave is reading its own transmitter, one tick behind', () => {
    lineUp(3); advance(400)
    const ft = sim().tags['FT-1']!.PV!
    sim().tickOnce(1)
    expect(slave().PV).toBe(ft)
    expect(slave().PV).not.toBe(sim().tags['FT-1']!.PV)
  })

  it('AA: a pressure-zone disturbance is rejected through both loops', () => {
    lineUp(3); advance(600)
    const op = master().OP!
    sim().applyScenario({ id: 's', name: 'BL-D up', overrides: [
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '1.6 barg' }] })
    sim().tickOnce(1); advance(3)
    expect(pt(), 'genuinely disturbed').toBeGreaterThan(3 + NOISE_BAND)
    advance(700)
    expect(master().OP!).toBeLessThan(op)          // asked the slave for less flow
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
  })

  it('AB: a flow disturbance is caught by the SLAVE first', () => {
    lineUp(3); advance(600)
    const sOp = slave().OP!
    const ft0 = sim().tags['FT-1']!.PV!
    const mOp = master().OP!
    sim().writeTag('HV-9', 'OP', 45)

    sim().tickOnce(1)
    expect(sim().tags['FT-1']!.PV!, 'genuinely disturbed').toBeLessThan(ft0 - 1)

    /**
     * THE SLAVE MOVES FIRST, and that is the whole point of a cascade. It sees
     * its own flow fall and opens the machine up to defend its setpoint within
     * a couple of seconds, long before the master has formed an opinion.
     */
    advance(3)
    expect(slave().OP!, 'the inner loop defended its setpoint').toBeGreaterThan(sOp)

    /**
     * THEN THE MASTER CHANGES THE DEMAND — downwards, which is not a bug. A
     * valve closing RAISES the discharge pressure, and pressure is what the
     * master controls, so the right answer is to ask the slave for LESS flow.
     * The inner loop's quick defence and the outer loop's considered answer
     * pull in opposite directions here, and the outer one wins, as it should.
     */
    advance(400)
    expect(master().OP!, 'the outer loop asked for less flow').toBeLessThan(mOp)
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(ft0)
    expect(Math.abs(sim().tags['FT-1']!.PV! - slave().SP!), 'the slave holds it')
      .toBeLessThan(2)
    advance(300)
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
  })
})

// ── AC, AD, AE, AF, AH. Determinism and regression ──────────────────────────

describe('AC, AD, AE, AF, AH — repeatable, and everything older unchanged', () => {
  it('AC: the same run twice, every number and every state', () => {
    const run = () => {
      start()
      lineUp(2.6)
      const trace: string[] = []
      for (let i = 0; i < 40; i++) {
        advance(20)
        if (i === 12) sim().writeTag('PIC-1', 'SP', 3.2)
        if (i === 24) sim().writeTag('P-101', 'RUN', 0)
        if (i === 32) sim().writeTag('P-101', 'RUN', 1)
        const m = sim().loops['PIC-1']!, s = sim().loops['FIC-1']!
        trace.push([master().SP, master().PV, master().OP, master().I,
          slave().SP, slave().PV, slave().OP, slave().I,
          pump().SPD, pump().RAMP, sim().pumpEnvelopes['P-101']!.riseBar,
          m.commandedSp, m.effectiveSp]
          .map((v) => (v ?? 0).toFixed(9)).join('|')
          + `|${m.authority}|${s.authority}|${m.mode}|${s.mode}`)
      }
      return trace
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
    expect(new Set(a.map((x) => x.split('|')[13])).size, 'authority actually moved')
      .toBeGreaterThan(1)
  })

  it('AH: there is one clock — sub-stepping changes nothing but the step', () => {
    // the same process time at 1 s and at 0.2 s arrives at the same place
    start(); lineUp(3); advance(600, 1)
    const coarse = settledAt(60)
    start(); lineUp(3); advance(600, 0.2)
    const fine = settledAt(60)
    expect(Math.abs(coarse - fine)).toBeLessThan(NOISE_BAND)
  })

  it('AD: K14 pressure → VSD still works where there is no cascade', () => {
    // the flow loop removed: PIC-1 is K14's loop again, with no declaration
    const only = without('ft', 'fic')
    const m = buildSimModel(only, reg({}))
    expect(m.controllers.find((c) => c.tag === 'PIC-1')).toMatchObject(
      { outTag: 'P-101', outKind: 'pump', outMin: 20, outMax: 100 })
    start(reg({}), only)
    lineUp(3); advance(400)
    expect(Math.abs(settledAt() - 3)).toBeLessThan(NOISE_BAND)
    expect(pump().SPD).toBe(master().OP)
  })

  it('AE: K15 flow → VSD still works where there is no cascade', () => {
    const only = without('pt', 'pic')
    const m = buildSimModel(only, reg({}))
    expect(m.controllers.find((c) => c.tag === 'FIC-1')).toMatchObject(
      { outTag: 'P-101', outKind: 'pump' })
    start(reg({}), only)
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 25)
    advance(400)
    const xs: number[] = []
    for (let i = 0; i < 30; i++) { advance(1); xs.push(sim().tags['FT-1']!.PV!) }
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - 25)).toBeLessThan(0.7)
  })

  it('AF: K16 authority is unchanged for a loop with no cascade', () => {
    const only = without('ft', 'fic')
    start(reg({}), only)
    lineUp(3); advance(400)
    expect(sim().loops['PIC-1']!.authority).toBe('available')
    const held = { op: master().OP!, i: master().I! }
    sim().writeTag('P-101', 'RUN', 0); advance(1800)
    expect(sim().loops['PIC-1']!.authority).toBe('de-energised')
    expect(master().OP).toBe(held.op)
    expect(master().I).toBe(held.i)
  })

  it('a legacy fixed-speed machine is untouched by any of it', () => {
    start(fixedSpeed())
    lineUp(); advance(60)
    expect(pump().SPD).toBeUndefined()
    expect(pump().RAMP).toBeCloseTo(1, 6)
  })

  it('and the engineering record is untouched by a whole cascade run', () => {
    const r = reg()
    const before = JSON.stringify(r)
    start(r)
    lineUp(3); advance(400)
    sim().writeTag('PIC-1', 'SP', 2.6); advance(200)
    sim().writeTag('FIC-1', 'MODE', 0); advance(100)
    expect(JSON.stringify(r)).toBe(before)
  })
})
