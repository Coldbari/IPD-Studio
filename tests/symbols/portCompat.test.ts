import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { loadDoc } from '../../src/model/migrate'
import { deserializeDoc, serializeDoc } from '../../src/persist/file'
import { createEmptyDoc } from '../../src/model/doc'
import { dexpiXml } from '../../src/export/dexpi'
import { importDexpi } from '../../src/import/dexpi'
import { portWorld } from '../../src/canvas/alignment'
import { canConnect, compatibleKinds, explainConnection } from '../../src/canvas/connectionRules'
import { SYMBOLS } from '../../src/symbols/registry'
import type { LineClass, PlantEdge, PlantNode } from '../../src/model/types'
import type { PortKind } from '../../src/symbols/types'

/**
 * A drawing made before ports had names. Its edges address ports by the ids
 * they always used; nothing about it knows this feature exists.
 */
const OLD_DOC = {
  schemaVersion: 1,
  meta: {
    name: 'Before Names', drawingNumber: 'PID-1', revision: 'A', author: 'Sam',
    sheetSize: 'A3', created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  },
  settings: { gridPx: 8, tagSeparator: '-' },
  nodes: [
    { id: 'pu', symbolId: 'pump.centrifugal', kind: 'equipment', x: 100, y: 100, rotation: 0 },
    { id: 'tk', symbolId: 'vessel.tank', kind: 'equipment', x: 300, y: 60, rotation: 0 },
    { id: 'cv', symbolId: 'cv.globe', kind: 'valve', x: 500, y: 100, rotation: 0 },
  ],
  edges: [
    { id: 'e1', lineClass: 'process.major', source: { nodeId: 'tk', portId: 's2' }, target: { nodeId: 'pu', portId: 'suction' } },
    { id: 'e2', lineClass: 'process.major', source: { nodeId: 'pu', portId: 'discharge' }, target: { nodeId: 'cv', portId: 'w' } },
    { id: 'e3', lineClass: 'signal.pneumatic', source: { nodeId: 'cv', portId: 'sb' }, target: { x: 600, y: 40 } },
  ],
}

describe('drawings made before ports had names', () => {
  it('load, and every connection still resolves to the same point', () => {
    const doc = loadDoc(JSON.parse(JSON.stringify(OLD_DOC)))
    const sheet = doc.sheets[0]!
    expect(sheet.edges).toHaveLength(3)
    const byId = new Map(sheet.nodes.map((n) => [n.id, n]))
    for (const e of sheet.edges) {
      for (const end of [e.source, e.target]) {
        if (!('nodeId' in end)) continue
        const node = byId.get(end.nodeId)!
        // A port that resolves to a position is a port the catalogue still
        // has under that id — the only thing the document ever stored.
        expect(portWorld(node, end.portId), `${end.nodeId}:${end.portId}`).not.toBeNull()
      }
    }
    // The named ports are reached by id, exactly as before.
    expect(portWorld(byId.get('pu')!, 'discharge')).toEqual({ x: 144, y: 120 })
    expect(portWorld(byId.get('cv')!, 'sb')).toEqual({ x: 548, y: 124 })
  })

  it('save with no trace of a port name in them', () => {
    // SymbolDef is runtime catalogue metadata. If a name ever reached the
    // file, an old build would meet a field it does not know.
    const doc = loadDoc(JSON.parse(JSON.stringify(OLD_DOC)))
    const json = serializeDoc(doc)
    for (const word of ['Suction', 'Discharge', 'Positioner connection', 'Top connection', 'authoritative']) {
      expect(json, word).not.toContain(word)
    }
    expect(deserializeDoc(json)).toEqual(doc)
  })

  it('export and re-import by port id, not by name', () => {
    const doc = createEmptyDoc('Round Trip')
    const sheet = doc.sheets[0]!
    sheet.nodes = [
      { id: 'p1', symbolId: 'pump.centrifugal', kind: 'equipment', x: 96, y: 200, rotation: 0 } as PlantNode,
    ]
    sheet.edges = [
      { id: 'e1', lineClass: 'process.major', source: { nodeId: 'p1', portId: 'discharge' }, target: { x: 400, y: 200 } } as PlantEdge,
    ]
    const xml = dexpiXml(doc, sheet.id)
    expect(xml).toContain('discharge')
    expect(xml).not.toContain('Discharge')
    const back = importDexpi(xml)
    const proc = back.sheet.edges[0]!
    expect('nodeId' in proc.source && proc.source.portId).toBe('discharge')
  })
})

describe('what is legal did not move', () => {
  const KINDS: PortKind[] = ['process', 'signal', 'both']
  const CLASSES: LineClass[] = ['process.major', 'process.minor', 'process.impulse', 'signal.electric', 'signal.pneumatic']

  it('the whole compatibility table is what it was', () => {
    // Written out rather than recomputed: a rule that agrees with itself
    // proves nothing. These are the answers from before port metadata.
    const expected: Record<string, boolean> = {
      'process|process': true, 'process|signal': false, 'process|both': true,
      'signal|process': false, 'signal|signal': true, 'signal|both': true,
      'both|process': true, 'both|signal': true, 'both|both': true,
    }
    for (const a of KINDS) {
      for (const b of KINDS) expect(compatibleKinds(a, b), `${a}|${b}`).toBe(expected[`${a}|${b}`])
    }
  })

  it('canConnect still answers per line class', () => {
    for (const a of KINDS) {
      for (const b of KINDS) {
        for (const cls of CLASSES) {
          const process = cls.startsWith('process')
          const ok = process
            ? (a !== 'signal' && b !== 'signal')
            : (a !== 'process' && b !== 'process')
          expect(canConnect(a, b, cls), `${a}|${b}|${cls}`).toBe(ok)
        }
      }
    }
  })

  it('naming the ends changes the words and never the verdict', () => {
    const ends = {
      source: { symbol: 'P-101', port: 'Discharge' },
      target: { symbol: 'V-201', port: 'Top connection' },
    }
    // Legal stays legal, with or without names.
    expect(explainConnection('process', 'process', false, ends)).toBeNull()
    expect(explainConnection('process', 'process', false)).toBeNull()
    // Refused stays refused; only the sentence gains the two points.
    const bare = explainConnection('signal', 'process', false)!
    const named = explainConnection('signal', 'process', false, ends)!
    expect(named.code).toBe(bare.code)
    expect(named.title).toBe(bare.title)
    expect(named.hint).toBe(bare.hint)
    expect(named.body).toContain('P-101 discharge')
    expect(named.body).toContain('V-201 top connection')
    expect(bare.body).not.toContain('P-101')
  })

  it('every catalogue port still declares a kind', () => {
    for (const def of SYMBOLS.values()) {
      for (const p of def.ports) {
        expect(['process', 'signal', 'both'], `${def.id}:${p.id}`).toContain(p.kind)
      }
    }
  })
})
