// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P0 AND P1, IN ONE CHAIN.
 *
 * Every phase has its own tests and every phase passes them. That is not the
 * same as the whole thing working: the interesting failures live where a
 * rename (P0-A) meets an alarm limit (P1-A), a unit assignment (P1-D) and a
 * revision snapshot (P0-D) — places no single phase's tests look at.
 *
 * One instrument is built up through every P1 feature, renamed, un-renamed,
 * issued, edited and compared. Anything that fails to follow the tag shows up
 * here as a stale identity.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import { buildIndex } from '../../src/model/projectIndex'
import { deriveIoList } from '../../src/model/ioList'
import { buildTagDefs } from '../../src/hmi/sim/tags'
import { compareDocs, compareRevisions } from '../../src/model/diff'
import { collectHmiBindings } from '../../src/model/references'
import { issueRevision, getSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { revisionsOf } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'
import { orphanedBinding } from '../../src/validate/rules/data'
import { serializeDoc } from '../../src/persist/file'
import { loadDoc } from '../../src/model/migrate'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'

const st = () => useStore.getState()
const doc = () => useStore.getState().doc
const recordOf = (key: string) => doc().registry?.[key]
const ioRow = (key: string) => deriveIoList(buildIndex(doc())).find((r) => r.key === key)
const tagDef = (name: string) => buildTagDefs(doc().hmiScreens, doc().registry).find((d) => d.name === name)

const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget =>
  ({ x: 0, y: 0, w: 64, h: 64, ...w })

let nodeId = ''
let unitId = ''
let areaId = ''
let sheetId = ''

/** The whole P1 stack, applied to one instrument. */
function build() {
  const base = createEmptyDoc('chain')
  const screen: HmiScreen = {
    ...createScreen(1),
    id: 'scr1',
    widgets: [
      widget({ id: 'w1', type: 'display', tag: 'LT-101', label: 'Tank level' }),
      // Everything on this screen reads the one instrument: a faceplate, a
      // trend with a pen, and a lamp on a signal prop — the three shapes a
      // binding takes, so the rename has to carry all three.
      widget({ id: 'w2', type: 'trend', tag: 'LT-101', pens: [{ ref: 'LT-101.PV' }] }),
      widget({ id: 'w3', type: 'lamp', props: { signal: 'LT-101.PV' } }),
    ],
  }
  st().loadIntoStore({ ...base, hmiScreens: [screen] })
  sheetId = doc().sheets[0]!.id

  // 1. an instrument, tagged, wired to a DCS so it is a real I/O point
  nodeId = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  st().setTag(nodeId, { letters: 'LT', loop: '101' })
  const dcs = st().addNode({ symbolId: 'ctl.dcs', kind: 'equipment', x: 120, y: 0, rotation: 0 })
  st().addEdge({ lineClass: 'signal.electric', source: { nodeId, portId: 'e' }, target: { nodeId: dcs, portId: 'w' } })

  // 2. plant hierarchy
  areaId = st().addArea('100', 'Reactor area')
  unitId = st().addUnit(areaId, 'U-101', 'Feed')
  st().assignUnit('LT-101', 'instrument', unitId)

  // 3. engineering signal + alarm data
  for (const [k, v] of [
    ['signal.range', '0-10 bar'], ['signal.units', 'bar'], ['signal.type', 'AI'],
    ['signal.systemTag', 'AI_0101'], ['alarm.L', '2'], ['alarm.H', '8'], ['alarm.priority', 'high'],
  ] as const) {
    st().setRecordField('LT-101', 'instrument', k, v)
  }

  // 4. an accepted QA finding keyed on the tag
  st().ignoreFinding('orphan-record:LT-101', 'Redrawn next revision')
  useStore.temporal.getState().clear()
}

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  build()
})

describe('the whole stack, before anything moves', () => {
  it('every P1 feature sees the same one instrument', () => {
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
    expect(ioRow('LT-101')).toMatchObject({ type: 'AI', typeSource: 'registry', areaCode: '100', unitCode: 'U-101' })
    expect(tagDef('LT-101')).toMatchObject({ unit: 'bar', min: 0, max: 10, priority: 'high' })
    expect(tagDef('LT-101')!.limits).toMatchObject({ L: 2, H: 8 })
    expect(collectHmiBindings(doc()).filter((b) => b.tag === 'LT-101')).toHaveLength(4)
    expect(orphanedBinding.run(buildIndex(doc()))).toHaveLength(0)
  })
})

describe('rename LT-101 → LT-201', () => {
  beforeEach(() => {
    const r = st().setTag(nodeId, { letters: 'LT', loop: '201' })
    expect(r.collision).toBe(false)
  })

  it('the engineering record moves, with its fields', () => {
    expect(recordOf('LT-101')).toBeUndefined()
    expect(recordOf('LT-201')!.fields['alarm.H']).toBe('8')
    expect(recordOf('LT-201')!.fields['signal.systemTag']).toBe('AI_0101')
  })

  it('the unit assignment moves with it', () => {
    expect(recordOf('LT-201')!.unitId).toBe(unitId)
  })

  it('every HMI reference follows — widget tag, trend pen and signal prop', () => {
    const bound = collectHmiBindings(doc()).filter((b) => b.tag === 'LT-201')
    expect(bound).toHaveLength(4)
    expect(collectHmiBindings(doc()).some((b) => b.tag === 'LT-101')).toBe(false)
    // and nothing is left dangling
    expect(orphanedBinding.run(buildIndex(doc()))).toHaveLength(0)
  })

  it('the accepted finding follows, so it is not silently reopened', () => {
    expect(doc().qa?.ignored['orphan-record:LT-201']).toBeTruthy()
    expect(doc().qa?.ignored['orphan-record:LT-101']).toBeUndefined()
  })

  it('the derived I/O row follows, keeping its type, area and unit', () => {
    expect(ioRow('LT-101')).toBeUndefined()
    expect(ioRow('LT-201')).toMatchObject({ type: 'AI', typeSource: 'registry', areaCode: '100', unitCode: 'U-101' })
  })

  it('the simulator reads the record under the new name', () => {
    expect(tagDef('LT-101')).toBeUndefined()
    expect(tagDef('LT-201')).toMatchObject({ unit: 'bar', max: 10, priority: 'high' })
  })

  it('and the whole rename is one undo', () => {
    st().undo()
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
    expect(recordOf('LT-201')).toBeUndefined()
    expect(collectHmiBindings(doc()).filter((b) => b.tag === 'LT-101')).toHaveLength(4)
    expect(doc().qa?.ignored['orphan-record:LT-101']).toBeTruthy()
    expect(ioRow('LT-101')).toMatchObject({ areaCode: '100', unitCode: 'U-101' })
  })
})

