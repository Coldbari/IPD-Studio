// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { connectors, dia, shapes } from '@joint/core'
import type { PlantEdge, PlantNode } from '../model/types'
import { isPortEnd } from '../model/types'
import { getSymbol } from '../symbols/registry'
import { portWorld, scalesOf } from './alignment'
import { strokeFor } from './lineStyle'
import { parseSvgToMarkup, type MarkupNode } from './markupParser'

/**
 * Each port renders as a small always-visible dot (the connection point the
 * user aims for) under a larger invisible halo that is the actual magnet, so
 * starting a link doesn't demand pixel-perfect clicks. Styling lives in
 * app.css (.pid-port-*); exports strip both by joint-selector.
 */
const PORT_MARKUP = [
  {
    tagName: 'circle',
    selector: 'portDot',
    className: 'pid-port-dot',
    attributes: { r: 3, 'pointer-events': 'none' },
  },
  {
    tagName: 'circle',
    selector: 'portBody',
    className: 'pid-port-hit',
    attributes: { r: 8, fill: 'transparent', stroke: 'transparent', magnet: 'true', cursor: 'crosshair' },
  },
]

/** Divide stroke widths by the node scale so drawn line weight stays constant. */
function normalizeStrokes(nodes: (MarkupNode | string)[], s: number): void {
  for (const mk of nodes) {
    if (typeof mk === 'string') continue
    const sw = mk.attributes?.['stroke-width']
    if (sw && !Number.isNaN(Number(sw))) mk.attributes!['stroke-width'] = String(Number(sw) / s)
    if (mk.children) normalizeStrokes(mk.children, s)
  }
}

function markupFor(node: PlantNode): (MarkupNode | string)[] {
  const def = getSymbol(node.symbolId)
  const svg = def.render(node.config ?? def.defaultConfig ?? {})
  const sym = parseSvgToMarkup(svg)
  const { sx, sy } = scalesOf(node)
  const s = Math.sqrt(sx * sy)
  if (s !== 1) normalizeStrokes(sym, s)
  return [
    // Transparent body so the whole symbol (not just its hairline strokes)
    // accepts clicks and drags.
    {
      tagName: 'rect',
      selector: 'hit',
      attributes: {
        width: String(def.gridSize.w * 8),
        height: String(def.gridSize.h * 8),
        fill: 'transparent',
        stroke: 'none',
        cursor: 'move',
      },
    },
    {
      tagName: 'rect',
      selector: 'selectionFrame',
      attributes: {
        width: String(def.gridSize.w * 8),
        height: String(def.gridSize.h * 8),
        fill: 'transparent',
        stroke: 'none',
        'pointer-events': 'none',
      },
    },
    { tagName: 'g', selector: 'sym', children: sym },
    { tagName: 'text', selector: 'tagL' },
    { tagName: 'text', selector: 'tagN' },
    { tagName: 'text', selector: 'lbl' },
  ]
}

/** Scaled pixel dims for a node. */
function dimsFor(node: PlantNode): { w: number; h: number; sx: number; sy: number } {
  const def = getSymbol(node.symbolId)
  const { sx, sy } = scalesOf(node)
  return { w: def.gridSize.w * 8 * sx, h: def.gridSize.h * 8 * sy, sx, sy }
}

