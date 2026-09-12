// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import { loadDoc, DocError } from '../../src/model/migrate'
import {
  LEGACY_AREA_FIELD,
  UNIT_FIELD,
  areaCodeOf,
  buildHierarchy,
  newArea,
  newUnit,
  placementOf,
  planLegacyMapping,
  recordFieldValue,
  resolveUnitByCode,
  unitCodeOf,
} from '../../src/model/hierarchy'
import type { Area, Unit } from '../../src/model/hierarchy'
import type { EngineeringRecord } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

const rec = (key: string, over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, ...over })

function docOf(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return { ...createEmptyDoc('t'), ...over }
}

/* --------------------------------------------------------------- 1-5 model */

describe('areas and units', () => {
  it('creates an area with a stable id of its own', () => {
    const a = newArea('100', 'Reactor area')
    expect(a.id).toBeTruthy()
    expect(a.code).toBe('100')
    expect(a.name).toBe('Reactor area')
    expect(newArea('100').id).not.toBe(a.id)
  })

  it('creates a unit that references its area by id, not by name', () => {
    const a = newArea('100')
    const u = newUnit(a.id, 'U-101', 'Feed')
    expect(u.areaId).toBe(a.id)
    expect(u.id).not.toBe(a.id)
    const h = buildHierarchy(docOf({ areas: [a], units: [u] }))
    expect(placementOf(h, u.id).area?.code).toBe('100')
  })

  it('an unassigned or unknown reference resolves to nothing, never to a guess', () => {
    const h = buildHierarchy(docOf({ areas: [newArea('100')], units: [] }))
    expect(placementOf(h, undefined)).toEqual({})
    expect(placementOf(h, 'nope')).toEqual({})
    expect(unitCodeOf(h, 'nope')).toBe('')
    expect(areaCodeOf(h, undefined)).toBe('')
  })

  it('a unit whose area is missing still resolves as a unit', () => {
    const u = newUnit('gone', 'U-101')
    const h = buildHierarchy(docOf({ areas: [], units: [u] }))
    expect(placementOf(h, u.id).unit?.code).toBe('U-101')
    expect(placementOf(h, u.id).area).toBeUndefined()
    expect(areaCodeOf(h, u.id)).toBe('')
  })

  it('IDS are the identity: renaming a code leaves every assignment intact', () => {
    const a = newArea('100')
    const u = newUnit(a.id, 'U-101')
    const before = buildHierarchy(docOf({ areas: [a], units: [u] }))
    const after = buildHierarchy(docOf({ areas: [{ ...a, code: '200' }], units: [{ ...u, code: 'U-102' }] }))
    // Same id, so the same record still points at the same unit — only what
    // it is called moved.
    expect(unitCodeOf(before, u.id)).toBe('U-101')
    expect(unitCodeOf(after, u.id)).toBe('U-102')
    expect(areaCodeOf(after, u.id)).toBe('200')
  })

  it('keeps duplicate codes rather than silently renumbering them', () => {
    // A duplicate is a QA finding the user resolves, not something the model
    // may quietly rewrite: two objects would change identity without asking.
    const a1 = newArea('100')
    const a2 = newArea('100')
    const h = buildHierarchy(docOf({ areas: [a1, a2] }))
    expect(h.areas).toHaveLength(2)
    expect(h.areaById.size).toBe(2)
  })

  it('indexes units under their area, in document order', () => {
    const a = newArea('100')
    const u1 = newUnit(a.id, 'U-101')
    const u2 = newUnit(a.id, 'U-102')
    const other = newUnit('elsewhere', 'U-201')
    const h = buildHierarchy(docOf({ areas: [a], units: [u1, other, u2] }))
    expect((h.unitsByArea.get(a.id) ?? []).map((u) => u.code)).toEqual(['U-101', 'U-102'])
  })
})

/* ------------------------------------------------------- required-field key */

describe('the reserved Unit key', () => {
  const a = newArea('100')
  const u = newUnit(a.id, 'U-101')

  it('reads an assignment through the same accessor a text field uses', () => {
    expect(recordFieldValue(rec('FT-101', { unitId: u.id }), UNIT_FIELD)).toBe(u.id)
    expect(recordFieldValue(rec('FT-101'), UNIT_FIELD)).toBe('')
    expect(recordFieldValue(rec('FT-101', { fields: { 'general.service': 'CW' } }), 'general.service')).toBe('CW')
  })

  it('is not the legacy free-text field', () => {
    const r = rec('FT-101', { fields: { [LEGACY_AREA_FIELD]: 'Reactor' } })
    expect(recordFieldValue(r, UNIT_FIELD)).toBe('')
    expect(recordFieldValue(r, LEGACY_AREA_FIELD)).toBe('Reactor')
  })
})

