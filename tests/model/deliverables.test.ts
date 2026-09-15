// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-6 — which deliverables no longer match the last issued model.
 *
 * The load-bearing claim is the one in `changing one field moves only the
 * reports that print it`: it is what proves the comparison reads the REPORTS
 * rather than a hand-written map of what each report is believed to read. A
 * dependency map would pass the easy cases and drift silently on the hard one.
 *
 * After that, in order of how much damage getting them wrong would do:
 *
 *  2. A MISSING SNAPSHOT IS NOT `unchanged`. Silence must never read as
 *     agreement about an issued document.
 *  3. Renderings say they cannot be compared rather than quietly passing.
 *  4. Nothing is mutated, and two runs agree.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import {
  DELIVERABLES,
  countStates,
  deliverableStatus,
  lastIssuedModel,
  type DeliverableId,
  type IssuedInput,
} from '../../src/model/deliverables'
import type { EngineeringRecord } from '../../src/model/registry'
import type { PlantEdge, PlantNode, ProjectDoc, Revision, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })

const vessel = (id: string, loop: string) =>
  node(id, 'equipment', 'vessel.vertical', { tag: { letters: 'TK', loop } })
const instrument = (id: string, loop: string) =>
  node(id, 'instrument', 'instr.bubble', { tag: { letters: 'LT', loop } })

const LINE = { size: '6"', spec: 'CS150', service: 'CW', seq: '001' }
const LINE_KEY = '6"-CS150-CW-001'

const pipe = (id: string, a: string, b: string): PlantEdge => ({
  id, lineClass: 'process.major',
  source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' },
  lineNumber: LINE,
})

const revision = (over: Partial<Revision> & Pick<Revision, 'id' | 'code'>): Revision =>
  ({ date: '', description: '', preparedBy: 'PN', status: 'IFC', ...over })

const sheetOf = (id: string, nodes: PlantNode[], edges: PlantEdge[] = [], over: Partial<Sheet> = {}): Sheet =>
  ({ ...createSheet(1), id, nodes, edges, ...over })

const rec = (key: string, kind: EngineeringRecord['kind'], fields: Record<string, string> = {}): EngineeringRecord =>
  ({ key, kind, fields })

/** A small plant: a tagged vessel, a tagged instrument, one numbered line. */
function plant(registry: Record<string, EngineeringRecord> = {}): ProjectDoc {
  return {
    ...createEmptyDoc('deliverables'),
    sheets: [sheetOf('s1', [vessel('v1', '101'), vessel('v2', '102'), instrument('lt', '101')], [pipe('e1', 'v1', 'v2')])],
    registry,
  }
}

/** The same plant with the instrument actually wired to a DCS, so the I/O list
 *  has a row. An unwired instrument is not an I/O point and is left out. */
function wired(registry: Record<string, EngineeringRecord> = {}): ProjectDoc {
  const doc = plant(registry)
  doc.sheets[0] = {
    ...doc.sheets[0]!,
    nodes: [...doc.sheets[0]!.nodes, node('dcs', 'equipment', 'ctl.dcs')],
    edges: [
      ...doc.sheets[0]!.edges,
      { id: 'sig', lineClass: 'signal.electric', source: { nodeId: 'lt', portId: 'e' }, target: { nodeId: 'dcs', portId: 'w' } },
    ],
  }
  return doc
}

const issuedFrom = (doc: ProjectDoc): IssuedInput => ({ ok: true, doc })
const missing = (reason = 'not available here'): IssuedInput => ({ ok: false, reason })

const rows = (current: ProjectDoc, issued: IssuedInput) => deliverableStatus(current, issued)
const stateOf = (current: ProjectDoc, issued: IssuedInput, id: DeliverableId) =>
  rows(current, issued).find((r) => r.id === id)!.state
/** Every comparable deliverable that came back `differs`. */
const differing = (current: ProjectDoc, issued: IssuedInput): DeliverableId[] =>
  rows(current, issued).filter((r) => r.state === 'differs').map((r) => r.id)

/* ------------------------------------------------------------- catalogue */

