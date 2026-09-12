// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { serializeDoc } from '../../src/persist/file'
import { loadDoc } from '../../src/model/migrate'
import { issueRevision, getSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { compareRevisions } from '../../src/model/diff'
import { currentRevisionCode, isIssued, revisionsOf } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'

/**
 * H4: the file is what travels. This goes through the REAL save and load path —
 * serializeDoc then loadDoc, the same pair the app uses for a `.pnid` — rather
 * than asserting against the serializer alone.
 */

const doc = () => useStore.getState().doc

async function issuedProject() {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  const sheetId = doc().sheets[0]!.id
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  // Something for the QA report to count, so qaAtIssue is not trivially zero.
  useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })

  const rev = useStore.getState().addRevision(sheetId, {
    code: 'B', status: 'IFC', description: 'Relief valve added', preparedBy: 'PN', checkedBy: 'RN',
  })
  await issueRevision(sheetId, rev)
  return { sheetId, rev }
}

/** Save and reopen exactly as the app does. */
const roundTrip = () => loadDoc(JSON.parse(serializeDoc(doc())))

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('an issued revision survives a real .pnid round-trip', () => {
  it('keeps the whole revision record', async () => {
    await issuedProject()
    const original = revisionsOf(doc().sheets[0]!)[0]!

    const reopened = roundTrip()

    expect(revisionsOf(reopened.sheets[0]!)).toHaveLength(1)
    expect(revisionsOf(reopened.sheets[0]!)[0]).toEqual(original)
  })

  it('keeps the issue status, the names and the reason for revision', async () => {
    await issuedProject()
    const row = revisionsOf(roundTrip().sheets[0]!)[0]!
    expect(row.status).toBe('IFC')
    expect(row.description).toBe('Relief valve added')
    expect(row.preparedBy).toBe('PN')
    expect(row.checkedBy).toBe('RN')
    expect(isIssued(row)).toBe(true)
    expect(row.issuedAt).toBeTruthy()
  })

  it('keeps the current revision code, so the title block still prints it', async () => {
    await issuedProject()
    const reopened = roundTrip()
    expect(reopened.sheets[0]!.revision).toBe('B')
    expect(currentRevisionCode(reopened.sheets[0]!)).toBe('B')
  })

  it('keeps the QA state captured at issue', async () => {
    await issuedProject()
    const original = revisionsOf(doc().sheets[0]!)[0]!.qaAtIssue!
    expect(original.total).toBeGreaterThan(0)
    expect(revisionsOf(roundTrip().sheets[0]!)[0]!.qaAtIssue).toEqual(original)
  })

  it('reopens at the current schema without re-migrating the table', async () => {
    await issuedProject()
    const once = roundTrip()
    expect(once.schemaVersion).toBe(6)
    const twice = loadDoc(JSON.parse(serializeDoc(once)))
    expect(revisionsOf(twice.sheets[0]!)).toEqual(revisionsOf(once.sheets[0]!))
  })
})

describe('the snapshot does not travel with the file, and says so', () => {
  it('the snapshot id survives, and resolves while it is on this machine', async () => {
    await issuedProject()
    const row = revisionsOf(roundTrip().sheets[0]!)[0]!
    expect(row.snapshotId).toBeTruthy()
    expect(await getSnapshot(row.snapshotId!)).toBeDefined()
  })

  it('on a machine that never issued it, comparison refuses rather than inventing one', async () => {
    await issuedProject()
    const sheetId = doc().sheets[0]!.id
    const second = useStore.getState().addRevision(sheetId, { code: 'C', status: 'IFC' })
    await issueRevision(sheetId, second)

    const reopened = roundTrip()
    const [a, b] = revisionsOf(reopened.sheets[0]!)

    // Opening the same file elsewhere: metadata present, bodies absent.
    __resetSnapshots()
    const result = compareRevisions(a!, b!, {
      before: await getSnapshot(a!.snapshotId!),
      after: await getSnapshot(b!.snapshotId!),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('missing-both')
    expect(result.message).toContain('no stored snapshots')
    // The revision records themselves are untouched by the refusal.
    expect(revisionsOf(reopened.sheets[0]!)).toHaveLength(2)
  })
})
