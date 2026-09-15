// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-7 — review comment threads on an engineering record.
 *
 * The load-bearing claims, in order of how much damage getting them wrong
 * would do:
 *
 *  1. A THREAD FOLLOWS THE TAG. Renaming P-101 to P-201 carries the whole
 *     conversation, with the same ids, because `retagRegistry` spreads the
 *     record and a thread stores no tag of its own. Break the spread and this
 *     file fails.
 *  2. A THREAD SURVIVES DELETE-AND-REDRAW. `deleteIds` never touches the
 *     registry, which is the point of keying engineering data by tag.
 *  3. PURGE SAYS WHAT IT DESTROYS. A record whose only content is a review
 *     must not read "holds no engineering data".
 *  4. IT IS NOT QA. No severity, no finding, no effect on issue gating.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import {
  checkComments,
  isOpen,
  newNote,
  newThread,
  reviewAuthor,
  threadsOf,
  unresolvedCount,
  type ReviewThread,
} from '../../src/model/review'
import { retagRegistry } from '../../src/model/registry'
import { loadDoc } from '../../src/model/migrate'
import { compareDocs } from '../../src/model/diff'
import { RECORD_FIELD_COVERAGE } from '../../src/model/diff'
import { describeFix } from '../../src/assist/fixes'
import { collectTagRefs } from '../../src/model/references'
import type { EngineeringRecord } from '../../src/model/registry'
import type { PlantNode, ProjectDoc, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const AT = '2026-09-15T09:00:00.000Z'

const thread = (id: string, body: string, over: Partial<ReviewThread> = {}): ReviewThread =>
  ({ id, notes: [{ id: `${id}-n1`, body, at: AT }], ...over })

const pump = (id: string, loop: string): PlantNode =>
  ({ id, symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0, tag: { letters: 'P', loop } })

const sheetOf = (nodes: PlantNode[]): Sheet => ({ ...createSheet(1), id: 's1', nodes, edges: [] })

const rec = (key: string, over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'equipment', fields: {}, ...over })

const docOf = (registry: Record<string, EngineeringRecord>, nodes: PlantNode[] = [pump('p', '101')]): ProjectDoc =>
  ({ ...createEmptyDoc('review'), sheets: [sheetOf(nodes)], registry })

/* ------------------------------------------------------ creating things */

describe('creating threads and notes', () => {
  it('makes a thread out of its first note', () => {
    const t = newThread('Design pressure looks low for this duty.', 'R Nair')!
    expect(t.notes).toHaveLength(1)
    expect(t.notes[0]).toMatchObject({ body: 'Design pressure looks low for this duty.', by: 'R Nair' })
    expect(isOpen(t)).toBe(true)
  })

  it('gives every thread and note a stable ULID', () => {
    const a = newThread('one')!
    const b = newThread('two')!
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a.notes[0]!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a.notes[0]!.id).not.toBe(a.id)
  })

  it('REFUSES a blank body rather than storing an empty comment', () => {
    expect(newThread('')).toBeNull()
    expect(newThread('   ')).toBeNull()
    expect(newNote('\n\t ')).toBeNull()
  })

  it('trims what it stores', () => {
    expect(newThread('  spacing  ')!.notes[0]!.body).toBe('spacing')
  })

  it('leaves the author ABSENT rather than inventing one', () => {
    const t = newThread('anonymous note')!
    expect('by' in t.notes[0]!).toBe(false)
  })

  it('has no resolved key at all while open', () => {
    expect('resolved' in newThread('open')!).toBe(false)
  })
})

describe('reviewAuthor', () => {
  it('prefers the signed-in display name', () => {
    expect(reviewAuthor('R Nair', 'P Nagpure')).toBe('R Nair')
  })

  it('falls back to the document author', () => {
    expect(reviewAuthor(undefined, 'P Nagpure')).toBe('P Nagpure')
  })

  it('is absent when neither is known — blank is not a name', () => {
    expect(reviewAuthor(undefined, '')).toBeUndefined()
    expect(reviewAuthor('   ', '  ')).toBeUndefined()
  })
})

/* -------------------------------------------------------------- counting */

