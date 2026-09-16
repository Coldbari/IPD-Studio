// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K8 — WHAT THE PLANT IS DOING TODAY, as against what it IS.
 *
 * The engineering record says a battery limit runs at 3 barg. That is a fact
 * about the plant. Today the upstream unit is down and the header is at 1 barg
 * — a fact about this shift, which must not go anywhere near the registry.
 *
 * So a scenario is a set of overrides keyed by tag, and these tests hold three
 * things about it:
 *
 *  1. IT IS CAUSAL, not cosmetic. Changing a boundary pressure moves the
 *     pressure field, the flows, the pump's operating point, the transmitters
 *     and the vessel inventories, because it goes into the solve and comes
 *     back out through the same path everything else does. A scenario that
 *     only changed a displayed number would fail every test here.
 *  2. IT CHANGES NOTHING PERMANENT. The registry, the drawing and the topology
 *     are identical before, during and after.
 *  3. IT NEVER GUESSES. Two overrides for one tag is not a value with a
 *     tie-break rule; a pressure nobody can parse is not a pressure. Both
 *     resolve to `invalid`, by name, and the plant keeps solving at a stated
 *     fallback rather than at a number somebody invented.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { resolveTerminal, terminalPressures, validateScenario } from '../../src/hmi/sim/scenario'
import type { Scenario } from '../../src/hmi/sim/scenario'
import { SHUT_LEAK_MAX } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

/** BL-S ─a1─ P-1 ─a2─ FV-1 ─a3─ TK-1 ─a4─ LV-1 ─a5─ BL-D, with PT/FT/LT.
 *  A terminal at each end so a scenario has both to move. */
const plant: HmiScreen = {
  id: 'k8', name: 'K8', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 600, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 40 } },
    { id: 'lv', type: 'valve', x: 820, y: 180, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 1000, y: 180, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 1200, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2' } },
    { id: 'ft', type: 'display', x: 1200, y: 90, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a3' } },
    { id: 'lt', type: 'display', x: 1200, y: 140, w: 96, h: 40, tag: 'LT-1', props: { bindTank: 'TK-1' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 596, y: 150 }], aId: 'fv', aPort: 'out', bId: 't', bPort: 'bottom' },
    { id: 'a4', points: [{ x: 648, y: 165 }, { x: 816, y: 196 }], aId: 't', aPort: 'bottom', bId: 'lv', bPort: 'in' },
    { id: 'a5', points: [{ x: 872, y: 196 }, { x: 1004, y: 192 }], aId: 'lv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** The plant AS SPECIFIED: supply at 3 barg, destination at 1 barg. */
const registry: Registry = {
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '3 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
}

const scenario = (name: string, overrides: Scenario['overrides']): Scenario =>
  ({ id: name, name, overrides })

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const lineUp = () => {
  sim().writeTag('FV-1', 'OP', 100)
  sim().writeTag('LV-1', 'OP', 100)
  sim().writeTag('P-1', 'RUN', 1)
}
const model = () => buildSimModel(plant, registry).hydraulic

beforeEach(() => {
  sim().exitRun()
  sim().enterRun(plant, registry)
})

// ── A, B, C. Where a pressure comes from ────────────────────────────────────

describe('A-C — the record states it, a scenario may hold it elsewhere', () => {
  it('A: with no scenario, a terminal is at the pressure its RECORD states', () => {
    expect(sim().terminals['BL-S']).toEqual({ source: 'engineering', barA: 4 })
    expect(sim().terminals['BL-D']).toEqual({ source: 'engineering', barA: 2 })
    expect(sim().scenario).toBeNull()
  })

  it('B: a scenario holds it somewhere else, and says that is where it came from', () => {
    sim().applyScenario(scenario('upstream down', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '1 barg' },
    ]))
    expect(sim().terminals['BL-S']).toEqual({ source: 'scenario', barA: 2 })
    // ...and the one nobody overrode is still the record's
    expect(sim().terminals['BL-D']).toEqual({ source: 'engineering', barA: 2 })
  })

  it('B: and the ENGINEERING RECORD is untouched by it', () => {
    const before = JSON.stringify(registry)
    sim().applyScenario(scenario('x', [{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '1 barg' }]))
    advance(60)
    expect(JSON.stringify(registry)).toBe(before)
    // the topology's own compiled value is the record's too — a scenario
    // overrides at solve time and never rewrites the plant
    expect(model().nodes.find((n) => n.tag === 'BL-S')!.pressureBar).toBe(4)
  })

  it('C: two terminals are held independently', () => {
    sim().applyScenario(scenario('both', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '5 barg' },
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '2 barg' },
    ]))
    expect(sim().terminals['BL-S']!.barA).toBe(6)
    expect(sim().terminals['BL-D']!.barA).toBe(3)
    lineUp(); advance(30)
    // the NODE is at 6 bar; the PIPE reads the mean of its two ends, which is
    // lower because the run to the pump costs something. That difference is
    // the point of §10 — a terminal's pressure is not the pressure everywhere
    // downstream of it.
    const m = buildSimModel(plant, registry).hydraulic
    const node = m.nodes.find((n) => n.tag === 'BL-S')!
    expect(sim().hydraulic.converged).toBe(true)
    expect(sim().pipePressures.a1!).toBeLessThan(6)
    expect(sim().pipePressures.a1!).toBeGreaterThan(4)
    expect(node.pressureBar).toBe(4) // and the RECORD's value is still on the node
  })

  it('precedence is scenario → engineering → default, and nothing merges', () => {
    const m = model()
    expect(resolveTerminal(m, 'BL-S', null).source).toBe('engineering')
    expect(resolveTerminal(m, 'BL-S', scenario('s', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '9 barg' }])).source).toBe('scenario')
    // a terminal whose record says nothing falls back, and says so
    const bare = buildProcessModel(plant)
    expect(resolveTerminal(bare, 'BL-S', null))
      .toEqual({ source: 'default', barA: DEFAULTS.atmosphericPressureBar })
  })
})