function tagAttrs(node: PlantNode): Record<string, Record<string, unknown>> {
  const def = getSymbol(node.symbolId)
  const { w, h } = dimsFor(node)
  const inside = def.tagRule === 'isa-instrument' && node.symbolId === 'instr.bubble'
  const base = {
    fontFamily: 'sans-serif',
    fontSize: 11,
    textAnchor: 'middle',
    fill: '#111',
    stroke: '#fff',
    strokeWidth: 3,
    paintOrder: 'stroke',
    // texts are draggable annotation (Canvas host handles the drag)
    pointerEvents: 'auto',
    cursor: 'move',
  }
  // Annotation reads horizontally no matter how the symbol is turned. The
  // wanted spot is defined against the ROTATED visual box (tags stacked on
  // top, label under), mapped back into the element frame, then the text is
  // counter-rotated about that anchor.
  const rot = ((node.rotation % 360) + 360) % 360
  const swap = rot === 90 || rot === 270
  const visH = swap ? w : h // rotated visual height
  const place = (sheetDx: number, sheetDy: number, off: { x: number; y: number }): Record<string, unknown> => {
    // sheet-space offset from the symbol center -> element frame
    let dx = sheetDx
    let dy = sheetDy
    for (let i = 0; i < rot / 90; i++) {
      const r = { x: dy, y: -dx } // inverse of the clockwise element rotation
      dx = r.x
      dy = r.y
    }
    const x = w / 2 + dx + off.x
    const y = h / 2 + dy + off.y
    return rot ? { x, y, transform: `rotate(${-rot} ${x} ${y})` } : { x, y }
  }
  const tOff = node.tagOffset ?? { x: 0, y: 0 }
  const lOff = node.labelOffset ?? { x: 0, y: 0 }
  return {
    tagL: {
      ...base,
      text: node.tag?.letters ?? '',
      ...place(0, inside ? -3 : -visH / 2 - 14, tOff),
    },
    tagN: {
      ...base,
      text: node.tag ? node.tag.loop + (node.tag.suffix ?? '') : '',
      ...place(0, inside ? 9 : -visH / 2 - 3, tOff),
    },
    lbl: {
      ...base,
      fontSize: 10,
      text: node.label ?? '',
      ...place(0, node.labelPos === 'center' ? 3 : visH / 2 + 12, lOff),
    },
  }
}

/** Full attrs bundle: symbol color/scale transform, hit body size, tag texts. */
function baseAttrs(node: PlantNode): Record<string, Record<string, unknown>> {
  const { w, h, sx, sy } = dimsFor(node)
  return {
    sym: { color: '#111', transform: sx === sy ? `scale(${sx})` : `scale(${sx} ${sy})` },
    hit: { width: w, height: h },
    ...tagAttrs(node),
  }
}

const haloMarkup = (r: number) =>
  PORT_MARKUP.map((m) => (m.selector === 'portBody' ? { ...m, attributes: { ...m.attributes, r } } : m))

function portItems(node: PlantNode) {
  const def = getSymbol(node.symbolId)
  const { sx, sy } = scalesOf(node)
  return [...def.ports, ...(node.extraPorts ?? [])].map((p) => ({
    id: p.id,
    group: 'p',
    args: { x: p.x * sx, y: p.y * sy },
    ...('hit' in p && typeof p.hit === 'number' ? { markup: haloMarkup(p.hit) } : {}),
  }))
}

function portKindsOf(node: PlantNode): Record<string, string> {
  const def = getSymbol(node.symbolId)
  return Object.fromEntries([...def.ports, ...(node.extraPorts ?? [])].map((p) => [p.id, p.kind]))
}

export function makeElement(node: PlantNode): dia.Element {
  const { w, h } = dimsFor(node)
  const el = new dia.Element(<dia.Element.Attributes>{
    id: node.id,
    type: 'pid.Symbol',
    position: { x: node.x, y: node.y },
    size: { width: w, height: h },
    angle: node.rotation,
    markup: markupFor(node) as unknown as dia.MarkupJSON,
    attrs: baseAttrs(node),
    ports: {
      groups: {
        p: { position: { name: 'absolute' }, markup: PORT_MARKUP },
      },
      items: portItems(node),
    },
    data: { symbolId: node.symbolId, kind: node.kind, portKinds: portKindsOf(node) },
  })
  return el
}

