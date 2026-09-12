import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import {
  EQUIPMENT_LIST_COLUMNS,
  INSTRUMENT_INDEX_COLUMNS,
  LINE_LIST_COLUMNS,
  VALVE_LIST_COLUMNS,
  equipmentListCsv,
  equipmentListRows,
  instrumentIndexCsv,
  instrumentIndexRows,
  lineListCsv,
  lineListRows,
  valveListCsv,
  valveListRows,
} from '../../src/export/csv'
import { createEmptyDoc } from '../../src/model/doc'
import type { ProjectDoc } from '../../src/model/types'

function fixture() {
  const doc = createEmptyDoc('Fixture')
  doc.sheets[0]!.nodes = [
    { id: 'ft', symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } },
    { id: 'fic', symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FIC', loop: '101' }, label: 'Feed, "main" line' },
    { id: 'pump', symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0, label: 'P-101' },
  ]
  doc.sheets[0]!.edges = [
    { id: 'e1', lineClass: 'signal.electric', source: { nodeId: 'ft', portId: 'e' }, target: { nodeId: 'fic', portId: 'w' } },
    { id: 'e2', lineClass: 'process.major', source: { nodeId: 'pump', portId: 'discharge' }, target: { x: 10, y: 10 }, lineNumber: { size: '2"', spec: 'CS150', service: 'P', seq: '001' } },
  ]
  return doc
}

/** Read one cell by its column HEADER, so a test says what it means and does
 *  not break every time a column is appended. */
function cell(columns: string[], cells: string[], header: string): string {
  const i = columns.indexOf(header)
  expect(i, `no column "${header}"`).toBeGreaterThanOrEqual(0)
  return cells[i]!
}

