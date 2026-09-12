// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { deriveIoList, countNonIo } from '../../src/model/ioList'
import { ioListCsv, IO_LIST_COLUMNS, IO_LIST_SPEC, ioListRows } from '../../src/export/csv'
import { useStore } from '../../src/store/store'
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { PlantEdge, PlantNode, ProjectDoc, Tag } from '../../src/model/types'

let n = 0
const node = (p: Partial<PlantNode> & Pick<PlantNode, 'symbolId' | 'kind'>): PlantNode =>
  ({ id: `n${n++}`, x: 0, y: 0, rotation: 0, ...p })
const instr = (letters: string, loop: string, p: Partial<PlantNode> = {}): PlantNode =>
  node({ symbolId: 'instr.bubble', kind: 'instrument', tag: { letters, loop } as Tag, ...p })
const sig = (a: string, b: string, lineClass: PlantEdge['lineClass'] = 'signal.electric'): PlantEdge =>
  ({ id: `e${n++}`, lineClass, source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
const widget = (w: Partial<HmiWidget> & Pick<HmiWidget, 'id' | 'type'>): HmiWidget =>
  ({ x: 0, y: 0, w: 64, h: 64, ...w })

function docOf(nodes: PlantNode[], edges: PlantEdge[] = [], extra: Partial<ProjectDoc> = {}): ProjectDoc {
  const base = createEmptyDoc('t')
  return { ...base, sheets: [{ ...base.sheets[0]!, id: 'sh1', name: 'Sheet 1', drawingNumber: 'PID-001', nodes, edges }], ...extra }
}
const list = (doc: ProjectDoc) => deriveIoList(buildIndex(doc))
const typeOf = (doc: ProjectDoc, key: string) => list(doc).find((r) => r.key === key)?.type

/** A transmitter wired to a DCS box — the ordinary analogue input. */
function transmitter(letters = 'LT') {
  const t = instr(letters, '101')
  const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
  return { nodes: [t, dcs], edges: [sig(t.id, dcs.id)], tag: `${letters}-101`, t }
}

beforeEach(() => { n = 0 })

describe('the dataset', () => {
  it('is empty for an empty project, and exports safely', () => {
    const doc = docOf([])
    expect(list(doc)).toHaveLength(0)
    expect(ioListCsv(doc)).toBe(`${IO_LIST_COLUMNS.join(',')}\n`)
  })

  it('one instrument makes one row', () => {
    const { nodes, edges } = transmitter()
    expect(list(docOf(nodes, edges))).toHaveLength(1)
  })

  it('one instrument shown on two sheets is still one row', () => {
    const { nodes, edges, t } = transmitter()
    const base = createEmptyDoc('t')
    const doc: ProjectDoc = {
      ...base,
      sheets: [
        { ...base.sheets[0]!, id: 'sh1', name: 'Sheet 1', nodes, edges },
        { ...base.sheets[0]!, id: 'sh2', name: 'Sheet 2', nodes: [{ ...t, id: 'copy' }], edges: [] },
      ],
    }
    const rows = list(doc)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.occurrences).toBe(2)
  })

  it('four HMI widgets on one tag do not create four rows, or any row of their own', () => {
    const { nodes, edges, tag } = transmitter()
    const screen: HmiScreen = { ...createScreen(1), id: 'scr1', name: 'S', pipes: [], widgets: [
      widget({ id: 'w1', type: 'tank', tag }), widget({ id: 'w2', type: 'bar', tag }),
      widget({ id: 'w3', type: 'display', tag }), widget({ id: 'w4', type: 'gauge', tag }),
      // A widget bound to a tag no symbol carries must not invent an I/O point.
      widget({ id: 'w5', type: 'display', tag: 'PHANTOM-999' }),
    ] }
    const rows = list(docOf(nodes, edges, { hmiScreens: [screen] }))
    expect(rows).toHaveLength(1)
    expect(rows.some((r) => r.key === 'PHANTOM-999')).toBe(false)
  })

  it('carries the sheet and drawing number of the object', () => {
    const { nodes, edges, tag } = transmitter()
    const row = list(docOf(nodes, edges)).find((r) => r.key === tag)!
    expect(row.sheetName).toBe('Sheet 1')
    expect(row.drawingNumber).toBe('PID-001')
    expect(row.sheetId).toBe('sh1')
  })

  it('is ordered by engineering tag, deterministically', () => {
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    const a = instr('PT', '300'); const b = instr('FT', '100'); const c = instr('LT', '200')
    const doc = docOf([a, b, c, dcs], [sig(a.id, dcs.id), sig(b.id, dcs.id), sig(c.id, dcs.id)])
    expect(list(doc).map((r) => r.key)).toEqual(['FT-100', 'LT-200', 'PT-300'])
    expect(ioListCsv(doc)).toBe(ioListCsv(doc))
  })
})

describe('signal classification', () => {
  it('AI — a transmitter sends an analogue measurement', () => {
    const { nodes, edges } = transmitter('LT')
    expect(typeOf(docOf(nodes, edges), 'LT-101')).toBe('AI')
  })

  it('DI — a switch is a contact', () => {
    const { nodes, edges } = transmitter('LSH')
    expect(typeOf(docOf(nodes, edges), 'LSH-101')).toBe('DI')
  })

  it('DO — a solenoid valve is driven discretely', () => {
    const v = node({ symbolId: 'valve.solenoid', kind: 'valve', tag: { letters: 'XV', loop: '101' } })
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    expect(typeOf(docOf([v, dcs], [sig(dcs.id, v.id)]), 'XV-101')).toBe('DO')
  })

  it('AO — an I/P converter is where the analogue output lands', () => {
    const y = node({ symbolId: 'instr.converter', kind: 'instrument', tag: { letters: 'FY', loop: '100' } })
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    expect(typeOf(docOf([y, dcs], [sig(dcs.id, y.id)]), 'FY-100')).toBe('AO')
  })

  it('does NOT mistake a safety valve for a switch', () => {
    // PSV's S is the Safety modifier, not a Switch function. The structured
    // ISA parse is what keeps this right.
    const psv = node({ symbolId: 'valve.psv', kind: 'valve', tag: { letters: 'PSV', loop: '100' } })
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    expect(typeOf(docOf([psv, dcs], [sig(psv.id, dcs.id)]), 'PSV-100')).not.toBe('DI')
  })
})

describe('what is deliberately not an I/O point', () => {
  it('a local gauge with no signal line is left out, and counted', () => {
    const gauge = instr('PI', '400')
    const doc = docOf([gauge])
    expect(list(doc)).toHaveLength(0)
    expect(countNonIo(buildIndex(doc))).toBe(1)
  })

  it('a shared-display function is software, not field wiring', () => {
    const ctrl = instr('LIC', '101', { config: { display: 'shared' } })
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    expect(list(docOf([ctrl, dcs], [sig(ctrl.id, dcs.id)]))).toHaveLength(0)
  })

  it('a pneumatic-only device puts the electrical point on its converter', () => {
    const t = instr('LT', '101')
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    expect(list(docOf([t, dcs], [sig(t.id, dcs.id, 'signal.pneumatic')]))).toHaveLength(0)
  })
})

describe('unknowns are stated, never guessed', () => {
  it('a fieldbus signal is reported as unclassified with a reason', () => {
    const t = instr('LT', '101')
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    const row = list(docOf([t, dcs], [sig(t.id, dcs.id, 'signal.data')]))[0]!
    expect(row.type).toBe('unknown')
    expect(row.typeBasis).toContain('bus')
  })

  it('letters that do not say which way the signal travels stay unknown', () => {
    const t = instr('LI', '101') // a local indicator, wired somewhere
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    const row = list(docOf([t, dcs], [sig(t.id, dcs.id)]))[0]!
    expect(row.type).toBe('unknown')
    expect(row.typeBasis.length).toBeGreaterThan(0)
  })
})

describe('the registry is authoritative', () => {
  const withType = (fields: Record<string, string>) => {
    const { nodes, edges, tag } = transmitter('LT')
    return { doc: docOf(nodes, edges, { registry: { [tag]: { key: tag, kind: 'instrument', fields } } }), tag }
  }

  it('a stated I/O type overrides the derivation', () => {
    const { doc, tag } = withType({ 'signal.type': 'DI' })
    const row = list(doc).find((r) => r.key === tag)!
    expect(row.type).toBe('DI')          // derivation said AI
    expect(row.typeSource).toBe('registry')
  })

  it('marks a derived type as derived', () => {
    const { doc, tag } = withType({})
    expect(list(doc).find((r) => r.key === tag)!.typeSource).toBe('derived')
  })

  it('units, system tag, setpoint and alarms all print from the registry', () => {
    const { doc, tag } = withType({
      'signal.units': 'bar', 'signal.systemTag': 'AI_0101', 'signal.setpoint': '6.5',
      'alarm.LL': '1', 'alarm.L': '2', 'alarm.H': '8', 'alarm.HH': '9', 'alarm.priority': 'high',
    })
    const row = ioListRows(doc).find((r) => r.recordKey === tag)!
    for (const v of ['bar', 'AI_0101', '6.5', '1', '2', '8', '9', 'high']) {
      expect(row.cells, v).toContain(v)
    }
  })
})

describe('loops', () => {
  it('exposes the loop the tag already states', () => {
    const { nodes, edges } = transmitter('LT')
    expect(list(docOf(nodes, edges))[0]!.loopRef).toBe('L-101')
  })

  it('says when nothing else shares the loop rather than implying a relationship', () => {
    const { nodes, edges } = transmitter('LT')
    expect(list(docOf(nodes, edges))[0]!.loopIsAlone).toBe(true)

    const t = instr('LT', '101')
    const c = instr('LIC', '101')
    const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
    const doc = docOf([t, c, dcs], [sig(t.id, dcs.id)])
    expect(list(doc).find((r) => r.key === 'LT-101')!.loopIsAlone).toBe(false)
  })
})

describe('the report', () => {
  it('registry columns are editable and derived columns are not', () => {
    const editable = IO_LIST_SPEC.filter((c) => c.field).map((c) => c.field)
    expect(editable).toContain('signal.type')
    expect(editable).toContain('alarm.HH')
    // Everything worked out from the drawing is read-only by having no field.
    for (const label of ['Tag', 'Description', 'I/O type', 'Basis', 'Loop', 'Sheet']) {
      expect(IO_LIST_SPEC.find((c) => c.label === label)?.field, label).toBeUndefined()
    }
  })

  it('CSV columns match the displayed dataset exactly', () => {
    const { nodes, edges } = transmitter()
    const doc = docOf(nodes, edges)
    const header = ioListCsv(doc).split('\n')[0]!
    expect(header).toBe(IO_LIST_COLUMNS.join(','))
    expect(ioListRows(doc)[0]!.cells).toHaveLength(IO_LIST_COLUMNS.length)
  })

  it('rows carry the registry key so the record can be reached and edited', () => {
    const { nodes, edges, tag } = transmitter()
    const row = ioListRows(docOf(nodes, edges))[0]!
    expect(row.recordKey).toBe(tag)
    expect(row.recordKind).toBe('instrument')
    expect(row.sheetId).toBe('sh1')
  })
})

describe('rename and revision behaviour', () => {
  it('a rename moves the I/O identity, leaving no duplicate', () => {
    useStore.getState().loadIntoStore(createEmptyDoc('t'))
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const dcs = useStore.getState().addNode({ symbolId: 'ctl.dcs', kind: 'equipment', x: 200, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
    useStore.getState().addEdge({ lineClass: 'signal.electric', source: { nodeId: id, portId: 'e' }, target: { nodeId: dcs, portId: 'w' } })
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.units', 'bar')
    expect(list(useStore.getState().doc).map((r) => r.key)).toEqual(['LT-101'])

    useStore.getState().setTag(id, { letters: 'LT', loop: '201' })

    const rows = list(useStore.getState().doc)
    expect(rows.map((r) => r.key)).toEqual(['LT-201'])
    expect(useStore.getState().doc.registry?.['LT-201']?.fields['signal.units']).toBe('bar')
  })

  it('two revisions of a document derive two different I/O lists', () => {
    const { nodes, edges, tag } = transmitter()
    const withFields = (fields: Record<string, string>) =>
      docOf(nodes, edges, { registry: { [tag]: { key: tag, kind: 'instrument', fields } } })

    const before = ioListCsv(withFields({ 'signal.type': 'AI', 'alarm.H': '8', 'signal.units': 'bar' }))
    const afterType = ioListCsv(withFields({ 'signal.type': 'DI', 'alarm.H': '8', 'signal.units': 'bar' }))
    const afterAlarm = ioListCsv(withFields({ 'signal.type': 'AI', 'alarm.H': '9', 'signal.units': 'bar' }))
    const afterUnits = ioListCsv(withFields({ 'signal.type': 'AI', 'alarm.H': '8', 'signal.units': 'kPa' }))

    expect(afterType).not.toBe(before)
    expect(afterAlarm).not.toBe(before)
    expect(afterUnits).not.toBe(before)
  })
})
