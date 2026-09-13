// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE PIPING RUN — what the drawing already says about which pipe is which.
 *
 * WHAT THIS IS. A Run is one physically connected set of process edges: the
 * pipe you could walk along without passing through a vessel. It is DERIVED,
 * exactly as `deriveLoops()` is derived, and it is not stored anywhere. Nothing
 * in `ProjectDoc` changes for it, no schema moves, and a document written
 * before this existed derives the same runs as one written after.
 *
 * WHY IT IS NEEDED. `keyOfEdge()` already makes the line number an engineering
 * identity and `ProjectIndex.edgesByKey` is already `key -> IndexedEdge[]`, so
 * the registry has always allowed many edges to share one line record. Nothing
 * ever computed WHICH edges those were. Without that, a line list can only
 * print one row per drawn segment, and a duplicate-number check can only see
 * two edges wearing one number and call it a fault — even when they are two
 * halves of the same pipe. Program 1 computes the missing fact. It changes no
 * consumer; Programs 2-4 do that.
 *
 * THE INVARIANT. A physically connected run is NEVER split because its edges
 * carry different line numbers. Connectivity is a fact about the drawing; a
 * line number is a label somebody typed, and a label cannot cut a pipe. So the
 * run is the connected component, and the numbers observed on it are reported
 * beside it — see `numbers` below, and `runConflicts`.
 *
 * WHAT IT REFUSES TO DO:
 *
 *  - It never picks a winning number. A connected run carrying two numbers has
 *    `number: undefined` and both strings in `numbers`. Choosing one would be
 *    the software deciding which of an engineer's two answers is right.
 *  - It never states a direction. `runEnds` returns the extremities as a LIST,
 *    not a From/To pair, because a branched run has three of them and because
 *    nothing in this model establishes which way anything flows. The only
 *    direction evidence in the document is `PlantEdge.arrow`, which is per
 *    edge, not per run. Program 3 decides what a two-column From/To does with
 *    that; it must not be handed a guess dressed as a fact.
 *  - It never crosses a sheet. Adjacency is built per sheet, so an off-page
 *    continuation is two runs and is reported as one number on two runs.
 *  - It never mutates or renumbers anything. Everything here is pure.
 *
 * PASS-THROUGH IS NOT REDEFINED HERE. `passesThrough` below is the predicate
 * `propagateFluid` has always used, moved rather than copied, and
 * `model/fluidFlow.ts` now imports it. There is one definition of "the medium
 * carries on through this" in the product and both callers read it. Its known
 * consequences are pinned in `tests/model/run.test.ts` rather than papered
 * over: see the note on flow elements there.
 *
 * Everything here is pure and DOM-free.
 */

import type { PlantEdge, PlantNode } from './types'
import { isPortEnd } from './types'
import { isProcessClass } from '../canvas/lineStyle'
import { getSymbol } from '../symbols/registry'

/* ------------------------------------------------------------ pass-through */

/**
 * Symbol categories a medium flows straight through: what enters one side
 * leaves the other. Vessels, columns, exchangers and process units transform
 * or mix, so the run stops at them.
 *
 * Moved verbatim from `fluidFlow.ts`. Changing it changes what a fluid
 * assignment colours as well as what a run contains, which is exactly why
 * there must be only one of it.
 */
const PASS_CATEGORIES = new Set([
  'valves', 'control-valves', 'safety', 'flow-elements', 'accessories', 'inline', 'rotating', 'custom',
])

/** Does a run continue through this node? The product's one answer. */
export function passesThrough(node: PlantNode): boolean {
  if (node.kind === 'valve' || node.kind === 'fitting') return true
  if (node.kind !== 'equipment') return false
  try {
    return PASS_CATEGORIES.has(getSymbol(node.symbolId).category)
  } catch {
    return true // unknown/custom symbols: assume inline hardware
  }
}

