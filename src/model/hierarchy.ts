// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * AREA → UNIT: the plant hierarchy an engineering object belongs to.
 *
 * Two levels, deliberately. Plant/site/subarea/train/system are real on some
 * projects and meaningless on others, and every level that exists has to be
 * filled in, filtered by, exported and diffed. Area → Unit is the pair that
 * every deliverable this product already produces actually joins on — an I/O
 * list is cut per unit, an instrument index is grouped by area — so that is
 * what ships.
 *
 * WHAT IT REPLACES. Until now there was ONE free-text field, `general.area`,
 * labelled "Area / Unit", on instruments, valves and equipment. Not two
 * fields — one, whose own label admits it conflates the two. That is why the
 * legacy migration below refuses to guess: a cell reading "Reactor" does not
 * say whether the author meant an area, a unit, or the name of a vessel it
 * sits next to, and inventing an Area record per distinct string would mint
 * hierarchy out of typing errors.
 *
 * IDENTITY IS THE ID. Areas and Units carry a ULID that nothing displays and
 * nothing may reuse. `code` and `name` are what an engineer reads and are
 * therefore expected to change — U-101 becomes U-102 when the numbering is
 * revised, and every object assigned to it stays assigned. Never a name as a
 * foreign key, and never an array index: both are how a reorder becomes a
 * silent reassignment.
 *
 * WHERE AN ASSIGNMENT LIVES. On the engineering RECORD (`unitId`), not on the
 * drawn node. Which unit a pump belongs to is a fact about the pump, not about
 * one placement of its symbol — so putting it on `PlantNode` would lose it to
 * the delete-and-redraw that `model/registry.ts` exists to survive, would let
 * two placements of one tag disagree, and would leave lines unassignable
 * because a line is an edge. One tag, one record, one unit.
 *
 * AREA IS NEVER STORED TWICE. A record names its Unit; the Unit names its
 * Area. Asking a record for its area walks that one hop. A second `areaId`
 * beside `unitId` would be two answers to one question, and the day they
 * disagree is the day the deliverable is wrong.
 *
 * Everything here is pure and DOM-free.
 */

import { ulid } from 'ulid'
import type { EngineeringRecord, Registry } from './registry'
import { LOOP_FIELD } from './loop'

export interface Area {
  /** Stable identity. Never displayed, never reused, never derived. */
  id: string
  /** What the engineer reads and prints: "100", "OSBL", "A-20". */
  code: string
  /** Optional long form: "Reactor area". */
  name?: string
}

export interface Unit {
  id: string
  /** The Area this Unit sits in, by stable id. */
  areaId: string
  code: string
  name?: string
}

/**
 * The reserved required-field key for a Unit assignment.
 *
 * It is NOT in `FIELD_CATALOG`, because a Unit is not a text field: it is a
 * reference, edited with a picker and stored as an id. But the company
 * standard has one mechanism for "an object must carry this before its record
 * is usable" (`StandardProfile.required`), and a second mechanism beside it
 * would be a second place to look. So the key is expressible there, and
 * `recordFieldValue()` below is what resolves it.
 */
export const UNIT_FIELD = 'general.unit'

/** The pre-P1-D free-text field. Read, preserved, and never written by the
 *  hierarchy: it is the evidence a legacy mapping is derived from. */
export const LEGACY_AREA_FIELD = 'general.area'

export const HIERARCHY_FIELD_LABELS: Record<string, string> = {
  [UNIT_FIELD]: 'Unit',
}

/**
 * The hierarchy, indexed. Built ONCE per document (see `ProjectIndex`), never
 * per table cell: a data workspace that scanned the unit array for every row
 * of every column is exactly the quadratic report `export/csv.ts` already had
 * to fix once.
 */
export interface Hierarchy {
  areas: Area[]
  units: Unit[]
  areaById: Map<string, Area>
  unitById: Map<string, Unit>
  /** Area id -> its units, in document order. */
  unitsByArea: Map<string, Unit[]>
}

export const EMPTY_HIERARCHY: Hierarchy = {
  areas: [],
  units: [],
  areaById: new Map(),
  unitById: new Map(),
  unitsByArea: new Map(),
}

