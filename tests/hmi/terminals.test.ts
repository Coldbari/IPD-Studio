// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K7 — A TERMINAL IS AN ENGINEERING OBJECT WITH A STATED PRESSURE.
 *
 * K6 named the boundary conditions and left one P1 behind: a free pipe end has
 * no tag, so no engineering record, so no way for a drawing to say "this
 * connection terminates at 3 barg". Every boundary was therefore atmosphere,
 * and a battery limit could not push.
 *
 * A BATTERY LIMIT is now a tagged piece of equipment like any other. Its
 * pressure comes off its record the way a pump's duty and a vessel's capacity
 * do, and the topology holds that connection there.
 *
 * TWO THINGS THESE TESTS EXIST TO HOLD:
 *
 *  1. A terminal is a PRESSURE, never a direction. There is no SOURCE and no
 *     SINK. Two terminals at 3 and 1 barg drive flow one way; swap the two
 *     records and the same line, unchanged, runs the other way. The drawing
 *     does not get a vote.
 *  2. Silence is not a terminal. A free pipe end stays atmospheric, exactly as
 *     before, and every drawing that predates this is untouched.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { MASS_TOL, solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
import type { SolveInputs } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'
import { ATMOSPHERIC_BAR, operatingPressure } from '../../src/model/processData'
import { getSymbol } from '../../src/symbols/registry'
import { terminalBadPressure, terminalNoPressure } from '../../src/validate/rules/process'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc } from '../../src/model/doc'
import { ALL_RULES } from '../../src/validate/rules/index'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

const inputs = (over: Partial<SolveInputs> = {}): SolveInputs => ({
  valveOpen: () => 1, pumpSpeed: () => 1,
  pumpRated: () => DEFAULTS.pumpFlowM3h, pumpHead: () => DEFAULTS.pumpHeadBar,
  vesselLevel: () => 50,
  ...over,
})

const terminal = (id: string, tag: string, x: number, y: number): HmiWidget =>
  ({ id, type: 'equip', x, y, w: 48, h: 24, tag, props: { symbolId: 'bl.terminal' } })

/** BL-A ─t1─ HV-1 ─t2─ BL-B, or a free end in place of either. */
const twoEnds = (a: 'terminal' | 'free', b: 'terminal' | 'free'): HmiScreen => ({
  id: 'k7', name: 'K7', theme: 'classic',
  widgets: [
    ...(a === 'terminal' ? [terminal('ba', 'BL-A', 0, 100)] : []),
    { id: 'v', type: 'valve', x: 300, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    ...(b === 'terminal' ? [terminal('bb', 'BL-B', 600, 100)] : []),
  ],
  pipes: [
    { id: 't1', points: [{ x: 0, y: 112 }, { x: 296, y: 116 }],
      ...(a === 'terminal' ? { aId: 'ba', aPort: 'process' } : {}), bId: 'v', bPort: 'in' },
    { id: 't2', points: [{ x: 352, y: 116 }, { x: 604, y: 112 }],
      aId: 'v', aPort: 'out', ...(b === 'terminal' ? { bId: 'bb', bPort: 'process' } : {}) },
  ],
})

const at = (spec: Record<string, string>): Registry =>
  Object.fromEntries(Object.entries(spec).map(([tag, p]) =>
    [tag, { key: tag, kind: 'equipment' as const, fields: { 'design.operatingPressure': p } }]))

const solve = (sc: HmiScreen, reg?: Registry, over: Partial<SolveInputs> = {}) =>
  solveHydraulics(buildProcessModel(sc, reg), inputs(over))

const docOf = (sc: HmiScreen, reg?: Registry): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [sc], ...(reg ? { registry: reg } : {}) })

// ── The object ──────────────────────────────────────────────────────────────

