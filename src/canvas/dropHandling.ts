// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { dia } from '@joint/core'
import { ulid } from 'ulid'
import { DRAG_MIME, paletteDrag, type DragPayload } from '../panels/Palette'
import { getSymbol } from '../symbols/registry'
import type { NodeKind, PlantEdge, PlantNode } from '../model/types'
import type { SymbolDef } from '../symbols/types'
import { nextLoopNumber } from '../isa/autonumber'
import { buildTypical } from '../assist/typicals'
import { activeSheet, useStore } from '../store/store'
import { canvasRef } from './paperSetup'
import { focusCanvas } from './keyboardNav'
import { notePlacement } from '../panels/componentPrefs'
import { type Dock, type DockIndex, buildDockIndex, dockEdge, dockRadius, findDock, flashDockMade, showDockHint } from './autoConnect'

export function kindForSymbol(def: Pick<SymbolDef, 'tagRule' | 'category'>): NodeKind {
  switch (def.tagRule) {
    case 'isa-instrument':
      return 'instrument'
    case 'valve':
      return 'valve'
    case 'equipment':
      return 'equipment'
    default:
      return def.category === 'annotation' ? 'annotation' : 'fitting'
  }
}

const snap8 = (v: number) => Math.round(v / 8) * 8

/** Place a symbol snapped at the visible canvas center (palette Enter quick-add). */
export function placeAtCenter(symbolId: string, presetLetters?: string): void {
  const paper = canvasRef.paper
  if (!paper) return
  const def = getSymbol(symbolId)
  const el = paper.el as HTMLElement
  const rect = el.getBoundingClientRect()
  const local = paper.clientToLocalPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  const store = useStore.getState()
  const w = def.gridSize.w * 8
  const h = def.gridSize.h * 8
  const node: Parameters<typeof store.addNode>[0] = {
    symbolId: def.id,
    kind: kindForSymbol(def),
    x: snap8(local.x - w / 2),
    y: snap8(local.y - h / 2),
    rotation: 0,
  }
  if (def.defaultConfig) node.config = { ...def.defaultConfig }
  if (presetLetters) {
    node.tag = { letters: presetLetters, loop: nextLoopNumber(store.doc, presetLetters) }
  }
  const id = store.addNode(node)
  store.setSelection([id])
  notePlacement(def.id, presetLetters)
  // The keyboard follows the symbol onto the sheet. Without this, placing from
  // the palette left focus in the search field with the new symbol selected
  // behind it, so Delete and R — which act on the selection — went to a text
  // input instead of the drawing.
  focusCanvas()
}

/** Place a fully wired typical loop with its top-left near the canvas center. */
export function placeTypicalAtCenter(typicalId: string): void {
  const paper = canvasRef.paper
  if (!paper) return
  const el = paper.el as HTMLElement
  const rect = el.getBoundingClientRect()
  const local = paper.clientToLocalPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  const store = useStore.getState()
  const { nodes, edges } = buildTypical(typicalId, store.doc, { x: local.x - 96, y: local.y - 96 })
  store.addBatch(nodes, edges)
  focusCanvas()
}

/** Open a file the user dropped on the canvas, routed by extension. */
async function openDroppedFile(file: File): Promise<void> {
  const name = file.name.toLowerCase()
  const text = await file.text()
  const store = useStore.getState()
  if (name.endsWith('.dxf')) {
    const { loadUnderlayText } = await import('../persist/underlay')
    await loadUnderlayText(file.name, text)
    return
  }
  // Opening replaces the whole document, and Undo does not reach across a
  // load — so this is one of the few places a question is right.
  if (store.dirty) {
    const { confirmAction } = await import('../feedback/notices')
    const ok = await confirmAction({
      title: 'Open this drawing?',
      body: `“${file.name}” replaces what is open now, and this cannot be undone. Your unsaved changes are autosaved and can be recovered from File ▸ Version history.`,
      confirmLabel: 'Open it',
      danger: true,
    })
    if (!ok) return
  }
  const { loadAnyText } = await import('../persist/file')
  const { notify } = await import('../feedback/notices')
  const { openFailureNotice } = await import('../persist/openErrors')
  try {
    loadAnyText(file.name, text)
  } catch (err) {
    notify(openFailureNotice(file.name, err))
  }
}

/** Id for the not-yet-created symbol under the cursor during a palette drag. */
const DRAG_ID = '__palette-drag__'

/** The node a palette payload becomes, centred on a sheet point. */
function placedNode(def: SymbolDef, local: { x: number; y: number }): PlantNode {
  const w = def.gridSize.w * 8
  const h = def.gridSize.h * 8
  const node: PlantNode = {
    id: DRAG_ID,
    symbolId: def.id,
    kind: kindForSymbol(def),
    x: snap8(local.x - w / 2),
    y: snap8(local.y - h / 2),
    rotation: 0,
  }
  if (def.defaultConfig) node.config = { ...def.defaultConfig }
  return node
}

