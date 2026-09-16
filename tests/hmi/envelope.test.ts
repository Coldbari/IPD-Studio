// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K13 — THE PUMP OPERATING ENVELOPE.
 *
 * K12 made the shaft commandable. Before anything commands it automatically,
 * the simulator has to be able to say when a machine is being run somewhere
 * the model cannot stand behind. That is all this is.
 *
 * Four things hold it together, and every test below is one of them:
 *
 *  1. THREE CONCEPTS, KEPT APART. The solve decides the operating point; the
 *     RECORD decides the envelope; protection decides what to do about a
 *     violation. K13 does the first two and deliberately none of the third —
 *     nothing here trips, stops or throttles anything.
 *  2. NO INVENTED LIMIT. `duty.minFlow` is read and never derived. With none
 *     stated the answer is LIMIT UNKNOWN, not a fraction of rated capacity —
 *     especially since `ratedFlow` itself falls back to a simulator default.
 *  3. NO INVENTED THRESHOLD. "No flow" is `SHUT_LEAK_MAX`, the solver's own
 *     published ceiling on what a blocked element passes.
 *  4. SIGNED, THROUGHOUT. Reverse flow is its own classification. The
 *     transmitter reads a magnitude — it does not know which way round it was
 *     installed — and the diagnostic reads the SOLVE, which does.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import {
  ENVELOPE_SEVERITY, envelopeFindings, pumpEdgeMap, pumpEnvelopes,
} from '../../src/hmi/sim/envelope'
import type { EnvelopeState } from '../../src/hmi/sim/envelope'
import { SHUT_LEAK_MAX, pumpHead } from '../../src/hmi/sim/hydraulic/solver'
import type { SolveResult } from '../../src/hmi/sim/hydraulic/solver'
import type { Scenario } from '../../src/hmi/sim/scenario'
import { pumpFlowConfig } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

// ── The plants ──────────────────────────────────────────────────────────────

/** free end ─ P-1 ─ FV-1 ─ TK-1, with PT and FT on the machine's own lines. */
const plant: HmiScreen = {
  id: 'k13', name: 'K13', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 600, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 40 } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2' } },
    { id: 'ft', type: 'display', x: 900, y: 90, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 118 }, { x: 196, y: 118 }], bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 596, y: 150 }], aId: 'fv', aPort: 'out', bId: 't', bPort: 'bottom' },
  ],
}

/**
 * BL-S ─ P-1 ─ FV-1 ─ BL-D: a machine between two STATED boundaries, so that
 * K10 can move one of them and the operating point has to follow.
 */
const between: HmiScreen = {
  id: 'k13b', name: 'K13B', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 90, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'fv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** The duty point every fixture shares. 35 m of water is 3.4325 bar. */
const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const HEAD_AT_RATED = 35 / 10.197
const RATED = 40
const MIN_FLOW = 10

/** A machine whose record says nothing beyond its duty — the legacy case. */
const bare: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment', fields: duty },
  'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
}
/** ...and the same machine with a stated minimum flow. */
const limited = (extra: Record<string, string> = {}): Registry => ({
  ...bare,
  'P-1': { key: 'P-1', kind: 'equipment',
    fields: { ...duty, 'duty.minFlow': `${MIN_FLOW} m³/h`, ...extra } },
})
/** ...on a drive, with a turndown and a minimum flow. */
const driven: Registry = limited({ 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' })
/** The two-boundary plant's records. */
const bounded: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment', fields: { ...duty, 'duty.minFlow': `${MIN_FLOW} m³/h` } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
}

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const start = (reg: Registry, screen: HmiScreen = plant) => {
  sim().exitRun(); sim().enterRun(screen, reg)
}
const lineUp = () => { sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) }
const env = () => sim().pumpEnvelopes['P-1']!
const findings = () => envelopeFindings(sim().pumpEnvelopes)
const findingIds = () => findings().map((f) => f.id.split(':')[2]!)
const holdAt = (barg: number) => sim().applyScenario({
  id: 's', name: `BL-D at ${barg} barg`,
  overrides: [{ kind: 'terminal-pressure', tag: 'BL-D', pressure: `${barg} barg` }],
} satisfies Scenario)
const docOf = (reg: Registry): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [plant], registry: reg })

beforeEach(() => { start(limited()) })

// ── A. Dead-head (§8) ───────────────────────────────────────────────────────

