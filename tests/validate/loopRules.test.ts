// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 2 — the seven persistent-loop rules.
 *
 * Two things these guard beyond "does the rule fire":
 *
 *  - A project that has declared no persistent loops must gain NOTHING. That
 *    is the whole migration promise, and it is asserted first.
 *  - The rules must not overlap. A broken membership is `orphan-record`'s
 *    finding, not also `loop-incomplete`'s; a member in a deleted unit is
 *    `record-orphan-unit`'s, not also `loop-units-conflict`'s. One fact, one
 *    finding — the engine de-duplicates per (rule, entity), not across rules.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules, resetQaCache } from '../../src/validate/engine'
import { ALL_RULES } from '../../src/validate/rules/index'
import { newLoop, type Loop, type LoopType } from '../../src/model/loop'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import type { EngineeringRecord, Registry } from '../../src/model/registry'
import type { PlantEdge, PlantNode, ProjectDoc, Tag } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

let seq = 0
const node = (tag: Tag, over: Partial<PlantNode> = {}): PlantNode => ({
  id: `n${seq++}`,
  symbolId: 'instr.bubble',
  kind: 'instrument',
  x: 0, y: 0, rotation: 0,
  tag,
  ...over,
})

/** An instrument wired to the DCS, so `classifyIo` has a signal line to read. */
const wired = (id: string): PlantEdge => ({
  id: `e-${id}`,
  lineClass: 'signal.electric',
  source: { nodeId: id, portId: 'e' },
  target: { nodeId: 'dcs', portId: 'w' },
})

const dcs: PlantNode = { id: 'dcs', symbolId: 'ctl.dcs', kind: 'equipment', x: 999, y: 999, rotation: 0 }

function docOf(opts: {
  loops?: Loop[]
  nodes?: PlantNode[]
  edges?: PlantEdge[]
  registry?: Registry
  areas?: ProjectDoc['areas']
  units?: ProjectDoc['units']
}): ProjectDoc {
  const d = createEmptyDoc('qa')
  d.sheets[0]!.nodes = opts.nodes ?? []
  d.sheets[0]!.edges = opts.edges ?? []
  return {
    ...d,
    ...(opts.loops ? { loops: opts.loops } : {}),
    ...(opts.registry ? { registry: opts.registry } : {}),
    ...(opts.areas ? { areas: opts.areas } : {}),
    ...(opts.units ? { units: opts.units } : {}),
  }
}

const rec = (key: string, over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, ...over })

/** Findings for one rule, in the order the engine reports them. */
function findingsFor(doc: ProjectDoc, ruleId: string, standard = DEFAULT_STANDARD) {
  const report = runRules(buildIndex({ ...doc, standard }))
  return report.groups.find((g) => g.rule.id === ruleId)?.findings ?? []
}
const ruleIds = (doc: ProjectDoc) =>
  runRules(buildIndex(doc)).groups.map((g) => g.rule.id)

/** A three-member control loop: LT wired in, LIC, LV with a positioner. */
function controlLoop(type?: LoopType) {
  const loop = newLoop('101', type ? { type } : {})
  const lt = node({ letters: 'LT', loop: '101' }, { id: 'lt' })
  const lic = node({ letters: 'LIC', loop: '101' }, { id: 'lic' })
  const lv = node({ letters: 'LV', loop: '101' }, { id: 'lv', kind: 'valve', symbolId: 'cv.globe', config: { positioner: 'yes' } })
  return {
    loop,
    doc: docOf({
      loops: [loop],
      nodes: [dcs, lt, lic, lv],
      edges: [wired('lt'), wired('lv')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
        'LV-101': rec('LV-101', { kind: 'valve', loopId: loop.id }),
      },
    }),
  }
}

beforeEach(() => { resetQaCache() })

/* ------------------------------------------- the migration promise, first */