/**
 * Where the dragged symbol would land and what it would dock onto — computed
 * identically for the hover preview and for the drop itself, so the ring the
 * user aims at is exactly the connection they get.
 */
/** Resolved connection points for the sheet the palette drag is over. A drag
 *  fires `dragover` at pointer rate; the sheet underneath it is not changing. */
let dragGeom: { nodes: PlantNode[]; edges: PlantEdge[]; dock: DockIndex } | null = null

function previewDrop(
  payload: DragPayload,
  paper: dia.Paper,
  clientX: number,
  clientY: number,
): { node: PlantNode; dock: Dock | null } | null {
  let def: SymbolDef
  try {
    def = getSymbol(payload.symbolId)
  } catch {
    return null
  }
  const node = placedNode(def, paper.clientToLocalPoint({ x: clientX, y: clientY }))
  const state = useStore.getState()
  const sheet = activeSheet(state)
  if (!dragGeom || dragGeom.nodes !== sheet.nodes || dragGeom.edges !== sheet.edges) {
    dragGeom = { nodes: sheet.nodes, edges: sheet.edges, dock: buildDockIndex(sheet.nodes, sheet.edges) }
  }
  const dock = findDock(
    node,
    sheet.nodes,
    sheet.edges,
    state.activeLineClass,
    dockRadius(paper.scale().sx),
    undefined,
    dragGeom.dock,
  )
  return { node, dock }
}

export function attachDropHandling(host: HTMLElement, paper: dia.Paper): () => void {
  /** Take down the docking preview (ring + every symbol's connection dots). */
  const clearPreview = () => {
    paper.el.classList.remove('pid-docking')
    showDockHint(paper, null)
  }

  // The hint only has to be right once per painted frame; `dragover` fires far
  // more often than that, and each one asks where the symbol would dock.
  let hintFrame = 0
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(DRAG_MIME) || e.dataTransfer?.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const payload = paletteDrag.payload
    if (!payload) return
    // Connection dots come up across the sheet so the user can see what there
    // is to aim at, and the ring says which one is currently caught.
    paper.el.classList.add('pid-docking')
    const { clientX, clientY } = e
    if (hintFrame) return
    hintFrame = requestAnimationFrame(() => {
      hintFrame = 0
      showDockHint(paper, previewDrop(payload, paper, clientX, clientY)?.dock?.at ?? null)
    })
  }
  const onDragLeave = (e: DragEvent) => {
    const to = e.relatedTarget
    if (to instanceof Node && host.contains(to)) return
    clearPreview()
  }
  const onDragEnd = () => {
    if (hintFrame) { cancelAnimationFrame(hintFrame); hintFrame = 0 }
    clearPreview()
  }

  const onDrop = (e: DragEvent) => {
    clearPreview()
    const file = e.dataTransfer?.files?.[0]
    if (file && /\.(pnid|json|xml|dxf)$/i.test(file.name)) {
      e.preventDefault()
      void openDroppedFile(file)
      return
    }
    const raw = e.dataTransfer?.getData(DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    const payload = JSON.parse(raw) as DragPayload
    const preview = previewDrop(payload, paper, e.clientX, e.clientY)
    if (!preview) return
    const { dock } = preview
    const store = useStore.getState()
    const id = ulid()
    const node: PlantNode = { ...preview.node, id, ...(dock ? { x: dock.x, y: dock.y } : {}) }
    if (payload.presetLetters) {
      node.tag = { letters: payload.presetLetters, loop: nextLoopNumber(store.doc, payload.presetLetters) }
    }
    // One batch either way: the symbol and the line it docked onto arrive
    // together, and one undo takes both back. addBatch selects the new node.
    store.addBatch([node], dock ? [{ ...dockEdge(id, dock), id: ulid() }] : [])
    notePlacement(payload.symbolId, payload.presetLetters)
    // Say so, plainly. A symbol dropped near a nozzle and a symbol dropped ONTO
    // one look much the same once the drag ghost is gone.
    if (dock) flashDockMade(paper, dock.at)
  }

  host.addEventListener('dragover', onDragOver)
  host.addEventListener('dragleave', onDragLeave)
  host.addEventListener('drop', onDrop)
  window.addEventListener('dragend', onDragEnd)
  return () => {
    if (hintFrame) { cancelAnimationFrame(hintFrame); hintFrame = 0 }
    clearPreview()
    host.removeEventListener('dragover', onDragOver)
    host.removeEventListener('dragleave', onDragLeave)
    host.removeEventListener('drop', onDrop)
    window.removeEventListener('dragend', onDragEnd)
  }
}
