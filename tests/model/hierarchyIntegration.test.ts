// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P1-D end to end: the hierarchy has to reach every deliverable that already
 * exists, or it is a field nobody can use.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { serializeDoc } from '../../src/persist/file'
import { loadDoc } from '../../src/model/migrate'
import { buildIndex } from '../../src/model/projectIndex'
import { deriveIoList } from '../../src/model/ioList'
import { compareDocs } from '../../src/model/diff'
import { buildChangeSet, buildPasteChangeSet, parseCsv } from '../../src/model/bulkEdit'
import {
  ENGINEERING_COLUMNS, ENGINEERING_SPEC, IO_LIST_COLUMNS, INSTRUMENT_INDEX_SPEC,
  engineeringCsv, engineeringRows, instrumentIndexRows, ioListRows, lineListRows,
} from '../../src/export/csv'
import { UNIT_FIELD, buildHierarchy } from '../../src/model/hierarchy'
import { issueRevision, getSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { revisionsOf } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'
import type { DocChange } from '../../src/model/diff'
import type { ProjectDoc } from '../../src/model/types'

const doc = () => useStore.getState().doc
const st = () => useStore.getState()

let areaId = ''
let unitId = ''

/**
 * A transmitter wired to a DCS (so it is a real I/O point), a pump, and a
 * numbered line. Area 100 / Unit U-101 declared; only the transmitter is
 * assigned, so "unassigned rows still appear" is testable on the rest.
 */
function seed(): void {
  st().loadIntoStore(createEmptyDoc('t'))
  const lt = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  st().setTag(lt, { letters: 'LT', loop: '101' })
  const pt = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 0, rotation: 0 })
  st().setTag(pt, { letters: 'PT', loop: '200' })
  const dcs = st().addNode({ symbolId: 'ctl.dcs', kind: 'equipment', x: 100, y: 0, rotation: 0 })
  st().addEdge({ lineClass: 'signal.electric', source: { nodeId: lt, portId: 'e' }, target: { nodeId: dcs, portId: 'w' } })
  st().addEdge({ lineClass: 'signal.electric', source: { nodeId: pt, portId: 'e' }, target: { nodeId: dcs, portId: 'w' } })
  const line = st().addEdge({
    lineClass: 'process.major',
    source: { nodeId: lt, portId: 'w' },
    target: { nodeId: pt, portId: 'w' },
    lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '001' },
  })
  void line
  st().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  // PT-200 needs a record of its own, or the round-trip export (which is one
  // row per record) would not carry it and the import would call it unknown.
  st().setRecordField('PT-200', 'instrument', 'signal.units', 'bar')
  areaId = st().addArea('100', 'Reactor area')
  unitId = st().addUnit(areaId, 'U-101', 'Feed')
  st().assignUnit('LT-101', 'instrument', unitId)
}

const io = () => deriveIoList(buildIndex(doc()))
const rowFor = (key: string) => io().find((r) => r.key === key)

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  seed()
})

/* --------------------------------------------------------------- 19-21 I/O */

describe('the I/O list', () => {
  it('19/20: exposes the area and unit of an assigned point', () => {
    expect(rowFor('LT-101')).toMatchObject({ areaCode: '100', unitCode: 'U-101' })
  })

  it('21: an unassigned point keeps its row, with the columns blank', () => {
    const row = rowFor('PT-200')
    expect(row).toBeTruthy()
    expect(row).toMatchObject({ areaCode: '', unitCode: '' })
  })

  it('follows a code rename without the row being rewritten', () => {
    st().updateUnit(unitId, { code: 'U-102' })
    st().updateArea(areaId, { code: '200' })
    expect(rowFor('LT-101')).toMatchObject({ areaCode: '200', unitCode: 'U-102' })
  })

  it('goes blank, not stale, when the unit is deleted', () => {
    st().removeUnit(unitId)
    expect(rowFor('LT-101')).toMatchObject({ areaCode: '', unitCode: '' })
  })

  it('prints Area and Unit as the last two columns of the report', () => {
    expect(IO_LIST_COLUMNS.slice(-2)).toEqual(['Area', 'Unit'])
    const cells = ioListRows(doc()).find((r) => r.recordKey === 'LT-101')!.cells
    expect(cells.slice(-2)).toEqual(['100', 'U-101'])
  })
})

