// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { ulid } from 'ulid'
import type { Fluid, ProjectDoc, Sheet, SheetSize } from './types'

export const SHEET_SIZES_MM: Record<SheetSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
  ANSI_B: { w: 431.8, h: 279.4 },
  ANSI_D: { w: 863.6, h: 558.8 },
}

const PX_PER_MM = 3.7795

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM
}

export function sheetPx(size: SheetSize): { w: number; h: number } {
  const { w, h } = SHEET_SIZES_MM[size]
  return { w: mmToPx(w), h: mmToPx(h) }
}

export function createSheet(number: number, sheetSize: SheetSize = 'A3'): Sheet {
  return {
    id: ulid(),
    name: `Sheet ${number}`,
    drawingNumber: '',
    revision: '0',
    revisions: [],
    sheetSize,
    nodes: [],
    edges: [],
  }
}

/**
 * Starter services; the user edits the list freely (Fluids dialog).
 *
 * ONLY WATER CARRIES PHYSICAL PROPERTIES, and that is the honest state of
 * affairs rather than an omission. Water at 20 °C and atmospheric pressure is a
 * definite substance with published values, and the simulation's own thermal
 * constant is already derived from them — `LIQUID_CP_KJ_PER_M3_K` in
 * `hmi/sim/units.ts` is exactly `densityKgM3 × heatCapacityKJkgK` below, so
 * there is one answer and not two.
 *
 * The other five have no properties because none can be stated. A density for
 * Steam, Air or Gas needs a pressure and a temperature this model does not
 * carry; Slurry and Fuel / Oil are whatever the project says they are. The
 * product reports their properties as unknown; it does not fill them in.
 */
export const DEFAULT_FLUIDS: Fluid[] = [
  {
    id: 'fl-water', name: 'Water', color: '#1976d2', displayToken: 'stream-a',
    densityKgM3: 1000, viscosityMPaS: 1.0, heatCapacityKJkgK: 4.186,
    referenceCondition: '20 °C, 1 atm',
  },
  { id: 'fl-steam', name: 'Steam', color: '#d32f2f', displayToken: 'stream-b' },
  { id: 'fl-air', name: 'Air', color: '#388e3c', displayToken: 'stream-c' },
  { id: 'fl-slurry', name: 'Slurry', color: '#795548', displayToken: 'stream-d' },
  { id: 'fl-oil', name: 'Fuel / Oil', color: '#f9a825', displayToken: 'stream-e' },
  { id: 'fl-gas', name: 'Gas', color: '#7b1fa2', displayToken: 'stream-f' },
]

export function createEmptyDoc(name = 'Untitled P&ID'): ProjectDoc {
  const now = new Date().toISOString()
  return {
    schemaVersion: 6,
    meta: { name, author: '', created: now, modified: now },
    settings: { gridPx: 8, tagSeparator: '-', numberStart: 100 },
    sheets: [createSheet(1)],
    hmiScreens: [],
    fluids: DEFAULT_FLUIDS,
  }
}

export function touch(doc: ProjectDoc): ProjectDoc {
  return { ...doc, meta: { ...doc.meta, modified: new Date().toISOString() } }
}