describe('unresolvedCount', () => {
  it('counts open threads and the objects carrying them, in one pass', () => {
    const registry = {
      'P-101': rec('P-101', { comments: [thread('t1', 'a'), thread('t2', 'b')] }),
      'P-102': rec('P-102', { comments: [thread('t3', 'c')] }),
      'P-103': rec('P-103', { comments: [thread('t4', 'd', { resolved: { at: AT } })] }),
      'P-104': rec('P-104'),
    }
    expect(unresolvedCount(registry)).toEqual({ threads: 3, records: 2 })
  })

  it('is zero for a project with no comments, and for no registry at all', () => {
    expect(unresolvedCount({})).toEqual({ threads: 0, records: 0 })
    expect(unresolvedCount(undefined)).toEqual({ threads: 0, records: 0 })
  })

  it('counts a record whose every thread is resolved as carrying none', () => {
    const registry = { 'P-101': rec('P-101', { comments: [thread('t1', 'a', { resolved: { at: AT } })] }) }
    expect(unresolvedCount(registry)).toEqual({ threads: 0, records: 0 })
  })
})

/* ------------------------------------------------------- the ANCHOR claim */

describe('a thread follows the engineering identity', () => {
  it('rides a RENAME with no migration of its own', () => {
    // THE architectural claim. `retagRegistry` spreads the record; a thread
    // stores no tag, so there is nothing to rewrite.
    const registry = { 'P-101': rec('P-101', { comments: [thread('t1', 'Check the seal plan.')] }) }
    const { registry: after, collision } = retagRegistry(registry, 'P-101', 'P-201', { oldKeyStillUsed: false })
    expect(collision).toBe(false)
    expect(after!['P-101']).toBeUndefined()
    const moved = threadsOf(after!['P-201'])
    expect(moved.map((t) => t.id)).toEqual(['t1'])
    expect(moved[0]!.notes[0]!.body).toBe('Check the seal plan.')
  })

  it('is named in the rename preview, so nothing moves silently', () => {
    const doc = docOf({ 'P-101': rec('P-101', { comments: [thread('t1', 'a'), thread('t2', 'b')] }) })
    const refs = collectTagRefs(doc, 'P-101')
    const registryRef = refs.find((r) => r.where === 'registry')!
    expect(registryRef.label).toContain('2 review threads')
  })

  it('stores no tag, no node id and no coordinate anywhere in the thread', () => {
    const t = newThread('nothing about placement', 'R Nair')!
    expect(Object.keys(t).sort()).toEqual(['id', 'notes'])
    expect(Object.keys(t.notes[0]!).sort()).toEqual(['at', 'body', 'by', 'id'])
    expect(JSON.stringify(t)).not.toContain('P-101')
  })
})

/* ------------------------------------------------------ shape validation */

describe('the load-time shape check', () => {
  const load = (registry: unknown) =>
    () => loadDoc({ ...createEmptyDoc('x'), registry })

  it('accepts a document with no comments at all — every document so far', () => {
    expect(checkComments({ 'P-101': {} })).toBeNull()
    expect(checkComments(undefined)).toBeNull()
  })

  it('accepts a well-formed thread', () => {
    expect(checkComments({ 'P-101': { comments: [thread('t1', 'fine')] } })).toBeNull()
  })

  it('REFUSES a non-array', () => {
    expect(checkComments({ 'P-101': { comments: 'nope' } })).toContain('malformed')
  })

  it('REFUSES a thread with no notes — a thread IS its notes', () => {
    expect(checkComments({ 'P-101': { comments: [{ id: 't1', notes: [] }] } })).toContain('no notes')
  })

  it('REFUSES duplicate thread and note ids', () => {
    expect(checkComments({ 'P-101': { comments: [thread('t1', 'a'), thread('t1', 'b')] } })).toContain('duplicate id')
    expect(checkComments({
      'P-101': { comments: [{ id: 't1', notes: [{ id: 'n', body: 'a', at: AT }, { id: 'n', body: 'b', at: AT }] }] },
    })).toContain('duplicate note id')
  })

  it('REFUSES a note missing its body or timestamp', () => {
    expect(checkComments({ 'P-101': { comments: [{ id: 't1', notes: [{ id: 'n1', at: AT }] }] } })).toContain('malformed')
    expect(checkComments({ 'P-101': { comments: [{ id: 't1', notes: [{ id: 'n1', body: 'x' }] }] } })).toContain('malformed')
  })

  it('refuses the FILE when the shape is malformed, and opens it when it is not', () => {
    expect(load({ 'P-101': { key: 'P-101', kind: 'equipment', fields: {}, comments: 'nope' } })).toThrow()
    expect(load({ 'P-101': { key: 'P-101', kind: 'equipment', fields: {}, comments: [thread('t1', 'ok')] } })).not.toThrow()
  })
})

/* ------------------------------------------------------------------ diff */

