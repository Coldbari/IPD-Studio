// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { ulid } from 'ulid'
import { SYMBOLS } from '../symbols/registry'
import { validateLetters } from '../isa/tag'
import { buildTypical, TYPICALS } from './typicals'

/** A repair the QA report can apply for the user. Lives here, with the code
 *  that performs it, rather than with the rules that offer it. */
export type FixSpec =
  | { kind: 'insert-ip'; sheetId: string; edgeId: string }
  | { kind: 'purge-record'; key: string }
  | { kind: 'assign-tag'; nodeId: string; sheetId: string; letters: string }
  | { kind: 'delete-duplicate-line'; sheetId: string; edgeId: string }
  // Additions the assistant may PROPOSE. Note what is absent: no coordinates
  // and no ids the proposer authored. The caller names WHAT; the app decides
  // where it goes and what id it gets, so a bad proposal can be wrong but
  // never malformed.
  | { kind: 'place-typical'; typicalId: string; sheetId: string; nearNodeId?: string }
  | { kind: 'place-symbol'; symbolId: string; sheetId: string; letters?: string; nearNodeId?: string }

/** What a fix did. A fix that fails silently cannot be trusted by anything
 *  that reports back to a user — the report, or anything built on it later. */
export interface FixResult {
  ok: boolean
  /** Node/edge ids the fix created or changed, for a follow-up jump. */
  changedIds: string[]
  message?: string
}

/**
 * What a fix WOULD do, without doing it. One description shared by everything
 * that has to ask before acting, so a preview and the action can never drift.
 */
export function describeFix(spec: FixSpec, doc: ProjectDoc): { title: string; blastRadius: string; affectedIds: string[] } {
  switch (spec.kind) {
    case 'insert-ip': {
      const sheet = doc.sheets.find((s) => s.id === spec.sheetId)
      return {
        title: 'Insert an I/P converter',
        blastRadius: `Splits one line on ${sheet?.name ?? 'the sheet'} into two and adds a tagged converter between them.`,
        affectedIds: [spec.edgeId],
      }
    }
    case 'purge-record':
      return {
        title: `Discard the engineering record for ${spec.key}`,
        blastRadius: `Deletes ${Object.keys(doc.registry?.[spec.key]?.fields ?? {}).length} stored field(s). Nothing on any sheet carries this key.`,
        affectedIds: [],
      }
    case 'assign-tag': {
      const sheet = doc.sheets.find((s) => s.id === spec.sheetId)
      return {
        title: `Renumber to the next free ${spec.letters} tag`,
        blastRadius: `Retags one symbol on ${sheet?.name ?? 'the sheet'}. Its engineering record moves with it.`,
        affectedIds: [spec.nodeId],
      }
    }
    case 'place-typical': {
      const def = TYPICALS.find((t) => t.id === spec.typicalId)
      const sheet = doc.sheets.find((s) => s.id === spec.sheetId)
      return {
        title: `Add a ${def?.name.toLowerCase() ?? spec.typicalId}`,
        blastRadius: def
          ? `Adds ${def.members.length} tagged instruments (${def.members.join(' → ')}) already wired together, on ${sheet?.name ?? 'the sheet'}. They share one new loop number. One undo removes all of it.`
          : `Unknown typical "${spec.typicalId}".`,
        affectedIds: [],
      }
    }
    case 'place-symbol': {
      const sheet = doc.sheets.find((s) => s.id === spec.sheetId)
      const name = SYMBOLS.get(spec.symbolId)?.name ?? spec.symbolId
      return {
        title: `Add a ${name}`,
        blastRadius: `Places one ${name} on ${sheet?.name ?? 'the sheet'}${spec.letters ? `, tagged ${spec.letters}-…` : ', untagged'}. Nothing is connected to it — you draw the lines.`,
        affectedIds: [],
      }
    }
    case 'delete-duplicate-line': {
      const sheet = doc.sheets.find((s) => s.id === spec.sheetId)
      const edge = sheet?.edges.find((e) => e.id === spec.edgeId)
      const numbered = edge?.lineNumber
        ? ` It carries line number ${[edge.lineNumber.size, edge.lineNumber.spec, edge.lineNumber.service, edge.lineNumber.seq].filter(Boolean).join('-')}, so check you are deleting the right one.`
        : ''
      return {
        title: 'Delete the doubled line',
        blastRadius: `Removes one of two lines joining the same pair of ports on ${sheet?.name ?? 'the sheet'}. The other stays.${numbered}`,
        affectedIds: [spec.edgeId],
      }
    }
  }
}

