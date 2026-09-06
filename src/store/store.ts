// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'
import { temporal } from 'zundo'
import { ulid } from 'ulid'
import type { BudgetSettings, CustomSymbolDef, Fluid, PlantEdge, PlantNode, ProjectDoc, Sheet, Tag } from '../model/types'
import type { EngineeringRecord, EntityKind, RecordStatus } from '../model/registry'
import { keyOfEdge, keyOfNode, liveKeys, retagRegistry } from '../model/registry'
import { registerCustomSymbols } from '../symbols/custom'
import { isJunctionEnd, isPortEnd } from '../model/types'
import { createEmptyDoc, createSheet } from '../model/doc'
import type { HmiPipe, HmiScreen, HmiTheme, HmiWidget } from '../hmi/model'
import { createScreen } from '../hmi/model'
import { getSymbol } from '../symbols/registry'
import { portWorld } from '../canvas/alignment'
import { isProcessClass } from '../canvas/lineStyle'
import { compatibleKinds } from '../canvas/connectionRules'
import { type Direction, portDirection, rotateDir } from '../canvas/shapes'
import { formatTag, parseTag } from '../isa/tag'
import { normalizeDanglingJunctions } from '../model/junctions'
import { orthogonalizeVertices } from '../model/orthogonal'

export interface StoreState {
  doc: ProjectDoc
  /** Changes only when a whole document is loaded, so canvases rebuild even
   * when the incoming first sheet happens to reuse the current sheet id. */
  documentEpoch: number
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
  /** Add a symbol and replace one free point end on an existing line in one undo step. */
  attachNodeToFreeEnd(node: PlantNode, edgeId: string, end: 'source' | 'target', portId: string): void
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
  setTag(id: string, tag: Tag | undefined): void
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
  /** Duplicate a drawing sheet with fresh object IDs and remapped connections. */
  duplicateSheet(id: string, name?: string): { sheetId: string; nodeIdMap: Record<string, string>; edgeIdMap: Record<string, string> } | null
  renameSheet(id: string, name: string): void
  deleteSheet(id: string): void
  setActiveSheet(id: string): void
  addEdge(partial: Omit<PlantEdge, 'id'>): string
  setEdge(id: string, patch: Partial<Omit<PlantEdge, 'id'>>, options?: { preserveOtherEdges?: boolean }): void
  /** Toggle the flow marker on one persisted line section. */
  cycleEdgeArrow(id: string): void
  /** Reverse source/target direction for one persisted line section. */
  reverseEdgeDirection(id: string): void
  setEdgeVertices(id: string, vertices: { x: number; y: number }[]): void
  /** Assign a service to a line; auto-spreads along the connected run
   *  (through valves/pumps/fittings, stopping at vessels). One undo step. */
  setEdgeFluid(id: string, fluidId: string | undefined): void
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

const canonicalTag = (value: string | undefined): string | null => {
  if (!value?.trim()) return null
  const parsed = parseTag(value)
  // "X01", "X-01" and "X-1" all name the same object — normalize the loop
  // number so a pending tag typed with leading zeros still finds the device
  // the user tags as X-1.
  return parsed ? formatTag({ ...parsed, loop: String(Number(parsed.loop)) }) : value.trim().toUpperCase()
}

const DIR_VECTOR: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
}

/**
 * Resolve explicit free-end targets after either side of the workflow changes:
 * the user drew a line to empty space, gave the free end the tag of a device
 * that is not on the sheet yet, and that device has now appeared (or been
 * tagged or labelled). The free end becomes the device port the pipe should
 * arrive at — preferably one whose nozzle faces back along the line, so the
 * pipe lands head-on on the right side of the device (a pump's discharge
 * toward the vessel it feeds, not its suction) — otherwise the nearest free,
 * compatible port.
 */
