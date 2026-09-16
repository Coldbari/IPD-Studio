// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * WHAT EACH STREAM CARRIES.
 *
 * The P&ID states a service on the lines the engineer assigned one to. This
 * works out what every OTHER stream carries by following the topology, and —
 * the part that matters — says MIXED where two services meet instead of
 * quietly picking one.
 *
 * WHAT IT IS NOT. It is not physics. The hydraulic solver does not know a fluid
 * exists, and the thermal model still runs on the single liquid stated in
 * `sim/units.ts`. Densities and viscosities are carried as ENGINEERING DATA for
 * the operator and for whatever later reads them; nothing here changes a
 * pressure drop, a pump head or a temperature. Wiring density into the solver
 * is a physics change and has to be validated as one — a half-applied
 * correction would be worse than none, because the numbers would still look
 * right.
 *
 * STATIC. Derived once when a run is compiled, from the drawing. It does not
 * depend on flow, and must not: an operator watching a line reverse should see
 * the arrows turn, not the service change. A reversed water line is still water.
 *
 * THE RULE, stated once, and it is the one the P&ID already uses.
 *
 * A service travels along a RUN — a chain of pipe carried through two-port
 * hardware, a valve or a pump or a fitting — and a run ENDS where the pipe
 * branches or enters a vessel. That is exactly `model/fluidFlow.ts`'s rule for
 * spreading an assignment across a drawing, and using the same one here is the
 * point: a line the engineer painted as water on the P&ID is water here.
 *
 *   1. A run the drawing gives a service IS that service. Stated wins.
 *   2. A run with two different services stated on its own pipes is a
 *      CONTRADICTION in the drawing, and is reported as mixed rather than
 *      resolved.
 *   3. An unstated run takes the service of the runs it touches at a junction.
 *      Touching exactly one service makes it that service.
 *   4. Touching TWO makes it MIXED, and the junction is a mixing point.
 *   5. MIXED spreads, so anything downstream of a mixture is the mixture.
 *   6. Nothing crosses a VESSEL. What arrives in a tank joins what is already
 *      in it, and this model does not carry a vessel's contents as a
 *      composition — so the far side is UNKNOWN unless the drawing says.
 *
 * WHY RUNS RATHER THAN EDGES. An earlier attempt propagated edge to edge and
 * got it wrong in the case this exists for: the leg feeding a junction took the
 * service of the OTHER leg back across the junction, so two clean inputs both
 * read as mixed and the mixture had swallowed its own causes. A junction is
 * where services meet; it is not a place a service travels through.
 *
 * Applied to a fixpoint, so the answer does not depend on the order the runs
 * happen to be in.
 */

import type { Fluid, StreamToken } from '../../model/types'
import type { ProcessModel } from './hydraulic/model'

/** What is known about the service a stream carries. */
export type FluidState =
  /** The drawing states it, or exactly one service reaches it. */
  | 'known'
  /** Two or more services reach it. The model does NOT compute a mixture. */
  | 'mixed'
  /** Nothing states it and nothing reaches it. */
  | 'unknown'

export interface StreamFluid {
  state: FluidState
  /** `known` only. */
  fluidId?: string
  name?: string
  /** `known` only, and only when the project said how to show this service. */
  displayToken?: StreamToken
  /** `mixed` only: the services that meet, sorted, so the operator can see
   *  WHAT is mixing rather than only that something is. */
  components?: string[]
  /** The same list as names, resolved here so no renderer needs the project's
   *  service list to say what is mixing. */
  componentNames?: string[]
  /** `mixed` only: the objects where they meet. */
  at?: string[]
}

const UNKNOWN: StreamFluid = { state: 'unknown' }

/** Whether this service's physical properties are actually stated. Most are
 *  not, and that is reported rather than filled in. */
export function hasProperties(f: Fluid | undefined): boolean {
  return f !== undefined && f.densityKgM3 !== undefined
    && f.viscosityMPaS !== undefined && f.heatCapacityKJkgK !== undefined
}

export interface FluidMap {
  /** `ProcessModel` edge id -> what it carries. */
  byEdge: Map<string, StreamFluid>
  /** Nodes where two or more services meet. */
  mixingPoints: string[]
}

/**
 * Work out what every stream carries.
 *
 * `fluids` is the project's service list, used only to resolve a name and a
 * display token — never to decide identity, which comes from the drawing.
 */
