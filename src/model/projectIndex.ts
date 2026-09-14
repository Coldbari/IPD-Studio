// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantEdge, PlantNode, ProjectDoc, Sheet } from './types'
import { isPortEnd } from './types'
import type { EngineeringRecord, EntityKind } from './registry'
import { keyOfEdge, keyOfNode, kindOfNode } from './registry'
import { deriveLoops, type Loop as DerivedLoop } from '../store/selectors'
import type { Loop } from './loop'
import { standardOf, type StandardProfile } from './standard'
import { buildHierarchy, type Hierarchy } from './hierarchy'
import { deriveRuns, runOfEdgeMap, type Run } from './run'
import { getSymbol } from '../symbols/registry'
import type { PortKind } from '../symbols/types'

/**
 * One walk of the document, shared by everything that asks questions about it.
 *
 * Before this, each validation rule re-walked every sheet and rebuilt its own
 * maps — `runChecks` alone built four, and the advisor rebuilt a neighbour list
 * per node per rule. Twenty-odd rules doing that on every keystroke does not
 * scale, and two consumers computing the same thing separately can disagree.
 *
 * Everything here is derived and read-only. Build it once per document.
 */

export interface IndexedNode {
  node: PlantNode
  sheet: Sheet
  /** Registry key (the formatted tag), or null when untagged. */
  key: string | null
  kind: EntityKind | null
  ports: { id: string; kind: PortKind }[]
}

export interface IndexedEdge {
  edge: PlantEdge
  sheet: Sheet
  /** Registry key (the formatted line number), or null when unnumbered. */
  key: string | null
}

export interface ProjectIndex {
  doc: ProjectDoc
  nodes: Map<string, IndexedNode>
  edges: Map<string, IndexedEdge>
  allNodes: IndexedNode[]
  allEdges: IndexedEdge[]
  /** Node ids -> the edges touching them. */
  edgesByNode: Map<string, PlantEdge[]>
  /** Registry key -> everything on a sheet wearing it (>1 means a duplicate). */
  nodesByKey: Map<string, IndexedNode[]>
  edgesByKey: Map<string, IndexedEdge[]>
  /** Node id -> the node ids it is directly connected to. */
  neighbours: Map<string, string[]>
  /**
   * DERIVED loops: tagged nodes grouped on (first ISA letter, loop number).
   *
   * Unchanged, and still what every existing consumer reads. P2-C is an
   * adoption path, not a replacement — the persistent loops below sit beside
   * this until a project opts in.
   */
  loops: DerivedLoop[]
  /** PERSISTENT loops, by stable id (model/loop.ts). Empty for every document
   *  that has not declared any, which is every document written before they
   *  existed. */
  loopsById: Map<string, Loop>
  /**
   * Loop id -> the registry keys assigned to it, sorted.
   *
   * Built by INVERTING `record.loopId`, because the record owns membership and
   * the Loop must not hold a second copy of it. A loop with no members has no
   * entry — the same convention as `unitsByArea` and `edgesByNode`, so callers
   * read it with `?? []`.
   *
   * A `loopId` naming a loop that is not in the project is left out of both
   * maps rather than half-resolved; `danglingLoopMembers()` is what reports
   * those, and Program 2's rule is what will surface them.
   */
  loopMembers: Map<string, string[]>
  /** Registry key -> the loop it belongs to. O(1) "which loop is this in?". */
  loopOfKey: Map<string, string>
  /**
   * DERIVED piping runs: connected components of process edges (model/run.ts).
   *
   * The process-side twin of `loops` above, and derived for the same reason —
   * the fact exists in the drawing and nothing was computing it. No consumer
   * reads this yet; Programs 2-4 are what will.
   */
  runs: Run[]
  /** Edge id -> the run it belongs to. Process edges only: a signal line is in
   *  no run and has no entry here. */
  runOfEdge: Map<string, string>
  /** Every key currently drawn — a record outside this set is an orphan. */
  liveKeys: Set<string>
  records: Record<string, EngineeringRecord>
  /** The profile every rule checks against. Resolved once here so no rule has
   *  to remember that an absent standard means the default. */
  standard: StandardProfile
  /** Areas and Units, indexed by id. Built ONCE with the rest of the walk: a
   *  table that resolved a unit by scanning the array per cell would be the
   *  same quadratic mistake the reports already had to have taken out of
   *  them. */
  hierarchy: Hierarchy
}

/**
 * Every connection point a placed symbol actually offers: the catalogue's,
 * plus the pins the user added to this placement.
 *
 * THE one answer, exported because three callers were building it separately —
 * this index, the nozzle QA rule and the Inspector's port picker — and three
 * implementations of "which ports does this thing have" is three places for
 * the answer to drift. It is not a port subsystem: it resolves nothing, names
 * nothing and decides nothing about what a port MEANS.
 *
 * An unknown symbol id (a custom symbol not registered yet) has no ports
 * rather than throwing. A report that threw would take the whole Data
 * workspace down with it.
 */
export function portsOfNode(node: PlantNode): { id: string; kind: PortKind }[] {
  try {
    return [...getSymbol(node.symbolId).ports, ...(node.extraPorts ?? [])].map((p) => ({
      id: p.id,
      kind: p.kind,
    }))
  } catch {
    return []
  }
}