describe('A — a pump running into a shut valve', () => {
  it('converges, keeps its curve, passes nothing, and is reported', () => {
    lineUp(); advance(30)
    expect(env().state, 'lined up and running').toBe('NORMAL')

    sim().writeTag('FV-1', 'OP', 0)
    advance(30)

    // the solve is not in trouble: the condition is an OPERATING POINT, not a
    // numerical failure, and nothing here was changed to make it converge
    expect(sim().hydraulic.converged).toBe(true)
    expect(sim().hydraulic.cavitating).toEqual([])

    // the flow has gone where a blocked path in THIS model goes — down to the
    // published ceiling on what a shut element leaks, not to a forced zero
    const q = env().flowM3h!
    expect(q).toBeGreaterThanOrEqual(0)
    expect(q).toBeLessThanOrEqual(SHUT_LEAK_MAX)

    // and the head is the CURVE's answer at that flow, computed here from the
    // record alone. Nothing fabricated a zero-head or a shutoff condition.
    expect(env().riseBar).toBeCloseTo(pumpHead(HEAD_AT_RATED, RATED, 1, q), 3)

    expect(env().state).toBe('DEAD-HEAD')
    expect(findingIds()).toContain('pump-deadhead')
  })

  it('says it in the terms the diagnostic architecture uses', () => {
    lineUp(); advance(30); sim().writeTag('FV-1', 'OP', 0); advance(30)
    const f = findings().find((x) => x.id.endsWith('pump-deadhead'))!
    expect(f.tag).toBe('P-1')
    expect(f.severity).toBe('error')
    expect(f.message).toMatch(/dead-headed/)
    expect(f.message).toMatch(/100 % speed/)          // the ACTUAL shaft
    expect(f.message).toMatch(/bar of head/)           // the solved head
    expect(f.message).toMatch(/solved hydraulic operating point/) // its source
  })

  it('is the HYDRAULIC condition, not "a valve downstream is shut"', () => {
    // same shut valve, machine stopped: no flow, no head, no finding. The
    // valve alone has never been the condition.
    sim().writeTag('FV-1', 'OP', 0); advance(10)
    expect(env().state).toBe('STOPPED')
    expect(findings()).toEqual([])
  })

  it('detects nothing and changes nothing — K13 does not trip the machine', () => {
    lineUp(); advance(30); sim().writeTag('FV-1', 'OP', 0); advance(60)
    expect(env().state).toBe('DEAD-HEAD')
    // sixty seconds dead-headed and it is still running, still commanded, and
    // still un-tripped. Protection is a later phase with a real setting.
    expect(sim().tags['P-1']!.RUN).toBe(1)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
    expect(sim().tags['P-1']!.FAULT ?? 0).toBe(0)
    expect(sim().tags['FV-1']!.OP).toBe(0)
  })
})

// ── B, C. The limit, and its absence ────────────────────────────────────────

