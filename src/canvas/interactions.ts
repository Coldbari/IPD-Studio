// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { canvasRef, fitView, zoomActual } from './paperSetup'
import { dia, g, highlighters, linkTools } from '@joint/core'
import { ulid } from 'ulid'
import type { PlantEdge, PlantNode } from '../model/types'
import { isPortEnd } from '../model/types'
import type { PortKind } from '../symbols/types'
import { compatibleKinds, pickLineClass } from './connectionRules'
import { alignNodes, buildSnapIndex, distributeNodes, localPortPoint, portWorld, snapGuides, type SnapIndex } from './alignment'
import { type Dock, type DockIndex, buildDockIndex, dockEdge, dockKey, dockRadius, findDock, flashDockCut, flashDockMade, showDockHint } from './autoConnect'
import { createShakeDetector } from './shake'
import { attachCiteHighlight } from './cite'
import { cleanVertices } from './vertexClean'
import { makeLink } from './shapes'
import { getSymbol } from '../symbols/registry'
import { activeSheet, pauseHistory, resumeHistory, useStore } from '../store/store'

const snap8 = (v: number) => Math.round(v / 8) * 8

/** Quiet spell after a shake, so the tail of the waggle docks nothing. */
const SHAKE_COOLOFF_MS = 600

type PortKinds = Record<string, PortKind>

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
  const pipeAt = (pt: { x: number; y: number }): { edge: PlantEdge; point: { x: number; y: number } } | null => {
    const sheet = activeSheet(store())
    for (const e of sheet.edges) {
      const cell = graph.getCell(e.id) as dia.Link | undefined
      const view = cell ? (cell.findView(paper) as dia.LinkView | null) : null
      const conn = view?.getConnection()
      if (!conn) continue
      const cp = conn.closestPoint(new g.Point(pt.x, pt.y))
      if (cp && Math.hypot(cp.x - pt.x, cp.y - pt.y) <= 10) {
        return { edge: e, point: { x: cp.x, y: cp.y } }
      }
    }
    return null
  }

  /**
   * Dropping a line onto an existing pipe taps into it: a junction dot is
   * inserted at the drop point, the pipe splits into two halves through it,
   * and the new line lands on the junction — all as one undo step. The
   * branch inherits the tapped line's class.
   */
  const commitBranchTap = (
    portEnd: PlantEdge['source'],
    tap: { edge: PlantEdge; point: { x: number; y: number } },
  ): void => {
    const sheet = activeSheet(store())
    const tapped = tap.edge
    const resolve = (end: PlantEdge['source']): { x: number; y: number } | null => {
      if (!isPortEnd(end)) return { x: end.x, y: end.y }
      const n = sheet.nodes.find((nd) => nd.id === end.nodeId)
      return n ? portWorld(n, end.portId) : null
    }
    const a = resolve(tapped.source)
    const b = resolve(tapped.target)
    if (!a || !b) return
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
    // snap along the pipe only; stay exactly ON the line across it
    const px = horizontal ? snap8(tap.point.x) : Math.round(tap.point.x)
    const py = horizontal ? Math.round(tap.point.y) : snap8(tap.point.y)
    const jx = px - 4
    const jy = py - 4
    const jn: PlantNode = {
      id: ulid(),
      symbolId: 'fit.junction',
      kind: 'fitting',
      x: jx,
      y: jy,
      rotation: 0,
    }
    const inPort = horizontal ? (a.x <= b.x ? 'w' : 'e') : a.y <= b.y ? 'n' : 's'
    const outPort = horizontal ? (a.x <= b.x ? 'e' : 'w') : a.y <= b.y ? 's' : 'n'
    // branch takes the perpendicular side nearest the drawn line's start
    const other = resolve(portEnd)
    const branchPort = horizontal
      ? (other?.y ?? 0) < tap.point.y ? 'n' : 's'
      : (other?.x ?? 0) < tap.point.x ? 'w' : 'e'
    const half1: PlantEdge = {
      id: ulid(),
      lineClass: tapped.lineClass,
      source: tapped.source,
      target: { nodeId: jn.id, portId: inPort },
      ...(tapped.lineNumber ? { lineNumber: tapped.lineNumber } : {}),
    }
    const half2: PlantEdge = {
      id: ulid(),
      lineClass: tapped.lineClass,
      source: { nodeId: jn.id, portId: outPort },
      target: tapped.target,
      ...(tapped.arrow ? { arrow: tapped.arrow } : {}),
    }
    const branch: PlantEdge = {
      id: ulid(),
      lineClass: tapped.lineClass,
      source: portEnd,
      target: { nodeId: jn.id, portId: branchPort },
    }
    store().addBatch([jn], [half1, half2, branch], [tapped.id])
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
      if (tap) return commitBranchTap(source, tap)
    } else if (isPortEnd(target) && !isPortEnd(source)) {
      const tap = pipeAt(source)
      if (tap) return commitBranchTap(target, tap)
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

  /** Commit an arrowhead-tool re-attach: sync the moved model ends to the doc. */
  const syncMovedEnds = (link: dia.Link) => {
    const id = String(link.id)
    if (id.startsWith('draft-')) return
    const sheet = activeSheet(store())
    const edge = sheet.edges.find((e) => e.id === id)
    if (!edge) return
    const toDocEnd = (e: dia.Link.EndJSON): PlantEdge['source'] | null => {
      if (e.id) return e.port ? { nodeId: String(e.id), portId: String(e.port) } : null
      if (typeof e.x === 'number' && typeof e.y === 'number') return { x: snap8(e.x), y: snap8(e.y) }
      return null
    }
    const src = toDocEnd(link.source())
    const tgt = toDocEnd(link.target())
    const revert = () => {
      const asEnd = (end: PlantEdge['source']): dia.Link.EndJSON =>
        isPortEnd(end) ? { id: end.nodeId, port: end.portId } : { x: end.x, y: end.y }
      link.source(asEnd(edge.source))
      link.target(asEnd(edge.target))
    }
    // A re-attach must keep at least one port end; otherwise snap back.
    if (!src || !tgt || (!isPortEnd(src) && !isPortEnd(tgt))) return revert()
    const same = (a: PlantEdge['source'], b: PlantEdge['source']) => JSON.stringify(a) === JSON.stringify(b)
    if (!same(src, edge.source) || !same(tgt, edge.target)) {
      store().setEdge(id, { source: src, target: tgt })
    }
  }

  const onLinkPointerUp = (view: dia.LinkView) => {
    commitDraft(view.model)
    syncMovedEnds(view.model)
  }

  // Port dots are hidden until they matter: hovering a symbol shows its own,
  // and holding a link drag ('pid-linking' on the paper root) shows them all.
  /** Classes naming what the in-flight link is coming FROM, so CSS can ring
   *  the ports it could legally reach. One class toggle instead of a sweep of
   *  every magnet on the sheet — see markAvailable in paperSetup.ts. */
  const LINK_SRC_CLASSES = ['pid-link-process', 'pid-link-signal', 'pid-link-both'] as const
  /** The symbol the in-flight link left, so its OWN ports are not ringed as
   *  targets — a line cannot connect a symbol to itself, and validateConnection
   *  refuses it. */
  let linkFrom: Element | null = null
  const onMagnetDown = (view: dia.ElementView, _evt: dia.Event, magnet: SVGElement) => {
    paper.el.classList.add('pid-linking')
    const kind = portKindOf(view as dia.CellView, magnet)
    if (!kind) return
    paper.el.classList.add(`pid-link-${kind}`)
    linkFrom = view.el
    linkFrom.classList.add('pid-link-src')
  }
  const onGlobalPointerUp = () => {
    paper.el.classList.remove('pid-linking', ...LINK_SRC_CLASSES)
    linkFrom?.classList.remove('pid-link-src')
    linkFrom = null
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
    if (evt.shiftKey) {
      const sel = store().selection
      store().setSelection(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id])
    } else {
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

  /**
   * Geometry the drag reads on every pointermove but that does not move while
   * one symbol is being dragged: the other symbols' boxes, their connection
   * points, and which pairs are already joined. Rebuilt only when the sheet's
   * node or edge array is replaced — the store is immutable, so identity is a
   * complete change signal. Before this, both indexes were derived from
   * scratch sixty-plus times a second.
   */
  let geom: { nodes: PlantNode[]; edges: PlantEdge[]; dock: DockIndex; snap: SnapIndex } | null = null
  const geomFor = (sheet: { nodes: PlantNode[]; edges: PlantEdge[] }) => {
    if (!geom || geom.nodes !== sheet.nodes || geom.edges !== sheet.edges) {
      geom = {
        nodes: sheet.nodes,
        edges: sheet.edges,
        dock: buildDockIndex(sheet.nodes, sheet.edges),
        snap: buildSnapIndex(sheet.nodes, sheet.edges),
      }
    }
    return geom
  }

  // Two reused <line> elements rather than create-and-remove per pointermove:
  // the guides are the same two lines every frame, and churning SVG nodes
  // inside the drag loop is pure garbage.
  let layerEl: SVGGElement | null = null
  const guideLayer = () => (layerEl ??= paper.svg.querySelector('.joint-layers') as SVGGElement | null)
  const guides: Record<'v' | 'h', SVGLineElement | null> = { v: null, h: null }
  const guideFor = (axis: 'v' | 'h'): SVGLineElement | null => {
    const existing = guides[axis]
    if (existing?.isConnected) return existing
    const layer = guideLayer()
    if (!layer) return null
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('stroke', '#2b6cb0')
    line.setAttribute('stroke-width', '0.75')
    line.setAttribute('stroke-dasharray', '4 3')
    line.setAttribute('pointer-events', 'none')
    line.setAttribute('display', 'none')
    layer.appendChild(line)
    guides[axis] = line
    return line
  }
  const clearGuides = () => {
    guides.v?.setAttribute('display', 'none')
    guides.h?.setAttribute('display', 'none')
  }
  const drawGuide = (vertical: boolean, at: number) => {
    const line = guideFor(vertical ? 'v' : 'h')
    if (!line) return
    const size = paper.getComputedSize()
    if (vertical) {
      line.setAttribute('x1', String(at)); line.setAttribute('x2', String(at))
      line.setAttribute('y1', '0'); line.setAttribute('y2', String(size.height))
    } else {
      line.setAttribute('y1', String(at)); line.setAttribute('y2', String(at))
      line.setAttribute('x1', '0'); line.setAttribute('x2', String(size.width))
    }
    line.setAttribute('display', '')
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

  /** Shared tail of both kinds of shake-off. */
  const afterCut = () => {
    live = null
    holding = false
    cut = true
    dockAgainAt = Date.now() + SHAKE_COOLOFF_MS
    shake.reset()
    showDockHint(paper, null)
  }

  /**
   * Shake the symbol free.
   *
   * If this drag made a line, that is the one the user is rejecting. If it
   * didn't, they are shaking a symbol that arrived already wired up — so the
   * gesture takes off every line it has, which is the only way to unpick a
   * connection without hunting for the line itself and pressing Delete.
   *
   * Either way the symbol stays in hand, and nothing it was just freed from
   * can re-catch it for the rest of the drag.
   */
  const shakeOff = (node: PlantNode): void => {
    if (live) {
      refused.add(dockKey(live.dock))
      flashDockCut(paper, live.dock.at)
      store().deleteIds([live.edgeId])
      return afterCut()
    }
    const attached = activeSheet(store()).edges.filter(
      (e) =>
        (isPortEnd(e.source) && e.source.nodeId === node.id) ||
        (isPortEnd(e.target) && e.target.nodeId === node.id),
    )
    if (!attached.length) return
    for (const e of attached) {
      const mine = isPortEnd(e.source) && e.source.nodeId === node.id ? e.source : e.target
      const far = mine === e.source ? e.target : e.source
      if (isPortEnd(far)) refused.add(far.nodeId)
      if (isPortEnd(mine)) {
        const at = portWorld(node, mine.portId)
        if (at) flashDockCut(paper, at)
      }
    }
    // No dockNode opened an undo group this drag, so this delete opens it:
    // it records the wired-up state, then the rest of the drag folds in.
    store().deleteIds(attached.map((e) => e.id))
    pauseHistory()
    afterCut()
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
    const ix = geomFor(sheet)
    const hit = snapGuides({ ...node, x: p.x, y: p.y }, sheet.nodes, 4, sheet.edges, 8, ix.snap)
    if (hit.guideX !== undefined) drawGuide(true, hit.guideX)
    if (hit.guideY !== undefined) drawGuide(false, hit.guideY)

    // Docking is a single-symbol gesture: a group drag is being arranged, not
    // plumbed, and there is no one symbol whose ports would do the docking.
    if (dragStart.size > 1) return
    // Connection dots come up across the sheet so the user can see what there
    // is to touch.
    paper.el.classList.add('pid-docking')

    const pointer = (evt.originalEvent ?? evt) as { clientX?: number; clientY?: number }
    if (shake.push(pointer.clientX ?? p.x, pointer.clientY ?? p.y, Date.now())) {
      shakeOff(node)
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
      ix.dock,
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
    flashDockMade(paper, dock.at)
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
    const upIx = geomFor(sheet)
    const hit = node ? snapGuides({ ...node, x: p.x, y: p.y }, sheet.nodes, 4, sheet.edges, 8, upIx.snap) : {}
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
        undefined,
        upIx.dock,
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
    store().setEdgeVertices(id, cleanVertices(cell.vertices(), anchor('sourceAnchor'), anchor('targetAnchor')))
  }
  const onLinkChangeVertices = (link: dia.Link, _v: unknown, opt: { ui?: boolean; tool?: string }) => {
    if (String(link.id).startsWith('draft-')) return
    if (!opt.ui && !opt.tool) return // reconciler writes echo back without ui
    if (inVertexGesture()) pendingVerts.add(String(link.id))
    else commitVertices(String(link.id))
  }
  const onBatchStop = (data: { batchName?: string } | undefined) => {
    if (!data?.batchName || !(VERTEX_BATCHES as readonly string[]).includes(data.batchName)) return
    if (inVertexGesture()) return // vertex-add wraps vertex-move; wait for the outermost
    for (const id of pendingVerts) commitVertices(id)
    pendingVerts.clear()
  }

  // --- selection highlight + link tools -----------------------------------
  //
  // This used to walk EVERY cell in the graph on EVERY store change: the
  // subscription had no selector, so a node move, a tag keystroke, an autosave
  // flag — anything at all — swept the whole drawing asking each cell whether
  // its highlighter matched. Selection is a diff, so it is applied as one:
  // only the ids that entered or left the selection are touched.
  const HIGHLIGHT = 'pid-selection'

  const linkToolsFor = () =>
    new dia.ToolsView({
      tools: [
        new linkTools.Vertices({ snapRadius: 8 }),
        // drag a whole run sideways — the natural way to arrange a line
        new linkTools.Segments({ snapRadius: 8 }),
        new linkTools.SourceArrowhead(),
        new linkTools.TargetArrowhead(),
        new linkTools.Remove({
          distance: '25%',
          // the default action removes only the JointJS cell; the doc would
          // keep the edge and the next reconcile would resurrect the "deleted"
          // line — deletion must go through the store
          action: (_evt: dia.Event, toolView: dia.LinkView) => {
            store().deleteIds([String(toolView.model.id)])
            store().setSelection([])
          },
        }),
      ],
    })

  /** Show the selection ring on one cell. Returns false when the cell has no
   *  rendered view yet — the async paper may not have drawn it. */
  const showOn = (id: string): boolean => {
    const cell = graph.getCell(id)
    if (!cell) return true // nothing to draw on; not a pending render
    const view = cell.findView(paper)
    if (!view) return false
    if (!highlighters.stroke.get(view, HIGHLIGHT)) {
      highlighters.stroke.add(view, cell.isLink() ? { selector: 'line' } : { selector: 'root' }, HIGHLIGHT, {
        padding: 4,
        attrs: { stroke: '#2b6cb0', 'stroke-width': 2, 'stroke-opacity': 0.7 },
      })
    }
    // Checked separately from the ring on purpose. A link view can lose its
    // tools and keep its highlighter — a re-render, or being unmounted and
    // brought back by viewport culling — and a single "already highlighted"
    // early return then leaves a selected line with no ✕ and no segment
    // handles for the rest of the session.
    const link = cell.isLink() ? (view as dia.LinkView) : null
    if (link && !link.hasTools()) link.addTools(linkToolsFor())
    return true
  }

  const hideOn = (id: string): void => {
    const cell = graph.getCell(id)
    const view = cell?.findView(paper)
    if (!view) return
    if (highlighters.stroke.get(view, HIGHLIGHT)) highlighters.stroke.remove(view, HIGHLIGHT)
    if (cell!.isLink()) (view as dia.LinkView).removeTools()
  }

  let shownSel: readonly string[] = []
  let shownArm: string | null = null
  const syncSelection = () => {
    const s = store()
    if (s.armPin !== shownArm) {
      shownArm = s.armPin
      // pin-arming shows every connection dot and a crosshair cursor
      paper.el.classList.toggle('pid-pinning', Boolean(shownArm))
    }
    if (s.selection === shownSel) return
    const next = new Set(s.selection)
    const prev = new Set(shownSel)
    for (const id of shownSel) if (!next.has(id)) hideOn(id)
    for (const id of s.selection) if (!prev.has(id)) showOn(id)
    shownSel = s.selection
  }

  // The async paper draws a cell a frame or two after the store selects it,
  // and a cell removed and restored (undo) comes back without its ring. Both
  // are repaired by re-checking the CURRENT selection — a handful of ids —
  // rather than by sweeping the drawing.
  const repairSelection = () => {
    for (const id of shownSel) showOn(id)
  }

  const unsubSelection = useStore.subscribe(syncSelection)
  // The assistant's citation channel, alongside the user's selection and
  // never instead of it. See canvas/cite.ts.
  const detachCite = attachCiteHighlight(paper, graph)
  const onCellAdded = (cell: dia.Cell) => {
    if (shownSel.includes(String(cell.id))) showOn(String(cell.id))
  }
  paper.on('render:done', repairSelection)
  graph.on('add', onCellAdded)
  syncSelection()

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

  const onPointerDownAny = (v: dia.ElementView, e: dia.Event, x: number, y: number) => {
    if (placePin(v, x, y)) return
    onElementPointerDown(v, e)
    onElementPointerDownPos(v)
  }
  paper.on('element:pointerdown', onPointerDownAny)
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

  return () => {
    clearGuides()
    endDockGesture()
    unsubSelection()
    detachCite()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('pointerup', onGlobalPointerUp)
    // Every one of these names the handler it is taking off. Backbone's
    // off(name) with no callback removes EVERY listener on that event —
    // including JointJS's own ('add' is how the paper learns about new cells)
    // and this module's neighbours (the marquee also listens on
    // 'blank:pointerdown', the jumpover index on 'change:vertices').
    paper.off('render:done', repairSelection)
    paper.off('element:magnet:pointerdown', onMagnetDown)
    paper.off('element:pointerdown', onPointerDownAny)
    paper.off('element:pointermove', onElementPointerMove)
    paper.off('element:pointerup', onElementPointerUp)
    paper.off('link:pointerdown', onLinkPointerDown)
    paper.off('link:pointerup', onLinkPointerUp)
    paper.off('blank:pointerdown', onBlankPointerDown)
    graph.off('add', onCellAdded)
    graph.off('change:vertices', onLinkChangeVertices)
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
  const edges = sheet.edges.filter(
    (e) =>
      isPortEnd(e.source) && selSet.has(e.source.nodeId) &&
      isPortEnd(e.target) && selSet.has(e.target.nodeId),
  )
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
    const ids = graph.findModelsInArea(area).map((m) => String(m.id))
    const s = useStore.getState()
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