/* --------------------------------------------------- resolving a code (CSV) */

describe('resolving a unit by code', () => {
  const a1 = newArea('100')
  const a2 = newArea('200')
  const u1 = newUnit(a1.id, 'U-101')
  const u2 = newUnit(a2.id, 'U-101')
  const solo = newUnit(a1.id, 'U-109')
  const h = buildHierarchy(docOf({ areas: [a1, a2], units: [u1, u2, solo] }))

  it('resolves an unambiguous code, case- and space-insensitively', () => {
    expect(resolveUnitByCode(h, ' u-109 ')).toEqual({ ok: true, unitId: solo.id })
  })

  it('an empty code clears the assignment rather than failing', () => {
    expect(resolveUnitByCode(h, '')).toEqual({ ok: true, unitId: '' })
  })

  it('refuses an unknown code instead of creating it', () => {
    const r = resolveUnitByCode(h, 'U-999')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('Unknown Unit')
    // and the hierarchy is untouched — resolution is a pure read
    expect(h.units).toHaveLength(3)
  })

  it('refuses a code that two areas both use', () => {
    const r = resolveUnitByCode(h, 'U-101')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('2 areas')
  })

  it('uses the area to disambiguate that same code', () => {
    expect(resolveUnitByCode(h, 'U-101', '100')).toEqual({ ok: true, unitId: u1.id })
    expect(resolveUnitByCode(h, 'U-101', '200')).toEqual({ ok: true, unitId: u2.id })
  })

  it('refuses an unknown area', () => {
    const r = resolveUnitByCode(h, 'U-101', '900')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('Unknown Area')
  })

  it('refuses a unit that is not in the named area', () => {
    const r = resolveUnitByCode(h, 'U-109', '200')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('has no Unit')
  })
})

/* ------------------------------------------------- 32-35 + §16 migration */

