// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolCategory, SymbolDef } from './types'

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

export function searchSymbols(query: string): SymbolDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SYMBOLS.values()]
  // EVERY word has to land somewhere, rather than the whole phrase having to
  // be one substring. "heat exchanger" used to find nothing at all: no symbol
  // is named that and no keyword contains the space, even though "heat" and
  // "exchanger" are both right there in the metadata. Matching per word reads
  // the catalogue that already exists instead of inventing synonyms for it.
  const words = q.split(/\s+/).filter(Boolean)
  return [...SYMBOLS.values()].filter((d) => {
    const hay = `${d.name.toLowerCase()} ${d.keywords.join(' ')}`
    return words.every((w) => hay.includes(w))
  })
}
