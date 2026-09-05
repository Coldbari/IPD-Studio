// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import { findTag } from '../search/findTag'
import { useStore } from '../store/store'
import { locateCell } from '../canvas/locate'
import { navigateWorkspace } from '../routes'
import { placeAtCenter } from '../canvas/dropHandling'
import { getSymbol } from '../symbols/registry'
import { display, matches } from '../shortcuts/registry'
import { commandsFor, contextNow, type AppCommand } from '../commands/registry'
import { searchPalette, type PaletteHit } from './instrumentPresets'
import { splitKey, useFavouriteComponents, useRecentComponents } from './componentPrefs'

/** Re-exported for the specs that assert what the palette can do. */
export type { AppCommand }

type Item =
  | { kind: 'tag'; key: string; label: string; sub: string; run(): void }
  | { kind: 'command'; key: string; label: string; sub: string; run(): void }
  | { kind: 'symbol'; key: string; label: string; sub: string; symbolId: string; run(): void }

const SECTION: Record<Item['kind'], string> = {
  tag: 'On the drawing',
  command: 'Commands',
  symbol: 'Place a symbol',
}

/** How many of each kind, so no one section can push the others off screen. */
const CAP = { tag: 5, command: 7, symbol: 8 }

/**
 * One way in, for an app that has more screens than a toolbar can hold.
 *
 * It was nine fixed commands — four workspace jumps, add a sheet, fit, two CSV
 * exports and save — none of which touched the drawing. It could not rotate,
 * delete, duplicate, align, or add a symbol, which is most of what anyone
 * actually does here.
 *
 * Three kinds of answer now, in the order they are usually wanted:
 *
 *   a tag      — find PV-101 and go to it. The years-old muscle memory, and
 *                the reason Ctrl+F opens this at all.
 *   a command  — what can be done to what is selected RIGHT NOW. Commands
 *                that cannot run are absent, not greyed: offering "Rotate"
 *                with nothing selected is a menu item that does nothing.
 *   a symbol   — 194 symbols and 60 instrument presets, placed through the
 *                same `placeAtCenter` the palette click uses.
 *
 * Every command delegates to the one implementation that already exists —
 * see commands/registry.ts. This file decides what to OFFER; it never decides
 * what anything means.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  // Subscribed only while OPEN. This component is mounted for the life of the
  // session, so reading the whole document unconditionally re-rendered it —
  // and rebuilt its entire item list — on every edit, including the writes a
  // docking drag makes mid-gesture.
  const doc = useStore((s) => (open ? s.doc : null))
  const selection = useStore((s) => (open ? s.selection : null))
  const recent = useRecentComponents()
  const favourites = useFavouriteComponents()
  const inputRef = useRef<HTMLInputElement>(null)
  /** Whatever had the keyboard when this opened, to give it back on Escape. */
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, 'app.palette')) return
      e.preventDefault()
      opener.current = document.activeElement as HTMLElement | null
      setOpen(true)
      setQuery('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = useMemo<Item[]>(() => {
    if (!doc) return []
    const raw = query.trim()
    const commandsOnly = raw.startsWith('>')
    const needle = (commandsOnly ? raw.slice(1) : raw).trim()
    const lower = needle.toLowerCase()

    // ── commands ─────────────────────────────────────────────────────────
    // Built from the live selection, so the list answers "what can I do to
    // this?" rather than "what does the app have?".
    const ctx = contextNow()
    const scored: { rank: number; cmd: AppCommand }[] = []
    for (const c of commandsFor(ctx)) {
      if (!lower) { scored.push({ rank: 0, cmd: c }); continue }
      const label = c.label.toLowerCase()
      // Shortcut text is searchable too, so someone who half-remembers ⌘D can
      // type it and be reminded what it does (§17).
      const keys = c.shortcut ? display(c.shortcut).toLowerCase() : ''
      const rank =
        label.startsWith(lower) ? 0
        : label.includes(lower) ? 1
        : c.keywords?.some((k) => k.startsWith(lower)) ? 2
        : keys && keys.replace(/\s/g, '').includes(lower.replace(/\s/g, '')) ? 3
        : -1
      if (rank >= 0) scored.push({ rank, cmd: c })
    }
    // A stable sort keeps the contextual order within a rank — so with a pump
    // selected and no query, Properties and Rotate stay at the top.
    const commands: Item[] = scored
      .sort((a, b) => a.rank - b.rank)
      .slice(0, commandsOnly ? 20 : CAP.command)
      .map(({ cmd }) => ({
        kind: 'command' as const,
        key: cmd.id,
        label: cmd.label,
        sub: cmd.shortcut ? display(cmd.shortcut) : cmd.group,
        run: cmd.run,
      }))

    if (commandsOnly) return commands

    // ── symbols ──────────────────────────────────────────────────────────
    const asSymbol = (hit: PaletteHit): Item | null => {
      let category: string
      try {
        category = getSymbol(hit.symbolId).category.replace(/-/g, ' ')
      } catch {
        return null // a custom symbol that has since been removed
      }
      return {
        kind: 'symbol',
        key: `sym:${hit.symbolId}:${hit.presetLetters ?? ''}`,
        label: hit.name,
        sub: hit.presetLetters ? `${hit.presetLetters} · instrument` : category,
        symbolId: hit.symbolId,
        run: () => placeAtCenter(hit.symbolId, hit.presetLetters),
      }
    }

    // With no query, offer what this person actually uses rather than the top
    // of an alphabetical list: favourites first, then what they last placed.
    const shortcuts: Item[] = !needle
      ? [...favourites, ...recent.filter((k) => !favourites.includes(k))]
          .map((key) => {
            const { symbolId, presetLetters } = splitKey(key)
            try {
              const def = getSymbol(symbolId)
              return asSymbol({
                symbolId, presetLetters,
                label: presetLetters ?? def.name,
                name: presetLetters ? `${presetLetters} — ${def.name}` : def.name,
              })
            } catch {
              return null
            }
          })
          .filter((i): i is Item => i !== null)
          .slice(0, CAP.symbol)
      : []

    const symbols: Item[] = needle
      ? searchPalette(needle).slice(0, CAP.symbol).map(asSymbol).filter((i): i is Item => i !== null)
      : shortcuts

    // ── tags ─────────────────────────────────────────────────────────────
    const tags: Item[] = needle
      ? findTag(doc, needle).slice(0, CAP.tag).map((h) => ({
          kind: 'tag' as const,
          key: h.nodeId,
          label: h.display,
          sub: h.sheetName,
          run: () => {
            navigateWorkspace('draw')
            locateCell(h.nodeId, h.sheetId)
          },
        }))
      : []

    return [...tags, ...commands, ...symbols]
    // `selection` is in the deps because commandsFor reads it — without it the
    // list would go stale the moment the user selected something else.
  }, [query, doc, selection, recent, favourites])

  if (!open) return null

  const close = () => {
    setOpen(false)
    // Back where it came from. A command that moves focus itself — placing a
    // symbol puts it on the drawing — wins, because it runs after this.
    opener.current?.focus?.()
  }

  const pick = (i: number) => {
    const item = items[i]
    if (!item) return
    setOpen(false)
    opener.current?.focus?.()
    item.run()
  }

  // Section headings are emitted as the kind changes, so the reader always
  // knows whether Enter will jump, act, or draw.
  let lastKind: Item['kind'] | null = null

  return (
    <div className="search-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="search-box" data-testid="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          data-testid="command-input"
          placeholder="Find a tag, run a command, or add a symbol…"
          aria-label="Find a tag, run a command, or add a symbol"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close() }
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
            if (e.key === 'Enter') { e.preventDefault(); pick(cursor) }
          }}
        />
        {items.length > 0 && (
          <ul data-testid="command-results">
            {items.map((item, i) => {
              const heading = item.kind !== lastKind ? SECTION[item.kind] : null
              lastKind = item.kind
              return (
                <li key={`${item.kind}:${item.key}`} className="cp-row">
                  {heading && <div className="cp-section">{heading}</div>}
                  <button
                    type="button"
                    className={`cp-item${i === cursor ? ' active' : ''}`}
                    data-kind={item.kind}
                    tabIndex={-1}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(i)}
                  >
                    {item.kind === 'symbol' && <SymbolMark symbolId={item.symbolId} />}
                    <b>{item.kind === 'command' ? `▸ ${item.label}` : item.label}</b>
                    <span className="search-sheet">{item.sub}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {query.trim() && items.length === 0 && (
          <div className="search-empty">
            No command or symbol matches “{query.trim()}”.
            <span> Try a shorter word — “valve”, “pump”, “transmitter” — or a tag like PV-101.</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** The symbol's own drawing, at result size. Drawn from the authoritative
 *  definition — never a second, tidier version of an engineering symbol. */
function SymbolMark({ symbolId }: { symbolId: string }) {
  const def = useMemo(() => {
    try {
      return getSymbol(symbolId)
    } catch {
      return null
    }
  }, [symbolId])
  if (!def) return null
  const w = def.gridSize.w * 8
  const h = def.gridSize.h * 8
  return (
    <svg
      className="cp-mark"
      aria-hidden="true"
      viewBox={`-2 -2 ${w + 4} ${h + 4}`}
      dangerouslySetInnerHTML={{ __html: def.render(def.defaultConfig ?? {}) }}
    />
  )
}
