// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import { findTag } from '../search/findTag'
import { useStore } from '../store/store'
import { locateCell } from '../canvas/locate'
import { navigateWorkspace } from '../routes'
import { downloadInstrumentIndex, downloadLineList } from '../export/csv'
import { canvasRef, fitView } from '../canvas/paperSetup'
import { activeSheet } from '../store/store'
import { useT } from '../i18n'

export interface Command {
  id: string
  label: string
  hint?: string
  run(): void
}

/** Commands are listed here rather than discovered, so the palette can never
 *  offer something that no longer exists. Later workspaces append their own. */
export function baseCommands(): Command[] {
  return [
    { id: 'go.draw', label: 'Go to Draw', hint: 'Ctrl+1', run: () => navigateWorkspace('draw') },
    { id: 'go.data', label: 'Go to Data', hint: 'Ctrl+2', run: () => navigateWorkspace('data') },
    { id: 'go.checks', label: 'Go to Checks', hint: 'Ctrl+3', run: () => navigateWorkspace('checks') },
    { id: 'go.hmi', label: 'Go to HMI Studio', hint: 'Ctrl+4', run: () => navigateWorkspace('hmi') },
    { id: 'sheet.add', label: 'Add a sheet', run: () => useStore.getState().addSheet() },
    {
      id: 'view.fit',
      label: 'Fit the sheet in the window',
      hint: 'Shift+F',
      run: () => {
        const { paper, graph } = canvasRef
        if (paper && graph) fitView(paper, graph, activeSheet(useStore.getState()).sheetSize)
      },
    },
    { id: 'export.index', label: 'Export instrument index (CSV)', run: () => downloadInstrumentIndex() },
    { id: 'export.lines', label: 'Export line list (CSV)', run: () => downloadLineList() },
    { id: 'save', label: 'Save to your account', hint: 'Ctrl+S', run: () => window.dispatchEvent(new Event('pid:save')) },
  ]
}

type Item =
  | { kind: 'tag'; key: string; label: string; sub: string; run(): void }
  | { kind: 'command'; key: string; label: string; sub: string; run(): void }

/**
 * One way in, for an app that is growing more screens than a toolbar can hold.
 *
 * Ctrl+F still opens it — the find-a-tag muscle memory is years old and there
 * is no reason to break it. A leading `>` narrows to commands, the way every
 * palette does; anything else searches tags and labels first and offers
 * matching commands underneath.
 */
export default function CommandPalette() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const doc = useStore((s) => s.doc)
  const setActiveSheet = useStore((s) => s.setActiveSheet)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && (k === 'k' || k === 'f')) {
        e.preventDefault()
        setOpen(true)
        setQuery('')
        setCursor(0)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = useMemo<Item[]>(() => {
    const raw = query.trim()
    const commandsOnly = raw.startsWith('>')
    const needle = (commandsOnly ? raw.slice(1) : raw).trim()
    const lower = needle.toLowerCase()

    const commands: Item[] = baseCommands()
      .filter((c) => !lower || c.label.toLowerCase().includes(lower))
        .map((c) => ({ kind: 'command', key: c.id, label: c.label, sub: c.hint ?? t('Command'), run: c.run }))

    if (commandsOnly) return commands.slice(0, 12)

    const tags: Item[] = needle
      ? findTag(doc, needle)
          .slice(0, 10)
          .map((h) => ({
            kind: 'tag',
            key: h.nodeId,
            label: h.display,
            sub: h.sheetName,
            run: () => {
              navigateWorkspace('draw')
              locateCell(h.nodeId, h.sheetId)
            },
          }))
      : []

    return [...tags, ...commands.slice(0, needle ? 5 : 12)]
  }, [query, doc, setActiveSheet])

  if (!open) return null

  const pick = (i: number) => {
    const item = items[i]
    if (!item) return
    setOpen(false)
    item.run()
  }

  return (
    <div className="search-overlay" onClick={() => setOpen(false)}>
      <div className="search-box" data-testid="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          data-testid="command-input"
          placeholder={t('Find a tag, or type > for commands…  (Esc to close)')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
            if (e.key === 'Enter') pick(cursor)
          }}
        />
        {items.length > 0 && (
          <ul>
            {items.map((item, i) => (
              <li
                key={`${item.kind}:${item.key}`}
                className={i === cursor ? 'active' : ''}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(i)}
              >
                <b>{item.kind === 'command' ? `▸ ${t(item.label)}` : item.label}</b>
                <span className="search-sheet">{item.sub}</span>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && items.length === 0 && <div className="search-empty">{t('No matches')}</div>}
      </div>
    </div>
  )
}
