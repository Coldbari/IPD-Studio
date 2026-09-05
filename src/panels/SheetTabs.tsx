// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/store'
import { showStatus } from '../feedback/notices'
import { display } from '../shortcuts/registry'

/**
 * Right-click a sheet tab.
 *
 * Renaming a sheet was double-click and only double-click: no menu, no
 * button, nothing in the tab that suggested the name was editable at all. A
 * double-click on a tab is a real convention and people who know it are not
 * losing it — this is the second way in, for everyone who tried the first
 * thing an engineer tries on a tab, which is the right mouse button.
 */
function TabMenu({ at, onRename, onDelete, onClose }: {
  at: { x: number; y: number }
  onRename: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return createPortal(
    <div
      ref={ref}
      className="ctx"
      role="menu"
      data-testid="sheet-tab-menu"
      style={{
        position: 'fixed',
        left: Math.max(6, Math.min(at.x, window.innerWidth - 180)),
        top: Math.max(6, at.y - 76),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" className="ctx-item" onClick={() => { onClose(); onRename() }}>
        <span>Rename…</span>
      </button>
      {onDelete && (
        <button type="button" role="menuitem" className="ctx-item ctx-danger" onClick={() => { onClose(); onDelete() }}>
          <span>Delete sheet</span>
        </button>
      )}
    </div>,
    document.body,
  )
}

export default function SheetTabs() {
  const sheets = useStore((s) => s.doc.sheets)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const setActiveSheet = useStore((s) => s.setActiveSheet)
  const addSheet = useStore((s) => s.addSheet)
  const renameSheet = useStore((s) => s.renameSheet)
  const deleteSheet = useStore((s) => s.deleteSheet)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const startRename = (id: string) => {
    const sh = sheets.find((s) => s.id === id)
    if (!sh) return
    setEditing(id)
    setDraft(sh.name)
  }

  // The command palette's "Rename this sheet" comes in here rather than
  // reimplementing the edit — one rename, three ways to ask for it.
  useEffect(() => {
    const onAsk = () => startRename(activeSheetId)
    window.addEventListener('pid:rename-sheet', onAsk)
    return () => window.removeEventListener('pid:rename-sheet', onAsk)
  })

  const remove = (sh: (typeof sheets)[number]) => {
    // Undoable, like every other delete on the drawing — so it happens, and
    // the status line says how to reverse it. A sheet is a lot to lose, which
    // is why the count is named: silence after a big deletion is its own
    // problem.
    const n = sh.nodes.length
    deleteSheet(sh.id)
    showStatus(
      `${sh.name} deleted${n ? ` with ${n} symbol${n === 1 ? '' : 's'}` : ''}. ${display('edit.undo')} puts it back.`,
      { kind: 'warning' },
    )
  }

  return (
    <div className="sheet-tabs">
      {sheets.map((sh) => (
        <div
          key={sh.id}
          className={`sheet-tab${sh.id === activeSheetId ? ' active' : ''}`}
          onClick={() => setActiveSheet(sh.id)}
          onDoubleClick={() => startRename(sh.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setActiveSheet(sh.id)
            setMenu({ id: sh.id, x: e.clientX, y: e.clientY })
          }}
        >
          {editing === sh.id ? (
            <input
              autoFocus
              aria-label="Sheet name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { renameSheet(sh.id, draft || sh.name); setEditing(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                // Escape leaves the name as it was, rather than committing
                // whatever half-typed thing is in the box.
                if (e.key === 'Escape') { setEditing(null); setDraft('') }
              }}
            />
          ) : (
            <>
              <span>{sh.name}</span>
              {sheets.length > 1 && (
                <button
                  className="sheet-close"
                  title="Delete sheet"
                  onClick={(e) => { e.stopPropagation(); remove(sh) }}
                >
                  ×
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <button className="sheet-add" title="Add sheet" onClick={() => addSheet()}>＋</button>
      {menu && (
        <TabMenu
          at={menu}
          onRename={() => startRename(menu.id)}
          onDelete={sheets.length > 1
            ? () => { const sh = sheets.find((s) => s.id === menu.id); if (sh) remove(sh) }
            : undefined}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
