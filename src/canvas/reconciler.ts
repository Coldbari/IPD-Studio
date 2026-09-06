// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { dia } from '@joint/core'
import type { PlantEdge, SheetContent } from '../model/types'
import { isPortEnd } from '../model/types'
import { makeElement, makeLink, refreshLinkRouter, updateElement, updateLink } from './shapes'

/**
 * Make the JointJS graph mirror the document. The store is immutable, so
 * object identity is the change signal; identical references are skipped.
 * `colorOf` resolves an edge's fluid color; callers re-run reconcile with an
 * unchanged sheet when the fluids palette itself changes.
 */
export function reconcile(
  graph: dia.Graph,
  doc: SheetContent,
  prev: SheetContent | undefined,
  colorOf?: (edge: PlantEdge) => string | undefined,
): void {
  const prevNodes = new Map(prev?.nodes.map((n) => [n.id, n]))
  const prevEdges = new Map(prev?.edges.map((e) => [e.id, e]))
  const nodeMap = new Map(doc.nodes.map((n) => [n.id, n]))
  const movedNodes = new Set<string>()
  const keep = new Set<string>()

  for (const node of doc.nodes) {
    keep.add(node.id)
    const cell = graph.getCell(node.id) as dia.Element | undefined
    if (!cell) {
      graph.addCell(makeElement(node))
    } else {
      const before = prevNodes.get(node.id)
      if (before && before !== node) {
        updateElement(cell, node, before)
        movedNodes.add(node.id)
      }
    }
  }

  const touchesMoved = (edge: PlantEdge) =>
    (isPortEnd(edge.source) && movedNodes.has(edge.source.nodeId)) ||
    (isPortEnd(edge.target) && movedNodes.has(edge.target.nodeId))

  for (const edge of doc.edges) {
    keep.add(edge.id)
    const color = colorOf?.(edge)
    const displayEdge: PlantEdge = edge
    const cell = graph.getCell(edge.id) as dia.Link | undefined
    if (!cell) {
      graph.addCell(makeLink(displayEdge, nodeMap, color))
    } else {
      const before = prevEdges.get(edge.id)
      if (before && before !== edge) updateLink(cell, displayEdge, before, nodeMap, color)
      // A fluids-palette edit restyles lines whose edge objects didn't change.
      else if (color !== (cell.get('data') as { fluidColor?: string } | undefined)?.fluidColor) {
        updateLink(cell, displayEdge, displayEdge, nodeMap, color)
      }
      // Straight-vs-manhattan depends on node geometry, so a moved or
      // rescaled endpoint re-decides the route even when the edge is same.
      else if (touchesMoved(edge)) refreshLinkRouter(cell, displayEdge, nodeMap)
    }
  }

  for (const cell of graph.getCells()) {
    const id = String(cell.id)
    if (!keep.has(id)) {
      // Decorations are stored as link labels and JointJS can leave their
      // SVG nodes behind when a link is removed during a reconciliation
      // pass. Clear them explicitly so a deleted pending-device annotation
      // cannot remain visible on the canvas.
      if (cell.isLink()) cell.labels([])
      cell.remove()
    }
  }
}
