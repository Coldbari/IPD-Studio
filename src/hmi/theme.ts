// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE HMI DESIGN SYSTEM.
 *
 * One set of semantic tokens, consumed by the SVG process graphics (which take
 * `ThemeTokens` directly) and by every panel, table, faceplate and control
 * (which take the same values as CSS custom properties through `cssVars`).
 * Before this there were ninety-one colour literals scattered through the
 * components and fifty-nine more in two stylesheets, and the faceplate ignored
 * the theme entirely.
 *
 * COLOUR PHILOSOPHY — the part that matters more than the palette.
 *
 * Normal operation RECEDES. Equipment at rest, lines carrying nothing and
 * values inside their limits are drawn in the surface and text tones and
 * nothing else. Saturated colour is reserved for conditions an operator must
 * act on, so that when something does go colourful it means something.
 *
 * ONE MEANING PER COLOUR. The previous palette used the same red for a stopped
 * pump, a closed valve AND a critical alarm, so a screen full of correctly shut
 * valves looked exactly like a screen full of alarms. Inactive is now a quiet
 * neutral; red means abnormal, everywhere, in every component.
 *
 * Colour is never the only carrier: every state that has a colour also has a
 * word, a glyph or a shape (see `sim/state.ts`, `sim/quality.ts` and the
 * widgets).
 */

import type { HmiTheme } from './model'

export interface ThemeTokens {
  // ── Surfaces and structure ───────────────────────────────────────────────
  /** The process ground the mimic is drawn on. */
  bg: string
  /** Chrome behind panels, tables and navigation. */
  appBg: string
  /** A panel, a table, a faceplate body. */
  surface: string
  /** A raised element on a surface: a KPI tile, a menu, a selected row. */
  surfaceRaised: string
  /** A pressed or header band inside a surface. */
  surfaceSunken: string
  border: string
  /** A stronger rule for grouping, not decoration. */
  borderStrong: string
  grid: string

  // ── Text ─────────────────────────────────────────────────────────────────
  text: string
  textSecondary: string
  /** Labels, units, metadata — present but not competing. */
  textMuted: string
  /** Text on a saturated (accent or alarm) ground. */
  textOnAccent: string

  // ── Process state ────────────────────────────────────────────────────────
  /** Equipment outline at rest — the normal, quiet case. */
  equipStroke: string
  equipFill: string
  /** Energised / turning / flowing. Restrained on purpose. */
  processActive: string
  /** At rest. A NEUTRAL: a stopped pump is not an alarm. */
  processInactive: string
  /** Taken out of service or otherwise not in play. */
  disabled: string
  liquid: string
  pipe: string
  pipeFlow: string
  /**
   * THE PROCESS SERVICE PALETTE — six slots, resolved from a `StreamToken`.
   *
   * Closed on purpose. A screen that tells twelve services apart by hue tells
   * none of them apart, and a project free to pick its own stream colours will
   * eventually pick one that reads as an alarm.
   *
   * NO WARM HUES IN EITHER THEME. Red, orange and yellow belong to the alarm
   * system; a stream must never borrow them. That leaves only the cool half of
   * the wheel to hold six services apart, so they are separated by LIGHTNESS
   * as well as hue — `streamA` and `streamE` are both blue and would have been
   * indistinguishable at pipe width had they only differed in tint.
   *
   * Applied to the static pipe only — the moving overlay keeps `pipeFlow`, so
   * what a line carries never blurs with whether it is moving.
   */
  streamA: string
  streamB: string
  streamC: string
  streamD: string
  streamE: string
  streamF: string

  // ── Abnormal ─────────────────────────────────────────────────────────────
  /** Highest priority: act now. */
  alarmHigh: string
  /** Attention required. */
  alarmMedium: string
  /** Logged, visible, not urgent. */
  alarmLow: string
  /** Equipment protection has operated. */
  fault: string
  /** A standing alarm that has been acknowledged. */
  alarmAck: string

  // ── Data quality ─────────────────────────────────────────────────────────
  forced: string
  stale: string
  uncertain: string
  bad: string