export function deriveFluids(model: ProcessModel, fluids: readonly Fluid[] = []): FluidMap {
  const byId = new Map(fluids.map((f) => [f.id, f]))

  // Nothing crosses a vessel nozzle.
  const vessel = new Set<string>()
  for (const ids of model.vesselNodes.values()) for (const id of ids) vessel.add(id)

  // Which edges meet at each node.
  const at = new Map<string, string[]>()
  for (const e of model.edges) {
    for (const n of [e.from, e.to]) {
      if (vessel.has(n)) continue
      if (!at.has(n)) at.set(n, [])
      at.get(n)!.push(e.id)
    }
  }
  const edgeById = new Map(model.edges.map((e) => [e.id, e]))

  // 1. RUNS. Walk edge to edge, but only through a node that joins exactly two
  //    of them — anything else is a branch, and a branch ends the run.
  const runOf = new Map<string, number>()
  const runs: string[][] = []
  for (const e of model.edges) {
    if (runOf.has(e.id)) continue
    const run: string[] = []
    const queue = [e.id]
    runOf.set(e.id, runs.length)
    while (queue.length > 0) {
      const id = queue.shift()!
      run.push(id)
      const edge = edgeById.get(id)!
      for (const n of [edge.from, edge.to]) {
        const here = at.get(n) ?? []
        if (here.length !== 2) continue // a branch, or a vessel: the run ends
        for (const other of here) {
          if (runOf.has(other)) continue
          runOf.set(other, runs.length)
          queue.push(other)
        }
      }
    }
    runs.push(run)
  }

  /** Run index -> the service it carries, or 'MIXED'. */
  const label = new Map<number, string>()
  const components = new Map<number, Set<string>>()
  const stated = new Set<number>()

  // 2. STATED. The drawing's own word about any pipe in the run.
  runs.forEach((run, i) => {
    const said = new Set<string>()
    for (const id of run) for (const f of edgeById.get(id)!.fluidIds) said.add(f)
    if (said.size === 0) return
    stated.add(i)
    if (said.size === 1) { label.set(i, [...said][0]!); return }
    // the drawing states two services on one run — a contradiction in the
    // engineering data, reported rather than resolved
    label.set(i, 'MIXED')
    components.set(i, said)
  })

  // Which runs touch which, and where.
  const touching = new Map<number, { run: number; node: string }[]>()
  for (const [node, ids] of at) {
    const here = [...new Set(ids.map((id) => runOf.get(id)!))]
    if (here.length < 2) continue
    for (const a of here) {
      for (const b of here) {
        if (a === b) continue
        if (!touching.has(a)) touching.set(a, [])
        touching.get(a)!.push({ run: b, node })
      }
    }
  }

  // 3-5. FIXPOINT over the unstated runs.
  const mixingPoints = new Set<string>()
  for (let pass = 0; pass <= runs.length; pass++) {
    let changed = false
    runs.forEach((_, i) => {
      if (stated.has(i)) return
      const seen = new Set<string>()
      for (const { run: other } of touching.get(i) ?? []) {
        const l = label.get(other)
        if (l === undefined) continue
        if (l === 'MIXED') {
          for (const c of components.get(other) ?? []) seen.add(c)
          seen.add('MIXED')
        } else seen.add(l)
      }
      const real = [...seen].filter((x) => x !== 'MIXED')
      const next = seen.has('MIXED') || real.length > 1 ? 'MIXED' : real[0]
      if (next === undefined || label.get(i) === next) return
      label.set(i, next)
      if (next === 'MIXED') components.set(i, new Set(real))
      changed = true
    })
    if (!changed) break
  }

  // Where services actually MEET: a node with more than one distinct service
  // on the runs that reach it.
  for (const [node, ids] of at) {
    const kinds = new Set<string>()
    for (const id of ids) {
      const l = label.get(runOf.get(id)!)
      if (l === undefined) continue
      if (l === 'MIXED') for (const c of components.get(runOf.get(id)!) ?? []) kinds.add(c)
      else kinds.add(l)
    }
    if (kinds.size > 1) mixingPoints.add(node)
  }

  const byEdge = new Map<string, StreamFluid>()
  for (const e of model.edges) {
    const i = runOf.get(e.id)!
    const l = label.get(i)
    if (l === undefined) { byEdge.set(e.id, UNKNOWN); continue }
    if (l === 'MIXED') {
      const comps = [...(components.get(i) ?? [])].sort()
      byEdge.set(e.id, {
        state: 'mixed',
        components: comps,
        componentNames: comps.map((id) => byId.get(id)?.name ?? id),
        at: [...mixingPoints].sort(),
      })
      continue
    }
    const f = byId.get(l)
    byEdge.set(e.id, {
      state: 'known',
      fluidId: l,
      // a service the drawing names but the project's list does not define is
      // still an identity; it simply has no name or token to show
      ...(f?.name !== undefined ? { name: f.name } : {}),
      ...(f?.displayToken !== undefined ? { displayToken: f.displayToken } : {}),
    })
  }
  return { byEdge, mixingPoints: [...mixingPoints].sort() }
}

/** How an operator reads a stream's service in one line. */
export function fluidLabel(f: StreamFluid): string {
  if (f.state === 'unknown') return 'UNKNOWN'
  if (f.state === 'mixed') {
    const names = f.componentNames ?? []
    return names.length > 0 ? `MIXED (${names.join(' + ')})` : 'MIXED'
  }
  return f.name ?? f.fluidId ?? 'UNKNOWN'
}
