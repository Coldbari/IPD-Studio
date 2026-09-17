// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K18 — MINIMUM-FLOW PROTECTION.
 *
 *     PIC-1 → requested FIC SP → MIN-FLOW OVERRIDE → effective FIC SP
 *       → FIC-1 → P-1.SPD → shaft → pump curve → solve → FT → next tick
 *
 * ── THE OVERRIDE IS ONE LINE, AND THAT IS THE POINT ───────────────────────
 *
 *     effective = max(requested, duty.minFlow)
 *
 * No second controller, no integrator, no gain, no hysteresis, no deadband, no
 * rate limit and no trip. A constraint on a setpoint needs none of them, and
 * every one of them would have been a number this phase invented.
 *
 * ── A DEMAND IS NOT A RESULT ──────────────────────────────────────────────
 *
 * Raising a setpoint asks the plant for flow. It does not make any. Half the
 * tests below are about that distinction, because it is the one a protection
 * system is most tempting to lie about: a stopped machine, a dead-headed one
 * and one running backwards are all UNABLE, and none of them may ever read as
 * EFFECTIVE just because the setpoint was raised.
 *
 * ── SIGNED, AND READ FROM ONE PLACE ───────────────────────────────────────
 *
 * The verdict is taken from K13's SIGNED pump-edge flow. The FT beside it
 * reads a magnitude — an orifice plate does not know which way round it was
 * installed — and §AC exists to prove the protection is not judged on it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import {
  MIN_FLOW_SEVERITY, minFlowFindings, minFlowProtection, minFlowStateOf,
} from '../../src/hmi/sim/minflow'
import { pumpEdgeMap, pumpEnvelopes } from '../../src/hmi/sim/envelope'
import type { SolveResult } from '../../src/hmi/sim/hydraulic/solver'
import type { Scenario } from '../../src/hmi/sim/scenario'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

// ── The plants ──────────────────────────────────────────────────────────────

/** BL-S ─ P-1 ─ HV-9 ─ BL-D, with PT-1 and FT-1 on the machine's own
 *  discharge line. A hand valve, so the loop's only actuator is the drive. */
