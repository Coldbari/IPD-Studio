// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { buildHierarchy, planLegacyMapping, LEGACY_AREA_FIELD } from '../../src/model/hierarchy'

const doc = () => useStore.getState().doc
const st = () => useStore.getState()
const recordOf = (key: string) => doc().registry?.[key]

/** A tagged instrument, so there is something with an engineering record. */
function seed() {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  st().setTag(id, { letters: 'LT', loop: '101' })
  st().setRecordField('LT-101', 'instrument', 'general.service', 'Cooling water')
  return id
}

beforeEach(() => {
  seed()
  useStore.temporal.getState().clear()
})

describe('creating the hierarchy', () => {
  it('13/14: creates an area, then a unit under it', () => {
    const areaId = st().addArea('100', 'Reactor area')
    const unitId = st().addUnit(areaId, 'U-101', 'Feed')
    expect(doc().areas).toHaveLength(1)
    expect(doc().units![0]!.areaId).toBe(areaId)
    expect(buildHierarchy(doc()).unitsByArea.get(areaId)).toHaveLength(1)
    expect(unitId).not.toBe(areaId)
  })

  it('marks the document dirty and is undoable', () => {
    st().addArea('100')
    expect(doc().areas).toHaveLength(1)
    st().undo()
    expect(doc().areas ?? []).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ 6, 7 */

describe('assigning an object', () => {
  it('6: assigns a record to a unit', () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
  })

  it('6: assigns an object that had no record yet, creating one', () => {
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    st().assignUnit('PT-102', 'instrument', unitId)
    expect(recordOf('PT-102')!.unitId).toBe(unitId)
    expect(recordOf('PT-102')!.kind).toBe('instrument')
  })

  it('clears with undefined', () => {
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    st().assignUnit('LT-101', 'instrument', undefined)
    expect(recordOf('LT-101')!.unitId).toBeUndefined()
  })

  it('7: the assignment survives renaming the unit code AND the area code', () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    st().updateUnit(unitId, { code: 'U-102', name: 'Renamed' })
    st().updateArea(areaId, { code: '200' })
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
    const h = buildHierarchy(doc())
    expect(h.unitById.get(unitId)!.code).toBe('U-102')
    expect(h.areaById.get(h.unitById.get(unitId)!.areaId)!.code).toBe('200')
  })

  it('7: the assignment survives renaming the TAG, through the existing record move', () => {
    const nodeId = doc().sheets[0]!.nodes[0]!.id
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    st().setTag(nodeId, { letters: 'LT', loop: '201' })
    expect(recordOf('LT-101')).toBeUndefined()
    expect(recordOf('LT-201')!.unitId).toBe(unitId)
  })
})

/* ---------------------------------------------------------------- deletes */

describe('deleting', () => {
  it('deleting a unit unassigns what pointed at it, and says how many', () => {
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    expect(st().removeUnit(unitId)).toEqual({ cleared: 1 })
    expect(recordOf('LT-101')!.unitId).toBeUndefined()
    // the record itself is untouched — only the assignment went
    expect(recordOf('LT-101')!.fields['general.service']).toBe('Cooling water')
  })

  it('deleting an area takes its units and their assignments with it', () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().addUnit(areaId, 'U-102')
    st().assignUnit('LT-101', 'instrument', unitId)
    expect(st().removeArea(areaId)).toEqual({ units: 2, cleared: 1 })
    expect(doc().units).toHaveLength(0)
    expect(recordOf('LT-101')!.unitId).toBeUndefined()
  })

  it('a cascading delete is ONE undo step', () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    st().removeArea(areaId)
    st().undo()
    expect(doc().areas).toHaveLength(1)
    expect(doc().units).toHaveLength(1)
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
  })

  it('leaves other areas alone', () => {
    const a1 = st().addArea('100')
    const a2 = st().addArea('200')
    st().addUnit(a2, 'U-201')
    st().removeArea(a1)
    expect(doc().areas!.map((a) => a.id)).toEqual([a2])
    expect(doc().units).toHaveLength(1)
  })
})

/* --------------------------------------------------------- legacy mapping */

describe('applying a legacy mapping', () => {
  function withLegacy() {
    st().setRecordField('LT-101', 'instrument', LEGACY_AREA_FIELD, 'U-101')
    const areaId = st().addArea('100')
    return st().addUnit(areaId, 'U-101')
  }

  it('33: applies only the rows the plan marked mapped', () => {
    const unitId = withLegacy()
    st().setRecordField('PT-102', 'instrument', LEGACY_AREA_FIELD, 'Somewhere else')
    const plan = planLegacyMapping(doc())
    expect(st().applyLegacyMapping(plan.rows)).toBe(1)
    expect(recordOf('LT-101')!.unitId).toBe(unitId)
    expect(recordOf('PT-102')!.unitId).toBeUndefined()
  })

  it('34/32: the free text is preserved, mapped or not', () => {
    withLegacy()
    st().applyLegacyMapping(planLegacyMapping(doc()).rows)
    expect(recordOf('LT-101')!.fields[LEGACY_AREA_FIELD]).toBe('U-101')
  })

  it('35: re-running it changes nothing', () => {
    withLegacy()
    st().applyLegacyMapping(planLegacyMapping(doc()).rows)
    const after = doc()
    expect(st().applyLegacyMapping(planLegacyMapping(after).rows)).toBe(0)
    expect(doc()).toBe(after)
  })

  it('35: never overrides an assignment made in the meantime', () => {
    withLegacy()
    const other = st().addUnit(doc().areas![0]!.id, 'U-999')
    const plan = planLegacyMapping(doc())
    st().assignUnit('LT-101', 'instrument', other)
    st().applyLegacyMapping(plan.rows)
    expect(recordOf('LT-101')!.unitId).toBe(other)
  })

  it('lands as one undo step', () => {
    withLegacy()
    st().applyLegacyMapping(planLegacyMapping(doc()).rows)
    st().undo()
    expect(recordOf('LT-101')!.unitId).toBeUndefined()
  })
})
