// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { EntityKind } from './registry'
import type { SheetSize } from './types'

/**
 * The company standard: the rules a project is checked against.
 *
 * This is what turns a checker into something an engineering department pays
 * for. A generic validator tells you a tag is malformed by ISA; this one tells
 * you it is malformed by *your* numbering convention, which is the thing that
 * actually gets a drawing rejected at check stage.
 *
 * Stored IN the document rather than in app settings, so a `.pnid` is
 * self-describing: a reviewer opening someone else's file checks it against the
 * same rules its author did, and a drawing that passed on one machine cannot
 * quietly fail on another. It also exports on its own as `.ipdstd.json`, so one
 * company file seeds every project.
 *
 * The one thing a standard must never do is REWRITE. It validates, and every
 * repair is an explicit per-object fix the user approves. Silently renaming
 * tags to match a newly-applied convention would destroy engineering identities
 * across a live project — the fastest possible way to lose an engineer's trust.
 */

/** Severity a rule can be forced to, or `off` to silence it entirely. */
export type RuleSeverityOverride = 'critical' | 'warning' | 'info' | 'off'

/**
 * `LL-NNN` — letters then a loop number (FT-101).
 * `LL-NNNA` — the same, with an optional single-letter suffix (FT-101A), which
 * is how duplicated instruments on one loop are distinguished.
 *
 * `AREA-LL-NNN` is deliberately absent. An area prefix is not a formatting
 * choice, it is a third component the `Tag` type does not carry, and shipping a
 * dropdown entry that silently validates nothing is worse than not offering it.
 * It arrives when `Tag` grows an `area`.
 */
export type TagPattern = 'LL-NNN' | 'LL-NNNA'

export type LineNumberPart = 'size' | 'service' | 'spec' | 'seq'

export const LINE_NUMBER_PARTS: readonly LineNumberPart[] = ['size', 'service', 'spec', 'seq']

export const LINE_PART_LABELS: Record<LineNumberPart, string> = {
  size: 'Size',
  service: 'Service',
  spec: 'Pipe class',
  seq: 'Sequence',
}

export interface StandardProfile {
  id: string
  /** Shown wherever the project reports what it was checked against. */
  name: string
  tagFormat: {
    pattern: TagPattern
    separator: '-' | ''
    /** Auto-numbering base: 100 (FT-101) or 1 (FT-001). */
    numberStart: 100 | 1
    /** How many digits a loop number carries. FT-101 is 3; FT-0101 is 4. */
    digits: 3 | 4
  }
  lineNumber: {
    /** Component order: 6"-CW-150-001 vs 6"-150-CW-001. */
    order: LineNumberPart[]
    separator: string
    sizeUnit: 'in' | 'DN'
  }
  /** Field keys (model/fields.ts) an object must carry, per kind. Drives the
   *  `required-field-empty` rule and the inspector's markers. */
  required: Record<EntityKind, string[]>
  conventions: {
    /** `optional` switches the fail-position check off for the whole project —
     *  some houses carry it on the datasheet only, not the P&ID. */
    valveFailPosition: 'required' | 'optional'
    defaultSignal: string
    defaultLocation: 'field' | 'panel'
    sheetSize: SheetSize
  }
  /** Rule id -> forced severity, or `off`. The escape hatch for a house that
   *  genuinely does not care about a check the engine ships. */
  severityOverrides?: Record<string, RuleSeverityOverride>
}

/**
 * What the engine checked against before standards existed.
 *
 * These values are not arbitrary: they are exactly the behaviour of v0.17, so
 * a project that never opens the Standards page sees no change in its QA
 * report. A default that silently altered every existing project's findings
 * would make the feature feel like a regression.
 */
export const DEFAULT_STANDARD: StandardProfile = {
  id: 'ipd-default',
  name: 'IPD Studio default',
  tagFormat: { pattern: 'LL-NNNA', separator: '-', numberStart: 100, digits: 3 },
  lineNumber: { order: ['size', 'spec', 'service', 'seq'], separator: '-', sizeUnit: 'in' },
  required: {
    instrument: ['general.service', 'signal.range'],
    valve: ['element.size', 'actuation.failPosition'],
    equipment: ['general.service'],
    line: ['spec.size', 'spec.material'],
  },
  conventions: {
    valveFailPosition: 'required',
    defaultSignal: '4-20 mA',
    defaultLocation: 'field',
    sheetSize: 'A3',
  },
}

/** The profile a document is checked against. Never null: a document without
 *  one is checked against the default, which is what it was checked against
 *  before the feature existed. */
export function standardOf(doc: { standard?: StandardProfile }): StandardProfile {
  return doc.standard ?? DEFAULT_STANDARD
}

export function requiredFor(std: StandardProfile, kind: EntityKind): string[] {
  return std.required[kind] ?? []
}

/**
 * Does a loop number match the profile's digit count?
 *
 * Only digits are checked, not value: `numberStart` is an auto-numbering
 * preference, and an engineer who deliberately numbered a loop 42 on a
 * 100-based project has made a choice, not an error.
 */
export function loopDigitsOk(std: StandardProfile, loop: string): boolean {
  return new RegExp(`^\\d{${std.tagFormat.digits}}$`).test(loop)
}

export function suffixAllowed(std: StandardProfile): boolean {
  return std.tagFormat.pattern === 'LL-NNNA'
}

/** A loop number padded to the profile's width — for messages and fixes. */
export function padLoop(std: StandardProfile, loop: string): string {
  const n = loop.replace(/\D/g, '')
  return n.padStart(std.tagFormat.digits, '0')
}

