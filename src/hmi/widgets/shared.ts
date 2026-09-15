// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiWidget } from '../model'
import type { ThemeTokens } from '../theme'
import type { TagDef } from '../sim/tags'
import type { HistoryReader } from '../sim/history'
import type { Quality } from '../sim/quality'
import { hasNumber } from '../sim/quality'

/**
 * A widget asks history for the window it wants to draw; history decides which
 * samples answer. The renderer never sees a ring buffer, and the store never
 * has to know a trend's span. See sim/history.ts.
 */
export type TrendData = HistoryReader

export interface WidgetView {
  widget: HmiWidget
  theme: ThemeTokens
  /** Live values: own-tag signals ('PV','RUN','OP','OPEN','SP','MODE') plus any
   *  fully-qualified 'TAG.SIGNAL' keys a props.signal binding asks for. Empty in edit mode. */
  sim: Record<string, number>
  /** Passed only to trend/sparkline widgets so memoization survives the tick. */
  hist?: HistoryReader
  /** History's change counter. The reader is mutated in place and keeps a
   *  stable identity, so this — not the object — is what tells a memoized
   *  widget its samples moved. Absent for widgets that draw no history, which
   *  is how they avoid re-rendering on every sample. */
  histVersion?: number
  /** Every compiled tag definition, for widgets that reference OTHER tags —
   *  a trend's extra pens need their units and ranges, and inventing them
   *  locally is what the engineering resolver exists to prevent. */
  defs?: Record<string, TagDef>
  alarm?: 'none' | 'unacked' | 'acked'
  /** Has an operator taken this tag out of service? A primitive for the same
   *  memoization reason as `quality`. */
  oos?: boolean
  /** The tag's data quality this instant. A primitive, deliberately: the
   *  full `QualityState` is a fresh object every tick and would defeat the
   *  widget memoization. Absent in EDIT, where nothing is being measured. */
  quality?: Quality
  /** The tag's compiled engineering definition. Absent only for an UNTAGGED
   *  widget, which has no tag to have a definition for. Read it through
   *  `measureOf` — never reach past it into `widget.props`. */
  eng?: TagDef
}

/** The engineering values a widget draws a process value against. */
export interface Measure {
  /** Empty string when nothing states one — never an invented unit. */
  unit: string
  min: number
  max: number
  limits: { LL?: number; L?: number; H?: number; HH?: number }
}

/**
 * Resolve what a widget draws with. THE one resolver on the render side.
 *
 * `TagDef` is the simulation's own compiled answer, produced by
 * `sim/tags.ts` through the documented order — engineering registry, then the
 * legacy widget prop, then the simulation default. A widget that reads it
 * cannot disagree with the alarm engine about a range, a unit or a limit.
 *
 * The props branch is NOT a second opinion. It is the only thing an UNTAGGED
 * widget has: no tag, so no record, so no TagDef. A tagged widget always
 * takes the first branch.
 *
 * Note what is deliberately absent: default alarm limits. A measurement
 * nobody has specified has no alarms, and inventing four numbers here is how
 * three different files came to hold three copies of `5 / 10 / 90 / 95`.
 */
export function measureOf(widget: HmiWidget, eng?: TagDef): Measure {
  if (eng) {
    return { unit: eng.unit ?? '', min: eng.min, max: eng.max, limits: eng.limits ?? {} }
  }
  const p = widget.props ?? {}
  return {
    unit: typeof p.unit === 'string' ? p.unit : '',
    min: num(p.min) ?? 0,
    max: num(p.max) ?? 100,
    limits: { LL: num(p.LL), L: num(p.L), H: num(p.H), HH: num(p.HH) },
  }
}

export const fmt = (v: number | undefined, digits = 1): string =>
  v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits)

/**
 * Format a process value for an operator, honouring its quality.
 *
 * A BAD reading has no number to print. Showing the last one it happened to
 * hold is how a dead instrument goes unnoticed for a shift, so it prints
 * dashes — the same thing a DCS does, and for the same reason. FORCED and
 * STALE keep their number: the value is real, and it is its provenance the
 * badge qualifies, not its arithmetic.
 */
export const fmtQ = (v: number | undefined, quality: Quality | undefined, digits = 1): string =>
  hasNumber(quality) ? fmt(v, digits) : '- - -'

export const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
