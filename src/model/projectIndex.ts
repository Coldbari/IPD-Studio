// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantEdge, PlantNode, ProjectDoc, Sheet } from './types'
import { isJunctionEnd, isPortEnd } from './types'
import type { EngineeringRecord, EntityKind } from './registry'
import { keyOfEdge, keyOfNode, kindOfNode } from './registry'
import { deriveLoops, type Loop } from '../store/selectors'
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
  loops: Loop[]
  /** Every key currently drawn — a record outside this set is an orphan. */
  liveKeys: Set<string>
  records: Record<string, EngineeringRecord>
}

function portsOf(node: PlantNode): { id: string; kind: PortKind }[] {
  try {
    return [...getSymbol(node.symbolId).ports, ...(node.extraPorts ?? [])].map((p) => ({
      id: p.id,
      kind: p.kind,
    }))
  } catch {
    // an unknown symbol id (a custom symbol not registered yet) has no ports
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
    const edgesByJunction = new Map<string, PlantEdge[]>()
    for (const node of sheet.nodes) {
      const key = keyOfNode(node)
      const indexed: IndexedNode = { node, sheet, key, kind: kindOfNode(node), ports: portsOf(node) }
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
      for (const end of ends) {
        if (isJunctionEnd(end)) push(edgesByJunction, end.junctionId, edge)
      }
    }

    // A shared line endpoint is not a component, but every device attached to
    // its line group is reachable through it for QA and where-used queries.
    for (const junctionEdges of edgesByJunction.values()) {
      const nodeIds = new Set(junctionEdges.flatMap((edge) =>
        [edge.source, edge.target].filter(isPortEnd).map((end) => end.nodeId),
      ))
      for (const nodeId of nodeIds) {
        for (const edge of junctionEdges) push(edgesByNode, nodeId, edge)
        for (const other of nodeIds) if (other !== nodeId) push(neighbours, nodeId, other)
      }
    }
  }

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
    liveKeys,
    records: doc.registry ?? {},
  }
}

/** Edges touching a node. Never allocates for the common empty case. */
export function edgesOf(ix: ProjectIndex, nodeId: string): PlantEdge[] {
  return ix.edgesByNode.get(nodeId) ?? []
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
