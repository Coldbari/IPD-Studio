// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * OPERATOR DERIVATIONS — the facts every workstation page is built from.
 *
 * Pure, DOM-free and React-free, so the counts an operator acts on can be
 * tested without mounting anything. Every one of them is DERIVED from the
 * canonical runtime state: the compiled tag definitions, the live tag values,
 * the alarm list, the quality map. Nothing here keeps state of its own, and
 * nothing computes a second opinion — equipment state comes from
 * `sim/state.ts`, alarm priority from `sim/alarms.ts`, quality from
 * `sim/quality.ts`, units and ranges from the compiled `TagDef`.
 *
 * That matters because an overview whose "3 running" disagreed with the
 * mimic's pumps would be worse than no overview at all.
 */

import type { TagDef, Measures } from '../sim/tags'
import type { Tags } from '../sim/engine'
import type { AlarmPriority, AlarmRecord } from '../sim/alarms'
import type { QualityState } from '../sim/quality'
import type { EquipState } from '../sim/state'
import { equipmentState } from '../sim/state'
import type { HmiScreen } from '../model'
import { expandLetters } from '../../isa/tag'

// ── Alarms ──────────────────────────────────────────────────────────────────

export interface AlarmCounts {
  /** Standing: annunciating right now, suppressed and pending excluded. */
  active: number
  unacked: number
  high: number
  medium: number
  low: number
  /** Not annunciating, and why — shelved, out of service, by design. */
  suppressed: number
  worst?: AlarmPriority
}

const PRIORITY_RANK: Record<AlarmPriority, number> = { high: 0, medium: 1, low: 2 }

/** What is annunciating: the one definition every page counts from. */
export const standingAlarms = (alarms: AlarmRecord[]): AlarmRecord[] =>
  alarms.filter((a) => !a.sup && a.phase !== 'pending')

export function alarmCounts(alarms: AlarmRecord[]): AlarmCounts {
  const standing = standingAlarms(alarms)
  const by = (p: AlarmPriority) => standing.filter((a) => a.priority === p).length
  let worst: AlarmPriority | undefined
  for (const a of standing) {
    if (!worst || PRIORITY_RANK[a.priority] < PRIORITY_RANK[worst]) worst = a.priority
  }
  return {
    active: standing.length,
    unacked: standing.filter((a) => a.phase !== 'acked').length,
    high: by('high'),
    medium: by('medium'),
    low: by('low'),
    suppressed: alarms.filter((a) => a.sup !== undefined).length,
    ...(worst ? { worst } : {}),
  }
}

/** The operator-facing state of one alarm row, folding suppression in. */
export type AlarmViewState = 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED' | 'SHELVED' | 'OUT OF SERVICE' | 'SUPPRESSED' | 'PENDING'

export function alarmViewState(a: AlarmRecord): AlarmViewState {
  if (a.sup === 'shelved') return 'SHELVED'
  if (a.sup === 'oos') return 'OUT OF SERVICE'
  if (a.sup === 'design') return 'SUPPRESSED'
  if (a.phase === 'pending') return 'PENDING'
  if (a.phase === 'acked') return 'ACKNOWLEDGED'
  if (a.phase === 'cleared') return 'CLEARED'
  return 'ACTIVE'
}

// ── Equipment ───────────────────────────────────────────────────────────────

export type EquipKind = 'drive' | 'valve' | 'vessel'

export interface EquipRow {
  tag: string
  kind: EquipKind
  /** ISA expansion where the tag has one; otherwise the plain kind. */
  description: string
  /** Drives only — the canonical machine from sim/state.ts. */
  state?: EquipState
  /** Valves: per cent open. Vessels: per cent full. */
  value?: number
  unit?: string
  /** Live flow through this device, m³/h, where the network gives one. */
  flow?: number
  alarm?: AlarmPriority
}

/**
 * A description for a tag.
 *
 * The ISA-5.1 letter expansion applies to INSTRUMENTS and nothing else. An
 * equipment tag is not an ISA function code: `TK-101` is a tank, and expanding
 * its letters produces "Temperature Control Station", which is both wrong and
 * confidently so. This is the same collision that made a temperature
 * controller take its PV from a vessel's level in the physics work — the
 * letters of an equipment tag mean nothing to ISA-5.1.
 *
 * So callers say whether the tag is an instrument. When it is not, the kind
 * word is the honest answer.
 */
function describe(tag: string, fallback: string, isInstrument = false): string {
  if (!isInstrument) return fallback
  const letters = /^([A-Za-z]+)/.exec(tag)?.[1]?.toUpperCase()
  if (!letters) return fallback
  try {
    const words = expandLetters(letters)
    if (words && !/unknown|invalid/i.test(words)) return words
  } catch { /* not a readable ISA tag — the fallback is the honest answer */ }
  return fallback
}

const KIND_WORD: Record<EquipKind, string> = {
  drive: 'Pump / driver', valve: 'Valve', vessel: 'Vessel',
}