// ── D. A boundary change is causal, end to end ──────────────────────────────

describe('D — changing a boundary moves the whole plant, not a number', () => {
  it('the pressure field, the flows, the machine and the instruments all follow', () => {
    lineUp()
    advance(60)
    const before = {
      suction: sim().pipePressures.a1!,
      discharge: sim().pipePressures.a2!,
      feed: sim().pipeFlows.a3!,
      pt: sim().tags['PT-1']!.PV!,
      ft: sim().tags['FT-1']!.PV!,
    }

    // the upstream unit trips: the header sags from 3 barg to 1 barg
    sim().applyScenario(scenario('header sag', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '1 barg' },
    ]))
    advance(60)

    // 1. the boundary itself — the suction line sits lower than it did
    expect(sim().pipePressures.a1!).toBeLessThan(before.suction)
    expect(before.suction - sim().pipePressures.a1!).toBeGreaterThan(1)
    // 2. the machine is offered less, so it delivers from lower down
    expect(sim().pipePressures.a2!).toBeLessThan(before.discharge)
    // 3. less flow through the plant
    expect(sim().pipeFlows.a3!).toBeLessThan(before.feed)
    // 4. the transmitters read the new state — they are not told it
    expect(sim().tags['PT-1']!.PV!).toBeLessThan(before.pt)
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(before.ft)
    expect(sim().tags['PT-1']!.PV!).toBeCloseTo(sim().pipePressures.a2!, 1)
    expect(sim().tags['FT-1']!.PV!).toBeCloseTo(Math.abs(sim().pipeFlows.a3!), 0)
  })

  it('and the vessel fills more slowly, because less is arriving', () => {
    lineUp(); advance(60)
    const fast = sim().pipeFlows.a3!
    const from = sim().tags['TK-1']!.V!
    advance(600, 5)
    const gained = sim().tags['TK-1']!.V! - from

    sim().exitRun(); sim().enterRun(plant, registry)
    sim().applyScenario(scenario('sag', [{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '1 barg' }]))
    lineUp(); advance(60)
    const slow = sim().pipeFlows.a3!
    const from2 = sim().tags['TK-1']!.V!
    advance(600, 5)
    const gained2 = sim().tags['TK-1']!.V! - from2

    expect(slow).toBeLessThan(fast)
    expect(gained2).toBeLessThan(gained)
    expect(gained2).toBeGreaterThan(0)
  })

  it('a terminal DRAINS or FEEDS depending only on where its record puts it', () => {
    // BL-D as specified is 1 barg — two bar absolute, already ABOVE the
    // vessel's bottom nozzle at roughly 1.12 bar, so as drawn it feeds the
    // plant rather than receiving from it. Put it BELOW and the same line
    // drains instead, with nothing but the stated pressure changing.
    sim().applyScenario(scenario('low outlet', [
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '0 barg' },
    ]))
    lineUp(); advance(60)
    const out = sim().pipeFlows.a5!
    expect(out).toBeGreaterThan(0) // drawn LV-1 -> BL-D, and now draining

    // hold the destination at 4 barg — five bar absolute, well above the
    // vessel it drains into. It is no longer a destination: it feeds the
    // plant, and the SIGN says so without anything being told to reverse.
    sim().applyScenario(scenario('stiff outlet', [
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '4 barg' },
    ]))
    advance(60)
    expect(sim().pipeFlows.a5!).toBeLessThan(0)
    // ...and the vessel now gains from BOTH ends
    const v = sim().tags['TK-1']!.V!
    advance(120, 2)
    expect(sim().tags['TK-1']!.V!).toBeGreaterThan(v)
  })
})

