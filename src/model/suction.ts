// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * CAN THE DRAWN SUCTION SUPPLY THE PUMP THAT IS SPECIFIED ON IT?
 *
 * A pump's rated flow comes from the engineering record. The path that has to
 * deliver that flow comes from the P&ID. Nothing checked that the two were
 * compatible, and K3.2 found the consequence: a machine can be specified past
 * what its own suction line can pass, and the only sign was a `cavitating`
 * flag at RUN time on a plant somebody had already drawn and issued.
 *
 * THIS IS NOT AN NPSH CALCULATION, and it must never be described as one.
 *
 *   NPSHa needs the fluid, its vapour pressure at the pumping temperature, its
 *   density and the static lift. NPSHr needs the machine's own NPSH curve.
 *   This model holds NONE of those: one incompressible fluid with no identity,
 *   no temperature on the suction, no elevation beyond a vessel's own liquid
 *   head, and a pump described by two numbers off a datasheet.
 *
 * What it computes instead is a purely hydraulic question, answerable from
 * what the drawing and the record actually contain:
 *
 *     at the pump's RATED FLOW, does the drawn suction path leave any
 *     pressure at all at the suction nozzle?
 *
 * If it does not, the duty is unachievable as drawn — not marginal, not a
 * matter of fluid properties, arithmetically impossible — and that is worth
 * saying before anybody builds it. If it does, this module says nothing,
 * because how much margin is *enough* is exactly the question NPSH answers and
 * this model cannot.
 *
 * ONE SOURCE OF TRUTH. The path is walked over the canonical `ProcessModel` —
 * the same graph the runtime solves — using its own edge resistances and its
 * own constitutive law, `ΔP = R·Q·|Q|`. No second topology is built and no
 * second flow model exists; this asks the existing one a static question.
 *
 * THE RUNTIME COUNTERPART. `SolveResult.cavitating` answers the live version of
 * the same question at whatever the plant is doing now, and K3.2 wired it into
 * data quality (`ProcessFault`). This is the static, as-drawn half: it fires
 * on a drawing nobody has run.
 */

import type { ProjectIndex } from './projectIndex'
import type { ProcessModel, ProcessNode } from '../hmi/sim/hydraulic/model'
import type { TagDef } from '../hmi/sim/tags'
import { buildSimModel } from '../hmi/sim/engine'
import { processFor } from './processData'
import { vesselHeadBar } from '../hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../hmi/sim/units'

/** What the suction side of one machine can do, as drawn. */
export interface SuctionCheck {
  /** The machine's tag. */
  tag: string
  /** Rated flow, m³/h, off the engineering record — or the stated default. */
  ratedFlow: number
  /**
   * True when nothing on the engineering record stated a duty and
   * `DEFAULTS.pumpFlowM3h` was assumed.
   *
   * Read from the registry rather than from the compiled `TagDef`, because a
   * pump's def carries the default silently — unlike a vessel's capacity,
   * which has `capacityDefaulted`. Disclosing assumed pump duties is a known
   * P1 in `docs/HMI-PROGRAM-LOG.md`; until it is done, a finding that judges a
   * duty has to say when it made that duty up.
   */
  ratedDefaulted: boolean
  /**
   * `unsupplied` — the suction reaches no pressure source at all: no boundary,
   *   no vessel. Nothing can arrive, whatever the machine is rated for.
   * `insufficient` — a source exists, but at the rated flow the path needs
   *   more pressure than the source has.
   * `ok` — the path can pass the rated flow. NOT a statement that there is
   *   adequate NPSH; see the header.
   */
  state: 'ok' | 'insufficient' | 'unsupplied'
  /** What feeds the suction, when anything does. */
  source?: { kind: 'boundary' | 'vessel'; tag?: string; levelPct?: number }
  /**
   * Pressure available at that source, bar absolute.
   *
   * THE SAME VALUE THE SOLVER FIXES THAT NODE AT — a vessel's stated operating
   * pressure or a terminal's stated boundary pressure, plus a bottom nozzle's
   * static head. Before K33 this read atmosphere plus the head for every
   * source, so a closed vessel or a pressurised battery limit was checked as
   * if it were vented.
   */
  sourcePressure?: number
  /** Total resistance of the suction path, bar/(m³/h)². */
  resistance?: number
  /** The most the path can pass from `sourcePressure`, m³/h. */
  maxFlow?: number
  /** What is left at the nozzle at the rated flow, bar absolute. Negative
   *  means the path cannot deliver that flow at all. */
  suctionAtRated?: number
}

/**
 * The lowest-resistance route from a node to a pressure SOURCE, and its total
 * resistance. Dijkstra, because a suction header can be reached more than one
 * way and the easiest route is the one that governs.
 *
 * `skipEdge` is the machine itself: a pump must not be allowed to reach a
 * source by looking back through its own casing.
 */
