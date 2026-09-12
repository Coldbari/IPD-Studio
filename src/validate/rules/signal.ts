// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule, RuleFinding } from '../rules'
import { finding } from '../rules'
import {
  ALARM_LIMIT_KEYS, ALARM_PRIORITIES, IO_TYPES,
  engineeringFor, isMalformedNumber, numericField, parseRange,
} from '../../model/signalData'
import { deriveIoList } from '../../model/ioList'

/**
 * Checks on the engineering signal and alarm data the registry now owns.
 *
 * The line these rules hold: report what is STRUCTURALLY wrong — a value that
 * cannot mean anything, or a set of values that contradict each other — and
 * leave engineering judgement alone. There is no rule here about what a
 * sensible range is for a level transmitter, because this software does not
 * know and guessing would train people to ignore the report.
 *
 * Completeness is deliberately absent too: whether an analogue point MUST
 * carry a unit is a house decision, and the standard profile already expresses
 * it — add `signal.units` to `required.instrument` and `required-field-empty`
 * enforces it. A second, hard-coded opinion here would fight it.
 */

const label = (k: string) => k.replace('alarm.', '').replace('signal.', '')

/** Values that cannot mean anything: a non-numeric limit, an I/O type that is
 *  not one, a priority ISA-18.2 does not define. */
export const signalDataInvalid: Rule = {
  id: 'signal-data-invalid',
  title: 'Signal and alarm values that cannot be read',
  severity: 'critical',
  discipline: 'data',
  why: 'A limit that is not a number and a type that is not a type cannot reach an I/O list, a datasheet or the simulator — they are dropped silently wherever they are used.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const [key, record] of Object.entries(ix.records)) {
      const f = record.fields
      const bad: string[] = []

      for (const k of [...ALARM_LIMIT_KEYS, 'signal.setpoint'] as const) {
        if (isMalformedNumber(f, k)) bad.push(`${label(k)} is "${f[k]}"`)
      }
      const type = f['signal.type']?.trim()
      if (type && !IO_TYPES.some((t) => t === type.toUpperCase())) {
        bad.push(`I/O type is "${type}" — expected ${IO_TYPES.join(', ')}`)
      }
      const prio = f['alarm.priority']?.trim()
      if (prio && !ALARM_PRIORITIES.some((p) => p === prio.toLowerCase())) {
        bad.push(`alarm priority is "${prio}" — expected ${ALARM_PRIORITIES.join(', ')}`)
      }

      if (bad.length) out.push(finding(signalDataInvalid, key, `${key}: ${bad.join('; ')}`))
    }
    return out
  },
}

/** LL ≤ L ≤ H ≤ HH, over whichever of them are set. */
export const alarmOrder: Rule = {
  id: 'alarm-order',
  title: 'Alarm setpoints out of order',
  severity: 'critical',
  discipline: 'data',
  why: 'Alarm limits that cross cannot all annunciate — one of them is unreachable, and which one is not something the software should decide.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const [key, record] of Object.entries(ix.records)) {
      // Only the ones actually set: a tag with H and HH and no low alarms is
      // an ordinary, complete configuration.
      const set = ALARM_LIMIT_KEYS
        .map((k) => ({ k, v: numericField(record.fields, k) }))
        .filter((e): e is { k: (typeof ALARM_LIMIT_KEYS)[number]; v: number } => e.v !== undefined)

      for (let i = 1; i < set.length; i++) {
        const prev = set[i - 1]!
        const cur = set[i]!
        if (prev.v > cur.v) {
          out.push(finding(alarmOrder, key, `${key}: ${label(prev.k)} ${prev.v} is above ${label(cur.k)} ${cur.v}`))
          break
        }
      }
    }
    return out
  },
}

/** Set outside what the instrument can measure. Suspicious, not impossible —
 *  a range is sometimes narrowed after the alarms were agreed. */