export function buildHierarchy(doc: { areas?: Area[]; units?: Unit[] }): Hierarchy {
  const areas = doc.areas ?? []
  const units = doc.units ?? []
  const areaById = new Map(areas.map((a) => [a.id, a]))
  const unitById = new Map(units.map((u) => [u.id, u]))
  const unitsByArea = new Map<string, Unit[]>()
  for (const u of units) {
    const list = unitsByArea.get(u.areaId)
    if (list) list.push(u)
    else unitsByArea.set(u.areaId, [u])
  }
  return { areas, units, areaById, unitById, unitsByArea }
}

export function newArea(code: string, name?: string): Area {
  return { id: ulid(), code, ...(name ? { name } : {}) }
}

export function newUnit(areaId: string, code: string, name?: string): Unit {
  return { id: ulid(), areaId, code, ...(name ? { name } : {}) }
}

/**
 * Where an assignment points. Either half can be absent and that is not an
 * error: an unassigned record has no unit, and a unit whose area was deleted
 * has no area — the QA engine reports the second, and neither may make a
 * deliverable throw.
 */
export interface Placement {
  unit?: Unit
  area?: Area
}

export function placementOf(h: Hierarchy, unitId: string | undefined): Placement {
  if (!unitId) return {}
  const unit = h.unitById.get(unitId)
  if (!unit) return {}
  const area = h.areaById.get(unit.areaId)
  return area ? { unit, area } : { unit }
}

/** The unit code of a record's assignment, or ''. The CODE, never the id:
 *  this is what prints in a table and a CSV, and what an import resolves. */
export function unitCodeOf(h: Hierarchy, unitId: string | undefined): string {
  return placementOf(h, unitId).unit?.code ?? ''
}

export function areaCodeOf(h: Hierarchy, unitId: string | undefined): string {
  return placementOf(h, unitId).area?.code ?? ''
}

/** `U-101` or `U-101 — Reactor`, for a picker. Never for a CSV. */
export function unitLabel(u: Unit): string {
  return u.name ? `${u.code} — ${u.name}` : u.code
}

export function areaLabel(a: Area): string {
  return a.name ? `${a.code} — ${a.name}` : a.code
}

/**
 * Read one required-field value off a record, resolving the reserved Unit key.
 *
 * The single place that knows a Unit assignment is not stored in `fields`. The
 * required-field rule and the Data workspace both go through it, so the QA
 * report and the table cannot disagree about whether a unit has been set.
 */
export function recordFieldValue(record: EngineeringRecord | undefined, field: string): string {
  if (field === UNIT_FIELD) return record?.unitId ?? ''
  // The loop assignment, resolved the same way and through the same accessor —
  // so a standard that requires one is checked by `required-field-empty` and
  // no second rule.
  //
  // A DERIVED loop never satisfies this. The value read is `record.loopId`,
  // which only a deliberate assignment sets; sharing a tag number with three
  // other instruments is an observation, not a declaration, and treating it as
  // one would let a requirement pass without anybody having decided anything.
  if (field === LOOP_FIELD) return record?.loopId ?? ''
  return record?.fields[field] ?? ''
}

/* ------------------------------------------------------------- resolution */

export type UnitResolution =
  | { ok: true; unitId: string }
  | { ok: false; reason: string }

/**
 * Resolve a human-written Unit code — from a CSV, from a paste — to a stable
 * id.
 *
 * NEVER CREATES. An unknown code is an error the user resolves by declaring
 * the unit, exactly as an unknown tag is an error they resolve by drawing the
 * instrument. A spreadsheet that can mint plant hierarchy is a spreadsheet
 * where one typo permanently splits a project's area structure in two, and
 * nothing downstream would ever say so.
 *
 * Matching is trimmed and case-insensitive, because "u-101" out of a
 * spreadsheet is the same unit an engineer typed as "U-101" — but it must
 * resolve to exactly ONE unit or it is refused. `areaCode`, when the file
 * carries one, narrows the search first: that is what lets two areas each
 * have a unit numbered 101 without either becoming unimportable.
 */
