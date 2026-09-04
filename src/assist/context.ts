// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { LineClass, LineNumber, NodeKind, PlantEdge, ProjectDoc } from '../model/types'
import { isPortEnd } from '../model/types'
import type { EntityKind, RecordStatus } from '../model/registry'
import { fieldValue } from '../model/registry'
import { fieldKeysFor } from '../model/fields'
import type { ProjectIndex } from '../model/projectIndex'
import { edgesOf, neighboursOf, signalReach } from '../model/projectIndex'
import { propagateFluid } from '../model/fluidFlow'
import { qaFor } from '../validate/engine'
import type { Severity } from '../validate/rules'
import { classifyMember, type MemberRole } from '../export/loopDiagram'
import { expandLetters, formatTag, validateLetters } from '../isa/tag'
import { isProcessClass } from '../canvas/lineStyle'
import { SYMBOLS } from '../symbols/registry'
import type { PortKind } from '../symbols/types'

/** A pointer to a real object. Every reference the assistant makes is one of
 *  these, so it can always be rendered as a chip and jumped to. */
export interface BriefRef {
  id: string
  sheetId: string
  ref: string
}

export interface FocusPort {
  id: string
  kind: PortKind
  connected: boolean
  edgeIds: string[]
}

export interface FocusTag {
  text: string
  letters: string
  loop: string
  suffix?: string
  /** From the ISA letter tables — the app's own expansion, not the model's memory. */
  expanded: string
  valid: boolean
  reason?: string
}

export interface FocusRecord {
  key: string
  kind: EntityKind
  status?: RecordStatus
  owner?: string
  filled: number
  total: number
  fields: Record<string, string>
}

export interface FocusNode {
  objectType: 'node'
  id: string
  sheetId: string
  ref: string
  kind: NodeKind
  symbol: { id: string; name: string; category: string }
  tag?: FocusTag
  label?: string
  /** What the node actually stores. Reported separately from `defaultConfig`
   *  so nothing is fabricated: the rules read `node.config?.x` too, and a
   *  brief that silently merged defaults would disagree with them. */
  config?: Record<string, string>
  defaultConfig?: Record<string, string>
  /** The closed set of legal values per config key, so a proposal cannot
   *  invent one. Empty when the symbol declares no options. */
  configOptions: Record<string, string[]>
  ports: FocusPort[]
  neighbours: { process: BriefRef[]; signal: BriefRef[] }
  record?: FocusRecord
}

export interface FocusEdge {
  objectType: 'edge'
  id: string
  sheetId: string
  ref: string
  lineClass: LineClass
  arrow: 'none' | 'flow'
  lineNumber?: LineNumber
  fluid?: { id: string; name: string; color: string }
  from?: BriefRef
  to?: BriefRef
  danglingEnds: number
  /** The connected process run, and how much of it declares a direction.
   *  `arrowsMarked < arrowsTotal` means "downstream" is not knowable. */
  run: { edgeIds: string[]; arrowsMarked: number; arrowsTotal: number }
  record?: FocusRecord
}

export type Focus = FocusNode | FocusEdge

export interface BriefLoop {
  family: string
  loop: string
  ref: string
  byTag: string[]
  members: BriefRef[]
  roles: Record<MemberRole, string[]>
  hint?: string
  sheets: string[]
}

export interface BriefFinding {
  key: string
  ruleId: string
  severity: Severity
  message: string
  targetId?: string
  sheetId?: string
  hasFix: boolean
}

export type SelectionKind = 'empty' | 'node' | 'edge' | 'few' | 'many' | 'mixed'

export interface SelectionBrief {
  project: {
    name: string
    activeSheet: { id: string; name: string }
    sheetCount: number
  }
  selection: { kind: SelectionKind; count: number; ids: string[] }
  focus?: Focus
  /** Shallow refs for a small multi-selection. */
  others: BriefRef[]
  loop?: BriefLoop
  findings: BriefFinding[]
  aggregate?: { count: number; byKind: Record<string, number>; loops: string[]; findings: number }
  budget: { truncated: boolean }
}

