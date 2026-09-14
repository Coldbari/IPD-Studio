// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-1 — the persistent nozzle, and what owning it through the RECORD buys.
 *
 * The architecture decision was that a nozzle is an engineering fact, so it
 * hangs off the tag like every other engineering fact. Most of what follows
 * tests the consequences of that one choice: nozzles outlive the symbol, ride
 * a rename for free, and cannot be acquired by an untagged object at all.
 *
 * The rest is about restraint — nothing is inferred from a line, a port side
 * or a piping class, and a broken port reference is reported rather than
 * quietly remapped to whatever looks similar.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { serializeDoc, deserializeDoc } from '../../src/persist/file'
import { loadDoc, DocError } from '../../src/model/migrate'
import { compareDocs } from '../../src/model/diff'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules } from '../../src/validate/engine'
import { ALL_RULES } from '../../src/validate/rules/index'
import { newNozzle, nozzlesOf, checkNozzles, duplicateNozzleNumbers } from '../../src/model/nozzle'
import type { ProjectDoc } from '../../src/model/types'

const st = () => useStore.getState()
const doc = () => st().doc
const reg = (key: string) => doc().registry?.[key]
const nozzles = (key: string) => nozzlesOf(reg(key))
const numbers = (key: string) => nozzles(key).map((n) => n.number)
const historyDepth = () => useStore.temporal.getState().pastStates.length

/** A tagged vessel, which is what may own nozzles. */
function vessel(tag = { letters: 'TK', loop: '101' }) {
  const id = st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0 })
  st().setTag(id, tag)
  return id
}

beforeEach(() => {
  st().loadIntoStore(createEmptyDoc('nozzles'))
})

/* ------------------------------------------------------------- ownership */

describe('only a tagged object can own a nozzle', () => {
  it('a tagged vessel can', () => {
    vessel()
    const result = st().addNozzle('TK-101', 'equipment', 'N1')
    expect(result.ok).toBe(true)
    expect(result.id).toBeTruthy()
    expect(numbers('TK-101')).toEqual(['N1'])
  })

  it('an UNTAGGED vessel cannot, and is told why', () => {
    st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    const result = st().addNozzle('', 'equipment', 'N1')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('no tag yet')
    // Nothing was invented to hold it.
    expect(doc().registry).toBeUndefined()
  })

  it('refusing records no undo step and touches nothing', () => {
    st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    const before = JSON.stringify(doc())
    const depth = historyDepth()
    st().addNozzle('', 'equipment', 'N1')
    expect(JSON.stringify(doc())).toBe(before)
    expect(historyDepth()).toBe(depth)
  })

  it('carries no equipment reference — the record IS the owner', () => {
    vessel()
    st().addNozzle('TK-101', 'equipment', 'N1')
    const nozzle = nozzles('TK-101')[0]!
    expect(Object.keys(nozzle).sort()).toEqual(['id', 'number'])
    expect(JSON.stringify(nozzle)).not.toContain('TK-101')
  })

  it('never becomes a ProjectDoc collection or a new EntityKind', () => {
    vessel()
    st().addNozzle('TK-101', 'equipment', 'N1')
    expect((doc() as unknown as Record<string, unknown>).nozzles).toBeUndefined()
    expect(reg('TK-101')!.kind).toBe('equipment')
  })
})

/* ------------------------------------------------------------------ CRUD */

