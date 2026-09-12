// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'
import { temporal } from 'zundo'
import { ulid } from 'ulid'
import type { BudgetSettings, CustomSymbolDef, Fluid, PlantEdge, PlantNode, ProjectDoc, Revision, Sheet, Tag } from '../model/types'
import { newRevision } from '../model/revision'

/**
 * Revision control is not engineering state.
 *
 * An issue is a record of something that happened. Ctrl+Z is for the drawing —
 * for the valve you just moved and the tag you just mistyped — and reaching
 * back through it to un-issue a controlled document is not an undo, it is a
 * falsification. So the revision table sits OUTSIDE ordinary undo in both
 * directions: revision mutations record no step, and an undo of some later
 * engineering edit carries the table across unchanged.
 *
 * The table is still edited, just through the revision UI that owns it —
 * Discard removes a work-in-progress row, and an issued row is immutable by
 * `updateRevision`/`deleteRevision`.
 */
function carryRevisions(from: ProjectDoc, onto: ProjectDoc): ProjectDoc {
  const keep = new Map(from.sheets.map((sh) => [sh.id, { revisions: sh.revisions, revision: sh.revision }]))
  let changed = false
  const sheets = onto.sheets.map((sh) => {
    const k = keep.get(sh.id)
    // A sheet the undo removed takes its table with it; a sheet the undo
    // restored keeps whatever that past state held.
    if (!k || (k.revisions === sh.revisions && k.revision === sh.revision)) return sh
    changed = true
    return { ...sh, revisions: k.revisions, revision: k.revision }
  })
  return changed ? { ...onto, sheets } : onto
}

/** Re-apply the live revision tables after the temporal store has restored a
 *  past document, without recording that graft as a step of its own. */
function carryRevisionsAcross(
  before: ProjectDoc,
  set: (partial: { doc: ProjectDoc }) => void,
  get: () => { doc: ProjectDoc },
): void {
  const restored = get().doc
  const carried = carryRevisions(before, restored)
  if (carried !== restored) withoutHistory(() => set({ doc: carried }))
}

/** Run a mutation without recording an undo step, leaving the tracking flag
 *  exactly as found — a typing burst may already have paused it. */
function withoutHistory(fn: () => void): void {
  const wasTracking = useStore.temporal.getState().isTracking
  if (wasTracking) useStore.temporal.getState().pause()
  try {
    fn()
  } finally {
    if (wasTracking) useStore.temporal.getState().resume()
  }
}
import type { StandardProfile } from '../model/standard'
import { propagateFluid } from '../model/fluidFlow'
import type { EngineeringRecord, EntityKind, RecordStatus, Registry } from '../model/registry'
import { keyOfEdge, keyOfNode } from '../model/registry'
import type { Area, LegacyRow, Unit } from '../model/hierarchy'
import type { Loop, LoopType } from '../model/loop'
import { loopNumberKey, loopNumberTaken, newLoop } from '../model/loop'
import type { AdoptionRow } from '../model/loopAdoption'
import { drawnKinds, liveKeys } from '../model/registry'
import type { QaEvidence, StandardProvenance } from '../model/provenance'
import { issueGateFor } from '../model/standard'
import { evaluateConformance, issueBlockers } from '../model/conformance'
import { qaFor } from '../validate/engine'
import { newArea, newUnit } from '../model/hierarchy'
import { applyRename } from '../model/references'
import { registerCustomSymbols } from '../symbols/custom'
import { isPortEnd } from '../model/types'
import { createEmptyDoc, createSheet } from '../model/doc'
import type { HmiPipe, HmiScreen, HmiTheme, HmiWidget } from '../hmi/model'
import { createScreen } from '../hmi/model'

export interface LoopInit {
  name?: string
  description?: string
  type?: LoopType
  status?: string
}

/**
 * What a loop mutation did.
 *
 * `ok: false` means NOTHING happened — no document mutation, no partial write
 * and no undo step, because the action returned the state object it was handed
 * and zundo's `equality` compares `doc` by identity. `reason` is the sentence
 * a caller can show; it is never a code to switch on.
 */
export interface LoopResult {
  ok: boolean
  /** The loop acted on. Present on success, and on `addLoop` it is the new id. */
  id?: string
  reason?: string
}

/** What a rename did to the engineering record behind a tag or line number. */
export interface RetagResult {
  /** The new key already carried a record, so nothing was moved or copied. */
  collision: boolean
}

export interface StoreState {
  doc: ProjectDoc
  activeSheetId: string
  selection: string[]
  dirty: boolean
  /** Firestore id of the cloud drawing this document came from, if any.
   *  Kept out of `doc` on purpose: it is per-account bookkeeping, not part of
   *  the drawing, and must not travel inside an exported .pnid file. */
  cloudId: string | null
  setCloudId(id: string | null): void
  activeLineClass: PlantEdge['lineClass']

