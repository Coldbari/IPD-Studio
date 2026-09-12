// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { ulid } from 'ulid'

export type HmiTheme = 'classic' | 'hp'

export type WidgetType =
  | 'tank' | 'pump' | 'valve' | 'display' | 'gauge' | 'trend'
  | 'lamp' | 'button' | 'switch' | 'label' | 'symbol'
  | 'bar' | 'panel' | 'nav' | 'equip'

export interface HmiWidget {
  id: string
  type: WidgetType
  x: number
  y: number
  w: number
  h: number
  rotation?: 0 | 90 | 180 | 270
  /** Primary tag, e.g. 'LT-101' or 'P-101'. Widgets read derived signals (.PV/.RUN/.OP). */
  tag?: string
  label?: string
  /** Per-type extras. The legal keys per type live in WIDGET_SCHEMA below —
   *  register every new key there (and in tests/hmi/schema.test.ts's ledger). */
  props?: Record<string, string | number | boolean>
  /** Extra trend pens beyond the primary tag: 'TAG.SIGNAL' refs (≤3). A
   *  top-level field because the props bag can't hold arrays. */
  pens?: { ref: string; color?: string }[]
}

export type PropKind =
  | 'number' | 'boolean' | 'string'
  | 'tagRef' | 'signalRef' | 'screenRef' | 'symbolRef' | 'tankRef' | 'pipeRef'

const LIMITS = { LL: 'number', L: 'number', H: 'number', HH: 'number' } as const
/** ISA-18.2 alarm-quality knobs, valid wherever limits are. */
const ALARM_Q = { deadband: 'number', alarmDelay: 'number', priority: 'string' } as const
/** display/gauge/bar/trend share the full measurement bundle (sim/tags.ts
 *  treats the four identically). */
const MEASURE = {
  ...LIMITS, ...ALARM_Q, unit: 'string', min: 'number', max: 'number',
  controller: 'boolean', base: 'number', bindTank: 'tankRef', bindPipe: 'pipeRef',
} as const

/** The prop registry: drives the property panel + pickers and gives loads a
 *  spec to check against. Unknown keys are WARNED about, never dropped — an
 *  older build must not eat a newer document's props. */
export const WIDGET_SCHEMA: Record<WidgetType, Record<string, PropKind>> = {
  tank: { capacity: 'number', level0: 'number', shape: 'string', ...LIMITS, ...ALARM_Q },
  pump: {},
  valve: { throttle: 'boolean' },
  display: { ...MEASURE, spark: 'boolean' },
  gauge: { ...MEASURE },
  trend: { ...MEASURE, span: 'number' },
  bar: { ...MEASURE },
  lamp: { signal: 'signalRef' },
  button: { signal: 'signalRef', writeValue: 'number' },
  switch: { signal: 'signalRef', onLabel: 'string', offLabel: 'string' },
  label: {},
  symbol: { symbolId: 'symbolRef' },
  equip: { symbolId: 'symbolRef' },
  panel: {},
  nav: { screen: 'screenRef' },
}

/**
 * Split a `TAG.SIGNAL` reference into its parts.
 *
 * Lives here, beside the widget types it serves, rather than in `tagIndex.ts`:
 * the document layer has to read widget references during a rename, and
 * `tagIndex` pulls in `sim/tags`, which would drag the simulator into the
 * eager bundle. `tagIndex` re-exports it, so every existing import still works.
 */
export function parseSignalRef(ref: string): { tag: string; signal: string } | null {
  const i = ref.lastIndexOf('.')
  if (i <= 0 || i === ref.length - 1) return null
  return { tag: ref.slice(0, i), signal: ref.slice(i + 1) }
}

/**
 * Which `PropKind`s hold an engineering TAG, and how the tag is stored.
 *
 *  - `signal` — the value is `TAG.SIGNAL` (lamp/button/switch `signal`).
 *  - `bare`   — the value is the tag itself. `tankRef` is one of these: a
 *    `bindTank` prop holds a tag, not a widget id, and the engine resolves it
 *    through the tag map (`sim/engine.ts` `tags[d.bindTank]`).
 *
 * `pipeRef`, `screenRef` and `symbolRef` are deliberately absent — they hold
 * pipe, screen and symbol ids, which a tag rename must not touch.
 *
 * Registered here so a new tag-bearing prop cannot be introduced without the
 * reference collector in `model/references.ts` seeing it; the ledger test in
 * `tests/model/references.test.ts` fails if this map and `PropKind` drift.
 */
export const TAG_PROP_KINDS: Partial<Record<PropKind, 'signal' | 'bare'>> = {
  signalRef: 'signal',
  tagRef: 'bare',
  tankRef: 'bare',
}

/** Prop keys this widget carries that its type's schema doesn't know. */
export function checkWidgetProps(w: HmiWidget): string[] {
  const schema = (WIDGET_SCHEMA[w.type] ?? {}) as Record<string, PropKind>
  return Object.keys(w.props ?? {}).filter((k) => !(k in schema))
}

export interface HmiPipe {
  id: string
  /** Drawn/imported upstream -> downstream. */
  points: { x: number; y: number }[]
  /** P&ID edge id when imported (informational). */
  flowRef?: string
  width?: number
  /** Service color inherited from the P&ID fluid assignment. */
  color?: string
  /** End-widget anchors set by the P&ID import: the network attaches these
   *  ends to the named widgets instead of guessing from geometry (packed
   *  imports put several widgets within attach range of one nozzle). */
  aId?: string
  bId?: string
}

export interface HmiScreen {
  id: string
  name: string
  theme: HmiTheme
  widgets: HmiWidget[]
  pipes: HmiPipe[]
  /** Source sheet when created via import; enables Re-import. */
  fromSheetId?: string
  /** RUN opens on the home screen (at most one carries the flag). */
  home?: boolean
}

/** Logical canvas size; the SVG scales to fit its container. */
export const HMI_WORLD = { w: 1600, h: 1000 }

export const WIDGET_DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  tank: { w: 96, h: 128 },
  pump: { w: 56, h: 56 },
  valve: { w: 48, h: 32 },
  display: { w: 96, h: 40 },
  gauge: { w: 96, h: 96 },
  trend: { w: 192, h: 96 },
  lamp: { w: 32, h: 32 },
  button: { w: 80, h: 32 },
  switch: { w: 64, h: 32 },
  label: { w: 96, h: 24 },
  symbol: { w: 64, h: 64 },
  equip: { w: 64, h: 64 },
  bar: { w: 56, h: 144 },
  panel: { w: 320, h: 208 },
  nav: { w: 120, h: 32 },
}

export function createScreen(number: number): HmiScreen {
  return { id: ulid(), name: `Screen ${number}`, theme: 'classic', widgets: [], pipes: [] }
}