/* ------------------------------------------------------- reports generally */

describe('every report', () => {
  it('appends Area and Unit without moving an existing column', () => {
    // The instrument index is a CSV contract people read by position.
    expect(INSTRUMENT_INDEX_SPEC.slice(0, 7).map((c) => c.label))
      .toEqual(['Tag', 'Description', 'Loop', 'Symbol', 'Sheet', 'Connected To', 'Notes'])
    expect(INSTRUMENT_INDEX_SPEC.slice(-2).map((c) => c.label)).toEqual(['Area', 'Unit'])
  })

  it('shows the assignment on the instrument index', () => {
    expect(instrumentIndexRows(doc()).find((r) => r.recordKey === 'LT-101')!.cells.slice(-2))
      .toEqual(['100', 'U-101'])
  })

  it('a line carries an assignment when one is made, and never an inferred one', () => {
    const lineKey = lineListRows(doc())[0]!.recordKey!
    // Drawn between two assigned-adjacent objects, and still blank: a header
    // can run the length of a plant, so nothing guesses.
    expect(lineListRows(doc())[0]!.cells.slice(-2)).toEqual(['', ''])
    st().assignUnit(lineKey, 'line', unitId)
    expect(lineListRows(doc())[0]!.cells.slice(-2)).toEqual(['100', 'U-101'])
  })
})

/* ------------------------------------------------------------- 22-26 CSV */

