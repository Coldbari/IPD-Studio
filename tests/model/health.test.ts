// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-5 — the project health projection.
 *
 * What this file is really protecting, in order:
 *
 *  1. NOTHING IS RECOMPUTED. Counts reconcile with the report row builders and
 *     QA counts reconcile with the QA engine, because the dashboard reads them
 *     rather than working them out again.
 *  2. AN ABSENT DENOMINATOR IS NOT ZERO. A project with no started equipment
 *     records is not 0% complete on equipment, and the difference decides
 *     whether somebody believes the number.
 *  3. NOTHING USER-VISIBLE IS NaN, Infinity OR 0-BY-ACCIDENT.
 *  4. Only STARTED records are measured — the `required-field-empty` rule's own
 *     definition, lifted so the two cannot disagree about who is counted.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { newArea, newUnit } from '../../src/model/hierarchy'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { projectHealth, percentText, HEALTH_KINDS } from '../../src/model/health'
import { runRules, qaFor } from '../../src/validate/engine'
import { equipmentListRows, lineListRows, valveListRows } from '../../src/export/csv'
import type { EngineeringRecord } from '../../src/model/registry'
import type { PlantEdge, PlantNode, ProjectDoc, Revision, Sheet } from '../../src/model/types'
import type { StandardProfile } from '../../src/model/standard'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })

const vessel = (id: string, loop: string, over: Partial<PlantNode> = {}) =>
  node(id, 'equipment', 'vessel.vertical', { tag: { letters: 'TK', loop }, ...over })
const valve = (id: string, loop: string) =>
  node(id, 'valve', 'valve.gate', { tag: { letters: 'FV', loop } })
const instrument = (id: string, loop: string) =>
  node(id, 'instrument', 'instr.bubble', { tag: { letters: 'LT', loop } })

const LINE = { size: '6"', spec: 'CS150', service: 'CW', seq: '001' }
const LINE_KEY = '6"-CS150-CW-001'

const pipe = (id: string, a: string, b: string, over: Partial<PlantEdge> = {}): PlantEdge => ({
  id,
  lineClass: 'process.major',
  source: { nodeId: a, portId: 'e' },
  target: { nodeId: b, portId: 'w' },
  ...over,
})

const sheetOf = (id: string, nodes: PlantNode[], edges: PlantEdge[] = [], over: Partial<Sheet> = {}): Sheet =>
  ({ ...createSheet(1), id, nodes, edges, ...over })

const rec = (key: string, kind: EngineeringRecord['kind'], over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind, fields: {}, ...over })

const docOf = (
  sheets: Sheet[],
  registry: Record<string, EngineeringRecord> = {},
  over: Partial<ProjectDoc> = {},
): ProjectDoc => ({ ...createEmptyDoc('health'), sheets, registry, ...over })

/** Health off one index and the QA report for the same document. */
const health = (doc: ProjectDoc) => {
  const ix = buildIndex(doc)
  return projectHealth(ix, runRules(ix, doc.qa?.ignored ?? {}))
}

/* --------------------------------------------------------------- counts */