/** Detail beyond this many objects stops being a subject and becomes a scope. */
const DETAIL_LIMIT = 8

/** The ISA signal chain depth. 3 is the number `no-final-element` already uses
 *  (src/validate/rules/instrumentation.ts), so the assistant and the rules
 *  cannot disagree about what is wired to what. */
const SIGNAL_HOPS = 3

const EMPTY_ROLES = (): Record<MemberRole, string[]> => ({
  element: [], transmitter: [], controller: [], final: [],
  switch: [], relay: [], indicator: [], other: [],
})

/** Tag, else line number, else label, else symbol name, else the raw id. */
export function refOf(ix: ProjectIndex, id: string): string {
  const n = ix.nodes.get(id)
  if (n) {
    if (n.node.tag?.letters && n.node.tag.loop) return formatTag(n.node.tag, '-')
    if (n.node.label) return n.node.label
    return SYMBOLS.get(n.node.symbolId)?.name ?? n.node.symbolId
  }
  const e = ix.edges.get(id)
  if (e) return e.key ?? e.edge.lineClass
  return id
}

function briefRef(ix: ProjectIndex, id: string): BriefRef | undefined {
  const sheetId = ix.nodes.get(id)?.sheet.id ?? ix.edges.get(id)?.sheet.id
  if (!sheetId) return undefined
  return { id, sheetId, ref: refOf(ix, id) }
}

function recordFor(ix: ProjectIndex, key: string | null, kind: EntityKind | null): FocusRecord | undefined {
  if (!key || !kind) return undefined
  const rec = ix.records[key]
  const keys = fieldKeysFor(kind)
  const node = ix.nodesByKey.get(key)?.[0]?.node
  const fields: Record<string, string> = {}
  let filled = 0
  for (const k of keys) {
    // fieldValue honours the pre-v5 node.datasheet fallback, so an old drawing
    // does not read as blank here while the inspector shows it filled.
    const v = node ? fieldValue(ix.records, node, k) : (rec?.fields[k] ?? '')
    if (v) { fields[k] = v; filled++ }
  }
  if (!rec && filled === 0) return undefined
  return {
    key,
    kind,
    ...(rec?.status ? { status: rec.status } : {}),
    ...(rec?.owner ? { owner: rec.owner } : {}),
    filled,
    total: keys.length,
    fields,
  }
}

function focusNode(ix: ProjectIndex, id: string): FocusNode | undefined {
  const entry = ix.nodes.get(id)
  if (!entry) return undefined
  const { node, sheet } = entry
  const def = SYMBOLS.get(node.symbolId)
  const touching = edgesOf(ix, id)

  const ports: FocusPort[] = entry.ports.map((p) => {
    const edgeIds = touching
      .filter((e) => [e.source, e.target].some((end) => isPortEnd(end) && end.nodeId === id && end.portId === p.id))
      .map((e) => e.id)
    return { id: p.id, kind: p.kind, connected: edgeIds.length > 0, edgeIds }
  })

  const processNeighbours: BriefRef[] = []
  for (const other of neighboursOf(ix, id)) {
    const shared = touching.some(
      (e) => isProcessClass(e.lineClass) && [e.source, e.target].some((end) => isPortEnd(end) && end.nodeId === other),
    )
    const r = briefRef(ix, other)
    if (shared && r) processNeighbours.push(r)
  }

  const signalNeighbours: BriefRef[] = []
  for (const reached of signalReach(ix, id, SIGNAL_HOPS)) {
    const r = briefRef(ix, reached)
    if (r) signalNeighbours.push(r)
  }

  // The closed set the property panel already drives its selects from
  // (src/panels/PropertyPanel.tsx:119). Handing it over is what lets a later
  // proposal say fail: "fc" and never fail: "fail-shut".
  const configOptions: Record<string, string[]> = def?.configOptions ?? {}

  const tag: FocusTag | undefined = node.tag?.letters && node.tag.loop
    ? (() => {
        const v = validateLetters(node.tag!.letters)
        return {
          text: formatTag(node.tag!, '-'),
          letters: node.tag!.letters,
          loop: node.tag!.loop,
          ...(node.tag!.suffix ? { suffix: node.tag!.suffix } : {}),
          expanded: expandLetters(node.tag!.letters),
          valid: v.ok,
          ...(v.ok ? {} : { reason: v.reason }),
        }
      })()
    : undefined

  return {
    objectType: 'node',
    id,
    sheetId: sheet.id,
    ref: refOf(ix, id),
    kind: node.kind,
    symbol: { id: node.symbolId, name: def?.name ?? node.symbolId, category: def?.category ?? 'unknown' },
    ...(tag ? { tag } : {}),
    ...(node.label ? { label: node.label } : {}),
    ...(node.config ? { config: node.config } : {}),
    ...(def?.defaultConfig ? { defaultConfig: def.defaultConfig } : {}),
    configOptions,
    ports,
    neighbours: { process: processNeighbours, signal: signalNeighbours },
    ...(recordFor(ix, entry.key, entry.kind) ? { record: recordFor(ix, entry.key, entry.kind) } : {}),
  }
}

