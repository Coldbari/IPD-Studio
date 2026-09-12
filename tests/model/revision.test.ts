// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import { loadDoc } from '../../src/model/migrate'
import {
  currentRevisionCode, isIssued, lastIssued, legacyRevisionId, newRevision, revisionsOf,
} from '../../src/model/revision'
import { DEFAULT_ISSUE_STATUSES, DEFAULT_STANDARD, issueStatusesOf } from '../../src/model/standard'
import type { Sheet } from '../../src/model/types'

const sheetWith = (over: Partial<Sheet>): Sheet => ({ ...createEmptyDoc('t').sheets[0]!, ...over })

describe('the Revision record', () => {
  it('is created with the required fields, and guesses nothing else', () => {
    const r = newRevision('r1', { code: 'A', status: 'IFR' })
    expect(r).toEqual({ id: 'r1', code: 'A', date: '', description: '', preparedBy: '', status: 'IFR' })
    expect(r.checkedBy).toBeUndefined()
    expect(r.issuedAt).toBeUndefined()
    expect(isIssued(r)).toBe(false)
  })

  it('carries the optional checked/approved names when they are given', () => {
    const r = newRevision('r1', { code: 'A', status: 'IFA', checkedBy: 'RN', approvedBy: 'PN' })
    expect(r.checkedBy).toBe('RN')
    expect(r.approvedBy).toBe('PN')
  })

  it('takes its statuses from the standard profile, not a hard-coded list', () => {
    expect(issueStatusesOf(DEFAULT_STANDARD)).toEqual(['WIP', 'IFR', 'IFA', 'IFC', 'AS-BUILT'])
    expect(issueStatusesOf(undefined)).toEqual([...DEFAULT_ISSUE_STATUSES])
    const house = { ...DEFAULT_STANDARD, issueStatuses: ['DRAFT', 'ISSUED'] }
    expect(issueStatusesOf(house)).toEqual(['DRAFT', 'ISSUED'])
  })

  it('an empty configured list falls back rather than leaving nothing to pick', () => {
    expect(issueStatusesOf({ ...DEFAULT_STANDARD, issueStatuses: [] })).toEqual([...DEFAULT_ISSUE_STATUSES])
  })
})

describe('the current revision code', () => {
  it('is the stored string until something is issued', () => {
    expect(currentRevisionCode(sheetWith({ revision: 'B', revisions: [] }))).toBe('B')
  })

  it('is the LAST issued code once the sheet has been issued', () => {
    const sheet = sheetWith({
      revision: 'A',
      revisions: [
        { ...newRevision('r1', { code: 'A', status: 'IFR' }), issuedAt: '2026-01-01T00:00:00Z' },
        { ...newRevision('r2', { code: 'B', status: 'IFC' }), issuedAt: '2026-02-01T00:00:00Z' },
        newRevision('r3', { code: 'C', status: 'WIP' }),
      ],
    })
    expect(currentRevisionCode(sheet)).toBe('B')
    expect(lastIssued(sheet)?.code).toBe('B')
  })
})

describe('schemaVersion 5 → 6 migration', () => {
  /** A pre-schema-6 document: a revision STRING and no table. */
  const v5 = (revision: string): Record<string, unknown> => {
    const sheet = { ...createEmptyDoc('t').sheets[0]!, id: 'sh1', revision } as Record<string, unknown>
    delete sheet.revisions
    return { ...createEmptyDoc('t'), schemaVersion: 5, sheets: [sheet] }
  }

  it('turns a legacy revision string into a revision record', () => {
    const doc = loadDoc(v5('A'))
    const rows = revisionsOf(doc.sheets[0]!)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.code).toBe('A')
    expect(rows[0]!.id).toBe(legacyRevisionId('sh1'))
  })

  it('invents no history — no date, no name, and NOT issued', () => {
    const row = revisionsOf(loadDoc(v5('A')).sheets[0]!)[0]!
    expect(row.date).toBe('')
    expect(row.description).toBe('')
    expect(row.preparedBy).toBe('')
    expect(row.checkedBy).toBeUndefined()
    expect(row.approvedBy).toBeUndefined()
    // Being issued is a fact the old document never recorded.
    expect(row.issuedAt).toBeUndefined()
    expect(row.snapshotId).toBeUndefined()
    expect(row.qaAtIssue).toBeUndefined()
    expect(row.status).toBe('WIP')
  })

  it('leaves the untouched default "0" alone rather than minting a revision', () => {
    expect(revisionsOf(loadDoc(v5('0')).sheets[0]!)).toHaveLength(0)
    expect(revisionsOf(loadDoc(v5('')).sheets[0]!)).toHaveLength(0)
  })

  it('is idempotent — migrating twice yields the same single row', () => {
    const once = loadDoc(v5('A'))
    const twice = loadDoc(JSON.parse(JSON.stringify(once)))
    expect(revisionsOf(twice.sheets[0]!)).toEqual(revisionsOf(once.sheets[0]!))
    expect(revisionsOf(twice.sheets[0]!)).toHaveLength(1)
  })

  it('never rewrites a table that already exists', () => {
    const existing = v5('A')
    existing.schemaVersion = 6
    ;(existing.sheets as Record<string, unknown>[])[0]!.revisions = [newRevision('mine', { code: 'Z', status: 'IFC' })]
    const out = loadDoc(existing)
    expect(revisionsOf(out.sheets[0]!)).toHaveLength(1)
    expect(revisionsOf(out.sheets[0]!)[0]!.code).toBe('Z')
  })

  it('keeps the stored revision string exactly, so exports do not move', () => {
    expect(loadDoc(v5('A')).sheets[0]!.revision).toBe('A')
  })

  it('leaves a project with no revision information valid', () => {
    const doc = loadDoc(v5('0'))
    expect(doc.schemaVersion).toBe(6)
    expect(currentRevisionCode(doc.sheets[0]!)).toBe('0')
  })
})
