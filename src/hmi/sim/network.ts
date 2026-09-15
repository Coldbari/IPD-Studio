// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiPipe, HmiScreen, HmiWidget } from '../model'
import { HEATER_SYMBOLS } from './tags'

export type EndRef = { kind: 'source' } | { kind: 'sink' } | { kind: 'tank'; tag: string }

/** One flow PATH from a source terminal to a sink/tank terminal. Fan-out at a
 *  pump or junction yields one branch per downstream leg; the shared pump's
 *  rating is split across them by conductance in solveFlows. */
export interface Branch {
  id: string
  from: EndRef
  to: EndRef
  /** For tank-sourced branches: does the pipe leave the tank's bottom half?
   *  Only bottom connections gravity-drain; a top (vent/relief/overflow)
   *  line must not siphon the liquid out. */
  fromBottom?: boolean
  pumps: string[]
  /** Driven equipment on the path that adds HEAT rather than head — a fired
   *  or electric heater, a boiler. Kept apart from `pumps` because the flow
   *  solver must never treat one as a driver: before this split, dropping a
   *  heater into a line made it pump. */
  heaters: string[]
  valves: string[]
  pipeIds: string[]
  /** Index into `pipeIds` of the first pipe whose head is a pump — the point
   *  where suction becomes discharge. Absent on an unpumped branch. Used only
   *  by the pressure profile in sim/process.ts. */
  pumpIndex?: number
  /** Index into `pipeIds` of the first pipe whose head is a throttling
   *  element — where the high side becomes the low side. Absent when the path
   *  has no valve. */
  valveIndex?: number
  /** Every inline device on the path, IN ORDER.
   *
   *  `pumps`, `heaters` and `valves` are the sets the solver needs and say
   *  nothing about sequence. This is the same information arranged the way a
   *  reader needs it — source, then what the fluid passes through, then the
   *  destination — and it is what the overview flowsheet draws. Metadata only:
   *  no solver reads it, so flow behaviour is untouched. */
  devices: { tag: string; kind: 'pump' | 'heater' | 'valve'; at: number }[]
}

export interface FlowNetwork { branches: Branch[] }

/** A pipe endpoint attaches to a widget when it lies within the widget rect inflated by this. */
const ATTACH = 14
/** Runaway guards for pathological drawings. */
const MAX_PATH = 32
const MAX_BRANCHES = 128

const isSolid = (w: HmiWidget): boolean =>
  w.type === 'tank' || w.type === 'pump' || w.type === 'valve' || w.type === 'symbol' || w.type === 'equip'

/** Nearest solid widget within ATTACH of the point. A point INSIDE a rect is
 *  distance 0, so exact containment always beats an inflated near-miss —
 *  imports pack valves against vessels, and topmost-hit picked the wrong one. */
function widgetAt(screen: HmiScreen, p: { x: number; y: number }): HmiWidget | null {
  let best: HmiWidget | null = null
  let bestD = Infinity
  for (let i = screen.widgets.length - 1; i >= 0; i--) {
    const w = screen.widgets[i]!
    if (!isSolid(w)) continue
    const dx = Math.max(w.x - p.x, 0, p.x - (w.x + w.w))
    const dy = Math.max(w.y - p.y, 0, p.y - (w.y + w.h))
    if (dx > ATTACH || dy > ATTACH) continue
    const d = Math.hypot(dx, dy)
    if (d < bestD) { best = w; bestD = d }
  }
  return best
}

/** Anchored end (import truth) first; geometry as the fallback. */
function endWidget(screen: HmiScreen, byId: Map<string, HmiWidget>, anchor: string | undefined, p: { x: number; y: number }): HmiWidget | null {
  if (anchor !== undefined) {
    const w = byId.get(anchor)
    if (w && isSolid(w)) return w
  }
  return widgetAt(screen, p)
}