function endRef(ix: ProjectIndex, end: PlantEdge['source']): BriefRef | undefined {
  return isPortEnd(end) ? briefRef(ix, end.nodeId) : undefined
}

function focusEdge(ix: ProjectIndex, id: string): FocusEdge | undefined {
  const entry = ix.edges.get(id)
  if (!entry) return undefined
  const { edge, sheet } = entry
  const runIds = isProcessClass(edge.lineClass)
    ? propagateFluid({ nodes: sheet.nodes, edges: sheet.edges }, id)
    : [id]
  const runEdges = runIds.map((rid) => ix.edges.get(rid)?.edge).filter((e): e is PlantEdge => Boolean(e))
  const fluid = edge.fluidId ? ix.doc.fluids?.find((f) => f.id === edge.fluidId) : undefined

  return {
    objectType: 'edge',
    id,
    sheetId: sheet.id,
    ref: refOf(ix, id),
    lineClass: edge.lineClass,
    arrow: edge.arrow ?? 'none',
    ...(edge.lineNumber ? { lineNumber: edge.lineNumber } : {}),
    ...(fluid ? { fluid: { id: fluid.id, name: fluid.name, color: fluid.color } } : {}),
    ...(endRef(ix, edge.source) ? { from: endRef(ix, edge.source) } : {}),
    ...(endRef(ix, edge.target) ? { to: endRef(ix, edge.target) } : {}),
    danglingEnds: [edge.source, edge.target].filter((e) => !isPortEnd(e)).length,
    run: {
      edgeIds: runIds,
      arrowsMarked: runEdges.filter((e) => e.arrow === 'flow').length,
      arrowsTotal: runEdges.length,
    },
    ...(recordFor(ix, entry.key, 'line') ? { record: recordFor(ix, entry.key, 'line') } : {}),
  }
}

function loopFor(ix: ProjectIndex, nodeId: string): BriefLoop | undefined {
  const node = ix.nodes.get(nodeId)?.node
  if (!node?.tag?.letters || !node.tag.loop) return undefined
  const family = node.tag.letters[0]!
  const found = ix.loops.find((l) => l.family === family && l.loop === node.tag!.loop)
  if (!found) return undefined
  const roles = EMPTY_ROLES()
  const members: BriefRef[] = []
  const sheets = new Set<string>()
  for (const m of found.members) {
    const text = formatTag(m.tag, '-')
    roles[classifyMember(m.tag.letters)].push(text)
    const r = briefRef(ix, m.nodeId)
    if (r) { members.push(r); sheets.add(ix.nodes.get(m.nodeId)?.sheet.name ?? r.sheetId) }
  }
  return {
    family,
    loop: found.loop,
    ref: `${family}-${found.loop}`,
    byTag: members.map((m) => m.ref),
    members,
    roles,
    ...(found.hint ? { hint: found.hint } : {}),
    sheets: [...sheets],
  }
}

