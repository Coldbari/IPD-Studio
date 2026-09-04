import { beforeEach, describe, expect, it } from 'vitest'
import { clearHighlight, setHighlight, useHighlight } from '../../src/store/highlight'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

beforeEach(() => { clearHighlight() })

describe('the cite highlight channel', () => {
  it('holds ids and a tone', () => {
    setHighlight(['a', 'b'], 'warn')
    expect(useHighlight.getState().ids).toEqual(['a', 'b'])
    expect(useHighlight.getState().tone).toBe('warn')
    clearHighlight()
    expect(useHighlight.getState().ids).toEqual([])
  })

  it('never touches the document, the selection, or the undo history', () => {
    const st = useStore.getState()
    st.loadIntoStore(createEmptyDoc('hl'))
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const docBefore = useStore.getState().doc
    const undoDepth = useStore.temporal.getState().pastStates.length

    setHighlight([id])

    // identity unchanged — nothing re-rendered the drawing, nothing was saved
    expect(useStore.getState().doc).toBe(docBefore)
    expect(useStore.getState().selection).toEqual([])
    expect(useStore.temporal.getState().pastStates.length).toBe(undoDepth)
  })
})