describe('add, update and remove', () => {
  beforeEach(() => { vessel() })

  it('mints a stable ULID that is not the number', () => {
    const a = st().addNozzle('TK-101', 'equipment', 'N1')
    const b = st().addNozzle('TK-101', 'equipment', 'N2')
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toBe('N1')
    expect(a.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('keeps the id when the number changes', () => {
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1')
    st().updateNozzle('TK-101', id!, { number: 'N9' })
    expect(nozzles('TK-101')[0]!.id).toBe(id)
    expect(numbers('TK-101')).toEqual(['N9'])
  })

  it('keeps insertion order, which is deterministic', () => {
    for (const n of ['N3', 'N1', 'N2']) st().addNozzle('TK-101', 'equipment', n)
    expect(numbers('TK-101')).toEqual(['N3', 'N1', 'N2'])
    expect(nozzles('TK-101')).toEqual(nozzles('TK-101'))
  })

  it('updates only the fields named, leaving the rest alone', () => {
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"', rating: '150#', service: 'Feed' })
    st().updateNozzle('TK-101', id!, { size: '8"' })
    expect(nozzles('TK-101')[0]).toMatchObject({ number: 'N1', size: '8"', rating: '150#', service: 'Feed' })
  })

  it('clears a field with an empty string rather than storing a blank', () => {
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"' })
    st().updateNozzle('TK-101', id!, { size: '' })
    expect('size' in nozzles('TK-101')[0]!).toBe(false)
  })

  it('removes one nozzle and leaves the others untouched', () => {
    const a = st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"' })
    const b = st().addNozzle('TK-101', 'equipment', 'N2', { size: '8"' })
    st().addNozzle('TK-101', 'equipment', 'N3')
    st().removeNozzle('TK-101', b.id!)
    expect(numbers('TK-101')).toEqual(['N1', 'N3'])
    expect(nozzles('TK-101')[0]).toMatchObject({ id: a.id, size: '6"' })
  })

  it('leaves no empty array behind when the last one goes', () => {
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1')
    st().removeNozzle('TK-101', id!)
    expect('nozzles' in reg('TK-101')!).toBe(false)
  })

  it('refuses an unknown nozzle id', () => {
    expect(st().updateNozzle('TK-101', 'ghost', { size: '6"' }).ok).toBe(false)
    expect(st().removeNozzle('TK-101', 'ghost').ok).toBe(false)
  })

  it('touches no unrelated record field', () => {
    st().setRecordField('TK-101', 'equipment', 'general.service', 'Feed drum')
    st().setRecordStatus('TK-101', 'approved')
    st().assignUnit('TK-101', 'equipment', undefined)
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1')
    st().updateNozzle('TK-101', id!, { size: '6"' })
    st().removeNozzle('TK-101', id!)
    expect(reg('TK-101')).toMatchObject({
      key: 'TK-101', kind: 'equipment', status: 'approved',
      fields: { 'general.service': 'Feed drum' },
    })
  })
})

/* ------------------------------------------------------------- numbering */

describe('a number is a display identity, not an identity', () => {
  beforeEach(() => { vessel() })

  it('refuses a blank number', () => {
    expect(st().addNozzle('TK-101', 'equipment', '   ').ok).toBe(false)
    expect(nozzles('TK-101')).toHaveLength(0)
  })

  it('refuses a duplicate within the same equipment, case-insensitively', () => {
    st().addNozzle('TK-101', 'equipment', 'N1')
    expect(st().addNozzle('TK-101', 'equipment', 'n1').ok).toBe(false)
    expect(st().addNozzle('TK-101', 'equipment', ' N1 ').ok).toBe(false)
    expect(numbers('TK-101')).toEqual(['N1'])
  })

  it('refuses a renumber onto a number already on that record', () => {
    st().addNozzle('TK-101', 'equipment', 'N1')
    const b = st().addNozzle('TK-101', 'equipment', 'N2')
    expect(st().updateNozzle('TK-101', b.id!, { number: 'N1' }).ok).toBe(false)
    expect(numbers('TK-101')).toEqual(['N1', 'N2'])
  })

  it('allows setting a nozzle’s own number back to itself', () => {
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1')
    expect(st().updateNozzle('TK-101', id!, { number: 'N1' }).ok).toBe(true)
  })

  it('scopes uniqueness to the equipment — N1 on two vessels is fine', () => {
    const second = st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 99, y: 0, rotation: 0 })
    st().setTag(second, { letters: 'TK', loop: '102' })
    expect(st().addNozzle('TK-101', 'equipment', 'N1').ok).toBe(true)
    expect(st().addNozzle('TK-102', 'equipment', 'N1').ok).toBe(true)
  })
})

/* ------------------------------------------------------------------ undo */

describe('every operation is one undo step', () => {
  beforeEach(() => { vessel() })

  it('undoes an add, an update and a remove', () => {
    const depth = historyDepth()
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"' })
    expect(historyDepth()).toBe(depth + 1)
    st().updateNozzle('TK-101', id!, { size: '8"' })
    st().removeNozzle('TK-101', id!)
    expect(nozzles('TK-101')).toHaveLength(0)

    st().undo()
    expect(nozzles('TK-101')[0]).toMatchObject({ size: '8"' })
    st().undo()
    expect(nozzles('TK-101')[0]).toMatchObject({ size: '6"' })
    st().undo()
    expect(nozzles('TK-101')).toHaveLength(0)
  })

  it('records nothing when an update changes nothing', () => {
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"' })
    const depth = historyDepth()
    st().updateNozzle('TK-101', id!, { size: '6"' })
    expect(historyDepth()).toBe(depth)
  })
})

/* ------------------------------------------------------------ port links */

describe('a port reference is a drawing link, never the identity', () => {
  it('a nozzle needs no port at all', () => {
    vessel()
    st().addNozzle('TK-101', 'equipment', 'N1')
    expect(nozzles('TK-101')[0]!.portId).toBeUndefined()
    expect(runRules(buildIndex(doc())).groups.find((g) => g.rule.id === 'nozzle-port-missing')?.findings ?? [])
      .toHaveLength(0)
  })

  it('accepts a port the drawn symbol actually has', () => {
    const id = vessel()
    const ports = buildIndex(doc()).nodes.get(id)!.ports.map((p) => p.id)
    expect(ports.length).toBeGreaterThan(1)
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: ports[0] })
    expect(runRules(buildIndex(doc())).groups.find((g) => g.rule.id === 'nozzle-port-missing')?.findings ?? [])
      .toHaveLength(0)
  })

  it('reports a dangling port rather than remapping it', () => {
    vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: 'not-a-port' })
    const found = runRules(buildIndex(doc())).groups.find((g) => g.rule.id === 'nozzle-port-missing')!.findings
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('not-a-port')
    // Untouched. Nothing was reassigned to a port that merely looks similar.
    expect(nozzles('TK-101')[0]!.portId).toBe('not-a-port')
  })

  it('reports two nozzles claiming one port', () => {
    const id = vessel()
    const port = buildIndex(doc()).nodes.get(id)!.ports[0]!.id
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: port })
    st().addNozzle('TK-101', 'equipment', 'N2', { portId: port })
    const found = runRules(buildIndex(doc())).groups.find((g) => g.rule.id === 'nozzle-duplicate-port')!.findings
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('N1, N2')
  })

  it('accepts a user-added extra port', () => {
    const id = vessel()
    st().addExtraPort(id, { x: 4, y: 4, kind: 'process' })
    const pin = doc().sheets[0]!.nodes[0]!.extraPorts![0]!.id
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: pin })
    expect(runRules(buildIndex(doc())).groups.find((g) => g.rule.id === 'nozzle-port-missing')?.findings ?? [])
      .toHaveLength(0)
  })

  it('does NOT silently remap when the equipment is redrawn as a different symbol', () => {
    // There is no swap-symbol action, so this is delete-and-redraw. The port
    // id is not remapped to whatever the new symbol happens to call its ports.
    const id = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: 'n3' })
    st().deleteIds([id])
    const again = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    st().setTag(again, { letters: 'TK', loop: '101' })
    expect(nozzles('TK-101')[0]!.portId).toBe('n3')
    const found = runRules(buildIndex(doc())).groups.find((g) => g.rule.id === 'nozzle-port-missing')!.findings
    expect(found).toHaveLength(1)
  })
})

