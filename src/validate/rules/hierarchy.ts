// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Structural checks on the Area → Unit hierarchy.
 *
 * STRUCTURAL, and nothing else. There is no rule here about what an area code
 * should look like, how many digits a unit number carries, or whether every
 * object ought to belong to one: plant numbering conventions differ per house
 * and per project, and a checker that shipped one company's scheme as a
 * universal truth would be wrong everywhere else. Whether a Unit is REQUIRED is
 * a company-standard decision, expressed through `StandardProfile.required`
 * with the reserved `general.unit` key, and reported by `required-field-empty`
 * like every other required field.
 *
 * What is checked is what is broken regardless of convention: a reference that
 * points at nothing, and a code that identifies more than one thing.
 */

import type { Rule, RuleFinding } from '../rules'
import { finding } from '../rules'
import { LEGACY_AREA_FIELD } from '../../model/hierarchy'

export const unitOrphanArea: Rule = {
  id: 'unit-orphan-area',
  title: 'Units whose Area no longer exists',
  severity: 'critical',
  discipline: 'data',
  why: 'Everything assigned to the unit has lost its area, so it drops out of any deliverable cut by area without saying so.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const unit of ix.hierarchy.units) {
      if (ix.hierarchy.areaById.has(unit.areaId)) continue
      out.push(
        finding(unitOrphanArea, unit.id, `Unit ${unit.code} belongs to an Area that is not in this project`, {
          key: `${unitOrphanArea.id}:${unit.id}`,
        }),
      )
    }
    return out
  },
}

export const recordOrphanUnit: Rule = {
  id: 'record-orphan-unit',
  title: 'Objects assigned to a Unit that no longer exists',
  severity: 'critical',
  discipline: 'data',
  why: 'The object reads as assigned everywhere it is listed, and belongs to nothing.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const [key, rec] of Object.entries(ix.records)) {
      if (!rec.unitId || ix.hierarchy.unitById.has(rec.unitId)) continue
      const first = ix.nodesByKey.get(key)?.[0]
      out.push(
        finding(recordOrphanUnit, key, `${key} is assigned to a Unit that is not in this project`, {
          ...(first ? { targetId: first.node.id, sheetId: first.sheet.id } : {}),
        }),
      )
    }
    return out
  },
}

/**
 * Duplicate codes.
 *
 * Area codes are checked project-wide and Unit codes within their own Area,
 * which is how plants are actually numbered: two areas may each hold a unit
 * called 101 without any ambiguity, and the CSV import resolves exactly that
 * case by reading the Area column alongside it. Two AREAS called 100 is
 * ambiguous everywhere, including to a person.
 *
 * Warning rather than critical: it is a naming problem the user can see and
 * fix, not a broken reference, and every stored assignment still points at
 * precisely one unit because assignments are by id.
 */
export const duplicateAreaCode: Rule = {
  id: 'duplicate-area-code',
  title: 'Areas sharing a code',
  severity: 'warning',
  discipline: 'data',
  why: 'Two areas with one code cannot be told apart on a drawing, in a report, or by an import.',
  run(ix) {
    const byCode = new Map<string, string[]>()
    for (const a of ix.hierarchy.areas) {
      const code = a.code.trim().toLowerCase()
      if (!code) continue
      byCode.set(code, [...(byCode.get(code) ?? []), a.code])
    }
    const out: RuleFinding[] = []
    for (const [code, list] of byCode) {
      if (list.length < 2) continue
      out.push(finding(duplicateAreaCode, code, `${list.length} areas are called "${list[0]}"`))
    }
    return out
  },
}

export const duplicateUnitCode: Rule = {
  id: 'duplicate-unit-code',
  title: 'Units sharing a code within one Area',
  severity: 'warning',
  discipline: 'data',
  why: 'Inside one area a unit code has to identify one unit, or nothing referring to it by code can be resolved.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const [areaId, units] of ix.hierarchy.unitsByArea) {
      const byCode = new Map<string, string[]>()
      for (const u of units) {
        const code = u.code.trim().toLowerCase()
        if (!code) continue
        byCode.set(code, [...(byCode.get(code) ?? []), u.code])
      }
      const areaCode = ix.hierarchy.areaById.get(areaId)?.code ?? areaId
      for (const [code, list] of byCode) {
        if (list.length < 2) continue
        out.push(
          finding(duplicateUnitCode, `${areaId}/${code}`, `Area ${areaCode} has ${list.length} units called "${list[0]}"`),
        )
      }
    }
    return out
  },
}

/**
 * Legacy free text that has not been mapped to a Unit.
 *
 * This is how the P1-D migration keeps its promise that nothing is lost. The
 * old `general.area` field is never cleared, never rewritten and never guessed
 * at — so the only thing left to do is SAY that it is still there and still
 * unstructured, which is what this does.
 *
 * Gated on the project having declared at least one Area, and that gate is the
 * whole reason this is usable. A project that has not adopted the hierarchy has
 * nothing to map to, so its free text is not a defect — it is the only Area
 * information the product has ever offered it. Firing on every record of every
 * pre-P1-D document would bury the report and get the rule switched off, which
 * is the same reasoning that keeps `orphaned-binding` on `liveKeys` rather than
 * on the registry.
 *
 * Info, not warning: a value still to be mapped is work outstanding, not an
 * error in the drawing.
 */
export const legacyAreaUnmapped: Rule = {
  id: 'legacy-area-unmapped',
  title: 'Free-text Area values not yet mapped to a Unit',
  severity: 'info',
  discipline: 'data',
  why: 'These came from the single free-text "Area / Unit" box that predates the hierarchy. Nothing was thrown away — they are still to be assigned.',
  run(ix) {
    if (ix.hierarchy.areas.length === 0) return []
    const out: RuleFinding[] = []
    for (const [key, rec] of Object.entries(ix.records)) {
      if (rec.unitId) continue
      const legacy = (rec.fields[LEGACY_AREA_FIELD] ?? '').trim()
      if (!legacy) continue
      const first = ix.nodesByKey.get(key)?.[0]
      out.push(
        finding(legacyAreaUnmapped, key, `${key} carries the free-text area "${legacy}" and is not assigned to a Unit`, {
          ...(first ? { targetId: first.node.id, sheetId: first.sheet.id } : {}),
        }),
      )
    }
    return out
  },
}

export const HIERARCHY_RULES: Rule[] = [
  unitOrphanArea,
  recordOrphanUnit,
  duplicateAreaCode,
  duplicateUnitCode,
  legacyAreaUnmapped,
]