export function updateElement(cell: dia.Element, node: PlantNode, prev: PlantNode): void {
  if (node.x !== prev.x || node.y !== prev.y) cell.set('position', { x: node.x, y: node.y })
  if (node.rotation !== prev.rotation) cell.set('angle', node.rotation)
  if (node.config !== prev.config) cell.set('markup', markupFor(node) as unknown as dia.MarkupJSON)
  if (node.extraPorts !== prev.extraPorts) {
    cell.prop('ports/items', portItems(node))
    cell.set('data', { symbolId: node.symbolId, kind: node.kind, portKinds: portKindsOf(node) })
  }
  const ps = scalesOf(node)
  const pp = scalesOf(prev)
  const rescaled = ps.sx !== pp.sx || ps.sy !== pp.sy
  if (rescaled) {
    const { w, h } = dimsFor(node)
    cell.resize(w, h)
    cell.prop('ports/items', portItems(node))
    // markup carries scale-normalized stroke widths, so rebuild it too
    if (node.config === prev.config) cell.set('markup', markupFor(node) as unknown as dia.MarkupJSON)
  }
  if (
    node.tag !== prev.tag || node.label !== prev.label || node.labelPos !== prev.labelPos ||
    node.rotation !== prev.rotation || node.tagOffset !== prev.tagOffset ||
    node.labelOffset !== prev.labelOffset || node.config !== prev.config || rescaled
  ) {
    cell.set('attrs', baseAttrs(node))
  }
}

function toEnd(end: PlantEdge['source']): dia.Link.EndJSON {
  return isPortEnd(end) ? { id: end.nodeId, port: end.portId } : { x: end.x, y: end.y }
}

export type Direction = 'left' | 'right' | 'top' | 'bottom'

/** Which way a link should leave a port, from the port's place on its symbol. */
export function portDirection(symbolId: string, portId: string): Direction | null {
  try {
    const def = getSymbol(symbolId)
    const port = def.ports.find((p) => p.id === portId)
    if (!port) return null
    if (port.dir) return port.dir
    const w = def.gridSize.w * 8
    const h = def.gridSize.h * 8
    const candidates: [Direction, number][] = [
      ['left', port.x],
      ['right', w - port.x],
      ['top', port.y],
      ['bottom', h - port.y],
    ]
    candidates.sort((a, b) => a[1] - b[1])
    const [dir, distance] = candidates[0]!
    // 10px slack covers nozzle ports that sit slightly inside a dished head.
    return distance <= 10 ? dir : null
  } catch {
    return null
  }
}

const CLOCKWISE: Record<Direction, Direction> = { top: 'right', right: 'bottom', bottom: 'left', left: 'top' }

export function rotateDir(dir: Direction, rotation: number): Direction {
  let d = dir
  const turns = (((rotation % 360) + 360) % 360) / 90
  for (let i = 0; i < turns; i++) d = CLOCKWISE[d]
  return d
}