describe('the catalogue', () => {
  it('is the export menu, with nothing invented and nothing hidden', () => {
    expect(DELIVERABLES.map((d) => d.label)).toEqual([
      'SVG image', 'PDF — this sheet', 'PDF — all sheets', 'PNG image',
      'DXF (AutoCAD)', 'DEXPI XML',
      'Instrument index', 'I/O list', 'Line list', 'Equipment list',
      'Valve list', 'Loop list', 'Nozzle schedule', 'Datasheet matrix',
    ])
  })

  it('gives every non-comparable type a reason, and every comparable one a generator', () => {
    for (const d of DELIVERABLES) {
      expect(Boolean(d.generate)).toBe(!d.notComparable)
      if (!d.generate) expect(d.notComparable!.length).toBeGreaterThan(10)
    }
  })

  it('has unique ids', () => {
    expect(new Set(DELIVERABLES.map((d) => d.id)).size).toBe(DELIVERABLES.length)
  })
})

/* ------------------------------------------- THE load-bearing behaviour */

describe('changing ONE engineering field moves only the reports that print it', () => {
  // This is what proves the comparison reads the reports rather than a
  // hand-maintained map of what each report is believed to read.
  const base = plant({ 'LT-101': rec('LT-101', 'instrument', { 'signal.range': '0-100 degC' }) })

  it('moves the instrument index and the datasheet matrix when an instrument range changes', () => {
    // `signal.range` is an INSTRUMENT_INDEX_FIELD and a datasheet-matrix
    // column. It is in no line, equipment, valve, loop or nozzle report.
    const after = plant({ 'LT-101': rec('LT-101', 'instrument', { 'signal.range': '0-200 degC' }) })
    expect(differing(after, issuedFrom(base)).sort()).toEqual(['datasheet-matrix', 'instrument-index'])
  })

  it('moves the line list and NOTHING else when a line material changes', () => {
    const before = plant({ [LINE_KEY]: rec(LINE_KEY, 'line', { 'spec.material': 'CS' }) })
    const after = plant({ [LINE_KEY]: rec(LINE_KEY, 'line', { 'spec.material': 'SS316' }) })
    expect(differing(after, issuedFrom(before))).toEqual(['line-list'])
  })

  it('moves the equipment list and NOTHING else when an equipment field changes', () => {
    const before = plant({ 'TK-101': rec('TK-101', 'equipment', { 'construction.material': 'CS' }) })
    const after = plant({ 'TK-101': rec('TK-101', 'equipment', { 'construction.material': 'SS' }) })
    expect(differing(after, issuedFrom(before))).toEqual(['equipment-list'])
  })

  it('moves the nozzle schedule and NOTHING else when a nozzle is added', () => {
    const before = plant({ 'TK-101': rec('TK-101', 'equipment') })
    const after = plant({
      'TK-101': { ...rec('TK-101', 'equipment'), nozzles: [{ id: 'nz1', number: 'N1', size: '6"' }] },
    })
    expect(differing(after, issuedFrom(before))).toEqual(['nozzle-schedule'])
  })

  it('moves the I/O list when a signal type changes on a WIRED instrument', () => {
    // The I/O list deliberately leaves out an instrument with no signal line —
    // a local gauge is not an I/O point — so the fixture has to wire one up for
    // the report to have a row to change.
    const before = wired({ 'LT-101': rec('LT-101', 'instrument', { 'signal.type': 'AI' }) })
    const after = wired({ 'LT-101': rec('LT-101', 'instrument', { 'signal.type': 'DI' }) })
    // The datasheet matrix prints every stored key, so it moves too. The
    // instrument index does not carry `signal.type` and stays put.
    expect(differing(after, issuedFrom(before)).sort()).toEqual(['datasheet-matrix', 'io-list'])
  })

  it('moves NOTHING when only the drawing geometry changes', () => {
    // A symbol moved. No report prints a coordinate — which is exactly why a
    // rendering is not comparable and a report is.
    const before = plant()
    const after = plant()
    after.sheets[0]!.nodes[0] = { ...after.sheets[0]!.nodes[0]!, x: 900, y: 900 }
    expect(differing(after, issuedFrom(before))).toEqual([])
  })
})

/* ------------------------------------------------------- basic states */