describe('object counts', () => {
  const doc = docOf([
    sheetOf('s1', [vessel('v1', '101'), vessel('v2', '102'), valve('fv', '101'), instrument('lt', '101')], [
      pipe('e1', 'v1', 'fv', { lineNumber: LINE }),
      pipe('e2', 'fv', 'v2'),
    ]),
    sheetOf('s2', [vessel('v3', '103')]),
  ])

  it('counts by the DRAWING kind, across every sheet', () => {
    expect(health(doc).counts).toMatchObject({ equipment: 3, valves: 1, instruments: 1, sheets: 2 })
  })

  it('counts LINES as physical runs, so a pipe drawn in two segments is one', () => {
    // v1 → fv → v2 passes through the valve, so both edges are one run.
    expect(health(doc).counts.lines).toBe(1)
  })

  it('reconciles with the equipment and valve lists exactly', () => {
    const h = health(doc)
    expect(h.counts.equipment).toBe(equipmentListRows(doc).length)
    expect(h.counts.valves).toBe(valveListRows(doc).length)
  })

  it('reconciles with the line list exactly', () => {
    expect(health(doc).counts.lines).toBe(lineListRows(doc).length)
  })

  it('counts an UNTAGGED symbol, because it is still on the plant', () => {
    const bare = docOf([sheetOf('s1', [node('v', 'equipment', 'vessel.vertical')])])
    expect(health(bare).counts.equipment).toBe(1)
    // …and still reconciles: the equipment list prints it with a blank tag.
    expect(health(bare).counts.equipment).toBe(equipmentListRows(bare).length)
  })

  it('counts neither annotations nor fittings as equipment', () => {
    const mixed = docOf([sheetOf('s1', [
      node('a', 'annotation', 'ann.note'),
      node('t', 'fitting', 'fit.junction'),
      vessel('v', '101'),
    ])])
    expect(health(mixed).counts.equipment).toBe(1)
  })
})

/* --------------------------------------------------------- completeness */

