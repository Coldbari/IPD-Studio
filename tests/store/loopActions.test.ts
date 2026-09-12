// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 2 — the loop store actions.
 *
 * The load-bearing assertion in most of these is not what a rejected action
 * says, but that it did NOTHING: same document identity, same registry, same
 * loops, same HMI, and no undo step. zundo's `equality` compares `doc` by
 * identity, so returning the state object unchanged is what makes a refusal
 * free — and a test that only checked `ok: false` would pass just as happily
 * over an action that had already half-written.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { collectTagRefs } from '../../src/model/references'

const st = () => useStore.getState()
const doc = () => st().doc
const loops = () => doc().loops ?? []
const rec = (key: string) => doc().registry?.[key]
const loopOf = (key: string) => rec(key)?.loopId
const historyDepth = () => useStore.temporal.getState().pastStates.length

/** Two tagged instruments and a valve, each with an engineering record. */
function seed() {
  st().loadIntoStore(createEmptyDoc('t'))
  const lt = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  st().setTag(lt, { letters: 'LT', loop: '101' })
  const lic = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })
  st().setTag(lic, { letters: 'LIC', loop: '101' })
  const lv = st().addNode({ symbolId: 'cv.globe', kind: 'valve', x: 192, y: 0, rotation: 0 })
  st().setTag(lv, { letters: 'LV', loop: '101' })
  st().setRecordField('LT-101', 'instrument', 'general.service', 'Cooling water')
  return { lt, lic, lv }
}

/** Everything a rejected action must leave exactly as it found it. */
function snapshot() {
  return {
    doc: doc(),
    registry: doc().registry,
    loops: doc().loops,
    hmi: doc().hmiScreens,
    qa: doc().qa,
    history: historyDepth(),
  }
}
function expectUntouched(before: ReturnType<typeof snapshot>) {
  // Document IDENTITY, not deep equality: a new object with the same contents
  // would still have recorded an undo step.
  expect(doc()).toBe(before.doc)
  expect(doc().registry).toBe(before.registry)
  expect(doc().loops).toBe(before.loops)
  expect(doc().hmiScreens).toBe(before.hmi)
  expect(doc().qa).toBe(before.qa)
  expect(historyDepth()).toBe(before.history)
}

beforeEach(() => {
  seed()
  useStore.temporal.getState().clear()
})

/* ------------------------------------------------------------------ addLoop */

describe('addLoop', () => {
  it('creates a loop with a stable ULID that is not the number', () => {
    const r = st().addLoop('101', { name: 'Level control', type: 'control' })
    expect(r.ok).toBe(true)
    expect(r.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(loops()).toHaveLength(1)
    expect(loops()[0]).toMatchObject({ id: r.id, number: '101', name: 'Level control', type: 'control' })
  })

  it('trims the number it is given', () => {
    st().addLoop('  101  ')
    expect(loops()[0]!.number).toBe('101')
  })

  it('refuses a blank number, and touches nothing', () => {
    const before = snapshot()
    const r = st().addLoop('   ')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/needs a number/i)
    expectUntouched(before)
  })

  it('refuses a duplicate number, and touches nothing', () => {
    st().addLoop('101')
    useStore.temporal.getState().clear()
    const before = snapshot()
    const r = st().addLoop('101')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/already exists/i)
    expect(loops()).toHaveLength(1)
    expectUntouched(before)
  })

  it('treats a duplicate as the same whatever its case or padding', () => {
    st().addLoop('F-101')
    expect(st().addLoop(' f-101 ').ok).toBe(false)
    expect(loops()).toHaveLength(1)
  })

  it('does not modify an existing loop when it refuses', () => {
    const a = st().addLoop('101', { name: 'Original' })
    st().addLoop('101', { name: 'Impostor' })
    expect(loops()).toHaveLength(1)
    expect(loops()[0]).toMatchObject({ id: a.id, name: 'Original' })
  })

  it('is one undo step, and redo brings it back', () => {
    st().addLoop('101')
    expect(historyDepth()).toBe(1)
    st().undo()
    expect(loops()).toHaveLength(0)
    st().redo()
    expect(loops()).toHaveLength(1)
    expect(loops()[0]!.number).toBe('101')
  })
})

/* --------------------------------------------------------------- updateLoop */

