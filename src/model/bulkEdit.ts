// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Bulk engineering edits — from a spreadsheet, or from a paste.
 *
 * The registry stays the only source of truth. A CSV is a VIEW of it that
 * happened to go through Excel and come back, so this module's whole job is to
 * turn an untrusted file into a reviewed change set and hand it over exactly
 * once. Nothing here mutates anything.
 *
 * The rules that make that safe, all of them chosen because the opposite is a
 * way to lose engineering data quietly:
 *
 *  - IDENTITY IS THE TAG. Never the row number. A file sorted in Excel must
 *    land on the same records it came from.
 *  - AN UNKNOWN TAG IS REJECTED, never created. A typo in a spreadsheet must
 *    not mint an engineering record, and a CHANGED tag looks exactly like a
 *    typo from here — renaming goes through the P0-A path, which carries the
 *    HMI bindings and the accepted findings with it. A CSV cannot do that.
 *  - AN ABSENT ROW IS NOT A DELETION. Half a spreadsheet is a common thing to
 *    be sent; it is never an instruction to delete the other half.
 *  - A DUPLICATE TAG REJECTS THE WHOLE FILE. Choosing the first or the last
 *    row would be picking one of the user's two answers at random.
 *  - ALL OR NOTHING. A partly-applied import leaves a project nobody can
 *    reason about.
 */

import type { ProjectDoc } from './types'
import type { EntityKind } from './registry'
import { ALARM_LIMIT_KEYS, ALARM_PRIORITIES, IO_TYPES } from './signalData'
import { UNIT_FIELD, buildHierarchy, resolveUnitByCode, unitCodeOf } from './hierarchy'

/** One field of one record, changing. */
export interface CellChange {
  key: string
  /** A registry field key, or `general.unit` for a plant-hierarchy assignment. */
  field: string
  /** What the user reads — for a Unit, the CODE, never the id. */
  before: string
  after: string
  /**
   * Present only on a Unit assignment: the resolved stable id, or '' to clear.
   *
   * Resolution happens HERE, while the whole import can still be refused, and
   * never at write time. By the time anything mutates, an unknown Area or Unit
   * has already stopped the file — which is what keeps a spreadsheet from
   * minting plant hierarchy out of a typo.
   */
  unitId?: string
}

export interface ImportProblem {
  /** 1-based line in the file as the user sees it; 0 for whole-file problems. */
  row: number
  key?: string
  field?: string
  reason: string
}

export interface ChangeSet {
  /** False when anything at all was wrong: the import is refused entire. */
  ok: boolean
  modified: CellChange[]
  /** Rows that matched a record and changed nothing. */
  unchanged: number
  problems: ImportProblem[]
  /** Records in the registry that the file simply did not mention. */
  notIncluded: string[]
}

const EMPTY_SET: ChangeSet = { ok: true, modified: [], unchanged: 0, problems: [], notIncluded: [] }

/* ----------------------------------------------------------------- parsing */

/**
 * RFC 4180. Quoted fields may hold commas, newlines and doubled quotes.
 *
 * Values are only ever read as text. Nothing here evaluates a cell, and a cell
 * that looks like a formula is a string like any other — the risk with a
 * spreadsheet formula is the spreadsheet, which is why the exporter neutralises
 * them on the way OUT rather than trusting what comes back in.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '') // Excel writes a BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') { quoted = true; continue }
    if (c === ',') { row.push(cell); cell = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

/** Undo the exporter's formula guard, so a round trip is byte-stable. */
export const unguard = (v: string): string => (v.startsWith("'") ? v.slice(1) : v)

/* -------------------------------------------------------------- validation */

/**
 * TYPE RULES — deterministic, never coercion.
 *
 *  - numeric  — must parse as a finite number. "8.5" yes; "high" no; "" clears.
 *  - enum     — must be one of the allowed values, compared case-insensitively
 *               and stored in the catalogue's own casing.
 *  - text     — anything, including a range written as prose. `signal.range`
 *               is deliberately NOT type-checked: "see datasheet" is a real
 *               thing to write, and the QA report already says, at info level,
 *               when a range cannot be read as numbers.
 *
 * AN EMPTY CELL CLEARS THE FIELD. The export writes every supported column, so
 * a blank in a round-tripped file means the value is blank — and every clear
 * shows in the preview as a change with its old value, so none of it is
 * silent.
 */
type FieldRule =
  | { kind: 'numeric' }
  | { kind: 'enum'; allowed: readonly string[] }
  | { kind: 'text' }