describe('engineering completeness', () => {
  // DEFAULT_STANDARD requires equipment: ['general.service'].
  const started = (fields: Record<string, string>) => rec('TK-101', 'equipment', { fields })

  it('is 100% when every required field is filled', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', '101')])], { 'TK-101': started({ 'general.service': 'Feed' }) })
    const k = health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!
    expect(k).toMatchObject({ records: 1, required: 1, filled: 1, fraction: 1 })
  })

  it('is a fraction when some are filled', () => {
    // Lines require two: spec.size and spec.material.
    const doc = docOf(
      [sheetOf('s1', [vessel('a', '101'), vessel('b', '102')], [pipe('e1', 'a', 'b', { lineNumber: LINE })])],
      { [LINE_KEY]: rec(LINE_KEY, 'line', { fields: { 'spec.size': '6"' } }) },
    )
    const k = health(doc).completeness.byKind.find((x) => x.kind === 'line')!
    expect(k).toMatchObject({ records: 1, required: 2, filled: 1, fraction: 0.5 })
  })

  it('is 0% — a real zero — when a STARTED record has none of them', () => {
    // Started by a field nobody required, so the record is genuinely 0% of what
    // the standard asks for. That is not the same as having no denominator.
    const doc = docOf([sheetOf('s1', [vessel('v', '101')])], { 'TK-101': started({ 'general.type': 'Drum' }) })
    const k = health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!
    expect(k.fraction).toBe(0)
    expect(percentText(k.fraction)).toBe('0%')
  })

  it('counts a record started only by a UNIT assignment', () => {
    const area = newArea('A-10')
    const unit = newUnit(area.id, 'U-101')
    const doc = docOf(
      [sheetOf('s1', [vessel('v', '101')])],
      { 'TK-101': rec('TK-101', 'equipment', { unitId: unit.id }) },
      { areas: [area], units: [unit] },
    )
    expect(health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!.records).toBe(1)
  })

  it('leaves an UNSTARTED record out of the denominator entirely', () => {
    // A tagged vessel nobody has begun specifying. Counting it would drag a
    // fresh drawing to 0% and teach everyone to ignore the number.
    const doc = docOf([sheetOf('s1', [vessel('v', '101')])], { 'TK-101': rec('TK-101', 'equipment') })
    const k = health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!
    expect(k).toMatchObject({ records: 0, required: 0, filled: 0 })
    expect(k.fraction).toBeUndefined()
  })

  it('leaves an object with NO record out of the denominator', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', '101')])])
    expect(health(doc).completeness.byKind.every((k) => k.fraction === undefined)).toBe(true)
  })

  it('leaves an ORPHANED record out — orphan-record owns that, and reports it once', () => {
    const doc = docOf([sheetOf('s1', [])], { 'TK-101': started({ 'general.type': 'Drum' }) })
    expect(health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!.records).toBe(0)
  })

  it('counts OPTIONAL fields towards nothing', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', '101')])], {
      'TK-101': started({ 'general.service': 'Feed', 'general.type': 'Drum', 'construction.material': 'CS' }),
    })
    const k = health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!
    // Three fields filled; one of them required. The denominator is the
    // standard's list, never the catalogue.
    expect(k.required).toBe(1)
    expect(k.filled).toBe(1)
  })

  it('measures several records of one kind together', () => {
    const doc = docOf([sheetOf('s1', [vessel('a', '101'), vessel('b', '102'), vessel('c', '103')])], {
      'TK-101': rec('TK-101', 'equipment', { fields: { 'general.service': 'Feed' } }),
      'TK-102': rec('TK-102', 'equipment', { fields: { 'general.service': 'Product' } }),
      'TK-103': rec('TK-103', 'equipment', { fields: { 'general.type': 'Drum' } }),
    })
    const k = health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!
    expect(k).toMatchObject({ records: 3, required: 3, filled: 2 })
    expect(k.fraction).toBeCloseTo(2 / 3)
  })

  it('rolls up OVERALL field-weighted across kinds', () => {
    const doc = docOf(
      [sheetOf('s1', [vessel('a', '101'), vessel('b', '102')], [pipe('e1', 'a', 'b', { lineNumber: LINE })])],
      {
        'TK-101': rec('TK-101', 'equipment', { fields: { 'general.service': 'Feed' } }),   // 1/1
        [LINE_KEY]: rec(LINE_KEY, 'line', { fields: { 'spec.size': '6"' } }),               // 1/2
      },
    )
    const h = health(doc)
    // Field-weighted: 2 filled of 3 required slots — not the mean of 100% and 50%.
    expect(h.completeness.overall).toBeCloseTo(2 / 3)
    expect(h.completeness.records).toBe(2)
  })

  it('reports every kind, in a stable order', () => {
    expect(health(docOf([sheetOf('s1', [])])).completeness.byKind.map((k) => k.kind)).toEqual([...HEALTH_KINDS])
  })

  it('uses the ADOPTED standard, never a second definition of required', () => {
    const std: StandardProfile = {
      ...DEFAULT_STANDARD,
      required: { ...DEFAULT_STANDARD.required, equipment: ['general.service', 'general.type', 'construction.material'] },
    }
    const doc = docOf(
      [sheetOf('s1', [vessel('v', '101')])],
      { 'TK-101': started({ 'general.service': 'Feed' }) },
      { standard: std },
    )
    const k = health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!
    expect(k).toMatchObject({ required: 3, filled: 1 })
  })

  it('has NO denominator when the standard requires nothing of a kind', () => {
    const std: StandardProfile = {
      ...DEFAULT_STANDARD,
      required: { instrument: [], valve: [], equipment: [], line: [] },
    }
    const doc = docOf(
      [sheetOf('s1', [vessel('v', '101')])],
      { 'TK-101': started({ 'general.service': 'Feed' }) },
      { standard: std },
    )
    const h = health(doc)
    expect(h.completeness.byKind.every((k) => k.fraction === undefined)).toBe(true)
    expect(h.completeness.overall).toBeUndefined()
  })

  it('falls back to the legacy per-node datasheet, exactly as the QA rule does', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', '101', { datasheet: { 'general.service': 'Feed' } })])], {
      'TK-101': started({ 'general.type': 'Drum' }),
    })
    expect(health(doc).completeness.byKind.find((x) => x.kind === 'equipment')!.filled).toBe(1)
  })

  it('agrees with required-field-empty about which objects are incomplete', () => {
    const doc = docOf([sheetOf('s1', [vessel('a', '101'), vessel('b', '102'), vessel('c', '103')])], {
      'TK-101': rec('TK-101', 'equipment', { fields: { 'general.service': 'Feed' } }),
      'TK-102': rec('TK-102', 'equipment', { fields: { 'general.type': 'Drum' } }),
      'TK-103': rec('TK-103', 'equipment'),
    })
    const ix = buildIndex(doc)
    const findings = runRules(ix).groups.find((g) => g.rule.id === 'required-field-empty')?.findings ?? []
    const k = projectHealth(ix, runRules(ix)).completeness.byKind.find((x) => x.kind === 'equipment')!
    // TK-102 is started and missing its one required field; TK-101 is complete;
    // TK-103 is not started and neither of them counts it.
    expect(findings.map((f) => f.entityKey)).toEqual(['TK-102'])
    expect(k.required - k.filled).toBe(findings.length)
  })
})