describe('instrumentIndexCsv', () => {
  it('produces one row per tagged instrument with expansion and connections', () => {
    const csv = instrumentIndexCsv(fixture())
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('FT-101')
    expect(lines[1]).toContain('Flow Transmitter')
    expect(lines[1]).toContain('FIC-101')
  })

  it('quotes fields containing commas and quotes', () => {
    const csv = instrumentIndexCsv(fixture())
    expect(csv).toContain('"Feed, ""main"" line"')
  })

  // The seven original columns are a contract: anything reading this CSV by
  // index still works, and new columns only ever arrive after them.
  it('keeps the original columns in their original positions', () => {
    expect(INSTRUMENT_INDEX_COLUMNS.slice(0, 7)).toEqual([
      'Tag', 'Description', 'Loop', 'Symbol', 'Sheet', 'Connected To', 'Notes',
    ])
    expect(instrumentIndexCsv(fixture()).split('\n')[0])
      .toMatch(/^Tag,Description,Loop,Symbol,Sheet,Connected To,Notes,/)
  })

  it('prints the engineering record', () => {
    const doc = fixture()
    doc.registry = {
      'FT-101': {
        key: 'FT-101',
        kind: 'instrument',
        fields: {
          'general.service': 'Feed water',
          'general.area': 'Unit 100',
          'signal.range': '0-150 m3/h',
          'signal.output': '4-20 mA HART',
          'signal.fail': 'Downscale',
          'general.manufacturer': 'Acme',
          'general.model': 'FT-9000',
        },
      },
    }
    const r = instrumentIndexRows(doc).find((x) => x.id === 'ft')!
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Service')).toBe('Feed water')
    // Relabelled in the P1 hardening pass: the legacy free-text field is no
    // longer called "Area / Unit", because Area and Unit are now structured
    // columns of their own two places to its right.
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Area (legacy text)')).toBe('Unit 100')
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Calibrated range')).toBe('0-150 m3/h')
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Output signal')).toBe('4-20 mA HART')
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Fail action')).toBe('Downscale')
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Manufacturer')).toBe('Acme')
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Model')).toBe('FT-9000')
  })

  it('leaves engineering columns empty when there is no record at all', () => {
    const r = instrumentIndexRows(fixture()).find((x) => x.id === 'ft')!
    expect(r.cells).toHaveLength(INSTRUMENT_INDEX_COLUMNS.length)
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Calibrated range')).toBe('')
  })

  it('leaves engineering columns empty when the record exists but is empty', () => {
    const doc = fixture()
    doc.registry = { 'FT-101': { key: 'FT-101', kind: 'instrument', fields: {} } }
    const r = instrumentIndexRows(doc).find((x) => x.id === 'ft')!
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Calibrated range')).toBe('')
  })

  // A document written before schemaVersion 5 keeps its data in node.datasheet.
  // `fieldValue()` reads the record first and that second, so the index prints
  // everything a legacy file has without it being migrated first.
  it('falls back to a legacy node datasheet when there is no record', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes[0]!.datasheet = { 'signal.range': '0-100 kPa', 'general.service': 'Legacy service' }
    const r = instrumentIndexRows(doc).find((x) => x.id === 'ft')!
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Calibrated range')).toBe('0-100 kPa')
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Service')).toBe('Legacy service')
  })

  it('prefers the record over the legacy datasheet for the same field', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes[0]!.datasheet = { 'signal.range': 'stale' }
    doc.registry = { 'FT-101': { key: 'FT-101', kind: 'instrument', fields: { 'signal.range': 'current' } } }
    const r = instrumentIndexRows(doc).find((x) => x.id === 'ft')!
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Calibrated range')).toBe('current')
  })

  // The record is keyed by TAG, so renaming the symbol's tag and moving the
  // record with it is the whole point: the report follows the rename.
  it('follows a rename, because the report joins on the tag', () => {
    const doc = fixture()
    doc.registry = { 'FT-102': { key: 'FT-102', kind: 'instrument', fields: { 'signal.range': '0-150' } } }
    doc.sheets[0]!.nodes[0]!.tag = { letters: 'FT', loop: '102' }
    const r = instrumentIndexRows(doc).find((x) => x.id === 'ft')!
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Tag')).toBe('FT-102')
    expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Calibrated range')).toBe('0-150')
  })

  // Two symbols wearing one tag are one engineering object drawn twice, so
  // they read the same record. That is the correct behaviour, and the duplicate
  // tag itself is reported by the QA engine, not hidden here.
  it('gives both halves of a duplicate tag the same record', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes.push({
      id: 'ft2', symbolId: 'instr.bubble', kind: 'instrument', x: 90, y: 0, rotation: 0,
      tag: { letters: 'FT', loop: '101' },
    })
    doc.registry = { 'FT-101': { key: 'FT-101', kind: 'instrument', fields: { 'signal.range': '0-150' } } }
    const rows = instrumentIndexRows(doc).filter((r) => r.cells[0] === 'FT-101')
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(cell(INSTRUMENT_INDEX_COLUMNS, r.cells, 'Calibrated range')).toBe('0-150')
  })

  // A pasted symbol is renumbered by the store, so it is a NEW engineering
  // object and must not inherit the original's spec.
  it('gives a copied symbol under a new tag no record', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes.push({
      id: 'ftCopy', symbolId: 'instr.bubble', kind: 'instrument', x: 90, y: 0, rotation: 0,
      tag: { letters: 'FT', loop: '102' },
    })
    doc.registry = { 'FT-101': { key: 'FT-101', kind: 'instrument', fields: { 'signal.range': '0-150' } } }
    const copy = instrumentIndexRows(doc).find((r) => r.cells[0] === 'FT-102')!
    expect(cell(INSTRUMENT_INDEX_COLUMNS, copy.cells, 'Calibrated range')).toBe('')
  })
})

describe('lineListCsv', () => {
  it('lists numbered lines with endpoints', () => {
    const csv = lineListCsv(fixture())
    const lines = csv.trim().split('\n')
    expect(lines[1]).toContain('"2""-CS150-P-001"')
    expect(lines[1]).toContain('P-101')
    expect(lines[1]).toContain('free end')
  })

  it('keeps the original columns in their original positions', () => {
    expect(LINE_LIST_COLUMNS.slice(0, 9)).toEqual([
      'Line Number', 'Class', 'Size', 'Spec', 'Service', 'Seq', 'Sheet', 'From', 'To',
    ])
    expect(lineListCsv(fixture()).split('\n')[0])
      .toMatch(/^Line Number,Class,Size,Spec,Service,Seq,Sheet,From,To,/)
  })

  it('prints the line record, joined on the line number', () => {
    const doc = fixture()
    doc.registry = {
      '2"-CS150-P-001': {
        key: '2"-CS150-P-001',
        kind: 'line',
        fields: {
          'general.fluid': 'Cooling water',
          'spec.size': 'DN50',
          'spec.class': 'CS150',
          'spec.material': 'A106 Gr B',
          'spec.schedule': 'Sch 40',
          'design.pressure': '16 barg',
          'design.temperature': '120 C',
          'design.operatingPressure': '8 barg',
          'design.operatingTemperature': '45 C',
          'design.insulation': 'PP 50mm',
          'design.tracing': 'Electric',
          'design.testPressure': '24 barg',
        },
      },
    }
    const r = lineListRows(doc)[0]!
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Fluid')).toBe('Cooling water')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Nominal size')).toBe('DN50')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Pipe class / rating')).toBe('CS150')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Material')).toBe('A106 Gr B')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Schedule / thickness')).toBe('Sch 40')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Design pressure')).toBe('16 barg')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Design temperature')).toBe('120 C')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Operating pressure')).toBe('8 barg')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Operating temperature')).toBe('45 C')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Insulation')).toBe('PP 50mm')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Tracing')).toBe('Electric')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Test pressure')).toBe('24 barg')
  })

  it('leaves the record columns empty when the line has no record', () => {
    const r = lineListRows(fixture())[0]!
    expect(r.cells).toHaveLength(LINE_LIST_COLUMNS.length)
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Material')).toBe('')
  })

  // From/To are derived from what the line is actually connected to, so they
  // stay the drawing's answer and are never printed a second time out of a
  // typed field. One question, one column.
  it('answers From and To from the drawing, not from a typed field', () => {
    const doc = fixture()
    doc.registry = {
      '2"-CS150-P-001': {
        key: '2"-CS150-P-001', kind: 'line',
        fields: { 'general.from': 'TYPED FROM', 'general.to': 'TYPED TO', 'general.service': 'TYPED SERVICE' },
      },
    }
    const r = lineListRows(doc)[0]!
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'From')).toBe('P-101')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'To')).toBe('free end')
    expect(cell(LINE_LIST_COLUMNS, r.cells, 'Service')).toBe('P')
    expect(r.cells).not.toContain('TYPED FROM')
    expect(r.cells).not.toContain('TYPED TO')
    expect(r.cells).not.toContain('TYPED SERVICE')
  })
})

