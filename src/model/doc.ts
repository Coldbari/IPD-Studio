// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { ulid } from 'ulid'
import type { ProjectDoc, Sheet, SheetSize } from './types'

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

/** Starter services; the user edits the list freely (Fluids dialog). */
export const DEFAULT_FLUIDS = [
  { id: 'fl-water', name: 'Water', color: '#1976d2' },
  { id: 'fl-steam', name: 'Steam', color: '#d32f2f' },
  { id: 'fl-air', name: 'Air', color: '#388e3c' },
  { id: 'fl-slurry', name: 'Slurry', color: '#795548' },
  { id: 'fl-oil', name: 'Fuel / Oil', color: '#f9a825' },
  { id: 'fl-gas', name: 'Gas', color: '#7b1fa2' },
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
