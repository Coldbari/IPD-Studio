// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useStore } from '../store/store'
import { useSimStore } from './simStore'
import Modal from '../panels/Modal'

/** Tab strip: switch, double-click rename, drag to reorder, ★ home, ⧉
 *  duplicate; deletes confirm in a proper modal. RUN keeps tabs as pure
 *  navigation (no editing affordances). */
export default function ScreenTabs() {
  const screens = useStore((s) => s.doc.hmiScreens)
  const activeScreenId = useStore((s) => s.activeScreenId)
  const setActiveScreen = useStore((s) => s.setActiveScreen)
  const addScreen = useStore((s) => s.addScreen)
  const renameScreen = useStore((s) => s.renameScreen)
  const deleteScreen = useStore((s) => s.deleteScreen)
  const setHomeScreen = useStore((s) => s.setHomeScreen)
  const reorderScreens = useStore((s) => s.reorderScreens)
  const duplicateScreen = useStore((s) => s.duplicateScreen)
  const mode = useSimStore((s) => s.mode)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const editingTabs = mode === 'edit'

  const doomed = screens.find((sc) => sc.id === deleting)

  return (
    <div className="hmi-tabs">
      {screens.map((sc, idx) => (
        <div
          key={sc.id}
          className={`hmi-tab${sc.id === activeScreenId ? ' active' : ''}`}
          draggable={editingTabs && editing !== sc.id}
          onDragStart={(e) => e.dataTransfer.setData('text/hmi-screen', sc.id)}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('text/hmi-screen')) e.preventDefault() }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('text/hmi-screen')
            if (id && id !== sc.id) reorderScreens(id, idx)
          }}
          onClick={() => setActiveScreen(sc.id)}
          onDoubleClick={() => { if (editingTabs) { setEditing(sc.id); setDraft(sc.name) } }}
        >
          {editing === sc.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { renameScreen(sc.id, draft || sc.name); setEditing(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          ) : (
            <>
              {sc.home && <span title="Home screen — RUN starts here">★</span>}
              <span>{sc.name}</span>
              {editingTabs && sc.id === activeScreenId && (
                <>
                  <button className="sheet-close" data-testid="screen-home"
                    title={sc.home ? 'Unset home screen' : 'Make home screen (RUN starts here)'}
                    onClick={(e) => { e.stopPropagation(); setHomeScreen(sc.id, !sc.home) }}>
                    {sc.home ? '★' : '☆'}
                  </button>
                  <button className="sheet-close" data-testid="screen-dup" title="Duplicate screen"
                    onClick={(e) => { e.stopPropagation(); duplicateScreen(sc.id) }}>⧉</button>
                  <button className="sheet-close" title="Delete screen"
                    onClick={(e) => { e.stopPropagation(); setDeleting(sc.id) }}>×</button>
                </>
              )}
            </>
          )}
        </div>
      ))}
      {editingTabs && <button className="hmi-tab" title="Add screen" onClick={addScreen}>＋</button>}
      {doomed && (
        <Modal title="Delete screen" onClose={() => setDeleting(null)}>
          <p style={{ margin: '4px 0 12px' }}>
            Delete <strong>{doomed.name}</strong> with {doomed.widgets.length} widget{doomed.widgets.length === 1 ? '' : 's'}? Undo (Ctrl+Z) can bring it back.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setDeleting(null)}>Cancel</button>
            <button data-testid="screen-delete-confirm" style={{ background: 'var(--hmi-alarm-high)', color: 'var(--hmi-text-on-accent)', border: 'none', borderRadius: 2, padding: '4px 14px' }}
              onClick={() => { deleteScreen(doomed.id); setDeleting(null) }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