// ── E, F. Equipment, through the channel it already had ─────────────────────

describe('E, F — equipment overrides go through the operator write path', () => {
  it('E: RUN → STOP removes the machine’s contribution', () => {
    sim().applyScenario(scenario('running', [
      { kind: 'signal', tag: 'FV-1', signal: 'OP', value: 100 },
      { kind: 'signal', tag: 'LV-1', signal: 'OP', value: 100 },
      { kind: 'signal', tag: 'P-1', signal: 'RUN', value: 1 },
    ]))
    advance(60)
    const running = sim().pipeFlows.a2!
    expect(running).toBeGreaterThan(1)
    expect(sim().tags['P-1']!.RUN).toBe(1)

    sim().applyScenario(scenario('stopped', [{ kind: 'signal', tag: 'P-1', signal: 'RUN', value: 0 }]))
    advance(60)
    expect(Math.abs(sim().pipeFlows.a2!)).toBeLessThan(Math.abs(running))
    // and it went through the ordinary path, so the journal has it
    expect(sim().journal.some((j) => j.tag === 'P-1')).toBe(true)
  })

  it('F: 100 → 25 → 0 reduces then blocks, by the established semantics', () => {
    lineUp(); advance(60)
    const open = Math.abs(sim().pipeFlows.a3!)

    sim().applyScenario(scenario('throttled', [{ kind: 'signal', tag: 'FV-1', signal: 'OP', value: 25 }]))
    advance(60)
    const part = Math.abs(sim().pipeFlows.a3!)
    expect(part).toBeLessThan(open)
    expect(part).toBeGreaterThan(SHUT_LEAK_MAX)

    sim().applyScenario(scenario('shut', [{ kind: 'signal', tag: 'FV-1', signal: 'OP', value: 0 }]))
    advance(60)
    // the K3/K3.2 blocked-element ceiling, not a new rule invented here
    expect(Math.abs(sim().pipeFlows.a3!)).toBeLessThan(SHUT_LEAK_MAX)
  })

  it('a scenario never invents equipment physics it does not have', () => {
    // there is no check valve, no seal, no NPSH trip: a scenario can only set
    // signals the simulation already carries
    sim().applyScenario(scenario('trip', [{ kind: 'signal', tag: 'P-1', signal: 'FAULT', value: 1 }]))
    advance(30)
    expect(sim().tags['P-1']!.FAULT).toBe(1)
    expect(Math.abs(sim().pipeFlows.a2!)).toBeLessThan(SHUT_LEAK_MAX)
  })
})