describe('the revision comparison', () => {
  const before = (comments: ReviewThread[]) => docOf({ 'P-101': rec('P-101', { comments }) })
  const changes = (a: ProjectDoc, b: ProjectDoc) =>
    compareDocs(a, b).changes.filter((c) => (c.field ?? '').includes('comment'))

  it('has a ruling in the compile-time ledger', () => {
    expect(RECORD_FIELD_COVERAGE.comments).toContain('compared')
    expect(RECORD_FIELD_COVERAGE.comments).toContain('timestamps excluded')
  })

  it('reports a new thread', () => {
    const c = changes(before([]), before([thread('t1', 'Check the seal plan.')]))
    expect(c).toHaveLength(1)
    expect(c[0]!.after).toContain('Check the seal plan.')
    expect(c[0]!.category).toBe('metadata')
  })

  it('reports a deleted thread', () => {
    const c = changes(before([thread('t1', 'gone')]), before([]))
    expect(c).toHaveLength(1)
    expect(c[0]!.before).toContain('gone')
    expect(c[0]!.after).toBeUndefined()
  })

  it('reports a REPLY as one change, not a rewritten conversation', () => {
    const a = thread('t1', 'Check the seal plan.')
    const b: ReviewThread = { ...a, notes: [...a.notes, { id: 't1-n2', body: 'Agreed, API 682 plan 11.', at: AT }] }
    const c = changes(before([a]), before([b]))
    expect(c).toHaveLength(1)
    expect(c[0]!.field).toContain('reply')
    expect(c[0]!.after).toContain('API 682')
  })

  it('reports resolving, and reopening, as a state change', () => {
    const open = thread('t1', 'a')
    const done: ReviewThread = { ...open, resolved: { at: AT, by: 'R Nair' } }
    const resolved = changes(before([open]), before([done]))
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.before).toBe('open')
    expect(resolved[0]!.after).toBe('resolved')
    const reopened = changes(before([done]), before([open]))
    expect(reopened[0]!.before).toBe('resolved')
    expect(reopened[0]!.after).toBe('open')
  })

  it('reports a changed note body', () => {
    const a = thread('t1', 'first wording')
    const b: ReviewThread = { ...a, notes: [{ ...a.notes[0]!, body: 'second wording' }] }
    expect(changes(before([a]), before([b]))[0]!.after).toBe('second wording')
  })

  it('reports a changed AUTHOR — who said it is part of what was said', () => {
    const a = thread('t1', 'same words')
    const b: ReviewThread = { ...a, notes: [{ ...a.notes[0]!, by: 'R Nair' }] }
    const c = changes(before([a]), before([b]))
    expect(c).toHaveLength(1)
    expect(c[0]!.field).toContain('author')
  })

  it('reports NOTHING for a reorder — threads are matched on id, never index', () => {
    const a = thread('t1', 'first')
    const b = thread('t2', 'second')
    expect(changes(before([a, b]), before([b, a]))).toEqual([])
  })

  it('reports NOTHING for a timestamp-only change — a note is not newer engineering', () => {
    const a = thread('t1', 'unchanged words')
    const b: ReviewThread = { ...a, notes: [{ ...a.notes[0]!, at: '2027-01-01T00:00:00.000Z' }] }
    expect(changes(before([a]), before([b]))).toEqual([])
  })

  it('reports NOTHING when nothing moved', () => {
    const a = thread('t1', 'steady')
    expect(changes(before([a]), before([a]))).toEqual([])
  })
})

/* --------------------------------------------------------------- purging */

describe('purging a record', () => {
  const radius = (record: Partial<EngineeringRecord>) =>
    describeFix({ kind: 'purge-record', key: 'P-101' }, docOf({ 'P-101': rec('P-101', record) })).blastRadius

  it('says the review threads will be destroyed', () => {
    expect(radius({ comments: [thread('t1', 'a'), thread('t2', 'b')] })).toContain('2 review threads')
  })

  it('does NOT read "holds no engineering data" when the only content is a review', () => {
    expect(radius({ comments: [thread('t1', 'a')] })).not.toContain('holds no engineering data')
    expect(radius({ comments: [thread('t1', 'a')] })).toContain('1 review thread')
  })

  it('names them alongside everything else a record holds', () => {
    const text = radius({
      fields: { 'general.service': 'Feed' },
      nozzles: [{ id: 'nz', number: 'N1' }],
      comments: [thread('t1', 'a')],
      unitId: 'u1',
    })
    for (const part of ['1 stored field', '1 nozzle', '1 review thread', 'unit assignment']) {
      expect(text).toContain(part)
    }
  })
})
