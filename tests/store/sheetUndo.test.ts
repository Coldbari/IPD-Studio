import { describe, expect, it } from 'vitest'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

describe('deleting a sheet', () => {
  it('is undoable', () => {
    const s = useStore.getState()
    s.loadIntoStore(createEmptyDoc())
    useStore.temporal.getState().clear()
    const second = s.addSheet()
    useStore.getState().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 8, y: 8, rotation: 0 })
    const before = useStore.getState().doc.sheets.length
    useStore.getState().deleteSheet(second)
    expect(useStore.getState().doc.sheets.length).toBe(before - 1)
    useStore.getState().undo()
    expect(useStore.getState().doc.sheets.length).toBe(before)
    expect(useStore.getState().doc.sheets.some((sh) => sh.id === second)).toBe(true)
  })
})
