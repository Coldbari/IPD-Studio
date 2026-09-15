// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiScreen, HmiWidget } from '../model'
import type { Registry } from '../../model/registry'
import { engineeringFor } from '../../model/signalData'
import { processFor } from '../../model/processData'
import { DEFAULTS, UNITS } from './units'

export type TagKind = 'tank' | 'motor' | 'valve' | 'valveOnOff' | 'display' | 'controller'

/**
 * WHAT a tag measures — the physical quantity, not the instrument.
 *
 * Read off the ISA-5.1 first letter of the tag, which is exactly what that
 * letter is for: `LT-101` measures level, `PT-101` pressure, `FT-101` flow,
 * `TT-101` temperature. It decides which process variable a bound transmitter
 * reads, which default range and unit the tag gets, and which controller
 * tuning applies — so the ISA convention the drawing already follows is doing
 * real work rather than decorating a label.
 */
export type Measures = 'level' | 'flow' | 'pressure' | 'temperature'

/** ISA-5.1 first letters this simulation has a process model for. */
const MEASURED_BY_LETTER: Record<string, Measures> = {
  L: 'level', F: 'flow', P: 'pressure', T: 'temperature',
}

/** Unit and default span per quantity. A pressure tag nobody has specified
 *  gets 0-10 bar, not the 0-100 % that every tag used to inherit. */
const MEASURE_DEFAULTS: Record<Measures, { unit: string; min: number; max: number }> = {
  level: { unit: UNITS.level, min: 0, max: 100 },
  flow: { unit: UNITS.flow, min: 0, max: 100 },
  pressure: { unit: UNITS.pressure, min: 0, max: 10 },
  temperature: { unit: UNITS.temperature, min: 0, max: 150 },
}

/** Equipment that adds HEAT rather than head. Kept beside the motor kinds it
 *  is carved out of: a fired heater is a driven device the operator starts and
 *  stops, but it must never be treated as a pump by the flow network. */
export const HEATER_SYMBOLS = new Set(['heater.fired', 'heater.electric', 'boiler'])

/** What a tag measures, from its ISA letter — with the stated unit as a
 *  fallback for hand-built screens whose tags follow no convention. */
export function measuresOf(tag: string, unit: string | undefined): Measures | undefined {
  const byLetter = MEASURED_BY_LETTER[tag[0]?.toUpperCase() ?? '']
  if (byLetter) return byLetter
  const u = unit?.trim().toLowerCase()
  if (u === 'bar' || u === 'barg' || u === 'kpa' || u === 'psi') return 'pressure'
  if (u === '°c' || u === 'degc' || u === '°f') return 'temperature'
  if (u === 'm³/h' || u === 'm3/h' || u === 'l/s') return 'flow'
  return undefined
}