describe('a project with no persistent loops gains nothing', () => {
  const LOOP_RULE_IDS = [
    'record-orphan-loop', 'duplicate-loop-number', 'loop-incomplete',
    'loop-units-conflict', 'loop-io-conflict', 'loop-type-unstated', 'loop-empty',
  ]

  it('reports no loop finding on an empty document', () => {
    const ids = ruleIds(createEmptyDoc('bare'))
    for (const id of LOOP_RULE_IDS) expect(ids).not.toContain(id)
  })

  it('reports no loop finding on a drawn project that never declared one', () => {
    const doc = docOf({
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' })],
      edges: [wired('lt')],
      registry: { 'LT-101': rec('LT-101'), 'LIC-101': rec('LIC-101') },
    })
    expect(doc.loops).toBeUndefined()
    const ids = ruleIds(doc)
    for (const id of LOOP_RULE_IDS) expect(ids).not.toContain(id)
  })

  it('and the derived-loop rules go on reporting exactly as before', () => {
    // `instrument-not-in-loop` reads ix.loops, the DERIVED grouping. Adding a
    // persistent loop must not change what it says.
    const nodes = [dcs, node({ letters: 'PT', loop: '900' }, { id: 'pt' })]
    const edges = [wired('pt')]
    const without = docOf({ nodes, edges, registry: { 'PT-900': rec('PT-900') } })
    const loop = newLoop('900', { type: 'indication' })
    const withLoop = docOf({ loops: [loop], nodes, edges, registry: { 'PT-900': rec('PT-900', { loopId: loop.id }) } })

    const derived = (d: ProjectDoc) =>
      findingsFor(d, 'instrument-not-in-loop').map((f) => f.message)
    expect(derived(withLoop)).toEqual(derived(without))
    expect(derived(without)).toHaveLength(1)
  })
})

/* ---------------------------------------------------- 1. record-orphan-loop */

describe('record-orphan-loop', () => {
  it('reports a record whose loop is not in the project', () => {
    const doc = docOf({
      loops: [],
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' })],
      registry: { 'LT-101': rec('LT-101', { loopId: 'ghost' }) },
    })
    const found = findingsFor(doc, 'record-orphan-loop')
    expect(found).toHaveLength(1)
    expect(found[0]!.entityKey).toBe('LT-101')
    expect(found[0]!.message).toMatch(/not in this project/i)
    expect(found[0]!.targetId).toBe('lt')
  })

  it('is critical', () => {
    const doc = docOf({ loops: [], registry: { 'LT-101': rec('LT-101', { loopId: 'ghost' }) } })
    const report = runRules(buildIndex(doc))
    expect(report.groups.find((g) => g.rule.id === 'record-orphan-loop')!.rule.severity).toBe('critical')
  })

  it('reports each stranded record independently — they do not collapse', () => {
    const doc = docOf({
      loops: [],
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' })],
      registry: {
        'LT-101': rec('LT-101', { loopId: 'ghost' }),
        'LIC-101': rec('LIC-101', { loopId: 'ghost' }),
      },
    })
    const found = findingsFor(doc, 'record-orphan-loop')
    expect(found).toHaveLength(2)
    expect(new Set(found.map((f) => f.key)).size).toBe(2)
    expect(found.map((f) => f.entityKey)).toEqual(['LIC-101', 'LT-101'])
  })

  it('offers a targeted clear-loop fix, and never invents the loop back', () => {
    const doc = docOf({ loops: [], registry: { 'LT-101': rec('LT-101', { loopId: 'ghost' }) } })
    const fix = findingsFor(doc, 'record-orphan-loop')[0]!.fix
    expect(fix!.spec).toEqual({ kind: 'clear-loop', key: 'LT-101' })
    expect(doc.loops).toHaveLength(0)
  })

  it('says nothing when every reference resolves', () => {
    expect(findingsFor(controlLoop('control').doc, 'record-orphan-loop')).toHaveLength(0)
  })
})

/* ------------------------------------------------- 2. duplicate-loop-number */

