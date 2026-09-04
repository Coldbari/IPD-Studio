// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { dia, shapes } from '@joint/core'
import { sheetPx } from '../model/doc'
import { PID_CONNECTORS, claimJumpoverUpdates } from './jumpover'
import { cellInViewport, watchViewport } from './viewport'
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
    // Crossing hops without the quadratic sweep — see canvas/jumpover.ts.
    connectorNamespace: PID_CONNECTORS,
    async: true,
    sorting: dia.Paper.sorting.APPROX,
    interactive: { linkMove: false, labelMove: false },
    linkPinning: true,
    snapLinks: { radius: 24 },
    // markAvailable would be right if it were cheap. It is not: on every
    // link-drag mousedown JointJS walks EVERY cell in the paper, runs a DOM
    // query for its magnets, puts each through validateConnection, and then
    // builds two highlighter views per available magnet — then tears all of
    // that down again on mouseup. Measured on a 1,000-object sheet: 40-60 ms
    // to press a connection point and 23-41 ms to let go, at every zoom.
    // The same signal is carried by a class on the paper root plus the port
    // kind on each port (see interactions.ts / app.css), which costs nothing.
    markAvailable: false,
    // Big sheets only render what is near the window — see canvas/viewport.ts.
    // Under the threshold this returns true for everything and the paper
    // behaves exactly as it always has.
    viewport: cellInViewport,
  })
  claimJumpoverUpdates(paper)
  watchViewport(paper)
  return { paper, graph }
}

/**
 * The page shadow, drawn as gradients instead of an SVG filter.
 *
 * It used to be one `feDropShadow` on a rect the size of the whole sheet.
 * That reads well and costs nothing to write, but a filter has to be
 * re-evaluated over every dirty tile that touches it — and the sheet rect
 * touches all of them. Dragging one symbol at 314% zoom on a real drawing
 * therefore spent 813 ms of a 666 ms gesture in compositor rasterisation,
 * against 144 ms with the filter gone. None of it lands on the main thread,
 * which is why every JavaScript measurement of this app reported 60 FPS while
 * the drag felt heavy.
 *
 * A drop shadow on an opaque rectangle is only ever visible around its edge,
 * so it is drawn as one: four fading edges and four fading corners, in flat
 * gradients the rasteriser handles without a filter pass. Same look, and the
 * cost stops growing with zoom.
 *
 * "Same look" is not free-hand. A Gaussian blur of a straight edge is the
 * Gaussian tail Q(d/sigma) — half the flood opacity ON the edge, an eighth of
 * it one sigma out — so the gradients carry that curve as stops rather than a
 * straight ramp, out to 3 sigma where it is no longer visible. A corner is the
 * product of two such edges, which starts at a quarter of the flood opacity
 * instead of a half; the radial gradients are scaled to match. Measured
 * against the filter it replaces, every pixel of the page edge lands within
 * 12/255, and 98% of the frame within 8/255.
 */
const SHADOW_SIGMA = 7
const SHADOW_SPREAD = SHADOW_SIGMA * 3
const SHADOW_DY = 3
const SHADOW_INK = '#0d1b2a'
/** feDropShadow's flood-opacity, which the blur never reaches: an edge peaks
 *  at half of it and a corner at a quarter. */
const SHADOW_ALPHA = 0.24

/** Gaussian tail Q(z) = 1 - CDF(z), on the six stops the ramps are cut at. */
const TAIL: [number, number][] = [
  [0, 0.5],
  [1 / 6, 0.3085],
  [1 / 3, 0.1587],
  [1 / 2, 0.0668],
  [2 / 3, 0.0228],
  [1, 0.0013],
]

function shadowDefs(): string {
  /** `into` = true when the ramp runs from clear at offset 0 to the page edge
   *  at offset 1; stops must be written in ascending offset order either way. */
  const stops = (flood: number, into: boolean) => {
    const list = TAIL.map(
      ([t, q]) =>
        [into ? 1 - t : t, flood * q] as [number, number],
    ).sort((a, b) => a[0] - b[0])
    return list
      .map(([o, a]) => `<stop offset="${o.toFixed(4)}" stop-color="${SHADOW_INK}" stop-opacity="${a.toFixed(4)}"/>`)
      .join('')
  }
  const linear = (id: string, x2: number, y2: number, into: boolean) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops(SHADOW_ALPHA, into)}</linearGradient>`
  // Corners fade outward from the page's corner, which in each corner box is
  // a different one — hence four gradients rather than one. A radial gradient
  // starts at its centre, which here IS the page corner, so the ramp runs
  // outward from the same peak the edges use. A true blur has the corner at
  // half of that (it is two blurred edges multiplied), but halving it here
  // buys a correct corner at the price of a visible step where the corner box
  // meets the edge box — 11/255, running the whole height of the page.
  // Measured against the filter, matching the edges is the closer of the two.
  const corner = (id: string, cx: number, cy: number) =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="1">${stops(SHADOW_ALPHA, false)}</radialGradient>`
  return (
    linear('pid-sh-up', 0, 1, true) +
    linear('pid-sh-down', 0, 1, false) +
    linear('pid-sh-left', 1, 0, true) +
    linear('pid-sh-right', 1, 0, false) +
    corner('pid-sh-tl', 1, 1) +
    corner('pid-sh-tr', 0, 1) +
    corner('pid-sh-bl', 1, 0) +
    corner('pid-sh-br', 0, 0)
  )
}

function shadowMarkup(w: number, h: number): string {
  const s = SHADOW_SPREAD
  const dy = SHADOW_DY
  const r = (x: number, y: number, rw: number, rh: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="url(#${fill})"/>`
  return (
    r(0, dy - s, w, s, 'pid-sh-up') +
    r(0, h + dy, w, s, 'pid-sh-down') +
    r(-s, dy, s, h, 'pid-sh-left') +
    r(w, dy, s, h, 'pid-sh-right') +
    r(-s, dy - s, s, s, 'pid-sh-tl') +
    r(w, dy - s, s, s, 'pid-sh-tr') +
    r(-s, h + dy, s, s, 'pid-sh-bl') +
    r(w, h + dy, s, s, 'pid-sh-br')
  )
}

/**
 * Draw the drawing sheet: a white page with a hairline border, a soft shadow
 * to lift it off the desk, and the 8px dot grid clipped to the page.
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
    shadowDefs()

  const group = document.createElementNS(NS, 'g')
  group.setAttribute('class', 'pid-sheet')
  group.setAttribute('pointer-events', 'none')
  group.innerHTML =
    shadowMarkup(w, h) +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
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
