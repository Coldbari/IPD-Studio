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
import { portDirection, rotateDir } from './shapes'

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

/**
 * The only pairing a magnet refuses is two ports pointing the SAME way: that
 * stands the symbol on the wrong side of the nozzle it just connected to,
 * with its own inlet facing away and its body lying over the target.
 *
 * Head-on (left/right) and square-on (a vertical symbol meeting a horizontal
 * one) are both ordinary P&ID hookups and both dock — an earlier rule here
 * demanded exactly-opposite directions, which quietly refused every
 * perpendicular pairing and made instrument bubbles, whose four ports face
 * four different ways, look as though docking simply did not work.
 *
 * Ports with no catalog direction (user-added pins) put no constraint on it.
 */
function facing(moving: PlantNode, movingPortId: string, target: PlantNode, targetPortId: string): boolean {
  const a = portDirection(moving.symbolId, movingPortId)
  const b = portDirection(target.symbolId, targetPortId)
  if (!a || !b) return true
  return rotateDir(a, moving.rotation) !== rotateDir(b, target.rotation)
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

/**
 * Every connection point on the sheet, resolved once.
 *
 * Docking is asked for on EVERY pointermove of a symbol drag, and the answer
 * depends on where the dragged symbol is — but the thing being searched, the
 * other symbols' ports, does not move at all during that gesture. Resolving
 * them per move made the drag cost O(nodes x ports) sixty-plus times a second:
 * measured at 0.84 ms/move on a 500-symbol sheet and 2.0 ms at 2,000, all of
 * it re-deriving an answer that had not changed.
 *
 * Build it once when the gesture starts and hand it to `findDock`. It is keyed
 * by the `nodes`/`edges` arrays it came from, and the store is immutable, so a
 * caller can tell a stale index from a live one by reference alone.
 */
export interface DockIndex {
  nodes: PlantNode[]
  edges: PlantEdge[]
  /** Grid cell -> the ports inside it. Cell is DOCK_CELL px square. */
  grid: Map<number, PortRef[]>
  byId: Map<string, PlantNode>
  /** Node id -> the nodes it already has a line to. Docking is refused per
   *  PAIR OF SYMBOLS, not per pair of ports: an instrument bubble has four
   *  ports, so two bubbles joined on one of them still had fifteen other
   *  pairings left, and every one of them grabbed the symbol back as the user
   *  tried to drag it away from the connection they had just made. */
  neighbours: Map<string, Set<string>>
}

/** Grid cell for the port lookup, in sheet px. Comfortably larger than
 *  MAX_SHEET_RADIUS so a 3x3 neighbourhood always covers the whole reach. */
const DOCK_CELL = 64

const cellKey = (x: number, y: number) => Math.floor(x / DOCK_CELL) * 100_000 + Math.floor(y / DOCK_CELL)

export function buildDockIndex(nodes: PlantNode[], edges: PlantEdge[]): DockIndex {
  const grid = new Map<number, PortRef[]>()
  const byId = new Map<string, PlantNode>()
  const neighbours = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    const set = neighbours.get(a)
    if (set) set.add(b)
    else neighbours.set(a, new Set([b]))
  }
  for (const e of edges) {
    if (!isPortEnd(e.source) || !isPortEnd(e.target)) continue
    link(e.source.nodeId, e.target.nodeId)
    link(e.target.nodeId, e.source.nodeId)
  }
  for (const node of nodes) {
    byId.set(node.id, node)
    for (const p of portsOf(node)) {
      const at = portWorld(node, p.id)
      if (!at) continue
      const ref: PortRef = { nodeId: node.id, portId: p.id, kind: p.kind, x: at.x, y: at.y }
      const k = cellKey(at.x, at.y)
      const bucket = grid.get(k)
      if (bucket) bucket.push(ref)
      else grid.set(k, [ref])
    }
  }
  return { nodes, edges, grid, byId, neighbours }
}

/**
 * The best port pairing for `moving` at its current x/y, or null when nothing
 * is in reach. `moving` may be a node that does not exist on the sheet yet
 * (a palette drag in flight); `others` is simply scanned for a different id.
 *
 * Pairs that are already joined are skipped, so nudging a symbol that is
 * docked doesn't stack a second identical line on top of the first.
 *
 * Pass `index` (from `buildDockIndex`) to reuse a resolved port set across a
 * whole drag; without it one is built for this call, which is what the tests
 * and one-shot callers want.
 */
