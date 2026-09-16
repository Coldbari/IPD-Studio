// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/** Core document types — the single source of truth for a P&ID drawing. */

import type { HmiScreen } from '../hmi/model'
import type { QaEvidence, StandardProvenance } from './provenance'
import type { ConformanceRecord } from './conformance'
import type { Area, Unit } from './hierarchy'
import type { Loop } from './loop'
import type { Registry } from './registry'
import type { StandardProfile } from './standard'

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

export type EdgeEnd = { nodeId: string; portId: string } | { x: number; y: number }

export function isPortEnd(end: EdgeEnd): end is { nodeId: string; portId: string } {
  return 'nodeId' in end
}

export interface PlantEdge {
  id: string
  lineClass: LineClass
  source: EdgeEnd
  target: EdgeEnd
  vertices?: { x: number; y: number }[]
  lineNumber?: LineNumber
  arrow?: 'none' | 'flow'
  /** Service/medium carried (doc.fluids id); colors the drawn line. */
  fluidId?: string
}

/**
 * A process service/medium the user defines once and assigns to lines.
 * Assignment auto-spreads along the connected run (see `model/fluidFlow.ts`).
 *
 * The IDENTITY is `id`. Everything else describes it. `color` draws the line on
 * the P&ID, which is a drafting convention and NOT the identity — the operator
 * layer reads `displayToken` instead, so that a fluid can be recognised on a
 * screen without the HMI inheriting a palette chosen for paper.
 *
 * The physical properties are OPTIONAL and usually absent, deliberately. A
 * density for "Steam" or "Gas" is meaningless without a pressure and a
 * temperature this model does not carry, and one for "Slurry" or "Fuel / Oil"
 * depends entirely on a composition nobody has stated. Writing a plausible
 * number into those fields would be inventing engineering data. Where the
 * properties are absent the product says the fluid's properties are unknown;
 * see `hmi/sim/fluids.ts`.
 */
export interface Fluid {
  id: string
  name: string
  /** CSS color for the line stroke ON THE P&ID. A drafting convention. */
  color: string
  /**
   * Which slot of the operator layer's CONTROLLED categorical palette this
   * service takes. Not a colour: a token the HMI resolves for itself, so fluid
   * presentation can never collide with the alarm or quality palettes.
   *
   * Absent means the project has not said how to show this service, and the
   * stream is drawn neutrally rather than being given a colour at random.
   */
  displayToken?: StreamToken
  /** Density at the stated reference condition, kg/m³. */
  densityKgM3?: number
  /** Dynamic viscosity at the stated reference condition, mPa·s (= cP). */
  viscosityMPaS?: number
  /** Specific heat capacity, kJ/(kg·K). */
  heatCapacityKJkgK?: number
  /** The condition the three properties above are quoted at. Required
   *  whenever any of them is present — a property with no basis is not data. */
  referenceCondition?: string
}

/**
 * The operator layer's controlled categorical palette for process streams.
 *
 * SIX SLOTS AND NO MORE, because a screen that distinguishes twelve services by
 * hue distinguishes none of them. Deliberately a closed set of tokens rather
 * than free colour: the renderer resolves them to muted tones that cannot be
 * confused with the alarm palette, and a project cannot introduce a red stream
 * that reads as a trip.
 */
export type StreamToken = 'stream-a' | 'stream-b' | 'stream-c' | 'stream-d' | 'stream-e' | 'stream-f'

export const STREAM_TOKENS: readonly StreamToken[] =
  ['stream-a', 'stream-b', 'stream-c', 'stream-d', 'stream-e', 'stream-f']

/**
 * What the document IS, as a controlled deliverable.
 *
 * `name`, `author`, `created` and `modified` are the original four. The rest
 * arrived with P2-A because a title block has to print them, and every one is
 * optional: a project that never fills them in prints blanks rather than
 * invented values, and a document written before they existed loads unchanged.
 *
 * These are PROJECT-level. They are deliberately not copied onto Sheet — the
 * client does not change between sheet 2 and sheet 3, and two copies of one
 * fact is how a title block starts contradicting itself. Sheet keeps what is
 * genuinely per-sheet: its name, its drawing number and its revision table.
 */
export interface ProjectMeta {
  name: string
  author: string
  created: string
  modified: string
  /** Who the drawing is for. */
  client?: string
  /** The house's project/job number. */
  projectNumber?: string
  /** Plant, site or facility. */
  plant?: string
  /** Discipline — "Process", "Instrumentation", "Piping". */
  discipline?: string
  /** Document number for the SET, where a house numbers the set as well as
   *  each sheet. Sheet.drawingNumber remains the per-sheet number. */
  documentNumber?: string
}

