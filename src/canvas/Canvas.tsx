// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef } from 'react'
import { canvasRef, createPaper, fitView, renderSheet, viewState, zoomAt } from './paperSetup'
import { reconcile } from './reconciler'
import { decorateLinks } from './decorations'
import { attachDropHandling } from './dropHandling'
import { attachInteractions, attachMarquee } from './interactions'
import { renderUnderlay } from './underlay'
import '../symbols/lib/index'
import { activeSheet, pauseHistory, resumeHistory, useStore } from '../store/store'

interface LabelDrag {
  id: string
  kind: 'tag' | 'label'
  sx: number
  sy: number
  ox: number
  oy: number
  rotation: number
  recorded: boolean
}

export default function Canvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sheetSize = useStore((s) => activeSheet(s).sheetSize)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const paperEl = document.createElement('div')
    host.appendChild(paperEl)
    const { paper, graph } = createPaper(paperEl, activeSheet(useStore.getState()).sheetSize)
    canvasRef.paper = paper
    canvasRef.graph = graph
    renderSheet(paper, activeSheet(useStore.getState()).sheetSize)

    // The paper is a viewport now, so it has to track its container: panel
    // toggles, window resizes and drawer opens all change the visible box.
    // Re-fit only while the user hasn't taken over the view themselves.
    viewState.userMoved = false
    const ro = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return
      const wasFitted = !viewState.userMoved
      paper.setDimensions(host.clientWidth, host.clientHeight)
      if (wasFitted) fitView(paper, graph, activeSheet(useStore.getState()).sheetSize)
    })
    ro.observe(host)

    paper.on('render:done', () => decorateLinks(paper))
    const detachDrop = attachDropHandling(host, paper)
    const detachInteractions = attachInteractions(paper, graph)
    const detachMarquee = attachMarquee(host, paper, graph)

    let prevSheetId = useStore.getState().activeSheetId
    let prevDocumentEpoch = useStore.getState().documentEpoch
    let prevSheet = activeSheet(useStore.getState())
    let prevFluids = useStore.getState().doc.fluids
    // fluid color resolver, rebuilt per pass so palette edits show live
    const colorOf = () => {
      const m = new Map((useStore.getState().doc.fluids ?? []).map((f) => [f.id, f.color]))
      return (e: { fluidId?: string }) => (e.fluidId !== undefined ? m.get(e.fluidId) : undefined)
    }
    // Reconcile mutates the graph synchronously, while a link view may only
    // have its final route on the next frame. Refresh both now and after that
    // layout pass so edited pending tags never wait for another click.
    const refreshDecorations = () => {
      decorateLinks(paper)
      window.requestAnimationFrame(() => decorateLinks(paper))
    }
    reconcile(graph, prevSheet, undefined, colorOf())
    renderUnderlay(paper, prevSheet)
    const unsubscribe = useStore.subscribe((s) => {
      const sheet = activeSheet(s)
      if (s.documentEpoch !== prevDocumentEpoch || s.activeSheetId !== prevSheetId) {
        prevDocumentEpoch = s.documentEpoch
        prevSheetId = s.activeSheetId
        prevSheet = sheet
        prevFluids = s.doc.fluids
        graph.clear()
        reconcile(graph, sheet, undefined, colorOf())
        refreshDecorations()
        renderSheet(paper, sheet.sheetSize)
        renderUnderlay(paper, sheet)
        fitView(paper, graph, sheet.sheetSize)
      } else if (sheet !== prevSheet || s.doc.fluids !== prevFluids) {
        const before = prevSheet
        prevSheet = sheet
        prevFluids = s.doc.fluids
        reconcile(graph, sheet, before, colorOf())
        refreshDecorations()
        if (sheet.sheetSize !== before.sheetSize) renderSheet(paper, sheet.sheetSize)
        if (sheet.underlay !== before.underlay) renderUnderlay(paper, sheet)
      }
    })

    let panning = false
    let spaceDown = false
    let last = { x: 0, y: 0 }
    let labelDrag: LabelDrag | null = null

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(paper, e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceDown = e.type === 'keydown'
        host.style.cursor = spaceDown ? 'grab' : ''
        if (e.type === 'keydown') e.preventDefault()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      // grab a tag/label text -> reposition it instead of moving the symbol
      if (e.button === 0 && !spaceDown) {
        // Visible text beats invisible port halos: search the whole hit
        // stack for a tag/label glyph, not just the topmost element.
        const textEl = document
          .elementsFromPoint(e.clientX, e.clientY)
          .slice(0, 5)
          .map((el) => (typeof el.closest === 'function' ? el.closest('text[joint-selector]') : null))
          .find((el): el is Element => Boolean(el))
        const sel = textEl?.getAttribute('joint-selector')
        if (textEl && (sel === 'tagL' || sel === 'tagN' || sel === 'lbl')) {
          const id = textEl.closest('[model-id]')?.getAttribute('model-id')
          const node = id ? activeSheet(useStore.getState()).nodes.find((n) => n.id === id) : undefined
          if (id && node) {
            const kind = sel === 'lbl' ? 'label' : 'tag'
            const off = (kind === 'label' ? node.labelOffset : node.tagOffset) ?? { x: 0, y: 0 }
            labelDrag = {
              id, kind, sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y,
              rotation: node.rotation, recorded: false,
            }
            host.setPointerCapture(e.pointerId)
            e.preventDefault()
            e.stopPropagation()
            return
          }
        }
      }
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        panning = true
        last = { x: e.clientX, y: e.clientY }
        host.setPointerCapture(e.pointerId)
        host.style.cursor = 'grabbing'
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (labelDrag) {
        const scale = paper.scale().sx
        let dx = (e.clientX - labelDrag.sx) / scale
        let dy = (e.clientY - labelDrag.sy) / scale
        // sheet-space delta -> element frame (invert the symbol's rotation)
        const turns = (((labelDrag.rotation % 360) + 360) % 360) / 90
        for (let i = 0; i < turns; i++) {
          const r = { x: dy, y: -dx }
          dx = r.x
          dy = r.y
        }
        const s = useStore.getState()
        const off = { x: Math.round(labelDrag.ox + dx), y: Math.round(labelDrag.oy + dy) }
        if (labelDrag.kind === 'label') s.setLabelOffset(labelDrag.id, off)
        else s.setTagOffset(labelDrag.id, off)
        if (!labelDrag.recorded) {
          labelDrag.recorded = true
          pauseHistory() // the whole drag is one undo step
        }
        return
      }
      if (!panning) return
      const t = paper.translate()
      viewState.userMoved = true
      paper.translate(t.tx + e.clientX - last.x, t.ty + e.clientY - last.y)
      last = { x: e.clientX, y: e.clientY }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (labelDrag) {
        host.releasePointerCapture(e.pointerId)
        // a plain click on the text selects its symbol
        if (!labelDrag.recorded) useStore.getState().setSelection([labelDrag.id])
        labelDrag = null
        resumeHistory()
        return
      }
      if (panning) {
        panning = false
        host.releasePointerCapture(e.pointerId)
        host.style.cursor = spaceDown ? 'grab' : ''
      }
    }

    host.addEventListener('wheel', onWheel, { passive: false })
    host.addEventListener('pointerdown', onPointerDown, true)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)

    return () => {
      detachMarquee()
      detachInteractions()
      detachDrop()
      unsubscribe()
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('pointerdown', onPointerDown, true)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      paper.remove()
      ro.disconnect()
      canvasRef.paper = undefined
      canvasRef.graph = undefined
      host.innerHTML = ''
    }
  }, [])

  useEffect(() => {
    const paper = canvasRef.paper
    const graph = canvasRef.graph
    if (!paper || !graph) return
    renderSheet(paper, sheetSize)
    fitView(paper, graph, sheetSize)
  }, [sheetSize])

  return <div ref={hostRef} className="canvas-host" data-testid="canvas" />
}