function routerFor(edge: PlantEdge, nodes?: Map<string, PlantNode>): Record<string, unknown> {
  // Fixed routes already contain their complete orthogonal geometry. Running
  // Manhattan again would add its own endpoint hooks.
  if (edge.routing === 'fixed') {
    const pointOf = (end: PlantEdge['source']): { x: number; y: number } | null => {
      if (!isPortEnd(end)) return { x: end.x, y: end.y }
      const node = nodes?.get(end.nodeId)
      return node ? portWorld(node, end.portId) : null
    }
    const source = pointOf(edge.source)
    const target = pointOf(edge.target)
    // Judge the RAW stored route: the normal router draws straight through
    // the vertices, so any diagonal leg — e.g. a bend or an endpoint the
    // user dragged off-axis — must hand the route to Manhattan, which
    // renders it orthogonally. Checking the orthogonalized route instead
    // would mask the diagonal and let it render raw.
    const route = [source, ...(edge.vertices ?? []), target]
    const hasDiagonal = route.some((point, index) => {
      const next = route[index + 1]
      return Boolean(point && next && Math.abs(point.x - next.x) > 0.5 && Math.abs(point.y - next.y) > 0.5)
    })
    return hasDiagonal ? { name: 'manhattan', args: { step: 8, padding: 8 } } : { name: 'normal' }
  }
  const args: Record<string, unknown> = { step: 8, padding: 8 }
  let srcDir: Direction | null = null
  let tgtDir: Direction | null = null
  const srcNode = nodes && isPortEnd(edge.source) ? nodes.get(edge.source.nodeId) : undefined
  const tgtNode = nodes && isPortEnd(edge.target) ? nodes.get(edge.target.nodeId) : undefined
  if (srcNode && isPortEnd(edge.source)) {
    const dir = portDirection(srcNode.symbolId, edge.source.portId)
    if (dir) {
      srcDir = rotateDir(dir, srcNode.rotation)
      args.startDirections = [srcDir]
    }
  }
  if (tgtNode && isPortEnd(edge.target)) {
    const dir = portDirection(tgtNode.symbolId, edge.target.portId)
    if (dir) {
      tgtDir = rotateDir(dir, tgtNode.rotation)
      args.endDirections = [tgtDir]
    }
  }

  const sourcePoint = isPortEnd(edge.source)
    ? (srcNode ? portWorld(srcNode, edge.source.portId) : null)
    : edge.source
  const targetPoint = isPortEnd(edge.target)
    ? (tgtNode ? portWorld(tgtNode, edge.target.portId) : null)
    : edge.target
  // Collinear endpoints are already a valid unobstructed straight route —
  // but only while the link has no bends. Once it carries waypoints,
  // Manhattan must own the route so every segment stays horizontal or
  // vertical no matter where the user dragged a bend. The normal router
  // would draw raw diagonals through off-axis waypoints.
  if ((!isPortEnd(edge.source) || !isPortEnd(edge.target)) &&
    (!edge.vertices || edge.vertices.length === 0) &&
    sourcePoint && targetPoint &&
    (Math.abs(sourcePoint.x - targetPoint.x) <= 0.5 || Math.abs(sourcePoint.y - targetPoint.y) <= 0.5)) {
    return { name: 'normal' }
  }

  // Facing ports in line at close range route as one straight segment.
  // Manhattan's obstacle padding cannot pass through the small gap between
  // side-by-side symbols, so it would loop over the top instead.
  if (
    srcNode && tgtNode &&
    isPortEnd(edge.source) && isPortEnd(edge.target) &&
    (!edge.vertices || edge.vertices.length === 0)
  ) {
    const pa = portWorld(srcNode, edge.source.portId)
    const pb = portWorld(tgtNode, edge.target.portId)
    // Docked symbols share a connection point exactly: there is no run to
    // route, and manhattan would loop out and back around the pair.
    if (pa && pb && Math.hypot(pb.x - pa.x, pb.y - pa.y) <= 1) return { name: 'normal' }
    if (pa && pb && srcDir && tgtDir && Math.hypot(pb.x - pa.x, pb.y - pa.y) <= 120) {
      const facingH =
        pa.y === pb.y &&
        ((pb.x > pa.x && srcDir === 'right' && tgtDir === 'left') ||
          (pb.x < pa.x && srcDir === 'left' && tgtDir === 'right'))
      const facingV =
        pa.x === pb.x &&
        ((pb.y > pa.y && srcDir === 'bottom' && tgtDir === 'top') ||
          (pb.y < pa.y && srcDir === 'top' && tgtDir === 'bottom'))
      if (facingH || facingV) return { name: 'normal' }
    }
  }
  return { name: 'manhattan', args }
}

/**
 * A junction is a real topology node, so its connected limbs must meet
 * directly. Jumpover is reserved for crossings between unrelated links.
 */
type LinkPoint = { x: number; y: number }

const samePoint = (a: LinkPoint | undefined, b: LinkPoint | undefined): boolean =>
  Boolean(a && b && Math.hypot(a.x - b.x, a.y - b.y) <= 0.5)

/**
 * JointJS's built-in jumpover treats an intersection at a link endpoint as a
 * crossing too. That is correct for a free crossing, but wrong for a shared
 * line junction: the three limbs must meet directly at the tee. Filter only
 * links sharing one of this link's endpoints before delegating to the stock
 * connector. All other intersections retain the normal bridge arc.
 */