export function resolveUnitByCode(h: Hierarchy, code: string, areaCode?: string): UnitResolution {
  const wanted = code.trim().toLowerCase()
  if (!wanted) return { ok: true, unitId: '' }

  let pool = h.units
  const area = areaCode?.trim()
  if (area) {
    const areas = h.areas.filter((a) => a.code.trim().toLowerCase() === area.toLowerCase())
    if (areas.length === 0) {
      return { ok: false, reason: `Unknown Area "${area}". Create it in Areas & Units first — import never adds hierarchy.` }
    }
    if (areas.length > 1) {
      return { ok: false, reason: `Area code "${area}" is used by ${areas.length} areas, so it does not identify one` }
    }
    pool = h.unitsByArea.get(areas[0]!.id) ?? []
  }

  const hits = pool.filter((u) => u.code.trim().toLowerCase() === wanted)
  if (hits.length === 1) return { ok: true, unitId: hits[0]!.id }
  if (hits.length === 0) {
    return {
      ok: false,
      reason: area
        ? `Area ${area} has no Unit "${code.trim()}". Create it in Areas & Units first — import never adds hierarchy.`
        : `Unknown Unit "${code.trim()}". Create it in Areas & Units first — import never adds hierarchy.`,
    }
  }
  return {
    ok: false,
    reason: `Unit code "${code.trim()}" exists in ${hits.length} areas — name the Area column so it identifies one`,
  }
}

/* ------------------------------------------------------- legacy migration */

export type LegacyVerdict = 'mapped' | 'ambiguous' | 'unmapped'

export interface LegacyRow {
  /** Registry key of the record carrying the legacy value. */
  key: string
  /** The free text as written, verbatim. Never altered, never cleared. */
  legacy: string
  verdict: LegacyVerdict
  /** Set only when `verdict` is 'mapped'. */
  unitId?: string
  /** Why, in the words shown beside the row. */
  reason: string
}

export interface LegacyMapping {
  rows: LegacyRow[]
  mapped: LegacyRow[]
  needsAttention: LegacyRow[]
}

/**
 * What the legacy free text WOULD become, if applied.
 *
 * Pure, deterministic and idempotent. It reads the document and describes a
 * plan; nothing here writes, and running it twice over an already-migrated
 * document produces an empty plan because an assigned record is skipped.
 *
 * THE ONLY SAFE MAPPING IS AN EXACT, UNIQUE UNIT CODE. That rule is narrower
 * than it could be, on purpose:
 *
 *  - A value matching an AREA code is NOT mapped, even when that area holds
 *    exactly one unit. Going from "this says area 100" to "therefore unit
 *    100-A" is an inference about the plant, and the one thing this feature
 *    must not do is decide engineering facts on the user's behalf.
 *  - A value matching a unit code in two different areas is refused, because
 *    picking one would be picking at random.
 *  - A value matching nothing is left exactly where it is.
 *
 * In every unmapped case the original string stays in `general.area`, so the
 * information is never lost — it is surfaced, by `legacy-area-unmapped`, as
 * work still to do.
 */
export function planLegacyMapping(doc: { areas?: Area[]; units?: Unit[]; registry?: Registry }): LegacyMapping {
  const h = buildHierarchy(doc)
  const rows: LegacyRow[] = []

  for (const [key, rec] of Object.entries(doc.registry ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    // Already assigned: a migration must never overwrite a decision someone
    // has made. This is also what makes re-running it a no-op.
    if (rec.unitId) continue
    const legacy = (rec.fields[LEGACY_AREA_FIELD] ?? '').trim()
    if (!legacy) continue

    const hits = h.units.filter((u) => u.code.trim().toLowerCase() === legacy.toLowerCase())
    if (hits.length === 1) {
      const unit = hits[0]!
      const area = h.areaById.get(unit.areaId)
      rows.push({
        key,
        legacy,
        verdict: 'mapped',
        unitId: unit.id,
        reason: `Matches Unit ${unit.code}${area ? ` in Area ${area.code}` : ''}`,
      })
      continue
    }
    if (hits.length > 1) {
      rows.push({ key, legacy, verdict: 'ambiguous', reason: `"${legacy}" is a Unit code in ${hits.length} areas — choose one` })
      continue
    }

    const areaHits = h.areas.filter((a) => a.code.trim().toLowerCase() === legacy.toLowerCase())
    if (areaHits.length > 0) {
      rows.push({
        key,
        legacy,
        verdict: 'ambiguous',
        reason: `"${legacy}" names an Area, not a Unit — pick which unit of it this belongs to`,
      })
      continue
    }

    rows.push({ key, legacy, verdict: 'unmapped', reason: `"${legacy}" matches no Area or Unit — create one, or assign by hand` })
  }

  return {
    rows,
    mapped: rows.filter((r) => r.verdict === 'mapped'),
    needsAttention: rows.filter((r) => r.verdict !== 'mapped'),
  }
}