function resolvePendingConnections(sheet: Sheet): Sheet {
  const nodes = sheet.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let edges = sheet.edges
  const occupied = new Set<string>()
  for (const edge of edges) {
    for (const end of [edge.source, edge.target]) {
      if (isPortEnd(end)) occupied.add(`${end.nodeId}/${end.portId}`)
    }
  }
  for (const node of nodes) {
    const tag = canonicalTag(node.tag ? formatTag(node.tag) : node.label)
    if (!tag) continue
    let ports: { id: string; kind: 'process' | 'signal' | 'both' }[]
    try {
      const def = getSymbol(node.symbolId)
      ports = [...def.ports, ...(node.extraPorts ?? [])].map((p) => ({ id: p.id, kind: p.kind }))
    } catch {
      continue
    }
    for (const edge of edges) {
      for (const end of ['source', 'target'] as const) {
        const point = edge[end]
        if (isPortEnd(point) || canonicalTag(point.pendingTag) !== tag) continue
        // Where the pipe comes from: the far end of the line. A port on the
        // device "faces" it when the pipe can leave the nozzle straight
        // toward the far end instead of having to wrap around the device.
        const other = edge[end === 'source' ? 'target' : 'source']
        const farAt: { x: number; y: number } | null = isPortEnd(other)
          ? (() => {
              const far = byId.get(other.nodeId)
              return far ? portWorld(far, other.portId) : null
            })()
          : other
        const candidates = ports
          .filter((p) => !occupied.has(`${node.id}/${p.id}`))
          .filter((p) => compatibleKinds(p.kind, isProcessClass(edge.lineClass) ? 'process' : 'signal'))
          .map((p) => ({ p, at: portWorld(node, p.id) }))
          .filter((v): v is { p: (typeof ports)[number]; at: { x: number; y: number } } => v.at !== null)
          .map(({ p, at }) => {
            const dir = portDirection(node.symbolId, p.id)
            const facing = Boolean(dir && farAt && (() => {
              const v = DIR_VECTOR[rotateDir(dir, node.rotation)]
              return v.x * (farAt.x - at.x) + v.y * (farAt.y - at.y) > 0
            })())
            return { p, at, facing }
          })
          .sort((a, b) =>
            Number(b.facing) - Number(a.facing) ||
            Math.hypot(a.at.x - point.x, a.at.y - point.y) - Math.hypot(b.at.x - point.x, b.at.y - point.y),
          )
        const chosen = candidates[0]
        if (!chosen) continue
        edges = edges.map((current) => current.id === edge.id
          ? { ...current, [end]: { nodeId: node.id, portId: chosen.p.id } }
          : current)
        occupied.add(`${node.id}/${chosen.p.id}`)
      }
    }
  }
  return edges === sheet.edges ? sheet : { ...sheet, edges }
}

const initialDoc = createEmptyDoc()

/** Keep persisted routes orthogonal even when they came from an older file or
 * from a direct store/API edit rather than the canvas tools. */
