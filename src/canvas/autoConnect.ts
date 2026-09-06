// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Magnetic docking — connect by touching, not by drawing.
 *
 * Bring a symbol's connection point close to another symbol's connection
 * point and let go: the symbol clicks into place so the two points coincide
 * exactly, and the line between them is created for you. Because the line
 * stores PORTS and not coordinates, pulling the symbols apart afterwards
 * stretches the pipe instead of breaking it.
 *
 * Used from two places, one gesture each:
 *   - dropHandling.ts  — a symbol dragged in from the palette
 *   - interactions.ts  — a symbol already on the sheet, dragged by hand
 */

import type { dia } from '@joint/core'
import type { LineClass, PlantEdge, PlantNode } from '../model/types'
import { isPortEnd } from '../model/types'
import type { PortKind } from '../symbols/types'
import { getSymbol } from '../symbols/registry'
import { portWorld } from './alignment'
import { compatibleKinds, pickLineClass } from './connectionRules'
import { type Direction, portDirection, rotateDir } from './shapes'

/**
 * How near a port has to come before it docks, in SCREEN px — the distance is
 * judged by what the user sees, so the reach feels the same zoomed in or out.
 * Clamped in sheet space so an extreme zoom can't make it either unhittable
 * or grabby enough to swallow neighbouring symbols.
 */
export const DOCK_SCREEN_PX = 18
const MIN_SHEET_RADIUS = 6
const MAX_SHEET_RADIUS = 48

export function dockRadius(scale: number): number {
  const s = scale > 0 ? scale : 1
  return Math.min(MAX_SHEET_RADIUS, Math.max(MIN_SHEET_RADIUS, DOCK_SCREEN_PX / s))
}

/**
 * Gap left between the two connection points when a symbol docks — three grid
 * squares of real, visible pipe. Landing the points on top of each other read
 * as "nothing happened": the symbols butted together and hid the line behind
 * themselves, so there was no way to tell a connection from a near miss.
 */
export const DOCK_STANDOFF = 24

const OPPOSITE: Record<Direction, Direction> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }

/**
 * A magnet only joins ports that FACE each other, so the pipe leaves one
 * head-on and arrives head-on at the other. Two ports pointing the same way
 * would stand the symbol on the wrong side of the one it docked onto — its
 * inlet pointing away from the nozzle it just connected to. Ports with no
 * catalog direction (user-added pins) put no constraint on the pairing.
 */
function facing(moving: PlantNode, movingPortId: string, target: PlantNode, targetPortId: string): boolean {
  const a = portDirection(moving.symbolId, movingPortId)
  const b = portDirection(target.symbolId, targetPortId)
  if (!a || !b) return true
  return rotateDir(a, moving.rotation) === OPPOSITE[rotateDir(b, target.rotation)]
}

/** Which way the pipe leaves the port that was landed on. */
function standoff(target: PlantNode, portId: string, approach: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const dir = portDirection(target.symbolId, portId)
  if (dir) {
    switch (rotateDir(dir, target.rotation)) {
      case 'left': return { x: -DOCK_STANDOFF, y: 0 }
      case 'right': return { x: DOCK_STANDOFF, y: 0 }
      case 'top': return { x: 0, y: -DOCK_STANDOFF }
      case 'bottom': return { x: 0, y: DOCK_STANDOFF }
    }
  }
  // A user-added pin has no catalog direction: stand off on the side the
  // symbol arrived from, so it never jumps across to the far side.
  const dx = approach.x - to.x
  const dy = approach.y - to.y
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: dx >= 0 ? DOCK_STANDOFF : -DOCK_STANDOFF, y: 0 }
    : { x: 0, y: dy >= 0 ? DOCK_STANDOFF : -DOCK_STANDOFF }
}

export interface Dock {
  /** Port on the symbol being moved. */
  movingPortId: string
  targetNodeId: string
  targetPortId: string
  /** Where the moving symbol has to sit for the two ports to coincide. */
  x: number
  y: number
  /** The port that was landed on — where the hint ring is drawn and where
   *  the line ends. */
  at: { x: number; y: number }
  /** Where the moving symbol's own port sits once docked: one standoff away
   *  from `at`, so a real length of pipe shows between them. */
  portAt: { x: number; y: number }
  lineClass: LineClass
}