export interface TagDef {
  name: string
  kind: TagKind
  unit?: string
  min: number
  max: number
  limits?: { LL?: number; L?: number; H?: number; HH?: number }
  /** Alarm quality knobs (ISA-18.2): hysteresis width, on-delay seconds,
   *  and the H/L priority override (HH/LL ride one step above it). */
  deadband?: number
  alarmDelay?: number
  priority?: 'high' | 'medium' | 'low'
  /** The physical quantity this tag carries. Undefined for equipment states
   *  (a motor's RUN) and for instruments whose letters name nothing this
   *  simulation models. */
  measures?: Measures
  /** Vessel capacity in m³ (UNITS.volume). NEVER derived from widget
   *  geometry — see model/processData.ts for why that mattered. */
  capacity?: number
  /** True when nothing stated a capacity and `DEFAULTS.tankVolumeM3` was
   *  used. Surfaced by the `tank-capacity-defaulted` check rather than
   *  silently assumed. */
  capacityDefaulted?: boolean
  level0?: number
  /** Vessel contents temperature at RUN start, °C. */
  temp0?: number
  /** Pump: rated flow m³/h and shutoff head bar at rated speed. */
  ratedFlow?: number
  head?: number
  /** Heater duty kW. Its PRESENCE is what marks a driven tag as a heater
   *  rather than a pump, so the flow network never treats it as a driver. */
  heaterKw?: number
  bindTank?: string
  bindPipe?: string
  base?: number
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const prio = (v: unknown): 'high' | 'medium' | 'low' | undefined =>
  v === 'high' || v === 'medium' || v === 'low' ? v : undefined

/**
 * RESOLUTION ORDER — one rule, applied to every engineering value below.
 *
 *   1. the engineering registry   — the source of truth
 *   2. the legacy widget prop     — compatibility only, for drawings authored
 *                                   before the registry owned this
 *   3. the simulation default     — when nobody has said anything at all
 *
 * The registry is never overridden by a widget: an operator screen must not be
 * able to contradict the engineering record. Step 2 exists so that projects
 * built before this change keep running exactly as they did, and it disappears
 * for a tag the moment its record states a value.
 *
 * Step 3 values are NOT engineering data. They keep a demo screen moving, and
 * `model/signalData.ts` is careful never to let them reach a record.
 */
function pick<T>(fromRegistry: T | undefined, fromWidget: T | undefined, simDefault: T): T {
  return fromRegistry ?? fromWidget ?? simDefault
}

function defFor(w: HmiWidget, registry: Registry | undefined): TagDef | null {
  if (!w.tag) return null
  const p = w.props ?? {}
  const eng = engineeringFor(registry, w.tag)
  const proc = processFor(registry, w.tag)
  const lim = eng.limits
  switch (w.type) {
    case 'tank': {
      // CAPACITY IS ENGINEERING DATA. It used to default to `(w.w * w.h) / 40`
      // — the widget's pixel area — so resizing a vessel on screen changed how
      // fast it filled. It now comes from the record, then a legacy widget
      // prop, then a stated default that the QA report discloses.
      const capacity = pick(proc.volumeM3, num(p.capacity), DEFAULTS.tankVolumeM3)
      return {
        // A tank widget reads percent full: that is what the simulator models,
        // not a claim about the instrument, so it stays fixed here.
        name: w.tag, kind: 'tank', measures: 'level', unit: eng.units ?? UNITS.level, min: 0, max: 100,
        capacity,
        capacityDefaulted: proc.volumeM3 === undefined && num(p.capacity) === undefined,
        temp0: proc.operatingTempC ?? DEFAULTS.ambientC,
        level0: num(p.level0) ?? 40,
        limits: {
          LL: pick(lim.LL, num(p.LL), 5),
          L: pick(lim.L, num(p.L), 10),
          H: pick(lim.H, num(p.H), 90),
          HH: pick(lim.HH, num(p.HH), 95),
        },
        deadband: num(p.deadband), alarmDelay: num(p.alarmDelay),
        priority: eng.priority ?? prio(p.priority),
      }
    }
    case 'pump':
    case 'equip': {
      const symbolId = typeof p.symbolId === 'string' ? p.symbolId : ''
      // A heater is a driven device an operator starts and stops, but it adds
      // HEAT, not head. Marking it here keeps that distinction in one place.
      if (w.type === 'equip' && HEATER_SYMBOLS.has(symbolId)) {
        return {
          name: w.tag, kind: 'motor', min: 0, max: 1,
          heaterKw: proc.powerKw ?? DEFAULTS.heaterKw,
        }
      }
      return {
        name: w.tag, kind: 'motor', min: 0, max: 1,
        ratedFlow: proc.ratedFlowM3h ?? DEFAULTS.pumpFlowM3h,
        head: proc.headBar ?? DEFAULTS.pumpHeadBar,
      }
    }
    case 'valve':
      return { name: w.tag, kind: p.throttle === true ? 'valve' : 'valveOnOff', min: 0, max: 100 }
    case 'display':
    case 'gauge':
    case 'bar':
    case 'trend': {
      const fromWidget = [p.LL, p.L, p.H, p.HH].some((v) => num(v) !== undefined)
      const fromRegistry = [lim.LL, lim.L, lim.H, lim.HH].some((v) => v !== undefined)
      // Still no invented limits for these: with nothing stated anywhere the
      // tag simply has no alarms, which is the honest answer.
      const limits = fromRegistry || fromWidget
        ? { LL: lim.LL ?? num(p.LL), L: lim.L ?? num(p.L), H: lim.H ?? num(p.H), HH: lim.HH ?? num(p.HH) }
        : undefined
      const statedUnit = eng.units ?? (typeof p.unit === 'string' ? p.unit : undefined)
      // ISA-5.1 decides the quantity; the quantity decides the default unit and
      // span. A PT that nobody has ranged is 0-10 bar, not 0-100 of nothing.
      const measures = measuresOf(w.tag, statedUnit)
      const md = measures ? MEASURE_DEFAULTS[measures] : undefined
      return {
        name: w.tag, kind: p.controller === true ? 'controller' : 'display',
        measures,
        unit: statedUnit ?? md?.unit,
        min: pick(eng.min, num(p.min), md?.min ?? 0),
        max: pick(eng.max, num(p.max), md?.max ?? 100),
        limits,
        deadband: num(p.deadband), alarmDelay: num(p.alarmDelay),
        priority: eng.priority ?? prio(p.priority),
        bindTank: typeof p.bindTank === 'string' ? p.bindTank : undefined,
        bindPipe: typeof p.bindPipe === 'string' ? p.bindPipe : undefined,
        base: num(p.base),
      }
    }
    default:
      return null
  }
}

/**
 * Index TagDefs by tag name.
 *
 * This is what makes the RENDER path read the same engineering values the
 * simulation does. `buildTagDefs` already applies the documented resolution
 * order (registry -> legacy widget prop -> simulation default); before this
 * map existed, every widget and the faceplate resolved `widget.props` for
 * themselves, so a tag whose record said `0-10 bar` alarmed correctly at 8
 * while its bar graph drew a 0-100 scale with no limit ticks at all.
 *
 * One resolver, one answer. See `widgets/shared.ts` `measureOf`.
 */
export function tagDefMap(defs: TagDef[]): Record<string, TagDef> {
  const out: Record<string, TagDef> = {}
  for (const d of defs) out[d.name] = d
  return out
}

/** One TagDef per distinct widget tag. Physical kinds (tank/motor/valve/
 *  controller) outrank plain displays, so a Trend placed before its Tank
 *  cannot demote the tag to a drifting display. Accepts one screen or the
 *  whole plant (all screens) — tags are global across screens. */
export function buildTagDefs(
  screens: Pick<HmiScreen, 'widgets'> | Pick<HmiScreen, 'widgets'>[],
  registry?: Registry,
): TagDef[] {
  const list = Array.isArray(screens) ? screens : [screens]
  const rank = (k: TagKind) => (k === 'display' ? 1 : 2)
  const out = new Map<string, TagDef>()
  for (const screen of list) {
    for (const w of screen.widgets) {
      const d = defFor(w, registry)
      if (!d) continue
      const existing = out.get(d.name)
      if (!existing || rank(d.kind) > rank(existing.kind)) out.set(d.name, d)
    }
  }
  return [...out.values()]
}
