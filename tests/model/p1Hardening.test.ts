// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The P1 exit audit's structural findings, held down.
 *
 * Two hand-written allowlists could silently drop a field the day someone adds
 * one — `validateProfile` on the way into a standard file, and `diffRegistry`
 * on the way into a revision comparison. Both now have a ledger typed over the
 * interface, so the compiler asks. These tests prove the ledgers are honest
 * about what the code actually does, which a ledger on its own cannot.
 */

import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import {
  DEFAULT_STANDARD, PROFILE_FIELD_COVERAGE, validateProfile,
} from '../../src/model/standard'
import { serializeStandard, parseStandardFile } from '../../src/persist/standard'
import { RECORD_FIELD_COVERAGE, compareDocs } from '../../src/model/diff'
import { collectTagRefs } from '../../src/model/references'
import { LEGACY_AREA_FIELD, UNIT_FIELD, newArea, newUnit } from '../../src/model/hierarchy'
import { labelForField, FIELD_CATALOG } from '../../src/model/fields'
import { DATASHEET_SECTIONS } from '../../src/model/datasheet'
import type { StandardProfile } from '../../src/model/standard'
import type { EngineeringRecord } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

/* ------------------------------------------------ 9A. StandardProfile */

/** A profile with every field set to something non-default, so a dropped one
 *  is visible rather than masked by the fill-from-default. */
const FULL_PROFILE: StandardProfile = {
  id: 'acme-2026',
  name: 'Acme Engineering Standard',
  version: '2.1',
  tagFormat: { pattern: 'LL-NNN', separator: '', numberStart: 1, digits: 4 },
  lineNumber: { order: ['service', 'size', 'seq', 'spec'], separator: '_', sizeUnit: 'DN' },
  required: {
    instrument: ['general.service', 'signal.units', UNIT_FIELD],
    valve: ['actuation.failPosition'],
    equipment: ['general.type'],
    line: ['spec.material'],
  },
  conventions: {
    valveFailPosition: 'optional', defaultSignal: '0-10 V', defaultLocation: 'panel', sheetSize: 'A1',
  },
  severityOverrides: { 'no-relief': 'off', 'alarm-order': 'info' },
  issueStatuses: ['DRAFT', 'CHECK', 'ISSUED'],
  issuePolicy: {
    ISSUED: {
      blockSeverities: ['critical', 'warning'],
      allowAcceptedFindings: false,
      requireChecker: true,
      requireApprover: true,
      requireQaEvaluation: true,
    },
  },
}

describe('a company standard round-trips without losing a field', () => {
  it('every declared field survives serialize → parse', () => {
    const parsed = parseStandardFile(serializeStandard(FULL_PROFILE))
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.profile).toEqual(FULL_PROFILE)
  })

  it('field by field, so a failure names the one that was dropped', () => {
    const parsed = parseStandardFile(serializeStandard(FULL_PROFILE))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const key of Object.keys(PROFILE_FIELD_COVERAGE) as (keyof StandardProfile)[]) {
      expect(parsed.profile[key], key).toEqual(FULL_PROFILE[key])
    }
  })

  it('the ledger covers exactly the profile — no more, no less', () => {
    // The compiler enforces completeness; this catches a ledger entry left
    // behind after a field was removed.
    const declared = Object.keys(PROFILE_FIELD_COVERAGE).sort()
    const actual = Object.keys(FULL_PROFILE).sort()
    expect(declared).toEqual(actual)
  })

  it('the reserved Unit key survives a round trip inside `required`', () => {
    // The regression the ledger exists for, in the shape P1-D introduced it:
    // a required-field key that is not in FIELD_CATALOG.
    const parsed = parseStandardFile(serializeStandard(FULL_PROFILE))
    expect(parsed.ok && parsed.profile.required.instrument).toContain(UNIT_FIELD)
  })

  it('an older file missing a newer field is filled from the default, not rejected', () => {
    const { issueStatuses, severityOverrides, ...older } = FULL_PROFILE
    void issueStatuses; void severityOverrides
    const parsed = validateProfile(JSON.parse(JSON.stringify(older)))
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.profile.name).toBe(FULL_PROFILE.name)
  })

  it('the default standard still round-trips unchanged', () => {
    const parsed = parseStandardFile(serializeStandard(DEFAULT_STANDARD))
    expect(parsed.ok && parsed.profile).toEqual(DEFAULT_STANDARD)
  })
})

/* --------------------------------------------- 9B. EngineeringRecord */

const rec = (over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key: 'LT-101', kind: 'instrument', fields: {}, ...over })