describe('a terminal is a real engineering object', () => {
  it('it is a P&ID symbol that takes a tag, with ONE process connection', () => {
    const sym = getSymbol('bl.terminal')!
    expect(sym.name).toMatch(/terminal|battery/i)
    expect(sym.tagRule).toBe('equipment')
    expect(sym.ports).toHaveLength(1)
    expect(sym.ports[0]!.kind).toBe('process')
  })

  it('it compiles to a BOUNDARY node, and contributes no edge of its own', () => {
    const m = buildProcessModel(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg' }))
    const bl = m.nodes.filter((n) => n.tag?.startsWith('BL-'))
    expect(bl).toHaveLength(2)
    for (const n of bl) expect(n.kind).toBe('boundary')
    // the drawing STOPS at it: unlike a valve or a fitting it conducts nothing
    expect(m.edges.some((e) => e.tag?.startsWith('BL-'))).toBe(false)
    // one port, and it is neutral about direction
    expect(m.equipment.get('BL-A')!.ports.map((p) => p.role)).toEqual(['process'])
  })

  it('it is NOT a vessel: no volume, no level, no inventory', () => {
    const m = buildSimModel(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg' }))
    expect(m.hydraulic.vesselNodes.has('BL-A')).toBe(false)
    expect(m.defs.find((d) => d.name === 'BL-A' && d.kind === 'tank')).toBeUndefined()
  })

  it('it is NOT a pump: it holds a pressure, it does not add head', () => {
    const m = buildProcessModel(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg' }))
    expect(m.edges.some((e) => e.kind === 'pump')).toBe(false)
    // and a pump's own nodes stay internal, as K6 left them
    const withPump = buildProcessModel({
      ...twoEnds('terminal', 'free'), id: 'wp',
      widgets: [terminal('ba', 'BL-A', 0, 100), { id: 'p', type: 'pump', x: 300, y: 90, w: 56, h: 56, tag: 'P-1' }],
      pipes: [
        { id: 't1', points: [{ x: 0, y: 112 }, { x: 296, y: 118 }], aId: 'ba', aPort: 'process', bId: 'p', bPort: 'suction' },
        { id: 't2', points: [{ x: 360, y: 118 }, { x: 700, y: 118 }], aId: 'p', aPort: 'discharge' },
      ],
    }, at({ 'BL-A': '3 barg' }))
    const pump = withPump.edges.find((e) => e.kind === 'pump')!
    for (const id of [pump.from, pump.to]) {
      expect(withPump.nodes.find((n) => n.id === id)!.boundary).toBe('internal')
    }
  })

  it('there is still no SOURCE and no SINK', () => {
    const kinds = new Set(buildProcessModel(twoEnds('terminal', 'terminal'),
      at({ 'BL-A': '3 barg', 'BL-B': '1 barg' })).nodes.map((n) => n.boundary))
    expect(kinds).not.toContain('source')
    expect(kinds).not.toContain('sink')
    expect([...kinds].sort()).toEqual(['fixed-pressure', 'internal'])
  })
})

// ── Pressure semantics ──────────────────────────────────────────────────────

describe('the stated pressure is read the way the engineering model reads one', () => {
  it('gauge and absolute name the same physical pressure', () => {
    // On this project's canonical reference — one atmosphere is exactly
    // `atmosphericPressureBar`, a round 1 bar chosen for a training model and
    // the figure `PIPE_K` is calibrated against. The brief's 1.013 would be a
    // different reference; the rule is to use the one the project already has,
    // and not to introduce a second.
    expect(ATMOSPHERIC_BAR).toBe(DEFAULTS.atmosphericPressureBar)
    expect(operatingPressure('3 barg')).toBe(3 + ATMOSPHERIC_BAR)
    expect(operatingPressure('4 bara')).toBe(4)
    expect(operatingPressure('3 barg')).toBe(operatingPressure('4 bara'))
    // a bare number is GAUGE, the documented convention: a datasheet saying
    // "operating pressure: 3 bar" means 3 barg
    expect(operatingPressure('3')).toBe(3 + ATMOSPHERIC_BAR)
    expect(operatingPressure('3 bar')).toBe(3 + ATMOSPHERIC_BAR)
  })

  it('and the node is held at exactly that, in absolute', () => {
    const barg = buildProcessModel(twoEnds('terminal', 'free'), at({ 'BL-A': '3 barg' }))
    const bara = buildProcessModel(twoEnds('terminal', 'free'), at({ 'BL-A': '4 bara' }))
    const p = (m: ReturnType<typeof buildProcessModel>) =>
      m.nodes.find((n) => n.tag === 'BL-A')!.pressureBar
    expect(p(barg)).toBe(4)
    expect(p(bara)).toBe(4)
  })

  it('it is the OPERATING pressure and never the design rating', () => {
    const rated: Registry = {
      'BL-A': { key: 'BL-A', kind: 'equipment', fields: { 'design.pressure': '20 barg' } },
    }
    const m = buildProcessModel(twoEnds('terminal', 'free'), rated)
    const bl = m.nodes.find((n) => n.tag === 'BL-A')!
    // a rating is what the connection withstands; using it would hold a
    // battery limit at its relief setting
    expect(bl.pressureBar).toBe(DEFAULTS.atmosphericPressureBar)
    expect(bl.boundary).toBe('atmospheric')
  })
})

// ── A-H, the required scenarios ─────────────────────────────────────────────

describe('A-E — pressure drives, and the sign follows', () => {
  it('A: a LEGACY free end is still atmospheric, and its drawing is untouched', () => {
    const m = buildProcessModel(twoEnds('free', 'free'))
    const free = m.nodes.filter((n) => n.kind === 'boundary')
    expect(free).toHaveLength(2)
    for (const n of free) {
      expect(n.boundary).toBe('atmospheric')
      expect(n.pressureBar).toBe(DEFAULTS.atmosphericPressureBar)
      expect(n.tag).toBeUndefined()
    }
    expect(Math.abs(solve(twoEnds('free', 'free')).pipeFlow.t1!)).toBeLessThan(MASS_TOL)
  })

  it('B: an explicit 3 barg terminal is held at 4 bar absolute', () => {
    const m = buildProcessModel(twoEnds('terminal', 'free'), at({ 'BL-A': '3 barg' }))
    const bl = m.nodes.find((n) => n.tag === 'BL-A')!
    expect(bl.boundary).toBe('fixed-pressure')
    expect(bl.pressureBar).toBe(4)
    expect(solve(twoEnds('terminal', 'free'), at({ 'BL-A': '3 barg' })).pressure[bl.id]).toBe(4)
  })

  it('C: 3 barg to 1 barg drives flow the canonical way', () => {
    const r = solve(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg', 'BL-B': '1 barg' }))
    expect(r.converged).toBe(true)
    // t1 is drawn BL-A -> valve, so positive is A toward B
    expect(r.pipeFlow.t1!).toBeGreaterThan(1)
    expect(r.pipeFlow.t2!).toBeGreaterThan(1)
    expect(Math.abs(r.pipeFlow.t1! - r.pipeFlow.t2!)).toBeLessThan(MASS_TOL)
  })

  it('D: swap the two RECORDS and the same drawing runs backwards', () => {
    const forward = solve(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg', 'BL-B': '1 barg' }))
    const reverse = solve(twoEnds('terminal', 'terminal'), at({ 'BL-A': '1 barg', 'BL-B': '3 barg' }))
    expect(forward.pipeFlow.t1!).toBeGreaterThan(1)
    expect(reverse.pipeFlow.t1!).toBeLessThan(-1)
    // The drawing did not change at all — only the records did, so the two
    // magnitudes are the same answer. To within `MASS_TOL`, which is the
    // precision a converged solve is defined to and not a tolerance chosen to
    // make this pass: Newton stops when the worst junction residual is under
    // it, so demanding more would be demanding something never claimed.
    expect(Math.abs(Math.abs(reverse.pipeFlow.t1!) - Math.abs(forward.pipeFlow.t1!)))
      .toBeLessThan(MASS_TOL)
  })

  it('E: equal pressures move nothing', () => {
    const r = solve(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg', 'BL-B': '3 barg' }))
    expect(Math.abs(r.pipeFlow.t1!)).toBeLessThan(MASS_TOL)
    expect(Math.abs(r.pipeFlow.t2!)).toBeLessThan(MASS_TOL)
  })

  it('and the flow grows with the differential, monotonically', () => {
    const q = (barg: number) =>
      solve(twoEnds('terminal', 'terminal'), at({ 'BL-A': `${barg} barg`, 'BL-B': '1 barg' })).pipeFlow.t1!
    expect(q(1)).toBeCloseTo(0, 3)
    expect(q(2)).toBeGreaterThan(q(1))
    expect(q(4)).toBeGreaterThan(q(2))
  })
})

describe('F, G — a terminal either side of a machine', () => {
  const pumped = (suction: 'terminal' | 'free'): HmiScreen => ({
    id: 'pg', name: 'PG', theme: 'classic',
    widgets: [
      ...(suction === 'terminal' ? [terminal('bs', 'BL-S', 0, 100)] : []),
      { id: 'p', type: 'pump', x: 300, y: 90, w: 56, h: 56, tag: 'P-1' },
      terminal('bd', 'BL-D', 800, 100),
    ],
    pipes: [
      { id: 'f1', points: [{ x: 0, y: 112 }, { x: 296, y: 118 }],
        ...(suction === 'terminal' ? { aId: 'bs', aPort: 'process' } : {}), bId: 'p', bPort: 'suction' },
      { id: 'f2', points: [{ x: 360, y: 118 }, { x: 804, y: 112 }], aId: 'p', aPort: 'discharge', bId: 'bd', bPort: 'process' },
    ],
  })

  it('F: a pump on a 3 barg terminal is offered that pressure, not atmosphere', () => {
    const m = buildProcessModel(pumped('terminal'), at({ 'BL-S': '3 barg', 'BL-D': '1 barg' }))
    const suction = m.edges.find((e) => e.kind === 'pump')!.from
    const held = solveHydraulics(m, inputs({ pumpSpeed: () => 0 }))
    const vented = solveHydraulics(
      buildProcessModel(pumped('free'), at({ 'BL-D': '1 barg' })), inputs({ pumpSpeed: () => 0 }))
    const ventedSuction = buildProcessModel(pumped('free'), at({ 'BL-D': '1 barg' }))
      .edges.find((e) => e.kind === 'pump')!.from
    // exactly three bar more available at the machine, from the record alone
    expect(held.pressure[suction]! - vented.pressure[ventedSuction]!).toBeCloseTo(3, 6)
  })

  it('G: a terminal on the discharge sets where the machine settles', () => {
    const easy = solveHydraulics(buildProcessModel(pumped('terminal'),
      at({ 'BL-S': '1 barg', 'BL-D': '1 barg' })), inputs())
    const hard = solveHydraulics(buildProcessModel(pumped('terminal'),
      at({ 'BL-S': '1 barg', 'BL-D': '3 barg' })), inputs())
    // a stiffer destination pushes the machine back up its curve: less flow,
    // and the operating point moved because the BOUNDARY moved
    expect(hard.pipeFlow.f2!).toBeLessThan(easy.pipeFlow.f2!)
    expect(easy.pipeFlow.f2!).toBeGreaterThan(1)
    // ...and the pump is still adding head rather than being one
    const m = buildProcessModel(pumped('terminal'), at({ 'BL-S': '1 barg', 'BL-D': '3 barg' }))
    const e = m.edges.find((x) => x.kind === 'pump')!
    expect(hard.pressure[e.to]! - hard.pressure[e.from]!).toBeGreaterThan(0.5)
  })

  it('MULTIPLE terminals stay independent — no global pressure', () => {
    const m = buildProcessModel(pumped('terminal'), at({ 'BL-S': '2 barg', 'BL-D': '5 barg' }))
    const s = m.nodes.find((n) => n.tag === 'BL-S')!
    const d = m.nodes.find((n) => n.tag === 'BL-D')!
    expect(s.pressureBar).toBe(3)
    expect(d.pressureBar).toBe(6)
    const r = solveHydraulics(m, inputs())
    expect(r.pressure[s.id]).toBe(3)
    expect(r.pressure[d.id]).toBe(6)
  })
})

// ── H, §12. Diagnostics ─────────────────────────────────────────────────────

describe('H — an incomplete terminal is reported, not quietly filled in', () => {
  const run = (sc: HmiScreen, reg?: Registry) => {
    const ix = buildIndex(docOf(sc, reg))
    return [...terminalNoPressure.run(ix), ...terminalBadPressure.run(ix)]
  }

  it('a VALID terminal says nothing', () => {
    expect(run(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg', 'BL-B': '1 barg' }))).toEqual([])
  })

  it('a LEGACY free end says nothing — silence there is not a terminal', () => {
    expect(run(twoEnds('free', 'free'))).toEqual([])
  })

  it('a MISSING pressure is a finding, and the model still solves at atmosphere', () => {
    const out = run(twoEnds('terminal', 'free'))
    expect(out).toHaveLength(1)
    expect(out[0]!.ruleId).toBe('terminal-no-pressure')
    expect(out[0]!.entityKey).toBe('BL-A')
    expect(out[0]!.message).toMatch(/atmosphere/i)
    // the plant is not broken by an unfinished record
    const m = buildProcessModel(twoEnds('terminal', 'free'))
    const bl = m.nodes.find((n) => n.tag === 'BL-A')!
    expect(bl.boundary).toBe('atmospheric')
    expect(bl.pressureBar).toBe(DEFAULTS.atmosphericPressureBar)
  })

  it('an INVALID pressure is a finding, and never becomes a fake number', () => {
    for (const bad of ['NaN', 'lots', '3 furlongs', 'Infinity', '--4 barg']) {
      const out = run(twoEnds('terminal', 'free'), at({ 'BL-A': bad }))
      expect(out.map((f) => f.ruleId), bad).toEqual(['terminal-bad-pressure'])
      const bl = buildProcessModel(twoEnds('terminal', 'free'), at({ 'BL-A': bad }))
        .nodes.find((n) => n.tag === 'BL-A')!
      // atmosphere, stated — not zero, not NaN, not the string coerced
      expect(bl.pressureBar, bad).toBe(DEFAULTS.atmosphericPressureBar)
      expect(Number.isFinite(bl.pressureBar!), bad).toBe(true)
    }
  })

  it('a non-finite pressure never reaches the solve', () => {
    const r = solve(twoEnds('terminal', 'terminal'), at({ 'BL-A': 'NaN', 'BL-B': 'Infinity' }))
    for (const v of Object.values(r.pressure)) expect(Number.isFinite(v)).toBe(true)
    for (const v of Object.values(r.pipeFlow)) expect(Number.isFinite(v)).toBe(true)
  })

  it('both rules are registered in the existing Checks engine', () => {
    const ids = new Set(ALL_RULES.map((r) => r.id))
    expect(ids).toContain('terminal-no-pressure')
    expect(ids).toContain('terminal-bad-pressure')
  })
})

// ── §10, §13. Instruments and preservation ──────────────────────────────────

describe('adding a terminal takes nothing away', () => {
  it('an instrument on the terminal pipe still reads ITS OWN edge', () => {
    const withPT: HmiScreen = {
      ...twoEnds('terminal', 'terminal'), id: 'pt',
      widgets: [...twoEnds('terminal', 'terminal').widgets,
        { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 't1' } }],
    }
    const m = buildSimModel(withPT, at({ 'BL-A': '3 barg', 'BL-B': '1 barg' }))
    expect(m.defs.find((d) => d.name === 'PT-1')!.bindPipe).toBe('t1')
    const r = solveHydraulics(m.hydraulic, inputs())
    const e = m.hydraulic.edges.find((x) => x.id === m.hydraulic.edgeOfPipe.get('t1'))!
    const mid = ((r.pressure[e.from] ?? 0) + (r.pressure[e.to] ?? 0)) / 2
    // the MEAN of its line's two ends, which is where the tapping is — NOT the
    // terminal's own 4 bar, because the instrument is not at the battery limit
    expect(mid).toBeLessThan(4)
    expect(mid).toBeGreaterThan(r.pressure[e.to]!)
  })

  it('the pipe is not disconnected: the terminal is an extra participant', () => {
    const free = buildProcessModel(twoEnds('free', 'free'))
    const term = buildProcessModel(twoEnds('terminal', 'terminal'), at({ 'BL-A': '3 barg', 'BL-B': '1 barg' }))
    // same pipes, same edges, same valve — the terminal replaced two anonymous
    // free-end nodes with two tagged ones and added nothing else
    expect(term.edges.map((e) => e.kind).sort()).toEqual(free.edges.map((e) => e.kind).sort())
    expect([...term.edgeOfPipe.keys()].sort()).toEqual([...free.edgeOfPipe.keys()].sort())
    expect(term.nodes).toHaveLength(free.nodes.length)
    // and every endpoint still resolves
    const ids = new Set(term.nodes.map((n) => n.id))
    expect(term.edges.flatMap((e) => [e.from, e.to]).filter((n) => !ids.has(n))).toEqual([])
  })

  it('LEGACY: a drawing with no terminals compiles exactly as it did', () => {
    const plain = buildProcessModel(twoEnds('free', 'free'))
    const withRegistry = buildProcessModel(twoEnds('free', 'free'), at({ 'BL-A': '3 barg' }))
    // a record for a tag that is not on the drawing changes nothing
    expect(withRegistry.nodes.map((n) => `${n.id}:${n.boundary}:${n.pressureBar ?? ''}`))
      .toEqual(plain.nodes.map((n) => `${n.id}:${n.boundary}:${n.pressureBar ?? ''}`))
  })

  it('a terminal with NO tag cannot state anything, and falls back', () => {
    const untagged: HmiScreen = {
      ...twoEnds('free', 'free'), id: 'ut',
      widgets: [{ id: 'ba', type: 'equip', x: 0, y: 100, w: 48, h: 24, props: { symbolId: 'bl.terminal' } },
        ...twoEnds('free', 'free').widgets],
      pipes: twoEnds('free', 'free').pipes.map((p) =>
        p.id === 't1' ? { ...p, aId: 'ba', aPort: 'process' } : p),
    }
    const m = buildProcessModel(untagged, at({ 'BL-A': '3 barg' }))
    const bl = m.nodes.find((n) => n.id.includes('ba'))!
    expect(bl.kind).toBe('boundary')
    expect(bl.pressureBar).toBe(DEFAULTS.atmosphericPressureBar)
  })
})
