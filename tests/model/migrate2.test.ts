import { describe, expect, it } from 'vitest'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { DocError, loadDoc } from '../../src/model/migrate'

const V1_DOC = {
  schemaVersion: 1,
  meta: {
    name: 'Legacy Plant', drawingNumber: 'PID-9', revision: 'C', author: 'Alex',
    sheetSize: 'A2', created: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z',
  },
  settings: { gridPx: 8, tagSeparator: '-' },
  nodes: [{ id: 'n1', symbolId: 'pump.centrifugal', kind: 'equipment', x: 8, y: 8, rotation: 0 }],
  edges: [{ id: 'e1', lineClass: 'process.major', source: { nodeId: 'n1', portId: 'discharge' }, target: { x: 96, y: 8 } }],
}

describe('schema v2', () => {
  it('createEmptyDoc emits the current schema with one sheet', () => {
    const doc = createEmptyDoc('Fresh')
    expect(doc.schemaVersion).toBe(6)
    expect(doc.meta.name).toBe('Fresh')
    expect(doc.sheets).toHaveLength(1)
    expect(doc.sheets[0]!.sheetSize).toBe('A3')
    expect(doc.sheets[0]!.name).toBe('Sheet 1')
  })
  it('createSheet makes numbered sheets', () => {
    expect(createSheet(3).name).toBe('Sheet 3')
  })
  it('migrates v1 docs into a single sheet', () => {
    const doc = loadDoc(JSON.parse(JSON.stringify(V1_DOC)))
    expect(doc.schemaVersion).toBe(6)
    expect(doc.meta.name).toBe('Legacy Plant')
    expect(doc.sheets).toHaveLength(1)
    const sheet = doc.sheets[0]!
    expect(sheet.drawingNumber).toBe('PID-9')
    expect(sheet.revision).toBe('C')
    expect(sheet.sheetSize).toBe('A2')
    expect(sheet.nodes).toHaveLength(1)
    expect(sheet.edges).toHaveLength(1)
  })
  it('round-trips v2 docs', () => {
    const doc = createEmptyDoc('RT')
    expect(loadDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })
  it('rejects docs with no sheets and unknown versions', () => {
    expect(() => loadDoc({ schemaVersion: 2, meta: { name: 'x' }, settings: {}, sheets: [] })).toThrow(DocError)
    expect(() => loadDoc({ schemaVersion: 3, meta: { name: 'x' }, settings: {}, sheets: [] })).toThrow(DocError)
    expect(() => loadDoc({ schemaVersion: 99 })).toThrow(DocError)
  })
})