/**
 * The connected component of process edges containing `start`.
 *
 * THE one traversal. `propagateFluid` calls it with a sheet's edges gathered
 * into `edgesAt`; `deriveRuns` calls it with the same map built from the index.
 * Both therefore agree, by construction, about what "connected" means.
 *
 * Order is insertion order from a breadth-first walk starting at `start`, which
 * is what `propagateFluid` has always returned and what its callers see.
 *
 * `edgesAt` must contain PROCESS edges only, and only ones from a single
 * sheet — this function does not filter, so what goes in decides what a run is
 * allowed to reach.
 */
export function connectedRun(
  start: PlantEdge,
  edgesAt: ReadonlyMap<string, readonly PlantEdge[]>,
  nodeOf: (id: string) => PlantNode | undefined,
): PlantEdge[] {
  const seen = new Set<string>([start.id])
  const out: PlantEdge[] = [start]
  let frontier: PlantEdge[] = [start]
  while (frontier.length > 0) {
    const next: PlantEdge[] = []
    for (const e of frontier) {
      for (const end of [e.source, e.target]) {
        if (!isPortEnd(end)) continue
        const n = nodeOf(end.nodeId)
        if (!n || !passesThrough(n)) continue
        for (const other of edgesAt.get(end.nodeId) ?? []) {
          if (seen.has(other.id)) continue
          seen.add(other.id)
          out.push(other)
          next.push(other)
        }
      }
    }
    frontier = next
  }
  return out
}

/* -------------------------------------------------------------- the entity */

export interface Run {
  /**
   * Stable, derived, and NEVER persisted: the sheet id and the lexicographically
   * smallest edge id in the run. Edge ids are ULIDs, so the smallest is the
   * oldest edge — adding a segment to an existing run therefore keeps the id it
   * had, and two builds of the same document always produce the same ids.
   *
   * Not a foreign key. Nothing may store it; `runOfEdge` is how you look one up.
   */
  id: string
  /**
   * The line number this run carries, when exactly ONE was observed on it.
   *
   * Absent in two very different situations — nothing was numbered, and several
   * different numbers were — which is what `unnumbered` exists to separate. It
   * is never a choice between candidates.
   *
   * Present does NOT mean every edge carries it: numbering the main segment and
   * leaving the short bits blank is ordinary drafting. Ask `edgeIds` against the
   * index if a consumer needs to know how much of the run is labelled.
   */
  number?: string
  /** Every DISTINCT line number observed on this run, sorted. Empty, one, or
   *  several — the honest set, with no winner picked. Keys are `keyOfEdge`
   *  strings, so they join straight onto the registry. */
  numbers: readonly string[]
  /** Every process edge in the run, sorted by id. Always at least one. */
  edgeIds: string[]
  /** The sheet the whole run is drawn on. A run never spans two. */
  sheetId: string
  /** True when NO edge in the run carries a line number at all. Distinct from
   *  `number === undefined`, which is also true of a run carrying several. */
  unnumbered: boolean
}

/* ---------------------------------------------------------------- the input */

/**
 * The slice of `ProjectIndex` this module reads.
 *
 * Structural rather than an import of `ProjectIndex`, for two reasons: it lets
 * `buildIndex` derive runs from the parts it has already collected, before the
 * index object exists, and it keeps `projectIndex.ts -> run.ts` a one-way
 * dependency with no type cycle to reason about.
 */
export interface RunSource {
  nodes: ReadonlyMap<string, { node: PlantNode; key: string | null }>
  /** Every edge in the document, with its sheet and its line-number key. */
  allEdges: readonly { edge: PlantEdge; sheet: { id: string }; key: string | null }[]
}

/** `RunSource` plus what the derived helpers need: a finished index. */
export interface RunIndex extends RunSource {
  edges: ReadonlyMap<string, { edge: PlantEdge; key: string | null }>
  runs: readonly Run[]
}

/* ------------------------------------------------------------- derivation */

/**
 * Every run in the document, deterministically.
 *
 * ONE pass over the edges the index already holds — this never walks
 * `doc.sheets`, because `buildIndex` has just done that and paying for it twice
 * is the mistake `ProjectIndex` exists to have stopped making.
 *
 * Ordering: sheets in document order, then runs by id (so, by their oldest
 * edge). Within a run, `edgeIds` sorted. Nothing depends on Map iteration order.
 */
