import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { DATASHEET_SECTIONS, fieldsFor } from '../../src/model/datasheet'
import { datasheetMatrixCsv } from '../../src/export/csv'
import { createEmptyDoc } from '../../src/model/doc'

describe('datasheet model', () => {
  it('has stable sections with keyed fields', () => {
    expect(Object.keys(DATASHEET_SECTIONS)).toEqual(['general', 'process', 'element', 'signal', 'alarm'])
    expect(DATASHEET_SECTIONS.process.some((f) => f.key === 'process.fluid')).toBe(true)
  })

  it('carries the signal and alarm data the registry owns from P1-A', () => {
    const signal = DATASHEET_SECTIONS.signal.map((f) => f.key)
    for (const k of ['signal.range', 'signal.type', 'signal.units', 'signal.setpoint', 'signal.systemTag']) {
      expect(signal, `${k} must be an engineering field`).toContain(k)
    }
    expect(DATASHEET_SECTIONS.alarm.map((f) => f.key))
      .toEqual(['alarm.LL', 'alarm.L', 'alarm.H', 'alarm.HH', 'alarm.priority'])
  })

  it('prunes alarm rows for hand switches, as it does process rows', () => {
    expect(fieldsFor('HS').alarm).toEqual([])
    expect(fieldsFor('LT').alarm.length).toBeGreaterThan(0)
  })
  it('prunes process rows for hand switches', () => {
    const hs = fieldsFor('HS')
    expect(hs.process).toEqual([])
    expect(fieldsFor('FT').process.length).toBeGreaterThan(0)
  })
})

describe('datasheetMatrixCsv', () => {
  it('one row per instrument, columns only for populated keys', () => {
    const doc = createEmptyDoc('t')
    doc.sheets[0]!.nodes = [
      {
        id: 'a', symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0,
        tag: { letters: 'FT', loop: '101' },
        datasheet: { 'process.fluid': 'Cooling water', 'process.flow.norm': '120 m3/h' },
      },
      { id: 'b', symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'PT', loop: '102' } },
      { id: 'c', symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 },
    ]
    const csv = datasheetMatrixCsv(doc)
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 instruments
    expect(lines[0]).toContain('process.fluid')
    expect(lines[0]).not.toContain('element.material')
    expect(lines[1]).toContain('Cooling water')
  })
})
