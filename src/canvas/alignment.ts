// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantEdge, PlantNode } from '../model/types'
import { isPortEnd } from '../model/types'
import { getSymbol } from '../symbols/registry'

export interface NodeMove {
  id: string
  x: number
  y: number
}

/** Effective per-axis scale factors for a node. */
export function scalesOf(node: Pick<PlantNode, 'scale' | 'scaleX' | 'scaleY'>): { sx: number; sy: number } {
  return { sx: node.scaleX ?? node.scale ?? 1, sy: node.scaleY ?? node.scale ?? 1 }
}

function sizeOf(node: PlantNode): { w: number; h: number } {
  try {
    const def = getSymbol(node.symbolId)
    const rotated = node.rotation === 90 || node.rotation === 270
    const { sx, sy } = scalesOf(node)
    const w = def.gridSize.w * 8 * sx
    const h = def.gridSize.h * 8 * sy
    return rotated ? { w: h, h: w } : { w, h }
  } catch {
    return { w: 32, h: 32 }
  }
}

/** Sheet-space position of a node's port, honoring rotation and scale.
 *  Looks through the catalog ports AND any user-added pins. */
export function portWorld(node: PlantNode, portId: string): { x: number; y: number } | null {
  try {
    const def = getSymbol(node.symbolId)
    const port = def.ports.find((p) => p.id === portId) ?? node.extraPorts?.find((p) => p.id === portId)
    if (!port) return null
    const { sx, sy } = scalesOf(node)
    const w = def.gridSize.w * 8 * sx
    const h = def.gridSize.h * 8 * sy
    let dx = port.x * sx - w / 2
    let dy = port.y * sy - h / 2
    const turns = (((node.rotation % 360) + 360) % 360) / 90
    for (let i = 0; i < turns; i++) {
      const r = { x: -dy, y: dx }
      dx = r.x
      dy = r.y
    }
    return { x: node.x + w / 2 + dx, y: node.y + h / 2 + dy }
  } catch {
    return null
  }
}

/** Inverse of portWorld: symbol-frame coordinates for a sheet point on a node
 *  (where a user clicked, expressed like a catalog port's x/y). */
export function localPortPoint(node: PlantNode, pt: { x: number; y: number }): { x: number; y: number } | null {
  try {
    const def = getSymbol(node.symbolId)
    const { sx, sy } = scalesOf(node)
    const w = def.gridSize.w * 8 * sx
    const h = def.gridSize.h * 8 * sy
    let dx = pt.x - (node.x + w / 2)
    let dy = pt.y - (node.y + h / 2)
    const turns = (((node.rotation % 360) + 360) % 360) / 90
    for (let i = 0; i < turns; i++) {
      // inverse of the clockwise quarter-turn portWorld applies
      const r = { x: dy, y: -dx }
      dx = r.x
      dy = r.y
    }
    return { x: (dx + w / 2) / sx, y: (dy + h / 2) / sy }
  } catch {
    return null
  }
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v'

export function alignNodes(nodes: PlantNode[], mode: AlignMode): NodeMove[] {
  if (nodes.length < 2) return nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))
  const boxes = nodes.map((n) => ({ n, ...sizeOf(n) }))
  const lefts = boxes.map((b) => b.n.x)
  const rights = boxes.map((b) => b.n.x + b.w)
  const tops = boxes.map((b) => b.n.y)
  const bottoms = boxes.map((b) => b.n.y + b.h)
  const cx = (Math.min(...lefts) + Math.max(...rights)) / 2
  const cy = (Math.min(...tops) + Math.max(...bottoms)) / 2
  return boxes.map(({ n, w, h }) => {
    switch (mode) {
      case 'left': return { id: n.id, x: Math.min(...lefts), y: n.y }
      case 'right': return { id: n.id, x: Math.max(...rights) - w, y: n.y }
      case 'top': return { id: n.id, x: n.x, y: Math.min(...tops) }
      case 'bottom': return { id: n.id, x: n.x, y: Math.max(...bottoms) - h }
      case 'center-v': return { id: n.id, x: Math.round((cx - w / 2) / 8) * 8, y: n.y }
      case 'center-h': return { id: n.id, x: n.x, y: Math.round((cy - h / 2) / 8) * 8 }
    }
  })
}

export function distributeNodes(nodes: PlantNode[], axis: 'h' | 'v'): NodeMove[] {
  if (nodes.length < 3) return nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))
  const boxes = nodes
    .map((n) => ({ n, ...sizeOf(n) }))
    .sort((a, b) => (axis === 'h' ? a.n.x - b.n.x : a.n.y - b.n.y))
  const first = boxes[0]!
  const last = boxes[boxes.length - 1]!
  const firstC = axis === 'h' ? first.n.x + first.w / 2 : first.n.y + first.h / 2
  const lastC = axis === 'h' ? last.n.x + last.w / 2 : last.n.y + last.h / 2
  const step = (lastC - firstC) / (boxes.length - 1)
  return boxes.map(({ n, w, h }, i) => {
    const center = firstC + step * i
    return axis === 'h'
      ? { id: n.id, x: Math.round((center - w / 2) / 8) * 8, y: n.y }
      : { id: n.id, x: n.x, y: Math.round((center - h / 2) / 8) * 8 }
  })
}

export interface GuideHit {
  x?: number
  y?: number
  guideX?: number
  guideY?: number
}