const pidJumpover = Object.defineProperty(function(
  sourcePoint: LinkPoint,
  targetPoint: LinkPoint,
  route: LinkPoint[],
  args: Record<string, unknown>,
  linkView: dia.LinkView,
) {
  const paper = linkView.paper
  if (!paper) return connectors.jumpover(sourcePoint as never, targetPoint as never, route as never, args as never, linkView)
  const graph = paper.model
  const allLinks = graph.getLinks()
  const thisModel = linkView.model
  const endpointOf = (link: dia.Link): [LinkPoint | undefined, LinkPoint | undefined] => {
    const view = link === thisModel ? linkView : link.findView(paper) as dia.LinkView | null
    return view ? [view.sourcePoint, view.targetPoint] : [undefined, undefined]
  }
  const [thisSource, thisTarget] = endpointOf(thisModel)
  const filtered = allLinks.filter((link) => {
    if (link === thisModel) return true
    const [source, target] = endpointOf(link)
    return !samePoint(source, thisSource) && !samePoint(target, thisSource) &&
      !samePoint(source, thisTarget) && !samePoint(target, thisTarget)
  })
  const originalGetLinks = graph.getLinks
  // The built-in connector reads the graph synchronously. Temporarily hiding
  // shared-endpoint links keeps its update bookkeeping and route math intact.
  ;(graph as dia.Graph & { getLinks: () => dia.Link[] }).getLinks = () => filtered
  try {
    return connectors.jumpover(sourcePoint as never, targetPoint as never, route as never, args as never, linkView)
  } finally {
    ;(graph as dia.Graph & { getLinks: () => dia.Link[] }).getLinks = originalGetLinks
  }
}, 'name', { value: 'jumpover' }) as unknown as (
  sourcePoint: LinkPoint,
  targetPoint: LinkPoint,
  route: LinkPoint[],
  args: Record<string, unknown>,
  linkView: dia.LinkView,
) => string

function connectorFor(_edge: PlantEdge): unknown {
  // The function keeps the built-in connector name so jumpover still compares
  // every unrelated link, while its endpoint filter preserves tee junctions.
  return pidJumpover
}

/** Recompute a link's route choice after an endpoint node moved or resized. */
export function refreshLinkRouter(cell: dia.Link, edge: PlantEdge, nodes?: Map<string, PlantNode>): void {
  cell.router(routerFor(edge, nodes) as never)
}

/** The router name routerFor picks for an edge, for live re-decisions. */
export function routerNameFor(edge: PlantEdge, nodes?: Map<string, PlantNode>): string {
  return String((routerFor(edge, nodes) as { name: string }).name)
}

const LINK_MARKUP = [
  { tagName: 'path', selector: 'wrapper', attributes: { fill: 'none', cursor: 'pointer', stroke: 'transparent' } },
  { tagName: 'path', selector: 'outline', attributes: { fill: 'none', 'pointer-events': 'none' } },
  { tagName: 'path', selector: 'line', attributes: { fill: 'none', 'pointer-events': 'none' } },
]

function lineAttrs(edge: PlantEdge, fluidColor?: string): Record<string, Record<string, unknown>> {
  const stroke = strokeFor(edge.lineClass)
  const ink = fluidColor ?? '#111'
  // JointJS links carry a default target marker. Always overwrite it with a
  // clean, empty marker for non-arrowed segments; omitting the attribute
  // leaves that default triangle behind after a branch split.
  const noMarker = { type: 'none', d: '', fill: 'none', stroke: 'none' }
  const marker = edge.arrow === 'flow'
    ? { type: 'path', d: 'M 10 -4 0 0 10 4 Z', fill: ink }
    : noMarker
  const line: Record<string, unknown> = {
    connection: true,
    fill: 'none',
    stroke: stroke.double ? '#fff' : ink,
    strokeWidth: stroke.width,
    targetMarker: stroke.double ? noMarker : marker,
  }
  if (stroke.dasharray) line.strokeDasharray = stroke.dasharray
  const outline: Record<string, unknown> = stroke.double
    ? { connection: true, fill: 'none', stroke: ink, strokeWidth: stroke.width + 3, targetMarker: marker }
    : { connection: true, fill: 'none', stroke: 'none', strokeWidth: 0, targetMarker: noMarker }
  return {
    line,
    outline,
    wrapper: { connection: true, strokeWidth: 12, stroke: 'transparent', fill: 'none' },
  }
}

