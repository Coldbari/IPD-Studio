import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { loadDoc } from '../../src/model/migrate'

/** A v4 document as it was actually written before the registry existed:
 *  engineering data hanging off individual nodes by id. */
const V4 = {
  schemaVersion: 4,
  meta: { name: 'Legacy', author: 'a', created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z' },
  settings: { gridPx: 8, tagSeparator: '-' },
  hmiScreens: [],
  sheets: [
    {
      id: 's1',
      name: 'Sheet 1',
      drawingNumber: 'D-1',
      revision: '0',
      sheetSize: 'A3',
      nodes: [
        {
          id: 'n1', symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0,
          tag: { letters: 'FT', loop: '101' },
          datasheet: { 'signal.range': '0-100 m3/h', 'general.service': 'Feed water' },
        },
        {
          id: 'n2', symbolId: 'valve.gate', kind: 'valve', x: 40, y: 0, rotation: 0,
          tag: { letters: 'HV', loop: '200' },
          datasheet: { 'element.size': '2 in' },
        },
        // an untagged instrument that someone nonetheless filled in
        {
          id: 'n3', symbolId: 'instr.bubble', kind: 'instrument', x: 80, y: 0, rotation: 0,
          datasheet: { 'signal.range': 'orphaned but not lost' },
        },
        // no datasheet at all — must not create an empty record
        { id: 'n4', symbolId: 'pump.centrifugal', kind: 'equipment', x: 120, y: 0, rotation: 0 },
      ],
      edges: [],
    },
  ],
}

describe('schemaVersion 4 → 5', () => {
  const doc = loadDoc(JSON.parse(JSON.stringify(V4)))

  it('reports the current schema', () => {
    expect(doc.schemaVersion).toBe(6)
  })

  it('moves a tagged instrument datasheet into a tag-keyed record', () => {
    expect(doc.registry?.['FT-101']).toMatchObject({
      key: 'FT-101',
      kind: 'instrument',
      fields: { 'signal.range': '0-100 m3/h', 'general.service': 'Feed water' },
    })
  })

  it('classifies a valve as a valve, not generic equipment', () => {
    expect(doc.registry?.['HV-200']?.kind).toBe('valve')
    expect(doc.registry?.['HV-200']?.fields['element.size']).toBe('2 in')
  })

  // Losing someone's filled-in datasheet because the symbol was never tagged
  // would be the worst possible migration outcome.
  it('parks an untagged datasheet rather than dropping it', () => {
    expect(doc.registry?.['__unassigned:n3']?.fields['signal.range']).toBe('orphaned but not lost')
  })

  it('does not invent records for objects that had no data', () => {
    expect(doc.registry?.['P-100']).toBeUndefined()
    expect(Object.keys(doc.registry ?? {}).sort()).toEqual(['FT-101', 'HV-200', '__unassigned:n3'])
  })

  it('leaves node.datasheet in place, so an older build still reads the document', () => {
    expect(doc.sheets[0]!.nodes[0]!.datasheet).toEqual({
      'signal.range': '0-100 m3/h',
      'general.service': 'Feed water',
    })
  })

  it('is idempotent, and a second pass never clobbers a later edit', () => {
    const once = loadDoc(JSON.parse(JSON.stringify(V4)))
    once.registry!['FT-101']!.fields['signal.range'] = 'edited since'
    const twice = loadDoc(JSON.parse(JSON.stringify(once)))
    expect(twice.registry!['FT-101']!.fields['signal.range']).toBe('edited since')
    expect(Object.keys(twice.registry!).sort()).toEqual(['FT-101', 'HV-200', '__unassigned:n3'])
  })

  it('rejects a malformed registry rather than loading garbage', () => {
    const bad = { ...JSON.parse(JSON.stringify(V4)), schemaVersion: 5, registry: [] }
    expect(() => loadDoc(bad)).toThrow(/registry is malformed/)
  })

  it('carries a v5 document through untouched when it has no legacy datasheets', () => {
    const v5 = {
      ...JSON.parse(JSON.stringify(V4)),
      schemaVersion: 5,
      sheets: [{ ...V4.sheets[0], nodes: [], edges: [] }],
      registry: { 'FT-999': { key: 'FT-999', kind: 'instrument', fields: { 'signal.range': 'kept' } } },
    }
    expect(loadDoc(v5).registry?.['FT-999']?.fields['signal.range']).toBe('kept')
  })
})