export function deriveRuns(ix: RunSource): Run[] {
  // Partition the process edges by sheet, remembering the order the sheets
  // first appeared so the output follows the document rather than a hash.
  const bySheet = new Map<string, { edge: PlantEdge; key: string | null }[]>()
  const sheetOrder: string[] = []
  for (const ie of ix.allEdges) {
    if (!isProcessClass(ie.edge.lineClass)) continue
    const list = bySheet.get(ie.sheet.id)
    if (list) list.push(ie)
    else {
      bySheet.set(ie.sheet.id, [ie])
      sheetOrder.push(ie.sheet.id)
    }
  }

  const nodeOf = (id: string) => ix.nodes.get(id)?.node
  const runs: Run[] = []

  for (const sheetId of sheetOrder) {
    const sheetEdges = bySheet.get(sheetId)!

    // Adjacency for THIS sheet only. That is what makes "a run never crosses a
    // sheet" structural rather than a check somebody could forget: an edge on
    // another sheet is not in the map, so the walk cannot reach it.
    const edgesAt = new Map<string, PlantEdge[]>()
    const keyOf = new Map<string, string>()
    for (const ie of sheetEdges) {
      if (ie.key) keyOf.set(ie.edge.id, ie.key)
      for (const end of [ie.edge.source, ie.edge.target]) {
        if (!isPortEnd(end)) continue
        const list = edgesAt.get(end.nodeId)
        if (list) list.push(ie.edge)
        else edgesAt.set(end.nodeId, [ie.edge])
      }
    }

    const claimed = new Set<string>()
    const sheetRuns: Run[] = []
    for (const ie of sheetEdges) {
      if (claimed.has(ie.edge.id)) continue
      const members = connectedRun(ie.edge, edgesAt, nodeOf)
      const edgeIds: string[] = []
      const numbers = new Set<string>()
      for (const m of members) {
        claimed.add(m.id)
        edgeIds.push(m.id)
        const key = keyOf.get(m.id)
        if (key) numbers.add(key)
      }
      edgeIds.sort()
      const sorted = [...numbers].sort()
      sheetRuns.push({
        id: `${sheetId}:${edgeIds[0]}`,
        ...(sorted.length === 1 ? { number: sorted[0]! } : {}),
        numbers: sorted,
        edgeIds,
        sheetId,
        unnumbered: sorted.length === 0,
      })
    }
    sheetRuns.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    runs.push(...sheetRuns)
  }

  return runs
}

/** Edge id -> the run it belongs to. Process edges only: a signal line is in
 *  no run and has no entry, so read it with `?.` and mean it. */
export function runOfEdgeMap(runs: readonly Run[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const run of runs) for (const id of run.edgeIds) map.set(id, run.id)
  return map
}

/* ------------------------------------------------------------------- ends */

/**
 * Why a run stops at an extremity.
 *
 *  - `free`     — the line end is not attached to anything. `dangling-end`
 *                 already reports these; a line list cannot print a destination.
 *  - `boundary` — it lands on something the run does not pass through: a vessel,
 *                 an exchanger, an instrument, an off-page connector. This is a
 *                 real terminus and the only kind a From/To column can name.
 *  - `dead-end` — it lands on pass-through hardware with no process line
 *                 continuing: a valve drawn with one side unconnected, or a
 *                 port naming a node that is not in the document. The drawing
 *                 is unfinished, and printing the valve as a destination would
 *                 state something the drawing does not.
 */
export type RunEndReason = 'free' | 'boundary' | 'dead-end'

export interface RunEnd {
  edgeId: string
  /** Which end of that edge. NOT a direction — `source`/`target` is the order
   *  the line happened to be drawn in, nothing more. */
  at: 'source' | 'target'
  reason: RunEndReason
  /** The node the run stops at. Absent when the end is free. */
  nodeId?: string
  /** That node's registry key, when it has one. The identity to join on; how
   *  it should READ is the caller's business, not this module's. */
  nodeKey?: string
}

