// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-2 — the Nozzle schedule as a REPORT: columns, cells, CSV.
 *
 * Three things this file is really protecting:
 *
 *  1. The column order is a contract from the first release of this report.
 *  2. Every cell goes through the one CSV escaper, so the one formula guard
 *     applies. A new report must not be able to lose that protection.
 *  3. `ReportRow.rowId` is additive. Every existing report must be byte-for-
 *     byte what it was, and must still carry no `rowId` at all.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import {
  EQUIPMENT_LIST_COLUMNS,
  INSTRUMENT_INDEX_COLUMNS,
  LINE_LIST_COLUMNS,
  NOZZLE_SCHEDULE_COLUMNS,
  NOZZLE_SCHEDULE_SPEC,
  equipmentListRows,
  instrumentIndexRows,
  ioListRows,
  lineListRows,
  loopListRows,
  nozzleScheduleCsv,
  nozzleScheduleReport,
  nozzleScheduleRows,
  valveListRows,
} from '../../src/export/csv'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { newArea, newUnit } from '../../src/model/hierarchy'
import { newNozzle } from '../../src/model/nozzle'
import type { Nozzle } from '../../src/model/nozzle'
import type { EngineeringRecord } from '../../src/model/registry'
import type { PlantEdge, PlantNode, ProjectDoc, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })

const vessel = (id: string, letters: string, loop: string, over: Partial<PlantNode> = {}) =>
  node(id, 'equipment', 'vessel.vertical', { tag: { letters, loop }, ...over })

const sheetOf = (id: string, nodes: PlantNode[], edges: PlantEdge[] = [], name = 'Sheet 1'): Sheet =>
  ({ ...createSheet(1), id, nodes, edges, name })

const record = (key: string, nozzles: Nozzle[], over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'equipment', fields: {}, nozzles, ...over })

const docOf = (
  sheets: Sheet[],
  registry: Record<string, EngineeringRecord> = {},
  over: Partial<ProjectDoc> = {},
): ProjectDoc => ({ ...createEmptyDoc('nozzle report'), sheets, registry, ...over })

/** One cell of one row, by column NAME — never by position. */
const at = (doc: ProjectDoc, rowIndex: number, label: string): string =>
  nozzleScheduleRows(doc)[rowIndex]!.cells[NOZZLE_SCHEDULE_COLUMNS.indexOf(label)]!

/* -------------------------------------------------------------- columns */

describe('the column contract', () => {
  it('is exactly this, in exactly this order', () => {
    expect(NOZZLE_SCHEDULE_COLUMNS).toEqual([
      'Equipment Tag', 'Equipment Label', 'Symbol', 'Sheet',
      'Nozzle Number', 'Size', 'Rating', 'Facing', 'Service',
      'Connection Point', 'Port Name', 'Connected Line', 'Status', 'Notes',
      'Area', 'Unit',
    ])
  })

  it('marks NO column editable — the schedule is read-only', () => {
    // The Loop list's mechanism, not a switch: with no `field` on any column,
    // DataWorkspace's `editableAt` returns null for every cell.
    expect(NOZZLE_SCHEDULE_SPEC.every((c) => !c.field && !c.assign)).toBe(true)
  })

  it('gives every row a cell for every column', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', 'TK', '101')])], {
      'TK-101': record('TK-101', [newNozzle('N1')]),
    })
    for (const row of nozzleScheduleRows(doc)) {
      expect(row.cells).toHaveLength(NOZZLE_SCHEDULE_COLUMNS.length)
    }
  })
})

/* ---------------------------------------------------------------- cells */

