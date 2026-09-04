// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo } from 'react'
import { deriveLoops } from '../store/selectors'
import { formatTag } from '../isa/tag'
import { printLoopDiagram } from '../export/loopDiagram'
import { useStore } from '../store/store'

export default function LoopPanel() {
  const doc = useStore((s) => s.doc)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const setSelection = useStore((s) => s.setSelection)
  const setActiveSheet = useStore((s) => s.setActiveSheet)
  const loops = useMemo(() => deriveLoops(doc), [doc])

  // Loop membership is a project-wide tag join, so a loop routinely spans
  // sheets — but the canvas graph only ever holds the active one. Selecting a
  // member from another sheet used to highlight nothing and leave the inspector
  // showing sheet properties, so the loop looked half-empty.
  const sheetOfNode = useMemo(() => {
    const m = new Map<string, string>()
    for (const sh of doc.sheets) for (const n of sh.nodes) m.set(n.id, sh.id)
    return m
  }, [doc])

  const sheetName = (id: string) => doc.sheets.find((sh) => sh.id === id)?.name ?? id

  if (loops.length === 0) return <div className="drawer-empty">No tagged instruments yet.</div>
  return (
    <div className="drawer-list">
      {loops.map((loop) => {
        const bySheet = new Map<string, string[]>()
        for (const m of loop.members) {
          const sid = sheetOfNode.get(m.nodeId)
          if (!sid) continue
          const list = bySheet.get(sid)
          if (list) list.push(m.nodeId)
          else bySheet.set(sid, [m.nodeId])
        }
        // Stay where the user is if any of the loop is here; otherwise go to
        // the sheet carrying most of it.
        const target = bySheet.has(activeSheetId)
          ? activeSheetId
          : [...bySheet.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0]
        const elsewhere = [...bySheet.keys()].filter((id) => id !== target)

        return (
          <div key={`${loop.family}-${loop.loop}`} className="loop-row">
            <button
              className="drawer-item"
              disabled={!target}
              onClick={() => {
                if (!target) return
                // setActiveSheet clears selection, so it has to come first.
                if (target !== activeSheetId) setActiveSheet(target)
                setSelection(bySheet.get(target) ?? [])
              }}
            >
              <b>Loop {loop.family}-{loop.loop}</b>{' '}
              {loop.members.map((m) => formatTag(m.tag, '-')).join(', ')}
              {loop.hint && <span className="loop-hint"> — {loop.hint}</span>}
              {elsewhere.length > 0 && (
                <span className="loop-hint"> — also on {elsewhere.map(sheetName).join(', ')}</span>
              )}
            </button>
            <button
              className="loop-diagram-btn"
              title="Generate ISA-5.4-style loop diagram"
              onClick={() => printLoopDiagram(doc, loop.family, loop.loop)}
            >
              Diagram
            </button>
          </div>
        )
      })}
    </div>
  )
}
