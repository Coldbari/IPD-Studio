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
    if (def.placeable === false) continue
    const list = out.get(def.category) ?? []
    list.push(def)
    out.set(def.category, list)
  }
  return out
}

export function searchSymbols(query: string): SymbolDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SYMBOLS.values()].filter((d) => d.placeable !== false)
  return [...SYMBOLS.values()].filter(
    (d) => d.placeable !== false &&
      (d.name.toLowerCase().includes(q) || d.keywords.some((k) => k.includes(q))),
  )
}