const FIELD_RULES: Record<string, FieldRule> = {
  'signal.type': { kind: 'enum', allowed: IO_TYPES },
  'alarm.priority': { kind: 'enum', allowed: ALARM_PRIORITIES },
  'signal.setpoint': { kind: 'numeric' },
  'alarm.LL': { kind: 'numeric' },
  'alarm.L': { kind: 'numeric' },
  'alarm.H': { kind: 'numeric' },
  'alarm.HH': { kind: 'numeric' },
}

const ruleFor = (field: string): FieldRule => FIELD_RULES[field] ?? { kind: 'text' }

/** The stored form of an accepted value, or a reason it was refused. */
export function normaliseValue(field: string, raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const v = unguard(raw).trim()
  if (v === '') return { ok: true, value: '' }
  const rule = ruleFor(field)
  if (rule.kind === 'numeric') {
    return Number.isFinite(Number(v))
      ? { ok: true, value: v }
      : { ok: false, reason: `"${v}" is not a number` }
  }
  if (rule.kind === 'enum') {
    const hit = rule.allowed.find((a) => a.toLowerCase() === v.toLowerCase())
    return hit ? { ok: true, value: hit } : { ok: false, reason: `"${v}" is not one of ${rule.allowed.join(', ')}` }
  }
  return { ok: true, value: v }
}

/** LL ≤ L ≤ H ≤ HH over the values the record will HOLD once applied — the
 *  same rule the QA engine checks, applied before the mutation rather than
 *  after it, so a contradictory file never lands. */
function alarmOrderProblem(resulting: Record<string, string>): string | null {
  const set: { k: string; v: number }[] = []
  for (const k of ALARM_LIMIT_KEYS) {
    const raw = resulting[k]?.trim()
    if (!raw) continue
    const v = Number(raw)
    if (Number.isFinite(v)) set.push({ k, v })
  }
  for (let i = 1; i < set.length; i++) {
    const prev = set[i - 1]!
    const cur = set[i]!
    if (prev.v > cur.v) {
      return `${prev.k.replace('alarm.', '')} ${prev.v} is above ${cur.k.replace('alarm.', '')} ${cur.v}`
    }
  }
  return null
}

/* ------------------------------------------------------------- change sets */

export interface BulkColumn {
  label: string
  /** Registry field, or undefined for a derived column the import ignores. */
  field?: string
  /** A plant-hierarchy reference: `unit` is assigned by code, `area` is read
   *  only to disambiguate that code between areas that reuse unit numbers. */
  assign?: 'unit' | 'area'
}

/**
 * Compare a parsed table against the registry.
 *
 * PURE. It reads the document and describes what would change. The caller
 * shows it, the user confirms it, and only then does anything move.
 */
