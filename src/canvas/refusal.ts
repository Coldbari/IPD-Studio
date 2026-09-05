// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { dia } from '@joint/core'
import { getSymbol } from '../symbols/registry'
import type { PlantNode } from '../model/types'
import type { PortKind } from '../symbols/types'
import { portWorld } from './alignment'
import { labelOfPort, nodeRef } from '../symbols/portLabels'
import { explainConnection, type ConnectionEnd, type ConnectionRefusal } from './connectionRules'

const NS = 'http://www.w3.org/2000/svg'

/** How long a refusal stays up. Longer than the 450 ms dock flash: this one
 *  carries a sentence to read, not just a colour to notice. */
const REFUSAL_MS = 2600

/** How near a drop has to land to count as aimed at a connection point.
 *  Matches the paper's own `snapLinks` radius — if the link would have snapped
 *  there had the kinds allowed it, then that is the point the user meant. */
export const REFUSAL_RADIUS = 24

/**
 * Say no, where the user was looking.
 *
 * A refused connection used to do nothing visible at all — and worse than
 * nothing to the document: the drag ended as a free-ended line pointing at
 * the nozzle that had just rejected it, which reads at a glance like a
 * connection. Nineteen alerts elsewhere in the app and none here, on the one
 * failure an engineer hits while actually drawing.
 *
 * A dialog would be the wrong instrument. The user's eyes are on a point on
 * the sheet, the mouse button has just come up, and the answer is one
 * sentence — so the answer goes on the sheet, at that point, in the same
 * red the shake-to-disconnect flash already uses. Level 1 of the feedback
 * ladder, not level 4.
 */
export function showRefusal(
  paper: dia.Paper,
  at: { x: number; y: number },
  refusal: ConnectionRefusal,
): void {
  const layer = paper.svg.querySelector('.joint-layers')
  if (!layer) return

  const g = document.createElementNS(NS, 'g')
  g.setAttribute('class', 'pid-refusal')
  g.setAttribute('pointer-events', 'none')

  const ring = document.createElementNS(NS, 'circle')
  ring.setAttribute('class', 'pid-refusal-ring')
  ring.setAttribute('r', '9')
  ring.setAttribute('cx', String(at.x))
  ring.setAttribute('cy', String(at.y))

  // A slash through the ring, so the mark reads as a refusal at a glance and
  // not merely as another highlight — colour alone is not a message.
  const bar = document.createElementNS(NS, 'line')
  bar.setAttribute('class', 'pid-refusal-bar')
  bar.setAttribute('x1', String(at.x - 6.4))
  bar.setAttribute('y1', String(at.y - 6.4))
  bar.setAttribute('x2', String(at.x + 6.4))
  bar.setAttribute('y2', String(at.y + 6.4))

  // The label is drawn in SCREEN px: the sheet may be at 20% or 400%, and a
  // sentence that scales with the drawing is unreadable at one end and absurd
  // at the other. Counter-scaling keeps it the same size at every zoom.
  const scale = paper.scale().sx || 1
  const label = document.createElementNS(NS, 'g')
  label.setAttribute('transform', `translate(${at.x} ${at.y}) scale(${1 / scale})`)

  const text = document.createElementNS(NS, 'text')
  text.setAttribute('class', 'pid-refusal-text')
  text.setAttribute('x', '14')
  text.setAttribute('y', '-10')
  text.textContent = refusal.title

  const plate = document.createElementNS(NS, 'rect')
  plate.setAttribute('class', 'pid-refusal-plate')
  plate.setAttribute('rx', '3')

  label.appendChild(plate)
  label.appendChild(text)
  g.appendChild(ring)
  g.appendChild(bar)
  g.appendChild(label)
  layer.appendChild(g)

  // Measured after it is in the document, because the width of the plate is
  // the width the text turned out to be.
  try {
    const b = text.getBBox()
    plate.setAttribute('x', String(b.x - 5))
    plate.setAttribute('y', String(b.y - 3))
    plate.setAttribute('width', String(b.width + 10))
    plate.setAttribute('height', String(b.height + 6))
  } catch {
    // jsdom and a detached paper have no layout; the plate just stays unsized
  }

  window.setTimeout(() => g.remove(), REFUSAL_MS)
}

interface PortHit {
  node: PlantNode
  portId: string
  kind: PortKind
  at: { x: number; y: number }
}

/**
 * The connection point nearest a sheet position, within reach.
 *
 * Runs once, on a drop that produced a free end — never inside the drag loop,
 * so it costs nothing per frame. `extraPorts` are included because a
 * user-placed pin is as real a target as a catalogue one.
 */
export function portNear(
  point: { x: number; y: number },
  nodes: readonly PlantNode[],
  radius = REFUSAL_RADIUS,
  exceptNodeId?: string,
): PortHit | null {
  let best: PortHit | null = null
  let bestDist = radius
  for (const node of nodes) {
    if (node.id === exceptNodeId) continue
    let ports: { id: string; kind: PortKind }[]
    try {
      ports = getSymbol(node.symbolId).ports
    } catch {
      continue // a symbol the catalogue no longer has; nothing to aim at
    }
    const all = node.extraPorts ? [...ports, ...node.extraPorts] : ports
    for (const p of all) {
      const w = portWorld(node, p.id)
      if (!w) continue
      const d = Math.hypot(w.x - point.x, w.y - point.y)
      if (d < bestDist) {
        bestDist = d
        best = { node, portId: p.id, kind: p.kind, at: w }
      }
    }
  }
  return best
}

/**
 * Did this drop LAND on something that refused it?
 *
 * A free end is a legitimate thing to draw — a vent, an off-page run — so the
 * mere fact of one is not a failure. It is a failure only when a connection
 * point was right there and would not take the line. That distinction is what
 * keeps this from crying wolf over every deliberate open end.
 */
export function refusalAt(
  point: { x: number; y: number },
  nodes: readonly PlantNode[],
  sourceKind: PortKind | null,
  sourceEnd?: { nodeId: string; portId: string },
): { refusal: ConnectionRefusal; at: { x: number; y: number } } | null {
  if (!sourceKind) return null
  const hit = portNear(point, nodes, REFUSAL_RADIUS, undefined)
  if (!hit) return null
  const from = sourceEnd ? nodes.find((n) => n.id === sourceEnd.nodeId) : undefined
  const refusal = explainConnection(
    sourceKind,
    hit.kind,
    hit.node.id === sourceEnd?.nodeId,
    // Both ends or neither: a message that names one point and calls the
    // other "the other" is worse than the one that names neither.
    endsOf(from, sourceEnd?.portId, hit.node, hit.portId),
  )
  return refusal ? { refusal, at: hit.at } : null
}

/**
 * The two ends in words, or nothing.
 *
 * `labelOfPort` returns null for a user-added pin — the app did not place it
 * and has no word for it — and for a symbol the catalogue has lost. Either
 * way this returns undefined and the caller falls back to the explanation
 * that names no points, which is still entirely true.
 */
function endsOf(
  from: PlantNode | undefined,
  fromPort: string | undefined,
  to: PlantNode,
  toPort: string,
): { source: ConnectionEnd; target: ConnectionEnd } | undefined {
  if (!from || !fromPort) return undefined
  const a = nodeRef(from)
  const b = nodeRef(to)
  const pa = labelOfPort(from, fromPort)
  const pb = labelOfPort(to, toPort)
  if (!a || !b || !pa || !pb) return undefined
  return { source: { symbol: a, port: pa.text }, target: { symbol: b, port: pb.text } }
}