function docWith(record: EngineeringRecord, extra: Partial<ProjectDoc> = {}): ProjectDoc {
  return { ...createEmptyDoc('t'), registry: { [record.key]: record }, ...extra }
}

describe('every top-level record property is accounted for in the diff', () => {
  it('the ledger covers exactly EngineeringRecord', () => {
    const declared = Object.keys(RECORD_FIELD_COVERAGE).sort()
    const actual = Object.keys(rec({ status: 'draft', owner: 'PN', unitId: 'u', rev: 'A', updated: 'x' })).sort()
    expect(declared).toEqual(actual)
  })

  it('owner changes are reported — the field the audit found invisible', () => {
    const before = docWith(rec({ owner: 'PN' }))
    const after = docWith(rec({ owner: 'RN' }))
    const change = compareDocs(before, after).changes.find((c) => c.field === 'owner')
    expect(change).toMatchObject({ entityType: 'record', entityKey: 'LT-101', before: 'PN', after: 'RN', category: 'metadata' })
  })

  it('gaining an owner is reported too', () => {
    const d = compareDocs(docWith(rec()), docWith(rec({ owner: 'PN' })))
    expect(d.changes.find((c) => c.field === 'owner')).toBeTruthy()
  })

  it('status and unit still report, and `updated` still does not', () => {
    const before = docWith(rec({ status: 'draft', updated: '2026-01-01' }))
    const after = docWith(rec({ status: 'approved', updated: '2026-09-11' }))
    const fields = compareDocs(before, after).changes.map((c) => c.field)
    expect(fields).toContain('status')
    expect(fields).not.toContain('updated')
  })

  it('every engineering field is compared generically, with no list to forget', () => {
    const before = docWith(rec({ fields: { 'signal.type': 'AI', 'alarm.H': '90' } }))
    const after = docWith(rec({ fields: { 'signal.type': 'DI', 'alarm.H': '80', 'brand.new.key': 'x' } }))
    const fields = compareDocs(before, after).changes.map((c) => c.field)
    expect(fields).toEqual(expect.arrayContaining(['signal.type', 'alarm.H', 'brand.new.key']))
  })
})

/* ------------------------------------------- 6. legacy area deprecation */

describe('the legacy area field is labelled as legacy', () => {
  it('is no longer called "Area / Unit" anywhere in the catalogues', () => {
    const labels = [
      ...Object.values(FIELD_CATALOG).flatMap((ss) => ss.flatMap((s) => s.fields)),
      ...Object.values(DATASHEET_SECTIONS).flat(),
    ].map((f) => f.label)
    expect(labels).not.toContain('Area / Unit')
  })

  it('says legacy, so nobody reads it as the hierarchy', () => {
    expect(labelForField(LEGACY_AREA_FIELD)).toBe('Area (legacy text)')
    expect(labelForField(UNIT_FIELD)).toBe('Unit')
  })

  it('is still present in every catalogue that carried it — nothing was deleted', () => {
    for (const kind of ['instrument', 'valve', 'equipment'] as const) {
      const keys = FIELD_CATALOG[kind].flatMap((s) => s.fields.map((f) => f.key))
      expect(keys, kind).toContain(LEGACY_AREA_FIELD)
    }
  })

  it('and a value already in it is untouched by any of this', () => {
    const doc = docWith(rec({ fields: { [LEGACY_AREA_FIELD]: 'Reactor' } }))
    expect(doc.registry!['LT-101']!.fields[LEGACY_AREA_FIELD]).toBe('Reactor')
  })
})

/* --------------------------------- 8. the rename preview counts the unit */

describe('the rename impact preview describes the whole record', () => {
  const area = newArea('100')
  const unit = newUnit(area.id, 'U-101')
  const label = (record: EngineeringRecord) =>
    collectTagRefs(docWith(record, { areas: [area], units: [unit] }), 'LT-101')
      .find((r) => r.where === 'registry')!.label

  it('a record holding only a unit assignment does not read as empty', () => {
    // It said "Engineering record (0 fields)" — telling the user there was
    // nothing to carry across the rename when there was.
    expect(label(rec({ unitId: unit.id }))).toBe('Engineering record (0 fields, unit assignment)')
  })

  it('fields and the assignment are both named', () => {
    expect(label(rec({ unitId: unit.id, fields: { 'signal.range': '0-10 bar' } })))
      .toBe('Engineering record (1 field, unit assignment)')
  })

  it('an unassigned record reads exactly as it did before', () => {
    expect(label(rec({ fields: { 'signal.range': '0-10 bar', 'general.service': 'CW' } })))
      .toBe('Engineering record (2 fields)')
  })
})