/**
 * Every physical object the running plant contains, with its live state.
 *
 * Drives take their state from `equipmentState()` and nowhere else — the whole
 * reason that machine exists is that the mimic, the faceplate and this page
 * must never disagree about whether a pump is running.
 */
export function equipmentRows(
  defs: Record<string, TagDef>,
  tags: Tags,
  opts: { oos?: Record<string, true>; alarms?: AlarmRecord[]; flows?: Record<string, number> } = {},
): EquipRow[] {
  const worst = worstByTag(opts.alarms ?? [])
  const out: EquipRow[] = []
  for (const d of Object.values(defs)) {
    const t = tags[d.name]
    const alarm = worst.get(d.name)
    const flow = opts.flows?.[d.name]
    if (d.kind === 'motor') {
      out.push({
        tag: d.name, kind: 'drive', description: KIND_WORD.drive,
        state: equipmentState(t, { oos: opts.oos?.[d.name] === true }),
        ...(flow !== undefined ? { flow } : {}),
        ...(alarm ? { alarm } : {}),
      })
    } else if (d.kind === 'valve' || d.kind === 'valveOnOff') {
      const pct = d.kind === 'valve' ? (t?.POS ?? t?.OP) : ((t?.OPEN ?? 0) >= 0.5 ? 100 : 0)
      out.push({
        tag: d.name, kind: 'valve', description: KIND_WORD.valve,
        ...(pct !== undefined ? { value: pct, unit: '%' } : {}),
        ...(flow !== undefined ? { flow } : {}),
        ...(alarm ? { alarm } : {}),
      })
    } else if (d.kind === 'tank') {
      out.push({
        tag: d.name, kind: 'vessel', description: KIND_WORD.vessel,
        ...(t?.PV !== undefined ? { value: t.PV, unit: d.unit ?? '%' } : {}),
        ...(alarm ? { alarm } : {}),
      })
    }
  }
  return out.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }))
}

export interface EquipCounts { total: number; running: number; stopped: number; faulted: number }

/** Counts over DRIVES only: a valve is not "running", and counting one as
 *  though it were would make the overview's headline number meaningless. */
export function equipmentCounts(rows: EquipRow[]): EquipCounts {
  const drives = rows.filter((r) => r.kind === 'drive')
  return {
    total: drives.length,
    running: drives.filter((r) => r.state === 'running' || r.state === 'starting' || r.state === 'stopping').length,
    stopped: drives.filter((r) => r.state === 'stopped' || r.state === 'disabled').length,
    faulted: drives.filter((r) => r.state === 'tripped').length,
  }
}

// ── Process values ──────────────────────────────────────────────────────────

export interface MeasurementRow {
  tag: string
  description: string
  measures?: Measures
  pv?: number
  unit?: string
  min: number
  max: number
  quality?: QualityState
  alarm?: AlarmPriority
  /** What is producing this value, in operator language. */
  source: 'SIMULATION' | 'FORCED' | 'NO MODEL' | 'NO PRODUCER'
}

/** The worst standing alarm on each tag. */
export function worstByTag(alarms: AlarmRecord[]): Map<string, AlarmPriority> {
  const out = new Map<string, AlarmPriority>()
  for (const a of standingAlarms(alarms)) {
    const cur = out.get(a.tag)
    if (!cur || PRIORITY_RANK[a.priority] < PRIORITY_RANK[cur]) out.set(a.tag, a.priority)
  }
  return out
}

/**
 * Every measurement the plant produces, with what it is reading and how far
 * that can be trusted.
 *
 * `source` is deliberately blunt. Everything here is simulated and says so;
 * what an operator actually needs to separate out is a value somebody has
 * FORCED, a tag with nothing producing it, and a measurement that has no
 * process model behind it at all — which `sim/quality.ts` already knows.
 */
export function measurementRows(
  defs: Record<string, TagDef>,
  tags: Tags,
  opts: { quality?: Record<string, QualityState>; alarms?: AlarmRecord[] } = {},
): MeasurementRow[] {
  const worst = worstByTag(opts.alarms ?? [])
  const out: MeasurementRow[] = []
  for (const d of Object.values(defs)) {
    if (d.kind !== 'display' && d.kind !== 'controller' && d.kind !== 'tank') continue
    const t = tags[d.name]
    const q = opts.quality?.[d.name]
    const source: MeasurementRow['source'] =
      t === undefined ? 'NO PRODUCER'
      : q?.q === 'forced' ? 'FORCED'
      : d.kind === 'display' && d.bindTank === undefined && d.bindPipe === undefined ? 'NO MODEL'
      : 'SIMULATION'
    out.push({
      tag: d.name,
      description: describe(d.name, d.kind === 'tank' ? 'Vessel' : 'Measurement', d.kind !== 'tank'),
      ...(d.measures ? { measures: d.measures } : {}),
      ...(t?.PV !== undefined ? { pv: t.PV } : {}),
      ...(d.unit ? { unit: d.unit } : {}),
      min: d.min,
      max: d.max,
      ...(q ? { quality: q } : {}),
      ...(worst.get(d.name) ? { alarm: worst.get(d.name)! } : {}),
      source,
    })
  }
  return out.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }))
}

