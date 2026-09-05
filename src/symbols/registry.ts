// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolCategory, SymbolDef } from './types'
import { indexRecord, prepareQuery, rankIndexed, type Indexed } from './search'

export const SYMBOLS = new Map<string, SymbolDef>()

export function registerSymbols(defs: SymbolDef[]): void {
  for (const def of defs) {
    if (SYMBOLS.has(def.id)) throw new Error(`Duplicate symbol id: ${def.id}`)
    SYMBOLS.set(def.id, def)
  }
}

export function getSymbol(id: string): SymbolDef {
  const def = SYMBOLS.get(id)
  if (!def) throw new Error(`Unknown symbol: ${id}`)
  return def
}

export function byCategory(): Map<SymbolCategory, SymbolDef[]> {
  const out = new Map<SymbolCategory, SymbolDef[]>()
  for (const def of SYMBOLS.values()) {
    const list = out.get(def.category) ?? []
    list.push(def)
    out.set(def.category, list)
  }
  return out
}

/**
 * The catalogue with its words split, built once and held.
 *
 * Rebuilt only when the catalogue itself changes: `registerSymbols` throws on
 * a duplicate so the built-ins never move, and the document's custom symbols
 * come and go through `registerCustomSymbols`, which clears this.
 */
let index: { ix: Indexed; item: SymbolDef }[] | null = null

/** The catalogue changed under the search index — see symbols/custom.ts. */
export function resetSymbolIndex(): void {
  index = null
}

function indexed(): { ix: Indexed; item: SymbolDef }[] {
  if (!index || index.length !== SYMBOLS.size) {
    index = [...SYMBOLS.values()].map((d) => ({
      ix: indexRecord({ id: d.id, name: d.name, keywords: d.keywords }),
      item: d,
    }))
  }
  return index
}

/** Symbols that answer this query, best first. Empty query: the whole
 *  catalogue, in catalogue order, which is what the palette's category
 *  listing wants. */
export function searchSymbols(query: string): SymbolDef[] {
  return rankSymbols(query).map((m) => m.def)
}

/** The same, carrying how well each one matched — so a caller merging symbols
 *  with something else (the palette merges them with ISA presets) can put both
 *  on one scale instead of always ranking one kind above the other. */
export function rankSymbols(query: string): { def: SymbolDef; score: number }[] {
  const q = prepareQuery(query)
  if (!q) return [...SYMBOLS.values()].map((def) => ({ def, score: 0 }))
  return rankIndexed(indexed(), q).map(({ item, score }) => ({ def: item, score }))
}
