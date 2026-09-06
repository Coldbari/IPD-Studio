// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { canvasRef, fitView, zoomActual } from './paperSetup'
import { dia, g, highlighters, linkTools } from '@joint/core'
import { ulid } from 'ulid'
import type { PlantEdge, PlantNode } from '../model/types'
import { isJunctionEnd, isPortEnd } from '../model/types'
import type { PortKind } from '../symbols/types'
import { canConnect, compatibleKinds, pickLineClass } from './connectionRules'
import { alignNodes, distributeNodes, localPortPoint, portWorld, snapGuides } from './alignment'
import { type Dock, dockEdge, dockKey, dockRadius, findDock, flashDockCut, showDockHint } from './autoConnect'
import { cleanVertices, straightenDanglingRoute } from './vertexClean'
import { makeLink, refreshLinkRouter, routerNameFor } from './shapes'
import { strokeFor } from './lineStyle'
import { getSymbol } from '../symbols/registry'
import { createShakeDetector } from './shake'
import { activeSheet, pauseHistory, resumeHistory, useStore } from '../store/store'

const snap8 = (v: number) => Math.round(v / 8) * 8

/** Quiet spell after a shake, so the tail of the waggle docks nothing. */
const SHAKE_COOLOFF_MS = 600

type PortKinds = Record<string, PortKind>
type Point = { x: number; y: number }
type PipeTap = {
  edge: PlantEdge
  point: Point
  horizontal: boolean
  ratio: number
}

function kindFromCell(cell: dia.Cell | undefined, portId: string | null | undefined): PortKind | null {
  if (!cell || !portId) return null
  const kinds = (cell.get('data') as { portKinds?: PortKinds } | undefined)?.portKinds
  return kinds?.[portId] ?? null
}

function portKindOf(cellView: dia.CellView, magnet: SVGElement | undefined): PortKind | null {
  // The port id may sit on the magnet itself or on the port's container group.
  const portId = magnet?.getAttribute('port') ?? magnet?.closest('[port]')?.getAttribute('port')
  return kindFromCell(cellView.model, portId)
}