describe('duplicate-loop-number', () => {
  const twoNumbered = (a: string, b: string) => {
    const l1 = newLoop(a)
    const l2 = newLoop(b)
    return docOf({ loops: [l1, l2] })
  }

  it('reports both loops when a number is used twice', () => {
    const found = findingsFor(twoNumbered('101', '101'), 'duplicate-loop-number')
    expect(found).toHaveLength(2)
    expect(new Set(found.map((f) => f.key)).size).toBe(2)
    for (const f of found) expect(f.message).toMatch(/shares its number with 1 other loop/i)
  })

  it('is critical, and never renames or de-duplicates', () => {
    const doc = twoNumbered('101', '101')
    const report = runRules(buildIndex(doc))
    expect(report.groups.find((g) => g.rule.id === 'duplicate-loop-number')!.rule.severity).toBe('critical')
    expect(doc.loops!.map((l) => l.number)).toEqual(['101', '101'])
  })

  it('matches on the trimmed, case-folded number', () => {
    expect(findingsFor(twoNumbered('F-101', ' f-101 '), 'duplicate-loop-number')).toHaveLength(2)
  })

  it('says nothing when numbers differ, or when a number is blank', () => {
    expect(findingsFor(twoNumbered('101', '102'), 'duplicate-loop-number')).toHaveLength(0)
    // Two blanks are not a collision — there is nothing to collide on.
    expect(findingsFor(twoNumbered('', ''), 'duplicate-loop-number')).toHaveLength(0)
  })
})

/* ------------------------------------------------------- 3. loop-incomplete */

describe('loop-incomplete', () => {
  it('says nothing about a structurally complete control loop', () => {
    expect(findingsFor(controlLoop('control').doc, 'loop-incomplete')).toHaveLength(0)
  })

  it('reports a control loop with no final element, and names what is missing', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' })],
      edges: [wired('lt')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
      },
    })
    const found = findingsFor(doc, 'loop-incomplete')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toMatch(/final control element/i)
  })

  it('is a warning, and its wording claims structure only', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' })],
      registry: { 'LT-101': rec('LT-101', { loopId: loop.id }) },
    })
    const report = runRules(buildIndex(doc))
    const group = report.groups.find((g) => g.rule.id === 'loop-incomplete')!
    expect(group.rule.severity).toBe('warning')
    expect(group.findings[0]!.message).toMatch(/structurally incomplete/i)
    expect(group.findings[0]!.message).toMatch(/not whether the scheme is correct/i)
    expect(group.rule.why).toMatch(/structure only/i)
    // It must never claim the design is wrong.
    expect(group.findings[0]!.message).not.toMatch(/\b(wrong|invalid|incorrect design)\b/i)
  })

  it('does not fire on an empty loop — that is loop-empty', () => {
    const doc = docOf({ loops: [newLoop('101', { type: 'control' })] })
    expect(findingsFor(doc, 'loop-incomplete')).toHaveLength(0)
    expect(findingsFor(doc, 'loop-empty')).toHaveLength(1)
  })

  it('does not fire on a broken loop — orphan-record already reports that', () => {
    const loop = newLoop('101', { type: 'control' })
    // The record exists; nothing on any sheet wears its key.
    const doc = docOf({ loops: [loop], registry: { 'LT-101': rec('LT-101', { loopId: loop.id }) } })
    expect(findingsFor(doc, 'loop-incomplete')).toHaveLength(0)
    expect(findingsFor(doc, 'orphan-record')).toHaveLength(1)
  })

  it('does not fire on safety, which is not judged structurally', () => {
    const loop = newLoop('101', { type: 'safety' })
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LSHH', loop: '101' }, { id: 'ls' })],
      registry: { 'LSHH-101': rec('LSHH-101', { loopId: loop.id }) },
    })
    expect(findingsFor(doc, 'loop-incomplete')).toHaveLength(0)
  })

  it('uses a safely SUGGESTED type when none is stated', () => {
    // LT + LIC with no final element suggests `indication`, which needs none —
    // so a suggestion must not manufacture an incompleteness.
    const loop = newLoop('101')
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' })],
      edges: [wired('lt')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
      },
    })
    expect(findingsFor(doc, 'loop-incomplete')).toHaveLength(0)
    expect(findingsFor(doc, 'loop-type-unstated')).toHaveLength(0)
  })
})

/* --------------------------------------------------- 4. loop-units-conflict */