describe('the four states', () => {
  it('reports unchanged for an identical model', () => {
    const doc = plant({ 'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Feed' }) })
    const result = rows(doc, issuedFrom(doc))
    expect(result.filter((r) => r.state === 'unchanged')).toHaveLength(8)
    expect(result.filter((r) => r.state === 'differs')).toHaveLength(0)
  })

  it('reports differs once the model moves', () => {
    const before = plant({ 'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Feed' }) })
    const after = plant({ 'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Product' }) })
    expect(stateOf(after, issuedFrom(before), 'equipment-list')).toBe('differs')
  })

  it('reports no-snapshot — NEVER unchanged — when there is nothing to compare', () => {
    const doc = plant()
    const result = rows(doc, missing('Nothing has been issued yet.'))
    const comparable = result.filter((r) => r.state !== 'not-comparable')
    expect(comparable).toHaveLength(8)
    expect(comparable.every((r) => r.state === 'no-snapshot')).toBe(true)
    expect(comparable.every((r) => r.state !== 'unchanged')).toBe(true)
    expect(comparable[0]!.reason).toBe('Nothing has been issued yet.')
  })

  it('carries the caller’s own sentence, so "never issued" and "not on this machine" read differently', () => {
    expect(rows(plant(), missing('That revision kept no snapshot.'))[6]!.reason).toBe('That revision kept no snapshot.')
  })

  it('reports not-comparable with a reason for every rendering', () => {
    const doc = plant()
    const nc = rows(doc, issuedFrom(doc)).filter((r) => r.state === 'not-comparable')
    expect(nc.map((r) => r.id)).toEqual(['svg', 'pdf-sheet', 'pdf-all', 'png', 'dxf', 'dexpi'])
    expect(nc.every((r) => Boolean(r.reason))).toBe(true)
  })

  it('says a rendering cannot be compared EVEN when there is no snapshot either', () => {
    // Not-comparable is a fact about the output; it does not depend on having
    // something to compare against.
    expect(stateOf(plant(), missing(), 'dxf')).toBe('not-comparable')
  })

  it('returns one row per catalogue entry, in catalogue order', () => {
    const doc = plant()
    expect(rows(doc, issuedFrom(doc)).map((r) => r.id)).toEqual(DELIVERABLES.map((d) => d.id))
  })

  it('counts the states for the sentence above the list', () => {
    const doc = plant()
    expect(countStates(rows(doc, issuedFrom(doc)))).toEqual({
      unchanged: 8, differs: 0, 'no-snapshot': 0, 'not-comparable': 6,
    })
  })
})

/* ------------------------------------------------------- empty project */

describe('an empty project', () => {
  it('compares cleanly against itself', () => {
    const doc = createEmptyDoc('nothing')
    const result = rows(doc, issuedFrom(doc))
    expect(result.filter((r) => r.state === 'unchanged')).toHaveLength(8)
  })

  it('has nothing issued, so there is no model to compare against', () => {
    expect(lastIssuedModel(createEmptyDoc('nothing'))).toBeUndefined()
  })
})

/* ------------------------------------------------- the issued revision */

