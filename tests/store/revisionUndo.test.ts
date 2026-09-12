// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { issueRevision, __resetSnapshots } from '../../src/persist/revisions'
import { isIssued, revisionsOf, currentRevisionCode } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'

/**
 * H1: an issue is a record of something that happened. Ctrl+Z is for the
 * drawing, and must not reach back through it to un-issue a document.
 */

const doc = () => useStore.getState().doc
const sheet = () => doc().sheets[0]!
const rows = () => revisionsOf(sheet())
const nodes = () => sheet().nodes

function seed(): string {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  return sheet().id
}

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('ordinary undo is untouched', () => {
  it('still reverts a drawing edit', () => {
    seed()
    const before = nodes().length
    useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 96, y: 0, rotation: 0 })
    expect(nodes()).toHaveLength(before + 1)
    useStore.getState().undo()
    expect(nodes()).toHaveLength(before)
  })

  it('still reverts a registry edit', () => {
    seed()
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
    useStore.getState().undo()
    expect(doc().registry?.['LT-101']?.fields['signal.range']).toBeUndefined()
  })

  it('still reverts a rename, with every reference it carried', () => {
    const sheetId = seed()
    expect(sheetId).toBeTruthy()
    const id = nodes()[0]!.id
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
    useStore.getState().setTag(id, { letters: 'LT', loop: '201' })
    expect(doc().registry?.['LT-201']).toBeDefined()
    useStore.getState().undo()
    expect(doc().registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc().registry?.['LT-201']).toBeUndefined()
  })
})

describe('revision control sits outside undo', () => {
  it('creating a revision records no undo step', () => {
    const sheetId = seed()
    const depth = useStore.temporal.getState().pastStates.length
    useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR' })
    expect(useStore.temporal.getState().pastStates.length).toBe(depth)
    expect(rows()).toHaveLength(1)
  })

  it('issuing records no undo step', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    const depth = useStore.temporal.getState().pastStates.length
    await issueRevision(sheetId, id)
    expect(useStore.temporal.getState().pastStates.length).toBe(depth)
  })

  it('Ctrl+Z after issuing does not un-issue the drawing', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const stamped = JSON.parse(JSON.stringify(rows()[0]))

    useStore.getState().undo()
    useStore.getState().undo()
    useStore.getState().undo()

    expect(rows()[0]).toEqual(stamped)
    expect(isIssued(rows()[0]!)).toBe(true)
    expect(currentRevisionCode(sheet())).toBe('A')
  })

  it('undoing a LATER engineering edit leaves the issued metadata intact', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const stamped = JSON.parse(JSON.stringify(rows()[0]))

    useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 200, y: 0, rotation: 0 })
    const after = nodes().length
    useStore.getState().undo()

    expect(nodes()).toHaveLength(after - 1)   // the edit really was undone...
    expect(rows()[0]).toEqual(stamped)        // ...and the issue survived it
    expect(sheet().revision).toBe('A')
  })

  it('redo does not remove or duplicate the issue', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const stamped = JSON.parse(JSON.stringify(rows()[0]))

    useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 200, y: 0, rotation: 0 })
    useStore.getState().undo()
    useStore.getState().redo()

    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toEqual(stamped)
  })

  it('discarding a work-in-progress row is not undoable either — the dialog owns it', () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR' })
    useStore.getState().deleteRevision(sheetId, id)
    expect(rows()).toHaveLength(0)
    useStore.getState().undo()
    expect(rows()).toHaveLength(0)
  })

  it('a sheet removed by an undo takes its revision table with it', () => {
    const sheetId = seed()
    useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR' })
    const second = useStore.getState().addSheet()
    useStore.getState().addRevision(second, { code: 'A', status: 'IFR' })
    expect(doc().sheets).toHaveLength(2)

    useStore.getState().undo() // removes the second sheet

    expect(doc().sheets).toHaveLength(1)
    expect(revisionsOf(doc().sheets[0]!)).toHaveLength(1)
  })
})