  // ── Interaction ──────────────────────────────────────────────────────────
  /** EDITOR selection. Deliberately far from every alarm tone so a selected
   *  widget can never be mistaken for an abnormal one. */
  selection: string
  accent: string
  focus: string

  // ── Control values ───────────────────────────────────────────────────────
  sp: string
  op: string
  /** Trend pen palette. A CATEGORICAL scale — its job is to tell four curves
   *  apart, which is a legitimate use of colour distinct from the semantic
   *  tokens above, so it lives here rather than being an exception scattered
   *  through the chart code. Ordered for distinguishability, first pen first. */
  pens: readonly string[]

  // ── Compatibility aliases ────────────────────────────────────────────────
  /** Kept so existing widgets read unchanged. `running`/`open` are
   *  `processActive`; `stopped`/`closed` are `processInactive` — which is the
   *  substantive fix, not a rename: they used to be red. */
  running: string
  stopped: string
  open: string
  closed: string
  alarm: string
  warn: string
  panel: string
  textDim: string
}

/**
 * Restrained dark engineering ground.
 *
 * Desaturated slate rather than the saturated navy this replaced: a control
 * room runs for twelve hours at a time and a blue-glowing screen is tiring
 * before it is anything else. Equipment sits a step above the ground, and the
 * only saturated things on a healthy screen are the liquid in a vessel and the
 * flow in a line.
 */
const dark: ThemeTokens = (() => {
  const t = {
    bg: '#161b20',
    appBg: '#101418',
    surface: '#1c2228',
    surfaceRaised: '#242b32',
    surfaceSunken: '#13181c',
    border: '#333c45',
    borderStrong: '#4a555f',
    grid: '#232a31',

    text: '#e6eaed',
    textSecondary: '#aeb8c0',
    textMuted: '#7d8892',
    textOnAccent: '#ffffff',

    equipStroke: '#8b959e',
    equipFill: '#2a323a',
    processActive: '#4a9d6e',
    processInactive: '#3a434c',
    disabled: '#2a3037',
    liquid: '#4a7fa5',
    pipe: '#5c666f',
    pipeFlow: '#7fa8c4',

    streamA: '#4d7ea8',
    streamB: '#3f8c8c',
    streamC: '#5f8f5f',
    streamD: '#8b76c4',
    streamE: '#86bcd0',
    streamF: '#6d7b85',

    alarmHigh: '#e03e3e',
    alarmMedium: '#d98324',
    alarmLow: '#c9a227',
    fault: '#e03e3e',
    alarmAck: '#8a6d3b',

    forced: '#b07fd4',
    stale: '#c9a227',
    uncertain: '#8a949d',
    bad: '#e03e3e',

    selection: '#4a90d9',
    accent: '#3a6ea5',
    focus: '#7fb3e6',

    sp: '#d4b44a',
    op: '#8f7fd4',
    pens: ['#5a9fd4', '#d4954a', '#6ab88a', '#a98fd4'] as readonly string[],
  }
  return {
    ...t,
    running: t.processActive, stopped: t.processInactive,
    open: t.processActive, closed: t.processInactive,
    alarm: t.alarmHigh, warn: t.alarmMedium,
    panel: t.surface, textDim: t.textMuted,
  }
})()

/**
 * ISA-101 high performance.
 *
 * Light neutral grey ground, equipment in outline, and colour used ONLY for
 * abnormal conditions — the arrangement a modern control room uses precisely
 * because it makes an alarm the only coloured thing on the screen.
 */