// ── G, H, I. Bad scenarios fail loudly ──────────────────────────────────────

describe('G-I — an unusable scenario is reported, never coerced', () => {
  const problems = (s: Scenario) => validateScenario(model(), s)

  it('G: a tag that is not a terminal on this plant', () => {
    const s = scenario('typo', [{ kind: 'terminal-pressure', tag: 'BL-NOPE', pressure: '3 barg' }])
    expect(problems(s)).toHaveLength(1)
    expect(problems(s)[0]!.reason).toMatch(/not a terminal/i)
    sim().applyScenario(s)
    expect(sim().terminals['BL-NOPE']!.source).toBe('invalid')
    // the real terminals are untouched and the plant still runs
    expect(sim().terminals['BL-S']).toEqual({ source: 'engineering', barA: 4 })
    lineUp(); advance(30)
    expect(sim().hydraulic.converged).toBe(true)
  })

  it('G: a tag that exists but is a PUMP, not a terminal', () => {
    const s = scenario('wrong object', [{ kind: 'terminal-pressure', tag: 'P-1', pressure: '3 barg' }])
    expect(problems(s)[0]!.reason).toMatch(/not a terminal/i)
  })

  it('H: a pressure nobody can read, and one with a nonsense unit', () => {
    for (const bad of ['NaN', 'Infinity', 'lots', '3 furlongs', '']) {
      const s = scenario('bad', [{ kind: 'terminal-pressure', tag: 'BL-S', pressure: bad }])
      expect(problems(s), bad).toHaveLength(1)
      sim().applyScenario(s)
      const r = sim().terminals['BL-S']!
      expect(r.source, bad).toBe('invalid')
      // it falls back to the ENGINEERING value and says why — never to zero,
      // never to NaN, never to the string coerced into a number
      expect(r.barA, bad).toBe(4)
      expect(Number.isFinite(r.barA), bad).toBe(true)
      expect(r.reason, bad).toBeTruthy()
    }
  })

  it('H: and a bad scenario never reaches the solve as a bad number', () => {
    sim().applyScenario(scenario('bad', [{ kind: 'terminal-pressure', tag: 'BL-S', pressure: 'NaN' }]))
    lineUp(); advance(60)
    for (const v of Object.values(sim().pipePressures)) expect(Number.isFinite(v)).toBe(true)
    for (const v of Object.values(sim().pipeFlows)) expect(Number.isFinite(v)).toBe(true)
    expect(sim().hydraulic.converged).toBe(true)
  })

  it('I: two overrides for one tag is not a tie-break, it is unfinished', () => {
    const s = scenario('contradiction', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '2 barg' },
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '5 barg' },
    ])
    expect(problems(s)).toHaveLength(1)
    expect(problems(s)[0]!.reason).toMatch(/overridden 2 times/i)
    sim().applyScenario(s)
    const r = sim().terminals['BL-S']!
    expect(r.source).toBe('invalid')
    // NEITHER value won — it holds the record's, and names both
    expect(r.barA).toBe(4)
    expect(r.reason).toContain('2 barg')
    expect(r.reason).toContain('5 barg')
  })

  it('a non-finite SIGNAL value is reported and not written', () => {
    const s = scenario('nan signal', [{ kind: 'signal', tag: 'P-1', signal: 'RUN', value: Number.NaN }])
    expect(problems(s)[0]!.reason).toMatch(/not a number/i)
    sim().applyScenario(s)
    expect(sim().tags['P-1']!.RUN).toBe(0)
  })

  it('a VALID scenario produces no problems at all', () => {
    expect(problems(scenario('ok', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '2 barg' },
      { kind: 'signal', tag: 'P-1', signal: 'RUN', value: 1 },
    ]))).toEqual([])
  })
})

