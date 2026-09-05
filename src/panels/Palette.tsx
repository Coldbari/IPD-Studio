// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { byCategory, getSymbol } from '../symbols/registry'
import { placeAtCenter, placeTypicalAtCenter } from '../canvas/dropHandling'
import { focusCanvas } from '../canvas/keyboardNav'
import {
  componentKey, splitKey, toggleFavourite,
  useFavouriteComponents, useRecentComponents,
} from './componentPrefs'
import { TYPICALS } from '../assist/typicals'
import { useStore } from '../store/store'
import SymbolImportDialog from './SymbolImportDialog'
import type { SymbolCategory, SymbolDef } from '../symbols/types'
import type { InstrumentPreset } from './instrumentPresets'
import { INSTRUMENT_PRESETS, TOP_PRESET_LETTERS, searchPalette } from './instrumentPresets'

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

/**
 * One symbol in the library.
 *
 * Two ways to place it, because they answer two different questions. A CLICK
 * says "I want one of these" and drops it in the middle of the view, selected,
 * with the inspector already on it — no aim required. A DRAG says "I want one
 * of these HERE", and carries the docking preview so it can land connected.
 *
 * It used to be drag only, and a click did nothing whatsoever: no symbol, no
 * message, no cursor change. Directly above these tiles the Typical Loops
 * entries ARE click-to-place buttons, so the palette taught the wrong model
 * eight pixels away from where it refused to obey it.
 *
 * A real <button> rather than a styled div: it brings the click, the Enter/
 * Space activation and the accessible name with it, and it is what makes the
 * `.palette-entry:focus-visible` rule in the stylesheet able to match at all.
 */