export function attachInteractions(paper: dia.Paper, graph: dia.Graph): () => void {
  const store = () => useStore.getState()
  let clipboard: { nodes: PlantNode[]; edges: PlantEdge[] } | null = null

  // --- link drawing -------------------------------------------------------
  paper.options.defaultLink = () =>
    makeLink({
      id: `draft-${Date.now()}`,
      lineClass: store().activeLineClass,
      source: { x: 0, y: 0 },
      target: { x: 0, y: 0 },
    })

  // While a pin placement is armed, port halos must not swallow the click by
  // starting a link — the click is aimed at the symbol surface.
  paper.options.validateMagnet = () => !store().armPin

  // Any port pairing that some line class could join is allowed; the class
  // itself is picked at commit time so users never have to pre-select it.
  paper.options.validateConnection = (srcView, srcMagnet, tgtView, tgtMagnet) => {
    const src = portKindOf(srcView as dia.CellView, srcMagnet as SVGElement)
    const tgt = portKindOf(tgtView as dia.CellView, tgtMagnet as SVGElement)
    if (!src || !tgt) return false
    if (srcView === tgtView) return false
    return compatibleKinds(src, tgt)
  }

  /** Sheet-local position of an edge end, for the accidental-stub check. */
  const endPoint = (e: dia.Link.EndJSON): { x: number; y: number } | null => {
    if (e.id) {
      const cell = graph.getCell(e.id)
      if (!cell || !cell.isElement() || !e.port) return null
      const rel = (cell as dia.Element).getPortsPositions('p')[String(e.port)]
      const pos = (cell as dia.Element).position()
      return rel ? { x: pos.x + rel.x, y: pos.y + rel.y } : pos
    }
    if (typeof e.x === 'number' && typeof e.y === 'number') return { x: e.x, y: e.y }
    return null
  }

  /** Find a committed line under a sheet point (for branch taps). */
  const pipeAt = (pt: Point, exclude = new Set<string>()): PipeTap | null => {
    const sheet = activeSheet(store())
    let best: PipeTap | null = null
    // Match the visible stroke/wrapper rather than requiring a pixel-perfect
    // click. Every limb in a logical branch is a valid tap target.
    let bestDistance = 12
    for (const e of sheet.edges) {
      if (exclude.has(e.id)) continue
      const cell = graph.getCell(e.id) as dia.Link | undefined
      const view = cell ? (cell.findView(paper) as dia.LinkView | null) : null
      const conn = view?.getConnection()
      if (!conn) continue
      const cp = conn.closestPoint(new g.Point(pt.x, pt.y))
      if (!cp) continue
      const distance = Math.hypot(cp.x - pt.x, cp.y - pt.y)
      if (distance > bestDistance) continue
      const tangent = conn.closestPointTangent(new g.Point(pt.x, pt.y))
      const dx = tangent ? tangent.end.x - tangent.start.x : 1
      const dy = tangent ? tangent.end.y - tangent.start.y : 0
      const horizontal = Math.abs(dx) >= Math.abs(dy)
      const point = horizontal
        ? { x: snap8(cp.x), y: Math.round(cp.y) }
        : { x: Math.round(cp.x), y: snap8(cp.y) }
      bestDistance = distance
      best = {
        edge: e,
        point,
        horizontal,
        ratio: conn.closestPointNormalizedLength(cp),
      }
    }
    return best
  }

  const orthogonalBend = (start: Point, end: Point, horizontal: boolean): Point[] => {
    if (Math.abs(start.x - end.x) <= 0.5 || Math.abs(start.y - end.y) <= 0.5) return []
    return horizontal ? [{ x: end.x, y: start.y }] : [{ x: start.x, y: end.y }]
  }

  const branchOrientation = (start: Point, end: Point): boolean =>
    Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)

  const edgePoint = (end: PlantEdge['source']): Point | null => {
    if (isJunctionEnd(end)) return { x: end.x, y: end.y }
    if (!isPortEnd(end)) return { x: end.x, y: end.y }
    const node = activeSheet(store()).nodes.find((candidate) => candidate.id === end.nodeId)
    return node ? portWorld(node, end.portId) : null
  }

  const sameLineFamily = (a: PlantEdge, b: PlantEdge) =>
    (a.lineClass.startsWith('process') || a.lineClass.startsWith('pipe')) ===
    (b.lineClass.startsWith('process') || b.lineClass.startsWith('pipe'))

  /** Flatten a link's rendered connection into sheet-space route points. */
  const flattenRoute = (conn: unknown): Point[] => {
    const polys = (conn as { toPolylines?: () => { points?: { x: number; y: number }[] }[] | null } | null)
      ?.toPolylines?.()
    if (!polys) return []
    return polys.flatMap((poly) => (poly.points ?? []).map((pt) => ({ x: pt.x, y: pt.y })))
  }

  /** Keep only the interior points that actually bend a route polyline. */
  const bendsOnly = (points: Point[]): Point[] => {
    const out: Point[] = []
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1]!
      const cur = points[i]!
      const next = points[i + 1]!
      if (Math.hypot(prev.x - cur.x, prev.y - cur.y) < 0.5) continue
      if (Math.hypot(cur.x - next.x, cur.y - next.y) < 0.5) continue
      // A point on the straight line prev->next does not bend the route.
      const dx = next.x - prev.x
      const dy = next.y - prev.y
      const len2 = dx * dx + dy * dy
      if (len2 > 0) {
        const t = ((cur.x - prev.x) * dx + (cur.y - prev.y) * dy) / len2
        if (t > 0 && t < 1) {
          const on = { x: prev.x + t * dx, y: prev.y + t * dy }
          if (Math.hypot(on.x - cur.x, on.y - cur.y) <= 0.5) continue
        }
      }
      out.push({ x: cur.x, y: cur.y })
    }
    return out
  }

  /**
   * Cut the tapped line's RENDERED route at the tap so both halves reproduce
   * its exact geometry — every user-placed waypoint survives. The tap ratio
   * is normalized along the same connection the route is flattened from, so
   * the cut lands on the segment that was actually hit.
   */
  const splitRoute = (tap: PipeTap): { sourceVertices: Point[]; targetVertices: Point[] } => {
    const cell = graph.getCell(tap.edge.id) as dia.Link | undefined
    const view = cell ? (cell.findView(paper) as dia.LinkView | null) : null
    const points = flattenRoute(view?.getConnection())
    if (points.length >= 2) {
      let total = 0
      for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
      }
      let remaining = Math.min(1, Math.max(0, tap.ratio)) * total
      for (let i = 1; i < points.length; i++) {
        remaining -= Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
        if (remaining <= 0 || i === points.length - 1) {
          const before = [...points.slice(0, i), tap.point]
          const after = [tap.point, ...points.slice(i)]
          return { sourceVertices: bendsOnly(before), targetVertices: bendsOnly(after) }
        }
      }
    }
    // No rendered route yet (e.g. mid-render): rebuild from the endpoints.
    const sourcePoint = edgePoint(tap.edge.source)
    const targetPoint = edgePoint(tap.edge.target)
    return {
      sourceVertices: sourcePoint
        ? orthogonalBend(sourcePoint, tap.point, Math.abs(tap.point.x - sourcePoint.x) >= Math.abs(tap.point.y - sourcePoint.y))
        : [],
      targetVertices: targetPoint
        ? orthogonalBend(tap.point, targetPoint, Math.abs(targetPoint.x - tap.point.x) >= Math.abs(targetPoint.y - tap.point.y))
        : [],
    }
  }

  /** Split one routed edge at the exact segment hit by the pointer. */
  const splitTap = (tap: PipeTap) => {
    const tapped = tap.edge
    const junctionId = ulid()
    const junction = { ...tap.point, junctionId }
    // The halves inherit the tapped line's full route, so creating a branch
    // never moves or re-plans the line it taps into.
    const { sourceVertices, targetVertices } = splitRoute(tap)
    const shared = {
      lineClass: tapped.lineClass,
      ...(tapped.lineNumber ? { lineNumber: tapped.lineNumber } : {}),
      ...(tapped.fluidId ? { fluidId: tapped.fluidId } : {}),
    }
    const half1: PlantEdge = {
      id: ulid(),
      ...shared,
      lineGroupId: ulid(),
      routing: 'fixed',
      source: tapped.source,
      target: junction,
      ...(sourceVertices.length ? { vertices: sourceVertices } : {}),
    }
    const half2: PlantEdge = {
      id: ulid(),
      ...shared,
      lineGroupId: ulid(),
      routing: 'fixed',
      source: junction,
      target: tapped.target,
      ...(targetVertices.length ? { vertices: targetVertices } : {}),
      ...(tapped.arrow === 'flow' ? { arrow: 'flow' as const } : {}),
    }
    return { junction, halves: [half1, half2] as [PlantEdge, PlantEdge] }
  }

  /** Drop a new or existing line end onto a pipe, as one atomic topology edit. */
  const commitBranchTap = (
    branchEdge: PlantEdge,
    attach: 'source' | 'target',
    tap: PipeTap,
    deleteEdgeIds: string[] = [],
  ): void => {
    const split = splitTap(tap)
    const connectedBranch: PlantEdge = {
      ...branchEdge,
      // A tap is a new managed line. The tapped line keeps its own identity.
      lineGroupId: ulid(),
      arrow: 'none',
      [attach]: split.junction,
    }
    const otherEnd = attach === 'source' ? connectedBranch.target : connectedBranch.source
    const from = edgePoint(split.junction)
    const to = edgePoint(otherEnd)
    if (from && to) {
      // The bend follows the branch's own approach direction. Using the
      // tapped pipe's orientation makes a vertical branch enter a horizontal
      // pipe from the wrong side (the classic upside-down dogleg).
      connectedBranch.vertices = orthogonalBend(from, to, branchOrientation(from, to))
    }
    connectedBranch.routing = 'fixed'
    store().addBatch([], [...split.halves, connectedBranch], [tap.edge.id, ...deleteEdgeIds])
    store().setSelection([connectedBranch.id])
  }

  const commitDraft = (link: dia.Link) => {
    if (!String(link.id).startsWith('draft-')) return
    const src = link.source()
    const tgt = link.target()
    const toEnd = (e: dia.Link.EndJSON): PlantEdge['source'] | null => {
      if (e.id) {
        if (!e.port) return null
        return { nodeId: String(e.id), portId: String(e.port) }
      }
      if (typeof e.x === 'number' && typeof e.y === 'number') return { x: snap8(e.x), y: snap8(e.y) }
      return null
    }
    const source = toEnd(src)
    const target = toEnd(tgt)
    const srcKind = src.id ? kindFromCell(graph.getCell(src.id), src.port ? String(src.port) : null) : null
    const tgtKind = tgt.id ? kindFromCell(graph.getCell(tgt.id), tgt.port ? String(tgt.port) : null) : null
    const a = endPoint(src)
    const b = endPoint(tgt)
    link.remove()
    // Refuse fully dangling scribbles; allow one free end (vents, off-page).
    if (!source || !target) return
    if (!isPortEnd(source) && !isPortEnd(target)) return
    // A free-ended stub shorter than ~3 grid squares is a failed drag near a
    // port, not a drawing intention — dropping it prevents ghost lines.
    if ((!isPortEnd(source) || !isPortEnd(target)) && a && b && Math.hypot(a.x - b.x, a.y - b.y) < 24) return
    // A free end dropped onto an existing line becomes a branch tap.
    if (isPortEnd(source) && !isPortEnd(target)) {
      const tap = pipeAt(target)
      if (tap) {
        return commitBranchTap({
          id: ulid(),
          lineClass: tap.edge.lineClass,
          source,
          target,
          ...(tap.edge.fluidId ? { fluidId: tap.edge.fluidId } : {}),
        }, 'target', tap)
      }
    } else if (isPortEnd(target) && !isPortEnd(source)) {
      const tap = pipeAt(source)
      if (tap) {
        return commitBranchTap({
          id: ulid(),
          lineClass: tap.edge.lineClass,
          source,
          target,
          ...(tap.edge.fluidId ? { fluidId: tap.edge.fluidId } : {}),
        }, 'source', tap)
      }
    }
    const id = store().addEdge({
      lineClass: pickLineClass(srcKind, tgtKind, store().activeLineClass),
      source,
      target,
    })
    straightenNewEdge(source, target)
    store().setSelection([id])
  }

  /**
   * If a freshly drawn port-to-port line is a few px off collinear, nudge the
   * lighter node (instrument/valve over equipment) into exact alignment so
   * the line renders straight instead of with a one-grid jog. Symbols of
   * different widths can never both center on the 8px grid, so this nudge —
   * not grid discipline — is what makes in-line hookups come out straight.
   */
  const straightenNewEdge = (source: PlantEdge['source'], target: PlantEdge['target']) => {
    if (!isPortEnd(source) || !isPortEnd(target)) return
    const sheet = activeSheet(store())
    const na = sheet.nodes.find((n) => n.id === source.nodeId)
    const nb = sheet.nodes.find((n) => n.id === target.nodeId)
    if (!na || !nb) return
    const pa = portWorld(na, source.portId)
    const pb = portWorld(nb, target.portId)
    if (!pa || !pb) return
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const mover = na.kind !== 'equipment' ? na : nb.kind !== 'equipment' ? nb : na
    const sign = mover === na ? 1 : -1
    // Run length only needs to dominate the cross offset — side-by-side
    // symbols connect over runs far shorter than a couple of grid squares.
    if (dx !== 0 && Math.abs(dx) <= 6 && Math.abs(dy) > 8 && Math.abs(dy) >= 2 * Math.abs(dx)) {
      store().setNodePos(mover.id, mover.x + sign * dx, mover.y)
    } else if (dy !== 0 && Math.abs(dy) <= 6 && Math.abs(dx) > 8 && Math.abs(dx) >= 2 * Math.abs(dy)) {
      store().setNodePos(mover.id, mover.x, mover.y + sign * dy)
    }
  }

  const onLinkPointerUp = (view: dia.LinkView) => {
    commitDraft(view.model)
  }

  // Port dots are hidden until they matter: hovering a symbol shows its own,
  // and holding a link drag ('pid-linking' on the paper root) shows them all.
  const onMagnetDown = () => paper.el.classList.add('pid-linking')
  const onGlobalPointerUp = () => {
    paper.el.classList.remove('pid-linking')
    // A symbol drag is NOT over yet: this 'pointerup' lands before the
    // compatibility 'mouseup' JointJS listens on, so element:pointerup — which
    // commits the move and closes the docking gesture's undo group — still has
    // to run. Tearing down here would cut that group short and let a shaken-off
    // connection sneak back on at release.
    if (dragStart.size) return
    endDockGesture()
    // safety net: any grouped edit (typing, label drag) ends by now
    resumeHistory()
  }

  // --- branch drawing from a pipe ---------------------------------------
  // Ctrl+drag is deliberately separate from ordinary selection/vertex edits.
  // The preview is raw SVG, never a graph cell, so reconciliation, save/load,
  // undo and selection cannot mistake it for document content.
  type BranchPreview = { group: SVGGElement; paths: SVGPathElement[] }
  let branchGesture: {
    start: PipeTap
    preview: BranchPreview
  } | null = null

  const previewPath = (start: PipeTap, end: Point) => start.horizontal
    ? `M ${start.point.x} ${start.point.y} V ${end.y} H ${end.x}`
    : `M ${start.point.x} ${start.point.y} H ${end.x} V ${end.y}`

  const createBranchPreview = (start: PipeTap): BranchPreview | null => {
    const layer = paper.svg.querySelector('.joint-layers') as SVGGElement | null
    if (!layer) return null
    const ns = 'http://www.w3.org/2000/svg'
    const group = document.createElementNS(ns, 'g')
    group.setAttribute('class', 'pid-branch-preview')
    group.setAttribute('pointer-events', 'none')
    const stroke = strokeFor(start.edge.lineClass)
    const fluidId = start.edge.fluidId
    const fluid = fluidId
      ? (store().doc.fluids ?? []).find((candidate) => candidate.id === fluidId)?.color
      : undefined
    const ink = fluid ?? '#111'
    const attrs = stroke.double
      ? [
          { color: ink, width: stroke.width + 3, dash: undefined },
          { color: '#fff', width: stroke.width, dash: stroke.dasharray },
        ]
      : [{ color: ink, width: stroke.width, dash: stroke.dasharray }]
    const paths = attrs.map(({ color, width, dash }) => {
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', previewPath(start, start.point))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-width', String(width))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      if (dash) path.setAttribute('stroke-dasharray', dash)
      group.appendChild(path)
      return path
    })
    layer.appendChild(group)
    return { group, paths }
  }

  const finishBranchGesture = (client: Point | null) => {
    const gesture = branchGesture
    branchGesture = null
    paper.el.classList.remove('pid-branching')
    showDockHint(paper, null)
    if (!gesture) return
    gesture.preview.group.remove()
    if (!client) return
    const end = paper.clientToLocalPoint(client)
    if (Math.hypot(end.x - gesture.start.point.x, end.y - gesture.start.point.y) < 24) return

    const targetTap = pipeAt(end, new Set([gesture.start.edge.id]))
    if (targetTap && sameLineFamily(gesture.start.edge, targetTap.edge)) {
      const from = splitTap(gesture.start)
      const to = splitTap(targetTap)
      const branch: PlantEdge = {
        id: ulid(),
        lineGroupId: ulid(),
        lineClass: gesture.start.edge.lineClass,
        routing: 'fixed',
        arrow: 'none',
        source: from.junction,
        target: to.junction,
        vertices: orthogonalBend(from.junction, to.junction, branchOrientation(from.junction, to.junction)),
        ...(gesture.start.edge.fluidId ? { fluidId: gesture.start.edge.fluidId } : {}),
      }
      store().addBatch(
        [],
        [...from.halves, ...to.halves, branch],
        [gesture.start.edge.id, targetTap.edge.id],
      )
      store().setSelection([branch.id])
      return
    }

    const split = splitTap(gesture.start)
    const branch: PlantEdge = {
      id: ulid(),
      lineGroupId: ulid(),
      lineClass: gesture.start.edge.lineClass,
      routing: 'fixed',
      arrow: 'none',
      source: split.junction,
      target: { x: snap8(end.x), y: snap8(end.y) },
      vertices: orthogonalBend(split.junction, { x: snap8(end.x), y: snap8(end.y) }, branchOrientation(split.junction, { x: snap8(end.x), y: snap8(end.y) })),
      ...(gesture.start.edge.fluidId ? { fluidId: gesture.start.edge.fluidId } : {}),
    }
    store().addBatch([], [...split.halves, branch], [gesture.start.edge.id])
    store().setSelection([branch.id])
  }

  const onBranchMouseMove = (event: MouseEvent) => {
    const gesture = branchGesture
    if (!gesture) return
    const point = paper.clientToLocalPoint({ x: event.clientX, y: event.clientY })
    const d = previewPath(gesture.start, point)
    gesture.preview.paths.forEach((path) => path.setAttribute('d', d))
    const targetTap = pipeAt(point, new Set([gesture.start.edge.id]))
    showDockHint(paper, targetTap && sameLineFamily(gesture.start.edge, targetTap.edge) ? targetTap.point : null)
  }

  const onBranchMouseUp = (event: MouseEvent) => {
    if (!branchGesture) return
    finishBranchGesture({ x: event.clientX, y: event.clientY })
  }

  const beginBranchGesture = (start: PipeTap) => {
    if (branchGesture) finishBranchGesture(null)
    const preview = createBranchPreview(start)
    if (!preview) return
    branchGesture = {
      start,
      preview,
    }
    paper.el.classList.add('pid-branching')
  }

  // JointJS' arrowhead tools can lose their document-level move listener
  // after a link is deselected and selected again. Keep the familiar handles,
  // but own their drag lifecycle here so endpoint editing remains reliable.
  let endpointGesture: {
    edgeId: string
    end: 'source' | 'target'
    startClient: Point
    moved: boolean
  } | null = null

  const graphEnd = (end: PlantEdge['source']): dia.Link.EndJSON =>
    isPortEnd(end) ? { id: end.nodeId, port: end.portId } : { x: end.x, y: end.y }

  const compatiblePortAt = (
    client: Point,
    edge: PlantEdge,
    moving: 'source' | 'target',
  ): PlantEdge['source'] | null => {
    const fixed = moving === 'source' ? edge.target : edge.source
    const local = paper.clientToLocalPoint(client)
    const hitRadius = Math.max(4, 8 / Math.max(0.1, paper.scale().sx))
    let best: PlantEdge['source'] | null = null
    let bestDistance = hitRadius
    for (const node of activeSheet(store()).nodes) {
      if (isPortEnd(fixed) && fixed.nodeId === node.id) continue
      const cell = graph.getCell(node.id)
      const kinds = (cell?.get('data') as { portKinds?: PortKinds } | undefined)?.portKinds ?? {}
      for (const [portId, kind] of Object.entries(kinds)) {
        if (!canConnect(kind, kind, edge.lineClass)) continue
        const at = portWorld(node, portId)
        if (!at) continue
        const distance = Math.hypot(at.x - local.x, at.y - local.y)
        if (distance > bestDistance) continue
        bestDistance = distance
        best = { nodeId: node.id, portId }
      }
    }
    if (best) return best
    for (const element of document.elementsFromPoint(client.x, client.y)) {
      if (!(element instanceof SVGElement)) continue
      const magnet = element.matches('.pid-port-hit') ? element : element.closest('.pid-port-hit')
      if (!(magnet instanceof SVGElement)) continue
      const portId = magnet.getAttribute('port') ?? magnet.closest('[port]')?.getAttribute('port')
      const modelId = magnet.closest('[model-id]')?.getAttribute('model-id')
      const cell = modelId ? graph.getCell(modelId) : undefined
      const kind = portId ? kindFromCell(cell, portId) : null
      if (!modelId || !portId || !kind || !canConnect(kind, kind, edge.lineClass)) continue
      if (isPortEnd(fixed) && fixed.nodeId === modelId) continue
      return { nodeId: modelId, portId }
    }
    return null
  }

  const cancelEndpointGesture = () => {
    const gesture = endpointGesture
    endpointGesture = null
    paper.el.classList.remove('pid-linking')
    if (!gesture) return
    const edge = activeSheet(store()).edges.find((candidate) => candidate.id === gesture.edgeId)
    const link = graph.getCell(gesture.edgeId) as dia.Link | undefined
    if (edge && link?.isLink()) link.set(gesture.end, graphEnd(edge[gesture.end]))
  }

  const onEndpointMouseMove = (event: MouseEvent) => {
    const gesture = endpointGesture
    if (!gesture) return
    if (Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) >= 3) {
      gesture.moved = true
    }
    const link = graph.getCell(gesture.edgeId) as dia.Link | undefined
    if (!link?.isLink()) return cancelEndpointGesture()
    const point = paper.clientToLocalPoint({ x: event.clientX, y: event.clientY })
    link.set(gesture.end, { x: snap8(point.x), y: snap8(point.y) })
    // Keep the route orthogonal while the end is being repositioned: the
    // endpoint move only fires change:source/target, so re-decide the router
    // against the in-flight geometry here — a diagonal must never render,
    // not even mid-drag. The endpoint gesture is driven by window listeners,
    // so a router switch cannot disturb it the way it would a JointJS tool.
    const sheet = activeSheet(store())
    const sheetEdge = sheet.edges.find((edge) => edge.id === gesture.edgeId)
    if (sheetEdge) {
      const inflightEnd = (end: dia.Link.EndJSON): PlantEdge['source'] =>
        end.id ? { nodeId: String(end.id), portId: String(end.port) } : { x: Number(end.x), y: Number(end.y) }
      const inflight: PlantEdge = {
        ...sheetEdge,
        source: inflightEnd(link.source()),
        target: inflightEnd(link.target()),
        vertices: link.vertices(),
      }
      const nodes = new Map(sheet.nodes.map((n) => [n.id, n]))
      if ((link.get('router') as { name?: string } | undefined)?.name !== routerNameFor(inflight, nodes)) {
        refreshLinkRouter(link, inflight, nodes)
      }
    }
  }

  const finishEndpointGesture = (event: MouseEvent) => {
    const gesture = endpointGesture
    endpointGesture = null
    paper.el.classList.remove('pid-linking')
    if (!gesture) return
    const sheet = activeSheet(store())
    const edge = sheet.edges.find((candidate) => candidate.id === gesture.edgeId)
    const link = graph.getCell(gesture.edgeId) as dia.Link | undefined
    if (!edge || !link?.isLink() || !gesture.moved) {
      if (edge && link?.isLink()) link.set(gesture.end, graphEnd(edge[gesture.end]))
      return
    }

    const local = paper.clientToLocalPoint({ x: event.clientX, y: event.clientY })
    const point = { x: snap8(local.x), y: snap8(local.y) }
    const fixed = gesture.end === 'source' ? edge.target : edge.source
    const port = compatiblePortAt({ x: event.clientX, y: event.clientY }, edge, gesture.end)
    const currentEnd = edge[gesture.end]
    // Moving a still-free endpoint changes only its position. Its reserved
    // device tag remains attached to that endpoint until it is actually
    // connected to a device or another line.
    const movedEnd: PlantEdge['source'] = port ?? {
      ...point,
      ...(!isPortEnd(currentEnd) && currentEnd.pendingTag
        ? { pendingTag: currentEnd.pendingTag }
        : {}),
    }
    const next = { ...edge, [gesture.end]: movedEnd }

    if (!port) {
      const tap = pipeAt(point, new Set([edge.id]))
      if (tap && sameLineFamily(edge, tap.edge)) {
        return commitBranchTap(next, gesture.end, tap, [edge.id])
      }
    }

    const anchored = (end: PlantEdge['source']) => isPortEnd(end) || isJunctionEnd(end)
    if (!anchored(fixed) && !anchored(movedEnd)) {
      link.set(gesture.end, graphEnd(edge[gesture.end]))
      return
    }
    store().setEdge(edge.id, { [gesture.end]: movedEnd })
  }

  const onEndpointMouseDownCapture = (event: MouseEvent) => {
    if (event.button !== 0) return
    const target = event.target instanceof Element
      ? event.target.closest('[data-tool-name="source-arrowhead"], [data-tool-name="target-arrowhead"]')
      : null
    if (!target) return
    const edgeId = target.getAttribute('model-id')
    const name = target.getAttribute('data-tool-name')
    if (!edgeId || (name !== 'source-arrowhead' && name !== 'target-arrowhead')) return
    const sheet = activeSheet(store())
    if (!sheet.edges.some((edge) => edge.id === edgeId)) return
    if (endpointGesture) cancelEndpointGesture()
    endpointGesture = {
      edgeId,
      end: name === 'source-arrowhead' ? 'source' : 'target',
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
    }
    paper.el.classList.add('pid-linking')
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  // --- pin placement ------------------------------------------------------
  // "＋ Add pin" in the panel arms one click: the next click on that symbol
  // adds a user connection pin exactly where it landed (4px lattice, like the
  // catalog ports). Any other click cancels.
  const snap4 = (v: number) => Math.round(v / 4) * 4
  const placePin = (view: dia.ElementView, x: number, y: number): boolean => {
    const arm = store().armPin
    if (!arm) return false
    store().setArmPin(null)
    const id = String(view.model.id)
    if (id !== arm) return true
    const node = activeSheet(store()).nodes.find((n) => n.id === id)
    if (!node) return true
    const local = localPortPoint(node, { x, y })
    if (!local) return true
    try {
      const g = getSymbol(node.symbolId).gridSize
      const px = Math.max(0, Math.min(g.w * 8, snap4(local.x)))
      const py = Math.max(0, Math.min(g.h * 8, snap4(local.y)))
      store().addExtraPort(id, { x: px, y: py, kind: 'both' })
    } catch { /* unknown symbol: nothing to pin */ }
    return true
  }

  // --- selection ----------------------------------------------------------
  const onElementPointerDown = (view: dia.ElementView, evt: dia.Event) => {
    const id = String(view.model.id)
    const sel = store().selection
    if (evt.shiftKey) {
      store().setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id])
    } else if (!sel.includes(id)) {
      store().setSelection([id])
    }
  }

  const onLinkPointerDown = (view: dia.LinkView, evt: dia.Event) => {
    const id = String(view.model.id)
    if (id.startsWith('draft-')) return
    // Every persisted edge is one independently editable section.
    const sel = store().selection
    // Endpoint tools notify link:pointerdown too. Rewriting an unchanged
    // selection here makes selection sync blur the tool mid-drag.
    if (!evt.shiftKey && sel.length === 1 && sel[0] === id) return
    if (evt.shiftKey) {
      store().setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id])
    } else if (sel.length !== 1 || sel[0] !== id) {
      // Endpoint tools notify link:pointerdown too. Rewriting an unchanged
      // selection here makes selection sync blur the tool mid-drag.
      store().setSelection([id])
    }
  }

  const onBlankPointerDown = () => {
    if (store().armPin) store().setArmPin(null)
    if (store().selection.length) store().setSelection([])
  }

  // --- movement commit + live alignment guides ---------------------------
  const dragStart = new Map<string, { x: number; y: number }>()
  /** Waypoints of the links moving rigidly with the drag, as they were at grab. */
  const dragStartVerts = new Map<string, { x: number; y: number }[]>()
  const guideEls: SVGLineElement[] = []
  const guideLayer = () => paper.svg.querySelector('.joint-layers') as SVGGElement | null
  const clearGuides = () => {
    guideEls.forEach((g) => g.remove())
    guideEls.length = 0
  }
  const drawGuide = (vertical: boolean, at: number) => {
    const layer = guideLayer()
    if (!layer) return
    const size = paper.getComputedSize()
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    if (vertical) {
      line.setAttribute('x1', String(at)); line.setAttribute('x2', String(at))
      line.setAttribute('y1', '0'); line.setAttribute('y2', String(size.height))
    } else {
      line.setAttribute('y1', String(at)); line.setAttribute('y2', String(at))
      line.setAttribute('x1', '0'); line.setAttribute('x2', String(size.width))
    }
    line.setAttribute('stroke', '#2b6cb0')
    line.setAttribute('stroke-width', '0.75')
    line.setAttribute('stroke-dasharray', '4 3')
    line.setAttribute('pointer-events', 'none')
    layer.appendChild(line)
    guideEls.push(line)
  }
  /** Grid/guide-resolved landing position for a node dragged to `p`. */
  const landing = (hit: ReturnType<typeof snapGuides>, p: { x: number; y: number }) => ({
    x: hit.x !== undefined ? Math.round(hit.x) : snap8(p.x),
    y: hit.y !== undefined ? Math.round(hit.y) : snap8(p.y),
  })

  /**
   * Magnetic docking, live inside the drag.
   *
   * The connection is made the moment the connection points meet — not when
   * the mouse button comes up. The symbol clicks into place a standoff away
   * so a real length of pipe is visible, the line is written to the document
   * there and then, and the user goes on dragging: the pipe stretches behind
   * them. Getting it wrong costs nothing — shake the symbol and the line this
   * drag made is cut, without ever letting go.
   *
   * `live` is the connection this gesture made, `holding` whether the magnet
   * still has the symbol, and `refused` the pairings shaken off already (so
   * the symbol doesn't snap straight back onto the point just rejected).
   */
  let live: { edgeId: string; dock: Dock } | null = null
  let holding = false
  /** A shake happened this drag: the release must not sneak a line back on. */
  let cut = false
  /** ...and nothing docks for a moment either, or the tail of the waggle
   *  catches whatever the symbol was flung past. */
  let dockAgainAt = 0
  const refused = new Set<string>()
  const shake = createShakeDetector()

  const endDockGesture = () => {
    live = null
    holding = false
    cut = false
    dockAgainAt = 0
    refused.clear()
    shake.reset()
    showDockHint(paper, null)
    paper.el.classList.remove('pid-docking')
  }

  /** Is the magnet still close enough to keep the symbol clicked into place? */
  const stillHeld = (node: PlantNode, at: { x: number; y: number }, dock: Dock): boolean => {
    const port = portWorld({ ...node, ...at }, dock.movingPortId)
    if (!port) return false
    return Math.hypot(port.x - dock.portAt.x, port.y - dock.portAt.y) <= dockRadius(paper.scale().sx)
  }

  /** Cut the line this drag docked and let the user aim somewhere else. */
  const cutLive = () => {
    if (!live) return
    refused.add(dockKey(live.dock))
    flashDockCut(paper, live.dock.at)
    store().deleteIds([live.edgeId])
    live = null
    holding = false
    cut = true
    dockAgainAt = Date.now() + SHAKE_COOLOFF_MS
    shake.reset()
    showDockHint(paper, null)
  }

  const onElementPointerMove = (view: dia.ElementView, evt: dia.Event) => {
    const id = String(view.model.id)
    const start = dragStart.get(id)
    if (!start) return
    clearGuides()
    const sheet = activeSheet(store())
    const node = sheet.nodes.find((n) => n.id === id)
    if (!node) return
    const p = view.model.position()
    // a multi-selection moves together live, not just at drop
    if (dragStart.size > 1) {
      const dx = p.x - start.x
      const dy = p.y - start.y
      for (const [nid, s0] of dragStart) {
        if (nid === id) continue
        const cell = graph.getCell(nid) as dia.Element | undefined
        if (cell?.isElement()) cell.position(s0.x + dx, s0.y + dy)
      }
      for (const [lid, v0] of dragStartVerts) {
        const link = graph.getCell(lid) as dia.Link | undefined
        link?.vertices(v0.map((p) => ({ x: p.x + dx, y: p.y + dy })))
      }
    }
    const hit = snapGuides({ ...node, x: p.x, y: p.y }, sheet.nodes, 4, sheet.edges)
    if (hit.guideX !== undefined) drawGuide(true, hit.guideX)
    if (hit.guideY !== undefined) drawGuide(false, hit.guideY)

    // Docking is a single-symbol gesture: a group drag is being arranged, not
    // plumbed, and there is no one symbol whose ports would do the docking.
    if (dragStart.size > 1) return
    // Connection dots come up across the sheet so the user can see what there
    // is to touch.
    paper.el.classList.add('pid-docking')

    const pointer = (evt.originalEvent ?? evt) as { clientX?: number; clientY?: number }
    if (live && shake.push(pointer.clientX ?? p.x, pointer.clientY ?? p.y, Date.now())) {
      cutLive()
      return
    }

    const at = landing(hit, p)
    if (live) {
      // Already connected this drag. Hold the symbol on the standoff while
      // the pointer stays in reach, then let it go and stretch the pipe.
      holding = stillHeld(node, at, live.dock)
      if (holding) view.model.position(live.dock.x, live.dock.y)
      showDockHint(paper, holding ? live.dock.at : null)
      return
    }

    if (Date.now() < dockAgainAt) return
    const dock = findDock(
      { ...node, ...at },
      sheet.nodes,
      sheet.edges,
      store().activeLineClass,
      dockRadius(paper.scale().sx),
      refused,
    )
    showDockHint(paper, dock?.at ?? null)
    if (!dock) {
      holding = false
      return
    }
    // Caught. Draw the line now, mid-drag — the rest of this gesture is the
    // same undo step, so one Ctrl+Z takes the move and the line back together.
    live = { edgeId: store().dockNode(id, dock.x, dock.y, dockEdge(id, dock)), dock }
    pauseHistory()
    holding = true
    view.model.position(dock.x, dock.y)
  }

  const onElementPointerDownPos = (view: dia.ElementView) => {
    dragStart.clear()
    endDockGesture()
    const id = String(view.model.id)
    const sel = store().selection
    const ids = sel.includes(id) && sel.length > 1 ? sel : [id]
    for (const nid of ids) {
      const cell = graph.getCell(nid) as dia.Element | undefined
      if (cell?.isElement()) dragStart.set(nid, cell.position())
    }
    dragStart.set(id, view.model.position())
    // Links whose both ends are being dragged travel rigidly, so their
    // waypoints move with them — live, not just on drop.
    dragStartVerts.clear()
    for (const link of graph.getLinks()) {
      const a = link.getSourceCell()?.id
      const b = link.getTargetCell()?.id
      if (a && b && dragStart.has(String(a)) && dragStart.has(String(b))) {
        const v = link.vertices()
        if (v.length) dragStartVerts.set(String(link.id), v.map((p) => ({ x: p.x, y: p.y })))
      }
    }
  }

  const onElementPointerUp = (view: dia.ElementView) => {
    clearGuides()
    const id = String(view.model.id)
    const start = dragStart.get(id)
    const multi = dragStart.size > 1
    // Emptied here, on every path out: onGlobalPointerUp reads it to tell a
    // live drag from a finished one, so a leftover entry would latch the
    // undo group open for good.
    dragStart.clear()
    dragStartVerts.clear()
    const docked = live
    const wasHolding = holding
    const wasCut = cut
    endDockGesture()
    // The docking burst opened with dockNode and stays one undo step until
    // here, whatever the drag did afterwards.
    if (!start) return resumeHistory()
    const p = view.model.position()
    const sheet = activeSheet(store())
    const node = sheet.nodes.find((n) => n.id === id)
    const hit = node ? snapGuides({ ...node, x: p.x, y: p.y }, sheet.nodes, 4, sheet.edges) : {}
    // A magnet still holding at release keeps the spot it clicked into.
    const { x: nx, y: ny } =
      docked && wasHolding ? { x: docked.dock.x, y: docked.dock.y } : landing(hit, p)

    // Fallback for a drag that never reported a move inside the reach — a
    // flick, or a nudge back onto a point the symbol started next to. Never
    // after a shake: the user has just said no to a connection, and letting
    // go is not them changing their mind.
    if (!docked && !wasCut && node && !multi) {
      const dock = findDock(
        { ...node, x: nx, y: ny },
        sheet.nodes,
        sheet.edges,
        store().activeLineClass,
        dockRadius(paper.scale().sx),
      )
      if (dock) {
        store().dockNode(id, dock.x, dock.y, dockEdge(id, dock))
        return resumeHistory()
      }
    }
    if (nx !== start.x || ny !== start.y) {
      const dx = nx - start.x
      const dy = ny - start.y
      const sel = store().selection
      if (sel.includes(id) && sel.length > 1) {
        const nodeIds = sel.filter((s) => activeSheet(store()).nodes.some((n) => n.id === s))
        store().moveNodes(nodeIds, dx, dy)
      } else {
        store().setNodePos(id, nx, ny)
      }
    }
    resumeHistory()
  }

  // --- vertex editing on selected links ----------------------------------
  // The Vertices/Segments tools write the model on EVERY pointermove; the doc
  // must only hear about the finished gesture — one clean commit, one undo
  // step — or the store fights the drag mid-flight and undo floods with
  // hundreds of micro-states. Tool gestures are wrapped in named batches, so
  // the commit waits for the batch to close (vertex removal is unbatched and
  // commits immediately).
  const VERTEX_BATCHES = ['vertex-move', 'vertex-add', 'segment-move'] as const
  const inVertexGesture = () => VERTEX_BATCHES.some((n) => graph.hasActiveBatch(n))
  const pendingVerts = new Set<string>()
  const commitVertices = (id: string) => {
    const cell = graph.getCell(id) as dia.Link | undefined
    if (!cell || !cell.isLink()) return
    const view = cell.findView(paper) as dia.LinkView | null
    const anchor = (which: 'sourceAnchor' | 'targetAnchor'): { x: number; y: number } | null => {
      const p = view?.[which]
      return p ? { x: p.x, y: p.y } : null
    }
    const sourceAnchor = anchor('sourceAnchor')
    const targetAnchor = anchor('targetAnchor')
    const sheetEdge = activeSheet(store()).edges.find((edge) => edge.id === id)
    if (sheetEdge && sourceAnchor && targetAnchor) {
      const free = !isPortEnd(sheetEdge.source) && !isJunctionEnd(sheetEdge.source)
        ? 'source'
        : !isPortEnd(sheetEdge.target) && !isJunctionEnd(sheetEdge.target)
          ? 'target'
          : null
      if (free) {
        const route = straightenDanglingRoute(cell.vertices(), sourceAnchor, targetAnchor, free)
        const moved = free === 'source' ? route.source : route.target
        const before = sheetEdge[free]
        if (!isPortEnd(before) && (moved.x !== before.x || moved.y !== before.y)) {
          store().setEdge(id, {
            [free]: { ...before, ...moved },
            vertices: route.vertices,
          }, { preserveOtherEdges: true })
          return
        }
      }
    }
    store().setEdgeVertices(id, cleanVertices(cell.vertices(), sourceAnchor, targetAnchor))
  }
  const onLinkChangeVertices = (link: dia.Link, _v: unknown, opt: { ui?: boolean; tool?: string }) => {
    if (String(link.id).startsWith('draft-')) return
    if (!opt.ui && !opt.tool) return // reconciler writes echo back without ui
    const id = String(link.id)
    const sheet = activeSheet(store())
    const sheetEdge = sheet.edges.find((edge) => edge.id === id)
    // The user is dragging a bend live. Re-decide the router against the
    // in-flight vertices so a point-ended line being bent switches to
    // Manhattan immediately — a diagonal must never show, not even mid-drag,
    // because the normal router draws raw segments through off-axis
    // waypoints. Segment drags are excluded: the Segments tool re-renders
    // its handles when the router changes and would drop the gesture; their
    // commit goes through the reconciler, which re-decides the router with
    // the stored vertices anyway.
    if (sheetEdge && !graph.hasActiveBatch('segment-move')) {
      const inflight: PlantEdge = { ...sheetEdge, vertices: link.vertices() }
      const nodes = new Map(sheet.nodes.map((n) => [n.id, n]))
      if ((link.get('router') as { name?: string } | undefined)?.name !== routerNameFor(inflight, nodes)) {
        refreshLinkRouter(link, inflight, nodes)
      }
    }
    if (inVertexGesture()) pendingVerts.add(id)
    else commitVertices(id)
  }
  const onBatchStop = (data: { batchName?: string } | undefined) => {
    if (!data?.batchName || !(VERTEX_BATCHES as readonly string[]).includes(data.batchName)) return
    if (inVertexGesture()) return // vertex-add wraps vertex-move; wait for the outermost
    for (const id of pendingVerts) commitVertices(id)
    pendingVerts.clear()
  }

  // --- selection highlight + link tools -----------------------------------
  const HIGHLIGHT = 'pid-selection'
  const toolRoles = new WeakMap<dia.LinkView, 'edit' | 'full'>()
  const addLinkTools = (view: dia.LinkView, role: 'edit' | 'full') => {
    if (toolRoles.get(view) === role && view.hasTools()) {
      view.showTools()
      return
    }
    if (view.hasTools()) view.removeTools()
    const tools: dia.ToolView[] = [
      // Existing bends remain draggable, and dragging a route adds a new bend
      // at the hit point. The link tool is scoped to this edge's view, so a
      // route edit cannot mutate a different branch.
      new linkTools.Vertices({ snapRadius: 8, vertexAdding: true }),
      // Drag a whole run sideways — the natural way to arrange a line.
      new linkTools.Segments({ snapRadius: 8 }),
    ]
    if (role === 'full') {
      tools.push(
        new linkTools.SourceArrowhead(),
        new linkTools.TargetArrowhead(),
        new linkTools.Remove({
          distance: '25%',
          // The default action removes only the JointJS cell; the document
          // would keep the edge and the next reconcile would resurrect it.
          action: (_evt: dia.Event, toolView: dia.LinkView) => {
            store().deleteIds([String(toolView.model.id)])
            store().setSelection([])
          },
        }),
      )
    }
    view.addTools(
      new dia.ToolsView({
        tools,
      }),
    )
    toolRoles.set(view, role)
  }
  const syncSelection = () => {
    // pin-arming shows every connection dot and a crosshair cursor
    paper.el.classList.toggle('pid-pinning', Boolean(store().armPin))
    // Each persisted edge is selected and edited on its own. A junction is
    // shared topology metadata, not a selection group.
    const selected = new Set(store().selection)
    const sel = selected
    const selectedNodes = new Set(store().selection.filter((id) => activeSheet(store()).nodes.some((node) => node.id === id)))
    for (const cell of graph.getCells()) {
      const view = cell.findView(paper)
      if (!view) continue
      const has = highlighters.stroke.get(view, HIGHLIGHT)
      view.el.classList.toggle('pid-selected', selectedNodes.has(String(cell.id)))
      if (sel.has(String(cell.id))) {
        if (!has) {
          highlighters.stroke.add(view, cell.isLink() ? { selector: 'line' } : { selector: 'root' }, HIGHLIGHT, {
            padding: 4,
            attrs: { stroke: '#2b6cb0', 'stroke-width': 2, 'stroke-opacity': 0.7 },
          })
        }
        if (cell.isLink() && sel.has(String(cell.id))) {
          const linkView = view as dia.LinkView
          addLinkTools(linkView, 'full')
        } else if (cell.isLink() && (view as dia.LinkView).hasTools()) {
          (view as dia.LinkView).hideTools()
        }
      } else {
        if (has) highlighters.stroke.remove(view, HIGHLIGHT)
        view.el.classList.remove('pid-selected')
        // Keeping the same tool views alive avoids losing their delegated
        // drag handlers when a line is deselected and selected again.
        if (cell.isLink() && (view as dia.LinkView).hasTools()) (view as dia.LinkView).hideTools()
      }
    }
  }
  const unsubSelection = useStore.subscribe(syncSelection)
  // Re-apply section tools after every render so each persisted edge remains
  // directly editable after reconciliation.
  paper.on('render:done', syncSelection)

  // Ctrl+drag always means "new branch", even when a selected line's vertex
  // or segment tool sits over the pipe. Capture before JointJS claims it.
  const onPaperMouseDownCapture = (event: MouseEvent) => {
    if (!event.ctrlKey || event.button !== 0) return
    const point = paper.clientToLocalPoint({ x: event.clientX, y: event.clientY })
    const tap = pipeAt(point)
    if (!tap) return
    beginBranchGesture(tap)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  // --- keyboard -----------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return
    const s = store()
    const mod = e.metaKey || e.ctrlKey

    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); s.undo(); return }
    if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); s.redo(); return }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); window.dispatchEvent(new CustomEvent('pid:save')); return }
    if (mod && e.key.toLowerCase() === 'c') {
      const selSet = new Set(s.selection)
      const sheet = activeSheet(s)
      clipboard = {
        nodes: sheet.nodes.filter((n) => selSet.has(n.id)),
        edges: sheet.edges.filter((ed) => selSet.has(ed.id)),
      }
      return
    }
    if (mod && e.key.toLowerCase() === 'v') {
      if (clipboard && clipboard.nodes.length) s.pasteNodes(clipboard.nodes, clipboard.edges)
      return
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      duplicateSelection()
      return
    }
    // Shift+F fits the sheet to the visible canvas; Shift+1 goes back to 1:1.
    if (e.shiftKey && e.key.toLowerCase() === 'f' && canvasRef.paper && canvasRef.graph) {
      e.preventDefault()
      fitView(canvasRef.paper, canvasRef.graph, activeSheet(s).sheetSize)
      return
    }
    if (e.shiftKey && e.key === '!' && canvasRef.paper) {
      e.preventDefault()
      zoomActual(canvasRef.paper)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); s.deleteSelected(); return }
    if (e.key === 'Escape') {
      if (branchGesture) { finishBranchGesture(null); return }
      if (s.armPin) { s.setArmPin(null); return }
      s.setSelection([])
      return
    }
    if (e.key.toLowerCase() === 'r' && s.selection.length) {
      for (const id of s.selection) if (activeSheet(s).nodes.some((n) => n.id === id)) s.rotateNode(id)
      return
    }
    const nudge = e.shiftKey ? 1 : 8
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge],
    }
    const mv = moves[e.key]
    if (mv && s.selection.length) {
      e.preventDefault()
      const nodeIds = s.selection.filter((id) => activeSheet(s).nodes.some((n) => n.id === id))
      if (nodeIds.length) s.moveNodes(nodeIds, mv[0], mv[1])
    }
  }

  paper.on('element:pointerdown', (v: dia.ElementView, e: dia.Event, x: number, y: number) => {
    if (placePin(v, x, y)) return
    onElementPointerDown(v, e)
    onElementPointerDownPos(v)
  })
  paper.on('element:pointermove', onElementPointerMove)
  paper.on('element:pointerup', onElementPointerUp)
  paper.on('element:magnet:pointerdown', onMagnetDown)
  paper.on('link:pointerdown', onLinkPointerDown)
  paper.on('link:pointerup', onLinkPointerUp)
  paper.on('blank:pointerdown', onBlankPointerDown)
  graph.on('change:vertices', onLinkChangeVertices)
  graph.on('batch:stop', onBatchStop)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerup', onGlobalPointerUp)
  window.addEventListener('mousemove', onBranchMouseMove)
  window.addEventListener('mouseup', onBranchMouseUp)
  window.addEventListener('mousemove', onEndpointMouseMove)
  window.addEventListener('mouseup', finishEndpointGesture)
  paper.el.addEventListener('mousedown', onEndpointMouseDownCapture, true)
  paper.el.addEventListener('mousedown', onPaperMouseDownCapture, true)

  return () => {
    clearGuides()
    finishBranchGesture(null)
    cancelEndpointGesture()
    endDockGesture()
    unsubSelection()
    paper.off('render:done', syncSelection)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('pointerup', onGlobalPointerUp)
    window.removeEventListener('mousemove', onBranchMouseMove)
    window.removeEventListener('mouseup', onBranchMouseUp)
    window.removeEventListener('mousemove', onEndpointMouseMove)
    window.removeEventListener('mouseup', finishEndpointGesture)
    paper.el.removeEventListener('mousedown', onEndpointMouseDownCapture, true)
    paper.el.removeEventListener('mousedown', onPaperMouseDownCapture, true)
    paper.off('element:magnet:pointerdown')
    paper.off('element:pointerdown')
    paper.off('element:pointermove')
    paper.off('element:pointerup')
    paper.off('link:pointerdown')
    paper.off('link:pointerup')
    paper.off('blank:pointerdown')
    graph.off('change:vertices')
    graph.off('batch:stop', onBatchStop)
  }
}