  addNode(partial: Omit<PlantNode, 'id'>): string
  setNodePos(id: string, x: number, y: number): void
  moveNodes(ids: string[], dx: number, dy: number): void
  /** Magnetic docking: drop a component onto another component's
   *  connection point. The move and the line it creates are ONE undo step
   *  because they are one gesture to the user. Returns the new line's id, so
   *  a shake mid-drag can cut exactly the line that drag just made. */
  dockNode(id: string, x: number, y: number, edge: Omit<PlantEdge, 'id'>): string
  rotateNode(id: string): void
  setNodeScale(id: string, scale: number): void
  /** Per-axis stretch (longer horizontal vessel etc.). 1/1 clears all scaling. */
  setNodeStretch(id: string, sx: number, sy: number): void
  setNodeConfig(id: string, config: Record<string, string>): void
  /** One-shot pin placement: the next click on this node adds a connection pin. */
  armPin: string | null
  setArmPin(id: string | null): void
  addExtraPort(nodeId: string, port: { x: number; y: number; kind: 'process' | 'signal' | 'both' }): void
  removeExtraPort(nodeId: string, portId: string): void
  /** Renames an object and carries its engineering record across. The result
   *  reports a COLLISION — the new key already had a record, so neither was
   *  touched and the object now wears a tag whose record belongs to something
   *  else. Callers must say so: `retagRegistry` refuses to merge because
   *  merging two engineering records is unrecoverable, and a silent refusal
   *  reads to the user as a rename that worked. */
  setTag(id: string, tag: Tag | undefined): RetagResult
  setLabel(id: string, label: string): void
  setLabelPos(id: string, pos: 'below' | 'center'): void
  setTagOffset(id: string, off: { x: number; y: number } | undefined): void
  setLabelOffset(id: string, off: { x: number; y: number } | undefined): void
  setNodeLink(id: string, link: PlantNode['link']): void
  setDatasheet(id: string, patch: Record<string, string>): void
  /** Engineering records (doc.registry), keyed by tag / line number. All
   *  undoable, and all a single undo step. */
  setRecordField(key: string, kind: EntityKind, fieldKey: string, value: string): void
  /** Apply many engineering edits as ONE undo step — a CSV import, a paste.
   *  Every change lands or none does. */
  applyRecordEdits(edits: { key: string; kind: EntityKind; field: string; value: string; unitId?: string }[]): void
  setRecordStatus(key: string, status: RecordStatus | undefined): void
  setRecordOwner(key: string, owner: string): void
  /** Delete a record outright. Only ever called for an orphan the user has
   *  chosen to discard — nothing deletes a record automatically. */
  purgeRecord(key: string): void
  /** Accept a QA finding, with the reason on the record. Keyed by the finding's
   *  stable rule+entity key, so it survives deleting and redrawing the symbol. */
  ignoreFinding(key: string, reason: string): void
  unignoreFinding(key: string): void
  setUnderlay(underlay: Sheet['underlay']): void
  addCustomSymbol(def: CustomSymbolDef): void
  removeCustomSymbol(id: string): void
  setMeta(patch: Partial<ProjectDoc['meta']>): void
  setSettings(patch: Partial<ProjectDoc['settings']>): void
  /** Add a prebuilt group of nodes/edges (and optionally drop edges) as ONE undo step. */
  addBatch(nodes: PlantNode[], edges: PlantEdge[], deleteEdgeIds?: string[]): void
  setSheetMeta(patch: Partial<Pick<Sheet, 'name' | 'drawingNumber' | 'revision' | 'sheetSize'>>): void
  /** Add an unissued row to a sheet's revision table. Returns its id. */
  addRevision(sheetId: string, fields: Pick<Revision, 'code' | 'status'> & Partial<Revision>): string
  /** Edit an unissued row. An ISSUED row is refused: history is not editable. */
  updateRevision(sheetId: string, revisionId: string, patch: Partial<Omit<Revision, 'id'>>): { ok: boolean }
  /** Stamp a row as issued, with the snapshot and the QA state captured for it.
   *  Called by persist/revisions issueRevision(), never directly by UI. */
  markIssued(
    sheetId: string,
    revisionId: string,
    stamp: {
      issuedAt: string
      snapshotId?: string
      qaAtIssue: Revision['qaAtIssue']
      /** Frozen at issue. Copied in, never referenced. */
      standard?: StandardProvenance
      qaEvidence?: QaEvidence
    },
  ): { ok: boolean; blockers: string[] }
  deleteRevision(sheetId: string, revisionId: string): { ok: boolean }
  addSheet(): string
  renameSheet(id: string, name: string): void
  deleteSheet(id: string): void
  setActiveSheet(id: string): void
  addEdge(partial: Omit<PlantEdge, 'id'>): string
  /** Patches a line. Renumbering carries the record exactly as a retag does,
   *  so this reports a collision the same way — see `setTag`. */
  setEdge(id: string, patch: Partial<Omit<PlantEdge, 'id'>>): RetagResult
  setEdgeVertices(id: string, vertices: { x: number; y: number }[]): void
  /** Assign a service to a line; auto-spreads along the connected run
   *  (through valves/pumps/fittings, stopping at vessels). One undo step. */
  setEdgeFluid(id: string, fluidId: string | undefined): void
  /** Adopt a company standard, or drop back to the built-in default. Goes
   *  through the same set() as every other edit, so it is undoable. */
  setStandard(standard: StandardProfile | undefined): void
  /** Budget & pricing (doc.budget) — all undoable. */
  setBudget(patch: Partial<BudgetSettings>): void
  setPriceOverride(key: string, price: number | undefined): void
  setNodeCost(id: string, cost: number | undefined): void
  /** Areas and Units (doc.areas / doc.units) — all undoable, and none of it
   *  routed through the tag reference graph: an Area code is a label, not an
   *  engineering identity, so changing it breaks nothing. */
  addArea(code: string, name?: string): string
  updateArea(id: string, patch: Partial<Omit<Area, 'id'>>): void
  /** Delete an Area, the Units inside it, and every assignment to those units.
   *  ONE undo step. Reports what it cleared so the UI can say so first. */
  removeArea(id: string): { units: number; cleared: number }
  addUnit(areaId: string, code: string, name?: string): string
  updateUnit(id: string, patch: Partial<Omit<Unit, 'id'>>): void
  removeUnit(id: string): { cleared: number }
  /** Assign one engineering record to a Unit, or clear it with ''/undefined. */
  assignUnit(key: string, kind: EntityKind, unitId: string | undefined): void
  /* ------------------------------------------------------ persistent loops */
  /** Create a Loop. Refused when `number` is blank or already worn by another
   *  loop; the refusal touches nothing and records no undo step. */
  addLoop(number: string, init?: LoopInit): LoopResult
  /** Change a Loop's number, name, description, type or status. `id` never
   *  moves. A renumber onto a number another loop wears is refused whole. */
  updateLoop(id: string, patch: Partial<Omit<Loop, 'id'>>): LoopResult
  /** Delete a Loop and clear `loopId` from every record assigned to it.
   *  ONE undo step; reports what it cleared so the caller can say so first.
   *  Records, nodes and HMI objects are never deleted. */
  removeLoop(id: string): LoopResult & { cleared: number }
  /** Assign one engineering record to a Loop, by stable Loop id — never by
   *  loop number. Refused for an unknown loop or a key that names nothing. */
  assignLoop(key: string, kind: EntityKind, loopId: string): LoopResult
  /** Clear a record's loop assignment. Explicit, and deliberately NOT reachable
   *  by clearing a tag: those are different intentions. */
  unassignLoop(key: string): LoopResult
  /** Apply an adopted-loop plan as ONE undo step. Only rows the plan marked
   *  `adopt` are acted on, each re-checked against the live document first;
   *  nothing is renamed, deleted or inferred. */
  applyLoopAdoption(rows: readonly AdoptionRow[]): { loops: number; assigned: number }
  /** Apply a legacy Area/Unit mapping plan as ONE undo step. Only rows the
   *  plan marked `mapped` carry a unit; nothing else is touched, and the
   *  legacy `general.area` text is left exactly where it is. */
  applyLegacyMapping(rows: LegacyRow[]): number
  addFluid(name: string, color: string): string
  updateFluid(id: string, patch: Partial<Omit<Fluid, 'id'>>): void
  /** Delete a service and clear it from every line on every sheet. */
  removeFluid(id: string): void
  deleteIds(ids: string[]): void
  deleteSelected(): void
  setSelection(ids: string[]): void
  setActiveLineClass(lineClass: PlantEdge['lineClass']): void
  pasteNodes(nodes: PlantNode[], edges: PlantEdge[]): void
  loadIntoStore(doc: ProjectDoc): void
  markSaved(): void
  undo(): void
  redo(): void

  /** HMI Studio slice — screens live in doc.hmiScreens; edits are undoable. */
  activeScreenId: string | null
  setActiveScreen(id: string): void
  addScreen(): string
  addImportedScreen(screen: HmiScreen): void
  /** Batch import (multi-sheet + optional overview): ONE undo step; if an
   *  incoming screen claims home, existing homes yield. Activates the first. */
  addImportedScreens(screens: HmiScreen[]): void
  replaceScreen(screen: HmiScreen): void
  renameScreen(id: string, name: string): void
  deleteScreen(id: string): void
  /** At most one home screen; RUN starts there. */
  setHomeScreen(id: string, on: boolean): void
  reorderScreens(id: string, toIndex: number): void
  duplicateScreen(id: string): string
  setScreenTheme(id: string, theme: HmiTheme): void
  addWidget(partial: Omit<HmiWidget, 'id'>): string
  addWidgets(partials: Omit<HmiWidget, 'id'>[]): string[]
  updateWidget(id: string, patch: Partial<Omit<HmiWidget, 'id'>>): void
  updateWidgets(entries: { id: string; patch: Partial<Omit<HmiWidget, 'id'>> }[]): void
  reorderWidgets(ids: string[], to: 'front' | 'back'): void
  moveWidgets(ids: string[], dx: number, dy: number): void
  addHmiPipe(partial: Omit<HmiPipe, 'id'>): string
  updateHmiPipe(id: string, patch: Partial<Omit<HmiPipe, 'id'>>): void
  deleteHmiIds(ids: string[]): void
  /** Paste/import helper: widgets + pipes land as ONE undo step. */
  addHmiBatch(widgets: Omit<HmiWidget, 'id'>[], pipes: Omit<HmiPipe, 'id'>[]): { widgetIds: string[]; pipeIds: string[] }
}

/** The sheet all node/edge actions and the canvas operate on. */
export function activeSheet(s: Pick<StoreState, 'doc' | 'activeSheetId'>): Sheet {
  return s.doc.sheets.find((sh) => sh.id === s.activeSheetId) ?? s.doc.sheets[0]!
}