/* -------------------------------------------------------------- QA */

describe('QA is carried, not recalculated', () => {
  const doc = docOf([sheetOf('s1', [vessel('a', '101'), vessel('a2', '101'), instrument('lt', '200')])])

  it('reconciles exactly with the QA engine', () => {
    const ix = buildIndex(doc)
    const qa = runRules(ix)
    const h = projectHealth(ix, qa)
    expect(h.qa.critical).toBe(qa.counts.critical)
    expect(h.qa.warning).toBe(qa.counts.warning)
    expect(h.qa.info).toBe(qa.counts.info)
    expect(h.qa.total).toBe(qa.total)
  })

  it('reconciles with what the Checks workspace reads', () => {
    // `qaFor` is the memoised report every panel shares.
    const shared = qaFor(doc)
    const h = projectHealth(buildIndex(doc), shared)
    expect([h.qa.critical, h.qa.warning, h.qa.info]).toEqual([
      shared.counts.critical, shared.counts.warning, shared.counts.info,
    ])
  })

  it('actually has something to reconcile — the duplicate tag is a critical', () => {
    expect(health(doc).qa.critical).toBeGreaterThan(0)
  })

  it('carries accepted findings as the engine counts them, not as live ones', () => {
    const ix = buildIndex(doc)
    const live = runRules(ix)
    const key = live.groups.flatMap((g) => g.findings)[0]!.key
    const ignored = { [key]: { reason: 'reviewed', at: '2026-09-15T00:00:00.000Z' } }
    const after = runRules(ix, ignored)
    const h = projectHealth(ix, after)
    expect(h.qa.accepted).toBe(1)
    expect(h.qa.total).toBe(after.total)
    expect(h.qa.total).toBeLessThan(live.total)
  })

  it('carries how many rules ran, so "clean" can be told from "nobody looked"', () => {
    const h = health(doc)
    expect(h.qa.rulesEvaluated).toBeGreaterThan(0)
    expect(h.qa.rulesDisabled).toBe(0)
  })
})

/* ---------------------------------------------------------------- budget */

describe('budget', () => {
  const priced = () => docOf([sheetOf('s1', [vessel('v', '101'), valve('fv', '101')])])

  it('uses projectCost, and states what is unpriced', () => {
    const h = health(priced())
    expect(h.budget.total).toBeGreaterThan(0)
    expect(h.budget.hardware).toBeGreaterThan(0)
    expect(Number.isFinite(h.budget.unpriced)).toBe(true)
  })

  it('has NO fraction when no budget is set', () => {
    const h = health(priced())
    expect(h.budget.target).toBeUndefined()
    expect(h.budget.fraction).toBeUndefined()
    expect(percentText(h.budget.fraction)).toBe('—')
  })

  it('computes the fraction against a target', () => {
    const doc = { ...priced(), budget: { currency: 'USD', total: 100000 } }
    const h = health(doc)
    expect(h.budget.target).toBe(100000)
    expect(h.budget.fraction).toBeCloseTo(h.budget.total / 100000)
  })

  it('treats a ZERO target as no budget rather than dividing by it', () => {
    const h = health({ ...priced(), budget: { currency: 'USD', total: 0 } })
    expect(h.budget.fraction).toBeUndefined()
    expect(percentText(h.budget.fraction)).toBe('—')
  })

  it('carries the project currency', () => {
    expect(health({ ...priced(), budget: { currency: 'EUR' } }).budget.currency).toBe('EUR')
  })
})