/** Key values grouped by the quantity they measure. Quantities nothing
 *  measures are ABSENT, never shown as a dash — the overview must not imply
 *  the plant has a pressure reading when it has none. */
export function kpisByQuantity(rows: MeasurementRow[]): { measures: Measures; rows: MeasurementRow[] }[] {
  const order: Measures[] = ['level', 'flow', 'pressure', 'temperature']
  const out: { measures: Measures; rows: MeasurementRow[] }[] = []
  for (const m of order) {
    const group = rows.filter((r) => r.measures === m && r.pv !== undefined)
    if (group.length > 0) out.push({ measures: m, rows: group })
  }
  return out
}

// ── Plant status ────────────────────────────────────────────────────────────

export type ProcessStatus = 'stopped' | 'running' | 'attention' | 'alarm'

export const PROCESS_STATUS_WORD: Record<ProcessStatus, string> = {
  stopped: 'STOPPED', running: 'RUNNING', attention: 'ATTENTION', alarm: 'ALARM',
}

/**
 * The single headline an operator reads first.
 *
 * Worst-first, and a tripped drive counts as an alarm condition whether or not
 * its TRIP alarm has been acknowledged — the plant is still in that state.
 */
export function processStatus(counts: AlarmCounts, equip: EquipCounts): ProcessStatus {
  if (counts.high > 0 || equip.faulted > 0) return 'alarm'
  if (counts.active > 0) return 'attention'
  return equip.running > 0 ? 'running' : 'stopped'
}

// ── Areas ───────────────────────────────────────────────────────────────────

export interface AreaRow {
  screenId: string
  name: string
  /** Tags this screen actually shows. */
  tags: string[]
  running: number
  faulted: number
  alarms: number
  worst?: AlarmPriority
}

/** One row per HMI screen: what it contains and whether it needs attention.
 *  This is what turns "something is wrong" into "and it is over there". */
export function areaRows(
  screens: HmiScreen[],
  defs: Record<string, TagDef>,
  tags: Tags,
  alarms: AlarmRecord[],
  oos?: Record<string, true>,
): AreaRow[] {
  const standing = standingAlarms(alarms)
  return screens.map((sc) => {
    const onScreen = [...new Set(sc.widgets.map((w) => w.tag).filter((t): t is string => t !== undefined))]
    const rows = equipmentRows(
      Object.fromEntries(onScreen.filter((t) => defs[t]).map((t) => [t, defs[t]!])),
      tags,
      { ...(oos ? { oos } : {}) },
    )
    const counts = equipmentCounts(rows)
    const mine = standing.filter((a) => onScreen.includes(a.tag))
    let worst: AlarmPriority | undefined
    for (const a of mine) {
      if (!worst || PRIORITY_RANK[a.priority] < PRIORITY_RANK[worst]) worst = a.priority
    }
    return {
      screenId: sc.id,
      name: sc.name,
      tags: onScreen,
      running: counts.running,
      faulted: counts.faulted,
      alarms: mine.length,
      ...(worst ? { worst } : {}),
    }
  })
}

// ── Trend signals ───────────────────────────────────────────────────────────

export interface SignalOption {
  ref: string
  tag: string
  signal: string
  description: string
  unit?: string
  group: 'PROCESS' | 'CONTROL'
}

/**
 * Every signal the operator may trend, from the compiled model only.
 *
 * No invented tags: a controller contributes PV, SP and OP because the runtime
 * genuinely records those three, and a measurement contributes its PV. A
 * controller output is per cent whatever its PV measures, which is the model's
 * definition of OP rather than a guess made in the selector.
 */
export function trendSignals(defs: Record<string, TagDef>): SignalOption[] {
  const out: SignalOption[] = []
  for (const d of Object.values(defs)) {
    if (d.kind === 'controller') {
      const description = describe(d.name, 'Controller', true)
      out.push({ ref: `${d.name}.PV`, tag: d.name, signal: 'PV', description, ...(d.unit ? { unit: d.unit } : {}), group: 'CONTROL' })
      out.push({ ref: `${d.name}.SP`, tag: d.name, signal: 'SP', description, ...(d.unit ? { unit: d.unit } : {}), group: 'CONTROL' })
      out.push({ ref: `${d.name}.OP`, tag: d.name, signal: 'OP', description, unit: '%', group: 'CONTROL' })
    } else if (d.kind === 'display' || d.kind === 'tank') {
      out.push({
        ref: `${d.name}.PV`, tag: d.name, signal: 'PV',
        description: describe(d.name, d.kind === 'tank' ? 'Vessel' : 'Measurement', d.kind !== 'tank'),
        ...(d.unit ? { unit: d.unit } : {}),
        group: 'PROCESS',
      })
    }
  }
  return out.sort((a, b) =>
    a.group === b.group ? a.ref.localeCompare(b.ref, undefined, { numeric: true }) : a.group === 'PROCESS' ? -1 : 1)
}
