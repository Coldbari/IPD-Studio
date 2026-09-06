// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { dia } from '@joint/core'
import { canvasRef } from '../canvas/paperSetup'
import { LINE_CLASS_LABELS } from '../canvas/lineStyle'
import type { LineClass } from '../model/types'
import { activeSheet, useStore } from '../store/store'
import { useT } from '../i18n'

/**
 * Small floating editor that appears at the midpoint of a selected line so the
 * line class / flow arrow can be changed right where the user clicked, without
 * hunting for the property panel.
 */
export default function QuickLineEditor() {
  const t = useT()
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const setEdge = useStore((s) => s.setEdge)
  const reverseEdgeDirection = useStore((s) => s.reverseEdgeDirection)
  const deleteIds = useStore((s) => s.deleteIds)
  const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffsetX: number
    startOffsetY: number
    startRect: DOMRect
  } | null>(null)

  const edge =
    selection.length === 1
      ? activeSheet({ doc, activeSheetId }).edges.find((e) => e.id === selection[0])
      : undefined
  const sheet = activeSheet({ doc, activeSheetId })
  const arrowOn = edge?.arrow === 'flow'

  // A new line starts at its own midpoint. Once the user moves the editor,
  // the offset remains stable while the line or viewport is being redrawn.
  useEffect(() => {
    setDragOffset({ x: 0, y: 0 })
    dragRef.current = null
    setDragging(false)
  }, [edge?.id])

  useEffect(() => {
    const paper = canvasRef.paper
    if (!edge || !paper) {
      setAnchorPos(null)
      return
    }
    const update = () => {
      const points: { x: number; y: number }[] = []
      const cell = paper.model.getCell(edge.id)
      const view = cell ? (cell.findView(paper) as dia.LinkView | null) : null
      const polylines = view?.getConnection()?.toPolylines()
      for (const polyline of polylines ?? []) {
        points.push(...polyline.points.map((point) => ({ x: point.x, y: point.y })))
      }
      if (!points.length) {
        setAnchorPos(null)
        return
      }
      const bounds = points.reduce((acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x),
        maxY: Math.max(acc.maxY, point.y),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
      const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      }
      const client = paper.localToClientPoint(center)
      setAnchorPos(client)
    }
    update()
    paper.on('render:done translate scale', update)
    return () => {
      paper.off('render:done translate scale', update)
    }
  }, [edge, sheet])

  if (!edge || !anchorPos) return null

  const pos = {
    x: anchorPos.x + dragOffset.x,
    y: anchorPos.y + dragOffset.y,
  }

  const onDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!popoverRef.current) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: dragOffset.x,
      startOffsetY: dragOffset.y,
      startRect: popoverRef.current.getBoundingClientRect(),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const minDx = 8 - drag.startRect.left
    const maxDx = window.innerWidth - 8 - drag.startRect.right
    const minDy = 8 - drag.startRect.top
    const maxDy = window.innerHeight - 8 - drag.startRect.bottom
    setDragOffset({
      x: drag.startOffsetX + Math.min(maxDx, Math.max(minDx, dx)),
      y: drag.startOffsetY + Math.min(maxDy, Math.max(minDy, dy)),
    })
  }

  const onDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragging(false)
  }

  return (
    <div
      ref={popoverRef}
      className={`line-popover${dragging ? ' dragging' : ''}`}
      style={{ left: pos.x, top: pos.y }}
    >
      <button
        type="button"
        className="line-popover-drag"
        aria-label={t('Move line toolbar')}
        title={t('Move line toolbar')}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        ⠿
      </button>
      <select
        value={edge.lineClass}
        onChange={(e) => setEdge(edge.id, { lineClass: e.target.value as LineClass })}
        title={t('Line type')}
      >
        {Object.entries(LINE_CLASS_LABELS).map(([v, label]) => (
          <option key={v} value={v}>{t(label)}</option>
        ))}
      </select>
      <button
        className={arrowOn ? 'on' : ''}
        title={t('Flow arrow')}
        onClick={() => setEdge(edge.id, { arrow: arrowOn ? 'none' : 'flow' })}
      >
        ➤
      </button>
      <button title={t('Reverse direction')} onClick={() => reverseEdgeDirection(edge.id)}>⇆</button>
      <button title={t('Delete line')} onClick={() => deleteIds([edge.id])}>✕</button>
    </div>
  )
}