describe('issue, edit, compare', () => {
  it('a snapshot holds everything P1 added, and the diff reports what changed after it', async () => {
    const revA = st().addRevision(sheetId, { code: 'A', status: 'IFC', description: 'First issue' })
    await issueRevision(sheetId, revA)
    const snapA = await getSnapshot(revisionsOf(doc().sheets[0]!)[0]!.snapshotId!)
    expect(snapA!.registry!['LT-101']!.fields['alarm.H']).toBe('8')
    expect(snapA!.registry!['LT-101']!.unitId).toBe(unitId)
    expect(snapA!.areas).toHaveLength(1)
    expect(snapA!.units![0]!.code).toBe('U-101')

    // --- engineering moves on --------------------------------------------
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '9')
    st().setRecordField('LT-101', 'instrument', 'signal.units', 'barg')
    const unitB = st().addUnit(areaId, 'U-102')
    st().assignUnit('LT-101', 'instrument', unitB)
    st().updateArea(areaId, { code: '200' })

    const revB = st().addRevision(sheetId, { code: 'B', status: 'IFC', description: 'Alarm revised' })
    await issueRevision(sheetId, revB)

    const rows = revisionsOf(doc().sheets[0]!)
    const snapB = await getSnapshot(rows[1]!.snapshotId!)
    const result = compareRevisions(rows[0]!, rows[1]!, { before: snapA, after: snapB })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const at = (field: string) => result.diff.changes.find((c) => c.field === field)
    expect(at('alarm.H')).toMatchObject({ before: '8', after: '9', category: 'engineering' })
    expect(at('signal.units')).toMatchObject({ before: 'bar', after: 'barg' })
    // the reassignment reads in codes a reviewer recognises, not ids
    expect(at('unit')).toMatchObject({ entityKey: 'LT-101', before: '100/U-101', after: '200/U-102' })
    // and the area rename is reported once, on the area
    expect(result.diff.changes.find((c) => c.entityType === 'area'))
      .toMatchObject({ kind: 'renamed', before: '100', after: '200' })
    expect(result.diff.engineeringCount).toBeGreaterThan(0)
  })

  it('an issued snapshot is immune to what happens next', async () => {
    const revA = st().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, revA)
    const id = revisionsOf(doc().sheets[0]!)[0]!.snapshotId!

    st().setTag(nodeId, { letters: 'LT', loop: '201' })
    st().removeArea(areaId)

    const snap = await getSnapshot(id)
    expect(snap!.registry!['LT-101']!.unitId).toBe(unitId)
    expect(snap!.areas).toHaveLength(1)
  })
})

describe('the file is what travels', () => {
  it('everything P1 added survives a real save and reopen, and still derives', () => {
    const reopened = loadDoc(JSON.parse(serializeDoc(doc())))
    st().loadIntoStore(reopened)
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
    expect(recordOf('LT-101')!.fields['alarm.priority']).toBe('high')
    expect(doc().areas).toHaveLength(1)
    expect(ioRow('LT-101')).toMatchObject({ type: 'AI', areaCode: '100', unitCode: 'U-101' })
    expect(tagDef('LT-101')!.limits).toMatchObject({ L: 2, H: 8 })
    expect(doc().qa?.ignored['orphan-record:LT-101']).toBeTruthy()
  })

  it('a rename after a reopen still carries everything', () => {
    st().loadIntoStore(loadDoc(JSON.parse(serializeDoc(doc()))))
    const again = doc().sheets[0]!.nodes.find((n) => n.tag?.letters === 'LT')!.id
    st().setTag(again, { letters: 'LT', loop: '301' })
    expect(recordOf('LT-301')!.unitId).toBe(unitId)
    expect(collectHmiBindings(doc()).filter((b) => b.tag === 'LT-301')).toHaveLength(4)
  })
})

describe('a colliding rename still refuses, with all of this attached', () => {
  it('nothing moves when the target tag is taken', () => {
    const other = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 300, y: 0, rotation: 0 })
    st().setTag(other, { letters: 'LT', loop: '201' })
    st().setRecordField('LT-201', 'instrument', 'signal.range', '0-1 bar')

    const before = doc()
    const r = st().setTag(nodeId, { letters: 'LT', loop: '201' })
    expect(r.collision).toBe(true)
    expect(doc()).toBe(before)
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
    expect(recordOf('LT-201')!.fields['signal.range']).toBe('0-1 bar')
    expect(compareDocs(before, doc()).changes).toHaveLength(0)
  })
})
