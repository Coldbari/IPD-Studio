// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 3 — loops in a revision comparison.
 *
 * The two invariants worth more than the rest:
 *
 *  - RENUMBERING IS ONE CHANGE. Because membership points at a stable id and
 *    is only ever DISPLAYED by number, moving 101 to 201 reports once on the
 *    loop, not once per member. Without that, renumbering a ten-member loop
 *    would fill a revision report with eleven rows describing one decision.
 *  - A TAG RENAME IS NOT A LOOP CHANGE. The record moves, the loop does not.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { compareDocs, DOC_FIELD_COVERAGE, RECORD_FIELD_COVERAGE } from '../../src/model/diff'
import type { DocChange } from '../../src/model/diff'
import { createEmptyDoc } from '../../src/model/doc'
import { newLoop, type Loop } from '../../src/model/loop'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { fingerprintStandard } from '../../src/model/provenance'
import type { PlantNode, ProjectDoc, Tag } from '../../src/model/types'
import type { EngineeringRecord } from '../../src/model/registry'

const node = (id: string, tag: Tag): PlantNode =>
  ({ id, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag })

const rec = (key: string, loopId?: string): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, ...(loopId ? { loopId } : {}) })

/**
 * Before and after must share ONE sheet id.
 *
 * `createEmptyDoc()` mints a fresh ULID per call, so building each side with
 * its own call makes the two documents differ in their sheet identity — and
 * the diff then correctly reports a sheet added and a sheet removed, drowning
 * whatever the test was actually about. Keyed on stable ids is the whole
 * premise of this module; the fixture has to honour it too.
 */
const BASE = createEmptyDoc('diff')

function docOf(loops: Loop[], nodes: PlantNode[] = [], registry: Record<string, EngineeringRecord> = {}): ProjectDoc {
  return {
    ...BASE,
    sheets: [{ ...BASE.sheets[0]!, nodes, edges: [] }],
    loops,
    registry,
  }
}

const loopChanges = (before: ProjectDoc, after: ProjectDoc): DocChange[] =>
  compareDocs(before, after).changes.filter((c) => c.entityType === 'loop')

/* ------------------------------------------------------------ the entity */

describe('diffLoops', () => {
  it('reports an added loop by its number', () => {
    const l = newLoop('101')
    const c = loopChanges(docOf([]), docOf([l]))
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ kind: 'added', entityType: 'loop', entityId: l.id, entityKey: '101', category: 'engineering' })
  })

  it('reports a removed loop', () => {
    const l = newLoop('101')
    const c = loopChanges(docOf([l]), docOf([]))
    expect(c[0]).toMatchObject({ kind: 'removed', entityKey: '101', category: 'engineering' })
  })

  it('reports a renumber as a RENAME on the stable id', () => {
    const l = newLoop('101')
    const c = loopChanges(docOf([l]), docOf([{ ...l, number: '201' }]))
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({
      kind: 'renamed', entityId: l.id, field: 'number', before: '101', after: '201', category: 'engineering',
    })
  })

  it('a type change is an ENGINEERING change', () => {
    const l = newLoop('101', { type: 'control' })
    const c = loopChanges(docOf([l]), docOf([{ ...l, type: 'cascade' }]))
    expect(c[0]).toMatchObject({ kind: 'modified', field: 'type', before: 'control', after: 'cascade', category: 'engineering' })
  })

  it('name, description and status are METADATA', () => {
    const l = newLoop('101', { name: 'A', description: 'B', status: 'draft' })
    const after = { ...l, name: 'A2', description: 'B2', status: 'issued' }
    const c = loopChanges(docOf([l]), docOf([after]))
    expect(c).toHaveLength(3)
    for (const ch of c) expect(ch.category).toBe('metadata')
    expect(c.map((x) => x.field).sort()).toEqual(['description', 'name', 'status'])
  })

  it('reordering doc.loops produces nothing at all', () => {
    const a = newLoop('101')
    const b = newLoop('102')
    expect(loopChanges(docOf([a, b]), docOf([b, a]))).toHaveLength(0)
  })

  it('ordering is deterministic and grouped by entity', () => {
    const a = newLoop('101')
    const b = newLoop('102')
    const before = docOf([a, b])
    const after = docOf([{ ...a, number: '201', type: 'control' }, { ...b, name: 'x' }])
    const once = loopChanges(before, after).map((c) => `${c.entityId}:${c.field}`)
    const twice = loopChanges(before, after).map((c) => `${c.entityId}:${c.field}`)
    expect(once).toEqual(twice)
  })
})

/* --------------------------------------------------------------- membership */