describe('loop-units-conflict', () => {
  const areas = [{ id: 'a1', code: '100' }]
  const units = [
    { id: 'u1', areaId: 'a1', code: 'U-101' },
    { id: 'u2', areaId: 'a1', code: 'U-102' },
  ]

  const withUnits = (ltUnit?: string, licUnit?: string) => {
    const loop = newLoop('101', { type: 'control' })
    return docOf({
      loops: [loop],
      areas, units,
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' }),
        node({ letters: 'LV', loop: '101' }, { id: 'lv', kind: 'valve', symbolId: 'cv.globe' })],
      edges: [wired('lt')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id, ...(ltUnit ? { unitId: ltUnit } : {}) }),
        'LIC-101': rec('LIC-101', { loopId: loop.id, ...(licUnit ? { unitId: licUnit } : {}) }),
        'LV-101': rec('LV-101', { kind: 'valve', loopId: loop.id }),
      },
    })
  }

  it('reports members split across two units, naming the codes', () => {
    const found = findingsFor(withUnits('u1', 'u2'), 'loop-units-conflict')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toMatch(/2 units: U-101, U-102/)
  })

  it('is a warning', () => {
    const report = runRules(buildIndex(withUnits('u1', 'u2')))
    expect(report.groups.find((g) => g.rule.id === 'loop-units-conflict')!.rule.severity).toBe('warning')
  })

  it('says nothing when every assigned member shares one unit', () => {
    expect(findingsFor(withUnits('u1', 'u1'), 'loop-units-conflict')).toHaveLength(0)
  })

  it('ignores unassigned members rather than counting them as a third unit', () => {
    expect(findingsFor(withUnits('u1', undefined), 'loop-units-conflict')).toHaveLength(0)
    expect(findingsFor(withUnits(undefined, undefined), 'loop-units-conflict')).toHaveLength(0)
  })

  it('two units of the SAME area is still a conflict — area is not the subject', () => {
    // u1 and u2 are both in area 100, and it still reports.
    expect(findingsFor(withUnits('u1', 'u2'), 'loop-units-conflict')).toHaveLength(1)
  })

  it('a member in a DELETED unit is record-orphan-unit, not a units conflict', () => {
    const doc = withUnits('u1', 'gone')
    expect(findingsFor(doc, 'loop-units-conflict')).toHaveLength(0)
    expect(findingsFor(doc, 'record-orphan-unit')).toHaveLength(1)
  })

  it('never reads general.area free text', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      areas, units,
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' })],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id, unitId: 'u1' }),
        'LIC-101': rec('LIC-101', { loopId: loop.id, fields: { 'general.area': 'Somewhere else entirely' } }),
      },
    })
    expect(findingsFor(doc, 'loop-units-conflict')).toHaveLength(0)
  })
})

/* ------------------------------------------------------ 5. loop-io-conflict */