import type { PlantEdge, PlantNode, ProjectDoc } from '../model/types'
import { isPortEnd } from '../model/types'
import { portWorld } from '../canvas/alignment'
import { isDuplicateTag, nextLoopNumber } from '../isa/autonumber'
import { useStore } from '../store/store'

const snap8 = (v: number) => Math.round(v / 8) * 8

/**
 * Apply a fix. The single dispatcher — rules describe fixes as data and this is
 * the only place that performs one.
 *
 * insert-ip splits an electric line into controller → I/P converter →
 * (pneumatic) valve, placing and tagging the converter automatically. Every
 * branch is one undo step.
 */
export function applyFix(fix: FixSpec): FixResult {
  if (fix.kind === 'purge-record') {
    const had = Boolean(useStore.getState().doc.registry?.[fix.key])
    useStore.getState().purgeRecord(fix.key)
    return had
      ? { ok: true, changedIds: [] }
      : { ok: false, changedIds: [], message: `No record found for ${fix.key}.` }
  }
  if (fix.kind === 'place-typical' || fix.kind === 'place-symbol') {
    const st = useStore.getState()
    if (st.activeSheetId !== fix.sheetId) st.setActiveSheet(fix.sheetId)
    const now = useStore.getState()
    const sheet = now.doc.sheets.find((sh) => sh.id === fix.sheetId)
    if (!sheet) return { ok: false, changedIds: [], message: 'That sheet is no longer in the drawing.' }

    // Position is computed HERE, never supplied by the proposer: beside the
    // object it relates to, else clear of everything already drawn.
    const anchor = fix.nearNodeId ? sheet.nodes.find((n) => n.id === fix.nearNodeId) : undefined
    const at = anchor
      ? { x: snap8(anchor.x + 160), y: snap8(anchor.y) }
      : { x: snap8(Math.max(160, ...sheet.nodes.map((n) => n.x + 160), 160)), y: 200 }

    if (fix.kind === 'place-typical') {
      if (!TYPICALS.some((t) => t.id === fix.typicalId)) {
        return { ok: false, changedIds: [], message: `There is no typical called "${fix.typicalId}".` }
      }
      const built = buildTypical(fix.typicalId, now.doc, at)
      now.addBatch(built.nodes, built.edges)
      return { ok: true, changedIds: built.nodes.map((n) => n.id) }
    }

    // getSymbol THROWS on an unknown id, and an unknown id reaching addNode
    // white-screens the app on the next validation pass. Check, never assume.
    if (!SYMBOLS.has(fix.symbolId)) {
      return { ok: false, changedIds: [], message: `"${fix.symbolId}" is not a symbol in the catalog.` }
    }
    const def = SYMBOLS.get(fix.symbolId)!
    const letters = fix.letters?.trim().toUpperCase()
    const validLetters = letters && validateLetters(letters).ok ? letters : undefined
    const id = now.addNode({
      symbolId: fix.symbolId,
      kind: def.tagRule === 'valve' ? 'valve' : def.tagRule === 'isa-instrument' ? 'instrument' : 'equipment',
      x: at.x,
      y: at.y,
      rotation: 0,
      ...(def.defaultConfig ? { config: { ...def.defaultConfig } } : {}),
      ...(validLetters ? { tag: { letters: validLetters, loop: nextLoopNumber(now.doc, validLetters) } } : {}),
    })
    return { ok: true, changedIds: [id] }
  }
  if (fix.kind === 'delete-duplicate-line') {
    const st = useStore.getState()
    if (st.activeSheetId !== fix.sheetId) st.setActiveSheet(fix.sheetId)
    const now = useStore.getState()
    const sheet = now.doc.sheets.find((sh) => sh.id === fix.sheetId)
    if (!sheet?.edges.some((e) => e.id === fix.edgeId)) {
      return { ok: false, changedIds: [], message: 'That line is no longer on the drawing.' }
    }
    // deleteIds also drops edges attached to deleted NODES; here the target is
    // the edge itself, so nothing else can come with it.
    now.deleteIds([fix.edgeId])
    return { ok: true, changedIds: [fix.edgeId] }
  }
  if (fix.kind === 'assign-tag') {
    const st = useStore.getState()
    if (st.activeSheetId !== fix.sheetId) st.setActiveSheet(fix.sheetId)
    const now = useStore.getState()
    const exists = now.doc.sheets.some((sh) => sh.nodes.some((n) => n.id === fix.nodeId))
    if (!exists) return { ok: false, changedIds: [], message: 'That symbol is no longer on the drawing.' }
    now.setTag(fix.nodeId, { letters: fix.letters, loop: nextLoopNumber(now.doc, fix.letters) })
    return { ok: true, changedIds: [fix.nodeId] }
  }
  const s = useStore.getState()
  if (s.activeSheetId !== fix.sheetId) s.setActiveSheet(fix.sheetId)
  const state = useStore.getState()
  const sheet = state.doc.sheets.find((sh) => sh.id === fix.sheetId)
  const edge = sheet?.edges.find((e) => e.id === fix.edgeId)
  if (!sheet || !edge || !isPortEnd(edge.source) || !isPortEnd(edge.target)) {
    return { ok: false, changedIds: [], message: 'That line is no longer there to split.' }
  }

  const nodeOf = (id: string) => sheet.nodes.find((n) => n.id === id)
  const srcNode = nodeOf(edge.source.nodeId)
  const tgtNode = nodeOf(edge.target.nodeId)
  if (!srcNode || !tgtNode) {
    return { ok: false, changedIds: [], message: 'One end of that line is missing.' }
  }
  const valveEndIsTarget = tgtNode.symbolId.startsWith('cv.')
  const valve = valveEndIsTarget ? tgtNode : srcNode
  const sender = valveEndIsTarget ? srcNode : tgtNode
  const senderEnd = valveEndIsTarget ? edge.source : edge.target
  const valveEnd = valveEndIsTarget ? edge.target : edge.source

  const pa = portWorld(sender, senderEnd.portId) ?? { x: sender.x, y: sender.y }
  const pb = portWorld(valve, valveEnd.portId) ?? { x: valve.x, y: valve.y }
  const mid = { x: snap8((pa.x + pb.x) / 2) - 16, y: snap8((pa.y + pb.y) / 2) - 16 }
  const vertical = Math.abs(pb.y - pa.y) >= Math.abs(pb.x - pa.x)
  const inPort = vertical ? (pb.y > pa.y ? 'n' : 's') : pb.x > pa.x ? 'w' : 'e'
  const outPort = vertical ? (pb.y > pa.y ? 's' : 'n') : pb.x > pa.x ? 'e' : 'w'

  // FY-style tag: sender family + Y, sharing the loop when free.
  const family = sender.tag?.letters[0] ?? valve.tag?.letters[0] ?? 'F'
  const letters = `${family}Y`
  const loop =
    sender.tag?.loop && !isDuplicateTag(state.doc, { letters, loop: sender.tag.loop })
      ? sender.tag.loop
      : nextLoopNumber(state.doc, letters)

  const converter: PlantNode = {
    id: ulid(),
    symbolId: 'instr.converter',
    kind: 'instrument',
    x: mid.x,
    y: mid.y,
    rotation: 0,
    config: { conv: 'I/P' },
    tag: { letters, loop },
  }
  const inEdge: PlantEdge = {
    id: ulid(),
    lineClass: 'signal.electric',
    source: { nodeId: sender.id, portId: senderEnd.portId },
    target: { nodeId: converter.id, portId: inPort },
  }
  const outEdge: PlantEdge = {
    id: ulid(),
    lineClass: 'signal.pneumatic',
    source: { nodeId: converter.id, portId: outPort },
    target: { nodeId: valve.id, portId: valveEnd.portId },
  }
  useStore.getState().addBatch([converter], [inEdge, outEdge], [edge.id])
  return { ok: true, changedIds: [converter.id, inEdge.id, outEdge.id] }
}