/* ------------------------------------------------ the lifecycle it exists for */

describe('a nozzle outlives the symbol', () => {
  it('survives deleting the drawn node', () => {
    const id = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"' })
    st().deleteIds([id])
    expect(doc().sheets[0]!.nodes).toHaveLength(0)
    expect(nozzles('TK-101')[0]).toMatchObject({ number: 'N1', size: '6"' })
  })

  it('is available again when the SAME tag is redrawn', () => {
    const id = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"' })
    st().deleteIds([id])
    const again = st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 9, y: 9, rotation: 0 })
    st().setTag(again, { letters: 'TK', loop: '101' })
    expect(nozzles('TK-101')[0]).toMatchObject({ number: 'N1', size: '6"' })
  })

  it('does NOT transfer to a different tag', () => {
    const id = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1')
    st().deleteIds([id])
    const again = st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 9, y: 9, rotation: 0 })
    st().setTag(again, { letters: 'TK', loop: '999' })
    expect(nozzles('TK-999')).toHaveLength(0)
    // The old schedule is still there, and orphaned — which QA already says.
    expect(nozzles('TK-101')).toHaveLength(1)
    const orphans = runRules(buildIndex(doc())).groups.find((g) => g.rule.id === 'orphan-record')!.findings
    expect(orphans.some((f) => f.entityKey === 'TK-101')).toBe(true)
  })

  it('rides a RENAME with no migration of its own', () => {
    const id = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"', service: 'Feed' })
    st().addNozzle('TK-101', 'equipment', 'N2')
    const ids = nozzles('TK-101').map((n) => n.id)

    st().setTag(id, { letters: 'TK', loop: '201' })

    expect(reg('TK-101')).toBeUndefined()
    expect(numbers('TK-201')).toEqual(['N1', 'N2'])
    // The same nozzles, not copies: the ids came across untouched.
    expect(nozzles('TK-201').map((n) => n.id)).toEqual(ids)
    expect(nozzles('TK-201')[0]).toMatchObject({ size: '6"', service: 'Feed' })
  })

  it('is discarded with the record when the record is purged', () => {
    vessel()
    st().addNozzle('TK-101', 'equipment', 'N1')
    st().purgeRecord('TK-101')
    expect(reg('TK-101')).toBeUndefined()
  })
})

