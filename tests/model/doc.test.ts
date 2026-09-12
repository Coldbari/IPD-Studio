import { describe, expect, it } from 'vitest'
import { createEmptyDoc, mmToPx, SHEET_SIZES_MM } from '../../src/model/doc'
import { DocError, loadDoc } from '../../src/model/migrate'

describe('createEmptyDoc', () => {
  it('creates a current-schema doc with one A3 sheet and ISO timestamps', () => {
    const doc = createEmptyDoc('Test Plant')
    expect(doc.schemaVersion).toBe(6)
    expect(doc.meta.name).toBe('Test Plant')
    expect(doc.sheets[0]!.sheetSize).toBe('A3')
    expect(new Date(doc.meta.created).toISOString()).toBe(doc.meta.created)
    expect(doc.sheets[0]!.nodes).toEqual([])
    expect(doc.sheets[0]!.edges).toEqual([])
    expect(doc.settings.gridPx).toBe(8)
  })
})

describe('sheet geometry', () => {
  it('converts mm to px at 3.7795 px/mm', () => {
    expect(mmToPx(420)).toBeCloseTo(1587.4, 1)
  })
  it('knows all six sheet sizes', () => {
    expect(SHEET_SIZES_MM.A3).toEqual({ w: 420, h: 297 })
    expect(SHEET_SIZES_MM.A1).toEqual({ w: 841, h: 594 })
    expect(Object.keys(SHEET_SIZES_MM)).toHaveLength(6)
  })
})

describe('loadDoc', () => {
  it('round-trips an empty doc', () => {
    const doc = createEmptyDoc('X')
    expect(loadDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })
  it('rejects unknown schema versions', () => {
    expect(() => loadDoc({ schemaVersion: 99 })).toThrow(DocError)
  })
  it('rejects docs with malformed sheets', () => {
    const bad = { ...createEmptyDoc('X'), sheets: [{ id: 's1' }] }
    expect(() => loadDoc(bad)).toThrow(DocError)
  })
  it('rejects non-objects', () => {
    expect(() => loadDoc('nope')).toThrow(DocError)
  })
})
