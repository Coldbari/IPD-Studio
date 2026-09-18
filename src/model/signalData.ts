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
  /**
   * K21 — the fastest this controller's OUTPUT may move, in PER CENT OF
   * OUTPUT PER SECOND (`signal.outputRateLimit`).
   *
   * Always converted into %/s here, so no caller has to ask what unit it just
   * received — the same rule every other quantity in this product follows.
   *
   * ABSENT MEANS NO RATE LIMIT. Not zero, which would freeze the output, and
   * not a default: a controller whose record says nothing moves its output as
   * fast as the algorithm asks, exactly as every controller did before K21.
   * Nothing derives it from the drive's ramp, the valve's stroke rate, the
   * sample time or the rated speed — those are different concepts, and §3 of
   * the K21 brief exists because they are so easy to confuse.
   */
  outputRateLimitPctPerS?: number
  /**
   * K23 — the SETPOINT range this loop may be operated over
   * (`signal.spLow` / `signal.spHigh`), in the tag's own engineering unit.
   *
   * AN AUTHORITY STATEMENT, and the distinction from `min`/`max` above is the
   * whole point of K23: those are the CALIBRATED RANGE, which says what the
   * instrument can MEASURE. These say what the controller may be ASKED for.
   * A transmitter ranged 0-60 may sit on a loop nobody is permitted to run
   * below 10, and no part of this model may infer one from the other.
   *
   * ABSENT MEANS NO LIMIT ON THAT SIDE. Not zero, not the end of the
   * calibrated range, and not the other limit mirrored. Either may be stated
   * alone.
   */
  spLow?: number
  spHigh?: number
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
    // K23. `numericField` and not a quantity parser, deliberately: a setpoint
    // limit is in the tag's own unit, exactly as `signal.setpoint` and the
    // `alarm.*` thresholds are, and the tag declares that unit once.
    ...(numericField(fields, 'signal.spLow') !== undefined
      ? { spLow: numericField(fields, 'signal.spLow')! } : {}),
    ...(numericField(fields, 'signal.spHigh') !== undefined
      ? { spHigh: numericField(fields, 'signal.spHigh')! } : {}),
    min: range?.min,
    max: range?.max,
    limits: {
      LL: numericField(fields, 'alarm.LL'),
      L: numericField(fields, 'alarm.L'),
      H: numericField(fields, 'alarm.H'),
      HH: numericField(fields, 'alarm.HH'),
    },
    priority: asPriority(fields['alarm.priority']),
    ...(outputRate(fields['signal.outputRateLimit']) !== undefined
      ? { outputRateLimitPctPerS: outputRate(fields['signal.outputRateLimit'])! } : {}),
  }
}

/** Seconds in each time unit a rate may legitimately be stated per. */
const PER: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hour: 3600, hours: 3600,
}

/**
 * K21 — an output rate as an engineer writes one, in %/s.
 *
 * "10 %/s", "10 % / s", "600 %/min", "36000 %/h. A BARE NUMBER is %/s,
 * because the quantity being rated is the controller output and this product
 * has exactly one unit for that — per cent. That is the same rule
 * `duty.minSpeed` already follows for a bare percentage, and it is a
 * DECLARED convention rather than a guess between candidates.
 *
 * WHAT IS REFUSED, rather than approximated: a numerator that is not per cent.
 * "2 m³/h/s" is a rate of something, but not of this controller's output, and
 * there is no conversion between a flow and an output position — the same
 * reason K18 refuses a `duty.minFlow` in m³/h on a loop ranged in l/s. Zero
 * and negative are refused too: a zero rate limit would freeze the output for
 * ever, which is a trip and not a rate limit, and a negative one is not a
 * rate. All three read as NOT CONFIGURED.
 */
function outputRate(raw: string | undefined): number | undefined {
  const text = raw?.trim()
  if (!text) return undefined
  const m = /^([-+]?\d*\.?\d+)\s*(%?)\s*(?:\/\s*([a-z]+))?$/i.exec(text.replace(/\s+/g, ' '))
  if (!m) return undefined
  const value = Number(m[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  const per = m[3]?.toLowerCase()
  // no denominator at all is per second: "10" and "10 %" both mean 10 %/s
  if (per === undefined) return value
  const seconds = PER[per]
  return seconds === undefined ? undefined : value / seconds
}

/** True when the record says nothing about signals at all. */
export const isEmptySignal = (e: SignalEngineering): boolean =>
  e.type === undefined && e.units === undefined && e.systemTag === undefined &&
  e.setpoint === undefined && e.min === undefined && e.max === undefined &&
  e.priority === undefined && e.outputRateLimitPctPerS === undefined &&
  e.spLow === undefined && e.spHigh === undefined &&
  e.limits.LL === undefined && e.limits.L === undefined &&
  e.limits.H === undefined && e.limits.HH === undefined