/* ----------------------------------------------------------------- QA */

describe('QA reports what the document says about itself, and nothing more', () => {
  it('reports a duplicate number that arrived from a file', () => {
    // The store refuses one; a hand-edited or imported document can still
    // carry it, which is what the rule is for.
    const base = createEmptyDoc('dup')
    const loaded: ProjectDoc = {
      ...base,
      registry: {
        'TK-101': {
          key: 'TK-101', kind: 'equipment', fields: {},
          nozzles: [newNozzle('N1'), newNozzle('N1')],
        },
      },
    }
    const found = runRules(buildIndex(loaded)).groups.find((g) => g.rule.id === 'nozzle-duplicate-number')!.findings
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('2 nozzles numbered N1')
    expect(duplicateNozzleNumbers(loaded.registry!['TK-101'])).toHaveLength(1)
  })

  it('keeps the severities it was given', () => {
    // Read off ALL_RULES, not off a report: `runRules` emits a group only for
    // a rule that found something, and on a clean document none of these did.
    const severity = (id: string) => ALL_RULES.find((r) => r.id === id)!.severity
    expect(severity('nozzle-duplicate-number')).toBe('critical')
    expect(severity('nozzle-duplicate-port')).toBe('warning')
    expect(severity('nozzle-port-missing')).toBe('warning')
    // And a clean document reports none of them.
    const report = runRules(buildIndex(createEmptyDoc('t')))
    expect(report.groups.filter((g) => g.rule.id.startsWith('nozzle-'))).toEqual([])
  })

  it('says nothing about an orphaned record’s nozzles — orphan-record already did', () => {
    const id = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: 'n1' })
    st().deleteIds([id])
    const report = runRules(buildIndex(doc()))
    for (const rule of ['nozzle-port-missing', 'nozzle-duplicate-port', 'nozzle-duplicate-number']) {
      expect(report.groups.find((g) => g.rule.id === rule)?.findings ?? [], rule).toHaveLength(0)
    }
    expect(report.groups.find((g) => g.rule.id === 'orphan-record')!.findings).toHaveLength(1)
  })

  it('infers NOTHING from the drawing', () => {
    // A vessel with a numbered line into a port, and a nozzle on that port.
    const id = vessel()
    const port = buildIndex(doc()).nodes.get(id)!.ports[0]!.id
    st().addEdge({
      lineClass: 'process.major',
      source: { nodeId: id, portId: port },
      target: { x: 99, y: 0 },
      lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '001' },
    })
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: port })
    const nozzle = nozzles('TK-101')[0]!
    // Not the line's size, not its service, not the port's side or kind.
    expect(nozzle.size).toBeUndefined()
    expect(nozzle.service).toBeUndefined()
    expect(nozzle.rating).toBeUndefined()
    expect(nozzle.facing).toBeUndefined()
  })
})

/* ------------------------------------------------------------ revisions */

