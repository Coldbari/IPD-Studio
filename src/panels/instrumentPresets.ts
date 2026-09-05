// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { rankSymbols } from '../symbols/registry'
import { indexRecord, NO_MATCH, prepareQuery, scoreIndexed } from '../symbols/search'

/** A ready-to-place ISA instrument: the bubble pre-tagged with these letters
 *  (loop number auto-assigned per TYPE on placement). `name` is the full
 *  spoken name, searchable alongside the shortcut. */
export interface InstrumentPreset {
  letters: string
  name: string
  group: 'Flow' | 'Pressure' | 'Level' | 'Temperature' | 'Analysis' | 'Other'
}

const F = 'Flow' as const, P = 'Pressure' as const, L = 'Level' as const
const T = 'Temperature' as const, A = 'Analysis' as const, O = 'Other' as const

/** ISA-5.1 identification: first letter = measured variable, succeeding
 *  letters = function (E element, T transmit, I indicate, C control,
 *  R record, S switch + H/L, Y compute/convert, Q totalize). */
export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  // Flow
  { letters: 'FE', name: 'Flow Element (primary element)', group: F },
  { letters: 'FT', name: 'Flow Transmitter', group: F },
  { letters: 'FIT', name: 'Flow Indicating Transmitter', group: F },
  { letters: 'FI', name: 'Flow Indicator', group: F },
  { letters: 'FIC', name: 'Flow Indicating Controller', group: F },
  { letters: 'FC', name: 'Flow Controller', group: F },
  { letters: 'FFIC', name: 'Flow Ratio Indicating Controller', group: F },
  { letters: 'FY', name: 'Flow Converter / Computing Relay', group: F },
  { letters: 'FQI', name: 'Flow Totalizer (Quantity Indicator)', group: F },
  { letters: 'FR', name: 'Flow Recorder', group: F },
  { letters: 'FSH', name: 'Flow Switch High', group: F },
  { letters: 'FSL', name: 'Flow Switch Low', group: F },
  // Pressure
  { letters: 'PT', name: 'Pressure Transmitter', group: P },
  { letters: 'PIT', name: 'Pressure Indicating Transmitter', group: P },
  { letters: 'PI', name: 'Pressure Indicator', group: P },
  { letters: 'PIC', name: 'Pressure Indicating Controller', group: P },
  { letters: 'PC', name: 'Pressure Controller', group: P },
  { letters: 'PY', name: 'Pressure Converter / Computing Relay', group: P },
  { letters: 'PR', name: 'Pressure Recorder', group: P },
  { letters: 'PSH', name: 'Pressure Switch High', group: P },
  { letters: 'PSL', name: 'Pressure Switch Low', group: P },
  { letters: 'PDT', name: 'Differential Pressure Transmitter', group: P },
  { letters: 'PDI', name: 'Differential Pressure Indicator', group: P },
  { letters: 'PDIC', name: 'Differential Pressure Indicating Controller', group: P },
  // Level
  { letters: 'LE', name: 'Level Element', group: L },
  { letters: 'LT', name: 'Level Transmitter', group: L },
  { letters: 'LIT', name: 'Level Indicating Transmitter', group: L },
  { letters: 'LI', name: 'Level Indicator', group: L },
  { letters: 'LIC', name: 'Level Indicating Controller', group: L },
  { letters: 'LC', name: 'Level Controller', group: L },
  { letters: 'LY', name: 'Level Converter / Computing Relay', group: L },
  { letters: 'LR', name: 'Level Recorder', group: L },
  { letters: 'LSH', name: 'Level Switch High', group: L },
  { letters: 'LSL', name: 'Level Switch Low', group: L },
  { letters: 'LSHH', name: 'Level Switch High-High', group: L },
  { letters: 'LSLL', name: 'Level Switch Low-Low', group: L },
  // Temperature
  { letters: 'TE', name: 'Temperature Element (thermocouple / RTD)', group: T },
  { letters: 'TT', name: 'Temperature Transmitter', group: T },
  { letters: 'TIT', name: 'Temperature Indicating Transmitter', group: T },
  { letters: 'TI', name: 'Temperature Indicator', group: T },
  { letters: 'TIC', name: 'Temperature Indicating Controller', group: T },
  { letters: 'TC', name: 'Temperature Controller', group: T },
  { letters: 'TY', name: 'Temperature Converter / Computing Relay', group: T },
  { letters: 'TR', name: 'Temperature Recorder', group: T },
  { letters: 'TSH', name: 'Temperature Switch High', group: T },
  { letters: 'TSL', name: 'Temperature Switch Low', group: T },
  // Analysis
  { letters: 'AE', name: 'Analyzer Element', group: A },
  { letters: 'AT', name: 'Analyzer Transmitter', group: A },
  { letters: 'AIT', name: 'Analyzer Indicating Transmitter', group: A },
  { letters: 'AIC', name: 'Analyzer Indicating Controller', group: A },
  // Other variables
  { letters: 'ST', name: 'Speed Transmitter', group: O },
  { letters: 'SI', name: 'Speed Indicator', group: O },
  { letters: 'SC', name: 'Speed Controller', group: O },
  { letters: 'HS', name: 'Hand Switch', group: O },
  { letters: 'HIC', name: 'Hand Indicating Controller (manual loader)', group: O },
  { letters: 'ZT', name: 'Position Transmitter', group: O },
  { letters: 'ZSC', name: 'Position Switch Closed', group: O },
  { letters: 'ZSO', name: 'Position Switch Open', group: O },
  { letters: 'VT', name: 'Vibration Transmitter', group: O },
  { letters: 'WT', name: 'Weight Transmitter', group: O },
]

/** The always-visible quick row: the workhorse loop instruments, one
 *  transmitter + controller pair per main variable. */
export const TOP_PRESET_LETTERS = ['FT', 'FIC', 'PT', 'PIC', 'LT', 'LIC', 'TT', 'TIC']

/** One palette search hit: a plain symbol, or the bubble with preset letters. */
export interface PaletteHit {
  symbolId: string
  label: string
  name: string
  presetLetters?: string
}

/** The presets with their words split, built once — the list is static. */
const PRESET_INDEX = INSTRUMENT_PRESETS.map((p) => ({
  ix: indexRecord({ name: p.name, letters: p.letters }),
  item: p,
}))

/**
 * Everything the palette can offer for a query, best first.
 *
 * Presets and symbols are scored by the SAME function and merged on one
 * scale, rather than the old arrangement where every preset outranked every
 * symbol and every symbol arrived alphabetically. That is what lets "cv"
 * return the three control valves — no preset matches it at all — while "ft"
 * still leads with the ISA shortcut, and it is why a symbol whose id is
 * exactly what you typed ("psv") comes before one that merely contains it.
 */
export function searchPalette(query: string): PaletteHit[] {
  const q = prepareQuery(query)
  if (!q) return []
  const hits: { score: number; label: string; hit: PaletteHit }[] = []
  for (const { ix, item } of PRESET_INDEX) {
    const score = scoreIndexed(ix, q)
    if (score === NO_MATCH) continue
    hits.push({
      score,
      label: item.name,
      hit: { symbolId: 'instr.bubble', label: item.letters, name: item.name, presetLetters: item.letters },
    })
  }
  for (const { def, score } of rankSymbols(query)) {
    hits.push({ score, label: def.name, hit: { symbolId: def.id, label: def.name, name: def.name } })
  }
  return hits
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
    .map((h) => h.hit)
}