// ── J. Determinism ──────────────────────────────────────────────────────────

describe('J — the same scenario twice gives the same run', () => {
  const runOnce = () => {
    sim().exitRun()
    sim().enterRun(plant, registry)
    sim().applyScenario(scenario('shift', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '2 barg' },
      { kind: 'terminal-pressure', tag: 'BL-D', pressure: '1 barg' },
      { kind: 'signal', tag: 'FV-1', signal: 'OP', value: 70 },
      { kind: 'signal', tag: 'LV-1', signal: 'OP', value: 40 },
      { kind: 'signal', tag: 'P-1', signal: 'RUN', value: 1 },
    ]))
    advance(300, 2)
    return {
      flows: JSON.stringify(sim().pipeFlows),
      pressures: JSON.stringify(sim().pipePressures),
      tags: JSON.stringify(sim().tags),
      t: sim().t,
    }
  }

  it('bit-identical: same start, same scenario, same steps', () => {
    const a = runOnce()
    const b = runOnce()
    expect(b.flows).toBe(a.flows)
    expect(b.pressures).toBe(a.pressures)
    expect(b.tags).toBe(a.tags)
    expect(b.t).toBe(a.t)
  })

  it('no state leaks between runs: a fresh run starts exactly where the last one did', () => {
    // The measurement noise is a SEEDED generator, reset on `enterRun`, and
    // nothing else outside the declared state carries across. So two runs of
    // the same length are the same run — which is what makes a scenario
    // reproducible at all.
    const once = () => {
      sim().exitRun(); sim().enterRun(plant, registry)
      lineUp(); advance(200, 2)
      return JSON.stringify({ f: sim().pipeFlows, t: sim().tags })
    }
    const a = once()
    // an intervening run with a completely different scenario must not affect it
    sim().exitRun(); sim().enterRun(plant, registry)
    sim().applyScenario(scenario('noise', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '9 barg' }]))
    lineUp(); advance(137, 3)
    expect(once()).toBe(a)
  })
})

// ── K, L. Nothing else changed ──────────────────────────────────────────────

