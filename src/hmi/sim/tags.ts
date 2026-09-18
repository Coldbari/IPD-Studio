// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiScreen, HmiWidget } from '../model'
import type { Registry } from '../../model/registry'
import { engineeringFor } from '../../model/signalData'
import { processFor } from '../../model/processData'
import type { MinFlowAlarmPolicy } from '../../model/processData'
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

/**
 * Symbols that are a BATTERY LIMIT — the edge of the drawing, held at a stated
 * pressure. One entry today; a set because a project may draw a tie-in, an
 * off-page continuation and a utility connection with different symbols and
 * mean the same thing by all three.
 */
export const TERMINAL_SYMBOLS = new Set(['bl.terminal'])

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
  /**
   * K21: the fastest THIS controller's output may move, %/s
   * (`signal.outputRateLimit`).
   *
   * A CONTROL-layer constraint on the command, and not the actuator's own
   * dynamics — K12's drive ramp and a valve's stroke rate are what the
   * hardware does with a command, and both still apply underneath this.
   * Absent means no limit is configured and the output moves as the algorithm
   * asks, exactly as it did before K21.
   */
  outputRateLimitPctPerS?: number
  /**
   * K23: the SETPOINT range this loop may be operated over, in this tag's own
   * unit (`signal.spLow` / `signal.spHigh`).
   *
   * NOT `min`/`max` above, which are the CALIBRATED RANGE — what the
   * instrument can measure. These are what the controller may be ASKED for,
   * and nothing in this model infers either from the other. Absent on a side
   * means no engineering limit there.
   */
  spLow?: number
  spHigh?: number
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
  /**
   * Vessel vapour-space pressure, bar ABSOLUTE, from the engineering record's
   * `design.operatingPressure`.
   *
   * Absent means VENTED — the vessel sits at atmosphere. Absent is the normal
   * case and is not a gap: most drawings carry vessels nobody has specified an
   * operating pressure for, and a vented tank is the right reading of silence.
   * Never taken from `design.pressure`, which is a RATING and would put a
   * vessel's vapour space at its relief setting.
   */
  vesselPressureBarA?: number
  /** Pump: rated flow m³/h and shutoff head bar at rated speed. */
  ratedFlow?: number
  head?: number
  /**
   * K31 — the rated head in METRES, present only when the record stated a
   * length rather than a pressure.
   *
   * `head` above is this figure already converted, on the declared legacy
   * basis; this one is the figure BEFORE a density was chosen, and it is what
   * lets the hydraulic solve finish the conversion against the liquid the pump
   * is actually passing. Absent means there is nothing to finish — either the
   * record gave a pressure, or it gave nothing and a default in bar stood in.
   * See `hydraulic/fluidhead.ts` for the contract.
   */
  headM?: number
  /**
   * The driver runs on a VARIABLE SPEED DRIVE, from `duty.vsd`.
   *
   * Absent means fixed-speed, which is every machine drawn before K12: told to
   * run, it goes to rated speed and stays there. A speed command on a machine
   * that has not declared this does NOT quietly switch the behaviour on — it is
   * reported, by `pump-speed-not-supported`.
   */
  vsd?: boolean
  /**
   * The lowest speed the drive may be commanded to, % of rated, from
   * `duty.minSpeed`. Absent means the record states no turndown limit and none
   * is imposed; no figure is invented for it.
   */
  minSpeedPct?: number
  /**
   * Minimum continuous flow, m³/h, from `duty.minFlow`.
   *
   * NEVER DEFAULTED, and that is the whole point of it. `ratedFlow` and `head`
   * above fall back to `DEFAULTS` so an unspecified demo pump still turns; a
   * minimum-flow limit falls back to NOTHING, because a limit nobody stated is
   * not a limit and comparing a solved flow against an invented one would make
   * the resulting diagnostic fiction. Absent means the operating-envelope
   * derivation reports LIMIT UNKNOWN instead of a verdict.
   */
  minFlowM3h?: number
  /**
   * K20: WHETHER AND HOW A BREACH OF THAT MINIMUM IS ANNUNCIATED.
   *
   * Carried beside the limit and never merged with it. Absent means the record
   * states no alarm policy, and then none is manufactured — K13 still detects
   * and K18 still protects, exactly as they did before this field existed.
   * See `model/processData.ts` for why the two are separate decisions.
   */
  minFlowAlarm?: MinFlowAlarmPolicy
  /** Heater duty kW. Its PRESENCE is what marks a driven tag as a heater
   *  rather than a pump, so the flow network never treats it as a driver. */
  heaterKw?: number
  bindTank?: string
  bindPipe?: string
  base?: number
  /**
   * A CONTROLLER'S CONFIGURED SETPOINT, from `signal.setpoint`.
   *
   * The engineering model has read this field since the datasheet work — it is
   * in `SignalEngineering.setpoint` — and until K15 it was dropped at the
   * boundary into the runtime, which is why every controller came up at 50
   * whatever its record said and whatever it measured. Absent means the record
   * states none, and that is what lets `initTags` tell a CONFIGURED setpoint
   * from a DEFAULTED one instead of overwriting both.
   */
  setpoint?: number
  /**
   * CASCADE — the loop this controller's output sets the SETPOINT of, from
   * `signal.cascadeTo`.
   *
   * Declared on the MASTER's record, naming the slave. A cascade is never
   * inferred: two loops sharing a machine is a contention to be reported, not
   * a hierarchy to be guessed at. Absent on every controller drawn before K17.
   */
  cascadeTo?: string
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
  // K17: the slave loop this controller's output sets the setpoint of.
  const cascade = registry?.[w.tag]?.fields?.['signal.cascadeTo']?.trim() || undefined
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
        // stated means CLOSED at that pressure; absent means vented
        ...(proc.operatingPressureBarA !== undefined
          ? { vesselPressureBarA: proc.operatingPressureBarA } : {}),
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
        // K31: carried only when the record actually stated a length. A
        // defaulted head is `DEFAULTS.pumpHeadBar`, which is declared in BAR —
        // nobody stated a head, so there is no head in metres to make
        // fluid-dependent and none is invented.
        ...(proc.headM !== undefined ? { headM: proc.headM } : {}),
        // a DECLARED capability, never a default: a machine whose record says
        // nothing is fixed-speed and behaves exactly as it always has
        ...(proc.vsd === true ? { vsd: true } : {}),
        ...(proc.minSpeedPct !== undefined ? { minSpeedPct: proc.minSpeedPct } : {}),
        // no `?? DEFAULTS…` here, deliberately: see `minFlowM3h`
        ...(proc.minFlowM3h !== undefined ? { minFlowM3h: proc.minFlowM3h } : {}),
        // K20: and the alarm policy for it, if the record states one at all
        ...(proc.minFlowAlarm !== undefined ? { minFlowAlarm: proc.minFlowAlarm } : {}),
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
        // K21: read from the RECORD only. There is no widget prop for it and
        // deliberately so — an output rate limit is engineering data, and the
        // whole reason `model/signalData.ts` exists is that such data stopped
        // living in HMI props.
        ...(eng.outputRateLimitPctPerS !== undefined
          ? { outputRateLimitPctPerS: eng.outputRateLimitPctPerS } : {}),
        // K23: read from the RECORD only, like the rate limit beside it. There
        // is deliberately no widget prop — an operating range is engineering
        // data, and `model/signalData.ts` exists because such data stopped
        // living in HMI props.
        ...(eng.spLow !== undefined ? { spLow: eng.spLow } : {}),
        ...(eng.spHigh !== undefined ? { spHigh: eng.spHigh } : {}),
        bindTank: typeof p.bindTank === 'string' ? p.bindTank : undefined,
        bindPipe: typeof p.bindPipe === 'string' ? p.bindPipe : undefined,
        base: num(p.base),
        // carried ONLY when the record states one; there is no widget prop for
        // a setpoint and no simulator default. See `TagDef.setpoint`.
        ...(eng.setpoint !== undefined ? { setpoint: eng.setpoint } : {}),
        ...(cascade !== undefined ? { cascadeTo: cascade } : {}),
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