describe('the revision diff sees nozzle changes', () => {
  const withNozzles = (list: ReturnType<typeof newNozzle>[]): ProjectDoc => ({
    ...createEmptyDoc('rev'),
    registry: { 'TK-101': { key: 'TK-101', kind: 'equipment', fields: {}, ...(list.length ? { nozzles: list } : {}) } },
  })

  it('reports an addition', () => {
    const n = newNozzle('N1', { size: '6"' })
    const change = compareDocs(withNozzles([]), withNozzles([n])).changes.find((c) => c.field?.startsWith('nozzle'))
    expect(change).toMatchObject({ entityType: 'record', entityKey: 'TK-101', field: 'nozzle N1', before: undefined })
    expect(change!.after).toContain('6"')
  })

  it('reports a removal', () => {
    const n = newNozzle('N1')
    const change = compareDocs(withNozzles([n]), withNozzles([])).changes.find((c) => c.field?.startsWith('nozzle'))
    expect(change).toMatchObject({ field: 'nozzle N1', after: undefined })
  })

  it('reports a field edit, named by the field', () => {
    const n = newNozzle('N1', { size: '6"' })
    const change = compareDocs(withNozzles([n]), withNozzles([{ ...n, size: '8"' }])).changes
      .find((c) => c.field === 'nozzle N1 size')
    expect(change).toMatchObject({ before: '6"', after: '8"', category: 'engineering' })
  })

  it('reports a renumber as ONE change, not a removal and an addition', () => {
    const n = newNozzle('N1')
    const changes = compareDocs(withNozzles([n]), withNozzles([{ ...n, number: 'N9' }])).changes
      .filter((c) => c.field?.startsWith('nozzle'))
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ field: 'nozzle N9 number', before: 'N1', after: 'N9' })
  })

  it('reports NOTHING when the schedule is merely reordered', () => {
    const a = newNozzle('N1')
    const b = newNozzle('N2')
    expect(compareDocs(withNozzles([a, b]), withNozzles([b, a])).changes.filter((c) => c.field?.startsWith('nozzle')))
      .toEqual([])
  })

  it('is deterministic', () => {
    const a = newNozzle('N1', { size: '6"' })
    const b = newNozzle('N2')
    const before = withNozzles([a, b])
    const after = withNozzles([{ ...a, size: '8"' }, { ...b, service: 'Vent' }])
    expect(compareDocs(before, after).changes).toEqual(compareDocs(before, after).changes)
  })
})

/* ---------------------------------------------------------- persistence */

describe('persistence', () => {
  it('round-trips through serialize and deserialize', () => {
    vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { size: '6"', rating: '150#', facing: 'RF', service: 'Feed', notes: 'top' })
    st().addNozzle('TK-101', 'equipment', 'N2', { portId: 'n2' })
    const back = deserializeDoc(serializeDoc(doc()))
    expect(back.registry!['TK-101']!.nozzles).toEqual(reg('TK-101')!.nozzles)
  })

  it('loads a document that has no nozzles field at all', () => {
    const old = { ...createEmptyDoc('old'), registry: { 'TK-101': { key: 'TK-101', kind: 'equipment' as const, fields: {} } } }
    const back = loadDoc(JSON.parse(JSON.stringify(old)))
    expect(back.registry!['TK-101']!.nozzles).toBeUndefined()
    expect(back.schemaVersion).toBe(6)
  })

  it('keeps schemaVersion at 6', () => {
    vessel()
    st().addNozzle('TK-101', 'equipment', 'N1')
    expect(deserializeDoc(serializeDoc(doc())).schemaVersion).toBe(6)
  })

  it('refuses a malformed SHAPE but loads a broken REFERENCE', () => {
    const bad = (nozzles: unknown) => ({
      ...createEmptyDoc('bad'),
      registry: { 'TK-101': { key: 'TK-101', kind: 'equipment', fields: {}, nozzles } },
    })
    expect(() => loadDoc(bad('not an array'))).toThrow(DocError)
    expect(() => loadDoc(bad([{ number: 'N1' }]))).toThrow(DocError)
    expect(() => loadDoc(bad([{ id: 'a', number: 'N1' }, { id: 'a', number: 'N2' }]))).toThrow(DocError)
    // A port that names nothing is a broken reference: it LOADS, and QA says so.
    expect(() => loadDoc(bad([{ id: 'a', number: 'N1', portId: 'gone' }]))).not.toThrow()
  })

  it('checkNozzles passes a registry with none', () => {
    expect(checkNozzles(undefined)).toBeNull()
    expect(checkNozzles({ 'TK-101': {} })).toBeNull()
  })
})