export function findDock(
  moving: PlantNode,
  others: PlantNode[],
  edges: PlantEdge[],
  activeLineClass: LineClass,
  radius: number,
  /** Pairings to skip: either a `dockKey` or a bare node id (everything on
   *  that symbol), both used to hold off what the user has just shaken away. */
  refuse?: ReadonlySet<string>,
  index?: DockIndex,
): Dock | null {
  const mine = portsOf(moving)
  if (!mine.length) return null

  const ix = index && index.nodes === others && index.edges === edges ? index : buildDockIndex(others, edges)
  const { grid, byId, neighbours } = ix
  const wired = neighbours.get(moving.id)

  let best: Dock | null = null
  let bestDistance = radius
  const seen = new Set<PortRef>()
  for (const mp of mine) {
    const from = portWorld(moving, mp.id)
    if (!from) continue
    // Only the 3x3 cells around the port can hold anything within reach.
    seen.clear()
    const cx = Math.floor(from.x / DOCK_CELL)
    const cy = Math.floor(from.y / DOCK_CELL)
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(gx * 100_000 + gy)
        if (bucket) for (const t of bucket) seen.add(t)
      }
    }
    for (const t of seen) {
      if (t.nodeId === moving.id) continue
      const d = Math.hypot(t.x - from.x, t.y - from.y)
      if (d > bestDistance) continue
      if (!compatibleKinds(mp.kind, t.kind)) continue
      if (wired?.has(t.nodeId)) continue
      const key = `${mp.id}|${t.nodeId}/${t.portId}`
      if (refuse?.has(key) || refuse?.has(t.nodeId)) continue
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
/** The ring is the same element every frame; two querySelector sweeps of a
 *  many-thousand-node SVG per pointermove is not the way to move it. */
const HINTS = new WeakMap<dia.Paper, { layer: Element; ring: SVGCircleElement }>()

export function showDockHint(paper: dia.Paper, at: { x: number; y: number } | null): void {
  let held = HINTS.get(paper)
  if (!held || !held.layer.isConnected) {
    const layer = paper.svg.querySelector('.joint-layers')
    if (!layer) return
    const ring = document.createElementNS(NS, 'circle')
    ring.setAttribute('class', HINT_CLASS)
    ring.setAttribute('r', '7')
    ring.setAttribute('pointer-events', 'none')
    held = { layer, ring }
    HINTS.set(paper, held)
  }
  if (!at) {
    held.ring.remove()
    return
  }
  held.ring.setAttribute('cx', String(at.x))
  held.ring.setAttribute('cy', String(at.y))
  if (!held.ring.isConnected) held.layer.appendChild(held.ring)
}

const FLASH_MS = 450

/**
 * A one-shot ring at a connection point, announcing what just happened to it.
 * Several can be in flight at once — shaking a symbol free of four lines
 * marks all four — and each takes itself down.
 */
function flash(paper: dia.Paper, at: { x: number; y: number }, kind: 'made' | 'cut'): void {
  const layer = paper.svg.querySelector('.joint-layers')
  if (!layer) return
  const mark = document.createElementNS(NS, 'circle')
  mark.setAttribute('class', `pid-dock-${kind}`)
  mark.setAttribute('r', '10')
  mark.setAttribute('cx', String(at.x))
  mark.setAttribute('cy', String(at.y))
  mark.setAttribute('pointer-events', 'none')
  layer.appendChild(mark)
  window.setTimeout(() => mark.remove(), FLASH_MS)
}

/** Red flash where a shaken-off line used to land: the connection is gone,
 *  and the symbol is still in hand to try somewhere else. */
export function flashDockCut(paper: dia.Paper, at: { x: number; y: number }): void {
  flash(paper, at, 'cut')
}

/** Green flash the instant a line is made, so "did that connect?" is never a
 *  question the user has to answer by dragging the symbol away and looking. */
export function flashDockMade(paper: dia.Paper, at: { x: number; y: number }): void {
  flash(paper, at, 'made')
}
