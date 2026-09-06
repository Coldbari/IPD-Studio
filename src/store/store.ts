// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'
import { temporal } from 'zundo'
import { ulid } from 'ulid'
import type { BudgetSettings, CustomSymbolDef, Fluid, PlantEdge, PlantNode, ProjectDoc, Sheet, Tag } from '../model/types'
import type { StandardProfile } from '../model/standard'
import { propagateFluid } from '../model/fluidFlow'
import type { EngineeringRecord, EntityKind, RecordStatus } from '../model/registry'
import { keyOfEdge, keyOfNode, liveKeys, retagRegistry } from '../model/registry'
import { registerCustomSymbols } from '../symbols/custom'
import { isPortEnd } from '../model/types'
import { createEmptyDoc, createSheet } from '../model/doc'
import type { HmiPipe, HmiScreen, HmiTheme, HmiWidget } from '../hmi/model'
import { createScreen } from '../hmi/model'

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
         * See retagRegistry for the move / copy / collide rules.
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
            // Another symbol may still wear the old tag (a valve shown twice,
            // an off-page continuation) — then the record is copied, not moved.
            const stillUsed = oldKey !== null && liveKeys(sheets).has(oldKey)
            const r = retagRegistry(s.doc.registry, oldKey, newKey, { oldKeyStillUsed: stillUsed })
            collision = r.collision
            return { doc: touched({ ...s.doc, sheets, registry: r.registry }), dirty: true }
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
            // A renumbered line carries its record exactly as a renamed tag does.
            const oldKey = keyOfEdge(edge)
            const newKey = keyOfEdge(next)
            const stillUsed = oldKey !== null && liveKeys(sheets).has(oldKey)
            const r = retagRegistry(s.doc.registry, oldKey, newKey, { oldKeyStillUsed: stillUsed })
            collision = r.collision
            return { doc: touched({ ...s.doc, sheets, registry: r.registry }), dirty: true }
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
          useStore.temporal.getState().resume()
          useStore.temporal.getState().undo()
        },

        redo() {
          useStore.temporal.getState().resume()
          useStore.temporal.getState().redo()
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