export function buildNetwork(screen: HmiScreen): FlowNetwork {
  const heads = new Map<string, HmiPipe[]>() // widget id -> pipes leaving it
  const ends = new Map<HmiPipe, { a: HmiWidget | null; b: HmiWidget | null }>()
  const hasInflow = new Set<string>()
  const byId = new Map(screen.widgets.map((w) => [w.id, w]))
  for (const p of screen.pipes) {
    if (p.points.length < 2) continue
    const a = endWidget(screen, byId, p.aId, p.points[0]!)
    const b = endWidget(screen, byId, p.bId, p.points[p.points.length - 1]!)
    ends.set(p, { a, b })
    if (a) heads.set(a.id, [...(heads.get(a.id) ?? []), p])
    if (b) hasInflow.add(b.id)
  }
  const inline = (w: HmiWidget | null): w is HmiWidget =>
    !!w && (w.type === 'pump' || w.type === 'valve' || w.type === 'symbol' || w.type === 'equip')

  const branches: Branch[] = []
  let n = 0

  const emit = (path: HmiPipe[], from: EndRef, fromBottom: boolean | undefined, to: EndRef) => {
    if (branches.length >= MAX_BRANCHES) return
    const branch: Branch = {
      id: `B${++n}`, from, to,
      ...(fromBottom !== undefined ? { fromBottom } : {}),
      pumps: [], heaters: [], valves: [], devices: [], pipeIds: path.map((p) => p.id),
    }
    // inline devices sit at the head of every pipe after the first (and at
    // the first pipe's head for a dangling chain start)
    path.forEach((p, i) => {
      const w = ends.get(p)!.a
      if (i === 0 && !inline(w)) return
      if (!w) return
      if ((w.type === 'pump' || w.type === 'equip') && w.tag) {
        const symbolId = typeof w.props?.symbolId === 'string' ? w.props.symbolId : ''
        if (w.type === 'equip' && HEATER_SYMBOLS.has(symbolId)) {
          branch.heaters.push(w.tag)
          branch.devices.push({ tag: w.tag, kind: 'heater', at: i })
        } else {
          branch.pumps.push(w.tag)
          branch.devices.push({ tag: w.tag, kind: 'pump', at: i })
          if (branch.pumpIndex === undefined) branch.pumpIndex = i
        }
      }
      if (w.type === 'valve' && w.tag) {
        branch.valves.push(w.tag)
        branch.devices.push({ tag: w.tag, kind: 'valve', at: i })
        if (branch.valveIndex === undefined) branch.valveIndex = i
      }
    })
    branches.push(branch)
  }

  const walk = (cur: HmiPipe, path: HmiPipe[], from: EndRef, fromBottom: boolean | undefined) => {
    if (path.includes(cur) || path.length >= MAX_PATH || branches.length >= MAX_BRANCHES) return
    const next = [...path, cur]
    const tail = ends.get(cur)!.b
    if (!tail) return emit(next, from, fromBottom, { kind: 'sink' })
    if (tail.type === 'tank' && tail.tag) return emit(next, from, fromBottom, { kind: 'tank', tag: tail.tag })
    // inline device: continue down EVERY outgoing pipe — this is the fan-out
    // the v1 chain walker dropped (its global used-set ate sibling legs)
    const outs = (heads.get(tail.id) ?? []).filter((q) => !next.includes(q))
    if (outs.length === 0) return emit(next, from, fromBottom, { kind: 'sink' })
    for (const q of outs) walk(q, next, from, fromBottom)
  }

  for (const p of screen.pipes) {
    if (!ends.has(p)) continue
    const { a } = ends.get(p)!
    // roots: free ends, tanks, or a dangling inline head nothing flows into
    if (inline(a) && hasInflow.has(a.id)) continue
    const fromTank = !!a && a.type === 'tank' && a.tag !== undefined
    const from: EndRef = fromTank ? { kind: 'tank', tag: a.tag! } : { kind: 'source' }
    const fromBottom = fromTank ? p.points[0]!.y > a.y + a.h * 0.55 : undefined
    walk(p, [], from, fromBottom)
  }
  return { branches }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Flow per branch. Conductance = product of valve fractions (× any pipe
 * factors, e.g. a plugged line); a pump's rating splits across the branches
 * that share it, proportional to conductance — an honest approximation, not
 * a pressure solve, and documented as such. Gravity branches don't split.
 */
export function solveFlows(
  net: FlowNetwork,
  frac: (valveTag: string) => number,
  pumpOn: (pumpTag: string) => number,
  tankLevel: (tag: string) => number,
  pipeFactor: ((pipeId: string) => number) | undefined,
  /** `rated` is the pump's RATED FLOW in m³/h (UNITS.flow) — a function when
   *  pumps differ, which they do once duties come out of the registry, and a
   *  plain number when they do not. `gravity` is the m³/h a gravity or
   *  battery-limit branch delivers through a fully open path. */
  rating: { rated: number | ((pumpTag: string) => number); gravity: number },
): Record<string, number> {
  const ratedOf = typeof rating.rated === 'function' ? rating.rated : () => rating.rated as number
  const g: Record<string, number> = {}
  const driver: Record<string, number> = {}
  for (const b of net.branches) {
    let cond = 1
    for (const v of b.valves) cond *= clamp01(frac(v))
    if (pipeFactor) for (const id of b.pipeIds) cond *= clamp01(pipeFactor(id))
    if (b.from.kind === 'tank' && tankLevel(b.from.tag) <= 0.5) cond = 0
    if (b.to.kind === 'tank' && tankLevel(b.to.tag) >= 99.5) cond = 0
    g[b.id] = cond
    if (b.pumps.length > 0) {
      // calm-start doctrine holds: every pump on the path must be driving
      const ramp = Math.min(...b.pumps.map((p) => clamp01(pumpOn(p))))
      // series pumps: the weakest rating sets what the path can carry
      const rated = Math.min(...b.pumps.map((p) => ratedOf(p)))
      driver[b.id] = ramp > 0 ? rated * ramp : 0
    } else if (b.from.kind === 'tank') {
      const uncontrollableStub = b.to.kind === 'sink' && b.valves.length === 0
      driver[b.id] = b.fromBottom && !uncontrollableStub ? rating.gravity : 0
    } else if (b.from.kind === 'source' && b.valves.length > 0) {
      // a free end feeding THROUGH a hand valve is a battery-limit/supply
      // header: opening the valve draws on it. Calm start still holds — the
      // valve comes up closed, so nothing moves until an operator acts.
      driver[b.id] = rating.gravity
    } else {
      driver[b.id] = 0 // valveless free-end stubs stay passive
    }
  }

  const byPump = new Map<string, string[]>()
  for (const b of net.branches) for (const p of b.pumps) byPump.set(p, [...(byPump.get(p) ?? []), b.id])

  const flows: Record<string, number> = {}
  for (const b of net.branches) {
    const cond = g[b.id]!
    const drive = driver[b.id]!
    if (cond === 0 || drive === 0) { flows[b.id] = 0; continue }
    if (b.pumps.length === 0) { flows[b.id] = drive * cond; continue }
    let f = Infinity
    for (const p of b.pumps) {
      // max(1, Σg): a single restricted leg still feels its valve (drive × g,
      // the v1 behavior); only genuinely competing open legs split the rating
      const total = Math.max(1, byPump.get(p)!.reduce((s, id) => s + g[id]!, 0))
      f = Math.min(f, drive * (cond / total))
    }
    flows[b.id] = f
  }
  return flows
}

/** Expand per-branch flows to per-pipe flows for the canvas animation.
 *  Branches share header pipes, so flows SUM. */
export function pipeFlowMap(net: FlowNetwork, branchFlows: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of net.branches) for (const id of b.pipeIds) out[id] = (out[id] ?? 0) + (branchFlows[b.id] ?? 0)
  return out
}