/** Duplicate the selected components (and the lines between them), offset 16px. */
export function duplicateSelection(): void {
  const s = useStore.getState()
  const selSet = new Set(s.selection)
  if (selSet.size === 0) return
  const sheet = activeSheet(s)
  const nodes = sheet.nodes.filter((n) => selSet.has(n.id))
  if (nodes.length === 0) return
  const byJunction = new Map<string, PlantEdge[]>()
  for (const edge of sheet.edges) {
    for (const end of [edge.source, edge.target]) {
      if (!isJunctionEnd(end)) continue
      byJunction.set(end.junctionId, [...(byJunction.get(end.junctionId) ?? []), edge])
    }
  }
  const edges: PlantEdge[] = []
  const seen = new Set<string>()
  for (const seed of sheet.edges) {
    if (seen.has(seed.id)) continue
    const group: PlantEdge[] = []
    const queue = [seed]
    while (queue.length) {
      const edge = queue.pop()!
      if (seen.has(edge.id)) continue
      seen.add(edge.id)
      group.push(edge)
      for (const end of [edge.source, edge.target]) {
        if (isJunctionEnd(end)) queue.push(...(byJunction.get(end.junctionId) ?? []))
      }
    }
    const ports = group.flatMap((edge) => [edge.source, edge.target]).filter(isPortEnd)
    if (ports.length && ports.every((end) => selSet.has(end.nodeId))) edges.push(...group)
  }
  s.pasteNodes(nodes, edges)
}