describe('loop-io-conflict', () => {
  it('says nothing about a control loop with an input and an output', () => {
    // LT wired -> AI; LV with a positioner wired -> AO.
    const { doc } = controlLoop('control')
    expect(findingsFor(doc, 'loop-io-conflict')).toHaveLength(0)
  })

  it('reports a driven loop whose members are all inputs', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' }),
        node({ letters: 'PT', loop: '101' }, { id: 'pt' })],
      edges: [wired('lt'), wired('pt')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
        'PT-101': rec('PT-101', { loopId: loop.id }),
      },
    })
    const found = findingsFor(doc, 'loop-io-conflict')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toMatch(/nothing the control system drives/i)
  })

  it('is a warning', () => {
    // A control loop with one wired transmitter and nothing else: classified,
    // an input, no output. It must fire — an `if (group)` here would make this
    // test pass whether or not the rule exists.
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' })],
      edges: [wired('lt')],
      registry: { 'LT-101': rec('LT-101', { loopId: loop.id }) },
    })
    const report = runRules(buildIndex(doc))
    const g = report.groups.find((x) => x.rule.id === 'loop-io-conflict')
    expect(g, 'loop-io-conflict should have fired').toBeDefined()
    expect(g!.rule.severity).toBe('warning')
    expect(g!.findings).toHaveLength(1)
  })

  it('an UNKNOWN classification silences the rule rather than becoming a conflict', () => {
    // A final element with a signal line but nothing stating its actuator is
    // `unknown` to classifyIo. That must not read as "no output".
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }),
        node({ letters: 'LIC', loop: '101' }, { id: 'lic' }),
        node({ letters: 'LV', loop: '101' }, { id: 'lv', kind: 'valve', symbolId: 'valve.gate' })],
      edges: [wired('lt'), wired('lv')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
        'LV-101': rec('LV-101', { kind: 'valve', loopId: loop.id }),
      },
    })
    // Proof the member really is unclassifiable, so the test cannot pass by
    // accident if the classifier changes.
    expect(findingsFor(doc, 'io-type-unclassified').length).toBeGreaterThan(0)
    expect(findingsFor(doc, 'loop-io-conflict')).toHaveLength(0)
  })

  it('says nothing when no member is an I/O point at all', () => {
    // Nothing wired: every member is `none`, so the loop is unfinished rather
    // than contradictory. dead-end-instrument already reports that.
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' }),
        node({ letters: 'LV', loop: '101' }, { id: 'lv', kind: 'valve', symbolId: 'cv.globe' })],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
        'LV-101': rec('LV-101', { kind: 'valve', loopId: loop.id }),
      },
    })
    expect(findingsFor(doc, 'loop-io-conflict')).toHaveLength(0)
  })

  it('says nothing about an indication loop, which drives nothing by design', () => {
    const loop = newLoop('101', { type: 'indication' })
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LI', loop: '101' }, { id: 'li' })],
      edges: [wired('lt')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LI-101': rec('LI-101', { loopId: loop.id }),
      },
    })
    expect(findingsFor(doc, 'loop-io-conflict')).toHaveLength(0)
  })

  it('says nothing when the type is unknown — there is nothing to contradict', () => {
    const loop = newLoop('101')
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' })],
      edges: [wired('lt')],
      registry: { 'LT-101': rec('LT-101', { loopId: loop.id }) },
    })
    expect(findingsFor(doc, 'loop-io-conflict')).toHaveLength(0)
  })

  it('a stated I/O type on the record is honoured, as the I/O list honours it', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }),
        node({ letters: 'LV', loop: '101' }, { id: 'lv', kind: 'valve', symbolId: 'valve.gate' })],
      edges: [wired('lt'), wired('lv')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        // Unclassifiable from the drawing; stated on the record instead.
        'LV-101': rec('LV-101', { kind: 'valve', loopId: loop.id, fields: { 'signal.type': 'AO' } }),
      },
    })
    expect(findingsFor(doc, 'loop-io-conflict')).toHaveLength(0)
  })
})

/* ---------------------------------------------------- 6. loop-type-unstated */