const hp: ThemeTokens = (() => {
  const t = {
    bg: '#d4d4d4',
    appBg: '#c8c8c8',
    surface: '#e2e2e2',
    surfaceRaised: '#ededed',
    surfaceSunken: '#cfcfcf',
    border: '#a8a8a8',
    borderStrong: '#8a8a8a',
    grid: '#c8c8c8',

    text: '#1a1a1a',
    textSecondary: '#454545',
    textMuted: '#6b6b6b',
    textOnAccent: '#ffffff',

    equipStroke: '#4a4a4a',
    equipFill: '#c2c2c2',
    processActive: '#3c3c3c',
    processInactive: '#e8e8e8',
    disabled: '#bdbdbd',
    liquid: '#9aa8b2',
    pipe: '#7a7a7a',
    pipeFlow: '#55636d',

    streamA: '#2f5c80',
    streamB: '#246666',
    streamC: '#3d6b3d',
    streamD: '#6b4f9e',
    streamE: '#5b93a8',
    streamF: '#4e5a63',

    alarmHigh: '#c62222',
    alarmMedium: '#c06a00',
    alarmLow: '#9a7d00',
    fault: '#c62222',
    alarmAck: '#8c7a4a',

    forced: '#7b4fa8',
    stale: '#9a7d00',
    uncertain: '#6b6b6b',
    bad: '#c62222',

    selection: '#1f6ab0',
    accent: '#1f6ab0',
    focus: '#0d4c8c',

    sp: '#1f4fb0',
    op: '#5a3fb0',
    pens: ['#1f5f9e', '#9a5a10', '#2e7d54', '#6b3f9e'] as readonly string[],
  }
  return {
    ...t,
    running: t.processActive, stopped: t.processInactive,
    open: t.processActive, closed: t.processInactive,
    alarm: t.alarmHigh, warn: t.alarmMedium,
    panel: t.surface, textDim: t.textMuted,
  }
})()

export const THEMES: Record<HmiTheme, ThemeTokens> = { classic: dark, hp }

/**
 * NON-COLOUR SCALES.
 *
 * Theme-independent: a spacing step and a type size mean the same thing in
 * both themes. Small, closed sets — the audit found eleven ad-hoc font sizes
 * and six border radii chosen independently across the components.
 */
export const SCALE = {
  /** Type. `value` and `valueLg` are for PROCESS NUMBERS, which are the most
   *  important things on the screen and are sized to be read at a workstation
   *  viewing distance rather than leaned into. */
  font: { xs: 10, sm: 11, base: 12, md: 13, lg: 15, xl: 18, value: 20, valueLg: 26 },
  weight: { normal: 400, medium: 600, bold: 700 },
  line: { tight: 1.2, normal: 1.45 },
  /** One 4px step. Everything lands on it. */
  space: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 24 },
  /** Industrial panels group with rules, not with rounded cards. */
  radius: { none: 0, sm: 2, md: 3 },
  border: { thin: 1, thick: 2 },
  control: { sm: 22, md: 26 },
} as const

/** Alarm priority → its one token. Used by every component that shows a
 *  priority, so there is a single meaning per colour across the workstation. */
export const PRIORITY_TOKEN = { high: 'alarmHigh', medium: 'alarmMedium', low: 'alarmLow' } as const

/**
 * The theme and the scales as CSS custom properties.
 *
 * Applied once to the workspace root, so a stylesheet can use
 * `var(--hmi-surface)` and an inline SVG can use `theme.surface`, and neither
 * can drift from the other. One source of truth, two consumers.
 */
export function cssVars(theme: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(theme)) {
    out[`--hmi-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = v
  }
  for (const [k, v] of Object.entries(SCALE.font)) out[`--hmi-font-${k}`] = `${v}px`
  for (const [k, v] of Object.entries(SCALE.space)) out[`--hmi-space-${k}`] = `${v}px`
  for (const [k, v] of Object.entries(SCALE.radius)) out[`--hmi-radius-${k}`] = `${v}px`
  for (const [k, v] of Object.entries(SCALE.control)) out[`--hmi-control-${k}`] = `${v}px`
  for (const [k, v] of Object.entries(SCALE.weight)) out[`--hmi-weight-${k}`] = String(v)
  // Line height is unitless by design — it multiplies the element's own font
  // size, so a dense table and a paragraph both get the right leading from one
  // token. Border widths are lengths and carry their unit; they sit beside the
  // border COLOUR token deliberately, so a rule reads
  // `border: var(--hmi-border-thin) solid var(--hmi-border)`.
  for (const [k, v] of Object.entries(SCALE.line)) out[`--hmi-line-${k}`] = String(v)
  for (const [k, v] of Object.entries(SCALE.border)) out[`--hmi-border-${k}`] = `${v}px`
  return out
}