describe('B, C — the record states the limit, or it does not', () => {
  it('B: below a STATED minimum, with the actual and the limit said out loud', () => {
    lineUp(); advance(20)
    sim().writeTag('FV-1', 'OP', 5); advance(30)

    const q = env().flowM3h!
    expect(q).toBeGreaterThan(SHUT_LEAK_MAX)   // moving — this is not dead-head
    expect(q).toBeLessThan(MIN_FLOW)
    expect(env().state).toBe('BELOW MINIMUM FLOW')
    expect(env().minFlowM3h).toBe(MIN_FLOW)

    const f = findings().find((x) => x.id.endsWith('pump-below-min-flow'))!
    expect(f.severity).toBe('warning')
    expect(f.message).toContain(`${q.toFixed(1)} m³/h`)     // ACTUAL
    expect(f.message).toContain('10.0 m³/h')                // LIMIT
    expect(f.message).toContain('Source: engineering record')
  })

  it('B: and it clears when the flow comes back, without anything being reset', () => {
    lineUp(); advance(20); sim().writeTag('FV-1', 'OP', 5); advance(30)
    expect(env().state).toBe('BELOW MINIMUM FLOW')
    sim().writeTag('FV-1', 'OP', 100); advance(30)
    expect(env().flowM3h!).toBeGreaterThan(MIN_FLOW)
    expect(env().state).toBe('NORMAL')
    expect(findings()).toEqual([])
  })

  it('C: with NO minimum stated, the answer is LIMIT UNKNOWN — never a verdict', () => {
    start(bare)
    lineUp(); advance(20); sim().writeTag('FV-1', 'OP', 5); advance(30)

    // the identical hydraulic point that read BELOW MINIMUM FLOW above
    expect(env().flowM3h!).toBeLessThan(MIN_FLOW)
    expect(env().state).toBe('LIMIT UNKNOWN')
    expect(env().minFlowM3h).toBeUndefined()

    const f = findings().find((x) => x.id.endsWith('pump-min-flow-unknown'))!
    expect(f.severity).toBe('info')            // not a fault: a gap in the data
    expect(f.message).toContain('minimum-flow limit unavailable')
    expect(f.message).toContain('cannot determine')
    expect(f.message).toContain('Minimum flow')  // names the field to fill in
  })

  it('C: and no fraction of rated capacity is quietly substituted for it', () => {
    start(bare)
    lineUp(); advance(20); sim().writeTag('FV-1', 'OP', 3); advance(30)
    // a quarter of one per cent of a 40 m³/h machine. Every rule of thumb
    // anyone might have reached for would call this below minimum flow; with
    // no stated limit this model refuses to call it anything.
    expect(env().flowM3h!).toBeLessThan(RATED * 0.01)
    expect(env().state).toBe('LIMIT UNKNOWN')
    expect(findingIds()).not.toContain('pump-below-min-flow')
  })

  it('C: a healthy machine with no limit still says which question it cannot answer', () => {
    start(bare); lineUp(); advance(30)
    expect(env().flowM3h!).toBeGreaterThan(RATED)   // running past its duty point
    expect(env().state).toBe('LIMIT UNKNOWN')
    expect(ENVELOPE_SEVERITY[env().state]).toBe('info')
  })
})

// ── D. VSD low speed (§9) ───────────────────────────────────────────────────

describe('D — speed command → shaft → curve → operating point → diagnostic', () => {
  it('walks 100 → 60 → 30 → turndown with the shaft following K12 dynamics', () => {
    start(driven)
    lineUp(); advance(30)

    const seen: { spd: number; shaft: number; q: number; state: EnvelopeState }[] = []
    for (const spd of [100, 60, 30, 20]) {
      sim().writeTag('P-1', 'SPD', spd)
      advance(30)
      const e = env()
      seen.push({ spd, shaft: e.shaft, q: e.flowM3h!, state: e.state })
      // the shaft arrived where K12 said it would, and the curve was read at
      // the shaft rather than at the command
      expect(e.shaft).toBeCloseTo(spd / 100, 6)
      expect(e.riseBar).toBeCloseTo(pumpHead(HEAD_AT_RATED, RATED, e.shaft, e.flowM3h!), 3)
    }

    // slower is less flow, every step, because that is what the curve does
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.q, `${seen[i]!.spd} % vs ${seen[i - 1]!.spd} %`).toBeLessThan(seen[i - 1]!.q)
    }
    // and somewhere on the way down it crossed its stated minimum flow
    expect(seen[0]!.state).toBe('NORMAL')
    expect(seen[seen.length - 1]!.state).toBe('BELOW MINIMUM FLOW')
  })

  it('a restriction at part speed drives it there too, through the same chain', () => {
    start(driven)
    lineUp(); sim().writeTag('P-1', 'SPD', 60); advance(30)
    expect(env().state).toBe('NORMAL')
    sim().writeTag('FV-1', 'OP', 8); advance(30)
    expect(env().flowM3h!).toBeLessThan(MIN_FLOW)
    expect(env().state).toBe('BELOW MINIMUM FLOW')
    // nothing injected a protection value: the machine's own flow is the one
    // the solve put on the pipe in series with it, published independently
    expect(env().flowM3h!).toBeCloseTo(sim().pipeFlows['a2']!, 3)
  })

  it('a command below the turndown is reported as a command, not as hydraulics', () => {
    start(driven)
    lineUp(); sim().writeTag('P-1', 'SPD', 10); advance(30)
    expect(env().speedCommandPct).toBe(10)
    expect(env().shaft).toBeCloseTo(0.2, 6)          // K12 holds it at 20 %
    expect(env().speedOutOfEnvelope).toBe(true)
    const f = findings().find((x) => x.id.endsWith('pump-speed-out-of-envelope'))!
    expect(f.severity).toBe('warning')
    expect(f.message).toContain('commanded to 10 %')
    expect(f.message).toContain('minimum 20 %')
    expect(f.message).toContain('holding the shaft at 20 %')
  })

  it('a fixed-speed machine has no speed envelope to be outside of', () => {
    start(bare); lineUp(); advance(30)
    expect(env().speedOutOfEnvelope).toBe(false)
    expect(env().speedCommandPct).toBeUndefined()
    expect(findingIds()).not.toContain('pump-speed-out-of-envelope')
  })
})

