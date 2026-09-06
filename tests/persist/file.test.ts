import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { clearCurrentFileHandle, deserializeDoc, fileNameForDoc, saveFile, serializeDoc } from '../../src/persist/file'
import { createEmptyDoc } from '../../src/model/doc'
import { DocError } from '../../src/model/migrate'
import { useStore } from '../../src/store/store'

describe('doc serialization', () => {
  it('round-trips a populated doc', () => {
    const doc = createEmptyDoc('Round Trip')
    doc.sheets[0]!.nodes.push({ id: 'a', symbolId: 'pump.centrifugal', kind: 'equipment', x: 8, y: 16, rotation: 90, tag: { letters: 'P', loop: '101' } })
    doc.sheets[0]!.edges.push({
      id: 'e', lineClass: 'process.major', source: { nodeId: 'a', portId: 'discharge' },
      target: { x: 100, y: 16, pendingTag: 'V-102' }, vertices: [{ x: 80, y: 16 }], routing: 'fixed',
    })
    expect(deserializeDoc(serializeDoc(doc))).toEqual(doc)
  })
  it('rejects corrupt payloads', () => {
    expect(() => deserializeDoc('{"schemaVersion":42}')).toThrow(DocError)
    expect(() => deserializeDoc('not json')).toThrow()
  })

  it('keeps Unicode project names in the first-save filename', () => {
    expect(fileNameForDoc('HEX 工艺图')).toBe('HEX 工艺图.pnid')
    expect(fileNameForDoc('  ?/  ')).toBe('Untitled P&ID.pnid')
  })

  it('reuses the selected local file on the next save', async () => {
    clearCurrentFileHandle()
    useStore.getState().loadIntoStore(createEmptyDoc('HEX 工艺图'))
    const writes: string[] = []
    let pickerCalls = 0
    const handle = {
      async createWritable() {
        return {
          async write(value: string) { writes.push(value) },
          async close() {},
        }
      },
    }
    const globals = globalThis as unknown as { window?: Window }
    const previousWindow = globals.window
    globals.window = {
      showSaveFilePicker: async (options: { suggestedName: string }) => {
        pickerCalls++
        expect(options.suggestedName).toBe('HEX 工艺图.pnid')
        return handle
      },
    } as unknown as Window
    try {
      await saveFile()
      await saveFile()
    } finally {
      if (previousWindow) globals.window = previousWindow
      else delete globals.window
      clearCurrentFileHandle()
    }
    expect(pickerCalls).toBe(1)
    expect(writes).toHaveLength(2)
  })
})