/**
 * The physical extremities of a run.
 *
 * A LIST, deliberately. A straight pipe has two ends; a run through a tee has
 * three; a loop of pipe back on itself has none. Returning a From/To pair would
 * force a choice on every drawing that is not the simple case, and there is
 * nothing in the model to make that choice with.
 *
 * Sorted by `(edgeId, source-before-target)`, so two calls agree.
 */
export function runEnds(ix: RunIndex, run: Run): RunEnd[] {
  // Which of THIS RUN's edges touch each node. One pass, then every end is an
  // O(1) question — rather than asking the whole run again per end.
  const runEdgesAt = new Map<string, Set<string>>()
  for (const id of run.edgeIds) {
    const e = ix.edges.get(id)?.edge
    if (!e) continue
    for (const end of [e.source, e.target]) {
      if (!isPortEnd(end)) continue
      const set = runEdgesAt.get(end.nodeId)
      if (set) set.add(id)
      else runEdgesAt.set(end.nodeId, new Set([id]))
    }
  }

  const out: RunEnd[] = []
  for (const id of run.edgeIds) {
    const e = ix.edges.get(id)?.edge
    if (!e) continue
    const ends: ['source' | 'target', PlantEdge['source']][] = [
      ['source', e.source],
      ['target', e.target],
    ]
    for (const [at, end] of ends) {
      if (!isPortEnd(end)) {
        out.push({ edgeId: id, at, reason: 'free' })
        continue
      }
      const indexed = ix.nodes.get(end.nodeId)
      const base = { edgeId: id, at, nodeId: end.nodeId, ...(indexed?.key ? { nodeKey: indexed.key } : {}) }
      if (!indexed) {
        // A port naming a node that is not here. Not a free end — the drawing
        // claims an attachment — and not a boundary, because there is nothing
        // to be bounded by.
        out.push({ ...base, reason: 'dead-end' })
        continue
      }
      if (!passesThrough(indexed.node)) {
        out.push({ ...base, reason: 'boundary' })
        continue
      }
      // Pass-through hardware. The run continues only if another of its own
      // edges is here; a signal line at the same valve is not a continuation.
      if ((runEdgesAt.get(end.nodeId)?.size ?? 0) > 1) continue
      out.push({ ...base, reason: 'dead-end' })
    }
  }
  return out
}

/* ------------------------------------------------------------- continuity */

/**
 * Runs that are physically ONE line, grouped.
 *
 * A run stops at anything `passesThrough` rejects, and two of the things it
 * rejects are not process boundaries at all:
 *
 *  - An INSTRUMENT in the line — an orifice plate, a magmeter, a rotameter.
 *    It measures the medium; it does not transform it. The run stops there only
 *    because `passesThrough` rejects every node of kind `instrument` before it
 *    ever looks at the category (see the pinned note in tests/model/run.test.ts).
 *    That is a limitation of the model, and treating the two sides as one line
 *    corrects for OUR model rather than inferring anything about the plant.
 *  - An ANNOTATION — in practice an off-page connector, which is not hardware.
 *
 * A vessel, an exchanger or a process unit is the opposite: what leaves is not
 * what entered, so two runs meeting there are two lines and are left apart.
 *
 * Off-page continuation is followed through `PlantNode.link`, the same pointer
 * `offpage-link` validates. The pointer is written on one connector only — the
 * property panel sets it in one direction — so a link counts in EITHER
 * direction. Nothing here crosses a sheet in the run derivation itself; this
 * only records that two derived runs are the same line.
 *
 * Returns run id -> the id of the smallest run in its group, so the grouping is
 * deterministic and independent of the order runs were visited in. A run joined
 * to nothing maps to itself.
 *
 * WHAT IT REFUSES TO INFER: nothing else. Two runs meeting at a vessel, or
 * merely carrying the same number, are not joined. Where the drawing does not
 * state continuity, this does not invent it.
 */