describe('updateLoop', () => {
  it('updates number, name, description, type and status', () => {
    const { id } = st().addLoop('101')
    const r = st().updateLoop(id!, {
      number: '201', name: 'Renamed', description: 'Why', type: 'cascade', status: 'in-review',
    })
    expect(r.ok).toBe(true)
    expect(loops()[0]).toMatchObject({
      id, number: '201', name: 'Renamed', description: 'Why', type: 'cascade', status: 'in-review',
    })
  })

  it('never moves the stable id, and memberships survive a renumber', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    st().updateLoop(id!, { number: '201' })
    expect(loops()[0]!.id).toBe(id)
    expect(loopOf('LT-101')).toBe(id)
    expect(buildIndex(doc()).loopMembers.get(id!)).toEqual(['LT-101'])
  })

  it('refuses a renumber onto another loop number, atomically', () => {
    const a = st().addLoop('101')
    st().addLoop('102')
    useStore.temporal.getState().clear()
    const before = snapshot()
    const r = st().updateLoop(a.id!, { number: '102' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/already exists/i)
    expect(loops().find((l) => l.id === a.id)!.number).toBe('101')
    expectUntouched(before)
  })

  it('allows a loop to be set to its own number', () => {
    const { id } = st().addLoop('101')
    expect(st().updateLoop(id!, { number: '101', name: 'Same number, new name' }).ok).toBe(true)
    expect(loops()[0]!.name).toBe('Same number, new name')
  })

  it('refuses a blank number and an unknown loop, atomically', () => {
    const { id } = st().addLoop('101')
    useStore.temporal.getState().clear()
    let before = snapshot()
    expect(st().updateLoop(id!, { number: '  ' }).ok).toBe(false)
    expectUntouched(before)
    before = snapshot()
    expect(st().updateLoop('nope', { name: 'x' }).ok).toBe(false)
    expectUntouched(before)
  })

  it('is one undo step, and redo reapplies it', () => {
    const { id } = st().addLoop('101')
    useStore.temporal.getState().clear()
    st().updateLoop(id!, { number: '201', type: 'control' })
    expect(historyDepth()).toBe(1)
    st().undo()
    expect(loops()[0]).toMatchObject({ number: '101' })
    expect(loops()[0]!.type).toBeUndefined()
    st().redo()
    expect(loops()[0]).toMatchObject({ number: '201', type: 'control' })
  })
})

/* --------------------------------------------------------------- assignLoop */

describe('assignLoop', () => {
  it('assigns by stable id and appears in the index', () => {
    const { id } = st().addLoop('101')
    expect(st().assignLoop('LT-101', 'instrument', id!).ok).toBe(true)
    expect(loopOf('LT-101')).toBe(id)
    expect(buildIndex(doc()).loopOfKey.get('LT-101')).toBe(id)
  })

  it('mints a record for a drawn tag that has none yet', () => {
    const { id } = st().addLoop('101')
    expect(rec('LV-101')).toBeUndefined()
    expect(st().assignLoop('LV-101', 'valve', id!).ok).toBe(true)
    expect(rec('LV-101')).toMatchObject({ key: 'LV-101', kind: 'valve', loopId: id })
  })

  it('refuses an unknown loop id, atomically', () => {
    const before = snapshot()
    const r = st().assignLoop('LT-101', 'instrument', 'no-such-loop')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/no longer in this project/i)
    expect(loopOf('LT-101')).toBeUndefined()
    expectUntouched(before)
  })

  it('refuses a key nothing is tagged with, atomically', () => {
    const { id } = st().addLoop('101')
    useStore.temporal.getState().clear()
    const before = snapshot()
    const r = st().assignLoop('PT-999', 'instrument', id!)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/nothing in this project is tagged/i)
    expect(rec('PT-999')).toBeUndefined()
    expectUntouched(before)
  })

  it('assigning the same loop again is a no-op with no undo step', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    useStore.temporal.getState().clear()
    const before = snapshot()
    expect(st().assignLoop('LT-101', 'instrument', id!).ok).toBe(true)
    expectUntouched(before)
  })

  it('assigning another loop replaces the previous membership', () => {
    const a = st().addLoop('101')
    const b = st().addLoop('102')
    st().assignLoop('LT-101', 'instrument', a.id!)
    st().assignLoop('LT-101', 'instrument', b.id!)
    expect(loopOf('LT-101')).toBe(b.id)
    const ix = buildIndex(doc())
    expect(ix.loopMembers.get(a.id!)).toBeUndefined()
    expect(ix.loopMembers.get(b.id!)).toEqual(['LT-101'])
  })

  it('undo after a replacement restores the ORIGINAL loop', () => {
    const a = st().addLoop('101')
    const b = st().addLoop('102')
    st().assignLoop('LT-101', 'instrument', a.id!)
    useStore.temporal.getState().clear()
    st().assignLoop('LT-101', 'instrument', b.id!)
    expect(loopOf('LT-101')).toBe(b.id)
    st().undo()
    expect(loopOf('LT-101')).toBe(a.id)
    st().redo()
    expect(loopOf('LT-101')).toBe(b.id)
  })

  it('keeps the record fields and the unit assignment it already had', () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    expect(rec('LT-101')).toMatchObject({
      unitId, loopId: id, fields: { 'general.service': 'Cooling water' },
    })
  })
})

/* ------------------------------------------------------------- unassignLoop */