describe('K, L — compatibility, and the measurements follow the solve', () => {
  it('K: applying a scenario and clearing it leaves the plant on its records', () => {
    // Compared run for run rather than across one long one, because the
    // inventory integrates: a plant that has been running for six minutes is
    // not in the state it was at two, scenario or no scenario.
    const run = (withScenario: boolean) => {
      sim().exitRun(); sim().enterRun(plant, registry)
      if (withScenario) {
        sim().applyScenario(scenario('s', [
          { kind: 'terminal-pressure', tag: 'BL-S', pressure: '1 barg' }]))
        sim().clearScenario()
      }
      lineUp(); advance(120)
      return JSON.stringify(sim().pipeFlows)
    }
    expect(run(true)).toBe(run(false))
    expect(sim().terminals['BL-S']).toEqual({ source: 'engineering', barA: 4 })

    // and while it IS applied, the plant is genuinely somewhere else
    sim().exitRun(); sim().enterRun(plant, registry)
    sim().applyScenario(scenario('s', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '1 barg' }]))
    lineUp(); advance(120)
    expect(JSON.stringify(sim().pipeFlows)).not.toBe(run(false))
  })

  it('K: a drawing with no TERMINALS at all is untouched by any of this', () => {
    const legacy: HmiScreen = {
      ...plant, id: 'legacy',
      widgets: plant.widgets.filter((w) => !w.tag?.startsWith('BL-')),
      pipes: plant.pipes.map((p) =>
        p.id === 'a1' ? { id: 'a1', points: p.points, bId: 'p', bPort: 'suction' }
        : p.id === 'a5' ? { id: 'a5', points: p.points, aId: 'lv', aPort: 'out' } : p),
    }
    sim().exitRun(); sim().enterRun(legacy, registry)
    // no terminals to resolve, and every free end is atmospheric as before
    expect(sim().terminals).toEqual({})
    const m = buildProcessModel(legacy)
    for (const n of m.nodes.filter((x) => x.kind === 'boundary')) {
      expect(n.boundary).toBe('atmospheric')
      expect(n.pressureBar).toBe(DEFAULTS.atmosphericPressureBar)
    }
  })

  it('L: every measurement is READ from the solved state, not handed to it', () => {
    sim().applyScenario(scenario('s', [{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '5 barg' }]))
    lineUp(); advance(120)
    // the scenario names a pressure of 6 bar absolute. PT-1 is on a2, the
    // pump's DISCHARGE — it must read that line's solved pressure and not the
    // scenario's number, which belongs to a different place entirely.
    expect(sim().terminals['BL-S']!.barA).toBe(6)
    expect(sim().tags['PT-1']!.PV!).toBeCloseTo(sim().pipePressures.a2!, 1)
    expect(sim().tags['PT-1']!.PV!).not.toBeCloseTo(6, 1)
    // FT-1 reads its own edge's flow
    expect(sim().tags['FT-1']!.PV!).toBeCloseTo(Math.abs(sim().pipeFlows.a3!), 0)
    // LT-1 reads the vessel's inventory-derived level
    expect(sim().tags['LT-1']!.PV!).toBeCloseTo(sim().tags['TK-1']!.PV!, 0)
    // and quality is unaffected by a scenario being applied
    expect(sim().quality['PT-1']!.q).toBe('good')
  })

  it('a scenario cannot change the topology — there is no override that could', () => {
    const before = buildProcessModel(plant, registry)
    sim().applyScenario(scenario('everything', [
      { kind: 'terminal-pressure', tag: 'BL-S', pressure: '9 barg' },
      { kind: 'signal', tag: 'P-1', signal: 'RUN', value: 1 },
    ]))
    advance(60)
    const after = buildProcessModel(plant, registry)
    expect(after.nodes.map((n) => `${n.id}:${n.kind}:${n.boundary}`))
      .toEqual(before.nodes.map((n) => `${n.id}:${n.kind}:${n.boundary}`))
    expect(after.edges.map((e) => `${e.id}:${e.from}>${e.to}`))
      .toEqual(before.edges.map((e) => `${e.id}:${e.from}>${e.to}`))
    // and the process view the operator sees is still the one built at RUN
    expect(sim().processView).not.toBeNull()
  })

  it('RESET returns the plant to its engineering state, scenario included', () => {
    sim().applyScenario(scenario('s', [{ kind: 'terminal-pressure', tag: 'BL-S', pressure: '1 barg' }]))
    lineUp(); advance(120)
    sim().reset()
    expect(sim().scenario).toBeNull()
    expect(sim().terminals['BL-S']).toEqual({ source: 'engineering', barA: 4 })
    expect(sim().tags['P-1']!.RUN).toBe(0)
  })
})

// ── The resolver on its own ─────────────────────────────────────────────────

describe('the resolver reports every terminal, including the ones nobody asked about', () => {
  it('names an override that matches nothing, so a typo is visible', () => {
    const all = terminalPressures(model(), scenario('t', [
      { kind: 'terminal-pressure', tag: 'BL-GHOST', pressure: '3 barg' },
    ]))
    expect([...all.keys()].sort()).toEqual(['BL-D', 'BL-GHOST', 'BL-S'])
    expect(all.get('BL-GHOST')!.source).toBe('invalid')
  })
})
