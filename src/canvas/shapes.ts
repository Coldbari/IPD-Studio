// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { dia, shapes } from '@joint/core'
import type { PlantEdge, PlantNode } from '../model/types'
import { isPortEnd } from '../model/types'
import { getSymbol } from '../symbols/registry'
import type { PortSide } from '../symbols/types'
import { portSide, rotateSide } from '../symbols/portLabels'
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
    // The kind rides on the element as a CLASS so "which ports could this
    // line reach?" is a CSS question, answered by the style engine while a
    // link is being dragged, rather than a per-magnet JavaScript sweep. A
    // class and not a data attribute on purpose: class selectors are matched
    // out of a hash, and these have to stay cheap across a couple of thousand
    // ports on every style recalculation. See app.css and paperSetup's
    // markAvailable note.
    attrs: { portBody: { class: `pid-port-hit pid-kind-${p.kind}` } },
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

export type Direction = PortSide

/** Which way a link should leave a port, from the port's place on its symbol.
 *  The side rule itself lives in symbols/portLabels.ts, so the geometry that
 *  routes an elbow and the words that describe the same nozzle to a user can
 *  never come apart. */
export function portDirection(symbolId: string, portId: string): Direction | null {
  try {
    const def = getSymbol(symbolId)
    const port = def.ports.find((p) => p.id === portId)
    if (!port) return null
    return portSide(port, def.gridSize.w * 8, def.gridSize.h * 8)
  } catch {
    return null
  }
}

export const rotateDir = rotateSide

function routerFor(edge: PlantEdge, nodes?: Map<string, PlantNode>): Record<string, unknown> {
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

type RouterSpec = { name?: string; args?: Record<string, unknown> }

/** Same router, same arguments? Writing an equal-but-new router object is a
 *  Backbone change, and a change re-routes the link and re-runs its connector
 *  — which on a P&ID means recomputing every crossing hop on it. Reconcile
 *  refreshes the router of every line touching a moved symbol, so "equal
 *  means don't write" is the difference between one line re-routing and all
 *  of its neighbours doing so too. */
function sameRouter(a: RouterSpec | undefined, b: RouterSpec): boolean {
  if (!a || a.name !== b.name) return false
  const x = (a.args ?? {}) as Record<string, unknown>
  const y = (b.args ?? {}) as Record<string, unknown>
  return (
    x.step === y.step &&
    x.padding === y.padding &&
    String(x.startDirections) === String(y.startDirections) &&
    String(x.endDirections) === String(y.endDirections)
  )
}

/** Recompute a link's route choice after an endpoint node moved or resized. */
export function refreshLinkRouter(cell: dia.Link, edge: PlantEdge, nodes?: Map<string, PlantNode>): void {
  const next = routerFor(edge, nodes) as RouterSpec
  if (sameRouter(cell.router() as RouterSpec | undefined, next)) return
  cell.router(next as never)
}

const LINK_MARKUP = [
  { tagName: 'path', selector: 'wrapper', attributes: { fill: 'none', cursor: 'pointer', stroke: 'transparent' } },
  { tagName: 'path', selector: 'outline', attributes: { fill: 'none', 'pointer-events': 'none' } },
  { tagName: 'path', selector: 'line', attributes: { fill: 'none', 'pointer-events': 'none' } },
]

function lineAttrs(edge: PlantEdge, fluidColor?: string): Record<string, Record<string, unknown>> {
  const stroke = strokeFor(edge.lineClass)
  const ink = fluidColor ?? '#111'
  const marker =
    edge.arrow === 'flow'
      ? { type: 'path', d: 'M 10 -4 0 0 10 4 Z', fill: ink }
      : { type: 'none' }
  const line: Record<string, unknown> = {
    connection: true,
    fill: 'none',
    stroke: stroke.double ? '#fff' : ink,
    strokeWidth: stroke.width,
    targetMarker: stroke.double ? { type: 'none' } : marker,
  }
  if (stroke.dasharray) line.strokeDasharray = stroke.dasharray
  const outline: Record<string, unknown> = stroke.double
    ? { connection: true, fill: 'none', stroke: ink, strokeWidth: stroke.width + 3, targetMarker: marker }
    : { connection: true, fill: 'none', stroke: 'none', strokeWidth: 0, targetMarker: { type: 'none' } }
  return {
    line,
    outline,
    wrapper: { connection: true, strokeWidth: 12, stroke: 'transparent', fill: 'none' },
  }
}

export function makeLink(edge: PlantEdge, nodes?: Map<string, PlantNode>, fluidColor?: string): dia.Link {
  const link = new shapes.standard.Link({
    id: edge.id,
    source: toEnd(edge.source),
    target: toEnd(edge.target),
    vertices: edge.vertices ?? [],
    router: routerFor(edge, nodes),
    // The little hop where unrelated lines cross. The paper resolves
    // 'jumpover' through canvas/jumpover.ts — JointJS's own connector fed a
    // spatial shortlist instead of the whole graph, so the arcs are identical
    // without the L x L intersection sweep.
    connector: { name: 'jumpover', args: { size: 5 } },
    markup: LINK_MARKUP,
    data: { lineClass: edge.lineClass, fluidColor },
  })
  link.attr(lineAttrs(edge, fluidColor))
  return link
}

export function updateLink(cell: dia.Link, edge: PlantEdge, prev: PlantEdge, nodes?: Map<string, PlantNode>, fluidColor?: string): void {
  if (edge.source !== prev.source || edge.target !== prev.target) {
    cell.source(toEnd(edge.source))
    cell.target(toEnd(edge.target))
  }
  if (edge.vertices !== prev.vertices) cell.vertices(edge.vertices ?? [])
  // Route choice depends on endpoints, vertices, and node geometry alike.
  refreshLinkRouter(cell, edge, nodes)
  const prevColor = (cell.get('data') as { fluidColor?: string } | undefined)?.fluidColor
  if (edge.lineClass !== prev.lineClass || edge.arrow !== prev.arrow || fluidColor !== prevColor) {
    cell.removeAttr('line/strokeDasharray')
    cell.attr(lineAttrs(edge, fluidColor))
    cell.set('data', { lineClass: edge.lineClass, fluidColor })
  }
}
