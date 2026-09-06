// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import { byCategory, getSymbol } from '../symbols/registry'
import { placeAtCenter, placeTypicalAtCenter } from '../canvas/dropHandling'
import { TYPICALS } from '../assist/typicals'
import { useStore } from '../store/store'
import SymbolImportDialog from './SymbolImportDialog'
import type { SymbolCategory, SymbolDef } from '../symbols/types'
import type { InstrumentPreset } from './instrumentPresets'
import { INSTRUMENT_PRESETS, TOP_PRESET_LETTERS, searchPalette } from './instrumentPresets'
import { useT } from '../i18n'

export const DRAG_MIME = 'application/x-pid-symbol'

export interface DragPayload {
  symbolId: string
  presetLetters?: string
}

/**
 * The palette drag in flight. `dragover` is not allowed to read dataTransfer
 * — browsers only hand the payload over on drop — so the canvas reads WHAT is
 * being dragged from here in order to preview where it would dock.
 */
export const paletteDrag: { payload: DragPayload | null } = { payload: null }

const CATEGORY_ORDER: [SymbolCategory, string][] = [
  ['custom', 'Custom'],
  ['instruments', 'Instruments'],
  ['control-valves', 'Control Valves'],
  ['valves', 'Manual Valves'],
  ['safety', 'Safety & Relief'],
  ['flow-elements', 'Flow Elements'],
  ['accessories', 'Accessories'],
  ['rotating', 'Pumps & Rotating'],
  ['vessels', 'Vessels & Columns'],
  ['heat', 'Heat Transfer'],
  ['inline', 'Fittings & Inline'],
  ['control', 'Control & Logic'],
  ['annotation', 'Annotation'],
]

/** Collapsed sections show at most this many entries; "Show all" expands. */
const VISIBLE = 8

const PRESET_GROUPS: InstrumentPreset['group'][] = ['Flow', 'Pressure', 'Level', 'Temperature', 'Analysis', 'Other']

function Preview({ def }: { def: SymbolDef }) {
  const w = def.gridSize.w * 8
  const h = def.gridSize.h * 8
  return (
    <svg
      viewBox={`-2 -2 ${w + 4} ${h + 4}`}
      className="palette-preview"
      dangerouslySetInnerHTML={{ __html: def.render(def.defaultConfig ?? {}) }}
    />
  )
}

function Entry({ def, label, title, presetLetters }: { def: SymbolDef; label: string; title?: string; presetLetters?: string }) {
  return (
    <div
      className="palette-entry"
      draggable
      title={title ?? label}
      onDragStart={(e) => {
        const payload: DragPayload = { symbolId: def.id }
        if (presetLetters) payload.presetLetters = presetLetters
        paletteDrag.payload = payload
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDragEnd={() => {
        paletteDrag.payload = null
      }}
    >
      <Preview def={def} />
      <span className="palette-label">{label}</span>
    </div>
  )
}

export default function Palette({ onCollapse }: { onCollapse?: () => void }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [importOpen, setImportOpen] = useState(false)
  const customSymbols = useStore((s) => s.doc.customSymbols)
  const groups = useMemo(() => byCategory(), [customSymbols])
  const results = useMemo(() => (query ? searchPalette(query) : null), [query, customSymbols])

  const toggle = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }
  const toggleMore = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }
  const moreButton = (cat: string, hidden: number) => (
    <button className="palette-more" onClick={() => toggleMore(cat)}>
      {expanded.has(cat) ? t('▴ Show less') : `▾ ${t('Show all')}（${hidden}）`}
    </button>
  )

  return (
    <aside className="palette">
      <div className="panel-head">
        <h2>{t('Symbols')}</h2>
        <span className="sp" />
        {onCollapse && (
          <button className="panel-collapse" title={t('Hide the symbol palette')} onClick={onCollapse}>◂</button>
        )}
      </div>
      <div className="palette-head">
        <input
          className="palette-search"
          placeholder={t('Search symbols…  (Enter places)')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results && results[0]) {
              placeAtCenter(results[0].symbolId, results[0].presetLetters)
            }
          }}
        />
      </div>
      <button className="palette-import" onClick={() => setImportOpen(true)}>{t('＋ Import symbol…')}</button>
      {importOpen && <SymbolImportDialog onClose={() => setImportOpen(false)} />}
      {!query && (
        <section>
          <button className="palette-cat" onClick={() => toggle('typicals')}>
            {!collapsed.has('typicals') ? '▾' : '▸'} {t('Typical Loops')}
          </button>
          {!collapsed.has('typicals') && (
            <div className="typical-list">
              {TYPICALS.map((typical) => (
                <button
                  key={typical.id}
                  className="typical-entry"
                  title={t('Place a wired, tagged') + ' ' + t(typical.name)}
                  onClick={() => placeTypicalAtCenter(typical.id)}
                >
                  ⚡ {t(typical.name)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {results ? (
        <div className="palette-grid">
          {results.map((hit) => (
            <Entry
              key={hit.symbolId + (hit.presetLetters ?? '')}
              def={getSymbol(hit.symbolId)}
              label={t(hit.label)}
              title={t(hit.name)}
              presetLetters={hit.presetLetters}
            />
          ))}
        </div>
      ) : (
        CATEGORY_ORDER.map(([cat, title]) => {
          const defs = groups.get(cat) ?? []
          if (defs.length === 0) return null
          const isOpen = !collapsed.has(cat)
          const isFull = expanded.has(cat)
          const bubble = cat === 'instruments' ? defs.find((d) => d.id === 'instr.bubble') : undefined
          const preset = (p: InstrumentPreset) => (
            <Entry key={p.letters} def={bubble!} label={p.letters} title={t(p.name)} presetLetters={p.letters} />
          )
          return (
            <section key={cat}>
              <button className="palette-cat" onClick={() => toggle(cat)}>
                {isOpen ? '▾' : '▸'} {t(title)}
              </button>
              {isOpen && cat === 'instruments' && bubble && (
                <>
                  {!isFull ? (
                    <div className="palette-grid">
                      {INSTRUMENT_PRESETS.filter((p) => TOP_PRESET_LETTERS.includes(p.letters)).map(preset)}
                    </div>
                  ) : (
                    <>
                      {PRESET_GROUPS.map((g) => (
                          <div key={g}>
                          <div className="palette-subhead">{t(g)}</div>
                          <div className="palette-grid">
                            {INSTRUMENT_PRESETS.filter((p) => p.group === g).map(preset)}
                          </div>
                        </div>
                      ))}
                      <div className="palette-grid">
                        {defs.map((def) => (
                          <Entry key={def.id} def={def} label={t(def.name)} title={t(def.name)} />
                        ))}
                      </div>
                    </>
                  )}
                  {moreButton(cat, INSTRUMENT_PRESETS.length - TOP_PRESET_LETTERS.length + defs.length)}
                </>
              )}
              {isOpen && cat !== 'instruments' && (
                <>
                  <div className="palette-grid">
                    {(isFull ? defs : defs.slice(0, VISIBLE)).map((def) => (
                      <Entry key={def.id} def={def} label={t(def.name)} title={t(def.name)} />
                    ))}
                  </div>
                  {defs.length > VISIBLE && moreButton(cat, defs.length - VISIBLE)}
                </>
              )}
            </section>
          )
        })
      )}
    </aside>
  )
}
