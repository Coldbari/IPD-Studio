// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The engineering signal and alarm data of a tag, read from the registry.
 *
 * OWNERSHIP. Before this module those values lived in HMI widget props, which
 * made the operator screen an engineering database by accident: two widgets
 * showing one tag could hold different alarm limits, and a widget with none set
 * still produced LL 5 / L 10 / H 90 / HH 95 because that is what the simulator
 * falls back to. Nobody decided those numbers. They are physics placeholders so
 * a demo screen animates, and publishing them as engineering data — into an I/O
 * list, a datasheet, a purchase enquiry — would be inventing specifications.
 *
 * So: the registry owns them. The HMI reads them. What stays in widget props is
 * how a thing is DRAWN and how the simulation behaves, never what the
 * instrument is.
 *
 * Everything here is pure and DOM-free.
 */

import type { Registry } from './registry'

export type IoType = 'AI' | 'AO' | 'DI' | 'DO'
export type AlarmPriority = 'high' | 'medium' | 'low'

export const IO_TYPES: readonly IoType[] = ['AI', 'AO', 'DI', 'DO']
export const ALARM_PRIORITIES: readonly AlarmPriority[] = ['high', 'medium', 'low']

/** The alarm setpoints, in the order they must ascend. */
export const ALARM_LIMIT_KEYS = ['alarm.LL', 'alarm.L', 'alarm.H', 'alarm.HH'] as const

export interface SignalEngineering {
  type?: IoType
  units?: string
  systemTag?: string
  setpoint?: number
  /** Read out of `signal.range`; absent when it does not state numbers. */
  min?: number
  max?: number
  limits: { LL?: number; L?: number; H?: number; HH?: number }
  priority?: AlarmPriority
}

const EMPTY: SignalEngineering = { limits: {} }

/**
 * Read numbers out of a calibrated range as an engineer writes one.
 *
 * Accepts `0-10`, `0 - 10`, `0 to 100`, `-50…250`, with an optional unit after
 * it (`0-10 bar`). Deliberately strict: anything it cannot read with certainty
 * returns null rather than a guess, because a wrong range would silently move
 * every alarm check that compares against it. `range-unreadable` reports the
 * ones it declines, so a range nothing can parse is visible rather than
 * quietly replaced by the simulator's 0-100.
 */
export function parseRange(text: string | undefined): { min: number; max: number; unit?: string } | null {
  if (!text) return null
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:-|–|—|\.\.\.|…|to)\s*(-?\d+(?:\.\d+)?)\s*([^\s].*)?$/i.exec(text)
  if (!m) return null
  const min = Number(m[1])
  const max = Number(m[2])
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  const unit = m[3]?.trim()
  return { min, max, ...(unit ? { unit } : {}) }
}

/** A registry value parsed as a number, or undefined if it is blank or not one. */
export function numericField(fields: Record<string, string> | undefined, key: string): number | undefined {
  const raw = fields?.[key]?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/** Is this stored value present but unreadable as a number? */
export function isMalformedNumber(fields: Record<string, string> | undefined, key: string): boolean {
  const raw = fields?.[key]?.trim()
  return Boolean(raw) && !Number.isFinite(Number(raw))
}

const asIoType = (v: string | undefined): IoType | undefined => {
  const up = v?.trim().toUpperCase()
  return IO_TYPES.find((t) => t === up)
}

const asPriority = (v: string | undefined): AlarmPriority | undefined => {
  const low = v?.trim().toLowerCase()
  return ALARM_PRIORITIES.find((p) => p === low)
}

/**
 * What the registry knows about a tag's signal. Empty when there is no record —
 * which is normal, not an error: most drawings carry tags nobody has specified
 * yet, and the simulator keeps its own defaults for exactly that case.
 *
 * O(1): a keyed lookup in the registry the caller already holds. No document
 * scan, and no second index.
 */
export function engineeringFor(registry: Registry | undefined, tag: string | undefined): SignalEngineering {
  if (!registry || !tag) return EMPTY
  const fields = registry[tag]?.fields
  if (!fields) return EMPTY

  const range = parseRange(fields['signal.range'])
  return {
    type: asIoType(fields['signal.type']),
    // An explicit unit beats the one trailing the range: it was typed in a
    // field that means only that, where "0-10 bar" is prose that happens to
    // carry one.
    units: fields['signal.units']?.trim() || range?.unit,
    systemTag: fields['signal.systemTag']?.trim() || undefined,
    setpoint: numericField(fields, 'signal.setpoint'),
    min: range?.min,
    max: range?.max,
    limits: {
      LL: numericField(fields, 'alarm.LL'),
      L: numericField(fields, 'alarm.L'),
      H: numericField(fields, 'alarm.H'),
      HH: numericField(fields, 'alarm.HH'),
    },
    priority: asPriority(fields['alarm.priority']),
  }
}

/** True when the record says nothing about signals at all. */
export const isEmptySignal = (e: SignalEngineering): boolean =>
  e.type === undefined && e.units === undefined && e.systemTag === undefined &&
  e.setpoint === undefined && e.min === undefined && e.max === undefined &&
  e.priority === undefined &&
  e.limits.LL === undefined && e.limits.L === undefined &&
  e.limits.H === undefined && e.limits.HH === undefined
