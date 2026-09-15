// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-7 — the four review actions, and what they must not disturb.
 *
 *  1. A thread SURVIVES deleting and redrawing the symbol. `deleteIds` never
 *     touches the registry, and that is the whole reason engineering data is
 *     keyed by tag rather than by placement.
 *  2. A thread RIDES a rename through the store's own `setTag` path.
 *  3. IT IS NOT QA. No finding appears, no count moves, no issue is blocked.
 *  4. Every action is one undo step, and touches no other record field.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { isOpen, threadsOf } from '../../src/model/review'
import { qaFor, resetQaCache } from '../../src/validate/engine'
import { buildIndex } from '../../src/model/projectIndex'
import { issueBlockers } from '../../src/model/conformance'
import { evaluateConformance } from '../../src/model/conformance'

const st = () => useStore.getState()
const doc = () => st().doc
const threads = (key: string) => threadsOf(doc().registry?.[key])

/** A tagged pump, drawn. Returns its node id. */
function pump(tag = '101'): string {
  const id = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 })
  st().setTag(id, { letters: 'P', loop: tag })
  return id
}

beforeEach(() => {
  resetQaCache?.()
  st().loadIntoStore(createEmptyDoc('review store'))
})

/* --------------------------------------------------------- the four actions */

describe('addThread', () => {
  it('starts a thread on the record, with the author it was given', () => {
    pump()
    const r = st().addThread('P-101', 'equipment', 'Design pressure looks low.', 'R Nair')
    expect(r.ok).toBe(true)
    expect(threads('P-101')).toHaveLength(1)
    expect(threads('P-101')[0]!.id).toBe(r.id)
    expect(threads('P-101')[0]!.notes[0]).toMatchObject({ body: 'Design pressure looks low.', by: 'R Nair' })
  })

  it('MINTS the record when the object has a tag but no record yet', () => {
    pump()
    expect(doc().registry?.['P-101']).toBeUndefined()
    st().addThread('P-101', 'equipment', 'first thing anybody said about it')
    expect(doc().registry!['P-101']!.kind).toBe('equipment')
  })

  it('refuses an untagged object — there is nowhere to hang it', () => {
    const r = st().addThread('', 'equipment', 'about what?')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('no tag yet')
  })

  it('refuses a blank body', () => {
    pump()
    expect(st().addThread('P-101', 'equipment', '   ').ok).toBe(false)
    expect(threads('P-101')).toHaveLength(0)
  })

  it('keeps several threads on one record, in the order they were written', () => {
    pump()
    st().addThread('P-101', 'equipment', 'first')
    st().addThread('P-101', 'equipment', 'second')
    expect(threads('P-101').map((t) => t.notes[0]!.body)).toEqual(['first', 'second'])
  })

  it('leaves every other field of the record alone', () => {
    pump()
    st().setRecordField('P-101', 'equipment', 'general.service', 'Feed')
    st().addThread('P-101', 'equipment', 'a note')
    expect(doc().registry!['P-101']!.fields['general.service']).toBe('Feed')
  })
})

describe('addNote', () => {
  it('appends a reply to the same thread', () => {
    pump()
    const { id } = st().addThread('P-101', 'equipment', 'Check the seal plan.')
    st().addNote('P-101', id!, 'Agreed — API 682 plan 11.', 'A Bose')
    const t = threads('P-101')[0]!
    expect(t.id).toBe(id)
    expect(t.notes.map((n) => n.body)).toEqual(['Check the seal plan.', 'Agreed — API 682 plan 11.'])
  })

  it('refuses a blank reply and an unknown thread', () => {
    pump()
    const { id } = st().addThread('P-101', 'equipment', 'a')
    expect(st().addNote('P-101', id!, '  ').ok).toBe(false)
    expect(st().addNote('P-101', 'no-such-thread', 'hello').ok).toBe(false)
    expect(st().addNote('NOPE-999', id!, 'hello').ok).toBe(false)
    expect(threads('P-101')[0]!.notes).toHaveLength(1)
  })
})

describe('resolve and reopen', () => {
  const started = () => {
    pump()
    return st().addThread('P-101', 'equipment', 'Check the seal plan.').id!
  }

  it('resolves, reopens and resolves again, keeping ONE thread with one id', () => {
    const id = started()
    expect(isOpen(threads('P-101')[0]!)).toBe(true)

    expect(st().resolveThread('P-101', id, 'R Nair').ok).toBe(true)
    expect(threads('P-101')[0]!.resolved).toMatchObject({ by: 'R Nair' })

    expect(st().reopenThread('P-101', id).ok).toBe(true)
    expect(isOpen(threads('P-101')[0]!)).toBe(true)

    expect(st().resolveThread('P-101', id).ok).toBe(true)
    expect(threads('P-101')).toHaveLength(1)
    expect(threads('P-101')[0]!.id).toBe(id)
  })

  it('DELETES the resolved key on reopen, so a round trip is unchanged', () => {
    const id = started()
    st().resolveThread('P-101', id)
    st().reopenThread('P-101', id)
    expect('resolved' in threads('P-101')[0]!).toBe(false)
    expect(JSON.parse(JSON.stringify(threads('P-101')[0]!))).toEqual(threads('P-101')[0])
  })

  it('refuses to restamp an already-resolved thread', () => {
    const id = started()
    st().resolveThread('P-101', id, 'R Nair')
    const at = threads('P-101')[0]!.resolved!.at
    const again = st().resolveThread('P-101', id, 'Somebody Else')
    expect(again.ok).toBe(false)
    expect(threads('P-101')[0]!.resolved).toMatchObject({ by: 'R Nair', at })
  })

  it('refuses to reopen a thread that is already open, and an unknown one', () => {
    const id = started()
    expect(st().reopenThread('P-101', id).ok).toBe(false)
    expect(st().reopenThread('P-101', 'no-such-thread').ok).toBe(false)
  })

  it('keeps the replies through resolve and reopen', () => {
    const id = started()
    st().addNote('P-101', id, 'second')
    st().resolveThread('P-101', id)
    st().reopenThread('P-101', id)
    expect(threads('P-101')[0]!.notes.map((n) => n.body)).toEqual(['Check the seal plan.', 'second'])
  })
})