let cache: { doc: ProjectDoc; sheetId: string; selection: string[]; value: SelectionBrief } | null = null

/**
 * What the assistant knows about the current selection without asking a
 * question. This is the SUBJECT of the conversation, so it is prepared rather
 * than fetched — a round trip to discover what the user is pointing at is both
 * slow and a place to fail.
 *
 * Depth stops at the immediate process neighbours and three signal hops.
 * Anything past that is a query, not context, so the extra facts arrive as
 * results that can be cited rather than as free prose.
 */
export function selectionBrief(doc: ProjectDoc, activeSheetId: string, selection: string[]): SelectionBrief {
  if (cache && cache.doc === doc && cache.sheetId === activeSheetId && cache.selection === selection) return cache.value

  const report = qaFor(doc)
  const ix = report.index
  const sheet = doc.sheets.find((sh) => sh.id === activeSheetId) ?? doc.sheets[0]!
  const ids = selection.filter((id) => ix.nodes.has(id) || ix.edges.has(id))

  const kind: SelectionKind =
    ids.length === 0 ? 'empty'
      : ids.length > DETAIL_LIMIT ? 'many'
        : ids.length === 1
          ? (ix.nodes.has(ids[0]!) ? 'node' : 'edge')
          : ids.every((id) => ix.nodes.has(id)) || ids.every((id) => ix.edges.has(id)) ? 'few' : 'mixed'

  const first = ids[0]
  const focus = kind === 'many' || !first
    ? undefined
    : ix.nodes.has(first) ? focusNode(ix, first) : focusEdge(ix, first)

  const others = kind === 'many' || ids.length < 2
    ? []
    : ids.slice(1).map((id) => briefRef(ix, id)).filter((r): r is BriefRef => Boolean(r))

  // findings against the selection and its immediate neighbourhood
  const scope = new Set<string>(ids)
  if (focus?.objectType === 'node') {
    for (const r of [...focus.neighbours.process, ...focus.neighbours.signal]) scope.add(r.id)
  }
  const findings: BriefFinding[] = []
  for (const g of report.groups) {
    for (const f of g.findings) {
      if (!f.targetId || !scope.has(f.targetId)) continue
      findings.push({
        key: f.key,
        ruleId: f.ruleId,
        severity: g.rule.severity,
        message: f.message,
        ...(f.targetId ? { targetId: f.targetId } : {}),
        ...(f.sheetId ? { sheetId: f.sheetId } : {}),
        hasFix: Boolean(f.fix),
      })
    }
  }

  const aggregate = kind === 'many' || kind === 'empty'
    ? (() => {
        const pool = kind === 'many' ? ids : [...sheet.nodes.map((n) => n.id), ...sheet.edges.map((e) => e.id)]
        const byKind: Record<string, number> = {}
        const loops = new Set<string>()
        for (const id of pool) {
          const n = ix.nodes.get(id)
          if (n) {
            byKind[n.node.kind] = (byKind[n.node.kind] ?? 0) + 1
            if (n.node.tag?.letters && n.node.tag.loop) loops.add(`${n.node.tag.letters[0]}-${n.node.tag.loop}`)
          } else if (ix.edges.has(id)) byKind.line = (byKind.line ?? 0) + 1
        }
        return { count: pool.length, byKind, loops: [...loops], findings: findings.length }
      })()
    : undefined

  const value: SelectionBrief = {
    project: {
      name: doc.meta.name,
      activeSheet: { id: sheet.id, name: sheet.name },
      sheetCount: doc.sheets.length,
    },
    selection: { kind, count: ids.length, ids },
    ...(focus ? { focus } : {}),
    others,
    ...(focus?.objectType === 'node' && loopFor(ix, focus.id) ? { loop: loopFor(ix, focus.id) } : {}),
    findings,
    ...(aggregate ? { aggregate } : {}),
    budget: { truncated: false },
  }

  cache = { doc, sheetId: activeSheetId, selection, value }
  return value
}

/** Test seam — the cache would otherwise leak between cases. */
export function resetBriefCache(): void {
  cache = null
}