export function buildIndex(doc: ProjectDoc): ProjectIndex {
  const nodes = new Map<string, IndexedNode>()
  const edges = new Map<string, IndexedEdge>()
  const allNodes: IndexedNode[] = []
  const allEdges: IndexedEdge[] = []
  const edgesByNode = new Map<string, PlantEdge[]>()
  const nodesByKey = new Map<string, IndexedNode[]>()
  const edgesByKey = new Map<string, IndexedEdge[]>()
  const neighbours = new Map<string, string[]>()
  const liveKeys = new Set<string>()

  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }

  for (const sheet of doc.sheets) {
    for (const node of sheet.nodes) {
      const key = keyOfNode(node)
      const indexed: IndexedNode = { node, sheet, key, kind: kindOfNode(node), ports: portsOfNode(node) }
      nodes.set(node.id, indexed)
      allNodes.push(indexed)
      if (key) {
        push(nodesByKey, key, indexed)
        liveKeys.add(key)
      }
    }

    for (const edge of sheet.edges) {
      const key = keyOfEdge(edge)
      const indexed: IndexedEdge = { edge, sheet, key }
      edges.set(edge.id, indexed)
      allEdges.push(indexed)
      if (key) {
        push(edgesByKey, key, indexed)
        liveKeys.add(key)
      }

      const ends = [edge.source, edge.target]
      for (let i = 0; i < 2; i++) {
        const a = ends[i]!
        const b = ends[1 - i]!
        if (!isPortEnd(a)) continue
        push(edgesByNode, a.nodeId, edge)
        if (isPortEnd(b) && b.nodeId !== a.nodeId) push(neighbours, a.nodeId, b.nodeId)
      }
    }
  }

  // Persistent loops: one pass over the loops, one over the records already
  // held. O(loops + records), the same shape as `buildHierarchy`'s
  // `unitsByArea` — never a scan per member, and never a second walk of the
  // sheets, which this index exists to have done once.
  const loopsById = new Map<string, Loop>()
  for (const loop of doc.loops ?? []) if (!loopsById.has(loop.id)) loopsById.set(loop.id, loop)
  const loopMembers = new Map<string, string[]>()
  const loopOfKey = new Map<string, string>()
  if (loopsById.size > 0) {
    // `for...in` rather than Object.entries: the registry is the biggest map in
    // the document, and entries() allocates a [key, value] pair array for all
    // of it before the first assignment is read. Measured at 500 records, that
    // allocation was most of the loop layer's cost.
    const registry = doc.registry
    if (registry) {
      for (const key in registry) {
        const id = registry[key]?.loopId
        if (!id || !loopsById.has(id)) continue
        loopOfKey.set(key, id)
        push(loopMembers, id, key)
      }
    }
    for (const keys of loopMembers.values()) keys.sort()
  }

  // Runs come off `allEdges` and `nodes`, both of which the walk above has
  // already built — this never touches `doc.sheets` a second time.
  const runs = deriveRuns({ nodes, allEdges })

  return {
    doc,
    nodes,
    edges,
    allNodes,
    allEdges,
    edgesByNode,
    nodesByKey,
    edgesByKey,
    neighbours,
    loops: deriveLoops(doc),
    runs,
    runOfEdge: runOfEdgeMap(runs),
    loopsById,
    loopMembers,
    loopOfKey,
    liveKeys,
    records: doc.registry ?? {},
    standard: standardOf(doc),
    hierarchy: buildHierarchy(doc),
  }
}

/** Edges touching a node. Never allocates for the common empty case. */
export function edgesOf(ix: ProjectIndex, nodeId: string): PlantEdge[] {
  return ix.edgesByNode.get(nodeId) ?? []
}

/**
 * Every connection point the objects wearing one registry key currently offer.
 *
 * The UNION across placements, because a tag may legitimately be drawn on two
 * sheets and the ports are the drawing's answer, not the record's. Read off
 * `IndexedNode.ports`, which `buildIndex` has already resolved, so this walks
 * nothing and touches no symbol.
 *
 * A key with nothing drawn returns an EMPTY set, and callers must not read
 * that as "every port is missing": there are no ports to be missing from.
 * `orphan-record` is what reports a record with nothing on a sheet.
 *
 * PORT EXISTENCE IS NOT NOZZLE EXISTENCE. This says what the symbol offers and
 * nothing whatever about what has been specified — see model/nozzle.ts.
 */
export function portIdsOfKey(ix: ProjectIndex, key: string): Set<string> {
  const ids = new Set<string>()
  for (const indexed of ix.nodesByKey.get(key) ?? []) {
    for (const port of indexed.ports) ids.add(port.id)
  }
  return ids
}

export function neighboursOf(ix: ProjectIndex, nodeId: string): string[] {
  return ix.neighbours.get(nodeId) ?? []
}

/** The port kind at one end of an edge, or null if the end is free / unknown. */
export function portKindAt(ix: ProjectIndex, end: PlantEdge['source']): PortKind | null {
  if (!isPortEnd(end)) return null
  return ix.nodes.get(end.nodeId)?.ports.find((p) => p.id === end.portId)?.kind ?? null
}

/**
 * Nodes reachable from `startId` over signal-family lines within `hops`.
 * Used to ask "does this controller drive anything?" without caring how many
 * converters and solenoids sit in between.
 */
export function signalReach(ix: ProjectIndex, startId: string, hops: number): Set<string> {
  const seen = new Set<string>([startId])
  let frontier = [startId]
  for (let i = 0; i < hops && frontier.length; i++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const e of edgesOf(ix, id)) {
        if (!e.lineClass.startsWith('signal') && e.lineClass !== 'link.internal') continue
        for (const end of [e.source, e.target]) {
          if (isPortEnd(end) && !seen.has(end.nodeId)) {
            seen.add(end.nodeId)
            next.push(end.nodeId)
          }
        }
      }
    }
    frontier = next
  }
  seen.delete(startId)
  return seen
}
