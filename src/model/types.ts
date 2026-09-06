// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/** Core document types — the single source of truth for a P&ID drawing. */

import type { HmiScreen } from '../hmi/model'
import type { Registry } from './registry'

/** A finding the user has explicitly accepted, with the reason why. */
export interface IgnoredFinding {
  reason: string
  by?: string
  at: string
}

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'ANSI_B' | 'ANSI_D'

export type NodeKind = 'equipment' | 'instrument' | 'valve' | 'fitting' | 'annotation'

export type LineClass =
  | 'process.major'
  | 'process.minor'
  | 'process.impulse'
  | 'signal.electric'
  | 'signal.pneumatic'
  | 'signal.hydraulic'
  | 'signal.capillary'
  | 'signal.data'
  | 'signal.software'
  | 'signal.em'
  | 'link.internal'
  | 'pipe.jacketed'
  | 'pipe.traced'
  | 'pipe.existing'
  | 'pipe.underground'
  | 'pipe.battery-limit'

/** ISA tag: FT-101A -> { letters: 'FT', loop: '101', suffix: 'A' } */
export interface Tag {
  letters: string
  loop: string
  suffix?: string
}

export interface LineNumber {
  size: string
  spec: string
  service: string
  seq: string
}

export interface PlantNode {
  id: string
  symbolId: string
  kind: NodeKind
  x: number
  y: number
  rotation: 0 | 90 | 180 | 270
  /** Uniform display scale (1 = catalog size). Ports and glyph scale with it. */
  scale?: number
  /** Per-axis stretch factors (e.g. a longer horizontal vessel). When set,
   *  they override `scale` on their axis. */
  scaleX?: number
  scaleY?: number
  flipH?: boolean
  /** User-added connection pins, in the symbol's unscaled frame (like the
   *  catalog ports). Added when the built-in nozzles aren't enough. */
  extraPorts?: { id: string; x: number; y: number; kind: 'process' | 'signal' | 'both' }[]
  config?: Record<string, string>
  tag?: Tag
  label?: string
  /** Where the label text sits: under the symbol (default) or centered inside it. */
  labelPos?: 'below' | 'center'
  /** User-dragged offsets (element-frame px) for the tag pair and the label. */
  tagOffset?: { x: number; y: number }
  labelOffset?: { x: number; y: number }
  /** Off-page connector pairing to a connector on another sheet. */
  link?: { sheetId: string; nodeId: string }
  /** ISA-20-style datasheet values, keyed by datasheet field key.
   *  @deprecated since schemaVersion 5 — engineering data lives in
   *  `ProjectDoc.registry`, keyed by tag so it survives a redraw. Still READ as
   *  a fallback for one release so older documents lose nothing. */
  datasheet?: Record<string, string>
  /** Exact per-instance price (beats project overrides and table defaults). */
  cost?: number
}

export type EdgeEnd =
  | { nodeId: string; portId: string }
  | { x: number; y: number; pendingTag?: string; junctionId?: string }

export function isPortEnd(end: EdgeEnd): end is { nodeId: string; portId: string } {
  return 'nodeId' in end
}

export function isJunctionEnd(
  end: EdgeEnd,
): end is { x: number; y: number; junctionId: string; pendingTag?: string } {
  return !isPortEnd(end) && typeof end.junctionId === 'string'
}

export interface PlantEdge {
  id: string
  /** Stable identity for this persisted line section. */
  lineGroupId?: string
  lineClass: LineClass
  source: EdgeEnd
  target: EdgeEnd
  vertices?: { x: number; y: number }[]
  /** Vertices already form a complete orthogonal route (for example, from
   * auto layout) and must not be re-routed through Manhattan a second time. */
  routing?: 'fixed'
  lineNumber?: LineNumber
  arrow?: 'none' | 'flow'
  /** Service/medium carried (doc.fluids id); colors the drawn line. */
  fluidId?: string
}

/** A process service/medium the user defines once and assigns to lines —
 *  water blue, steam red, slurry brown. Assignment auto-spreads along the
 *  connected run (see src/model/fluidFlow.ts). */
export interface Fluid {
  id: string
  name: string
  /** CSS color for the line stroke. */
  color: string
}

export interface ProjectMeta {
  name: string
  author: string
  created: string
  modified: string
}

export interface Sheet {
  id: string
  name: string
  drawingNumber: string
  revision: string
  sheetSize: SheetSize
  nodes: PlantNode[]
  edges: PlantEdge[]
  /** Locked background trace-over underlay imported from DXF. */
  underlay?: { name: string; polylines: { x: number; y: number }[][] }
}

/** The node/edge slice reconcilers and exports operate on. */
export interface SheetContent {
  nodes: PlantNode[]
  edges: PlantEdge[]
}

export interface CustomSymbolDef {
  id: string
  name: string
  /** Sanitized inner SVG markup (see src/import/svgSymbol.ts). */
  svg: string
  gridSize: { w: number; h: number }
  ports: { id: string; x: number; y: number; kind: 'process' | 'signal' | 'both' }[]
  tagRule: 'isa-instrument' | 'valve' | 'equipment' | 'none'
  keywords: string[]
}

export interface ProjectDoc {
  schemaVersion: 5
  meta: ProjectMeta
  settings: {
    gridPx: number
    tagSeparator: '-' | ''
    /** Auto-numbering base per component type: 100 (default) or 1 (shown 001). */
    numberStart?: 100 | 1
  }
  sheets: Sheet[]
  /** HMI operator screens (HMI Studio workspace). */
  hmiScreens: HmiScreen[]
  customSymbols?: CustomSymbolDef[]
  /** User-defined process services (line coloring). Optional: docs saved
   *  before v0.9.13 load without it and fall back to defaults on demand. */
  fluids?: Fluid[]
  /** Project budget & pricing (v0.10.0+, optional). */
  budget?: BudgetSettings
  /** Engineering records keyed by tag / line number (v0.15.0+, schemaVersion 5).
   *  See model/registry.ts for why the key is the tag and not the node id. */
  registry?: Registry
  /** QA state. `ignored` is keyed by RuleFinding.key — rule + engineering key,
   *  never a node id — so an accepted finding stays accepted across a redraw. */
  qa?: { ignored: Record<string, IgnoredFinding> }
}

/** Budget settings: display currency, optional target, Lang-style installed
 *  cost factor, and per-price-bucket unit price overrides. */
export interface BudgetSettings {
  currency: string
  total?: number
  /** 1 = hardware only, ~3 typical installed, ~5 Lang full plant. */
  installFactor?: number
  overrides?: Record<string, number>
}