/** The HMI screen all widget/pipe actions and the HMI canvas operate on.
 *  Falls back to the first screen when the active id is stale (e.g. an undo
 *  removed the screen it pointed at); null only when no screens exist. */
export function activeHmiScreen(s: Pick<StoreState, 'doc' | 'activeScreenId'>): HmiScreen | null {
  return s.doc.hmiScreens.find((sc) => sc.id === s.activeScreenId) ?? s.doc.hmiScreens[0] ?? null
}

function touched(doc: ProjectDoc): ProjectDoc {
  return { ...doc, meta: { ...doc.meta, modified: new Date().toISOString() } }
}

const initialDoc = createEmptyDoc()

export const useStore = create<StoreState>()(
  temporal(
    (set, get) => {
      /** Immutably replace the active sheet via an updater. */
      const patchSheet = (updater: (sheet: Sheet) => Sheet) => {
        set((s) => ({
          doc: touched({
            ...s.doc,
            sheets: s.doc.sheets.map((sh) => (sh.id === activeSheet(s).id ? updater(sh) : sh)),
          }),
          dirty: true,
        }))
      }

      /** Immutably replace the active HMI screen via an updater. Resolves the
       *  target exactly like activeHmiScreen() — a stale activeScreenId (e.g.
       *  after an undo removed that screen) must fall back, not silently drop
       *  the edit. With no screens at all this returns the state unchanged so
       *  neither subscribers nor undo history record anything. */
      const patchScreen = (updater: (screen: HmiScreen) => HmiScreen) => {
        set((s) => {
          const target = activeHmiScreen(s)
          if (!target) return s
          return {
            doc: touched({
              ...s.doc,
              hmiScreens: s.doc.hmiScreens.map((sc) => (sc.id === target.id ? updater(sc) : sc)),
            }),
            dirty: true,
          }
        })
      }

      return {
        doc: initialDoc,
        activeSheetId: initialDoc.sheets[0]!.id,
        activeScreenId: null,
        selection: [],
        armPin: null,
        dirty: false,
        cloudId: null,
        activeLineClass: 'process.major',

        addNode(partial) {
          const id = ulid()
          patchSheet((sh) => ({ ...sh, nodes: [...sh.nodes, { ...partial, id }] }))
          return id
        },

        setNodePos(id, x, y) {
          patchSheet((sh) => ({ ...sh, nodes: sh.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }))
        },

        moveNodes(ids, dx, dy) {
          const idSet = new Set(ids)
          const shift = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy })
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => (idSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
            // A line whose every connected symbol is moving travels rigidly with
            // them, so its waypoints — and any free end, which no selection can
            // contain — have to travel too. Without this, marquee-selecting a
            // drawing and dragging it moved the symbols and left every routed
            // line behind. A line with one end outside the selection is being
            // stretched instead, and its waypoints must stay where they are.
            edges: sh.edges.map((e) => {
              const portEnds = [e.source, e.target].filter(isPortEnd)
              if (!portEnds.length || !portEnds.every((p) => idSet.has(p.nodeId))) return e
              return {
                ...e,
                ...(e.vertices ? { vertices: e.vertices.map(shift) } : {}),
                ...(isPortEnd(e.source) ? {} : { source: shift(e.source) }),
                ...(isPortEnd(e.target) ? {} : { target: shift(e.target) }),
              }
            }),
          }))
        },

        dockNode(id, x, y, edge) {
          const edgeId = ulid()
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
            edges: [...sh.edges, { ...edge, id: edgeId }],
          }))
          return edgeId
        },

        rotateNode(id) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) =>
              n.id === id ? { ...n, rotation: (((n.rotation + 90) % 360) as 0 | 90 | 180 | 270) } : n,
            ),
          }))
        },

        setNodeScale(id, scale) {
          const clamped = Math.min(3, Math.max(0.5, Math.round(scale * 4) / 4))
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => {
              if (n.id !== id) return n
              const { scale: _drop, ...rest } = n
              return clamped === 1 ? rest : { ...rest, scale: clamped }
            }),
          }))
        },

        setNodeStretch(id, sx, sy) {
          const clamp = (v: number) => Math.min(4, Math.max(0.5, Math.round(v * 4) / 4))
          const cx = clamp(sx)
          const cy = clamp(sy)
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => {
              if (n.id !== id) return n
              const { scale: _s, scaleX: _x, scaleY: _y, ...rest } = n
              if (cx === 1 && cy === 1) return rest
              if (cx === cy) return { ...rest, scale: cx }
              return { ...rest, scaleX: cx, scaleY: cy }
            }),
          }))
        },

        setNodeConfig(id, config) {
          patchSheet((sh) => ({ ...sh, nodes: sh.nodes.map((n) => (n.id === id ? { ...n, config } : n)) }))
        },

        setArmPin(id) {
          set({ armPin: id })
        },

        addExtraPort(nodeId, port) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => {
              if (n.id !== nodeId) return n
              const existing = n.extraPorts ?? []
              let i = existing.length + 1
              while (existing.some((p) => p.id === `pin-${i}`)) i++
              return { ...n, extraPorts: [...existing, { id: `pin-${i}`, ...port }] }
            }),
          }))
        },

        removeExtraPort(nodeId, portId) {
          // lines connected to the pin go with it — a dangling reference would
          // wedge the reconciler
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) =>
              n.id === nodeId
                ? { ...n, extraPorts: (n.extraPorts ?? []).filter((p) => p.id !== portId) }
                : n,
            ),
            edges: sh.edges.filter((e) => {
              const refs = (end: PlantEdge['source']) =>
                isPortEnd(end) && end.nodeId === nodeId && end.portId === portId
              return !refs(e.source) && !refs(e.target)
            }),
          }))
        },

        /**
         * Renaming an object carries its engineering record with it. Without
         * this, editing FT-101 to FT-102 would strand an approved datasheet
         * under the old tag and hand the user an empty form under the new one.
         * See model/references.ts for the full reference graph, and
         * retagRegistry for the move / copy / collide rules it preserves.
         */
        setTag(id, tag) {
          let collision = false
          set((s) => {
            const sheet = activeSheet(s)
            const node = sheet.nodes.find((n) => n.id === id)
            if (!node) return s
            const oldKey = keyOfNode(node)
            const newKey = keyOfNode({ ...node, tag })
            const sheets = s.doc.sheets.map((sh) =>
              sh.id === sheet.id ? { ...sh, nodes: sh.nodes.map((n) => (n.id === id ? { ...n, tag } : n)) } : sh,
            )
            // applyRename takes the document with the new name already on the
            // sheet and carries everything that pointed at the old one with it:
            // the engineering record (still copied, not moved, when another
            // symbol wears the old tag), HMI widget bindings, trend pens and
            // accepted findings. One store update, so undo restores the whole
            // rename in a single step.
            const r = applyRename({ ...s.doc, sheets }, oldKey, newKey)
            collision = r.broken.length > 0
            // A collision refuses the WHOLE operation, the new tag included.
            // Renaming onto a key that already has an engineering record would
            // otherwise leave the drawing carrying the destination tag while
            // every reference — record, HMI bindings, accepted findings —
            // stayed on the old one: a half-done rename, which is worse than
            // none. Returning `s` unchanged also means zundo records no step.
            if (collision) return s
            return { doc: touched(r.doc), dirty: true }
          })
          return { collision }
        },

        setLabel(id, label) {
          patchSheet((sh) => ({ ...sh, nodes: sh.nodes.map((n) => (n.id === id ? { ...n, label } : n)) }))
        },

        setTagOffset(id, off) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => {
              if (n.id !== id) return n
              const { tagOffset: _d, ...rest } = n
              return off ? { ...rest, tagOffset: off } : rest
            }),
          }))
        },

        setLabelOffset(id, off) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => {
              if (n.id !== id) return n
              const { labelOffset: _d, ...rest } = n
              return off ? { ...rest, labelOffset: off } : rest
            }),
          }))
        },

        setLabelPos(id, pos) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => {
              if (n.id !== id) return n
              const { labelPos: _drop, ...rest } = n
              return pos === 'below' ? rest : { ...rest, labelPos: pos }
            }),
          }))
        },

        setNodeLink(id, link) {
          patchSheet((sh) => ({ ...sh, nodes: sh.nodes.map((n) => (n.id === id ? { ...n, link } : n)) }))
        },

        setDatasheet(id, patch) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => (n.id === id ? { ...n, datasheet: { ...n.datasheet, ...patch } } : n)),
          }))
        },

        applyRecordEdits(edits) {
          if (!edits.length) return
          set((s) => {
            // ONE `set`, so zundo records ONE past state: a hundred cells out
            // of a spreadsheet undo together, which is how the user thinks of
            // them. Batching with pauseHistory would not work here — zundo's
            // pause DROPS changes rather than merging them, so the import
            // would become un-undoable instead of undoable in one step.
            const registry: Registry = { ...s.doc.registry }
            for (const e of edits) {
              const prev = registry[e.key] ?? { key: e.key, kind: e.kind, fields: {} }
              // A Unit assignment is a REFERENCE, so it lands on the record
              // rather than in `fields`, and the value that arrives here is
              // already a resolved stable id — never the code the CSV printed.
              // Resolution happens once, in the change set, where an unknown
              // code can still refuse the whole import.
              registry[e.key] = e.unitId === undefined
                ? { ...prev, fields: { ...prev.fields, [e.field]: e.value } }
                : { ...prev, unitId: e.unitId || undefined }
            }
            return { doc: touched({ ...s.doc, registry }), dirty: true }
          })
        },

        setRecordField(key, kind, fieldKey, value) {
          set((s) => {
            const prev: EngineeringRecord = s.doc.registry?.[key] ?? { key, kind, fields: {} }
            const record: EngineeringRecord = {
              ...prev,
              kind: prev.kind ?? kind,
              fields: { ...prev.fields, [fieldKey]: value },
              updated: new Date().toISOString(),
            }
            return { doc: touched({ ...s.doc, registry: { ...s.doc.registry, [key]: record } }), dirty: true }
          })
        },

        setRecordStatus(key, status) {
          set((s) => {
            const prev = s.doc.registry?.[key]
            if (!prev) return s
            return {
              doc: touched({ ...s.doc, registry: { ...s.doc.registry, [key]: { ...prev, status } } }),
              dirty: true,
            }
          })
        },

        setRecordOwner(key, owner) {
          set((s) => {
            const prev = s.doc.registry?.[key]
            if (!prev) return s
            return {
              doc: touched({ ...s.doc, registry: { ...s.doc.registry, [key]: { ...prev, owner } } }),
              dirty: true,
            }
          })
        },

        purgeRecord(key) {
          set((s) => {
            if (!s.doc.registry?.[key]) return s
            const registry = { ...s.doc.registry }
            delete registry[key]
            return { doc: touched({ ...s.doc, registry }), dirty: true }
          })
        },

        ignoreFinding(key, reason) {
          set((s) => ({
            doc: touched({
              ...s.doc,
              qa: {
                ignored: {
                  ...s.doc.qa?.ignored,
                  [key]: { reason, by: s.doc.meta.author || undefined, at: new Date().toISOString() },
                },
              },
            }),
            dirty: true,
          }))
        },

        unignoreFinding(key) {
          set((s) => {
            const current = s.doc.qa?.ignored
            if (!current?.[key]) return s
            const ignored = { ...current }
            delete ignored[key]
            return { doc: touched({ ...s.doc, qa: { ignored } }), dirty: true }
          })
        },

        setMeta(patch) {
          set((s) => ({ doc: touched({ ...s.doc, meta: { ...s.doc.meta, ...patch } }), dirty: true }))
        },

        setSettings(patch) {
          set((s) => ({ doc: touched({ ...s.doc, settings: { ...s.doc.settings, ...patch } }), dirty: true }))
        },

        addBatch(nodes, edges, deleteEdgeIds) {
          const drop = new Set(deleteEdgeIds ?? [])
          patchSheet((sh) => ({
            ...sh,
            nodes: [...sh.nodes, ...nodes],
            edges: [...sh.edges.filter((e) => !drop.has(e.id)), ...edges],
          }))
          set({ selection: nodes.map((n) => n.id) })
        },

        setSheetMeta(patch) {
          patchSheet((sh) => ({ ...sh, ...patch }))
        },

        addRevision(sheetId, fields) {
          const id = ulid()
          withoutHistory(() => set((s) => ({
            doc: touched({
              ...s.doc,
              sheets: s.doc.sheets.map((sh) =>
                sh.id === sheetId
                  ? { ...sh, revisions: [...(sh.revisions ?? []), newRevision(id, fields)] }
                  : sh,
              ),
            }),
            dirty: true,
          })))
          return id
        },

        updateRevision(sheetId, revisionId, patch) {
          let ok = false
          withoutHistory(() => set((s) => {
            const sheet = s.doc.sheets.find((sh) => sh.id === sheetId)
            const row = sheet?.revisions?.find((r) => r.id === revisionId)
            // An issued revision is a record of something that happened. It is
            // not a form, and editing it would make the history a fiction.
            if (!row || row.issuedAt) return s
            ok = true
            return {
              doc: touched({
                ...s.doc,
                sheets: s.doc.sheets.map((sh) =>
                  sh.id !== sheetId
                    ? sh
                    : { ...sh, revisions: (sh.revisions ?? []).map((r) => (r.id === revisionId ? { ...r, ...patch, id: r.id } : r)) },
                ),
              }),
              dirty: true,
            }
          }))
          return { ok }
        },

        /**
         * Stamp a revision as issued — and REFUSE when the house's issue
         * policy says it may not be.
         *
         * The gate lives here, in the mutation, not in the dialog. A disabled
         * button is a courtesy to the user; it is not a control. Anything that
         * can reach the store — a command, a future automation, a console —
         * must hit the same gate, so the gate is evaluated against `s.doc` at
         * the moment of the write rather than against anything the caller
         * hands in. A caller cannot supply its own verdict: the verdict is
         * computed here from the document being issued.
         */
        markIssued(sheetId, revisionId, stamp) {
          let ok = false
          let blockers: string[] = []
          withoutHistory(() => set((s) => {
            const sheet = s.doc.sheets.find((sh) => sh.id === sheetId)
            const row = sheet?.revisions?.find((r) => r.id === revisionId)
            if (!row) {
              blockers = ['That revision no longer exists.']
              return s
            }
            if (row.issuedAt) {
              blockers = ['That revision has already been issued.']
              return s
            }

            const gate = issueGateFor(s.doc.standard, row.status)
            // The cached report for this exact document — the same object the
            // Revisions dialog read, so the reason shown and the reason
            // enforced cannot differ.
            const report = qaFor(s.doc)
            const conformance = evaluateConformance(report, gate)
            blockers = issueBlockers(row, gate, report, conformance)
            // Nothing written. `s` is returned by identity, so the document,
            // the revision row and the dirty flag are all untouched.
            if (blockers.length) return s

            ok = true
            return {
              doc: touched({
                ...s.doc,
                sheets: s.doc.sheets.map((sh) =>
                  sh.id !== sheetId
                    ? sh
                    : {
                        ...sh,
                        // The stored string follows the issue, so the title
                        // block, the DXF writer and print need no change.
                        revision: row.code,
                        revisions: (sh.revisions ?? []).map((r) =>
                          r.id === revisionId
                            ? {
                                ...r,
                                issuedAt: stamp.issuedAt,
                                ...(stamp.snapshotId ? { snapshotId: stamp.snapshotId } : {}),
                                ...(stamp.qaAtIssue ? { qaAtIssue: { ...stamp.qaAtIssue } } : {}),
                                // Deep-copied on the way in, so nothing the
                                // caller still holds can reach back into a row
                                // that is now history.
                                ...(stamp.standard ? { standard: { ...stamp.standard } } : {}),
                                ...(stamp.qaEvidence
                                  ? {
                                      qaEvidence: {
                                        ...stamp.qaEvidence,
                                        findings: stamp.qaEvidence.findings.map((f) => ({
                                          ...f,
                                          ...(f.ignored ? { ignored: { ...f.ignored } } : {}),
                                        })),
                                      },
                                    }
                                  : {}),
                                conformance: {
                                  ...conformance,
                                  open: { ...conformance.open },
                                  accepted: { ...conformance.accepted },
                                  rulesDisabled: [...conformance.rulesDisabled],
                                },
                              }
                            : r,
                        ),
                      },
                ),
              }),
              dirty: true,
            }
          }))
          return { ok, blockers }
        },

        deleteRevision(sheetId, revisionId) {
          let ok = false
          withoutHistory(() => set((s) => {
            const sheet = s.doc.sheets.find((sh) => sh.id === sheetId)
            const row = sheet?.revisions?.find((r) => r.id === revisionId)
            if (!row || row.issuedAt) return s
            ok = true
            return {
              doc: touched({
                ...s.doc,
                sheets: s.doc.sheets.map((sh) =>
                  sh.id !== sheetId ? sh : { ...sh, revisions: (sh.revisions ?? []).filter((r) => r.id !== revisionId) },
                ),
              }),
              dirty: true,
            }
          }))
          return { ok }
        },

        addSheet() {
          const sheet = createSheet(get().doc.sheets.length + 1)
          set((s) => ({ doc: touched({ ...s.doc, sheets: [...s.doc.sheets, sheet] }), dirty: true }))
          set({ activeSheetId: sheet.id, selection: [] })
          return sheet.id
        },

        renameSheet(id, name) {
          set((s) => ({
            doc: touched({ ...s.doc, sheets: s.doc.sheets.map((sh) => (sh.id === id ? { ...sh, name } : sh)) }),
            dirty: true,
          }))
        },

        deleteSheet(id) {
          const s = get()
          if (s.doc.sheets.length <= 1) return
          const remaining = s.doc.sheets.filter((sh) => sh.id !== id)
          set({
            doc: touched({ ...s.doc, sheets: remaining }),
            dirty: true,
            activeSheetId: s.activeSheetId === id ? remaining[0]!.id : s.activeSheetId,
            selection: [],
          })
        },

        setActiveSheet(id) {
          if (get().doc.sheets.some((sh) => sh.id === id)) set({ activeSheetId: id, selection: [] })
        },

        addEdge(partial) {
          const id = ulid()
          patchSheet((sh) => ({ ...sh, edges: [...sh.edges, { ...partial, id }] }))
          return id
        },

        setEdge(id, patch) {
          let collision = false
          set((s) => {
            const sheet = activeSheet(s)
            const edge = sheet.edges.find((e) => e.id === id)
            if (!edge) return s
            const next = { ...edge, ...patch }
            const sheets = s.doc.sheets.map((sh) =>
              sh.id === sheet.id ? { ...sh, edges: sh.edges.map((e) => (e.id === id ? next : e)) } : sh,
            )
            // A renumbered line carries its references exactly as a renamed tag
            // does — same collector, same collision rule.
            const oldKey = keyOfEdge(edge)
            const newKey = keyOfEdge(next)
            const r = applyRename({ ...s.doc, sheets }, oldKey, newKey)
            collision = r.broken.length > 0
            // Same refusal as a tag rename: the line number does not change
            // either, so the document is never partially renumbered.
            if (collision) return s
            return { doc: touched(r.doc), dirty: true }
          })
          return { collision }
        },

        setEdgeVertices(id, vertices) {
          get().setEdge(id, { vertices })
        },

        setStandard(standard) {
          set((s) => {
            const doc = { ...s.doc }
            if (standard) doc.standard = standard
            else delete doc.standard
            return { doc: touched(doc), dirty: true }
          })
        },

        setBudget(patch) {
          set((s) => ({
            doc: touched({ ...s.doc, budget: { currency: '$', ...s.doc.budget, ...patch } }),
            dirty: true,
          }))
        },

        setPriceOverride(key, price) {
          set((s) => {
            const overrides = { ...s.doc.budget?.overrides }
            if (price === undefined) delete overrides[key]
            else overrides[key] = price
            return { doc: touched({ ...s.doc, budget: { currency: '$', ...s.doc.budget, overrides } }), dirty: true }
          })
        },

        setNodeCost(id, cost) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => (n.id === id ? { ...n, cost } : n)),
          }))
        },

        setEdgeFluid(id, fluidId) {
          patchSheet((sh) => {
            const run = new Set(propagateFluid(sh, id))
            return { ...sh, edges: sh.edges.map((e) => (run.has(e.id) ? { ...e, fluidId } : e)) }
          })
        },

        addArea(code, name) {
          const area = newArea(code, name)
          set((s) => ({ doc: touched({ ...s.doc, areas: [...(s.doc.areas ?? []), area] }), dirty: true }))
          return area.id
        },

        updateArea(id, patch) {
          set((s) => ({
            doc: touched({ ...s.doc, areas: (s.doc.areas ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
            dirty: true,
          }))
        },

        /**
         * Deleting an Area takes its Units and their assignments with it.
         *
         * Cascading rather than leaving dangling references, and rather than
         * refusing: a half-deleted hierarchy is a state nothing downstream can
         * describe, and an Area nobody may delete until they have emptied it
         * by hand is a chore, not a safeguard. It is ONE undo step and the
         * count comes back so the dialog can say what it is about to clear
         * before it does — the user is told, not surprised.
         */
        removeArea(id) {
          const state = get()
          const doomed = new Set((state.doc.units ?? []).filter((u) => u.areaId === id).map((u) => u.id))
          let cleared = 0
          set((s) => {
            const registry: Registry = { ...s.doc.registry }
            for (const [key, rec] of Object.entries(registry)) {
              if (rec.unitId && doomed.has(rec.unitId)) {
                registry[key] = { ...rec, unitId: undefined }
                cleared += 1
              }
            }
            return {
              doc: touched({
                ...s.doc,
                areas: (s.doc.areas ?? []).filter((a) => a.id !== id),
                units: (s.doc.units ?? []).filter((u) => u.areaId !== id),
                ...(cleared ? { registry } : {}),
              }),
              dirty: true,
            }
          })
          return { units: doomed.size, cleared }
        },

        addUnit(areaId, code, name) {
          const unit = newUnit(areaId, code, name)
          set((s) => ({ doc: touched({ ...s.doc, units: [...(s.doc.units ?? []), unit] }), dirty: true }))
          return unit.id
        },

        /** Renaming a Unit's code or name changes nothing else. Assignments
         *  point at the id, so they follow silently and correctly — which is
         *  the entire reason the id exists. */
        updateUnit(id, patch) {
          set((s) => ({
            doc: touched({ ...s.doc, units: (s.doc.units ?? []).map((u) => (u.id === id ? { ...u, ...patch } : u)) }),
            dirty: true,
          }))
        },

        removeUnit(id) {
          let cleared = 0
          set((s) => {
            const registry: Registry = { ...s.doc.registry }
            for (const [key, rec] of Object.entries(registry)) {
              if (rec.unitId === id) {
                registry[key] = { ...rec, unitId: undefined }
                cleared += 1
              }
            }
            return {
              doc: touched({
                ...s.doc,
                units: (s.doc.units ?? []).filter((u) => u.id !== id),
                ...(cleared ? { registry } : {}),
              }),
              dirty: true,
            }
          })
          return { cleared }
        },

        assignUnit(key, kind, unitId) {
          set((s) => {
            const prev: EngineeringRecord = s.doc.registry?.[key] ?? { key, kind, fields: {} }
            if ((prev.unitId ?? '') === (unitId ?? '')) return s
            const record: EngineeringRecord = { ...prev, unitId: unitId || undefined, updated: new Date().toISOString() }
            return { doc: touched({ ...s.doc, registry: { ...s.doc.registry, [key]: record } }), dirty: true }
          })
        },

        /* --------------------------------------------- persistent loops */

        /**
         * Loop lifecycle, and the one rule that shapes all of it: a loop is
         * identified by its ULID and DISPLAYED by its number.
         *
         * Every action below either does the whole thing or does nothing at
         * all. A refusal returns the state object it was given, so `doc` keeps
         * its identity, zundo's `equality` (past.doc === current.doc) sees no
         * change, and no undo step is recorded — the same mechanism `setTag`
         * uses to refuse a colliding rename.
         *
         * WHY THE STORE REFUSES A DUPLICATE NUMBER at all, when `addArea` and
         * `addUnit` happily accept duplicate codes: a unit code is scoped by
         * its area and `resolveUnitByCode` disambiguates on that, so two units
         * numbered 101 are resolvable. A loop number has no scope — "the
         * diagram for loop 101" is simply undefined if two loops wear it. That
         * puts loops with TAGS rather than with the hierarchy, and `setTag`
         * refuses a colliding rename for exactly the same reason.
         *
         * `duplicate-loop-number` still exists as a critical check, because the
         * store is not the only way a number arrives: a hand-edited file, and
         * later an import, both bypass every action in this file.
         */
        addLoop(number, init = {}) {
          const trimmed = number.trim()
          if (!trimmed) return { ok: false, reason: 'A loop needs a number.' }
          const state = get()
          if (loopNumberTaken(state.doc.loops, trimmed)) {
            return { ok: false, reason: `Loop ${trimmed} already exists. Loop numbers are unique across the project.` }
          }
          const loop = newLoop(trimmed, init)
          set((sx) => ({ doc: touched({ ...sx.doc, loops: [...(sx.doc.loops ?? []), loop] }), dirty: true }))
          return { ok: true, id: loop.id }
        },

        /** Renumbering changes what prints and nothing else. Every membership
         *  points at the id, so assignments follow silently and correctly —
         *  which is the entire reason the id exists. */
        updateLoop(id, patch) {
          const state = get()
          const existing = (state.doc.loops ?? []).find((l) => l.id === id)
          if (!existing) return { ok: false, reason: 'That loop is no longer in this project.' }

          if (patch.number !== undefined) {
            const trimmed = patch.number.trim()
            if (!trimmed) return { ok: false, reason: 'A loop needs a number.' }
            if (loopNumberTaken(state.doc.loops, trimmed, id)) {
              return { ok: false, reason: `Loop ${trimmed} already exists. Loop numbers are unique across the project.` }
            }
          }

          set((sx) => ({
            doc: touched({
              ...sx.doc,
              loops: (sx.doc.loops ?? []).map((l) =>
                // `id` is spread first and the patch cannot carry one, so a
                // stable identity is not merely convention here — it is not
                // reachable from this action.
                l.id === id ? { ...l, ...patch, ...(patch.number !== undefined ? { number: patch.number.trim() } : {}), id: l.id } : l,
              ),
            }),
            dirty: true,
          }))
          return { ok: true, id }
        },

        /**
         * Deleting a Loop takes its memberships with it — and nothing else.
         *
         * Cascading rather than leaving dangling `loopId`s, for the reason
         * `removeArea` gives: a half-deleted relationship is a state nothing
         * downstream can describe. The ENGINEERING RECORDS SURVIVE. So do the
         * symbols, and so do the HMI screens: deleting a loop and binning an
         * approved datasheet are two different intentions, and only one of them
         * was expressed.
         *
         * One `set`, so undo restores the loop AND every membership together.
         */
        removeLoop(id) {
          const state = get()
          if (!(state.doc.loops ?? []).some((l) => l.id === id)) {
            return { ok: false, cleared: 0, reason: 'That loop is no longer in this project.' }
          }
          let cleared = 0
          set((sx) => {
            const registry: Registry = { ...sx.doc.registry }
            for (const [key, rec] of Object.entries(registry)) {
              if (rec.loopId !== id) continue
              const { loopId: _drop, ...rest } = rec
              registry[key] = rest
              cleared += 1
            }
            return {
              doc: touched({
                ...sx.doc,
                loops: (sx.doc.loops ?? []).filter((l) => l.id !== id),
                ...(cleared ? { registry } : {}),
              }),
              dirty: true,
            }
          })
          return { ok: true, id, cleared }
        },

        /**
         * Assign a record to a loop, BY STABLE ID.
         *
         * Never by number: a number is display text that the user is expected
         * to change, and a foreign key that moves is not a foreign key.
         *
         * A key that names nothing at all is refused. A key that IS drawn but
         * has no record yet gets one minted, which is exactly what `assignUnit`
         * does — "tag it before you can spec it" is the rule, and a freshly
         * tagged instrument is taggable and therefore assignable.
         */
        assignLoop(key, kind, loopId) {
          const state = get()
          if (!key) return { ok: false, reason: 'That object has no engineering tag, so there is nothing to assign.' }
          if (!(state.doc.loops ?? []).some((l) => l.id === loopId)) {
            return { ok: false, reason: 'That loop is no longer in this project.' }
          }
          const known = Boolean(state.doc.registry?.[key]) || liveKeys(state.doc.sheets).has(key)
          if (!known) return { ok: false, reason: `Nothing in this project is tagged ${key}.` }

          set((sx) => {
            const prev: EngineeringRecord = sx.doc.registry?.[key] ?? { key, kind, fields: {} }
            // Re-assigning the same loop changes nothing — and returning `sx`
            // means it also records no undo step, so a UI that fires on every
            // render cannot fill the history with nothing.
            if (prev.loopId === loopId) return sx
            const record: EngineeringRecord = { ...prev, loopId, updated: new Date().toISOString() }
            return { doc: touched({ ...sx.doc, registry: { ...sx.doc.registry, [key]: record } }), dirty: true }
          })
          return { ok: true, id: loopId }
        },

        /** The explicit opposite. Deliberately its own action rather than a
         *  side effect of clearing a tag: P0 already established that clearing
         *  a tag strands references rather than tidying them, and a loop
         *  assignment is a decision someone made about the object. */
        unassignLoop(key) {
          const state = get()
          const prev = state.doc.registry?.[key]
          if (!prev) return { ok: false, reason: `There is no engineering record for ${key}.` }
          if (!prev.loopId) return { ok: false, reason: `${key} is not assigned to a loop.` }
          const was = prev.loopId
          set((sx) => {
            const rec = sx.doc.registry?.[key]
            if (!rec?.loopId) return sx
            const { loopId: _drop, ...rest } = rec
            return {
              doc: touched({
                ...sx.doc,
                registry: { ...sx.doc.registry, [key]: { ...rest, updated: new Date().toISOString() } },
              }),
              dirty: true,
            }
          })
          return { ok: true, id: was }
        },

        /**
         * Adopt derived loops, as ONE undo step.
         *
         * The plan was computed against a document that may since have moved
         * on, so every row is re-checked here — the same defensive re-read
         * `applyLegacyMapping` does, and for the same reason: re-deciding
         * something the user has decided since is exactly what a migration
         * must not do.
         *
         * IDEMPOTENT. A number already taken is skipped rather than duplicated,
         * and a member that has gained a loop since is left where it is. Running
         * the same plan twice therefore changes nothing the second time.
         *
         * It creates loops and assigns records. It does not touch tags, nodes,
         * HMI screens, the derived grouping, or anything else.
         */
        applyLoopAdoption(rows) {
          const wanted = rows.filter((r) => r.verdict === 'adopt' && r.loopNumber)
          if (!wanted.length) return { loops: 0, assigned: 0 }
          let loopCount = 0
          let assignedCount = 0

          set((sx) => {
            const loops: Loop[] = [...(sx.doc.loops ?? [])]
            const taken = new Set(loops.map((l) => loopNumberKey(l.number)))
            const registry: Registry = { ...sx.doc.registry }
            // One walk, two answers: which keys are drawn, and what sort of
            // object wears each. The kind matters because a member that has no
            // record yet gets one minted here, and a valve filed as an
            // instrument is a wrong engineering fact written by a migration —
            // exactly what this path exists not to do.
            const drawn = drawnKinds(sx.doc.sheets)
            const now = new Date().toISOString()

            for (const r of wanted) {
              const number = r.loopNumber!
              if (taken.has(loopNumberKey(number))) continue
              // Only members that still exist and are still unassigned.
              const members = r.members.filter((key) => {
                const rec = registry[key]
                if (rec?.loopId) return false
                return Boolean(rec) || drawn.has(key)
              })
              if (members.length < 2) continue

              const loop = newLoop(number, r.suggestedType ? { type: r.suggestedType } : {})
              loops.push(loop)
              taken.add(loopNumberKey(number))
              loopCount += 1
              for (const key of members) {
                const prev = registry[key]
                if (prev) {
                  // An existing record keeps everything it had, `kind`
                  // included. Adoption assigns a loop; it does not reclassify.
                  registry[key] = { ...prev, loopId: loop.id, updated: now }
                } else {
                  const kind = drawn.get(key)
                  // Unreachable — the filter above kept only keys that are
                  // recorded or drawn — but a record is not worth minting
                  // under a guessed kind if that ever stops being true.
                  if (!kind) continue
                  registry[key] = { key, kind, fields: {}, loopId: loop.id, updated: now }
                }
                assignedCount += 1
              }
            }

            if (loopCount === 0) return sx
            return { doc: touched({ ...sx.doc, loops, registry }), dirty: true }
          })

          return { loops: loopCount, assigned: assignedCount }
        },

        applyLegacyMapping(rows) {
          const mapped = rows.filter((r) => r.verdict === 'mapped' && r.unitId)
          if (!mapped.length) return 0
          set((s) => {
            const registry: Registry = { ...s.doc.registry }
            for (const r of mapped) {
              const prev = registry[r.key]
              // Only a record that still exists and is still unassigned. The
              // plan was computed against a document that may since have moved
              // on, and re-deciding something the user has decided is exactly
              // what a migration must not do.
              if (!prev || prev.unitId) continue
              registry[r.key] = { ...prev, unitId: r.unitId }
            }
            return { doc: touched({ ...s.doc, registry }), dirty: true }
          })
          return mapped.length
        },

        addFluid(name, color) {
          const id = ulid()
          set((s) => ({ doc: touched({ ...s.doc, fluids: [...(s.doc.fluids ?? []), { id, name, color }] }), dirty: true }))
          return id
        },

        updateFluid(id, patch) {
          set((s) => ({
            doc: touched({ ...s.doc, fluids: (s.doc.fluids ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)) }),
            dirty: true,
          }))
        },

        removeFluid(id) {
          set((s) => ({
            doc: touched({
              ...s.doc,
              fluids: (s.doc.fluids ?? []).filter((f) => f.id !== id),
              sheets: s.doc.sheets.map((sh) => ({
                ...sh,
                edges: sh.edges.some((e) => e.fluidId === id)
                  ? sh.edges.map((e) => (e.fluidId === id ? { ...e, fluidId: undefined } : e))
                  : sh.edges,
              })),
            }),
            dirty: true,
          }))
        },

        /**
         * Deleting a symbol NEVER deletes its engineering record. A record left
         * without a symbol becomes an orphan the advisor surfaces with a purge
         * action — because deleting a symbol and binning an approved datasheet
         * are two different intentions, and only one of them was expressed.
         */
        deleteIds(ids) {
          const idSet = new Set(ids)
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.filter((n) => !idSet.has(n.id)),
            edges: sh.edges.filter(
              (e) =>
                !idSet.has(e.id) &&
                !(isPortEnd(e.source) && idSet.has(e.source.nodeId)) &&
                !(isPortEnd(e.target) && idSet.has(e.target.nodeId)),
            ),
          }))
          set((s) => ({ selection: s.selection.filter((sel) => !idSet.has(sel)) }))
        },

        deleteSelected() {
          get().deleteIds(get().selection)
        },

        setSelection(ids) {
          set({ selection: ids })
        },

        setActiveLineClass(lineClass) {
          set({ activeLineClass: lineClass })
        },

        pasteNodes(nodes, edges) {
          const idMap = new Map<string, string>()
          const newNodes: PlantNode[] = nodes.map((n) => {
            const id = ulid()
            idMap.set(n.id, id)
            const { tag: _tag, link: _link, ...rest } = n
            return { ...rest, id, x: n.x + 16, y: n.y + 16 }
          })
          const newEdges: PlantEdge[] = []
          for (const e of edges) {
            const src = isPortEnd(e.source) ? idMap.get(e.source.nodeId) : 'free'
            const tgt = isPortEnd(e.target) ? idMap.get(e.target.nodeId) : 'free'
            if (!src || !tgt) continue
            newEdges.push({
              ...e,
              id: ulid(),
              source: isPortEnd(e.source) ? { nodeId: src, portId: e.source.portId } : { x: e.source.x + 16, y: e.source.y + 16 },
              target: isPortEnd(e.target) ? { nodeId: tgt, portId: e.target.portId } : { x: e.target.x + 16, y: e.target.y + 16 },
              vertices: e.vertices?.map((v) => ({ x: v.x + 16, y: v.y + 16 })),
            })
          }
          patchSheet((sh) => ({ ...sh, nodes: [...sh.nodes, ...newNodes], edges: [...sh.edges, ...newEdges] }))
          set({ selection: newNodes.map((n) => n.id) })
        },

        setUnderlay(underlay) {
          patchSheet((sh) => {
            const next = { ...sh }
            if (underlay) next.underlay = underlay
            else delete next.underlay
            return next
          })
        },

        addCustomSymbol(def) {
          set((s) => {
            const doc = touched({ ...s.doc, customSymbols: [...(s.doc.customSymbols ?? []), def] })
            registerCustomSymbols(doc)
            return { doc, dirty: true }
          })
        },

        removeCustomSymbol(id) {
          set((s) => {
            const doc = touched({ ...s.doc, customSymbols: (s.doc.customSymbols ?? []).filter((d) => d.id !== id) })
            registerCustomSymbols(doc)
            return { doc, dirty: true }
          })
        },

        loadIntoStore(doc) {
          registerCustomSymbols(doc)
          // Whatever we just loaded is not the cloud drawing we had open, so
          // drop the link — otherwise the next cloud save silently overwrites
          // a different drawing. loadFromCloud re-establishes it afterwards.
          set({ doc, activeSheetId: doc.sheets[0]!.id, activeScreenId: doc.hmiScreens[0]?.id ?? null, selection: [], dirty: false, cloudId: null })
          useStore.temporal.getState().clear()
        },

        setCloudId(id) {
          set({ cloudId: id })
        },

        setActiveScreen(id) {
          if (get().doc.hmiScreens.some((sc) => sc.id === id)) set({ activeScreenId: id })
        },

        addScreen() {
          // never reuse a live name — "Screen 2" twice after a delete confuses
          const names = new Set(get().doc.hmiScreens.map((sc) => sc.name))
          let n = get().doc.hmiScreens.length + 1
          while (names.has(`Screen ${n}`)) n++
          const screen = createScreen(n)
          set((s) => ({
            doc: touched({ ...s.doc, hmiScreens: [...s.doc.hmiScreens, screen] }),
            activeScreenId: screen.id,
            dirty: true,
          }))
          return screen.id
        },

        addImportedScreen(screen) {
          set((s) => ({
            doc: touched({ ...s.doc, hmiScreens: [...s.doc.hmiScreens, screen] }),
            activeScreenId: screen.id,
            dirty: true,
          }))
        },

        addImportedScreens(screens) {
          if (screens.length === 0) return
          set((s) => {
            const incomingHome = screens.some((sc) => sc.home)
            const existing = incomingHome
              ? s.doc.hmiScreens.map((sc) => {
                  const { home: _h, ...rest } = sc
                  return rest
                })
              : s.doc.hmiScreens
            return {
              doc: touched({ ...s.doc, hmiScreens: [...existing, ...screens] }),
              activeScreenId: screens[0]!.id,
              dirty: true,
            }
          })
        },

        replaceScreen(screen) {
          set((s) => ({
            doc: touched({ ...s.doc, hmiScreens: s.doc.hmiScreens.map((sc) => (sc.id === screen.id ? screen : sc)) }),
            dirty: true,
          }))
        },

        renameScreen(id, name) {
          set((s) => {
            const taken = new Set(s.doc.hmiScreens.filter((sc) => sc.id !== id).map((sc) => sc.name))
            let unique = name
            let i = 2
            while (taken.has(unique)) unique = `${name} ${i++}`
            return {
              doc: touched({ ...s.doc, hmiScreens: s.doc.hmiScreens.map((sc) => (sc.id === id ? { ...sc, name: unique } : sc)) }),
              dirty: true,
            }
          })
        },

        setHomeScreen(id, on) {
          set((s) => ({
            doc: touched({
              ...s.doc,
              hmiScreens: s.doc.hmiScreens.map((sc) => {
                const { home: _h, ...rest } = sc
                return sc.id === id && on ? { ...rest, home: true } : rest
              }),
            }),
            dirty: true,
          }))
        },

        reorderScreens(id, toIndex) {
          set((s) => {
            const list = [...s.doc.hmiScreens]
            const from = list.findIndex((sc) => sc.id === id)
            if (from < 0) return s
            const [moved] = list.splice(from, 1)
            list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, moved!)
            return { doc: touched({ ...s.doc, hmiScreens: list }), dirty: true }
          })
        },

        duplicateScreen(id) {
          const src = get().doc.hmiScreens.find((sc) => sc.id === id)
          if (!src) return ''
          const clone = structuredClone(src)
          clone.id = ulid()
          delete clone.home       // only one home screen
          delete clone.fromSheetId // a copy is hand-owned; re-import must not clobber it
          const pipeMap = new Map<string, string>()
          clone.pipes = clone.pipes.map((pp) => {
            const nid = ulid()
            pipeMap.set(pp.id, nid)
            return { ...pp, id: nid }
          })
          clone.widgets = clone.widgets.map((w) => {
            const nw = { ...w, id: ulid() }
            if (typeof nw.props?.bindPipe === 'string') {
              const mapped = pipeMap.get(nw.props.bindPipe)
              nw.props = { ...nw.props }
              if (mapped) nw.props.bindPipe = mapped
              else delete nw.props.bindPipe
            }
            return nw
          })
          const taken = new Set(get().doc.hmiScreens.map((sc) => sc.name))
          let name = `${src.name} copy`
          let i = 2
          while (taken.has(name)) name = `${src.name} copy ${i++}`
          clone.name = name
          set((s) => ({
            doc: touched({ ...s.doc, hmiScreens: [...s.doc.hmiScreens, clone] }),
            activeScreenId: clone.id,
            dirty: true,
          }))
          return clone.id
        },

        deleteScreen(id) {
          set((s) => {
            const rest = s.doc.hmiScreens.filter((sc) => sc.id !== id)
            return {
              doc: touched({ ...s.doc, hmiScreens: rest }),
              activeScreenId: s.activeScreenId === id ? (rest[0]?.id ?? null) : s.activeScreenId,
              dirty: true,
            }
          })
        },

        setScreenTheme(id, theme) {
          set((s) => ({
            doc: touched({ ...s.doc, hmiScreens: s.doc.hmiScreens.map((sc) => (sc.id === id ? { ...sc, theme } : sc)) }),
            dirty: true,
          }))
        },

        addWidget(partial) {
          const id = ulid()
          patchScreen((sc) => ({ ...sc, widgets: [...sc.widgets, { ...partial, id }] }))
          return id
        },

        addWidgets(partials) {
          const ids = partials.map(() => ulid())
          patchScreen((sc) => ({ ...sc, widgets: [...sc.widgets, ...partials.map((p, i) => ({ ...p, id: ids[i]! }))] }))
          return ids
        },

        updateWidget(id, patch) {
          patchScreen((sc) => ({ ...sc, widgets: sc.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) }))
        },

        updateWidgets(entries) {
          const byId = new Map(entries.map((e) => [e.id, e.patch]))
          patchScreen((sc) => ({
            ...sc,
            widgets: sc.widgets.map((w) => (byId.has(w.id) ? { ...w, ...byId.get(w.id) } : w)),
          }))
        },

        reorderWidgets(ids, to) {
          const idSet = new Set(ids)
          patchScreen((sc) => {
            const picked = sc.widgets.filter((w) => idSet.has(w.id))
            const rest = sc.widgets.filter((w) => !idSet.has(w.id))
            return { ...sc, widgets: to === 'front' ? [...rest, ...picked] : [...picked, ...rest] }
          })
        },

        moveWidgets(ids, dx, dy) {
          // selection ids may mix widgets and pipes; both translate together
          const idSet = new Set(ids)
          patchScreen((sc) => ({
            ...sc,
            widgets: sc.widgets.map((w) => (idSet.has(w.id) ? { ...w, x: w.x + dx, y: w.y + dy } : w)),
            pipes: sc.pipes.map((p) =>
              idSet.has(p.id) ? { ...p, points: p.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : p,
            ),
          }))
        },

        addHmiPipe(partial) {
          const id = ulid()
          patchScreen((sc) => ({ ...sc, pipes: [...sc.pipes, { ...partial, id }] }))
          return id
        },

        updateHmiPipe(id, patch) {
          patchScreen((sc) => ({ ...sc, pipes: sc.pipes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
        },

        addHmiBatch(widgets, pipes) {
          const widgetIds = widgets.map(() => ulid())
          const pipeIds = pipes.map(() => ulid())
          patchScreen((sc) => ({
            ...sc,
            widgets: [...sc.widgets, ...widgets.map((w, i) => ({ ...w, id: widgetIds[i]! }))],
            pipes: [...sc.pipes, ...pipes.map((p, i) => ({ ...p, id: pipeIds[i]! }))],
          }))
          return { widgetIds, pipeIds }
        },

        deleteHmiIds(ids) {
          const idSet = new Set(ids)
          patchScreen((sc) => ({
            ...sc,
            widgets: sc.widgets.filter((w) => !idSet.has(w.id)),
            pipes: sc.pipes.filter((p) => !idSet.has(p.id)),
          }))
        },

        markSaved() {
          set({ dirty: false })
        },

        undo() {
          const before = get().doc
          useStore.temporal.getState().resume()
          useStore.temporal.getState().undo()
          carryRevisionsAcross(before, set, get)
        },

        redo() {
          const before = get().doc
          useStore.temporal.getState().resume()
          useStore.temporal.getState().redo()
          carryRevisionsAcross(before, set, get)
        },
      }
    },
    {
      partialize: (state) => ({ doc: state.doc }),
      limit: 200,
      equality: (past, current) => past.doc === current.doc,
    },
  ),
)

/**
 * Undo grouping for continuous edits (typing, label dragging): the first
 * change records normally, then history pauses until resumeHistory() — so
 * one Ctrl+Z reverts the whole burst. resumeHistory is safe to over-call;
 * the global pointerup listener calls it as a safety net.
 */
export function pauseHistory(): void {
  useStore.temporal.getState().pause()
}

export function resumeHistory(): void {
  useStore.temporal.getState().resume()
}
