// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import type { dia } from '@joint/core'
import { canvasRef } from '../canvas/paperSetup'
import { LINE_CLASS_LABELS } from '../canvas/lineStyle'
import type { LineClass } from '../model/types'
import { activeSheet, useStore } from '../store/store'

/**
 * Small floating editor that appears at the midpoint of a selected line so the
 * line class / flow arrow can be changed right where the user clicked, without
 * hunting for the property panel.
 */
export default function QuickLineEditor() {
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const setEdge = useStore((s) => s.setEdge)
  const deleteIds = useStore((s) => s.deleteIds)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const edge =
    selection.length === 1
      ? activeSheet({ doc, activeSheetId }).edges.find((e) => e.id === selection[0])
      : undefined

  useEffect(() => {
    const paper = canvasRef.paper
    if (!edge || !paper) {
      setPos(null)
      return
    }
    const update = () => {
      const cell = paper.model.getCell(edge.id)
      const view = cell ? (cell.findView(paper) as dia.LinkView | null) : null
      const conn = view?.getConnection()
      const mid = conn?.pointAt(0.5)
      if (!mid) {
        setPos(null)
        return
      }
      const client = paper.localToClientPoint(mid)
      // Same object back when the midpoint has not actually moved, so React
      // bails out. This runs on `render:done translate scale`, and a fresh
      // {x,y} never compares equal — so for as long as a line stayed
      // selected, every pan, every zoom and every neighbouring drag cost a
      // React commit per frame for a popover that had not moved.
      setPos((prev) =>
        prev && Math.abs(prev.x - client.x) < 0.5 && Math.abs(prev.y - client.y) < 0.5
          ? prev
          : { x: client.x, y: client.y })
    }
    update()
    paper.on('render:done translate scale', update)
    return () => {
      paper.off('render:done translate scale', update)
    }
  }, [edge])

  if (!edge || !pos) return null

  const reverse = () =>
    setEdge(edge.id, {
      source: edge.target,
      target: edge.source,
      vertices: edge.vertices ? [...edge.vertices].reverse() : undefined,
    })

  return (
    <div className="line-popover" style={{ left: pos.x, top: pos.y }}>
      <select
        value={edge.lineClass}
        onChange={(e) => setEdge(edge.id, { lineClass: e.target.value as LineClass })}
        title="Line type"
      >
        {Object.entries(LINE_CLASS_LABELS).map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
      <button
        className={edge.arrow === 'flow' ? 'on' : ''}
        title="Flow arrow"
        onClick={() => setEdge(edge.id, { arrow: edge.arrow === 'flow' ? 'none' : 'flow' })}
      >
        ➤
      </button>
      <button title="Reverse direction" onClick={reverse}>⇆</button>
      <button title="Delete line" onClick={() => deleteIds([edge.id])}>✕</button>
    </div>
  )
}
