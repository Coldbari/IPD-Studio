// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { serializeDoc } from '../../src/persist/file'
import { loadDoc } from '../../src/model/migrate'
import { compareDocs } from '../../src/model/diff'
import { renameImpact } from '../../src/model/references'
import { issueRevision, getSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { revisionsOf } from '../../src/model/revision'
import { orphanedBinding } from '../../src/validate/rules/data'
import { buildIndex } from '../../src/model/projectIndex'
import { resetQaCache } from '../../src/validate/engine'
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'

/**
 * The point of P1-A: because signal and alarm values are now REGISTRY data,
 * every P0 mechanism that already understands registry data picks them up with
 * no special handling. These tests exist to prove that is true rather than
 * assumed — and to fail loudly if some future change routes them elsewhere.
 */

const SIGNAL_FIELDS = {
  'signal.type': 'AI', 'signal.units': 'bar', 'signal.systemTag': 'AI_0101',
  'signal.setpoint': '6.5', 'signal.range': '0-10 bar',
  'alarm.LL': '1', 'alarm.L': '2', 'alarm.H': '8', 'alarm.HH': '9', 'alarm.priority': 'high',
}

const doc = () => useStore.getState().doc

function seed(): string {
  useStore.getState().loadIntoStore({
    ...createEmptyDoc('t'),
    hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'Overview', pipes: [],
      widgets: [{ id: 'w1', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'LT-101' }] } as HmiScreen],
  })
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  for (const [k, v] of Object.entries(SIGNAL_FIELDS)) {
    useStore.getState().setRecordField('LT-101', 'instrument', k, v)
  }
  return id
}

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('the new fields are ordinary registry data', () => {
  it('persist and reload through the real .pnid path', () => {
    seed()
    const reopened = loadDoc(JSON.parse(serializeDoc(doc())))
    expect(reopened.registry?.['LT-101']?.fields).toMatchObject(SIGNAL_FIELDS)
  })

  it('survive alongside a record that has none of them', () => {
    seed()
    useStore.getState().setRecordField('P-900', 'equipment', 'general.service', 'Air')
    const reopened = loadDoc(JSON.parse(serializeDoc(doc())))
    expect(reopened.registry?.['P-900']?.fields).toEqual({ 'general.service': 'Air' })
    expect(reopened.registry?.['LT-101']?.fields['alarm.HH']).toBe('9')
  })

  it('reloading twice changes nothing — migration stays idempotent', () => {
    seed()
    const once = loadDoc(JSON.parse(serializeDoc(doc())))
    const twice = loadDoc(JSON.parse(serializeDoc(once)))
    expect(twice.registry).toEqual(once.registry)
  })
})

describe('P0-A / P0-C: a rename carries them', () => {
  it('every signal and alarm field moves with the record', () => {
    const id = seed()
    useStore.getState().setTag(id, { letters: 'LT', loop: '201' })
    expect(doc().registry?.['LT-201']?.fields).toMatchObject(SIGNAL_FIELDS)
    expect(doc().registry?.['LT-101']).toBeUndefined()
  })

  it('the rename preview counts the record once, however many fields it holds', () => {
    seed()
    const impact = renameImpact(doc(), 'LT-101', 'LT-201')
    expect(impact.counts.byWhere.registry).toBe(1)
    expect(impact.collision).toBe(false)
  })
})

describe('P0-B: orphan detection is unaffected', () => {
  it('still reports a binding left by a cleared tag', () => {
    const id = seed()
    useStore.getState().setTag(id, undefined)
    const found = orphanedBinding.run(buildIndex(doc())).filter((f) => f.entityKey === 'LT-101')
    expect(found).toHaveLength(1)
  })
})

describe('P0-D: revisions snapshot them', () => {
  it('an issued revision holds the signal data as it stood', async () => {
    seed()
    const sheetId = doc().sheets[0]!.id
    const rev = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, rev)

    useStore.getState().setRecordField('LT-101', 'instrument', 'alarm.HH', '9.5')

    const snap = (await getSnapshot(revisionsOf(doc().sheets[0]!)[0]!.snapshotId!))!
    expect(snap.registry?.['LT-101']?.fields['alarm.HH']).toBe('9')
    expect(doc().registry?.['LT-101']?.fields['alarm.HH']).toBe('9.5')
  })
})

describe('P0-E: the diff detects them with no special handling', () => {
  const base = createEmptyDoc('t')
  const withFields = (fields: Record<string, string>): ProjectDoc => ({
    ...base,
    registry: { 'LT-101': { key: 'LT-101', kind: 'instrument', fields } },
  })

  it('reports a changed alarm limit, setpoint, system tag and I/O type', () => {
    const before = withFields(SIGNAL_FIELDS)
    const after = withFields({
      ...SIGNAL_FIELDS,
      'alarm.HH': '9.5', 'signal.setpoint': '7', 'signal.systemTag': 'AI_0102', 'signal.type': 'AO',
    })
    const { changes } = compareDocs(before, after)
    const at = (field: string) => changes.find((c) => c.field === field)
    expect(at('alarm.HH')).toMatchObject({ before: '9', after: '9.5', category: 'engineering' })
    expect(at('signal.setpoint')).toMatchObject({ before: '6.5', after: '7' })
    expect(at('signal.systemTag')).toMatchObject({ before: 'AI_0101', after: 'AI_0102' })
    expect(at('signal.type')).toMatchObject({ before: 'AI', after: 'AO' })
  })

  it('counts them as engineering changes, not noise', () => {
    const diff = compareDocs(withFields(SIGNAL_FIELDS), withFields({ ...SIGNAL_FIELDS, 'alarm.H': '7' }))
    expect(diff.engineeringCount).toBe(1)
  })

  it('needs no field registration — the registry diff is generic', () => {
    // A field nobody has heard of is still compared, which is why P1-A needed
    // no change to diff.ts at all.
    const diff = compareDocs(withFields({ 'signal.future': 'a' }), withFields({ 'signal.future': 'b' }))
    expect(diff.changes).toHaveLength(1)
  })
})