// ── E, F. Boundary conditions and direction (§10, §5) ───────────────────────

describe('E, F — a boundary that moves takes the machine through the envelope', () => {
  it('follows the solved operating point, with no pressure written into the rule', () => {
    start(bounded, between)
    lineUp(); advance(20)
    expect(env().state).toBe('NORMAL')

    const walk: { barg: number; q: number; rise: number; state: EnvelopeState }[] = []
    for (const barg of [1, 3, 5, 6.5, 7, 8, 10]) {
      holdAt(barg); advance(20)
      walk.push({ barg, q: env().flowM3h!, rise: env().riseBar!, state: env().state })
    }

    // squeezed harder every step: less flow, more head. The machine is being
    // pushed back along its own curve by the plant in front of it.
    for (let i = 1; i < walk.length; i++) {
      expect(walk[i]!.q, `${walk[i]!.barg} barg`).toBeLessThan(walk[i - 1]!.q)
      expect(walk[i]!.rise, `${walk[i]!.barg} barg`).toBeGreaterThan(walk[i - 1]!.rise)
    }

    // The ORDER of the states is the assertion. Which barg each appears at is
    // the solve's business and is deliberately not written down here.
    const states = walk.map((w) => w.state)
    expect(states[0]).toBe('NORMAL')
    expect(states).toContain('BELOW MINIMUM FLOW')
    expect(states[states.length - 1]).toBe('REVERSE FLOW')
    expect(states.indexOf('BELOW MINIMUM FLOW'))
      .toBeLessThan(states.indexOf('REVERSE FLOW'))
  })

  it('F: reverse flow is classified as itself, and the SIGN is what says so', () => {
    start(bounded, between)
    lineUp(); advance(20)
    holdAt(10); advance(30)

    expect(env().state).toBe('REVERSE FLOW')
    expect(env().flowM3h!).toBeLessThan(-SHUT_LEAK_MAX)
    expect(env().shaft).toBeCloseTo(1, 6)      // still turning, still commanded

    const f = findings().find((x) => x.id.endsWith('pump-reverse-flow'))!
    expect(f.severity).toBe('error')
    expect(f.message).toContain('coming back through the machine')
    // NOT reported as a small forward flow, which is what a magnitude would
    // have made of it
    expect(findingIds()).not.toContain('pump-below-min-flow')
  })

  it('F, §11: the instrument reads a magnitude and the diagnostic reads the solve', () => {
    start(bounded, between)
    lineUp(); advance(20); holdAt(10); advance(30)

    const q = env().flowM3h!
    expect(q).toBeLessThan(0)
    // an FE does not know which way round it was installed, and this one is
    // reading the same stream, positive, within its noise band
    const ft = sim().tags['FT-1']!.PV!
    expect(ft).toBeGreaterThan(0)
    expect(ft).toBeCloseTo(Math.abs(q), 0)
    expect(Math.abs(ft - Math.abs(q)) / Math.abs(q)).toBeLessThan(0.01)
    // and the verdict came from the signed quantity, not from that display
    expect(env().state).toBe('REVERSE FLOW')
  })

  it('a STOPPED machine is not reverse flow, however hard the plant pushes', () => {
    start(bounded, between)
    sim().writeTag('FV-1', 'OP', 100)
    holdAt(10); advance(30)
    // the check valve this model assumes on every discharge — see `pumpFlow`
    expect(Math.abs(env().flowM3h!)).toBeLessThanOrEqual(SHUT_LEAK_MAX)
    expect(env().state).toBe('STOPPED')
    expect(findings()).toEqual([])
  })
})

// ── G, H. What the diagnostic is reading ────────────────────────────────────