describe('legacy free-text migration', () => {
  const a = newArea('100')
  const u = newUnit(a.id, 'U-101')

  const withLegacy = (value: string, extra: { areas?: Area[]; units?: Unit[] } = {}) =>
    docOf({
      areas: extra.areas ?? [a],
      units: extra.units ?? [u],
      registry: { 'FT-101': rec('FT-101', { fields: { [LEGACY_AREA_FIELD]: value } }) },
    })

  it('fixture 1: a document with no Area/Unit data plans nothing', () => {
    expect(planLegacyMapping(docOf()).rows).toHaveLength(0)
    expect(planLegacyMapping(docOf({ registry: { 'FT-101': rec('FT-101') } })).rows).toHaveLength(0)
  })

  it('fixture 4: an exact, unique unit code maps deterministically', () => {
    const plan = planLegacyMapping(withLegacy('U-101'))
    expect(plan.mapped).toHaveLength(1)
    expect(plan.mapped[0]!.unitId).toBe(u.id)
    // deterministic: the same document always yields the same plan
    expect(planLegacyMapping(withLegacy('U-101'))).toEqual(plan)
  })

  it('matches a unit code regardless of case and padding', () => {
    expect(planLegacyMapping(withLegacy('  u-101 ')).mapped).toHaveLength(1)
  })

  it('fixture 2/5: a value naming an AREA is ambiguous, never inferred to its unit', () => {
    // Even though area 100 holds exactly one unit. Going from "the author
    // wrote an area" to "therefore this unit" is an engineering decision.
    const plan = planLegacyMapping(withLegacy('100'))
    expect(plan.mapped).toHaveLength(0)
    expect(plan.needsAttention[0]!.verdict).toBe('ambiguous')
    expect(plan.needsAttention[0]!.reason).toContain('names an Area')
  })

  it('fixture 5: a code used by two areas is ambiguous', () => {
    const a2 = newArea('200')
    const u2 = newUnit(a2.id, 'U-101')
    const plan = planLegacyMapping(withLegacy('U-101', { areas: [a, a2], units: [u, u2] }))
    expect(plan.mapped).toHaveLength(0)
    expect(plan.needsAttention[0]!.reason).toContain('2 areas')
  })

  it('fixture 3: free text matching nothing stays visible as unmapped', () => {
    const plan = planLegacyMapping(withLegacy('Reactor'))
    expect(plan.needsAttention[0]!.verdict).toBe('unmapped')
    expect(plan.needsAttention[0]!.legacy).toBe('Reactor')
  })

  it('fixture 6: a malformed reference does not stop a plan being made', () => {
    const broken = docOf({
      areas: [],
      units: [newUnit('missing-area', 'U-101')],
      registry: { 'FT-101': rec('FT-101', { fields: { [LEGACY_AREA_FIELD]: 'U-101' } }) },
    })
    // The unit exists and its code is unique, so it maps; that its area is
    // gone is a QA finding, not a reason to refuse the mapping.
    expect(planLegacyMapping(broken).mapped).toHaveLength(1)
  })

  it('fixture 7 / 35: is idempotent — an assigned record is never re-planned', () => {
    const assigned = docOf({
      areas: [a],
      units: [u],
      registry: { 'FT-101': rec('FT-101', { unitId: u.id, fields: { [LEGACY_AREA_FIELD]: 'U-101' } }) },
    })
    expect(planLegacyMapping(assigned).rows).toHaveLength(0)
  })

  it('32: the legacy value is never destroyed, mapped or not', () => {
    const doc = withLegacy('U-101')
    planLegacyMapping(doc)
    planLegacyMapping(doc)
    // planning is pure — the original text is exactly where it was
    expect(doc.registry!['FT-101']!.fields[LEGACY_AREA_FIELD]).toBe('U-101')
  })

  it('reports rows in a stable order', () => {
    const doc = docOf({
      areas: [a], units: [u],
      registry: {
        'PT-102': rec('PT-102', { fields: { [LEGACY_AREA_FIELD]: 'x' } }),
        'FT-101': rec('FT-101', { fields: { [LEGACY_AREA_FIELD]: 'y' } }),
      },
    })
    expect(planLegacyMapping(doc).rows.map((r) => r.key)).toEqual(['FT-101', 'PT-102'])
  })
})

/* ------------------------------------------------------------- load / save */

describe('loading a document', () => {
  const save = (doc: ProjectDoc) => JSON.parse(JSON.stringify(doc)) as unknown

  it('a pre-P1-D document loads with no hierarchy and no invention', () => {
    const legacy = save(docOf({ registry: { 'FT-101': rec('FT-101', { fields: { [LEGACY_AREA_FIELD]: 'Reactor' } }) } }))
    const loaded = loadDoc(legacy)
    expect(loaded.areas).toBeUndefined()
    expect(loaded.units).toBeUndefined()
    expect(loaded.registry!['FT-101']!.fields[LEGACY_AREA_FIELD]).toBe('Reactor')
  })

  it('round-trips areas, units and assignments', () => {
    const a = newArea('100', 'Reactor')
    const u = newUnit(a.id, 'U-101')
    const doc = docOf({ areas: [a], units: [u], registry: { 'FT-101': rec('FT-101', { unitId: u.id }) } })
    const loaded = loadDoc(save(doc))
    expect(loaded.areas).toEqual([a])
    expect(loaded.units).toEqual([u])
    expect(loaded.registry!['FT-101']!.unitId).toBe(u.id)
  })

  it('a unit whose area is missing LOADS — it is a finding, not a broken file', () => {
    const doc = docOf({ areas: [], units: [newUnit('gone', 'U-101')] })
    expect(() => loadDoc(save(doc))).not.toThrow()
  })

  it('refuses a structurally malformed hierarchy', () => {
    expect(() => loadDoc({ ...save(docOf()) as object, areas: 'nope' })).toThrow(DocError)
    expect(() => loadDoc({ ...save(docOf()) as object, areas: [{ code: '100' }] })).toThrow(DocError)
    expect(() => loadDoc({ ...save(docOf()) as object, units: [{ id: 'u', code: 'U' }] })).toThrow(DocError)
  })

  it('does not move the schema version — the change is purely additive', () => {
    // A bump would make a file written here unopenable by the build before
    // it, for two optional fields that build would simply ignore.
    expect(loadDoc(save(docOf({ areas: [newArea('100')] }))).schemaVersion).toBe(6)
  })
})