describe('lastIssuedModel', () => {
  it('is undefined when no sheet has ever been issued', () => {
    const doc = plant()
    doc.sheets[0]!.revisions = [revision({ id: 'r1', code: 'A' })]
    expect(lastIssuedModel(doc)).toBeUndefined()
  })

  it('names the issued revision by sheet, code and date', () => {
    const doc = plant()
    doc.sheets[0] = {
      ...doc.sheets[0]!,
      name: 'Feed', drawingNumber: 'PID-1001',
      revisions: [revision({ id: 'r1', code: 'A', issuedAt: '2026-03-04T09:00:00.000Z', snapshotId: 'snap-a' })],
    }
    expect(lastIssuedModel(doc)).toEqual({
      sheetId: 's1', sheetName: 'Feed', drawingNumber: 'PID-1001',
      code: 'A', issuedAt: '2026-03-04T09:00:00.000Z', snapshotId: 'snap-a',
    })
  })

  it('takes the most recent issue ACROSS sheets, by timestamp and not by sheet order', () => {
    const doc = plant()
    doc.sheets = [
      { ...sheetOf('s1', []), drawingNumber: 'PID-1', revisions: [revision({ id: 'a', code: 'A', issuedAt: '2026-05-01T00:00:00.000Z' })] },
      { ...sheetOf('s2', []), drawingNumber: 'PID-2', revisions: [revision({ id: 'b', code: 'B', issuedAt: '2026-01-01T00:00:00.000Z' })] },
      { ...sheetOf('s3', []), drawingNumber: 'PID-3', revisions: [revision({ id: 'c', code: 'C', issuedAt: '2026-09-01T00:00:00.000Z' })] },
    ]
    expect(lastIssuedModel(doc)).toMatchObject({ sheetId: 's3', code: 'C', drawingNumber: 'PID-3' })
  })

  it('ignores a sheet that has drafted but not issued', () => {
    const doc = plant()
    doc.sheets = [
      { ...sheetOf('s1', []), revisions: [revision({ id: 'a', code: 'A', issuedAt: '2026-05-01T00:00:00.000Z' })] },
      { ...sheetOf('s2', []), revisions: [revision({ id: 'b', code: 'B' })] },
    ]
    expect(lastIssuedModel(doc)).toMatchObject({ sheetId: 's1', code: 'A' })
  })

  it('takes the LAST issued row on a sheet issued more than once', () => {
    const doc = plant()
    doc.sheets[0] = {
      ...doc.sheets[0]!,
      revisions: [
        revision({ id: 'r1', code: '0', issuedAt: '2026-01-01T00:00:00.000Z', snapshotId: 'snap-0' }),
        revision({ id: 'r2', code: '1', issuedAt: '2026-02-01T00:00:00.000Z', snapshotId: 'snap-1' }),
      ],
    }
    expect(lastIssuedModel(doc)).toMatchObject({ code: '1', snapshotId: 'snap-1' })
  })

  it('breaks a tie on sheet id, so two builds agree', () => {
    const at = '2026-05-01T00:00:00.000Z'
    const doc = plant()
    doc.sheets = [
      { ...sheetOf('sB', []), revisions: [revision({ id: 'b', code: 'B', issuedAt: at })] },
      { ...sheetOf('sA', []), revisions: [revision({ id: 'a', code: 'A', issuedAt: at })] },
    ]
    expect(lastIssuedModel(doc)!.sheetId).toBe('sA')
    expect(lastIssuedModel({ ...doc, sheets: [...doc.sheets].reverse() })!.sheetId).toBe('sA')
  })

  it('reports a revision issued with no snapshot kept, without pretending it has one', () => {
    const doc = plant()
    doc.sheets[0] = { ...doc.sheets[0]!, revisions: [revision({ id: 'r1', code: 'A', issuedAt: '2026-03-04T09:00:00.000Z' })] }
    const model = lastIssuedModel(doc)!
    expect(model.code).toBe('A')
    expect(model.snapshotId).toBeUndefined()
  })
})

/* ---------------------------------------------- determinism and purity */

describe('the projection is pure and deterministic', () => {
  it('gives the same answer twice', () => {
    const before = plant({ 'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Feed' }) })
    const after = plant({ 'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Product' }) })
    expect(rows(after, issuedFrom(before))).toEqual(rows(after, issuedFrom(before)))
  })

  it('mutates NEITHER document', () => {
    const before = plant({ 'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Feed' }) })
    const after = plant({ 'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Product' }) })
    const a = JSON.stringify(before)
    const b = JSON.stringify(after)
    deliverableStatus(after, issuedFrom(before))
    deliverableStatus(after, issuedFrom(before))
    expect(JSON.stringify(before)).toBe(a)
    expect(JSON.stringify(after)).toBe(b)
  })

  it('persists nothing on either document', () => {
    const doc = plant()
    deliverableStatus(doc, issuedFrom(doc))
    expect(Object.keys(doc)).not.toContain('deliverables')
    expect(doc.schemaVersion).toBe(6)
  })
})

/* ------------------------------------------------------ several sheets */

describe('several sheets', () => {
  const twoSheets = (secondService: string): ProjectDoc => ({
    ...createEmptyDoc('two'),
    sheets: [
      sheetOf('s1', [vessel('v1', '101')]),
      sheetOf('s2', [vessel('v2', '201')]),
    ],
    registry: {
      'TK-101': rec('TK-101', 'equipment', { 'general.service': 'Feed' }),
      'TK-201': rec('TK-201', 'equipment', { 'general.service': secondService }),
    },
  })

  it('compares the WHOLE project, so a change on any sheet shows', () => {
    // The reports are project-wide; the revision compared against is one
    // sheet's, and that is stated rather than hidden.
    //
    // BOTH reports move, and that is the point of comparing output rather than
    // a declared dependency map: the instrument index selects on TAG, not on
    // node kind, so a tagged vessel is in it and it prints `general.service`.
    // A hand-written map of "what the equipment list reads" would have said
    // one report; the generators say two, and the generators are right.
    expect(differing(twoSheets('Product'), issuedFrom(twoSheets('Feed'))).sort())
      .toEqual(['equipment-list', 'instrument-index'])
  })

  it('is unchanged when neither sheet moved', () => {
    const doc = twoSheets('Product')
    expect(differing(doc, issuedFrom(doc))).toEqual([])
  })
})