describe('equipmentListCsv', () => {
  it('lists equipment, tagged or not, and says so with an empty tag', () => {
    const rows = equipmentListRows(fixture())
    expect(rows).toHaveLength(1)
    expect(cell(EQUIPMENT_LIST_COLUMNS, rows[0]!.cells, 'Tag')).toBe('')
    expect(cell(EQUIPMENT_LIST_COLUMNS, rows[0]!.cells, 'Label')).toBe('P-101')
    expect(cell(EQUIPMENT_LIST_COLUMNS, rows[0]!.cells, 'Symbol')).toBe('Centrifugal Pump')
  })

  it('prints the equipment record once the object is tagged', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes[2]!.tag = { letters: 'P', loop: '101' }
    doc.registry = {
      'P-101': {
        key: 'P-101', kind: 'equipment',
        fields: {
          'general.service': 'Crude feed',
          'duty.capacity': '120 m3/h',
          'duty.head': '45 m',
          'duty.power': '30 kW',
          'duty.designPressure': '20 barg',
          'construction.material': 'CS',
        },
      },
    }
    const r = equipmentListRows(doc)[0]!
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Tag')).toBe('P-101')
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Service')).toBe('Crude feed')
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Capacity / flow')).toBe('120 m3/h')
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Head / differential')).toBe('45 m')
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Driver power')).toBe('30 kW')
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Design pressure')).toBe('20 barg')
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Material')).toBe('CS')
  })

  it('falls back to a legacy datasheet on an equipment node', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes[2]!.tag = { letters: 'P', loop: '101' }
    doc.sheets[0]!.nodes[2]!.datasheet = { 'duty.capacity': '90 m3/h' }
    const r = equipmentListRows(doc)[0]!
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Capacity / flow')).toBe('90 m3/h')
  })

  // A fitting takes the equipment RECORD kind, which is right for storage and
  // wrong for this report — an equipment list full of junctions is not one.
  it('does not list fittings as equipment', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes.push({
      id: 'red', symbolId: 'fit.reducer', kind: 'fitting', x: 40, y: 0, rotation: 0,
      tag: { letters: 'RED', loop: '1' },
    })
    expect(equipmentListRows(doc)).toHaveLength(1)
  })

  it('writes a header and one line per row', () => {
    const csv = equipmentListCsv(fixture())
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe(EQUIPMENT_LIST_COLUMNS.join(','))
    expect(lines).toHaveLength(2)
  })

  it('starts with the identity columns', () => {
    expect(EQUIPMENT_LIST_COLUMNS.slice(0, 4)).toEqual(['Tag', 'Label', 'Symbol', 'Sheet'])
  })
})