describe('G, H — the derivation reads the solve and the shaft, nothing else', () => {
  it('G: the flow is the pump EDGE\'s own signed flow, not a branch magnitude', () => {
    start(bounded, between)
    lineUp(); advance(20); holdAt(10); advance(30)
    // `equipFlows` is the branch magnitude the faceplate used before K13. It
    // is positive here; the envelope's is negative. Same instant, same plant.
    expect(sim().equipFlows['P-1']!).toBeGreaterThanOrEqual(0)
    expect(env().flowM3h!).toBeLessThan(0)
  })

  it('H: the speed is the ACTUAL shaft, and mid-ramp they disagree', () => {
    start(driven)
    lineUp(); advance(30)
    sim().writeTag('P-1', 'SPD', 30)
    advance(1)                                  // one second into a two-second ramp

    const e = env()
    expect(e.speedCommandPct).toBe(30)
    expect(e.shaft).toBeGreaterThan(0.3)        // not there yet
    expect(e.shaft).toBeLessThan(1)
    expect(e.shaft).toBeCloseTo(sim().tags['P-1']!.RAMP!, 9)
    // and the head is the curve's answer for the shaft it HAS, not for 30 %
    expect(e.riseBar).toBeCloseTo(pumpHead(HEAD_AT_RATED, RATED, e.shaft, e.flowM3h!), 3)
    expect(e.riseBar).not.toBeCloseTo(pumpHead(HEAD_AT_RATED, RATED, 0.3, e.flowM3h!), 3)
  })

  it('a TRIP puts the shaft at zero whatever the drive was last told', () => {
    start(driven)
    lineUp(); sim().writeTag('P-1', 'SPD', 80); advance(30)
    sim().writeTag('P-1', 'FAULT', 1)
    advance(1)
    // the breaker is open: the shaft is zero on the very next solve, whatever
    // the drive was last asked for, and the speed command is still on record
    expect(env().shaft).toBe(0)
    expect(env().speedCommandPct).toBe(80)
    expect(env().state).toBe('STOPPED')
    advance(10)
    expect(env().state).toBe('STOPPED')
    expect(findings()).toEqual([])
  })
})

// ── I. The ramp is not a fault ──────────────────────────────────────────────

describe('I — a drive on its way somewhere is a ramp, not a violation', () => {
  it('spinning up through part speed is never dead-head or reverse flow', () => {
    start(driven)
    lineUp()
    const seen: EnvelopeState[] = []
    for (let i = 0; i < 6; i++) { advance(0.5, 0.5); seen.push(env().state) }
    expect(seen).not.toContain('DEAD-HEAD')
    expect(seen).not.toContain('REVERSE FLOW')
    expect(seen).not.toContain('UNKNOWN')
    expect(seen[seen.length - 1]).toBe('NORMAL')
  })

  it('and stepping DOWN to a speed that still delivers raises nothing', () => {
    start(driven)
    lineUp(); advance(30)
    sim().writeTag('P-1', 'SPD', 60)
    const seen: EnvelopeState[] = []
    for (let i = 0; i < 8; i++) { advance(0.5, 0.5); seen.push(env().state) }
    expect(new Set(seen)).toEqual(new Set(['NORMAL']))
    expect(findings()).toEqual([])
  })
})

// ── J. Determinism (§14) ────────────────────────────────────────────────────

describe('J — the same scenario twice is the same run twice', () => {
  it('flow, pressure, shaft and envelope state all repeat', () => {
    const run = () => {
      start(bounded, between)
      lineUp(); advance(20)
      const out: { q: number; p: number; shaft: number; state: EnvelopeState; ids: string }[] = []
      for (const barg of [1, 5, 7, 10]) {
        holdAt(barg); advance(20)
        out.push({
          q: env().flowM3h!, p: env().riseBar!, shaft: env().shaft, state: env().state,
          ids: findingIds().join(','),
        })
      }
      return out
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
    // and it actually went somewhere, so this is not two identical nothings
    expect(new Set(a.map((x) => x.state)).size).toBeGreaterThan(1)
  })
})

// ── K, L. Legacy, and the record ────────────────────────────────────────────

describe('K, L — nothing older behaves differently, and nothing is written back', () => {
  it('K: a fixed-speed machine with a bare record runs exactly as it did', () => {
    start(bare)
    lineUp(); advance(30)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(1, 6)
    expect(sim().tags['P-1']!.SPD).toBeUndefined()
    expect(sim().defs['P-1']!.minFlowM3h).toBeUndefined()
    expect(env().state).toBe('LIMIT UNKNOWN')
    // the only thing said about it is the one thing that is true: nobody
    // stated a limit
    expect(findingIds()).toEqual(['pump-min-flow-unknown'])
  })

  it('L: the engineering record is byte-identical after a run through the envelope', () => {
    const reg = limited()
    const before = JSON.stringify(reg)
    start(reg)
    lineUp(); advance(20)
    sim().writeTag('FV-1', 'OP', 5); advance(20)
    sim().writeTag('FV-1', 'OP', 0); advance(20)
    expect(env().state).toBe('DEAD-HEAD')
    expect(JSON.stringify(reg)).toBe(before)
  })

  it('M: and K12 still holds — the shaft chases the command, the solver reads it', () => {
    start(driven)
    lineUp(); advance(30)
    sim().writeTag('P-1', 'SPD', 50); advance(30)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.5, 6)
    expect(env().shaft).toBeCloseTo(0.5, 6)
    expect(env().riseBar).toBeCloseTo(pumpHead(HEAD_AT_RATED, RATED, 0.5, env().flowM3h!), 3)
  })
})