/**
 * Format a line number in the profile's component order.
 *
 * NOT used for the registry key. `keyOfEdge` keeps its own fixed formatting on
 * purpose: the key is an engineering identity that records hang off, and
 * re-ordering it when a standard changed would orphan every line record in the
 * project. Display and reports move; identity does not.
 */
export function formatLineNumber(
  std: StandardProfile,
  ln: { size: string; spec: string; service: string; seq: string },
): string {
  return std.lineNumber.order
    .map((part) => ln[part])
    .filter((v) => v && v.trim() !== '')
    .join(std.lineNumber.separator)
}

/** Which components the profile expects a line number to carry. */
export function missingLineParts(
  std: StandardProfile,
  ln: { size: string; spec: string; service: string; seq: string },
): LineNumberPart[] {
  return std.lineNumber.order.filter((part) => !ln[part] || ln[part].trim() === '')
}

export interface ProfileProblem {
  field: string
  message: string
}

/**
 * Validate a profile parsed from a file.
 *
 * An `.ipdstd.json` is a file a user can hand-edit and a colleague can email,
 * so it is checked the way `loadDoc` checks a document: reject with something
 * readable rather than letting a malformed profile reach the rule engine and
 * surface as twenty broken checks.
 */
export function validateProfile(raw: unknown): { ok: true; profile: StandardProfile } | { ok: false; problems: ProfileProblem[] } {
  const problems: ProfileProblem[] = []
  const add = (field: string, message: string) => problems.push({ field, message })

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: [{ field: 'file', message: 'Not an engineering standard file' }] }
  }
  const p = raw as Partial<StandardProfile>

  if (typeof p.name !== 'string' || p.name.trim() === '') add('name', 'A standard needs a name')
  if (p.name !== undefined && typeof p.name === 'string' && p.name.length > 120) {
    add('name', 'Name is longer than 120 characters')
  }

  const tf = p.tagFormat
  if (typeof tf !== 'object' || tf === null) add('tagFormat', 'Missing tag format')
  else {
    if (tf.pattern !== 'LL-NNN' && tf.pattern !== 'LL-NNNA') add('tagFormat.pattern', `Unknown tag pattern "${String(tf.pattern)}"`)
    if (tf.separator !== '-' && tf.separator !== '') add('tagFormat.separator', 'Separator must be "-" or empty')
    if (tf.numberStart !== 100 && tf.numberStart !== 1) add('tagFormat.numberStart', 'Numbering must start at 1 or 100')
    if (tf.digits !== 3 && tf.digits !== 4) add('tagFormat.digits', 'Loop numbers must be 3 or 4 digits')
  }

  const ln = p.lineNumber
  if (typeof ln !== 'object' || ln === null) add('lineNumber', 'Missing line-number format')
  else {
    if (!Array.isArray(ln.order) || ln.order.length === 0) {
      add('lineNumber.order', 'Line numbering needs at least one component')
    } else {
      for (const part of ln.order) {
        if (!LINE_NUMBER_PARTS.includes(part)) add('lineNumber.order', `Unknown line-number component "${String(part)}"`)
      }
      if (new Set(ln.order).size !== ln.order.length) add('lineNumber.order', 'A component is listed twice')
    }
    if (typeof ln.separator !== 'string' || ln.separator.length > 3) {
      add('lineNumber.separator', 'Separator must be a short string')
    }
    if (ln.sizeUnit !== 'in' && ln.sizeUnit !== 'DN') add('lineNumber.sizeUnit', 'Size unit must be "in" or "DN"')
  }

  if (typeof p.required !== 'object' || p.required === null || Array.isArray(p.required)) {
    add('required', 'Missing required-field lists')
  } else {
    for (const [kind, keys] of Object.entries(p.required)) {
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
        add(`required.${kind}`, 'Required fields must be a list of field keys')
      }
    }
  }

  if (typeof p.conventions !== 'object' || p.conventions === null) add('conventions', 'Missing conventions')
  else if (p.conventions.valveFailPosition !== 'required' && p.conventions.valveFailPosition !== 'optional') {
    add('conventions.valveFailPosition', 'Fail position must be "required" or "optional"')
  }

  if (p.severityOverrides !== undefined) {
    if (typeof p.severityOverrides !== 'object' || p.severityOverrides === null || Array.isArray(p.severityOverrides)) {
      add('severityOverrides', 'Severity overrides must be a map of rule id to severity')
    } else {
      for (const [ruleId, sev] of Object.entries(p.severityOverrides)) {
        if (!['critical', 'warning', 'info', 'off'].includes(sev as string)) {
          add(`severityOverrides.${ruleId}`, `"${String(sev)}" is not a severity`)
        }
      }
    }
  }

  if (problems.length) return { ok: false, problems }

  // Fill from the default rather than trusting the file to be complete: a
  // profile written against an older build is missing whatever shipped since,
  // and refusing it would make every upgrade break everyone's standard file.
  const profile: StandardProfile = {
    id: typeof p.id === 'string' && p.id ? p.id : DEFAULT_STANDARD.id,
    name: (p.name as string).trim(),
    tagFormat: { ...DEFAULT_STANDARD.tagFormat, ...p.tagFormat },
    lineNumber: { ...DEFAULT_STANDARD.lineNumber, ...p.lineNumber },
    required: { ...DEFAULT_STANDARD.required, ...p.required },
    conventions: { ...DEFAULT_STANDARD.conventions, ...p.conventions },
    ...(p.severityOverrides ? { severityOverrides: p.severityOverrides } : {}),
  }
  return { ok: true, profile }
}