function orthogonalEdge(edge: PlantEdge, nodes: PlantNode[]): PlantEdge {
  const pointOf = (end: PlantEdge['source']): { x: number; y: number } | null => {
    if (!isPortEnd(end)) return { x: end.x, y: end.y }
    const node = nodes.find((candidate) => candidate.id === end.nodeId)
    if (!node) return null
    try {
      return portWorld(node, end.portId)
    } catch {
      return null
    }
  }
  const vertices = orthogonalizeVertices(edge.vertices, pointOf(edge.source), pointOf(edge.target))
  if (JSON.stringify(vertices) === JSON.stringify(edge.vertices)) return edge
  return vertices?.length ? { ...edge, vertices } : (() => {
    const { vertices: _vertices, ...rest } = edge
    return rest
  })()
}

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

      /** A fixed auto-layout route is valid only for its current endpoint
       * geometry. Once one attached symbol changes geometry, let the normal
       * obstacle router compute that edge again. */
      const invalidateRoutes = (sheet: Sheet, nodeIds: Set<string>): PlantEdge[] => sheet.edges.map((edge) => {
        const touches = [edge.source, edge.target].some((end) => isPortEnd(end) && nodeIds.has(end.nodeId))
        if (!touches || edge.routing !== 'fixed') return edge
        const { routing: _routing, vertices: _vertices, ...rest } = edge
        return rest
      })

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
        documentEpoch: 0,
        activeSheetId: initialDoc.sheets[0]!.id,
        activeScreenId: null,
        selection: [],
        armPin: null,
        dirty: false,
        cloudId: null,
        activeLineClass: 'process.major',

        addNode(partial) {
          const id = ulid()
          patchSheet((sh) => resolvePendingConnections({ ...sh, nodes: [...sh.nodes, { ...partial, id }] }))
          return id
        },

        setNodePos(id, x, y) {
          // Moving a symbol must not re-plan the lines attached to it: their
          // waypoints are the user's routing decisions and simply stretch
          // with the moved endpoint.
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
          }))
        },

        moveNodes(ids, dx, dy) {
          const idSet = new Set(ids)
          const shift = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy })
          patchSheet((sh) => {
            // Edges joined by a line junction form one routed group. It moves
            // rigidly only when every real device endpoint in that group moves.
            const byJunction = new Map<string, PlantEdge[]>()
            for (const edge of sh.edges) {
              for (const end of [edge.source, edge.target]) {
                if (!isJunctionEnd(end)) continue
                byJunction.set(end.junctionId, [...(byJunction.get(end.junctionId) ?? []), edge])
              }
            }
            const rigid = new Set<string>()
            const seen = new Set<string>()
            for (const seed of sh.edges) {
              if (seen.has(seed.id)) continue
              const group: PlantEdge[] = []
              const queue = [seed]
              while (queue.length) {
                const edge = queue.pop()!
                if (seen.has(edge.id)) continue
                seen.add(edge.id)
                group.push(edge)
                for (const end of [edge.source, edge.target]) {
                  if (isJunctionEnd(end)) queue.push(...(byJunction.get(end.junctionId) ?? []))
                }
              }
              const ports = group.flatMap((edge) => [edge.source, edge.target]).filter(isPortEnd)
              if (ports.length && ports.every((end) => idSet.has(end.nodeId))) {
                group.forEach((edge) => rigid.add(edge.id))
              }
            }
            return {
              ...sh,
              nodes: sh.nodes.map((n) => (idSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
              edges: sh.edges.map((e) => {
                if (rigid.has(e.id)) return {
                  ...e,
                  ...(e.vertices ? { vertices: e.vertices.map(shift) } : {}),
                  ...(isPortEnd(e.source) ? {} : { source: shift(e.source) }),
                  ...(isPortEnd(e.target) ? {} : { target: shift(e.target) }),
                }
                // A line with only one moving end stretches: its waypoints
                // stay put instead of being wiped and re-planned.
                return e
              }),
            }
          })
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

        attachNodeToFreeEnd(node, edgeId, end, portId) {
          patchSheet((sh) => {
            const edge = sh.edges.find((e) => e.id === edgeId)
            if (!edge || isPortEnd(edge[end])) return sh
            return {
              ...sh,
              nodes: [...sh.nodes, node],
              edges: sh.edges.map((e) =>
                e.id === edgeId ? { ...e, [end]: { nodeId: node.id, portId } } : e,
              ),
            }
          })
          set({ selection: [node.id] })
        },

        rotateNode(id) {
          patchSheet((sh) => ({
            ...sh,
            nodes: sh.nodes.map((n) =>
              n.id === id ? { ...n, rotation: (((n.rotation + 90) % 360) as 0 | 90 | 180 | 270) } : n,
            ),
            edges: invalidateRoutes(sh, new Set([id])),
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
            edges: invalidateRoutes(sh, new Set([id])),
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
            edges: invalidateRoutes(sh, new Set([id])),
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
          set((s) => {
            const sheet = activeSheet(s)
            const node = sheet.nodes.find((n) => n.id === id)
            if (!node) return s
            const oldKey = keyOfNode(node)
            const newKey = keyOfNode({ ...node, tag })
            const sheets = s.doc.sheets.map((sh) => {
              if (sh.id !== sheet.id) return sh
              const updated = { ...sh, nodes: sh.nodes.map((n) => (n.id === id ? { ...n, tag } : n)) }
              return resolvePendingConnections(updated)
            })
            // Another symbol may still wear the old tag (a valve shown twice,
            // an off-page continuation) — then the record is copied, not moved.
            const stillUsed = oldKey !== null && liveKeys(sheets).has(oldKey)
            const { registry } = retagRegistry(s.doc.registry, oldKey, newKey, { oldKeyStillUsed: stillUsed })
            return { doc: touched({ ...s.doc, sheets, registry }), dirty: true }
          })
        },

        setLabel(id, label) {
          patchSheet((sh) =>
            resolvePendingConnections({ ...sh, nodes: sh.nodes.map((n) => (n.id === id ? { ...n, label } : n)) }),
          )
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
          patchSheet((sh) => {
            const withNodes = { ...sh, nodes: [...sh.nodes, ...nodes] }
            // Normalize only the incoming edges. Running the legacy-route
            // repair over the whole sheet here would insert bends into
            // unrelated lines on every branch commit.
            const added = edges
              .map((edge) => ({ ...edge, lineGroupId: edge.id }))
              .map((edge) => orthogonalEdge(edge, withNodes.nodes))
            return resolvePendingConnections({
              ...withNodes,
              edges: [...sh.edges.filter((e) => !drop.has(e.id)), ...added],
            })
          })
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

        duplicateSheet(id, name) {
          const source = get().doc.sheets.find((sh) => sh.id === id)
          if (!source) return null
          const nodeIdMap: Record<string, string> = {}
          for (const node of source.nodes) nodeIdMap[node.id] = ulid()
          const edgeIdMap: Record<string, string> = {}
          for (const edge of source.edges) edgeIdMap[edge.id] = ulid()
          const clone: Sheet = structuredClone(source)
          clone.id = ulid()
          clone.name = name?.trim() || `${source.name} - 方案副本`
          clone.nodes = clone.nodes.map((node) => ({ ...node, id: nodeIdMap[node.id]! }))
          clone.edges = clone.edges.map((edge) => ({
            ...edge,
            id: edgeIdMap[edge.id]!,
            lineGroupId: edgeIdMap[edge.id]!,
            source: isPortEnd(edge.source) ? { ...edge.source, nodeId: nodeIdMap[edge.source.nodeId] ?? edge.source.nodeId } : edge.source,
            target: isPortEnd(edge.target) ? { ...edge.target, nodeId: nodeIdMap[edge.target.nodeId] ?? edge.target.nodeId } : edge.target,
          }))
          set((s) => ({
            doc: touched({ ...s.doc, sheets: [...s.doc.sheets, clone] }),
            activeSheetId: clone.id,
            selection: [],
            dirty: true,
          }))
          return { sheetId: clone.id, nodeIdMap, edgeIdMap }
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
          patchSheet((sh) => {
            const edge = { ...partial, id, lineGroupId: id }
            const normalized = orthogonalEdge(edge, sh.nodes)
            return { ...sh, edges: [...sh.edges, normalized] }
          })
          return id
        },

        setEdge(id, patch, options) {
          set((s) => {
            const sheet = activeSheet(s)
            const edge = sheet.edges.find((e) => e.id === id)
            if (!edge) return s
            const geometryChanged = patch.source !== undefined || patch.target !== undefined || patch.vertices !== undefined
            // Every persisted segment is an independent drawing object.
            // Junctions provide connectivity only; edits never fan out to a
            // neighboring section that happens to share a lineGroupId.
            // A geometry edit adjusts THIS line only. Its waypoints (and the
            // fixed router that renders them exactly) survive: dropping them
            // here would let the auto-router re-plan the line on every bend
            // or endpoint drag, and re-normalizing the whole sheet would
            // insert bends into lines the user never touched.
            const next = { ...edge, ...patch }
            const sheets = s.doc.sheets.map((sh) => {
              if (sh.id !== sheet.id) return sh
              const updated = {
                ...sh,
                edges: sh.edges.map((e) => {
                  return e.id === id ? next : e
                }),
              }
              const verticesOnly = patch.vertices !== undefined &&
                patch.source === undefined && patch.target === undefined
              // Vertex/segment tools already produce a cleaned route on
              // gesture end; endpoint moves must not rewrite this line's
              // bends either. The routers render stored routes orthogonally,
              // so no edit ever needs to insert new waypoints into the doc.
              if (verticesOnly || options?.preserveOtherEdges) return updated
              const resolved = geometryChanged ? resolvePendingConnections(updated) : updated
              if (!geometryChanged) return resolved
              // Junction bookkeeping only — never this line's geometry.
              return normalizeDanglingJunctions(resolved)
            })
            // A renumbered line carries its record exactly as a renamed tag does.
            const oldKey = keyOfEdge(edge)
            const newKey = keyOfEdge(next)
            const stillUsed = oldKey !== null && liveKeys(sheets).has(oldKey)
            const { registry } = retagRegistry(s.doc.registry, oldKey, newKey, { oldKeyStillUsed: stillUsed })
            return { doc: touched({ ...s.doc, sheets, registry }), dirty: true }
          })
        },

        cycleEdgeArrow(id) {
          const state = get()
          const sheet = activeSheet(state)
          const on = sheet.edges.find((edge) => edge.id === id)?.arrow === 'flow'
          state.setEdge(id, { arrow: on ? 'none' : 'flow' })
        },

        reverseEdgeDirection(id) {
          const state = get()
          const sheet = activeSheet(state)
          const edge = sheet.edges.find((candidate) => candidate.id === id)
          if (!edge) return
          state.setEdge(id, {
            source: edge.target,
            target: edge.source,
            ...(edge.vertices ? { vertices: [...edge.vertices].reverse() } : {}),
          })
        },

        setEdgeVertices(id, vertices) {
          get().setEdge(id, { vertices }, { preserveOtherEdges: true })
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
          patchSheet((sh) => ({
            ...sh,
            edges: sh.edges.map((e) => (e.id === id ? { ...e, fluidId } : e)),
          }))
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
          patchSheet((sh) => normalizeDanglingJunctions({
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
          set({ selection: [...new Set(ids)] })
        },

        setActiveLineClass(lineClass) {
          set({ activeLineClass: lineClass })
        },

        pasteNodes(nodes, edges) {
          const idMap = new Map<string, string>()
          const junctionMap = new Map<string, string>()
          const newNodes: PlantNode[] = nodes.map((n) => {
            const id = ulid()
            idMap.set(n.id, id)
            const { tag: _tag, link: _link, ...rest } = n
            return { ...rest, id, x: n.x + 16, y: n.y + 16 }
          })
          const newEdges: PlantEdge[] = []
          const copyEnd = (end: PlantEdge['source'], mappedNode: string) => {
            if (isPortEnd(end)) return { nodeId: mappedNode, portId: end.portId }
            const junctionId = end.junctionId
              ? (junctionMap.get(end.junctionId) ?? (() => {
                  const id = ulid()
                  junctionMap.set(end.junctionId!, id)
                  return id
                })())
              : undefined
            return { ...end, x: end.x + 16, y: end.y + 16, ...(junctionId ? { junctionId } : {}) }
          }
          for (const e of edges) {
            const src = isPortEnd(e.source) ? idMap.get(e.source.nodeId) : 'free'
            const tgt = isPortEnd(e.target) ? idMap.get(e.target.nodeId) : 'free'
            if (!src || !tgt) continue
            newEdges.push({
              ...e,
              id: ulid(),
              source: copyEnd(e.source, src),
              target: copyEnd(e.target, tgt),
              vertices: e.vertices?.map((v) => ({ x: v.x + 16, y: v.y + 16 })),
            })
          }
          patchSheet((sh) => {
            const withNodes = { ...sh, nodes: [...sh.nodes, ...newNodes] }
            const normalized = newEdges.map((edge) => orthogonalEdge(edge, withNodes.nodes))
            return { ...withNodes, edges: [...sh.edges, ...normalized] }
          })
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
          // Loaded geometry must round-trip EXACTLY. Re-normalizing routes
          // here used to insert corners into saved vertex lists, so points
          // the user had deleted came back on every reopen. The canvas
          // routers already render any stored route orthogonally — the
          // document itself needs no geometry rewrite.
          const prepared: ProjectDoc = {
            ...doc,
            sheets: doc.sheets.map((sheet) => ({
              ...sheet,
              edges: sheet.edges.map((edge) => ({ ...edge, lineGroupId: edge.id })),
            })),
          }
          registerCustomSymbols(prepared)
          // Whatever we just loaded is not the cloud drawing we had open, so
          // drop the link — otherwise the next cloud save silently overwrites
          // a different drawing. loadFromCloud re-establishes it afterwards.
          set((s) => ({
            doc: prepared,
            documentEpoch: s.documentEpoch + 1,
            activeSheetId: prepared.sheets[0]!.id,
            activeScreenId: prepared.hmiScreens[0]?.id ?? null,
            selection: [],
            dirty: false,
            cloudId: null,
          }))
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
