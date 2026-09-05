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

/** Which face of the symbol a port sits on. */
export type PortSide = 'left' | 'right' | 'top' | 'bottom'

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
  dir?: PortSide
  /**
   * What this connection IS, in engineering language — "Suction",
   * "Discharge", "Inlet", "Signal".
   *
   * Present only where this definition establishes the meaning: the id says
   * it, or the drawing does. A port at the top of a vessel is NOT an inlet
   * because it is at the top, so `vessel.vertical` names none of its eleven
   * nozzles — the drawing's author decides what each one carries, and the
   * catalogue has no business guessing. Unnamed ports are described by where
   * they sit instead (see portLabels.ts), which is true of every symbol.
   *
   * Never persisted. Documents store the port ID and only the ID; renaming
   * here can never orphan a connection, and adding a name can never change
   * one. See `id`, which is the stable identifier and must not change.
   */
  name?: string
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
}
