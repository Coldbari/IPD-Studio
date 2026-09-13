// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SheetContent } from './types'
import { isPortEnd } from './types'
import { isProcessClass } from '../canvas/lineStyle'
import { connectedRun } from './run'

/**
 * `passesThrough` and the walk itself now live in `model/run.ts`, which derives
 * piping runs from the same two rules. They were moved rather than copied: a
 * second, subtly different idea of "the medium carries on through this" would
 * mean a fluid assignment and a line list disagreeing about where one pipe
 * ends, and they would disagree quietly.
 *
 * What this function does is unchanged, including the order of its result.
 */

/** The connected run of process edges a fluid assignment covers: walk from
 *  the start edge in BOTH directions through pass-through hardware (valves,
 *  pumps, junctions, fittings), stopping at vessels/exchangers/units.
 *  Returns the edge ids to restyle (always includes the start edge). */
export function propagateFluid(content: SheetContent, startEdgeId: string): string[] {
  const start = content.edges.find((e) => e.id === startEdgeId)
  if (!start) return []
  const nodesById = new Map(content.nodes.map((n) => [n.id, n]))
  const processEdges = content.edges.filter((e) => isProcessClass(e.lineClass))
  const edgesAt = new Map<string, typeof processEdges>()
  for (const e of processEdges) {
    for (const end of [e.source, e.target]) {
      if (!isPortEnd(end)) continue
      edgesAt.set(end.nodeId, [...(edgesAt.get(end.nodeId) ?? []), e])
    }
  }
  return connectedRun(start, edgesAt, (id) => nodesById.get(id)).map((e) => e.id)
}
