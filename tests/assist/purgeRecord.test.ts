// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-3 — what "Discard the record" says it will destroy.
 *
 * The blast radius counted `fields` and nothing else, which was true when
 * `fields` was all a record held. A record now also holds a nozzle schedule, a
 * unit assignment and a loop assignment — so a vessel with eight nozzles and no
 * filled fields told the user "Deletes 0 stored field(s)" at the moment they
 * confirmed deleting all eight.
 *
 * A destructive action that understates itself is worse than one with no
 * description, because the description is believed. These cases pin what it
 * says; the last two pin that the ACTION itself did not change.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { applyFix, describeFix } from '../../src/assist/fixes'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { newArea, newUnit } from '../../src/model/hierarchy'
import { newNozzle } from '../../src/model/nozzle'
import type { EngineeringRecord } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

const KEY = 'V-101'

const docWith = (record: Partial<EngineeringRecord>, over: Partial<ProjectDoc> = {}): ProjectDoc => ({
  ...createEmptyDoc('purge'),
  registry: { [KEY]: { key: KEY, kind: 'equipment', fields: {}, ...record } },
  ...over,
})

const radius = (doc: ProjectDoc) => describeFix({ kind: 'purge-record', key: KEY }, doc).blastRadius

const nozzles = (n: number) => Array.from({ length: n }, (_, i) => newNozzle(`N${i + 1}`))

/* ------------------------------------------------------------- case A */

describe('a record whose whole content is its nozzles', () => {
  const doc = docWith({ nozzles: nozzles(8) })

  it('says eight nozzles will be deleted', () => {
    expect(radius(doc)).toContain('8 nozzles')
  })

  it('never claims zero fields', () => {
    // The exact sentence the defect produced.
    expect(radius(doc)).not.toContain('0 stored field')
    expect(radius(doc)).not.toContain('field')
  })

  it('still says nothing on a sheet carries the key', () => {
    expect(radius(doc)).toContain('Nothing on any sheet carries this key')
  })

  it('counts one nozzle in the singular', () => {
    expect(radius(docWith({ nozzles: nozzles(1) }))).toContain('1 nozzle')
    expect(radius(docWith({ nozzles: nozzles(1) }))).not.toContain('1 nozzles')
  })
})

/* ------------------------------------------------------------- case B */

describe('a record holding all four kinds of engineering data', () => {
  const area = newArea('A-10')
  const unit = newUnit(area.id, 'U-101')
  const doc = docWith(
    {
      fields: { 'general.service': 'Feed', 'construction.material': 'CS', 'duty.capacity': '50 m³' },
      nozzles: nozzles(2),
      unitId: unit.id,
      loopId: 'loop-1',
    },
    { areas: [area], units: [unit], loops: [{ id: 'loop-1', number: 'L-101' }] },
  )

  it('names all four', () => {
    const text = radius(doc)
    expect(text).toContain('3 stored fields')
    expect(text).toContain('2 nozzles')
    expect(text).toContain('unit assignment')
    expect(text).toContain('loop assignment')
  })

  it('reads as one sentence rather than a list of clauses', () => {
    expect(radius(doc)).toContain('and its loop assignment.')
  })

  it('drops the unit clause when nothing is assigned', () => {
    const text = radius(docWith({ fields: { 'general.service': 'Feed' }, nozzles: nozzles(2) }))
    expect(text).not.toContain('unit assignment')
    expect(text).not.toContain('loop assignment')
    expect(text).toContain('1 stored field and 2 nozzles')
  })
})

/* ------------------------------------------------------------- case C */

describe('a minimal record', () => {
  it('says it holds nothing, rather than listing four absences', () => {
    const text = radius(docWith({}))
    expect(text).toContain('holds no engineering data')
    expect(text).not.toContain('0')
  })

  it('does not count a field that was only ever touched', () => {
    // The status dropdown mints a record with one empty-string key. Reporting
    // that as a stored field is the same noise in the other direction.
    const text = radius(docWith({ fields: { __touch: '' } }))
    expect(text).toContain('holds no engineering data')
  })

  it('says so plainly when the record is already gone', () => {
    expect(radius(createEmptyDoc('none'))).toContain('already gone')
  })
})

/* ------------------------------- the ACTION is unchanged, and undoable */

describe('the destructive operation itself', () => {
  it('still deletes the record, nozzles and all', () => {
    const st = useStore.getState()
    st.loadIntoStore(docWith({ nozzles: nozzles(3) }))
    expect(applyFix({ kind: 'purge-record', key: KEY })).toEqual({ ok: true, changedIds: [] })
    expect(useStore.getState().doc.registry?.[KEY]).toBeUndefined()
  })

  it('is undoable, so the schedule comes back intact', () => {
    const st = useStore.getState()
    st.loadIntoStore(docWith({ nozzles: nozzles(3) }))
    const before = useStore.getState().doc.registry![KEY]!.nozzles
    applyFix({ kind: 'purge-record', key: KEY })
    useStore.getState().undo()
    expect(useStore.getState().doc.registry?.[KEY]?.nozzles).toEqual(before)
  })

  it('refuses a key with no record, and says so', () => {
    useStore.getState().loadIntoStore(createEmptyDoc('none'))
    expect(applyFix({ kind: 'purge-record', key: KEY }).ok).toBe(false)
  })
})