function routeToSource(
  model: ProcessModel, from: string, skipEdge: string,
): { node: string; resistance: number } | undefined {
  const out = new Map<string, { other: string; resistance: number }[]>()
  for (const e of model.edges) {
    if (e.id === skipEdge) continue
    // A pump in the suction path is not a resistance and cannot be treated as
    // one; it is a source of head in its own right, so a route THROUGH another
    // machine is not a route this static check can price. Stop at it.
    if (e.kind === 'pump') continue
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const) {
      if (!out.has(a)) out.set(a, [])
      out.get(a)!.push({ other: b, resistance: e.resistance })
    }
  }
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]))
  const best = new Map<string, number>([[from, 0]])
  const done = new Set<string>()
  for (;;) {
    let cur: string | undefined
    let curR = Infinity
    for (const [n, r] of best) if (!done.has(n) && r < curR) { cur = n; curR = r }
    if (cur === undefined) return undefined
    done.add(cur)
    const node = nodeById.get(cur)
    if (node && cur !== from && (node.kind === 'boundary' || node.kind === 'vessel')) {
      return { node: cur, resistance: curR }
    }
    for (const e of out.get(cur) ?? []) {
      const r = curR + e.resistance
      if (r < (best.get(e.other) ?? Infinity)) best.set(e.other, r)
    }
  }
}

/**
 * THE PRESSURE THIS SOURCE IS HELD AT, bar absolute — K33.
 *
 * The same question `hydraulic/solver.ts` answers when it fixes a boundary
 * node, answered the same way, because a static check that disagreed with the
 * solver about the pressure at the same node would be checking a different
 * plant from the one that will run.
 *
 *   - A VESSEL sits at the operating pressure its record states. Silence means
 *     VENTED, which is atmospheric — the K6 reading of an unspecified vessel,
 *     unchanged here.
 *   - A BOUNDARY sits at `pressureBar`, compiled onto the node from the
 *     terminal's own record in bar absolute. Silence means atmospheric.
 *
 * WHAT IS DELIBERATELY NOT ASKED. The solver also consults `boundaryPressure`,
 * a SCENARIO holding a tagged terminal somewhere else for a run in progress.
 * There is no run here and no scenario: this is the as-drawn question, and a
 * temporary override is not part of the drawing. That is the one respect in
 * which the two differ, and it is a difference in the question rather than in
 * the answer.
 *
 * NO CONVERSION HAPPENS HERE. Both values arrive already absolute —
 * `processData.operatingPressure` did the gauge→absolute step once, on the
 * engineering side — so this only chooses between them and adds the static
 * head the caller computed.
 */
function sourceBaseBar(node: ProcessNode, byName: Map<string, TagDef>): number {
  if (node.kind === 'vessel') {
    return (node.tag ? byName.get(node.tag)?.vesselPressureBarA : undefined)
      ?? DEFAULTS.atmosphericPressureBar
  }
  return node.pressureBar ?? DEFAULTS.atmosphericPressureBar
}

/** Every machine on the drawing, checked. Empty when there are no screens to
 *  compile a process model from. */
export function suctionChecks(ix: ProjectIndex): SuctionCheck[] {
  const screens = ix.doc.hmiScreens ?? []
  if (screens.length === 0) return []
  const sim = buildSimModel(screens, ix.doc.registry)
  const byName = new Map(sim.defs.map((d) => [d.name, d]))
  const nodeById = new Map(sim.hydraulic.nodes.map((n) => [n.id, n]))
  const out: SuctionCheck[] = []

  for (const e of sim.hydraulic.edges) {
    if (e.kind !== 'pump' || !e.tag) continue
    const def = byName.get(e.tag)
    const ratedFlow = def?.ratedFlow ?? DEFAULTS.pumpFlowM3h
    const stated = processFor(ix.doc.registry, e.tag).ratedFlowM3h !== undefined
    const base = { tag: e.tag, ratedFlow, ratedDefaulted: !stated }

    const route = routeToSource(sim.hydraulic, e.from, e.id)
    if (!route) { out.push({ ...base, state: 'unsupplied' }); continue }

    const node = nodeById.get(route.node)!
    const levelPct = node.tag ? byName.get(node.tag)?.level0 ?? 0 : undefined
    // A vessel's bottom nozzle adds the static head of its contents; a top
    // nozzle and a boundary sit at the boundary pressure and nothing more.
    const head = node.kind === 'vessel' && node.liquid ? vesselHeadBar(levelPct ?? 0) : 0
    const sourcePressure = sourceBaseBar(node, byName) + head
    const source = node.kind === 'vessel'
      ? { kind: 'vessel' as const, ...(node.tag ? { tag: node.tag } : {}), ...(levelPct !== undefined ? { levelPct } : {}) }
      : { kind: 'boundary' as const }

    // The model's own law, rearranged. `R·Q²` is the pressure the path eats at
    // flow Q, so `√(P/R)` is the most it can pass from the pressure available.
    const maxFlow = route.resistance > 0 ? Math.sqrt(sourcePressure / route.resistance) : Infinity
    const suctionAtRated = sourcePressure - route.resistance * ratedFlow * ratedFlow
    out.push({
      ...base, source, sourcePressure, resistance: route.resistance, maxFlow, suctionAtRated,
      // STRICTLY greater. A path that can pass exactly the rated flow is at its
      // capability, not beyond it, and this check does not claim to know
      // whether that is enough — see the header.
      state: ratedFlow > maxFlow ? 'insufficient' : 'ok',
    })
  }
  out.sort((a, b) => a.tag.localeCompare(b.tag))
  return out
}

/** The same cache shape `model/diagnostics.ts` uses, and for the same reason:
 *  two rules ask the same question about the same index. */
let cache: { ix: ProjectIndex; value: SuctionCheck[] } | null = null

export function suctionFor(ix: ProjectIndex): SuctionCheck[] {
  if (cache && cache.ix === ix) return cache.value
  const value = suctionChecks(ix)
  cache = { ix, value }
  return value
}

/** Test seam — the cache would otherwise leak between cases. */
export function resetSuctionCache(): void {
  cache = null
}