describe('valveListCsv', () => {
  function withValves(): ProjectDoc {
    const doc = fixture()
    doc.sheets[0]!.nodes.push(
      { id: 'fv', symbolId: 'cv.globe', kind: 'valve', x: 40, y: 0, rotation: 0, tag: { letters: 'FV', loop: '101' } },
      { id: 'hv', symbolId: 'valve.gate', kind: 'valve', x: 80, y: 0, rotation: 0, label: 'Isolation' },
    )
    return doc
  }

  it('lists valves, tagged or not', () => {
    const rows = valveListRows(withValves())
    expect(rows).toHaveLength(2)
    expect(cell(VALVE_LIST_COLUMNS, rows[0]!.cells, 'Tag')).toBe('FV-101')
    expect(cell(VALVE_LIST_COLUMNS, rows[1]!.cells, 'Tag')).toBe('')
    expect(cell(VALVE_LIST_COLUMNS, rows[1]!.cells, 'Label')).toBe('Isolation')
  })

  it('prints the valve record, including body, trim and actuation', () => {
    const doc = withValves()
    doc.registry = {
      'FV-101': {
        key: 'FV-101', kind: 'valve',
        fields: {
          'general.service': 'Feed water',
          'element.size': 'DN50',
          'element.rating': 'ANSI 150',
          'element.bodyMaterial': 'CS',
          'element.trim': '316 SS',
          'element.characteristic': 'Equal percentage',
          'element.cv': '48',
          'actuation.actuator': 'Spring diaphragm',
          'actuation.failPosition': 'FC',
          'actuation.positioner': 'Digital',
        },
      },
    }
    const r = valveListRows(doc)[0]!
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Service')).toBe('Feed water')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Size')).toBe('DN50')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Pressure class / rating')).toBe('ANSI 150')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Body material')).toBe('CS')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Trim')).toBe('316 SS')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Flow characteristic')).toBe('Equal percentage')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Cv / Kv')).toBe('48')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Actuator type')).toBe('Spring diaphragm')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Fail position (FC/FO/FL)')).toBe('FC')
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Positioner')).toBe('Digital')
  })

  it('leaves the record columns empty for an untagged valve', () => {
    const r = valveListRows(withValves())[1]!
    expect(r.cells).toHaveLength(VALVE_LIST_COLUMNS.length)
    expect(cell(VALVE_LIST_COLUMNS, r.cells, 'Trim')).toBe('')
  })

  it('writes a header and one line per row', () => {
    const csv = valveListCsv(withValves())
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe(VALVE_LIST_COLUMNS.join(','))
    expect(lines).toHaveLength(3)
  })
})

// Every report is a view of the same store. Nothing below copies a value.
describe('one source of truth', () => {
  it('every report reads the same record for one object', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes[2]!.tag = { letters: 'P', loop: '101' }
    doc.registry = {
      'P-101': { key: 'P-101', kind: 'equipment', fields: { 'general.service': 'Crude feed' } },
    }
    // change it in the one place it lives, and the report changes with it
    doc.registry['P-101']!.fields['general.service'] = 'Amended service'
    const r = equipmentListRows(doc)[0]!
    expect(cell(EQUIPMENT_LIST_COLUMNS, r.cells, 'Service')).toBe('Amended service')
    expect(equipmentListCsv(doc)).toContain('Amended service')
  })

  it('every row carries the id and sheet it came from, so it can be located', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes.push({ id: 'hv', symbolId: 'valve.gate', kind: 'valve', x: 80, y: 0, rotation: 0 })
    const sheetId = doc.sheets[0]!.id
    for (const rows of [instrumentIndexRows(doc), lineListRows(doc), equipmentListRows(doc), valveListRows(doc)]) {
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) {
        expect(r.id).toBeTruthy()
        expect(r.sheetId).toBe(sheetId)
      }
    }
  })

  it('every row has exactly one cell per column', () => {
    const doc = fixture()
    doc.sheets[0]!.nodes.push({ id: 'hv', symbolId: 'valve.gate', kind: 'valve', x: 80, y: 0, rotation: 0 })
    const pairs: [string[], ReturnType<typeof instrumentIndexRows>][] = [
      [INSTRUMENT_INDEX_COLUMNS, instrumentIndexRows(doc)],
      [LINE_LIST_COLUMNS, lineListRows(doc)],
      [EQUIPMENT_LIST_COLUMNS, equipmentListRows(doc)],
      [VALVE_LIST_COLUMNS, valveListRows(doc)],
    ]
    for (const [columns, rows] of pairs) {
      for (const r of rows) expect(r.cells).toHaveLength(columns.length)
    }
  })

  it('has no duplicate column header in any report', () => {
    for (const columns of [INSTRUMENT_INDEX_COLUMNS, LINE_LIST_COLUMNS, EQUIPMENT_LIST_COLUMNS, VALVE_LIST_COLUMNS]) {
      expect(new Set(columns).size).toBe(columns.length)
    }
  })
})