/** The pending-tag half of a link's data: which end waits for a device that
 *  is not on the sheet yet. Mirrors the pendingTag on the doc edge so the
 *  decorations pass can label the free end without a model lookup. */
function pendingData(edge: PlantEdge): { source?: string; target?: string } {
  const pend = (end: PlantEdge['source'] | PlantEdge['target']): string | undefined =>
    !isPortEnd(end) && end.pendingTag ? end.pendingTag : undefined
  const source = pend(edge.source)
  const target = pend(edge.target)
  return source || target ? { source, target } : {}
}

export function makeLink(edge: PlantEdge, nodes?: Map<string, PlantNode>, fluidColor?: string): dia.Link {
  const link = new shapes.standard.Link({
    id: edge.id,
    source: toEnd(edge.source),
    target: toEnd(edge.target),
    // The model mirrors the stored route exactly: one handle per user
    // waypoint. Diagonal legs are rendered orthogonally by the router, never
    // materialized as phantom points — so deleting a bend actually deletes
    // it, and a save/load round-trip can never resurrect it.
    vertices: edge.vertices ?? [],
    router: routerFor(edge, nodes),
    connector: connectorFor(edge) as never,
    markup: LINK_MARKUP,
    data: { lineClass: edge.lineClass, fluidColor, pending: pendingData(edge) },
  })
  link.attr(lineAttrs(edge, fluidColor))
  return link
}

export function updateLink(cell: dia.Link, edge: PlantEdge, prev: PlantEdge, nodes?: Map<string, PlantNode>, fluidColor?: string): void {
  if (edge.source !== prev.source || edge.target !== prev.target) {
    cell.source(toEnd(edge.source))
    cell.target(toEnd(edge.target))
  }
  const vertices = edge.vertices ?? []
  if (edge.vertices !== prev.vertices || JSON.stringify(vertices) !== JSON.stringify(cell.vertices())) cell.vertices(vertices)
  // Route choice depends on endpoints, vertices, and node geometry alike.
  refreshLinkRouter(cell, edge, nodes)
  cell.connector(connectorFor(edge) as never)
  const prevColor = (cell.get('data') as { fluidColor?: string } | undefined)?.fluidColor
  const prevPending = (cell.get('data') as { pending?: { source?: string; target?: string } } | undefined)?.pending
  const pending = pendingData(edge)
  // JointJS may retain a generated marker URL when a link is replaced after
  // a branch split. Clear both marker attributes before applying the current
  // line attrs so a formerly arrowed half cannot leave a ghost arrow at the
  // junction.
  cell.removeAttr('line/targetMarker')
  cell.removeAttr('line/sourceMarker')
  cell.removeAttr('outline/targetMarker')
  cell.removeAttr('outline/sourceMarker')
  const styleChanged = edge.lineClass !== prev.lineClass || edge.arrow !== prev.arrow || fluidColor !== prevColor
    || JSON.stringify(prevPending ?? {}) !== JSON.stringify(pending)
  // Re-apply attrs after clearing marker state even when only geometry
  // changed. Otherwise an existing arrow disappears on the next route update.
  if (styleChanged || edge.vertices !== prev.vertices || edge.source !== prev.source || edge.target !== prev.target) {
    cell.removeAttr('line/strokeDasharray')
    cell.attr(lineAttrs(edge, fluidColor))
    cell.set('data', { lineClass: edge.lineClass, fluidColor, pending })
  }
}