export function buildChangeSet(
  doc: ProjectDoc,
  table: string[][],
  spec: BulkColumn[],
  kind: EntityKind = 'instrument',
): ChangeSet {
  const problems: ImportProblem[] = []
  const header = table[0]
  if (!header) return { ...EMPTY_SET, ok: false, problems: [{ row: 0, reason: 'The file is empty' }] }

  // The header must be the one the exporter writes: a file whose columns have
  // been reordered or renamed is not this report, and guessing which column is
  // which is how the wrong field gets written.
  const expected = spec.map((c) => c.label)
  const got = header.map((h) => h.trim())
  if (got.length !== expected.length || expected.some((label, i) => got[i] !== label)) {
    return {
      ...EMPTY_SET,
      ok: false,
      problems: [{ row: 1, reason: `Columns do not match this report. Expected: ${expected.join(', ')}` }],
    }
  }

  const registry = doc.registry ?? {}
  const h = buildHierarchy(doc)
  const areaCol = spec.findIndex((c) => c.assign === 'area')
  const seen = new Map<string, number[]>()
  const modified: CellChange[] = []
  let unchanged = 0
  const touchedKeys = new Set<string>()

  for (let r = 1; r < table.length; r++) {
    const line = r + 1 // what the user's editor calls this row
    const cells = table[r]!
    const key = unguard(cells[0] ?? '').trim()
    if (!key) {
      problems.push({ row: line, reason: 'No tag in the first column' })
      continue
    }
    seen.set(key, [...(seen.get(key) ?? []), line])

    if (!registry[key]) {
      problems.push({
        row: line,
        key,
        reason: `Unknown engineering key "${key}". Import never creates records — and a tag edited here reads as a new one, so rename on the drawing instead, where the HMI bindings follow it.`,
      })
      continue
    }

    touchedKeys.add(key)
    const record = registry[key]!
    const current = record.fields
    const resulting: Record<string, string> = { ...current }
    const rowChanges: CellChange[] = []

    for (let c = 1; c < spec.length; c++) {
      const column = spec[c]!
      // The Area column is CONTEXT, never an assignment of its own: an object
      // belongs to a Unit, and the Unit belongs to an Area. Writing an area
      // directly would be a second place the answer lived.
      if (column.assign === 'area') continue

      if (column.assign === 'unit') {
        const wanted = unguard(cells[c] ?? '').trim()
        const areaCell = areaCol >= 0 ? unguard(cells[areaCol] ?? '').trim() : ''
        if (!wanted && areaCell) {
          problems.push({
            row: line,
            key,
            reason: `Area "${areaCell}" is given with no Unit. An object belongs to a Unit — name one, or clear the Area cell too.`,
          })
          continue
        }
        const resolved = resolveUnitByCode(h, wanted, areaCell || undefined)
        if (!resolved.ok) {
          problems.push({ row: line, key, field: UNIT_FIELD, reason: resolved.reason })
          continue
        }
        if (resolved.unitId === (record.unitId ?? '')) continue
        rowChanges.push({
          key,
          field: UNIT_FIELD,
          before: unitCodeOf(h, record.unitId),
          after: wanted,
          unitId: resolved.unitId,
        })
        continue
      }

      const field = column.field
      if (!field) continue // derived column: read-only, ignored on import
      const raw = cells[c] ?? ''
      const norm = normaliseValue(field, raw)
      if (!norm.ok) {
        problems.push({ row: line, key, field, reason: norm.reason })
        continue
      }
      const before = current[field] ?? ''
      if (norm.value === before) continue
      resulting[field] = norm.value
      rowChanges.push({ key, field, before, after: norm.value })
    }

    const order = alarmOrderProblem(resulting)
    if (order) {
      problems.push({ row: line, key, reason: `Alarm setpoints out of order — ${order}` })
      continue
    }

    if (rowChanges.length) modified.push(...rowChanges)
    else unchanged += 1
  }

  for (const [key, rows] of seen) {
    if (rows.length > 1) {
      problems.push({ row: rows[0]!, key, reason: `Tag ${key} appears on rows ${rows.join(', ')} — the file must name each record once` })
    }
  }

  const notIncluded = Object.entries(registry)
    .filter(([key, rec]) => rec.kind === kind && !touchedKeys.has(key))
    .map(([key]) => key)
    .sort()

  return {
    // Any problem at all refuses the whole file. Applying the good half of a
    // spreadsheet leaves a project half-updated and nobody able to tell which.
    ok: problems.length === 0,
    modified: [...modified].sort((a, b) => a.key.localeCompare(b.key) || a.field.localeCompare(b.field)),
    unchanged,
    problems,
    notIncluded,
  }
}

/**
 * MODEL-ONLY. NOT ON A PRODUCT PATH.
 *
 * There is no caller in `src/`: the Data workspace has no multi-cell selection
 * and no paste handler, so nothing in the application can reach this. It is
 * kept, and kept tested, because the validation a paste needs is exactly the
 * validation a file needs — when the selection UI arrives (P2), it must route
 * through here rather than grow a second, laxer path. Verified by
 * `tests/model/bulkEdit.test.ts`.
 *
 * If you are looking for what the Import CSV… button uses, it is
 * `buildChangeSet` via `DataWorkspace.readFile`.
 */
export function buildPasteChangeSet(
  doc: ProjectDoc,
  edits: { key: string; field: string; value: string }[],
  kind: EntityKind = 'instrument',
): ChangeSet {
  const spec: BulkColumn[] = [{ label: 'Tag' }]
  const fields = [...new Set(edits.map((e) => e.field))]
  // A pasted Unit column resolves by code through the same path a file does —
  // including the refusal when a code exists in two areas, which a paste has no
  // Area column to disambiguate with.
  for (const f of fields) spec.push(f === UNIT_FIELD ? { label: f, assign: 'unit' } : { label: f, field: f })

  const h = buildHierarchy(doc)
  const currentOf = (key: string, field: string): string =>
    field === UNIT_FIELD ? unitCodeOf(h, doc.registry?.[key]?.unitId) : (doc.registry?.[key]?.fields[field] ?? '')

  const byKey = new Map<string, Record<string, string>>()
  for (const e of edits) byKey.set(e.key, { ...byKey.get(e.key), [e.field]: e.value })

  const table: string[][] = [spec.map((c) => c.label)]
  for (const [key, values] of byKey) {
    table.push([key, ...fields.map((f) => values[f] ?? currentOf(key, f))])
  }
  const set = buildChangeSet(doc, table, spec, kind)
  // A paste says nothing about the records it did not cover.
  return { ...set, notIncluded: [] }
}
