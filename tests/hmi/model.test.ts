import { describe, expect, it } from 'vitest'
import { createScreen, WIDGET_DEFAULT_SIZE, HMI_WORLD } from '../../src/hmi/model'
import { createEmptyDoc } from '../../src/model/doc'
import { loadDoc } from '../../src/model/migrate'
import { serializeDoc, deserializeDoc } from '../../src/persist/file'

describe('hmi model + current schema', () => {
  it('createScreen defaults to classic theme and empty content', () => {
    const s = createScreen(1)
    expect(s.name).toBe('Screen 1')
    expect(s.theme).toBe('classic')
    expect(s.widgets).toEqual([])
    expect(s.pipes).toEqual([])
    expect(s.id.length).toBeGreaterThan(10)
  })

  it('every widget type has a default size', () => {
    for (const t of ['tank','pump','valve','display','gauge','trend','lamp','button','switch','label','symbol'] as const) {
      expect(WIDGET_DEFAULT_SIZE[t].w).toBeGreaterThan(0)
    }
    expect(HMI_WORLD).toEqual({ w: 1600, h: 1000 })
  })

  it('new docs carry the current schema with hmiScreens', () => {
    const doc = createEmptyDoc()
    expect(doc.schemaVersion).toBe(6)
    expect(doc.hmiScreens).toEqual([])
  })

  it('migrates v3 (and v2) docs by adding empty hmiScreens', () => {
    const v3 = { ...createEmptyDoc(), schemaVersion: 3 } as unknown as Record<string, unknown>
    delete v3.hmiScreens
    const doc = loadDoc(v3)
    expect(doc.schemaVersion).toBe(6)
    expect(doc.hmiScreens).toEqual([])
  })

  it('round-trips hmiScreens through serialize/deserialize', () => {
    const doc = createEmptyDoc()
    doc.hmiScreens.push(createScreen(1))
    doc.hmiScreens[0]!.widgets.push({ id: 'w1', type: 'tank', x: 8, y: 8, w: 96, h: 128, tag: 'TK-1' })
    const back = deserializeDoc(serializeDoc(doc))
    expect(back.hmiScreens[0]!.widgets[0]!.tag).toBe('TK-1')
  })

  it('rejects malformed hmiScreens', () => {
    const bad = { ...createEmptyDoc(), hmiScreens: 'nope' }
    expect(() => loadDoc(bad)).toThrow(/hmiScreens/)
  })
})