function Entry({ def, label, title, presetLetters }: { def: SymbolDef; label: string; title?: string; presetLetters?: string }) {
  // Browsers do not fire `click` after a completed drag — but a drag that is
  // cancelled mid-flight (Esc, or a drop on a forbidden target) can, and a
  // second symbol arriving in the middle of the sheet reads as a bug.
  const dragging = useRef(false)
  const favourites = useFavouriteComponents()
  const fav = favourites.includes(componentKey(def.id, presetLetters))
  return (
    // The star is a SIBLING of the placing button, not a child of it. Nesting
    // one control inside another is invalid HTML, and it also folded the star's
    // glyph into the tile's accessible name — a screen reader read "FT ☆", and
    // every test matching a tile by its label stopped matching.
    <div className="palette-cell">
      <button
        type="button"
        className="palette-entry"
        // Never in the tab order: fifty tiles between the search box and the
        // canvas is not keyboard access, it is a keyboard trap with extra
        // steps. The search field is the single tab stop into the library, and
        // ↓ from there walks the tiles — see onGridKey.
        tabIndex={-1}
        draggable
        title={`${title ?? label} — click to place, or drag onto the sheet`}
        onDragStart={(e) => {
          dragging.current = true
          const payload: DragPayload = { symbolId: def.id }
          if (presetLetters) payload.presetLetters = presetLetters
          paletteDrag.payload = payload
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onDragEnd={() => {
          paletteDrag.payload = null
          // after the event loop settles, so a stray click lands while it is set
          setTimeout(() => { dragging.current = false }, 0)
        }}
        onClick={() => {
          if (dragging.current) return
          placeAtCenter(def.id, presetLetters)
        }}
      >
        <Preview def={def} />
        <span className="palette-label">{label}</span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={fav ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
        aria-pressed={fav}
        title={fav ? 'Remove from favourites' : 'Add to favourites'}
        className={`palette-fav${fav ? ' on' : ''}`}
        onClick={() => toggleFavourite(def.id, presetLetters)}
      >
        <span aria-hidden="true">{fav ? '\u2605' : '\u2606'}</span>
      </button>
    </div>
  )
}

/** A compact row of stored symbols — favourites, or what was placed last. */
function QuickRow({ title, keys }: { title: string; keys: string[] }) {
  if (!keys.length) return null
  return (
    <section className="palette-quick">
      <div className="palette-subhead">{title}</div>
      <div className="palette-grid">
        {keys.map((key) => {
          const { symbolId, presetLetters } = splitKey(key)
          let def: SymbolDef
          try {
            def = getSymbol(symbolId)
          } catch {
            return null // a custom symbol removed since it was starred
          }
          return (
            <Entry
              key={key}
              def={def}
              label={presetLetters ?? def.name}
              title={presetLetters ? `${presetLetters} — ${def.name}` : def.name}
              presetLetters={presetLetters}
            />
          )
        })}
      </div>
    </section>
  )
}

export default function Palette({ onCollapse }: { onCollapse?: () => void }) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [importOpen, setImportOpen] = useState(false)
  const customSymbols = useStore((s) => s.doc.customSymbols)
  const groups = useMemo(() => byCategory(), [customSymbols])
  const results = useMemo(() => (query ? searchPalette(query) : null), [query, customSymbols])
  const asideRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const favourites = useFavouriteComponents()
  const recent = useRecentComponents()
  // A favourite is already at the top; showing it twice wastes the row.
  const recentOnly = useMemo(
    () => recent.filter((k) => !favourites.includes(k)),
    [recent, favourites],
  )

  /**
   * Roving focus across the tiles.
   *
   * Read out of the DOM rather than tracked in state: the visible tiles change
   * with the query, with every section a user collapses and with "Show all",
   * so an index held in React would have to be invalidated by all three. The
   * live list is the only thing that is always right, and this runs on a
   * keystroke, not on a frame.
   */
  const tiles = useCallback(
    () => [...(asideRef.current?.querySelectorAll<HTMLButtonElement>('.palette-entry') ?? [])],
    [],
  )
  const focusTile = useCallback((i: number) => {
    const items = tiles()
    if (!items.length) return
    items[Math.max(0, Math.min(items.length - 1, i))]!.focus()
  }, [tiles])

  // "Find a symbol" on the empty sheet puts the cursor in here, rather than
  // pointing at the panel and hoping. App re-fires this after un-collapsing
  // the palette, so it works from the collapsed strip too.
  useEffect(() => {
    const focus = () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('pid:focus-symbols', focus)
    return () => window.removeEventListener('pid:focus-symbols', focus)
  }, [])

  const onGridKey = (e: React.KeyboardEvent) => {
    const items = tiles()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    // The grid is three across; ↑/↓ step a row, ←/→ step a tile.
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }
    if (e.key in step) {
      e.preventDefault()
      focusTile(at + step[e.key]!)
      return
    }
    if (e.key === 'Home') { e.preventDefault(); focusTile(0); return }
    if (e.key === 'End') { e.preventDefault(); focusTile(items.length - 1); return }
    if (e.key === 'Escape') { e.preventDefault(); searchRef.current?.focus() }
  }

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
      {expanded.has(cat) ? '▴ Show less' : `▾ Show all (${hidden} more)`}
    </button>
  )

  return (
    <aside className="palette" ref={asideRef} onKeyDown={onGridKey}>
      <div className="panel-head">
        <h2>Symbols</h2>
        <span className="sp" />
        {onCollapse && (
          <button className="panel-collapse" title="Hide the symbol palette" onClick={onCollapse}>◂</button>
        )}
      </div>
      <div className="palette-head">
        <input
          ref={searchRef}
          className="palette-search"
          data-testid="palette-search"
          placeholder="Search symbols…  e.g. pump"
          aria-label="Search symbols"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results && results[0]) {
              placeAtCenter(results[0].symbolId, results[0].presetLetters)
              return
            }
            // ↓ walks out of the field and into the tiles; the field is the
            // one tab stop into a library of fifty-odd symbols.
            if (e.key === 'ArrowDown') { e.preventDefault(); focusTile(0); return }
            // Escape goes back to the drawing, which closes the loop:
            // canvas → Tab → search → Escape → canvas.
            if (e.key === 'Escape') { e.preventDefault(); focusCanvas() }
          }}
        />
      </div>
      {/* The library never said how to get a symbol onto the sheet, and the
          answer — either of two gestures — is one short line. It costs a row
          of the panel and closes the most common dead end in the app. */}
      <p className="palette-how">Click to place · drag to position</p>
      <button className="palette-import" onClick={() => setImportOpen(true)}>＋ Import symbol…</button>
      {importOpen && <SymbolImportDialog onClose={() => setImportOpen(false)} />}
      {/* Favourites and Recent, above the categories and only when they have
          anything in them. Two permanent empty headings on a first run would
          be furniture; a row of the four symbols you actually use is the
          fastest path in the panel. */}
      {!query && <QuickRow title="Favourites" keys={favourites} />}
      {!query && <QuickRow title="Recent" keys={recentOnly} />}
      {!query && (
        <section>
          <button className="palette-cat" onClick={() => toggle('typicals')}>
            {!collapsed.has('typicals') ? '▾' : '▸'} Typical Loops
          </button>
          {!collapsed.has('typicals') && (
            <div className="typical-list">
              {TYPICALS.map((t) => (
                <button
                  key={t.id}
                  className="typical-entry"
                  title={`Place a wired, tagged ${t.name.toLowerCase()}`}
                  onClick={() => placeTypicalAtCenter(t.id)}
                >
                  ⚡ {t.name}
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
              label={hit.label}
              title={hit.name}
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
            <Entry key={p.letters} def={bubble!} label={p.letters} title={p.name} presetLetters={p.letters} />
          )
          return (
            <section key={cat}>
              <button className="palette-cat" onClick={() => toggle(cat)}>
                {isOpen ? '▾' : '▸'} {title}
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
                          <div className="palette-subhead">{g}</div>
                          <div className="palette-grid">
                            {INSTRUMENT_PRESETS.filter((p) => p.group === g).map(preset)}
                          </div>
                        </div>
                      ))}
                      <div className="palette-grid">
                        {defs.map((def) => (
                          <Entry key={def.id} def={def} label={def.name} />
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
                      <Entry key={def.id} def={def} label={def.name} />
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