/** A compatible symbol port close to an existing edge's unconnected point end. */
export interface FreeEndDock {
  movingPortId: string
  edgeId: string
  end: 'source' | 'target'
  /** Where the moving symbol has to sit for its port to meet the free end. */
  x: number
  y: number
  at: { x: number; y: number }
}

/** Identifies a port pairing, for refusing one the user has shaken off. */
export function dockKey(dock: Pick<Dock, 'movingPortId' | 'targetNodeId' | 'targetPortId'>): string {
  return `${dock.movingPortId}|${dock.targetNodeId}/${dock.targetPortId}`
}

interface PortRef {
  nodeId: string
  portId: string
  kind: PortKind
  x: number
  y: number
}

/** Catalog ports plus any user-added pins. Unknown symbols have none. */
function portsOf(node: PlantNode): { id: string; kind: PortKind }[] {
  try {
    return [...getSymbol(node.symbolId).ports, ...(node.extraPorts ?? [])].map((p) => ({
      id: p.id,
      kind: p.kind,
    }))
  } catch {
    return []
  }
}

const endKey = (end: PlantEdge['source']): string =>
  isPortEnd(end) ? `${end.nodeId}/${end.portId}` : ''

/**
 * The best port pairing for `moving` at its current x/y, or null when nothing
 * is in reach. `moving` may be a node that does not exist on the sheet yet
 * (a palette drag in flight); `others` is simply scanned for a different id.
 *
 * Pairs that are already joined are skipped, so nudging a symbol that is
 * docked doesn't stack a second identical line on top of the first.
 */
export function findDock(
  moving: PlantNode,
  others: PlantNode[],
  edges: PlantEdge[],
  activeLineClass: LineClass,
  radius: number,
  refuse?: ReadonlySet<string>,
): Dock | null {
  const mine = portsOf(moving)
  if (!mine.length) return null

  // Equipment is positioned deliberately — dragging a tank or pump around
  // must never snap it onto another symbol. Only smaller components (valves,
  // instruments, fittings) dock onto a connection point while being moved.
  if (moving.kind === 'equipment') return null

  const joined = new Set<string>()
  for (const e of edges) {
    const a = endKey(e.source)
    const b = endKey(e.target)
    if (a && b) {
      joined.add(`${a}|${b}`)
      joined.add(`${b}|${a}`)
    }
  }

  // Resolve every candidate port once, not once per port of the moving symbol.
  const targets: PortRef[] = []
  const byId = new Map<string, PlantNode>()
  for (const other of others) {
    if (other.id === moving.id) continue
    byId.set(other.id, other)
    for (const p of portsOf(other)) {
      const at = portWorld(other, p.id)
      if (at) targets.push({ nodeId: other.id, portId: p.id, kind: p.kind, x: at.x, y: at.y })
    }
  }

  let best: Dock | null = null
  let bestDistance = radius
  for (const mp of mine) {
    const from = portWorld(moving, mp.id)
    if (!from) continue
    for (const t of targets) {
      const d = Math.hypot(t.x - from.x, t.y - from.y)
      if (d > bestDistance) continue
      if (!compatibleKinds(mp.kind, t.kind)) continue
      if (joined.has(`${moving.id}/${mp.id}|${t.nodeId}/${t.portId}`)) continue
      const key = `${mp.id}|${t.nodeId}/${t.portId}`
      if (refuse?.has(key)) continue
      const other = byId.get(t.nodeId)
      if (!other) continue
      if (!facing(moving, mp.id, other, t.portId)) continue
      const off = standoff(other, t.portId, from, t)
      const portAt = { x: t.x + off.x, y: t.y + off.y }
      bestDistance = d
      best = {
        movingPortId: mp.id,
        targetNodeId: t.nodeId,
        targetPortId: t.portId,
        x: Math.round(moving.x + portAt.x - from.x),
        y: Math.round(moving.y + portAt.y - from.y),
        at: { x: t.x, y: t.y },
        portAt,
        lineClass: pickLineClass(mp.kind, t.kind, activeLineClass),
      }
    }
  }
  return best
}

