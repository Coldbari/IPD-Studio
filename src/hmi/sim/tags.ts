// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiScreen, HmiWidget } from '../model'
import type { Registry } from '../../model/registry'
import { engineeringFor } from '../../model/signalData'

export type TagKind = 'tank' | 'motor' | 'valve' | 'valveOnOff' | 'display' | 'controller'

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
  capacity?: number
  level0?: number
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
  const lim = eng.limits
  switch (w.type) {
    case 'tank':
      return {
        // A tank widget reads percent full: that is what the simulator models,
        // not a claim about the instrument, so it stays fixed here.
        name: w.tag, kind: 'tank', unit: eng.units ?? '%', min: 0, max: 100,
        capacity: num(p.capacity) ?? (w.w * w.h) / 40,
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
    case 'pump':
    case 'equip':
      return { name: w.tag, kind: 'motor', min: 0, max: 1 }
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
      return {
        name: w.tag, kind: p.controller === true ? 'controller' : 'display',
        unit: eng.units ?? (typeof p.unit === 'string' ? p.unit : undefined),
        min: pick(eng.min, num(p.min), 0),
        max: pick(eng.max, num(p.max), 100),
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