// ── The solve's own limits ──────────────────────────────────────────────────

describe('a solve nobody can trust produces no verdict at all', () => {
  const model = () => buildSimModel(plant, limited())

  /** A solve the caller is told not to believe. */
  const broken = (over: Partial<SolveResult>): SolveResult => ({
    pressure: {}, flow: {}, pipeFlow: {}, converged: true, iterations: 1,
    residual: 0, cavitating: [], undetermined: [], ...over,
  })

  it('an unconverged solve is UNKNOWN, and UNKNOWN is not a finding', () => {
    const m = model()
    const tags = { 'P-1': { RUN: 1, RAMP: 1 } }
    const envs = pumpEnvelopes(m.hydraulic, m.defs, tags,
      broken({ converged: false }), pumpEdgeMap(m.hydraulic))
    expect(envs['P-1']!.state).toBe('UNKNOWN')
    expect(envelopeFindings(envs)).toEqual([])
  })

  it('a cavitating suction is UNKNOWN too — the same rule a measurement gets', () => {
    const m = model()
    const edgeId = pumpEdgeMap(m.hydraulic).get('P-1')!
    const edge = m.hydraulic.edges.find((e) => e.id === edgeId)!
    const envs = pumpEnvelopes(m.hydraulic, m.defs, { 'P-1': { RUN: 1, RAMP: 1 } },
      broken({ cavitating: [edge.from], flow: { [edgeId]: 12 } }), pumpEdgeMap(m.hydraulic))
    expect(envs['P-1']!.state).toBe('UNKNOWN')
  })

  it('a heater is not a pump and gets no envelope', () => {
    const screen: HmiScreen = {
      ...plant,
      widgets: [...plant.widgets,
        { id: 'h', type: 'equip', x: 300, y: 300, w: 48, h: 48, tag: 'E-1', props: { symbolId: 'heater.electric' } }],
    }
    const m = buildSimModel(screen, limited())
    const envs = pumpEnvelopes(m.hydraulic, m.defs, { 'E-1': { RUN: 1, RAMP: 1 } },
      broken({}), pumpEdgeMap(m.hydraulic))
    expect(envs['E-1']).toBeUndefined()
  })
})

// ── The record's own limits ─────────────────────────────────────────────────

describe('a minimum flow the reader cannot use is reported', () => {
  const run = (reg: Registry) => pumpFlowConfig.run(buildIndex(docOf(reg)))

  it('says nothing when nobody stated one', () => {
    expect(run(bare)).toEqual([])
  })

  it('and nothing when a good one is stated', () => {
    expect(run(limited())).toEqual([])
  })

  it('a minimum flow that is not a flow', () => {
    const out = run(limited({ 'duty.minFlow': 'low' }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('not a flow this model can read')
  })

  it('a negative one', () => {
    const out = run(limited({ 'duty.minFlow': '-5 m³/h' }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('not negative')
  })

  it('and one at or above the machine\'s own stated capacity', () => {
    const out = run(limited({ 'duty.minFlow': '60 m³/h' }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('no operating range')
  })

  it('but never against a capacity the SIMULATOR defaulted', () => {
    // no `duty.capacity` on the record: `ratedFlow` falls back to 50 m³/h, and
    // reporting a drawing against a number the simulator invented would be
    // exactly the fabrication this rule exists to prevent
    const reg: Registry = { 'P-1': { key: 'P-1', kind: 'equipment',
      fields: { 'duty.head': '35 m', 'duty.minFlow': '80 m³/h' } } }
    expect(run(reg)).toEqual([])
  })
})
