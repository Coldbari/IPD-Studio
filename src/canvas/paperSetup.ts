// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { dia, shapes } from '@joint/core'
import { sheetPx } from '../model/doc'
import type { SheetSize } from '../model/types'

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 4

/** Breathing room left around the sheet when fitting, in screen px. */
const FIT_PADDING = 28

const NS = 'http://www.w3.org/2000/svg'

/**
 * Whether the user has taken the view over by panning or zooming. While false,
 * the canvas re-fits itself when its container changes size (panel toggles,
 * window resizes) — which is what makes "fit to my screen" stay true. Any
 * deliberate pan or zoom sets it, and Fit clears it again.
 */
export const viewState = { userMoved: false }


/**
 * The paper is a VIEWPORT, not the sheet.
 *
 * It used to be created at the sheet's pixel size — 1587px for an A3, 3178px
 * for an A1 — which meant "Fit" asked JointJS to fit the drawing to the sheet
 * rather than to the window, and the result was clipped by whatever the panels
 * left visible. The paper now fills its container and resizes with it, and the
 * sheet is drawn as a white page on the grey desk behind the JointJS layers
 * (see `renderSheet`). Pan and zoom are free to move anywhere.
 *
 * Exports don't read these dimensions — they build their own viewBox from
 * sheetPx() — but they do clone paper.svg, so they strip `.pid-sheet`.
 */
export function createPaper(el: HTMLElement, _sheetSize: SheetSize): { paper: dia.Paper; graph: dia.Graph } {
  const graph = new dia.Graph({}, { cellNamespace: shapes })
  const host = el.parentElement
  const paper = new dia.Paper({
    el,
    model: graph,
    width: host?.clientWidth || 800,
    height: host?.clientHeight || 600,
    gridSize: 8,
    // The grid belongs to the sheet, not the desk — renderSheet draws it.
    drawGrid: false,
    background: { color: 'transparent' },
    async: true,
    sorting: dia.Paper.sorting.APPROX,
    interactive: { linkMove: false, labelMove: false },
    linkPinning: true,
    // A line connects only when the pointer is actually released on a port.
    // Nearby ports must not pull a route away from the point the user chose.
    snapLinks: false,
    markAvailable: true,
  })
  return { paper, graph }
}

/**
 * Draw the drawing sheet: a white page with a hairline border, a soft drop
 * shadow to lift it off the desk, and the 8px dot grid clipped to the page.
 * Sits behind `.joint-layers` and takes no pointer events.
 */
export function renderSheet(paper: dia.Paper, sheetSize: SheetSize): void {
  const svg = paper.svg
  svg.querySelector('.pid-sheet')?.remove()
  svg.querySelector('#pid-sheet-defs')?.remove()

  const { w, h } = sheetPx(sheetSize)

  const defs = document.createElementNS(NS, 'defs')
  defs.setAttribute('id', 'pid-sheet-defs')
  defs.innerHTML =
    `<pattern id="pid-grid" width="8" height="8" patternUnits="userSpaceOnUse">` +
    `<circle cx="0.5" cy="0.5" r="0.6" fill="#c4c9d2"/>` +
    `</pattern>` +
    `<filter id="pid-sheet-shadow" x="-4%" y="-4%" width="108%" height="108%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="#0d1b2a" flood-opacity="0.24"/>` +
    `</filter>`

  const group = document.createElementNS(NS, 'g')
  group.setAttribute('class', 'pid-sheet')
  group.setAttribute('pointer-events', 'none')
  group.innerHTML =
    `<rect width="${w}" height="${h}" fill="#ffffff" filter="url(#pid-sheet-shadow)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#pid-grid)"/>` +
    `<rect width="${w}" height="${h}" fill="none" stroke="#98a2ae" stroke-width="1" vector-effect="non-scaling-stroke"/>`

  svg.insertBefore(defs, svg.firstChild)
  // Must go INSIDE .joint-layers: that group carries the pan/zoom transform, so
  // anything parked next to it instead is drawn unscaled at the SVG origin and
  // covers the viewport. Behind the underlay so DXF traces sit on the page.
  const layers = svg.querySelector('.joint-layers')
  if (!layers) return
  layers.insertBefore(group, layers.firstChild)
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/** Zoom the paper about a client-space point, clamped to [MIN_ZOOM, MAX_ZOOM]. */
export function zoomAt(paper: dia.Paper, clientX: number, clientY: number, factor: number): void {
  const current = paper.scale().sx
  const next = clampZoom(current * factor)
  if (next === current) return
  viewState.userMoved = true
  const local = paper.clientToLocalPoint({ x: clientX, y: clientY })
  paper.scale(next, next)
  const after = paper.localToClientPoint(local)
  const t = paper.translate()
  paper.translate(t.tx + (clientX - after.x), t.ty + (clientY - after.y))
}

/** Zoom about the centre of the visible viewport. */
export function zoomCenter(paper: dia.Paper, factor: number): void {
  const rect = (paper.el as HTMLElement).getBoundingClientRect()
  zoomAt(paper, rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
}

/**
 * Fit the whole page into the visible viewport and centre it.
 *
 * The target is the sheet unioned with the content bounding box, so a symbol
 * dragged off the page still ends up on screen instead of silently outside it.
 * Because the paper now matches its container, this is automatically correct
 * with the palette and properties panels open, closed, or mid-resize.
 */
export function fitView(paper: dia.Paper, graph: dia.Graph, sheetSize: SheetSize): void {
  const el = paper.el as HTMLElement
  const vw = el.clientWidth
  const vh = el.clientHeight
  if (!vw || !vh) return

  const { w, h } = sheetPx(sheetSize)
  let x0 = 0
  let y0 = 0
  let x1 = w
  let y1 = h
  if (graph.getCells().length) {
    const b = graph.getBBox()
    if (b && b.width >= 0 && b.height >= 0) {
      x0 = Math.min(x0, b.x)
      y0 = Math.min(y0, b.y)
      x1 = Math.max(x1, b.x + b.width)
      y1 = Math.max(y1, b.y + b.height)
    }
  }
  const tw = x1 - x0
  const th = y1 - y0
  if (tw <= 0 || th <= 0) return

  const scale = clampZoom(Math.min((vw - FIT_PADDING * 2) / tw, (vh - FIT_PADDING * 2) / th))
  viewState.userMoved = false
  paper.scale(scale, scale)
  paper.translate((vw - tw * scale) / 2 - x0 * scale, (vh - th * scale) / 2 - y0 * scale)
}

/** Reset to 1:1 with the sheet's top-left corner just inside the viewport. */
export function zoomActual(paper: dia.Paper): void {
  viewState.userMoved = true
  paper.scale(1, 1)
  paper.translate(FIT_PADDING, FIT_PADDING)
}

/** Module-scope handle so panels/exports can reach the live paper. */
export const canvasRef: { paper?: dia.Paper; graph?: dia.Graph } = {}