export const alarmOutsideRange: Rule = {
  id: 'alarm-outside-range',
  title: 'Alarm or setpoint outside the calibrated range',
  severity: 'warning',
  discipline: 'data',
  why: 'A limit the instrument cannot reach never annunciates. Usually the range was changed and the alarms were not.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const [key, record] of Object.entries(ix.records)) {
      const range = parseRange(record.fields['signal.range'])
      if (!range) continue
      const lo = Math.min(range.min, range.max)
      const hi = Math.max(range.min, range.max)
      const outside: string[] = []
      for (const k of [...ALARM_LIMIT_KEYS, 'signal.setpoint'] as const) {
        const v = numericField(record.fields, k)
        if (v !== undefined && (v < lo || v > hi)) outside.push(`${label(k)} ${v}`)
      }
      if (outside.length) {
        out.push(finding(alarmOutsideRange, key, `${key}: ${outside.join(', ')} outside ${lo}–${hi}`))
      }
    }
    return out
  },
}

/** Two instruments claiming one control-system tag. The twin of duplicate-tag,
 *  on the other side of the I/O boundary. */
export const duplicateSystemTag: Rule = {
  id: 'duplicate-system-tag',
  title: 'Control system tag used twice',
  severity: 'critical',
  discipline: 'data',
  why: 'The DCS or PLC database keys on this. Two instruments claiming one system tag is one of them silently reading the other.',
  run(ix) {
    const byTag = new Map<string, string[]>()
    for (const [key, record] of Object.entries(ix.records)) {
      const sys = record.fields['signal.systemTag']?.trim()
      if (!sys) continue
      byTag.set(sys, [...(byTag.get(sys) ?? []), key])
    }
    const out: RuleFinding[] = []
    for (const [sys, keys] of byTag) {
      if (keys.length < 2) continue
      for (const key of keys) {
        out.push(finding(duplicateSystemTag, key, `${key} and ${keys.filter((k) => k !== key).join(', ')} all use system tag ${sys}`))
      }
    }
    return out
  },
}

/** Stated, but not in a form anything can compute with. */
export const rangeUnreadable: Rule = {
  id: 'range-unreadable',
  title: 'Calibrated range that cannot be read as numbers',
  severity: 'info',
  discipline: 'data',
  why: 'The range still prints on the datasheet exactly as written. But nothing can check an alarm against it, and the simulator falls back to 0-100 — "0 to 100 %" or "0-10 bar" can do both.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const [key, record] of Object.entries(ix.records)) {
      const raw = record.fields['signal.range']?.trim()
      if (!raw || parseRange(raw)) continue
      // Only worth saying when something would actually use the numbers.
      const eng = engineeringFor(ix.doc.registry, key)
      const usesNumbers = eng.setpoint !== undefined || Object.values(eng.limits).some((v) => v !== undefined)
      if (!usesNumbers) continue
      out.push(finding(rangeUnreadable, key, `${key}: range "${raw}" is not a numeric range, so its alarms cannot be checked against it`))
    }
    return out
  },
}

/**
 * An instrument the I/O list cannot classify.
 *
 * Informational on purpose. It is not a mistake in the drawing — plenty of
 * real instruments need a person to say what they are — but it IS the row a
 * control-system vendor will come back about, and stating the I/O type on the
 * record settles it permanently. The message carries the reason the derivation
 * gave, so the fix is obvious rather than a hunt.
 */
export const ioTypeUnclassified: Rule = {
  id: 'io-type-unclassified',
  title: 'Signals the I/O list cannot classify',
  severity: 'info',
  discipline: 'data',
  why: 'The I/O list will not guess. Setting the I/O type on the engineering record answers it once, for the list, the vendor and every revision after.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const row of deriveIoList(ix)) {
      if (row.type !== 'unknown') continue
      out.push(
        finding(ioTypeUnclassified, row.key, `${row.key}: ${row.typeBasis}`, {
          targetId: row.nodeId,
          sheetId: row.sheetId,
        }),
      )
    }
    return out
  },
}

export const SIGNAL_RULES: Rule[] = [
  signalDataInvalid, alarmOrder, alarmOutsideRange, duplicateSystemTag, rangeUnreadable,
  ioTypeUnclassified,
]