/* ------------------------------------------------------------- revisions */

describe('revisions', () => {
  const revision = (over: Partial<Revision> & Pick<Revision, 'id' | 'code'>): Revision =>
    ({ date: '', description: '', preparedBy: 'PN', status: 'IFR', ...over })

  it('reports one row per sheet, in document order', () => {
    const doc = docOf([sheetOf('s1', [], [], { name: 'A' }), sheetOf('s2', [], [], { name: 'B' })])
    expect(health(doc).revisions.map((r) => r.sheetName)).toEqual(['A', 'B'])
  })

  it('falls back to the title block code when a sheet has no revision table', () => {
    const doc = docOf([sheetOf('s1', [], [], { revision: '0' })])
    const r = health(doc).revisions[0]!
    expect(r.code).toBe('0')
    expect(r.issued).toBe(false)
    expect(r.open).toBe(0)
  })

  it('reports an open row as not issued', () => {
    const doc = docOf([sheetOf('s1', [], [], { revisions: [revision({ id: 'r1', code: 'A', description: 'First' })] })])
    expect(health(doc).revisions[0]).toMatchObject({ code: 'A', issued: false, open: 1, description: 'First' })
  })

  it('prefers the LAST ISSUED row over a later draft', () => {
    const doc = docOf([sheetOf('s1', [], [], {
      revisions: [
        revision({ id: 'r1', code: '0', issuedAt: '2026-01-01T00:00:00.000Z' }),
        revision({ id: 'r2', code: '1', issuedAt: '2026-02-01T00:00:00.000Z' }),
        revision({ id: 'r3', code: '2' }),
      ],
    })])
    const r = health(doc).revisions[0]!
    expect(r).toMatchObject({ code: '1', issued: true, open: 1 })
    expect(r.issuedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('is deterministic across two builds', () => {
    const doc = docOf([sheetOf('s1', [], [], { revisions: [revision({ id: 'r1', code: 'A' })] })])
    expect(health(doc)).toEqual(health(doc))
  })
})

/* ---------------------------------------------------- the empty project */

describe('an empty project', () => {
  const h = () => health(createEmptyDoc('nothing'))

  it('produces valid health with no percentage anywhere', () => {
    const x = h()
    expect(x.completeness.overall).toBeUndefined()
    expect(x.completeness.byKind.every((k) => k.fraction === undefined)).toBe(true)
    expect(x.budget.fraction).toBeUndefined()
  })

  it('has no NaN or Infinity in any number it reports', () => {
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(h())
  })

  it('counts zero of everything without pretending there is a denominator', () => {
    expect(h().counts).toMatchObject({ equipment: 0, valves: 0, instruments: 0, lines: 0, sheets: 1 })
    expect(h().qa.total).toBe(0)
  })
})

/* ----------------------------------------------------------- formatting */

describe('percentText', () => {
  it('prints — for an absent fraction rather than 0%', () => {
    expect(percentText(undefined)).toBe('—')
  })

  it('prints a real zero as 0%', () => {
    expect(percentText(0)).toBe('0%')
  })

  it('rounds', () => {
    expect(percentText(2 / 3)).toBe('67%')
    expect(percentText(1)).toBe('100%')
  })

  it('refuses NaN and Infinity', () => {
    expect(percentText(NaN)).toBe('—')
    expect(percentText(Infinity)).toBe('—')
  })
})

/* -------------------------------------------------------------- purity */

describe('the projection is pure', () => {
  it('mutates nothing it was given', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', '101')])], { 'TK-101': rec('TK-101', 'equipment', { fields: { 'general.service': 'Feed' } }) })
    const before = JSON.stringify(doc)
    const ix = buildIndex(doc)
    projectHealth(ix, runRules(ix))
    projectHealth(ix, runRules(ix))
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('persists nothing — no health field appears on the document', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', '101')])])
    health(doc)
    expect(Object.keys(doc)).not.toContain('health')
    expect(doc.schemaVersion).toBe(6)
  })
})