describe('loop-type-unstated', () => {
  it('reports a loop whose members do not say what kind it is', () => {
    const loop = newLoop('101')
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LY', loop: '101' }, { id: 'ly' })],
      registry: { 'LY-101': rec('LY-101', { loopId: loop.id }) },
    })
    const found = findingsFor(doc, 'loop-type-unstated')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toMatch(/no stated type/i)
  })

  it('is info', () => {
    const loop = newLoop('101')
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LY', loop: '101' }, { id: 'ly' })],
      registry: { 'LY-101': rec('LY-101', { loopId: loop.id }) },
    })
    const report = runRules(buildIndex(doc))
    expect(report.groups.find((g) => g.rule.id === 'loop-type-unstated')!.rule.severity).toBe('info')
  })

  it('never guesses control, and stays quiet when a type IS safely suggested', () => {
    const { doc } = controlLoop()
    expect(doc.loops![0]!.type).toBeUndefined()
    expect(findingsFor(doc, 'loop-type-unstated')).toHaveLength(0)
  })

  it('says nothing when the type is stated, or when the loop is empty', () => {
    expect(findingsFor(controlLoop('control').doc, 'loop-type-unstated')).toHaveLength(0)
    expect(findingsFor(docOf({ loops: [newLoop('101')] }), 'loop-type-unstated')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------- 7. loop-empty */

describe('loop-empty', () => {
  it('reports a loop with nothing assigned to it, as info', () => {
    const doc = docOf({ loops: [newLoop('101')] })
    const report = runRules(buildIndex(doc))
    const g = report.groups.find((x) => x.rule.id === 'loop-empty')!
    expect(g.rule.severity).toBe('info')
    expect(g.findings).toHaveLength(1)
    expect(g.findings[0]!.message).toMatch(/no members/i)
  })

  it('is NOT also reported as broken, incomplete or an orphan record', () => {
    const doc = docOf({ loops: [newLoop('101', { type: 'control' })] })
    const ids = ruleIds(doc)
    expect(ids).toContain('loop-empty')
    expect(ids).not.toContain('loop-incomplete')
    expect(ids).not.toContain('record-orphan-loop')
    expect(ids).not.toContain('orphan-record')
  })

  it('says nothing once a member is assigned', () => {
    expect(findingsFor(controlLoop('control').doc, 'loop-empty')).toHaveLength(0)
  })
})

/* ------------------------------------------- identity, determinism, overrides */

describe('finding identity and determinism', () => {
  it('keys are deterministic and stable across runs', () => {
    const doc = docOf({ loops: [newLoop('101'), newLoop('101')] })
    const once = findingsFor(doc, 'duplicate-loop-number').map((f) => f.key)
    resetQaCache()
    const twice = findingsFor(doc, 'duplicate-loop-number').map((f) => f.key)
    expect(once).toEqual(twice)
    expect(new Set(once).size).toBe(2)
  })

  it('loop findings are keyed by the stable id, so a renumber keeps an acceptance', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' })],
      registry: { 'LT-101': rec('LT-101', { loopId: loop.id }) },
    })
    const before = findingsFor(doc, 'loop-incomplete')[0]!.key
    const renumbered = { ...doc, loops: [{ ...loop, number: '201' }] }
    resetQaCache()
    expect(findingsFor(renumbered, 'loop-incomplete')[0]!.key).toBe(before)
  })

  it('ordering is fixed however the loops array is arranged', () => {
    const a = newLoop('101')
    const b = newLoop('102')
    const forward = docOf({ loops: [a, b] })
    const reversed = docOf({ loops: [b, a] })
    const keys = (d: ProjectDoc) => { resetQaCache(); return findingsFor(d, 'loop-empty').map((f) => f.key) }
    expect(keys(forward)).toEqual(keys(reversed))
  })

  it('honours a severity override, and an `off` switches the rule out entirely', () => {
    const doc = docOf({ loops: [newLoop('101'), newLoop('101')] })
    const lowered = { ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-loop-number': 'info' as const } }
    const report = runRules(buildIndex({ ...doc, standard: lowered }))
    expect(report.groups.find((g) => g.rule.id === 'duplicate-loop-number')!.rule.severity).toBe('info')

    const off = { ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-loop-number': 'off' as const } }
    const silenced = runRules(buildIndex({ ...doc, standard: off }))
    expect(silenced.groups.find((g) => g.rule.id === 'duplicate-loop-number')).toBeUndefined()
    // And switching it off is RECORDED, so "nothing found" stays telling apart
    // from "nobody looked".
    expect(silenced.rulesDisabled).toContain('duplicate-loop-number')
  })

  it('all seven rules are registered and evaluated', () => {
    const ids = new Set(ALL_RULES.map((r) => r.id))
    for (const id of [
      'record-orphan-loop', 'duplicate-loop-number', 'loop-incomplete',
      'loop-units-conflict', 'loop-io-conflict', 'loop-type-unstated', 'loop-empty',
    ]) {
      expect(ids.has(id), `${id} is not registered`).toBe(true)
    }
    // Registered means EVALUATED — a rule in the array that never ran would be
    // a check nobody performs while the report claims otherwise.
    const report = runRules(buildIndex(createEmptyDoc('x')))
    expect(report.rulesEvaluated).toBe(ALL_RULES.length)
  })
})
