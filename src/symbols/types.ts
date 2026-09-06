// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

export type SymbolCategory =
  | 'instruments'
  | 'valves'
  | 'control-valves'
  | 'safety'
  | 'flow-elements'
  | 'accessories'
  | 'rotating'
  | 'vessels'
  | 'heat'
  | 'inline'
  | 'control'
  | 'annotation'
  | 'custom'

export type PortKind = 'process' | 'signal' | 'both'

export interface PortDef {
  id: string
  x: number
  y: number
  kind: PortKind
  /** Click-halo radius override (default 8). Precision ports packed close
   *  together — like positioner bosses — use a smaller halo so they don't
   *  swallow clicks aimed at a neighboring port. */
  hit?: number
  /** Explicit link departure direction, for ports that sit too deep inside
   *  the frame for edge-distance detection (e.g. positioner bosses). */
  dir?: 'left' | 'right' | 'top' | 'bottom'
}

export interface SymbolDef {
  id: string
  name: string
  category: SymbolCategory
  /** Size in 8px grid units. */
  gridSize: { w: number; h: number }
  /** Inner SVG markup in local px space (gridSize * 8), stroke currentColor. */
  render: (cfg: Record<string, string>) => string
  ports: PortDef[]
  tagRule: 'isa-instrument' | 'valve' | 'equipment' | 'none'
  defaultConfig?: Record<string, string>
  /** Config keys -> allowed values, drives the property panel selects. */
  configOptions?: Record<string, string[]>
  keywords: string[]
  /** Registered for loading old documents, but never offered in the palette. */
  placeable?: boolean
}