describe('the cells', () => {
  const area = newArea('A-10', 'Utilities')
  const unit = newUnit(area.id, 'U-101', 'Cooling')
  const doc = docOf(
    [sheetOf('s1', [vessel('v', 'TK', '101', { label: 'Feed drum' })], [
      {
        id: 'e1',
        lineClass: 'process.major',
        source: { nodeId: 'v', portId: 'n' },
        target: { x: 99, y: 0 },
        lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '001' },
      },
    ], 'P-101')],
    {
      'TK-101': record(
        'TK-101',
        [newNozzle('N1', { portId: 'n', size: '6"', rating: '150#', facing: 'RF', service: 'CW inlet', notes: 'flanged' })],
        { unitId: unit.id },
      ),
    },
    { areas: [area], units: [unit] },
  )

  it('prints the entered engineering values', () => {
    expect(at(doc, 0, 'Nozzle Number')).toBe('N1')
    expect(at(doc, 0, 'Size')).toBe('6"')
    expect(at(doc, 0, 'Rating')).toBe('150#')
    expect(at(doc, 0, 'Facing')).toBe('RF')
    expect(at(doc, 0, 'Service')).toBe('CW inlet')
    expect(at(doc, 0, 'Notes')).toBe('flanged')
  })

  it('prints the derived drawing values', () => {
    expect(at(doc, 0, 'Equipment Tag')).toBe('TK-101')
    expect(at(doc, 0, 'Equipment Label')).toBe('Feed drum')
    expect(at(doc, 0, 'Symbol')).toBe('Vertical Vessel')
    expect(at(doc, 0, 'Sheet')).toBe('P-101')
    expect(at(doc, 0, 'Connection Point')).toBe('n')
    expect(at(doc, 0, 'Connected Line')).toBe('6"-CS150-CW-001')
    expect(at(doc, 0, 'Status')).toBe('connected')
    expect(at(doc, 0, 'Area')).toBe('A-10')
    expect(at(doc, 0, 'Unit')).toBe('U-101')
  })

  it('leaves Port Name blank for a positional connection point', () => {
    expect(at(doc, 0, 'Port Name')).toBe('')
  })

  it('leaves every unentered field as an empty cell', () => {
    const bare = docOf([sheetOf('s1', [vessel('v', 'TK', '101')])], {
      'TK-101': record('TK-101', [newNozzle('N1')]),
    })
    for (const label of ['Equipment Label', 'Size', 'Rating', 'Facing', 'Service', 'Connection Point', 'Port Name', 'Connected Line', 'Notes', 'Area', 'Unit']) {
      expect(at(bare, 0, label)).toBe('')
    }
    expect(at(bare, 0, 'Status')).toBe('not located')
  })

  it('anchors a row at the drawn symbol, and falls back to the nozzle for an orphan', () => {
    expect(nozzleScheduleRows(doc)[0]!.id).toBe('v')
    const orphan = docOf([sheetOf('s1', [])], { 'TK-101': record('TK-101', [newNozzle('N1')]) })
    const row = nozzleScheduleRows(orphan)[0]!
    expect(row.id).toBe(row.rowId!.split(' ')[1] ?? row.id)
    expect(row.sheetId).toBe('')
    expect(row.cells[NOZZLE_SCHEDULE_COLUMNS.indexOf('Status')]).toBe('not drawn')
  })

  it('carries the equipment key so the Area/Unit filters resolve, without making a cell editable', () => {
    const row = nozzleScheduleRows(doc)[0]!
    expect(row.recordKey).toBe('TK-101')
    expect(row.recordKind).toBe('equipment')
  })
})

/* ------------------------------------------------------------------ CSV */

describe('the CSV', () => {
  it('writes the header and one line per nozzle', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', 'TK', '101')])], {
      'TK-101': record('TK-101', [newNozzle('N1'), newNozzle('N2')]),
    })
    const lines = nozzleScheduleCsv(doc).trimEnd().split('\n')
    expect(lines[0]).toBe(NOZZLE_SCHEDULE_COLUMNS.join(','))
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('N1')
    expect(lines[2]).toContain('N2')
  })

  it('is a header and nothing else when no nozzle exists', () => {
    expect(nozzleScheduleCsv(createEmptyDoc('empty'))).toBe(`${NOZZLE_SCHEDULE_COLUMNS.join(',')}\n`)
  })

  it('neutralises a value a spreadsheet would EXECUTE', () => {
    // Through the shared `csvCell`, which is the only escaper in the product —
    // this report cannot have its own and therefore cannot lose the guard.
    const doc = docOf([sheetOf('s1', [vessel('v', 'TK', '101')])], {
      'TK-101': record('TK-101', [newNozzle('N1', { notes: '=cmd|calc', service: '@SUM(A1)' })]),
    })
    const line = nozzleScheduleCsv(doc).trimEnd().split('\n')[1]!
    expect(line).toContain("'=cmd|calc")
    expect(line).toContain("'@SUM(A1)")
  })

  it('quotes a value carrying a comma or a quote', () => {
    const doc = docOf([sheetOf('s1', [vessel('v', 'TK', '101')])], {
      'TK-101': record('TK-101', [newNozzle('N1', { notes: 'A106, Gr "B"' })]),
    })
    expect(nozzleScheduleCsv(doc)).toContain('"A106, Gr ""B"""')
  })

  it('is byte-identical across two exports of one document', () => {
    const doc = docOf([sheetOf('s1', [vessel('b', 'TK', '102'), vessel('a', 'TK', '101')])], {
      'TK-102': record('TK-102', [newNozzle('N1')]),
      'TK-101': record('TK-101', [newNozzle('N2'), newNozzle('N1')]),
    })
    expect(nozzleScheduleCsv(doc)).toBe(nozzleScheduleCsv(doc))
    // And the order is the one the derivation promises: key, then stored order.
    const rows = nozzleScheduleRows(doc)
    expect(rows.map((r) => `${r.recordKey}/${r.cells[4]}`)).toEqual(['TK-101/N2', 'TK-101/N1', 'TK-102/N1'])
  })
})

