// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { serializeDoc } from '../../src/persist/file'
import { loadDoc } from '../../src/model/migrate'
import { buildChangeSet, buildPasteChangeSet, normaliseValue, parseCsv } from '../../src/model/bulkEdit'
import { ENGINEERING_COLUMNS, ENGINEERING_SPEC, engineeringCsv, engineeringRows, guardFormula } from '../../src/export/csv'
import { compareDocs } from '../../src/model/diff'
import { deriveIoList } from '../../src/model/ioList'
import { buildIndex } from '../../src/model/projectIndex'
import { alarmOrder, signalDataInvalid } from '../../src/validate/rules/signal'
import { issueRevision, getSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { revisionsOf } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'
import type { ProjectDoc } from '../../src/model/types'

const doc = () => useStore.getState().doc
const fieldsOf = (key: string) => doc().registry?.[key]?.fields ?? {}

/** Two tagged instruments with records. */
function seed(): void {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  for (const [letters, loop] of [['LT', '101'], ['PT', '200']] as const) {
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters, loop })
  }
  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  useStore.getState().setRecordField('LT-101', 'instrument', 'alarm.H', '8')
  useStore.getState().setRecordField('PT-200', 'instrument', 'signal.units', 'bar')
}

/** Build a CSV with the exporter's own header, so tests exercise the real schema. */
function csv(rows: string[][]): string {
  return [ENGINEERING_COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n'
}
const cellsFor = (key: string, over: Record<string, string> = {}): string[] => {
  const f = { ...fieldsOf(key), ...over }
  return [key, ...ENGINEERING_SPEC.slice(1).map((c) => f[c.field!] ?? '')]
}
const setFor = (text: string, d: ProjectDoc = doc()) => buildChangeSet(d, parseCsv(text), ENGINEERING_SPEC)

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('the CSV parser', () => {
  it('handles quotes, commas and newlines inside fields', () => {
    const t = parseCsv('a,b\n"x,1","he said ""hi""\nsecond line"\n')
    expect(t[1]).toEqual(['x,1', 'he said "hi"\nsecond line'])
  })

  it('ignores a BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('export', () => {
  it('has deterministic columns and tag-ordered rows', () => {
    seed()
    const out = engineeringCsv(doc())
    expect(out.split('\n')[0]).toBe(ENGINEERING_COLUMNS.join(','))
    expect(engineeringRows(doc()).map((r) => r.recordKey)).toEqual(['LT-101', 'PT-200'])
    expect(engineeringCsv(doc())).toBe(out)
  })

  it('carries every P1-A engineering field', () => {
    for (const f of ['signal.type', 'signal.units', 'signal.systemTag', 'signal.setpoint',
      'alarm.LL', 'alarm.L', 'alarm.H', 'alarm.HH', 'alarm.priority']) {
      expect(ENGINEERING_SPEC.some((c) => c.field === f), f).toBe(true)
    }
  })

  it('exports no inert column that an import would have to ignore', () => {
    // Every column earns its place: the Tag is the identity, a `field` column
    // is written back, and an `assign` column is a hierarchy reference the
    // import resolves (Unit) or reads to disambiguate one (Area). A column
    // that was none of those would be a value a user could edit and watch
    // silently vanish on the way back in.
    const inert = ENGINEERING_SPEC.filter((c) => !c.field && !c.assign).map((c) => c.label)
    expect(inert).toEqual(['Tag'])
  })

  it('neutralises formulas without mangling negative numbers', () => {
    expect(guardFormula('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(guardFormula('@X')).toBe("'@X")
    expect(guardFormula('-50')).toBe('-50')
    expect(guardFormula('-abc')).toBe("'-abc")
  })

  it('round-trips a guarded value back to itself', () => {
    seed()
    useStore.getState().setRecordField('LT-101', 'instrument', 'general.service', '=DANGER')
    const set = setFor(engineeringCsv(doc()))
    expect(set.ok).toBe(true)
    expect(set.modified).toHaveLength(0) // the apostrophe is stripped on the way in
  })
})

describe('import identity and safety', () => {
  it('an unmodified export produces no changes', () => {
    seed()
    const set = setFor(engineeringCsv(doc()))
    expect(set.ok).toBe(true)
    expect(set.modified).toHaveLength(0)
    expect(set.unchanged).toBe(2)
  })

  it('matches by tag, not row order', () => {
    seed()
    const set = setFor(csv([cellsFor('PT-200', { 'alarm.H': '5' }), cellsFor('LT-101')]))
    expect(set.ok).toBe(true)
    expect(set.modified).toEqual([{ key: 'PT-200', field: 'alarm.H', before: '', after: '5' }])
  })

  it('rejects an unknown key rather than creating a record', () => {
    seed()
    const set = setFor(csv([cellsFor('LT-101'), ['ZZ-999', ...ENGINEERING_SPEC.slice(1).map(() => '')]]))
    expect(set.ok).toBe(false)
    expect(set.problems[0]!.reason).toContain('Unknown engineering key')
    expect(set.modified).toHaveLength(0)
  })

  it('treats an edited Tag as an unknown key — never an implicit rename', () => {
    seed()
    const set = setFor(csv([cellsFor('LT-101').map((c, i) => (i === 0 ? 'LT-201' : c))]))
    expect(set.ok).toBe(false)
    expect(set.problems[0]!.reason).toContain('rename on the drawing')
  })

  it('rejects duplicate keys, naming every row', () => {
    seed()
    const set = setFor(csv([cellsFor('LT-101'), cellsFor('LT-101', { 'alarm.H': '9' })]))
    expect(set.ok).toBe(false)
    const dup = set.problems.find((p) => p.reason.includes('appears on rows'))!
    expect(dup.reason).toContain('2, 3')
  })

  it('an absent record is reported, never deleted', () => {
    seed()
    const set = setFor(csv([cellsFor('LT-101')]))
    expect(set.ok).toBe(true)
    expect(set.notIncluded).toEqual(['PT-200'])
    expect(set.modified.some((c) => c.key === 'PT-200')).toBe(false)
  })

  it('rejects a header that is not this report', () => {
    seed()
    expect(setFor('Tag,Whatever\nLT-101,x\n').ok).toBe(false)
  })
})

describe('value rules', () => {
  it('numeric fields must parse', () => {
    expect(normaliseValue('alarm.H', '8.5')).toEqual({ ok: true, value: '8.5' })
    expect(normaliseValue('alarm.H', 'high').ok).toBe(false)
  })

  it('enums are validated and stored in the catalogue casing', () => {
    expect(normaliseValue('signal.type', 'ai')).toEqual({ ok: true, value: 'AI' })
    expect(normaliseValue('signal.type', 'analogue').ok).toBe(false)
    expect(normaliseValue('alarm.priority', 'HIGH')).toEqual({ ok: true, value: 'high' })
  })

  it('an empty cell clears the field, and shows as a change', () => {
    seed()
    const set = setFor(csv([cellsFor('LT-101', { 'alarm.H': '' }), cellsFor('PT-200')]))
    expect(set.ok).toBe(true)
    expect(set.modified).toEqual([{ key: 'LT-101', field: 'alarm.H', before: '8', after: '' }])
  })

  it('free-text range is accepted — the QA report speaks about it, not the importer', () => {
    seed()
    expect(setFor(csv([cellsFor('LT-101', { 'signal.range': 'see datasheet' }), cellsFor('PT-200')])).ok).toBe(true)
  })

  it('rejects a file whose alarms would end up out of order', () => {
    seed()
    const set = setFor(csv([cellsFor('LT-101', { 'alarm.L': '90' }), cellsFor('PT-200')]))
    expect(set.ok).toBe(false)
    expect(set.problems[0]!.reason).toContain('out of order')
  })
})

describe('preview is non-mutating and deterministic', () => {
  it('changes nothing, however many times it runs', () => {
    seed()
    const before = doc()
    const text = csv([cellsFor('LT-101', { 'alarm.H': '9' }), cellsFor('PT-200')])
    const a = setFor(text)
    const b = setFor(text)
    expect(doc()).toBe(before)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('reports old and new values exactly', () => {
    seed()
    const set = setFor(csv([cellsFor('LT-101', { 'alarm.H': '9', 'signal.units': 'kPa' }), cellsFor('PT-200')]))
    expect(set.modified).toEqual([
      { key: 'LT-101', field: 'alarm.H', before: '8', after: '9' },
      { key: 'LT-101', field: 'signal.units', before: '', after: 'kPa' },
    ])
  })
})

describe('applying', () => {
  const applySet = (text: string) => {
    const set = setFor(text)
    if (!set.ok) return set
    useStore.getState().applyRecordEdits(
      set.modified.map((c) => ({ key: c.key, kind: 'instrument' as const, field: c.field, value: c.after })),
    )
    return set
  }

  it('applies every accepted change', () => {
    seed()
    applySet(csv([cellsFor('LT-101', { 'alarm.H': '9', 'signal.type': 'AI' }), cellsFor('PT-200', { 'signal.units': 'kPa' })]))
    expect(fieldsOf('LT-101')['alarm.H']).toBe('9')
    expect(fieldsOf('LT-101')['signal.type']).toBe('AI')
    expect(fieldsOf('PT-200')['signal.units']).toBe('kPa')
  })

  it('100 changed cells are ONE undo step, and undo restores them all', () => {
    useStore.getState().loadIntoStore(createEmptyDoc('t'))
    // Seed in ONE write too, so the history stays far from zundo's 200 cap and
    // the delta this test measures is unambiguous.
    useStore.getState().applyRecordEdits(
      Array.from({ length: 100 }, (_, i) => ({ key: `LT-${100 + i}`, kind: 'instrument' as const, field: 'alarm.H', value: '8' })),
    )
    const depth = useStore.temporal.getState().pastStates.length
    expect(depth).toBeLessThan(190)

    useStore.getState().applyRecordEdits(
      Array.from({ length: 100 }, (_, i) => ({ key: `LT-${100 + i}`, kind: 'instrument' as const, field: 'alarm.H', value: '9' })),
    )

    expect(useStore.temporal.getState().pastStates.length).toBe(depth + 1)
    expect(fieldsOf('LT-100')['alarm.H']).toBe('9')
    expect(fieldsOf('LT-199')['alarm.H']).toBe('9')

    useStore.getState().undo()
    expect(fieldsOf('LT-100')['alarm.H']).toBe('8')
    expect(fieldsOf('LT-199')['alarm.H']).toBe('8')

    useStore.getState().redo()
    expect(fieldsOf('LT-100')['alarm.H']).toBe('9')
  })

  it('an invalid file changes nothing at all', () => {
    seed()
    const before = doc()
    const set = applySet(csv([cellsFor('LT-101', { 'alarm.H': 'nine' }), cellsFor('PT-200', { 'signal.units': 'kPa' })]))
    expect(set.ok).toBe(false)
    expect(doc()).toBe(before)
  })
})

describe('clipboard paste uses the same path', () => {
  it('validates exactly as a file does', () => {
    seed()
    expect(buildPasteChangeSet(doc(), [{ key: 'LT-101', field: 'alarm.H', value: '9' }]).modified)
      .toEqual([{ key: 'LT-101', field: 'alarm.H', before: '8', after: '9' }])
    expect(buildPasteChangeSet(doc(), [{ key: 'LT-101', field: 'signal.type', value: 'nope' }]).ok).toBe(false)
    expect(buildPasteChangeSet(doc(), [{ key: 'ZZ-9', field: 'alarm.H', value: '1' }]).ok).toBe(false)
  })

  it('an invalid pasted value mutates nothing', () => {
    seed()
    const before = doc()
    buildPasteChangeSet(doc(), [{ key: 'LT-101', field: 'alarm.H', value: 'oops' }])
    expect(doc()).toBe(before)
  })

  it('says nothing about records the paste did not cover', () => {
    seed()
    expect(buildPasteChangeSet(doc(), [{ key: 'LT-101', field: 'alarm.H', value: '9' }]).notIncluded).toEqual([])
  })
})

describe('integration with everything downstream', () => {
  const applyOne = () => {
    useStore.getState().applyRecordEdits([
      { key: 'LT-101', kind: 'instrument', field: 'signal.type', value: 'DI' },
      { key: 'LT-101', kind: 'instrument', field: 'alarm.L', value: '90' },
    ])
  }

  it('QA sees the imported engineering, not just CSV syntax', () => {
    seed()
    applyOne()
    resetQaCache()
    const ix = buildIndex(doc())
    // alarm.L 90 now sits above alarm.H 8 — the engineering rule catches it.
    expect(alarmOrder.run(ix).some((f) => f.entityKey === 'LT-101')).toBe(true)
    useStore.getState().applyRecordEdits([{ key: 'LT-101', kind: 'instrument', field: 'signal.type', value: 'bogus' }])
    expect(signalDataInvalid.run(buildIndex(doc())).some((f) => f.entityKey === 'LT-101')).toBe(true)
  })

  it('P1-B derives the imported I/O type', () => {
    seed()
    const dcs = useStore.getState().addNode({ symbolId: 'ctl.dcs', kind: 'equipment', x: 300, y: 0, rotation: 0 })
    const lt = doc().sheets[0]!.nodes.find((n) => n.tag?.letters === 'LT')!.id
    useStore.getState().addEdge({ lineClass: 'signal.electric', source: { nodeId: lt, portId: 'e' }, target: { nodeId: dcs, portId: 'w' } })
    useStore.getState().applyRecordEdits([{ key: 'LT-101', kind: 'instrument', field: 'signal.type', value: 'DI' }])
    const row = deriveIoList(buildIndex(doc())).find((r) => r.key === 'LT-101')!
    expect(row.type).toBe('DI')
    expect(row.typeSource).toBe('registry')
  })

  it('P0-E comparison shows the imported fields', () => {
    seed()
    const before = doc()
    applyOne()
    const { changes } = compareDocs(before, doc())
    expect(changes.some((c) => c.field === 'signal.type' && c.after === 'DI')).toBe(true)
    expect(changes.some((c) => c.field === 'alarm.L')).toBe(true)
  })

  it('survives a .pnid round-trip', () => {
    seed()
    applyOne()
    const reopened = loadDoc(JSON.parse(serializeDoc(doc())))
    expect(reopened.registry?.['LT-101']?.fields['signal.type']).toBe('DI')
    expect(reopened.registry?.['LT-101']?.fields['alarm.L']).toBe('90')
  })

  it('a revision issued before the import keeps its own state', async () => {
    seed()
    const sheetId = doc().sheets[0]!.id
    const rev = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, rev)

    applyOne()

    const snap = (await getSnapshot(revisionsOf(doc().sheets[0]!)[0]!.snapshotId!))!
    expect(snap.registry?.['LT-101']?.fields['signal.type']).toBeUndefined()
    expect(doc().registry?.['LT-101']?.fields['signal.type']).toBe('DI')
  })
})