/**
 * Find the nearest unconnected line end that a symbol can accept.
 *
 * A free end has no stored port kind, so its line family is the contract:
 * process/pipe lines accept process ports and signal/internal lines accept
 * signal ports. Only PointEnd values are considered; a line's middle is
 * intentionally left to the explicit branch-tap gesture.
 */
export function findFreeEndDock(moving: PlantNode, edges: PlantEdge[], radius: number): FreeEndDock | null {
  const mine = portsOf(moving)
  if (!mine.length) return null

  let best: FreeEndDock | null = null
  let bestDistance = radius
  for (const edge of edges) {
    const required: PortKind = edge.lineClass.startsWith('process') || edge.lineClass.startsWith('pipe')
      ? 'process'
      : 'signal'
    for (const end of ['source', 'target'] as const) {
      const point = edge[end]
      if (isPortEnd(point)) continue
      for (const mp of mine) {
        const from = portWorld(moving, mp.id)
        if (!from) continue
        const distance = Math.hypot(point.x - from.x, point.y - from.y)
        if (distance > bestDistance || !compatibleKinds(mp.kind, required)) continue
        bestDistance = distance
        best = {
          movingPortId: mp.id,
          edgeId: edge.id,
          end,
          x: Math.round(moving.x + point.x - from.x),
          y: Math.round(moving.y + point.y - from.y),
          at: { x: point.x, y: point.y },
        }
      }
    }
  }
  return best
}

/** The edge a dock creates, ready for addBatch/dockNode. */
export function dockEdge(movingId: string, dock: Dock): Omit<PlantEdge, 'id'> {
  return {
    lineClass: dock.lineClass,
    source: { nodeId: movingId, portId: dock.movingPortId },
    target: { nodeId: dock.targetNodeId, portId: dock.targetPortId },
  }
}

const HINT_CLASS = 'pid-dock-hint'
const NS = 'http://www.w3.org/2000/svg'

/**
 * Ring at the point the drag will dock onto — the visible promise that
 * letting go connects. Lives inside `.joint-layers`, the group carrying the
 * pan/zoom transform, so it sits on the sheet rather than on the viewport.
 * Passing null takes it down.
 */
export function showDockHint(paper: dia.Paper, at: { x: number; y: number } | null): void {
  const layer = paper.svg.querySelector('.joint-layers')
  if (!layer) return
  const existing = layer.querySelector(`.${HINT_CLASS}`) as SVGCircleElement | null
  if (!at) {
    existing?.remove()
    return
  }
  const ring = existing ?? document.createElementNS(NS, 'circle')
  ring.setAttribute('class', HINT_CLASS)
  ring.setAttribute('r', '7')
  ring.setAttribute('cx', String(at.x))
  ring.setAttribute('cy', String(at.y))
  ring.setAttribute('pointer-events', 'none')
  if (!existing) layer.appendChild(ring)
}

const CUT_CLASS = 'pid-dock-cut'
const CUT_MS = 450

/** Red flash where a shaken-off line used to land: the connection is gone,
 *  and the symbol is still in hand to try somewhere else. */
export function flashDockCut(paper: dia.Paper, at: { x: number; y: number }): void {
  const layer = paper.svg.querySelector('.joint-layers')
  if (!layer) return
  layer.querySelector(`.${CUT_CLASS}`)?.remove()
  const mark = document.createElementNS(NS, 'circle')
  mark.setAttribute('class', CUT_CLASS)
  mark.setAttribute('r', '10')
  mark.setAttribute('cx', String(at.x))
  mark.setAttribute('cy', String(at.y))
  mark.setAttribute('pointer-events', 'none')
  layer.appendChild(mark)
  window.setTimeout(() => mark.remove(), CUT_MS)
}