describe('unassignLoop', () => {
  it('clears the assignment and leaves the record standing', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    const r = st().unassignLoop('LT-101')
    expect(r.ok).toBe(true)
    expect(r.id).toBe(id)
    expect(loopOf('LT-101')).toBeUndefined()
    expect(rec('LT-101')!.fields['general.service']).toBe('Cooling water')
    expect(loops()).toHaveLength(1)
  })

  it('refuses when there is no record or no assignment, atomically', () => {
    let before = snapshot()
    expect(st().unassignLoop('PT-999').ok).toBe(false)
    expectUntouched(before)
    before = snapshot()
    expect(st().unassignLoop('LT-101').ok).toBe(false)
    expectUntouched(before)
  })

  it('is undoable and redoable', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    useStore.temporal.getState().clear()
    st().unassignLoop('LT-101')
    expect(loopOf('LT-101')).toBeUndefined()
    st().undo()
    expect(loopOf('LT-101')).toBe(id)
    st().redo()
    expect(loopOf('LT-101')).toBeUndefined()
  })

  it('is NOT reachable by clearing the tag — those are different intentions', () => {
    const { lt } = seed()
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)

    st().setTag(lt, undefined)

    // The record survives a cleared tag (P0 makes that a contract), and so
    // does its loop assignment. It becomes an ORPHAN RECORD, which the
    // existing rule already reports — clearing a tag must not quietly also
    // unassign the loop, because only one of those was asked for.
    expect(rec('LT-101')?.loopId).toBe(id)
    expect(loops()).toHaveLength(1)
  })
})

/* --------------------------------------------------------------- removeLoop */

describe('removeLoop', () => {
  it('deletes the loop and clears every membership, reporting the count', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    st().assignLoop('LIC-101', 'instrument', id!)
    const r = st().removeLoop(id!)
    expect(r).toMatchObject({ ok: true, cleared: 2 })
    expect(loops()).toHaveLength(0)
    expect(loopOf('LT-101')).toBeUndefined()
    expect(loopOf('LIC-101')).toBeUndefined()
  })

  it('never deletes the records, the nodes or the HMI screens', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    const nodesBefore = doc().sheets[0]!.nodes.length
    const screensBefore = doc().hmiScreens.length
    st().removeLoop(id!)
    expect(rec('LT-101')).toBeDefined()
    expect(rec('LT-101')!.fields['general.service']).toBe('Cooling water')
    expect(doc().sheets[0]!.nodes).toHaveLength(nodesBefore)
    expect(doc().hmiScreens).toHaveLength(screensBefore)
  })

  it('leaves other loops and their memberships alone', () => {
    const a = st().addLoop('101')
    const b = st().addLoop('102')
    st().assignLoop('LT-101', 'instrument', a.id!)
    st().assignLoop('LIC-101', 'instrument', b.id!)
    st().removeLoop(a.id!)
    expect(loops()).toHaveLength(1)
    expect(loopOf('LIC-101')).toBe(b.id)
  })

  it('is ONE undo step that restores the loop AND every membership', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    st().assignLoop('LIC-101', 'instrument', id!)
    useStore.temporal.getState().clear()

    st().removeLoop(id!)
    expect(historyDepth()).toBe(1)

    st().undo()
    expect(loops()).toHaveLength(1)
    expect(loops()[0]!.id).toBe(id)
    expect(loopOf('LT-101')).toBe(id)
    expect(loopOf('LIC-101')).toBe(id)

    st().redo()
    expect(loops()).toHaveLength(0)
    expect(loopOf('LT-101')).toBeUndefined()
    expect(loopOf('LIC-101')).toBeUndefined()
  })

  it('refuses an unknown loop, atomically', () => {
    const before = snapshot()
    const r = st().removeLoop('nope')
    expect(r).toMatchObject({ ok: false, cleared: 0 })
    expectUntouched(before)
  })

  it('does not infer a replacement loop', () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    st().addLoop('102')
    st().removeLoop(id!)
    // Another loop exists and shares nothing but the project. Nothing moves.
    expect(loopOf('LT-101')).toBeUndefined()
  })
})

/* --------------------------------------------- rename carries the membership */

describe('a tag rename keeps the record attached to the same loop', () => {
  it('FT-101 -> FT-201 keeps loopId, and the loop does not change', () => {
    st().loadIntoStore(createEmptyDoc('t'))
    const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters: 'FT', loop: '101' })
    st().setRecordField('FT-101', 'instrument', 'general.service', 'Feed')
    const loop = st().addLoop('101', { type: 'control' })
    st().assignLoop('FT-101', 'instrument', loop.id!)
    const loopsBefore = doc().loops

    st().setTag(id, { letters: 'FT', loop: '201' })

    expect(rec('FT-101')).toBeUndefined()
    expect(rec('FT-201')).toMatchObject({ loopId: loop.id, fields: { 'general.service': 'Feed' } })
    // The Loop object itself is untouched — membership is a stable id, so a
    // rename is not a reference the loop had to carry.
    expect(doc().loops).toBe(loopsBefore)
    expect(buildIndex(doc()).loopMembers.get(loop.id!)).toEqual(['FT-201'])
  })

  it('introduces no new tag-reference class — only the registry label changes', () => {
    st().loadIntoStore(createEmptyDoc('t'))
    const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters: 'FT', loop: '101' })
    const loop = st().addLoop('101')
    st().assignLoop('FT-101', 'instrument', loop.id!)

    const refs = collectTagRefs(doc(), 'FT-101')
    // Exactly one machine reference — the record — and no `loop` RefWhere.
    expect(refs.map((r) => r.where)).toEqual(['registry'])
    // But the preview must SAY it is carrying the assignment.
    expect(refs[0]!.label).toMatch(/loop assignment/i)
  })
})