const plant: HmiScreen = {
  id: 'k18', name: 'K18', theme: 'classic',
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

/** ...and the same plant with a pressure master above the flow loop — K17's
 *  cascade, which is where the brief's canonical architecture lives. */
const cascaded: HmiScreen = {
  ...plant,
  widgets: [
    ...plant.widgets,
    { id: 'pt', type: 'display', x: 900, y: 160, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 220, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const SLAVE_MAX = 60

/**
 * `minFlow: undefined` is NOT `minFlow: 0`. Every fixture below that omits it
 * is a record that states no minimum, and the protection must do nothing at
 * all for it.
 */
const reg = (opts: {
  minFlow?: string
  vsd?: boolean
  cascade?: boolean
  slave?: Record<string, string>
} = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    ...duty,
    ...(opts.vsd === false ? {} : { 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' }),
    ...(opts.minFlow !== undefined ? { 'duty.minFlow': opts.minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(opts.cascade
    ? { 'PIC-1': { key: 'PIC-1', kind: 'instrument' as const, fields: { 'signal.cascadeTo': 'FIC-1' } } }
    : {}),
  ...(opts.slave
    ? { 'FIC-1': { key: 'FIC-1', kind: 'instrument' as const, fields: opts.slave } } : {}),
})

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (r: Registry = reg({ minFlow: '20 m³/h' }), screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, r)
}
const fic = () => sim().tags['FIC-1']!
const pic = () => sim().tags['PIC-1']!
const pump = () => sim().tags['P-1']!
const prot = () => sim().minFlow['FIC-1']
const env = () => sim().pumpEnvelopes['P-1']!
const lineUp = (sp?: number, tag = 'FIC-1') => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag(tag, 'SP', sp)
}
const holdAt = (barg: number) => sim().applyScenario({
  id: 's', name: `BL-D at ${barg} barg`,
  overrides: [{ kind: 'terminal-pressure', tag: 'BL-D', pressure: `${barg} barg` }],
} satisfies Scenario)
const ctl = (tag: string, r: Registry, screen: HmiScreen = plant) =>
  buildSimModel(screen, r).controllers.find((c) => c.tag === tag)
/** The machine's own SIGNED flow, averaged: one sample of a controlled plant
 *  says nothing, because the loop is chasing its transmitter's noise. */
const settledQ = (seconds = 40): number => {
  const xs: number[] = []
  for (let i = 0; i < seconds; i++) { advance(1); xs.push(env().flowM3h!) }
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
/** 0.8 % of a 60 m³/h span, with room for the peak-to-peak. */
const NOISE_BAND = 0.7

beforeEach(() => { start() })

// ── A, B, C, D, E. The override itself ──────────────────────────────────────

describe('A-E — a limit that is read, and a setpoint that is raised', () => {
  it('A: a machine whose record states no minimum gets NO protection at all', () => {
    start(reg())
    lineUp(12); advance(200)
    expect(sim().defs['P-1']!.minFlowM3h).toBeUndefined()
    expect(prot()).toBeUndefined()
    expect(minFlowStateOf(prot())).toBe('NOT_CONFIGURED')
    // ...and NOTHING was assumed in its place: no fraction of rated capacity,
    // no floor under the setpoint, no change to where the loop settled
    expect(ctl('FIC-1', reg())).toMatchObject({ outTag: 'P-1', outKind: 'pump' })
    expect(ctl('FIC-1', reg())!.minFlow).toBeUndefined()
    expect(Math.abs(settledQ() - 12)).toBeLessThan(NOISE_BAND)
  })

  it('B: a declared minimum is wired onto the loop that drives the machine', () => {
    const c = ctl('FIC-1', reg({ minFlow: '20 m³/h' }))!
    expect(c.minFlow).toBe(20)
    expect(c.outTag).toBe('P-1')
    expect(c.outKind).toBe('pump')
    // it is the RECORD's number, not a derivation of rated capacity
    expect(c.minFlow).toBe(sim().defs['P-1']!.minFlowM3h)
  })

  it('C: a setpoint above the minimum is not touched', () => {
    lineUp(30); advance(200)
    expect(prot()).toMatchObject({
      limitM3h: 20, requestedSp: 30, effectiveSp: 30, overriding: false, state: 'INACTIVE',
    })
    expect(Math.abs(settledQ() - 30)).toBeLessThan(NOISE_BAND)
  })

  it('D: a setpoint EQUAL to the minimum needs no override either', () => {
    lineUp(20); advance(200)
    expect(prot()).toMatchObject({ requestedSp: 20, effectiveSp: 20, overriding: false })
    expect(prot()!.state).toBe('INACTIVE')
  })

  it('E: a setpoint below the minimum is raised TO the minimum, and no further', () => {
    lineUp(12); advance(200)
    expect(prot()).toMatchObject({ limitM3h: 20, requestedSp: 12, effectiveSp: 20, overriding: true })
    // exactly the minimum. Not the minimum plus a margin, which is the number
    // this phase would have had to invent
    expect(prot()!.effectiveSp).toBe(20)
    expect(Math.abs(settledQ() - 20)).toBeLessThan(NOISE_BAND)
  })

  it('and the OPERATOR\'S OWN SETPOINT survives it — the override is not a write', () => {
    lineUp(12); advance(200)
    expect(fic().SP).toBe(12)              // still exactly what was typed
    sim().writeTag('FIC-1', 'SP', 40)
    advance(5)
    expect(prot()).toMatchObject({ requestedSp: 40, effectiveSp: 40, overriding: false })
  })
})

// ── F, G, H, I, J, K, L, M. A demand is not a result ────────────────────────

describe('F-M — what the plant did about the demand', () => {
  it('F: flow at or above the minimum is EFFECTIVE', () => {
    // the drive's own turndown already holds this machine above its minimum,
    // so the protection is in force AND comfortably satisfied
    start(reg({ minFlow: '5 m³/h' }))
    lineUp(2); advance(400)
    expect(prot()).toMatchObject({ requestedSp: 2, effectiveSp: 5, overriding: true })
    expect(prot()!.state).toBe('EFFECTIVE')
    expect(prot()!.actualM3h!).toBeGreaterThan(5)
    expect(minFlowFindings(sim().minFlow)).toEqual([])
  })

  it('G: a minimum the plant cannot make is UNABLE, and says so as a WARNING', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    expect(prot()).toMatchObject({ requestedSp: 12, effectiveSp: 55, overriding: true })
    expect(prot()!.state).toBe('UNABLE')
    // the DISPLAYED flow is the real one. Nothing clamped it to the demand.
    expect(prot()!.actualM3h!).toBeLessThan(55)
    expect(prot()!.actualM3h!).toBeCloseTo(env().flowM3h!, 9)
    // the loop has asked for everything it has, which is what earns the warning
    expect(fic().SAT).toBe(1)
    const f = minFlowFindings(sim().minFlow).find((x) => x.id.endsWith('min-flow-unable'))!
    expect(f.severity).toBe('warning')
    expect(f.tag).toBe('FIC-1')
    expect(f.message).toContain('the plant is not making it')
  })

  it('H: a STOPPED machine can never read EFFECTIVE', () => {
    lineUp(12); advance(200)
    sim().writeTag('P-1', 'RUN', 0)
    advance(30)
    expect(prot()!.overriding).toBe(true)      // the demand is still computed
    expect(prot()!.state).toBe('UNABLE')
    expect(prot()!.state).not.toBe('EFFECTIVE')
    expect(prot()!.actualM3h!).toBeLessThan(20)
  })

  it('I: a TRIPPED machine can never read EFFECTIVE', () => {
    lineUp(12); advance(200)
    sim().writeTag('P-1', 'FAULT', 1)
    advance(30)
    expect(prot()!.state).toBe('UNABLE')
    expect(env().state).toBe('STOPPED')
    // ...and the protection did not reset the trip, restart the machine or
    // touch the controller's mode
    expect(pump().FAULT).toBe(1)
    expect(fic().MODE).toBe(1)
  })

  it('J: no drive means no setpoint path, so there is nothing to protect', () => {
    start(reg({ minFlow: '20 m³/h', vsd: false }))
    lineUp(12); advance(200)
    // K15 refuses to wire a machine that has not declared a drive, so this
    // loop drives nothing — and a protection with no final element must not
    // pretend it has one
    expect(ctl('FIC-1', reg({ minFlow: '20 m³/h', vsd: false }))!.outTag).toBeUndefined()
    expect(minFlowStateOf(prot())).toBe('NOT_CONFIGURED')
    expect(minFlowStateOf(prot())).not.toBe('EFFECTIVE')
  })

  it('K: a solve nobody can trust is ACTIVE — the demand stands, the outcome does not', () => {
    const m = buildSimModel(plant, reg({ minFlow: '20 m³/h' }))
    const broken: SolveResult = {
      pressure: {}, flow: {}, pipeFlow: {}, converged: false, iterations: 1,
      residual: 0, cavitating: [], undetermined: [],
    }
    const envs = pumpEnvelopes(m.hydraulic, m.defs, { 'P-1': { RUN: 1, RAMP: 1 } },
      broken, pumpEdgeMap(m.hydraulic))
    const p = minFlowProtection({
      'FIC-1': { tag: 'FIC-1', saturated: 0,
        minFlow: { pump: 'P-1', limitM3h: 20, requestedSp: 12, effectiveSp: 20, overriding: true } },
    }, envs)
    expect(envs['P-1']!.state).toBe('UNKNOWN')
    expect(p['FIC-1']!.state).toBe('ACTIVE')
    expect(p['FIC-1']!.state).not.toBe('EFFECTIVE')
    expect(MIN_FLOW_SEVERITY.ACTIVE).toBe('info')      // not a fault
  })

  it('L: REVERSE FLOW cannot satisfy a positive minimum', () => {
    lineUp(12); advance(200)
    holdAt(10); advance(60)
    expect(env().state).toBe('REVERSE FLOW')
    expect(prot()!.actualM3h!).toBeLessThan(0)
    expect(prot()!.state).toBe('UNABLE')
  })

  it('M: DEAD-HEAD cannot satisfy it either, and nothing trips or recirculates', () => {
    lineUp(12); advance(200)
    sim().writeTag('HV-9', 'OP', 0)
    advance(60)
    expect(env().state).toBe('DEAD-HEAD')      // K13's diagnosis, preserved
    expect(prot()!.state).toBe('UNABLE')
    expect(pump().RUN).toBe(1)                 // no automatic trip
    expect(pump().FAULT ?? 0).toBe(0)
    expect(sim().tags['HV-9']!.OP).toBe(0)     // no invented recirculation path
  })
})

// ── AC. The sign, which a magnitude would have destroyed ────────────────────

describe('AC — signed throughout', () => {
  it('the instrument reads a magnitude; the protection reads the solve', () => {
    lineUp(12); advance(200)
    holdAt(10); advance(60)

    const q = prot()!.actualM3h!
    expect(q).toBeLessThan(0)
    // the FE does not know which way round it was installed
    expect(sim().tags['FT-1']!.PV!).toBeGreaterThan(0)
    // had the verdict been taken from that reading, a machine running
    // backwards at this rate would have read as comfortably ABOVE its minimum
    expect(Math.abs(q)).toBeGreaterThan(20)
    expect(prot()!.state).toBe('UNABLE')
  })
})

// ── N, O, P, Q, R, S, T. The cascade, and who writes what ───────────────────

describe('N-T — master, override, slave, drive', () => {
  const cascadeReg = (minFlow = '20 m³/h') =>
    reg({ minFlow, cascade: true })

  it('N, S, T: the chain runs master → override → slave → drive, and only that way', () => {
    const r = cascadeReg()
    const m = ctl('PIC-1', r, cascaded)!
    const s = ctl('FIC-1', r, cascaded)!
    // S: the master's output is a SETPOINT. It has no path to SPD at all.
    expect(m).toMatchObject({ outTag: 'FIC-1', outKind: 'cascade' })
    expect(m.outKind).not.toBe('pump')
    // T: the slave is the sole writer of the drive, and carries the protection
    expect(s).toMatchObject({ outTag: 'P-1', outKind: 'pump', minFlow: 20, cascadeFrom: 'PIC-1' })
    const writers = buildSimModel(cascaded, r).controllers
      .filter((c) => c.outKind === 'pump' && c.outTag === 'P-1')
    expect(writers.map((c) => c.tag)).toEqual(['FIC-1'])
  })

  it('N, P, Q, R: the master asks for less than the minimum and all three numbers stay visible', () => {
    start(cascadeReg(), cascaded)
    lineUp(1.6, 'PIC-1')                      // a pressure the plant makes at low flow
    advance(500)

    const loop = sim().loops['PIC-1']!
    // P: what the MASTER asked for, in the slave's units
    expect(loop.commandedSp!).toBeLessThan(20)
    // Q: what the slave is actually carrying
    expect(loop.effectiveSp).toBe(20)
    expect(prot()).toMatchObject({ effectiveSp: 20, overriding: true })
    expect(prot()!.requestedSp).toBe(sim().tags['FIC-1']!.SP)
    // R: and the flow, independently, from the solve
    expect(prot()!.actualM3h!).toBeCloseTo(env().flowM3h!, 9)
    // the master never reached the drive: the slave's output is the speed
    expect(pump().SPD).toBeCloseTo(fic().OP!, 9)
    expect(pic().OP!).not.toBeCloseTo(pump().SPD!, 3)
  })

  it('O: the same override with NO master at all — a flow loop on its own', () => {
    lineUp(12); advance(300)
    expect(sim().loops['FIC-1']!.cascadeFrom).toBeUndefined()
    expect(prot()).toMatchObject({ requestedSp: 12, effectiveSp: 20, overriding: true })
    expect(Math.abs(settledQ() - 20)).toBeLessThan(NOISE_BAND)
  })

  /**
   * MY FIRST VERSION OF THIS TEST PROVED NOTHING, and finding out why is the
   * most useful thing in the file.
   *
   * It drove the master hard down (SP 1.6 bar against a plant making 2.4) and
   * asserted the integrator was held. It WAS held — at zero — but the floor
   * had nothing to do with it: the master was slammed onto its own output stop
   * and K14's existing `op <= lo && e < 0` had already frozen it. A test that
   * passes with the feature removed is not a test of the feature.
   *
   * The floor only bites in the band the output stop cannot reach: output
   * ABOVE `lo`, below the floor, and the error still pushing down. Getting
   * there needs the master wound UP first and then asked for less.
   */
  it('§8: the master stops integrating DOWN against a request nobody is applying', () => {
    start(cascadeReg(), cascaded)
    lineUp(2.8, 'PIC-1')
    advance(700)
    expect(prot()!.overriding).toBe(false)     // wound up, above the minimum
    expect(pic().OP!).toBeGreaterThan(40)

    sim().writeTag('PIC-1', 'SP', 2.2)         // now ask for much less
    advance(900)
    const floorPct = (20 / SLAVE_MAX) * 100
    // IT CAME TO REST ON THE FLOOR, not on its output stop — which is at 0 and
    // is nowhere near. Without the floor this is the band it would have wound
    // straight through.
    expect(prot()!.overriding).toBe(true)
    expect(pic().OP!).toBeCloseTo(floorPct, 0)
    expect(pic().OP!).toBeGreaterThan(20)      // ...and `lo` is 0
    expect(sim().loops['PIC-1']!.commandedSp!).toBeCloseTo(20, 0)

    const held = pic().I!
    advance(600)                               // and it STAYS there
    expect(pic().I!).toBeCloseTo(held, 0)

    // THE POINT OF HOLDING IT. Asked for more, the master is useful again on
    // the very next tick, instead of spending a minute climbing back through
    // travel it should never have given up.
    sim().writeTag('PIC-1', 'SP', 2.7)
    advance(1)
    expect(sim().loops['PIC-1']!.commandedSp!).toBeGreaterThan(20)
    expect(prot()!.overriding).toBe(false)
  })

  it('§8: the floor is the slave\'s range run backwards, and nothing when there is none', () => {
    expect(ctl('PIC-1', cascadeReg(), cascaded)!.minFlowFloorPct)
      .toBeCloseTo((20 / SLAVE_MAX) * 100, 9)
    // AA: with no minimum declared there is no floor, so the master's
    // anti-windup is the one K17 shipped, unchanged
    expect(ctl('PIC-1', reg({ cascade: true }), cascaded)!.minFlowFloorPct).toBeUndefined()
  })
})

// ── U, V. Authority, and the mode the operator is in ────────────────────────

describe('U, V — authority and MANUAL', () => {
  it('U: K16 authority is untouched — a stopped machine still reads de-energised', () => {
    lineUp(12); advance(200)
    expect(sim().loops['FIC-1']!.authority).toBe('available')
    sim().writeTag('P-1', 'RUN', 0)
    advance(5)
    expect(sim().loops['FIC-1']!.authority).toBe('de-energised')
    // the protection did not invent an authority of its own for this
    expect(prot()!.state).toBe('UNABLE')
    // and K16's HOLD still holds: no output, no integrator movement
    const held = { OP: fic().OP, I: fic().I }
    advance(60)
    expect(fic().OP).toBe(held.OP)
    expect(fic().I).toBe(held.I)
  })

  it('V: in MANUAL the protection does not act, and does not reinterpret the hand command', () => {
    lineUp(12); advance(200)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 30)
    advance(20)
    // THE OPERATOR'S OUTPUT REACHED THE DRIVE UNCHANGED. The protection acts
    // on the setpoint, and in MANUAL the setpoint is not in the path at all.
    expect(pump().SPD).toBe(30)
    expect(fic().MODE).toBe(0)                 // and the mode was not changed
    expect(prot()!.requestedSp).toBe(12)       // the demand is still reported
    expect(prot()!.effectiveSp).toBe(20)
    // K13 goes on reporting the physical condition from the machine's end
    expect(env().state).toBe('BELOW MINIMUM FLOW')
  })

  it('V: and the return to AUTO is still bumpless — against the EFFECTIVE setpoint', () => {
    lineUp(12); advance(200)
    sim().writeTag('FIC-1', 'MODE', 0)
    sim().writeTag('FIC-1', 'OP', 30)
    advance(20)
    const before = fic().OP!
    sim().writeTag('FIC-1', 'MODE', 1)
    advance(1)
    /**
     * BUMPLESS MEANS "WITHIN THE MEASUREMENT NOISE", and it cannot mean
     * anything tighter: `I = OP − kp·e` is re-evaluated against a transmitter
     * that moves every tick, so the transfer carries one tick of noise with
     * it. kp is 1.0 here and the FT's band is ±0.4 % of span, so a fraction of
     * a per cent is the floor.
     *
     * The number that makes this test worth having is the one it rules out.
     * Had the tracking used the REQUESTED setpoint of 12 while AUTO went on to
     * control to the EFFECTIVE 20, the transfer would have kicked the output
     * by kp · (20 − 12)/60 · 100 = 13.3 %.
     */
    expect(Math.abs(fic().OP! - before)).toBeLessThan(2)
    advance(300)
    expect(Math.abs(settledQ() - 20)).toBeLessThan(NOISE_BAND)
  })
})

// ── W, AB. Determinism, and no second clock ─────────────────────────────────

describe('W, AB — deterministic, and stateless', () => {
  it('W: two identical runs produce identical protection, tick for tick', () => {
    const once = () => {
      start(); lineUp(12); advance(120)
      return JSON.stringify(sim().minFlow)
    }
    expect(once()).toBe(once())
  })

  it('AB: the override has no memory and no clock of its own', () => {
    lineUp(12); advance(200)
    const wasEffective = prot()!.effectiveSp
    // a step DOWN is applied on the very next tick — no filter, no ramp, no
    // delay, nothing that would need a clock to run
    sim().writeTag('FIC-1', 'SP', 45)
    advance(1)
    expect(prot()).toMatchObject({ requestedSp: 45, effectiveSp: 45, overriding: false })
    sim().writeTag('FIC-1', 'SP', 12)
    advance(1)
    // ...and coming back gives exactly the same answer it gave before, from a
    // completely different history
    expect(prot()!.effectiveSp).toBe(wasEffective)
    expect(prot()!.effectiveSp).toBe(20)
  })
})

// ── X, Y, Z, AA. Everything K13 to K17 already did ──────────────────────────

describe('X, Y, Z, AA — nothing else changed', () => {
  it('X: K13 still reports the machine\'s own operating point, independently', () => {
    start(reg({ minFlow: '55 m³/h' }))
    lineUp(12); advance(400)
    // the protection is demanding 55 and the machine is passing far less. K13
    // is not softened, suppressed or told a better story about it.
    expect(env().state).toBe('BELOW MINIMUM FLOW')
    expect(env().minFlowM3h).toBe(55)
    expect(prot()!.state).toBe('UNABLE')
  })

  it('X: and a machine with no stated limit is still LIMIT UNKNOWN, not zero', () => {
    start(reg())
    lineUp(12); advance(200)
    expect(env().state).toBe('LIMIT UNKNOWN')
    expect(env().minFlowM3h).toBeUndefined()
    expect(prot()).toBeUndefined()
  })

  it('Y, Z: with no minimum declared, every wired loop is byte-for-byte K15\'s', () => {
    const before = buildSimModel(plant, reg()).controllers
    for (const c of before) {
      expect(c.minFlow).toBeUndefined()
      expect(c.minFlowFloorPct).toBeUndefined()
      expect(c.minFlowProblem).toBeUndefined()
    }
    start(reg())
    lineUp(25); advance(300)
    expect(Math.abs(settledQ() - 25)).toBeLessThan(NOISE_BAND)
    expect(sim().minFlow).toEqual({})
  })

  it('AA: and the cascade with no minimum declared settles exactly where K17 left it', () => {
    start(reg({ cascade: true }), cascaded)
    lineUp(3, 'PIC-1'); advance(500)
    expect(sim().minFlow).toEqual({})
    expect(sim().loops['PIC-1']).toMatchObject({ cascadeTo: 'FIC-1', authority: 'available' })
    expect(sim().loops['PIC-1']!.effectiveSp).toBe(fic().SP)
    expect(pump().SPD).toBeCloseTo(fic().OP!, 9)
  })
})

// ── The refusals ────────────────────────────────────────────────────────────

describe('a limit that cannot be applied is refused rather than approximated', () => {
  it('a loop ranged in other units gets no protection, and the record is not blamed', () => {
    const screen: HmiScreen = {
      ...plant,
      widgets: plant.widgets.map((w) =>
        w.id === 'fic' ? { ...w, props: { ...w.props, unit: 'L/s' } } : w),
    }
    const r = reg({ minFlow: '20 m³/h' })
    const c = ctl('FIC-1', r, screen)!
    expect(c.minFlow).toBeUndefined()
    expect(c.minFlowProblem).toContain('L/s')

    start(r, screen)
    lineUp(12); advance(60)
    expect(prot()!.state).toBe('NOT_CONFIGURED')
    // the loop runs exactly as it would with no limit on the record at all:
    // nothing is raised, and no limit is carried
    expect(prot()).toMatchObject({ overriding: false, effectiveSp: 12, requestedSp: 12 })
    expect(prot()!.limitM3h).toBeUndefined()
    const f = minFlowFindings(sim().minFlow)[0]!
    expect(f.severity).toBe('info')            // a gap, not a fault
    expect(f.message).toContain('not in service')
    expect(f.message).toContain('no limit has been assumed')
  })

  it('a loop that measures something other than flow is left alone', () => {
    // a PRESSURE loop driving the same machine has a setpoint in bar, and
    // `max(3.2 bar, 20 m³/h)` is not arithmetic
    const screen: HmiScreen = {
      ...plant,
      widgets: [
        ...plant.widgets.filter((w) => w.id !== 'fic' && w.id !== 'ft'),
        { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
        { id: 'pic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
      ],
    }
    const r = reg({ minFlow: '20 m³/h' })
    expect(ctl('PIC-1', r, screen)).toMatchObject({ outTag: 'P-1', outKind: 'pump' })
    expect(ctl('PIC-1', r, screen)!.minFlow).toBeUndefined()
    expect(ctl('PIC-1', r, screen)!.minFlowProblem).toBeUndefined()
  })

  it('a healthy protection produces no finding at all', () => {
    lineUp(30); advance(200)
    expect(prot()!.state).toBe('INACTIVE')
    expect(minFlowFindings(sim().minFlow)).toEqual([])
    expect(MIN_FLOW_SEVERITY.EFFECTIVE).toBeUndefined()
    expect(MIN_FLOW_SEVERITY.INACTIVE).toBeUndefined()
  })
})