/**
 * One row of a drawing's revision table.
 *
 * A revision exists as soon as it is created (a WIP row an engineer is working
 * towards) and becomes ISSUED when `issuedAt` is stamped. Only an issued
 * revision carries a snapshot and a QA record, because only an issue is a
 * moment worth being able to return to.
 *
 * `status` is a free string checked against `StandardProfile.issueStatuses`,
 * not an enum: houses differ on whether AFC means Approved or As-Built, and
 * hard-coding one reading would be wrong for half the market.
 */
export interface Revision {
  id: string
  /** As printed in the revision table: '0', 'A', '1'. Houses differ. */
  code: string
  /** ISO date the revision is dated. Empty when never stated. */
  date: string
  /** Reason for revision. */
  description: string
  preparedBy: string
  checkedBy?: string
  approvedBy?: string
  status: string
  /** ISO timestamp. Absent means drafted but not issued. */
  issuedAt?: string
  /** Key into the revision snapshot store. Absent = no snapshot kept. */
  snapshotId?: string
  /** The QA report AS IT STOOD at issue. A copy, never a live pointer.
   *  Counts only; `qaEvidence` carries what they were counts OF. */
  qaAtIssue?: { critical: number; warning: number; info: number; total: number }
  /**
   * The standard this revision was checked against, frozen at issue.
   *
   * Absent on every revision issued before P2-A, and on migrated legacy rows.
   * Absent means NOT RECORDED — never "the current standard". Reconstructing
   * it from today's `doc.standard` would be inventing provenance, which is
   * worse than admitting there is none.
   */
  standard?: StandardProvenance
  /**
   * The findings as they stood at issue, with their accepted reasons.
   *
   * Lives on the revision row and therefore inside `ProjectDoc`, so it travels
   * in the `.pnid` — unlike the full snapshot, which stays on the machine that
   * issued it. This is the portable half of the provenance.
   */
  qaEvidence?: QaEvidence
  /**
   * The conformance verdict, frozen at issue.
   *
   * The VERDICT and what it was computed from — never the findings, which stay
   * in `qaEvidence` so there is one list and it cannot disagree with itself.
   *
   * Absent on everything issued before P2-B. Absent means NOT RECORDED, and is
   * displayed as such: recomputing it from today's standard would describe
   * this afternoon's rules rather than the ones the drawing was issued under.
   */
  conformance?: ConformanceRecord
}

export interface Sheet {
  id: string
  name: string
  drawingNumber: string
  /** The CURRENT revision code, as printed in the title block. Kept as a
   *  plain string so every existing consumer — the title block, DXF, print —
   *  is untouched; `revisions` is the record behind it and issuing updates
   *  this to match. */
  revision: string
  /** The revision table. Absent on documents written before schema 6. */
  revisions?: Revision[]
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
  schemaVersion: 6
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
  /** The company standard this project is checked against (v0.19.0+).
   *  Absent means the built-in default, which is exactly what the engine
   *  checked against before standards existed — so an old document's QA report
   *  does not change when it is opened by a build that has this feature. */
  standard?: StandardProfile
  /** The plant hierarchy: Areas, and the Units inside them (v0.21.0+).
   *
   *  Both optional and both ADDITIVE — a document that never declared a
   *  hierarchy has neither, which is every document written before this
   *  existed. That is also why the schema version did not move: nothing is
   *  rewritten on load, so a file saved by this build still opens in the one
   *  before it, which simply ignores two fields it does not know.
   *
   *  Ordering carries no meaning. Identity is `id`; the arrays are a place to
   *  keep them, and reordering one is not an engineering change. */
  areas?: Area[]
  units?: Unit[]
  /** Persistent control loops (v0.21.0+).
   *
   *  Optional and ADDITIVE, exactly as `areas`/`units` are, and for the same
   *  reason: a document that never declared loops has none, which is every
   *  document written before this existed. Nothing is rewritten on load, so a
   *  file saved by this build still opens in the one before it, which simply
   *  ignores a field it does not know.
   *
   *  MEMBERSHIP IS NOT HERE. A Loop does not list its members; each
   *  `EngineeringRecord` names its loop by id (see model/loop.ts for why that
   *  direction, and what it saves the rename machinery).
   *
   *  Ordering carries no meaning. Identity is `id`; the array is a place to
   *  keep them, and reordering one is not an engineering change. */
  loops?: Loop[]
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