/**
 * The other symbols' geometry, resolved once.
 *
 * `snapGuides` is called on every pointermove of a drag, and the symbols it
 * measures against do not move while one symbol is being dragged. Re-deriving
 * their sizes (a catalog lookup and a rotation test each) and re-scanning the
 * whole edge list per move cost 0.25 ms/move at 1,000 symbols, all of it the
 * same answer as the move before. Build this at grab time instead.
 *
 * Keyed by the `nodes`/`edges` arrays it was built from: the store is
 * immutable, so a stale index is a reference mismatch away from being caught.
 */
export interface SnapIndex {
  nodes: PlantNode[]
  edges: PlantEdge[] | undefined
  boxes: { id: string; x: number; y: number; w: number; h: number }[]
  byId: Map<string, PlantNode>
  /** Only the lines with a port end on a given node — the rest can never
   *  contribute a port alignment for a drag of that node. */
  edgesByNode: Map<string, PlantEdge[]>
}

export function buildSnapIndex(nodes: PlantNode[], edges?: PlantEdge[]): SnapIndex {
  const boxes = nodes.map((n) => {
    const { w, h } = sizeOf(n)
    return { id: n.id, x: n.x, y: n.y, w, h }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edgesByNode = new Map<string, PlantEdge[]>()
  for (const e of edges ?? []) {
    for (const end of [e.source, e.target]) {
      if (!isPortEnd(end)) continue
      const list = edgesByNode.get(end.nodeId)
      if (list) list.push(e)
      else edgesByNode.set(end.nodeId, [e])
    }
  }
  return { nodes, edges, boxes, byId, edgesByNode }
}

/**
 * Suggest a snapped position when the dragged node's edges/centers align with
 * others. When `edges` is given, alignment of CONNECTED PORTS takes priority
 * with a wider window (and may land off-grid): a transmitter dropped roughly
 * above a nozzle clicks into the exact position that lets its line run dead
 * straight — box centers can't do this because a 40px bubble and a 48px
 * vessel never share a center on the 8px grid.
 *
 * Pass `index` (from `buildSnapIndex`) to reuse the resolved geometry across a
 * drag. Without it one is built per call, which is what tests and one-shot
 * callers want.
 */
export function snapGuides(
  dragged: PlantNode,
  others: PlantNode[],
  tolerance = 4,
  edges?: PlantEdge[],
  portTolerance = 8,
  index?: SnapIndex,
): GuideHit {
  const ix =
    index && index.nodes === others && index.edges === edges ? index : buildSnapIndex(others, edges)
  const d = sizeOf(dragged)
  const out: GuideHit = {}
  let bestDx = tolerance + 1
  let bestDy = tolerance + 1

  // Scratch arrays, allocated once per call rather than twice per candidate
  // symbol: at 1,000 symbols the old form churned ~10,000 short-lived arrays
  // per pointermove, which is GC pressure inside the drag loop.
  const dragX = [dragged.x, dragged.x + d.w / 2, dragged.x + d.w]
  const dragY = [dragged.y, dragged.y + d.h / 2, dragged.y + d.h]
  const subX = [0, d.w / 2, d.w]
  const subY = [0, d.h / 2, d.h]

  for (const o of ix.boxes) {
    if (o.id === dragged.id) continue
    for (let j = 0; j < 3; j++) {
      const ox = j === 0 ? o.x : j === 1 ? o.x + o.w / 2 : o.x + o.w
      for (let i = 0; i < 3; i++) {
        const delta = Math.abs(dragX[i]! - ox)
        if (delta < bestDx && delta <= tolerance) {
          bestDx = delta
          out.x = ox - subX[i]!
          out.guideX = ox
        }
      }
      const oy = j === 0 ? o.y : j === 1 ? o.y + o.h / 2 : o.y + o.h
      for (let i = 0; i < 3; i++) {
        const delta = Math.abs(dragY[i]! - oy)
        if (delta < bestDy && delta <= tolerance) {
          bestDy = delta
          out.y = oy - subY[i]!
          out.guideY = oy
        }
      }
    }
  }

  if (edges) {
    let bestPx = portTolerance + 1
    let bestPy = portTolerance + 1
    for (const e of ix.edgesByNode.get(dragged.id) ?? []) {
      for (let k = 0; k < 2; k++) {
        const mine = k === 0 ? e.source : e.target
        const far = k === 0 ? e.target : e.source
        if (!isPortEnd(mine) || mine.nodeId !== dragged.id) continue
        const pa = portWorld(dragged, mine.portId)
        const pb = isPortEnd(far)
          ? far.nodeId === dragged.id
            ? null
            : portWorld(ix.byId.get(far.nodeId) ?? dragged, far.portId)
          : { x: far.x, y: far.y }
        if (!pa || !pb) continue
        const ddx = Math.abs(pa.x - pb.x)
        const ddy = Math.abs(pa.y - pb.y)
        // Align across the axis the line runs along; skip when the ports are
        // basically coincident (nothing to straighten).
        if (ddx > 0 && ddx <= portTolerance && ddy > portTolerance && ddx < bestPx) {
          bestPx = ddx
          out.x = dragged.x + (pb.x - pa.x)
          out.guideX = pb.x
        }
        if (ddy > 0 && ddy <= portTolerance && ddx > portTolerance && ddy < bestPy) {
          bestPy = ddy
          out.y = dragged.y + (pb.y - pa.y)
          out.guideY = pb.y
        }
      }
    }
  }
  return out
}
