// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import {
  duplicateAreaCode, duplicateUnitCode, legacyAreaUnmapped, recordOrphanUnit, unitOrphanArea,
} from '../../src/validate/rules/hierarchy'
import { requiredFieldEmpty } from '../../src/validate/rules/data'
import { ALL_RULES } from '../../src/validate/rules/index'
import { LEGACY_AREA_FIELD, UNIT_FIELD, newArea, newUnit } from '../../src/model/hierarchy'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import type { Area, Unit } from '../../src/model/hierarchy'
import type { EngineeringRecord } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

const rec = (key: string, over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, ...over })

function docOf(over: Partial<ProjectDoc> & { areas?: Area[]; units?: Unit[] } = {}): ProjectDoc {
  return { ...createEmptyDoc('t'), ...over }
}
const run = (rule: { run: (ix: ReturnType<typeof buildIndex>) => unknown[] }, doc: ProjectDoc) =>
  rule.run(buildIndex(doc)) as { message: string; key: string }[]

const area = newArea('100')
const unit = newUnit(area.id, 'U-101')

describe('registration', () => {
  it('every hierarchy rule is in the engine', () => {
    for (const id of ['unit-orphan-area', 'record-orphan-unit', 'duplicate-area-code', 'duplicate-unit-code', 'legacy-area-unmapped']) {
      expect(ALL_RULES.some((r) => r.id === id), id).toBe(true)
    }
  })
})

/* --------------------------------------------------------------- 11 */

describe('a unit whose area is missing', () => {
  it('is reported', () => {
    const out = run(unitOrphanArea, docOf({ areas: [], units: [unit] }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('U-101')
  })

  it('is silent when the area is there', () => {
    expect(run(unitOrphanArea, docOf({ areas: [area], units: [unit] }))).toHaveLength(0)
  })

  it('keys on the unit id, so a code rename does not lose an acceptance', () => {
    const a = run(unitOrphanArea, docOf({ units: [unit] }))[0]!
    const b = run(unitOrphanArea, docOf({ units: [{ ...unit, code: 'U-999' }] }))[0]!
    expect(a.key).toBe(b.key)
  })
})

/* --------------------------------------------------------------- 12 */

describe('an object assigned to a missing unit', () => {
  it('is reported', () => {
    const doc = docOf({ areas: [area], units: [], registry: { 'FT-101': rec('FT-101', { unitId: unit.id }) } })
    const out = run(recordOrphanUnit, doc)
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('FT-101')
  })

  it('is silent for an unassigned record and for a valid one', () => {
    const doc = docOf({
      areas: [area], units: [unit],
      registry: { 'FT-101': rec('FT-101'), 'PT-102': rec('PT-102', { unitId: unit.id }) },
    })
    expect(run(recordOrphanUnit, doc)).toHaveLength(0)
  })
})

/* --------------------------------------------------------------- 9, 10 */

describe('duplicate codes', () => {
  it('9: two areas with one code', () => {
    const out = run(duplicateAreaCode, docOf({ areas: [newArea('100'), newArea('100'), newArea('200')] }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('2 areas')
  })

  it('9: ignores case and padding, because a reader cannot tell them apart either', () => {
    expect(run(duplicateAreaCode, docOf({ areas: [newArea('100'), newArea(' 100 ')] }))).toHaveLength(1)
  })

  it('10: two units with one code INSIDE one area', () => {
    const out = run(duplicateUnitCode, docOf({
      areas: [area], units: [newUnit(area.id, 'U-101'), newUnit(area.id, 'U-101')],
    }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('Area 100')
  })

  it('10: the same code in two DIFFERENT areas is legitimate', () => {
    const a2 = newArea('200')
    expect(run(duplicateUnitCode, docOf({
      areas: [area, a2], units: [newUnit(area.id, 'U-101'), newUnit(a2.id, 'U-101')],
    }))).toHaveLength(0)
  })

  it('says nothing about a hierarchy that does not exist', () => {
    expect(run(duplicateAreaCode, docOf())).toHaveLength(0)
    expect(run(duplicateUnitCode, docOf())).toHaveLength(0)
  })
})

/* ------------------------------------------------------ legacy visibility */

describe('unmapped legacy free text', () => {
  const withLegacy = (over: Partial<ProjectDoc> = {}) => docOf({
    registry: { 'FT-101': rec('FT-101', { fields: { [LEGACY_AREA_FIELD]: 'Reactor' } }) },
    ...over,
  })

  it('stays silent on a project that has not adopted the hierarchy', () => {
    // Every pre-P1-D document is this. A rule that fired on all of them would
    // be switched off, and then it would report nothing ever again.
    expect(run(legacyAreaUnmapped, withLegacy())).toHaveLength(0)
  })

  it('surfaces it once an area exists to map to', () => {
    const out = run(legacyAreaUnmapped, withLegacy({ areas: [area], units: [unit] }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('Reactor')
  })

  it('goes quiet once the object is assigned — and the text is still there', () => {
    const doc = withLegacy({
      areas: [area], units: [unit],
      registry: { 'FT-101': rec('FT-101', { unitId: unit.id, fields: { [LEGACY_AREA_FIELD]: 'Reactor' } }) },
    })
    expect(run(legacyAreaUnmapped, doc)).toHaveLength(0)
    expect(doc.registry!['FT-101']!.fields[LEGACY_AREA_FIELD]).toBe('Reactor')
  })
})

/* ------------------------------------------- the standard, not a new one */

describe('a standard that requires a unit', () => {
  const std = { ...DEFAULT_STANDARD, required: { ...DEFAULT_STANDARD.required, instrument: [UNIT_FIELD] } }
  const drawn = (over: Partial<EngineeringRecord>): ProjectDoc => {
    const d = createEmptyDoc('t')
    return {
      ...d,
      standard: std,
      areas: [area],
      units: [unit],
      sheets: [{ ...d.sheets[0]!, nodes: [{ id: 'n1', symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } }] }],
      registry: { 'FT-101': rec('FT-101', over) },
    }
  }

  it('reports a started record with no unit, through the existing rule', () => {
    const out = run(requiredFieldEmpty, drawn({ fields: { 'general.service': 'CW' } }))
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('Unit')
  })

  it('is satisfied by an assignment', () => {
    expect(run(requiredFieldEmpty, drawn({ unitId: unit.id, fields: { 'general.service': 'CW' } }))).toHaveLength(0)
  })

  it('counts an assignment alone as a record someone has started', () => {
    // Otherwise assigning a unit and nothing else would leave the object
    // invisible to the completeness check it is meant to be measured by.
    const out = run(requiredFieldEmpty, {
      ...drawn({ unitId: unit.id }),
      standard: { ...std, required: { ...std.required, instrument: [UNIT_FIELD, 'general.service'] } },
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('Service')
  })

  it('the default standard does not require one — no existing project changes', () => {
    expect(DEFAULT_STANDARD.required.instrument).not.toContain(UNIT_FIELD)
    // The default still reports what it always reported (a missing calibrated
    // range) and says nothing new about the unit. Adopting the hierarchy must
    // not silently alter the QA report of a project that never asked for it.
    const out = run(requiredFieldEmpty, { ...drawn({ fields: { 'general.service': 'CW' } }), standard: DEFAULT_STANDARD })
    expect(out).toHaveLength(1)
    expect(out[0]!.message).toContain('Calibrated range')
    expect(out[0]!.message).not.toContain('Unit')
  })
})