/** Marquee selection on blank-drag. */
/** Apply an alignment or distribution to the current node selection. */
export function applyAlignment(mode: Parameters<typeof alignNodes>[1] | 'distribute-h' | 'distribute-v'): void {
  const s = useStore.getState()
  const sheet = activeSheet(s)
  const nodes = sheet.nodes.filter((n) => s.selection.includes(n.id))
  if (nodes.length < 2) return
  const moves =
    mode === 'distribute-h' ? distributeNodes(nodes, 'h')
    : mode === 'distribute-v' ? distributeNodes(nodes, 'v')
    : alignNodes(nodes, mode)
  for (const m of moves) {
    const orig = nodes.find((n) => n.id === m.id)!
    if (orig.x !== m.x || orig.y !== m.y) s.setNodePos(m.id, m.x, m.y)
  }
}

export function attachMarquee(host: HTMLElement, paper: dia.Paper, graph: dia.Graph): () => void {
  let active = false
  let start = { x: 0, y: 0 }
  const box = document.createElement('div')
  box.style.cssText =
    'position:absolute;border:1px dashed #2b6cb0;background:rgba(43,108,176,.08);pointer-events:none;display:none;z-index:5'
  host.appendChild(box)

  const onBlankDown = (evt: dia.Event) => {
    const e = evt.originalEvent as PointerEvent | undefined
    if (!e || e.button !== 0) return
    active = true
    start = { x: e.clientX, y: e.clientY }
  }
  const draw = (e: PointerEvent) => {
    const rect = host.getBoundingClientRect()
    const x = Math.min(start.x, e.clientX) - rect.left
    const y = Math.min(start.y, e.clientY) - rect.top
    box.style.display = 'block'
    box.style.left = `${x}px`
    box.style.top = `${y}px`
    box.style.width = `${Math.abs(e.clientX - start.x)}px`
    box.style.height = `${Math.abs(e.clientY - start.y)}px`
  }
  const onMove = (e: PointerEvent) => {
    if (active) draw(e)
  }
  const onUp = (e: PointerEvent) => {
    if (!active) return
    active = false
    box.style.display = 'none'
    if (Math.abs(e.clientX - start.x) < 4 && Math.abs(e.clientY - start.y) < 4) return
    const a = paper.clientToLocalPoint({ x: start.x, y: start.y })
    const b = paper.clientToLocalPoint({ x: e.clientX, y: e.clientY })
    const area = new g.Rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    const s = useStore.getState()
    const ids = graph.findModelsInArea(area).map((m) => String(m.id))
    s.setSelection(e.shiftKey ? [...new Set([...s.selection, ...ids])] : ids)
  }

  paper.on('blank:pointerdown', onBlankDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  return () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    box.remove()
  }
}