describe('membership is reported on the RECORD, once', () => {
  it('joining a loop is a record change showing the loop NUMBER', () => {
    const l = newLoop('101')
    const nodes = [node('n1', { letters: 'LT', loop: '101' })]
    const before = docOf([l], nodes, { 'LT-101': rec('LT-101') })
    const after = docOf([l], nodes, { 'LT-101': rec('LT-101', l.id) })
    const changes = compareDocs(before, after).changes
    const move = changes.filter((c) => c.field === 'loop')
    expect(move).toHaveLength(1)
    expect(move[0]).toMatchObject({
      entityType: 'record', entityKey: 'LT-101', before: undefined, after: '101', category: 'engineering',
    })
    // And NOT duplicated as a second loop-side entity.
    expect(changes.filter((c) => c.entityType === 'loop')).toHaveLength(0)
  })

  it('leaving a loop is reported the same way, in reverse', () => {
    const l = newLoop('101')
    const nodes = [node('n1', { letters: 'LT', loop: '101' })]
    const before = docOf([l], nodes, { 'LT-101': rec('LT-101', l.id) })
    const after = docOf([l], nodes, { 'LT-101': rec('LT-101') })
    const move = compareDocs(before, after).changes.filter((c) => c.field === 'loop')
    expect(move[0]).toMatchObject({ before: '101', after: undefined })
  })

  it('a member left pointing at a deleted loop says so rather than printing a ULID', () => {
    const l = newLoop('101')
    const nodes = [node('n1', { letters: 'LT', loop: '101' })]
    const before = docOf([l], nodes, { 'LT-101': rec('LT-101') })
    const after = docOf([], nodes, { 'LT-101': rec('LT-101', l.id) })
    const move = compareDocs(before, after).changes.find((c) => c.field === 'loop')!
    expect(String(move.after)).toContain('deleted loop')
  })

  it('RENUMBERING A LOOP IS ONE CHANGE, not one per member', () => {
    const l = newLoop('101')
    const nodes = [
      node('n1', { letters: 'LT', loop: '101' }),
      node('n2', { letters: 'LIC', loop: '101' }),
      node('n3', { letters: 'LV', loop: '101' }),
    ]
    const registry = {
      'LT-101': rec('LT-101', l.id), 'LIC-101': rec('LIC-101', l.id), 'LV-101': rec('LV-101', l.id),
    }
    const before = docOf([l], nodes, registry)
    const after = docOf([{ ...l, number: '201' }], nodes, registry)
    const changes = compareDocs(before, after).changes
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entityType: 'loop', kind: 'renamed', field: 'number' })
    expect(changes.filter((c) => c.field === 'loop')).toHaveLength(0)
  })
})

/* -------------------------------------------------------------- tag rename */

describe('a tag rename is not a loop change', () => {
  it('FT-101 -> FT-201 with the same loopId reports no loop change at all', () => {
    const l = newLoop('101')
    const before = docOf([l], [node('n1', { letters: 'FT', loop: '101' })], { 'FT-101': rec('FT-101', l.id) })
    const after = docOf([l], [node('n1', { letters: 'FT', loop: '201' })], { 'FT-201': rec('FT-201', l.id) })
    const changes = compareDocs(before, after).changes

    expect(changes.filter((c) => c.entityType === 'loop')).toHaveLength(0)
    expect(changes.filter((c) => c.field === 'loop')).toHaveLength(0)
    // The rename itself is still reported, on the node, exactly as before.
    expect(changes.filter((c) => c.kind === 'renamed' && c.entityType === 'node')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------- the ledgers */

describe('the coverage ledgers and the provenance guard', () => {
  it('both loop fields are now declared compared', () => {
    expect(DOC_FIELD_COVERAGE.loops).toBe('compared')
    expect(RECORD_FIELD_COVERAGE.loopId).toMatch(/^compared/)
  })

  it('Program 4 capabilities are NOT marked implemented', () => {
    // Nothing in the ledger may claim a CSV or a required-field rule exists.
    expect(JSON.stringify(DOC_FIELD_COVERAGE)).not.toMatch(/general\.loop/)
  })

  it('the standard fingerprint has not moved', () => {
    expect(fingerprintStandard(DEFAULT_STANDARD)).toBe('3c935cd3e3e09cd4')
    expect(Object.keys(DEFAULT_STANDARD.required).sort()).toEqual(['equipment', 'instrument', 'line', 'valve'])
  })

  it('a document with no loops produces no loop changes', () => {
    const a = createEmptyDoc('x')
    const b = { ...createEmptyDoc('x'), sheets: a.sheets }
    expect(compareDocs(a, b).changes.filter((c) => c.entityType === 'loop')).toHaveLength(0)
  })
})