/* ------------------------------------------------------------ undo / redo */

describe('undo and redo', () => {
  it('undoes and redoes a new thread as one step', () => {
    pump()
    st().addThread('P-101', 'equipment', 'a note')
    expect(threads('P-101')).toHaveLength(1)
    st().undo()
    expect(threads('P-101')).toHaveLength(0)
    st().redo()
    expect(threads('P-101')).toHaveLength(1)
  })

  it('undoes a resolve, leaving the thread open and intact', () => {
    pump()
    const { id } = st().addThread('P-101', 'equipment', 'a note')
    st().resolveThread('P-101', id!)
    st().undo()
    expect(isOpen(threads('P-101')[0]!)).toBe(true)
    expect(threads('P-101')[0]!.id).toBe(id)
  })
})

/* ------------------------------------------ the anchor, through the store */

describe('a thread follows the engineering object', () => {
  it('RIDES A RENAME through setTag', () => {
    const node = pump()
    const { id } = st().addThread('P-101', 'equipment', 'Check the seal plan.')
    st().setTag(node, { letters: 'P', loop: '201' })
    expect(doc().registry?.['P-101']).toBeUndefined()
    expect(threads('P-201').map((t) => t.id)).toEqual([id])
    expect(threads('P-201')[0]!.notes[0]!.body).toBe('Check the seal plan.')
  })

  it('SURVIVES deleting the symbol, and reattaches when it is redrawn', () => {
    const node = pump()
    const { id } = st().addThread('P-101', 'equipment', 'still relevant')
    st().deleteIds([node])
    // The symbol is gone; the review is not. `orphan-record` reports the record.
    expect(doc().sheets[0]!.nodes).toHaveLength(0)
    expect(threads('P-101').map((t) => t.id)).toEqual([id])

    pump()
    expect(threads('P-101').map((t) => t.id)).toEqual([id])
  })

  it('is untouched by moving the symbol', () => {
    const node = pump()
    const { id } = st().addThread('P-101', 'equipment', 'about the pump, not where it sits')
    st().setNodePos(node, 500, 500)
    expect(threads('P-101').map((t) => t.id)).toEqual([id])
  })
})

/* ---------------------------------------------------------- QA and gating */

describe('review comments are not QA', () => {
  const counts = () => {
    const r = qaFor(doc())
    return { ...r.counts, total: r.total }
  }

  it('adding a thread changes NO finding and NO count', () => {
    pump()
    const before = counts()
    st().addThread('P-101', 'equipment', 'Design pressure looks low.')
    expect(counts()).toEqual(before)
  })

  it('resolving a thread changes NO finding and NO count', () => {
    pump()
    const { id } = st().addThread('P-101', 'equipment', 'a note')
    const before = counts()
    st().resolveThread('P-101', id!)
    expect(counts()).toEqual(before)
  })

  it('produces no rule of its own — no finding mentions a comment', () => {
    pump()
    st().addThread('P-101', 'equipment', 'Design pressure looks low.')
    const report = qaFor(doc())
    expect(report.groups.map((g) => g.rule.id).join(' ')).not.toMatch(/comment|review|thread/i)
  })

  it('carries no severity — the thread has no such field', () => {
    pump()
    st().addThread('P-101', 'equipment', 'a note')
    expect(Object.keys(threads('P-101')[0]!).sort()).toEqual(['id', 'notes'])
  })

  it('an UNRESOLVED thread does not block issuing', () => {
    pump()
    st().addThread('P-101', 'equipment', 'an open question nobody answered')
    const report = qaFor(doc())
    const gate = { blockSeverities: ['critical' as const], requireChecker: true }
    const subject = { status: 'IFC', checkedBy: 'R Nair', approvedBy: 'A Bose' }
    const verdict = evaluateConformance(report, gate)
    const blockers = issueBlockers(subject, gate, report, verdict)
    // Whatever the drawing's own findings say, no blocker mentions a comment.
    expect(blockers.join(' ')).not.toMatch(/comment|review|thread/i)
  })
})

/* ------------------------------------------------------------ the index */

describe('the derived index', () => {
  it('carries the record with its threads, and builds no new structure for them', () => {
    pump()
    st().addThread('P-101', 'equipment', 'a note')
    const ix = buildIndex(doc())
    expect(threadsOf(ix.records['P-101'])).toHaveLength(1)
    expect('comments' in ix).toBe(false)
    expect('threads' in ix).toBe(false)
  })
})