const csvFor = (rows: string[][]) => [ENGINEERING_COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n'
const cells = (key: string, area: string, unit: string): string[] => {
  const rec = doc().registry![key]!
  return [key, area, unit, ...ENGINEERING_SPEC.slice(3).map((c) => rec.fields[c.field!] ?? '')]
}
const setFor = (text: string) => buildChangeSet(doc(), parseCsv(text), ENGINEERING_SPEC)

describe('CSV round trip', () => {
  it('22: exports the Area and Unit CODES, right after the tag', () => {
    expect(ENGINEERING_COLUMNS.slice(0, 3)).toEqual(['Tag', 'Area', 'Unit'])
    const row = engineeringRows(doc()).find((r) => r.recordKey === 'LT-101')!
    expect(row.cells.slice(0, 3)).toEqual(['LT-101', '100', 'U-101'])
    // never the id — a ULID in a spreadsheet cell is unusable
    expect(engineeringCsv(doc())).not.toContain(unitId)
  })

  it('22: an unassigned record exports blanks', () => {
    expect(engineeringRows(doc()).find((r) => r.recordKey === 'PT-200')!.cells.slice(0, 3))
      .toEqual(['PT-200', '', ''])
  })

  it('an untouched export re-imports as no change at all', () => {
    const set = setFor(engineeringCsv(doc()))
    expect(set.ok).toBe(true)
    expect(set.modified).toHaveLength(0)
  })

  it('23: a valid Area/Unit import resolves to the stable id', () => {
    const set = setFor(csvFor([cells('LT-101', '100', 'U-101'), cells('PT-200', '100', 'U-101')]))
    expect(set.ok).toBe(true)
    expect(set.modified).toHaveLength(1)
    expect(set.modified[0]).toMatchObject({ key: 'PT-200', field: UNIT_FIELD, before: '', after: 'U-101', unitId })
  })

  it('23: resolves case-insensitively and stores the declared unit', () => {
    const set = setFor(csvFor([cells('PT-200', '100', 'u-101')]))
    expect(set.ok).toBe(true)
    expect(set.modified[0]!.unitId).toBe(unitId)
  })

  it('24: an unknown Area is rejected, and rejects the whole file', () => {
    const set = setFor(csvFor([cells('LT-101', '900', 'U-101'), cells('PT-200', '100', 'U-101')]))
    expect(set.ok).toBe(false)
    expect(set.problems[0]!.reason).toContain('Unknown Area')
  })

  it('25: an unknown Unit is rejected', () => {
    const set = setFor(csvFor([cells('PT-200', '100', 'U-999')]))
    expect(set.ok).toBe(false)
    expect(set.problems[0]!.reason).toContain('has no Unit')
  })

  it('26: nothing in the import creates hierarchy', () => {
    const before = JSON.stringify({ areas: doc().areas, units: doc().units })
    setFor(csvFor([cells('PT-200', 'NEW', 'NEW-1')]))
    expect(JSON.stringify({ areas: doc().areas, units: doc().units })).toBe(before)
  })

  it('an Area with no Unit is refused rather than half-honoured', () => {
    const set = setFor(csvFor([cells('PT-200', '100', '')]))
    expect(set.ok).toBe(false)
    expect(set.problems[0]!.reason).toContain('no Unit')
  })

  it('a blank Unit with a blank Area clears the assignment, visibly', () => {
    const set = setFor(csvFor([cells('LT-101', '', '')]))
    expect(set.ok).toBe(true)
    expect(set.modified[0]).toMatchObject({ key: 'LT-101', field: UNIT_FIELD, before: 'U-101', after: '', unitId: '' })
  })

  it('disambiguates one unit code between two areas', () => {
    const a2 = st().addArea('200')
    const u2 = st().addUnit(a2, 'U-101')
    expect(setFor(csvFor([cells('PT-200', '', 'U-101')])).problems[0]!.reason).toContain('2 areas')
    const set = setFor(csvFor([cells('PT-200', '200', 'U-101')]))
    expect(set.ok).toBe(true)
    expect(set.modified[0]!.unitId).toBe(u2)
  })

  it('applies a resolved assignment as a real write, in one undo step', () => {
    const set = setFor(csvFor([cells('PT-200', '100', 'U-101')]))
    st().applyRecordEdits(set.modified.map((c) => ({
      key: c.key, kind: 'instrument' as const, field: c.field, value: c.after,
      ...(c.unitId !== undefined ? { unitId: c.unitId } : {}),
    })))
    expect(doc().registry!['PT-200']!.unitId).toBe(unitId)
    st().undo()
    expect(doc().registry!['PT-200']!.unitId).toBeUndefined()
  })

  it('the clipboard path resolves a unit exactly as a file does', () => {
    const ok = buildPasteChangeSet(doc(), [{ key: 'PT-200', field: UNIT_FIELD, value: 'U-101' }])
    expect(ok.ok).toBe(true)
    expect(ok.modified[0]!.unitId).toBe(unitId)
    const bad = buildPasteChangeSet(doc(), [{ key: 'PT-200', field: UNIT_FIELD, value: 'U-999' }])
    expect(bad.ok).toBe(false)
  })
})

/* --------------------------------------------------------- 27-29 revisions */

const find = (cs: DocChange[], p: Partial<DocChange>): DocChange | undefined =>
  cs.find((c) => Object.entries(p).every(([k, v]) => (c as unknown as Record<string, unknown>)[k] === v))

describe('revisions', () => {
  it('27: an issued snapshot carries the hierarchy and the assignment', async () => {
    const sheetId = doc().sheets[0]!.id
    const rev = st().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, rev)
    const snap = await getSnapshot(revisionsOf(doc().sheets[0]!)[0]!.snapshotId!)
    expect(snap!.areas).toHaveLength(1)
    expect(snap!.units![0]!.code).toBe('U-101')
    expect(snap!.registry!['LT-101']!.unitId).toBe(unitId)
  })

  it('28: renaming a unit code is a meaningful engineering change', () => {
    const before = doc()
    st().updateUnit(unitId, { code: 'U-102' })
    const d = compareDocs(before, doc())
    const change = find(d.changes, { entityType: 'unit', field: 'code' })
    expect(change).toMatchObject({ kind: 'renamed', before: 'U-101', after: 'U-102', category: 'engineering' })
    // and NOT reported again on every object assigned to it
    expect(find(d.changes, { entityType: 'record', field: 'unit' })).toBeUndefined()
  })

  it('28: reassigning an object reads as codes, not ids', () => {
    const u2 = st().addUnit(areaId, 'U-102')
    const before = doc()
    st().assignUnit('LT-101', 'instrument', u2)
    const change = find(compareDocs(before, doc()).changes, { entityType: 'record', field: 'unit' })
    expect(change).toMatchObject({ entityKey: 'LT-101', before: '100/U-101', after: '100/U-102', category: 'engineering' })
  })

  it('28: adding and removing areas and units is reported', () => {
    const before = doc()
    const a2 = st().addArea('200')
    st().removeUnit(unitId)
    const d = compareDocs(before, doc())
    expect(find(d.changes, { entityType: 'area', kind: 'added', entityId: a2 })).toBeTruthy()
    expect(find(d.changes, { entityType: 'unit', kind: 'removed', entityId: unitId })).toBeTruthy()
  })

  it('28: moving a unit to another area is reported once, on the unit', () => {
    const a2 = st().addArea('200')
    const before = doc()
    st().updateUnit(unitId, { areaId: a2 })
    const d = compareDocs(before, doc())
    expect(find(d.changes, { entityType: 'unit', field: 'area' }))
      .toMatchObject({ before: '100', after: '200', category: 'engineering' })
    expect(find(d.changes, { entityType: 'record', field: 'unit' })).toBeUndefined()
  })

  it('29: reordering the arrays produces no diff at all', () => {
    const u2 = st().addUnit(areaId, 'U-102')
    const a2 = st().addArea('200')
    const before = doc()
    const shuffled: ProjectDoc = {
      ...before,
      areas: [...before.areas!].reverse(),
      units: [...before.units!].reverse(),
    }
    expect(before.areas!.map((a) => a.id)).toContain(a2)
    expect(before.units!.map((u) => u.id)).toContain(u2)
    expect(compareDocs(before, shuffled).changes).toHaveLength(0)
  })

  it('renaming an area name only is metadata, not engineering', () => {
    const before = doc()
    st().updateArea(areaId, { name: 'Something else' })
    expect(find(compareDocs(before, doc()).changes, { entityType: 'area', field: 'name' })!.category).toBe('metadata')
  })
})

/* ------------------------------------------------------- 30-31 persistence */

describe('.pnid persistence', () => {
  const roundTrip = () => loadDoc(JSON.parse(serializeDoc(doc())))

  it('30/31: area, unit and assignment all survive save and reload', () => {
    const reopened = roundTrip()
    expect(reopened.areas).toEqual(doc().areas)
    expect(reopened.units).toEqual(doc().units)
    expect(reopened.registry!['LT-101']!.unitId).toBe(unitId)
    const h = buildHierarchy(reopened)
    expect(h.areaById.get(h.unitById.get(unitId)!.areaId)!.code).toBe('100')
  })

  it('31: the reloaded document still derives the same I/O list', () => {
    st().loadIntoStore(roundTrip())
    expect(rowFor('LT-101')).toMatchObject({ areaCode: '100', unitCode: 'U-101' })
  })

  it('a document with no hierarchy round-trips without gaining one', () => {
    st().loadIntoStore(createEmptyDoc('empty'))
    const reopened = roundTrip()
    expect(reopened.areas).toBeUndefined()
    expect(reopened.units).toBeUndefined()
  })
})