/* ---------------------------------------------------------- the report */

describe('nozzleScheduleReport', () => {
  it('returns the rows and the equipment records carrying none', () => {
    const doc = docOf([sheetOf('s1', [vessel('a', 'TK', '101'), vessel('b', 'TK', '102')])], {
      'TK-101': record('TK-101', [newNozzle('N1')]),
      'TK-102': record('TK-102', []),
    })
    const report = nozzleScheduleReport(doc)
    expect(report.rows).toHaveLength(1)
    expect(report.excluded).toBe(1)
    // The same rows the CSV writes — the screen and the deliverable cannot
    // disagree, because there is only one of them.
    expect(report.rows).toEqual(nozzleScheduleRows(doc))
  })
})

/* ------------------------------------------------ ReportRow.rowId is additive */

describe('ReportRow.rowId', () => {
  const doc = (() => {
    const d = docOf(
      [sheetOf('s1', [
        vessel('v', 'TK', '101'),
        node('i', 'instrument', 'instr.bubble', { tag: { letters: 'LT', loop: '101' } }),
        node('fv', 'valve', 'valve.gate', { tag: { letters: 'FV', loop: '101' } }),
      ], [
        {
          id: 'e1',
          lineClass: 'process.major',
          source: { nodeId: 'v', portId: 'n' },
          target: { x: 99, y: 0 },
          lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '001' },
        },
      ])],
      { 'TK-101': record('TK-101', [newNozzle('N1'), newNozzle('N2'), newNozzle('N3')]) },
    )
    return d
  })()

  it('is absent on every pre-existing report', () => {
    for (const rows of [
      instrumentIndexRows(doc), lineListRows(doc), equipmentListRows(doc),
      valveListRows(doc), ioListRows(doc), loopListRows(doc),
    ]) {
      expect(rows.every((r) => r.rowId === undefined)).toBe(true)
    }
  })

  it('leaves existing report ids and columns exactly as they were', () => {
    // The instrument index selects on TAG, not on node kind — so a tagged
    // vessel and a tagged valve are in it, exactly as before this program.
    expect(instrumentIndexRows(doc).map((r) => r.id)).toEqual(['v', 'i', 'fv'])
    expect(equipmentListRows(doc).map((r) => r.id)).toEqual(['v'])
    expect(valveListRows(doc).map((r) => r.id)).toEqual(['fv'])
    expect(lineListRows(doc).map((r) => r.id)).toEqual(['e1'])
    expect(INSTRUMENT_INDEX_COLUMNS[0]).toBe('Tag')
    expect(EQUIPMENT_LIST_COLUMNS[0]).toBe('Tag')
    expect(LINE_LIST_COLUMNS[0]).toBe('Line Number')
  })

  it('is what makes three nozzle rows on ONE node distinguishable', () => {
    const rows = nozzleScheduleRows(doc)
    // All three come off the same drawn vessel, so `id` cannot tell them
    // apart — this is the duplicate React-key case.
    expect(rows.map((r) => r.id)).toEqual(['v', 'v', 'v'])
    expect(new Set(rows.map((r) => r.rowId)).size).toBe(3)
    // And what a table keys on resolves uniquely.
    expect(new Set(rows.map((r) => r.rowId ?? r.id)).size).toBe(3)
  })
})
