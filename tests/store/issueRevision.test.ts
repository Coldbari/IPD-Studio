// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen } from '../../src/hmi/model'
import { issueRevision, getSnapshot, hasSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { currentRevisionCode, isIssued, revisionsOf } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'

const doc = () => useStore.getState().doc
const sheet = () => doc().sheets[0]!
const rows = () => revisionsOf(sheet())

/** A drawing with engineering data, an HMI binding, and an open QA finding. */
function seed(): string {
  useStore.getState().loadIntoStore({
    ...createEmptyDoc('t'),
    hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'Overview', pipes: [],
      widgets: [{ id: 'w1', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'LT-101' }] } as HmiScreen],
  })
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  // An untagged symbol, so the QA report is not empty at issue.
  useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })
  return sheet().id
}

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('creating a revision', () => {
  it('adds an unissued row without touching the drawing', () => {
    const sheetId = seed()
    const before = { nodes: sheet().nodes, edges: sheet().edges, registry: doc().registry, screens: doc().hmiScreens }

    useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR', preparedBy: 'PN' })

    expect(rows()).toHaveLength(1)
    expect(isIssued(rows()[0]!)).toBe(false)
    expect(sheet().nodes).toBe(before.nodes)
    expect(sheet().edges).toBe(before.edges)
    expect(doc().registry).toBe(before.registry)
    expect(doc().hmiScreens).toBe(before.screens)
  })

  it('lets an unissued row be edited, and refuses to edit an issued one', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR' })
    expect(useStore.getState().updateRevision(sheetId, id, { description: 'first issue' }).ok).toBe(true)
    expect(rows()[0]!.description).toBe('first issue')

    await issueRevision(sheetId, id)
    expect(useStore.getState().updateRevision(sheetId, id, { description: 'rewritten' }).ok).toBe(false)
    expect(rows()[0]!.description).toBe('first issue')
  })
})

describe('issuing a revision', () => {
  it('stamps the row, captures a snapshot, and records the QA state', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC', preparedBy: 'PN' })

    const result = await issueRevision(sheetId, id)

    expect(result.ok).toBe(true)
    const row = rows()[0]!
    expect(isIssued(row)).toBe(true)
    expect(row.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(row.snapshotId).toBeTruthy()
    expect(await hasSnapshot(row.snapshotId!)).toBe(true)
    expect(row.qaAtIssue!.total).toBeGreaterThan(0)
  })

  it('the snapshot holds the engineering model, not a label', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)

    const snap = (await getSnapshot(rows()[0]!.snapshotId!))!
    expect(snap.sheets[0]!.nodes).toHaveLength(2)
    expect(snap.registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(snap.hmiScreens[0]!.widgets[0]!.tag).toBe('LT-101')
  })

  it('the snapshot is frozen — later edits cannot reach back into it', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const snapshotId = rows()[0]!.snapshotId!

    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-999 bar')
    useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 0, rotation: 0 })

    const snap = (await getSnapshot(snapshotId))!
    expect(snap.registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(snap.sheets[0]!.nodes).toHaveLength(2)
  })

  it('qaAtIssue is a copy — fixing findings later does not rewrite history', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const atIssue = { ...rows()[0]!.qaAtIssue! }

    // Tag the untagged symbol: the live report changes, the record must not.
    const untagged = sheet().nodes[1]!.id
    useStore.getState().setTag(untagged, { letters: 'PT', loop: '200' })
    resetQaCache()

    expect(rows()[0]!.qaAtIssue).toEqual(atIssue)
  })

  it('leaves the engineering document alone — only the revision row changes', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    const before = {
      nodes: sheet().nodes, edges: sheet().edges,
      registry: doc().registry, screens: doc().hmiScreens, qa: doc().qa,
    }

    await issueRevision(sheetId, id)

    expect(sheet().nodes).toBe(before.nodes)
    expect(sheet().edges).toBe(before.edges)
    expect(doc().registry).toBe(before.registry)
    expect(doc().hmiScreens).toBe(before.screens)
    expect(doc().qa).toBe(before.qa)
  })

  it('moves the printed revision code to the issued one', async () => {
    const sheetId = seed()
    expect(currentRevisionCode(sheet())).toBe('0')
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    expect(sheet().revision).toBe('A')
    expect(currentRevisionCode(sheet())).toBe('A')
  })

  it('refuses to issue the same revision twice', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const first = { ...rows()[0]! }
    const again = await issueRevision(sheetId, id)
    expect(again.ok).toBe(false)
    expect(rows()[0]).toEqual(first)
  })

  it('leaves earlier revisions untouched when a later one is issued', async () => {
    const sheetId = seed()
    const a = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR', preparedBy: 'PN' })
    await issueRevision(sheetId, a)
    const first = JSON.parse(JSON.stringify(rows()[0]))

    const b = useStore.getState().addRevision(sheetId, { code: 'B', status: 'IFC', preparedBy: 'RN' })
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-16 bar')
    await issueRevision(sheetId, b)

    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toEqual(first)
    expect(rows()[1]!.code).toBe('B')
    // Each issue kept its own state.
    const snapA = (await getSnapshot(rows()[0]!.snapshotId!))!
    const snapB = (await getSnapshot(rows()[1]!.snapshotId!))!
    expect(snapA.registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(snapB.registry?.['LT-101']?.fields['signal.range']).toBe('0-16 bar')
  })

  it('issue metadata survives later engineering edits', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC', preparedBy: 'PN', checkedBy: 'RN' })
    await issueRevision(sheetId, id)
    const stamped = JSON.parse(JSON.stringify(rows()[0]))

    useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 300, y: 0, rotation: 0 })
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-40 bar')

    expect(rows()[0]).toEqual(stamped)
  })
})

describe('P0-A/B/C behaviour still holds with revisions present', () => {
  it('a rename still carries its references, and does not disturb the table', async () => {
    const sheetId = seed()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const stamped = JSON.parse(JSON.stringify(rows()[0]))

    const nodeId = sheet().nodes[0]!.id
    useStore.getState().setTag(nodeId, { letters: 'LT', loop: '201' })

    expect(doc().registry?.['LT-201']).toBeDefined()
    expect(doc().hmiScreens[0]!.widgets[0]!.tag).toBe('LT-201')
    expect(rows()[0]).toEqual(stamped)
  })
})