export function runContinuity(ix: RunIndex): Map<string, string> {
  const parent = new Map<string, string>()
  for (const run of ix.runs) parent.set(run.id, run.id)

  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // The smaller id always wins, so the representative does not depend on
    // which pair happened to be joined first.
    if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }

  // Node id -> the runs that END there, at a node that does not transform the
  // medium. A free or dead end joins nothing: there is no object to join at.
  const runsAtNode = new Map<string, string[]>()
  for (const run of ix.runs) {
    const seen = new Set<string>()
    for (const end of runEnds(ix, run)) {
      if (end.reason !== 'boundary' || !end.nodeId || seen.has(end.nodeId)) continue
      const kind = ix.nodes.get(end.nodeId)?.node.kind
      if (kind !== 'instrument' && kind !== 'annotation') continue
      seen.add(end.nodeId)
      const list = runsAtNode.get(end.nodeId)
      if (list) list.push(run.id)
      else runsAtNode.set(end.nodeId, [run.id])
    }
  }

  // Same node: one line with something measuring it in the middle.
  for (const runIds of runsAtNode.values()) {
    for (let i = 1; i < runIds.length; i++) union(runIds[0]!, runIds[i]!)
  }

  // Linked connectors: one line continued on another sheet.
  for (const [nodeId, runIds] of runsAtNode) {
    const link = ix.nodes.get(nodeId)?.node.link
    if (!link) continue
    const there = runsAtNode.get(link.nodeId)
    if (!there) continue
    for (const a of runIds) for (const b of there) union(a, b)
  }

  const out = new Map<string, string>()
  for (const run of ix.runs) out.set(run.id, find(run.id))
  return out
}

/* -------------------------------------------------------------- conflicts */

/**
 * What a run's numbering says about itself. REPORTED, never repaired.
 *
 *  - `multiple-numbers` — one connected pipe wearing more than one line number.
 *    On a header with branches this is ORDINARY, not a fault: a 12" header and
 *    its 2" take-offs are one connected run and three legitimate numbers.
 *    Program 2 decides what, if anything, is worth saying about it. Program 1
 *    only makes it visible.
 *  - `number-split` — one line number on two runs that are not connected. That
 *    covers a genuine duplicate AND a line continuing across sheets through an
 *    off-page connector, which is also ordinary. Again: reported, not judged.
 */
export type RunConflict =
  | { kind: 'multiple-numbers'; runId: string; sheetId: string; numbers: string[] }
  | { kind: 'number-split'; number: string; runIds: string[] }

/**
 * Conflicts involving one run.
 *
 * O(runs), because `number-split` is a question about every other run. Calling
 * this in a loop over `ix.runs` is therefore quadratic — use `allRunConflicts`,
 * which answers the same question for the whole document in one pass.
 */
export function runConflicts(ix: RunIndex, run: Run): RunConflict[] {
  const out: RunConflict[] = []
  if (run.numbers.length > 1) {
    out.push({ kind: 'multiple-numbers', runId: run.id, sheetId: run.sheetId, numbers: [...run.numbers] })
  }
  for (const number of run.numbers) {
    const runIds = ix.runs.filter((r) => r.numbers.includes(number)).map((r) => r.id).sort()
    if (runIds.length > 1) out.push({ kind: 'number-split', number, runIds })
  }
  return out
}

/** Every conflict in the document, in one linear pass. */
export function allRunConflicts(ix: RunIndex): RunConflict[] {
  const out: RunConflict[] = []
  const byNumber = new Map<string, string[]>()
  for (const run of ix.runs) {
    if (run.numbers.length > 1) {
      out.push({ kind: 'multiple-numbers', runId: run.id, sheetId: run.sheetId, numbers: [...run.numbers] })
    }
    for (const number of run.numbers) {
      const list = byNumber.get(number)
      if (list) list.push(run.id)
      else byNumber.set(number, [run.id])
    }
  }
  for (const number of [...byNumber.keys()].sort()) {
    const runIds = byNumber.get(number)!
    if (runIds.length > 1) out.push({ kind: 'number-split', number, runIds: [...runIds].sort() })
  }
  return out
}
