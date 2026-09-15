// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * What changed between two issued revisions, answered from the model.
 *
 * Not from an image. A reviewer asking "what changed at Rev B" wants to know
 * that a design pressure moved and a relief valve appeared, not that eleven
 * things are three pixels to the left. So every comparison here is between
 * identified objects and named fields, and each change says whether it is
 * ENGINEERING, GRAPHICAL or METADATA — because a revision whose diff is
 * entirely graphical did not change the engineering, and saying so plainly is
 * the most useful thing this can tell anyone.
 *
 * Identity is the stable id the document already carries — node, edge, sheet,
 * widget, and the engineering key for a record. Never an array index: objects
 * are reordered by ordinary editing, and a diff that reports fifty removals
 * and fifty additions because a list was resorted is worse than no diff.
 *
 * Because ids are stable, a RENAME is directly observable — the same node with
 * a different tag — rather than guessed at. That matters beyond tidiness: a
 * rename moves the engineering record and every HMI binding with it (P0-A), so
 * without this the comparison would report one rename as a removed record, an
 * added record, and every widget in the plant changing at once.
 */

import type { HmiScreen, HmiWidget } from '../hmi/model'
import type { PlantEdge, PlantNode, ProjectDoc, Revision, Sheet } from './types'
import { isPortEnd } from './types'
import { keyOfEdge, keyOfNode } from './registry'
import type { EngineeringRecord } from './registry'
import { buildHierarchy, type Hierarchy } from './hierarchy'
import type { Loop } from './loop'
import type { Nozzle } from './nozzle'
import type { ReviewThread } from './review'
import { isOpen, threadsOf } from './review'
import { fingerprintStandard } from './provenance'
import type { IssueGate } from './standard'

export type ChangeKind = 'added' | 'removed' | 'modified' | 'renamed'

export type EntityType =
  | 'sheet' | 'node' | 'edge' | 'record'
  | 'hmi-screen' | 'hmi-widget' | 'hmi-pipe'
  | 'standard' | 'fluid' | 'budget' | 'custom-symbol' | 'qa-accepted'
  | 'area' | 'unit' | 'loop' | 'document'

/** Engineering changed the plant; graphical changed the picture of it. */
export type ChangeCategory = 'engineering' | 'graphical' | 'metadata'

export type DiffValue = string | number | boolean | undefined

export interface DocChange {
  kind: ChangeKind
  entityType: EntityType
  /** Stable id — for navigation, and the identity the diff was computed on. */
  entityId: string
  /** Engineering identity where the object has one: a tag, a line number, a
   *  record key. Absent on an untagged object, which is not an error. */
  entityKey?: string
  sheetId?: string
  /** Which property moved. Absent when the whole entity was added or removed. */
  field?: string
  before?: DiffValue
  after?: DiffValue
  category: ChangeCategory
}

export interface QaCounts {
  critical: number
  warning: number
  info: number
  total: number
}

export interface DocDiff {
  changes: DocChange[]
  counts: { added: number; removed: number; modified: number; renamed: number }
  /** Engineering-only change count — the number a reviewer actually wants. */
  engineeringCount: number
  /** Taken from the revision RECORDS, not computed by re-running the checker
   *  over old snapshots. Reported beside the diff, never as changes: the QA
   *  report of a project is thousands of findings and diffing them would bury
   *  the engineering. */
  qa?: { before?: QaCounts; after?: QaCounts }
}

/* ------------------------------------------------------------------ values */

/** The SAME identity the registry files a record under — `keyOfNode`, which
 *  excludes annotations. A second, subtly different notion of "the tag of this
 *  node" is how a renamed annotation would end up in the rename map and
 *  silence an unrelated HMI change. One function, one answer. */
const tagKey = (n: PlantNode): string | undefined => keyOfNode(n) ?? undefined

const lineKey = (e: PlantEdge): string | undefined => keyOfEdge(e) ?? undefined

const endValue = (end: PlantEdge['source']): string =>
  isPortEnd(end) ? `${end.nodeId}:${end.portId}` : `${end.x},${end.y}`

const num = (v: number | undefined): DiffValue => v

/** Sub-objects are compared as a canonical string. The FIELD name says what it
 *  is; the value only has to be stable and readable. */
const json = (v: unknown): DiffValue => (v === undefined ? undefined : JSON.stringify(v))

/* ------------------------------------------------------------- field tables */

/** node field -> category. Anything not listed is not compared. */
const NODE_FIELDS: { field: string; category: ChangeCategory; read: (n: PlantNode) => DiffValue }[] = [
  { field: 'symbolId', category: 'engineering', read: (n) => n.symbolId },
  { field: 'kind', category: 'engineering', read: (n) => n.kind },
  { field: 'label', category: 'engineering', read: (n) => n.label },
  { field: 'cost', category: 'metadata', read: (n) => num(n.cost) },
  { field: 'extraPorts', category: 'engineering', read: (n) => json(n.extraPorts) },
  { field: 'offPageLink', category: 'engineering', read: (n) => json(n.link) },
  { field: 'x', category: 'graphical', read: (n) => n.x },
  { field: 'y', category: 'graphical', read: (n) => n.y },
  { field: 'rotation', category: 'graphical', read: (n) => n.rotation },
  { field: 'scale', category: 'graphical', read: (n) => num(n.scale) },
  { field: 'scaleX', category: 'graphical', read: (n) => num(n.scaleX) },
  { field: 'scaleY', category: 'graphical', read: (n) => num(n.scaleY) },
  { field: 'flipH', category: 'graphical', read: (n) => n.flipH },
  { field: 'labelPos', category: 'graphical', read: (n) => n.labelPos },
]

const EDGE_FIELDS: { field: string; category: ChangeCategory; read: (e: PlantEdge) => DiffValue }[] = [
  { field: 'lineClass', category: 'engineering', read: (e) => e.lineClass },
  { field: 'source', category: 'engineering', read: (e) => endValue(e.source) },
  { field: 'target', category: 'engineering', read: (e) => endValue(e.target) },
  { field: 'fluid', category: 'engineering', read: (e) => e.fluidId },
  { field: 'arrow', category: 'engineering', read: (e) => e.arrow },
  { field: 'vertices', category: 'graphical', read: (e) => json(e.vertices) },
]

/**
 * Sheet fields compared.
 *
 * `revisions` and `revision` are deliberately ABSENT. Comparing two issued
 * revisions means comparing two documents that differ in their revision table
 * BY DEFINITION — snapshot B has the row that snapshot A was issued before.
 * Reporting that would put "a revision was added" at the top of every single
 * comparison, which is noise dressed as information. The revision table is the
 * frame the comparison happens inside, not a change within it.
 *
 * `underlay` is absent for a different reason: it is a traced-over background
 * image, not part of the plant.
 */
const SHEET_FIELDS: { field: string; category: ChangeCategory; read: (s: Sheet) => DiffValue }[] = [
  { field: 'name', category: 'metadata', read: (s) => s.name },
  { field: 'drawingNumber', category: 'metadata', read: (s) => s.drawingNumber },
  { field: 'sheetSize', category: 'metadata', read: (s) => s.sheetSize },
]

const WIDGET_FIELDS: { field: string; category: ChangeCategory; read: (w: HmiWidget) => DiffValue }[] = [
  { field: 'type', category: 'engineering', read: (w) => w.type },
  { field: 'label', category: 'engineering', read: (w) => w.label },
  { field: 'x', category: 'graphical', read: (w) => w.x },
  { field: 'y', category: 'graphical', read: (w) => w.y },
  { field: 'w', category: 'graphical', read: (w) => w.w },
  { field: 'h', category: 'graphical', read: (w) => w.h },
  { field: 'rotation', category: 'graphical', read: (w) => w.rotation },
]

/* --------------------------------------------------------------- utilities */

const byId = <T extends { id: string }>(list: readonly T[]): Map<string, T> =>
  new Map(list.map((item) => [item.id, item]))

const ENTITY_ORDER: Record<EntityType, number> = {
  sheet: 0, node: 1, edge: 2, record: 3,
  'hmi-screen': 4, 'hmi-widget': 5, 'hmi-pipe': 6,
  standard: 7, fluid: 8, 'custom-symbol': 9, 'qa-accepted': 10, budget: 11,
  area: 12, unit: 13, loop: 14, document: 15,
}

/** Sheet, then category, then engineering key, then field — so the same pair
 *  of snapshots always reads the same way. */
function sortChanges(changes: DocChange[]): DocChange[] {
  return [...changes].sort((a, b) =>
    (a.sheetId ?? '').localeCompare(b.sheetId ?? '') ||
    ENTITY_ORDER[a.entityType] - ENTITY_ORDER[b.entityType] ||
    (a.entityKey ?? '').localeCompare(b.entityKey ?? '') ||
    a.entityId.localeCompare(b.entityId) ||
    (a.field ?? '').localeCompare(b.field ?? ''))
}

/* ------------------------------------------------------------------ renames */

/**
 * Engineering keys that moved, established from stable ids rather than guessed.
 *
 * A node that kept its id and changed its tag was renamed — there is nothing
 * probabilistic about it. Everything that key names (its record, its HMI
 * bindings) moved with it, so those are reported once, here, instead of many
 * times everywhere else.
 */
function renameMap(before: ProjectDoc, after: ProjectDoc): Map<string, string> {
  const out = new Map<string, string>()
  const beforeNodes = new Map<string, PlantNode>()
  const beforeEdges = new Map<string, PlantEdge>()
  for (const s of before.sheets) {
    for (const n of s.nodes) beforeNodes.set(n.id, n)
    for (const e of s.edges) beforeEdges.set(e.id, e)
  }
  for (const s of after.sheets) {
    for (const n of s.nodes) {
      const was = beforeNodes.get(n.id)
      const a = was && tagKey(was)
      const b = tagKey(n)
      if (a && b && a !== b) out.set(a, b)
    }
    for (const e of s.edges) {
      const was = beforeEdges.get(e.id)
      const a = was && lineKey(was)
      const b = lineKey(e)
      if (a && b && a !== b) out.set(a, b)
    }
  }
  return out
}

/** Did this value simply follow a rename? `LT-101` → `LT-201`, or the signal
 *  ref `LT-101.PV` → `LT-201.PV`. */
function followedRename(before: DiffValue, after: DiffValue, renames: Map<string, string>): boolean {
  if (typeof before !== 'string' || typeof after !== 'string') return false
  const moved = renames.get(before)
  if (moved === after) return true
  // 'TAG.SIGNAL' — the tag moved, the signal did not.
  const i = before.lastIndexOf('.')
  const j = after.lastIndexOf('.')
  if (i <= 0 || j <= 0) return false
  return before.slice(i) === after.slice(j) && renames.get(before.slice(0, i)) === after.slice(0, j)
}

/* ------------------------------------------------------------------- compare */

export function compareDocs(before: ProjectDoc, after: ProjectDoc, qa?: DocDiff['qa']): DocDiff {
  const changes: DocChange[] = []
  const renames = renameMap(before, after)
  const push = (c: DocChange) => changes.push(c)

  /* ---- sheets, and the drawing inside them ---- */
  const beforeSheets = byId(before.sheets)
  const afterSheets = byId(after.sheets)

  for (const [id, sheet] of beforeSheets) {
    if (!afterSheets.has(id)) {
      push({ kind: 'removed', entityType: 'sheet', entityId: id, entityKey: sheet.drawingNumber || sheet.name, sheetId: id, category: 'engineering' })
    }
  }
  for (const [id, sheet] of afterSheets) {
    if (!beforeSheets.has(id)) {
      push({ kind: 'added', entityType: 'sheet', entityId: id, entityKey: sheet.drawingNumber || sheet.name, sheetId: id, category: 'engineering' })
    }
  }

  for (const [sheetId, a] of afterSheets) {
    const b = beforeSheets.get(sheetId)
    if (!b) continue

    for (const { field, category, read } of SHEET_FIELDS) {
      const wasV = read(b)
      const isV = read(a)
      if (wasV !== isV) {
        push({ kind: 'modified', entityType: 'sheet', entityId: sheetId, entityKey: a.drawingNumber || a.name, sheetId, field, before: wasV, after: isV, category })
      }
    }

    diffNodes(b, a, sheetId, renames, push)
    diffEdges(b, a, sheetId, push)
  }

  diffDocumentMeta(before, after, push)
  diffHierarchy(before, after, push)
  diffLoops(before, after, push)
  diffRegistry(before, after, renames, push)
  diffHmi(before, after, renames, push)
  diffStandard(before, after, push)
  diffFluids(before, after, push)
  diffBudget(before, after, push)
  diffCustomSymbols(before, after, push)
  diffAcceptedFindings(before, after, push)

  const sorted = sortChanges(changes)
  const counts = { added: 0, removed: 0, modified: 0, renamed: 0 }
  for (const c of sorted) counts[c.kind] += 1
  return {
    changes: sorted,
    counts,
    engineeringCount: sorted.filter((c) => c.category === 'engineering').length,
    ...(qa ? { qa } : {}),
  }
}

function diffNodes(b: Sheet, a: Sheet, sheetId: string, renames: Map<string, string>, push: (c: DocChange) => void) {
  const was = byId(b.nodes)
  const now = byId(a.nodes)

  for (const [id, node] of was) {
    if (!now.has(id)) {
      push({ kind: 'removed', entityType: 'node', entityId: id, entityKey: tagKey(node), sheetId, category: 'engineering' })
    }
  }
  for (const [id, node] of now) {
    if (!was.has(id)) {
      push({ kind: 'added', entityType: 'node', entityId: id, entityKey: tagKey(node), sheetId, category: 'engineering' })
      continue
    }
    const old = was.get(id)!
    const key = tagKey(node) ?? tagKey(old)

    const oldTag = tagKey(old)
    const newTag = tagKey(node)
    if (oldTag !== newTag) {
      // A tag that moved between two real tags is a RENAME, established from
      // the stable id. Gaining or losing a tag is an ordinary modification.
      const renamed = Boolean(oldTag && newTag && renames.get(oldTag) === newTag)
      push({
        kind: renamed ? 'renamed' : 'modified',
        entityType: 'node', entityId: id, entityKey: newTag ?? oldTag, sheetId,
        field: 'tag', before: oldTag, after: newTag, category: 'engineering',
      })
    }

    for (const { field, category, read } of NODE_FIELDS) {
      const wasV = read(old)
      const isV = read(node)
      if (wasV !== isV) push({ kind: 'modified', entityType: 'node', entityId: id, entityKey: key, sheetId, field, before: wasV, after: isV, category })
    }

    // config is a bag of per-symbol options; compare it key by key so the
    // change names the option, not the whole object.
    for (const k of new Set([...Object.keys(old.config ?? {}), ...Object.keys(node.config ?? {})])) {
      const wasV = old.config?.[k]
      const isV = node.config?.[k]
      if (wasV !== isV) push({ kind: 'modified', entityType: 'node', entityId: id, entityKey: key, sheetId, field: `config.${k}`, before: wasV, after: isV, category: 'engineering' })
    }
  }
}

function diffEdges(b: Sheet, a: Sheet, sheetId: string, push: (c: DocChange) => void) {
  const was = byId(b.edges)
  const now = byId(a.edges)

  for (const [id, edge] of was) {
    if (!now.has(id)) push({ kind: 'removed', entityType: 'edge', entityId: id, entityKey: lineKey(edge), sheetId, category: 'engineering' })
  }
  for (const [id, edge] of now) {
    if (!was.has(id)) {
      push({ kind: 'added', entityType: 'edge', entityId: id, entityKey: lineKey(edge), sheetId, category: 'engineering' })
      continue
    }
    const old = was.get(id)!
    const key = lineKey(edge) ?? lineKey(old)

    const oldNum = lineKey(old)
    const newNum = lineKey(edge)
    if (oldNum !== newNum) {
      push({
        kind: oldNum && newNum ? 'renamed' : 'modified',
        entityType: 'edge', entityId: id, entityKey: newNum ?? oldNum, sheetId,
        field: 'lineNumber', before: oldNum, after: newNum, category: 'engineering',
      })
    }

    for (const { field, category, read } of EDGE_FIELDS) {
      const wasV = read(old)
      const isV = read(edge)
      if (wasV !== isV) push({ kind: 'modified', entityType: 'edge', entityId: id, entityKey: key, sheetId, field, before: wasV, after: isV, category })
    }
  }
}

function diffRegistry(before: ProjectDoc, after: ProjectDoc, renames: Map<string, string>, push: (c: DocChange) => void) {
  const was = before.registry ?? {}
  const now = after.registry ?? {}
  const wasH = buildHierarchy(before)
  const nowH = buildHierarchy(after)
  // A record that moved with a renamed tag is reported once, on the node.
  // Repeating it as a removal plus an addition is the noise this suppresses.
  const movedFrom = new Set<string>()
  const movedTo = new Set<string>()
  for (const [from, to] of renames) {
    if (was[from] && now[to] && !was[to]) { movedFrom.add(from); movedTo.add(to) }
  }

  for (const key of Object.keys(was)) {
    if (now[key] || movedFrom.has(key)) continue
    push({ kind: 'removed', entityType: 'record', entityId: key, entityKey: key, category: 'engineering' })
  }
  for (const key of Object.keys(now)) {
    if (was[key] || movedTo.has(key)) continue
    push({ kind: 'added', entityType: 'record', entityId: key, entityKey: key, category: 'engineering' })
  }

  const compare = (fromKey: string, toKey: string) => {
    const oldRec = was[fromKey]
    const newRec = now[toKey]
    if (!oldRec || !newRec) return
    for (const f of new Set([...Object.keys(oldRec.fields), ...Object.keys(newRec.fields)])) {
      const wasV = oldRec.fields[f]
      const isV = newRec.fields[f]
      if (wasV !== isV) push({ kind: 'modified', entityType: 'record', entityId: toKey, entityKey: toKey, field: f, before: wasV, after: isV, category: 'engineering' })
    }
    if (oldRec.status !== newRec.status) {
      push({ kind: 'modified', entityType: 'record', entityId: toKey, entityKey: toKey, field: 'status', before: oldRec.status, after: newRec.status, category: 'metadata' })
    }
    // Who owns the record. Metadata rather than engineering — it does not
    // change the plant — but it IS a decision somebody made between two
    // issues, and it was silently invisible here until the ledger below
    // forced the question.
    if ((oldRec.owner ?? '') !== (newRec.owner ?? '')) {
      push({ kind: 'modified', entityType: 'record', entityId: toKey, entityKey: toKey, field: 'owner', before: oldRec.owner, after: newRec.owner, category: 'metadata' })
    }
    // Compared by stable ID, displayed by CODE. That distinction is the whole
    // point of the id: renaming Unit U-101 to U-102 is ONE change, reported on
    // the unit, and must not also report every object assigned to it as having
    // moved. Only a genuine reassignment — a different unit — lands here.
    if ((oldRec.unitId ?? '') !== (newRec.unitId ?? '')) {
      push({
        kind: 'modified', entityType: 'record', entityId: toKey, entityKey: toKey, field: 'unit',
        before: unitText(wasH, oldRec.unitId), after: unitText(nowH, newRec.unitId), category: 'engineering',
      })
    }
    // Loop membership, compared by stable ID and displayed by NUMBER — the
    // same split as the unit above, and for the same reason: renumbering a
    // loop is ONE change reported on the loop, and must not also report every
    // member as having moved. Only a genuine reassignment lands here.
    if ((oldRec.loopId ?? '') !== (newRec.loopId ?? '')) {
      push({
        kind: 'modified', entityType: 'record', entityId: toKey, entityKey: toKey, field: 'loop',
        before: loopText(before, oldRec.loopId), after: loopText(after, newRec.loopId), category: 'engineering',
      })
    }
    diffNozzles(oldRec, newRec, toKey, push)
    diffComments(oldRec, newRec, toKey, push)
  }

  for (const key of Object.keys(now)) if (was[key]) compare(key, key)
  // A renamed record still has its own fields compared, under the new key.
  for (const from of movedFrom) compare(from, renames.get(from)!)
}

/** The comparable fields of a nozzle, in the order a reviewer reads them.
 *  `id` is excluded: it IS the identity the comparison is matched on. */
const NOZZLE_FIELDS = ['number', 'portId', 'size', 'rating', 'facing', 'service', 'notes'] as const

/** A nozzle in one line, for the two cases where the whole thing arrived or
 *  left and naming one field would under-report it. */
function nozzleText(nozzle: Nozzle): string {
  const parts = [nozzle.size, nozzle.rating, nozzle.facing, nozzle.service].filter(Boolean)
  const port = nozzle.portId ? `port ${nozzle.portId}` : 'no port'
  return [nozzle.number, ...parts, port].join(' · ')
}

/**
 * The equipment's nozzle schedule, nozzle by nozzle.
 *
 * MATCHED ON STABLE ID, NAMED BY NUMBER — the same split as the unit and the
 * loop above. Reordering the array is not an engineering change and reports
 * nothing; renumbering N2 to N3 is ONE change on that nozzle rather than a
 * removal and an addition.
 *
 * A modified nozzle is named by the number it carries in the NEWER document,
 * because that is the document a reviewer is looking at.
 */
function diffNozzles(
  oldRec: EngineeringRecord,
  newRec: EngineeringRecord,
  key: string,
  push: (c: DocChange) => void,
) {
  const was = new Map((oldRec.nozzles ?? []).map((n) => [n.id, n]))
  const now = new Map((newRec.nozzles ?? []).map((n) => [n.id, n]))

  for (const [id, nozzle] of was) {
    if (now.has(id)) continue
    push({
      kind: 'modified', entityType: 'record', entityId: key, entityKey: key,
      field: `nozzle ${nozzle.number}`, before: nozzleText(nozzle), after: undefined, category: 'engineering',
    })
  }
  for (const [id, nozzle] of now) {
    if (was.has(id)) continue
    push({
      kind: 'modified', entityType: 'record', entityId: key, entityKey: key,
      field: `nozzle ${nozzle.number}`, before: undefined, after: nozzleText(nozzle), category: 'engineering',
    })
  }
  for (const [id, nozzle] of now) {
    const old = was.get(id)
    if (!old) continue
    for (const field of NOZZLE_FIELDS) {
      const wasV = old[field]
      const isV = nozzle[field]
      if (wasV === isV) continue
      push({
        kind: 'modified', entityType: 'record', entityId: key, entityKey: key,
        field: `nozzle ${nozzle.number} ${field}`, before: wasV, after: isV, category: 'engineering',
      })
    }
  }
}

/**
 * How a thread is NAMED in a comparison.
 *
 * A thread has no title and no number — its id is a ULID nobody reads. So it is
 * named by the words it opens with, which is how a reviewer actually recognises
 * one. Truncated, because a revision report is a list and a paragraph in the
 * `field` column would make it unreadable.
 */
function threadName(thread: ReviewThread): string {
  const first = thread.notes[0]?.body ?? ''
  const short = first.length > 40 ? `${first.slice(0, 40)}…` : first
  return `comment "${short}"`
}

/** One note as a reviewer reads it, for the add/remove lines. */
const noteText = (note: { body: string; by?: string }): string =>
  note.by ? `${note.by}: ${note.body}` : note.body

/**
 * Review threads, thread by thread and note by note.
 *
 * MATCHED ON STABLE IDS at both levels. Reordering reports nothing; a reply is
 * one added note rather than a conversation that appears to have been rewritten.
 *
 * `at` IS NOT COMPARED. A note that is merely older is not a change — the same
 * ruling `updated` gets, and the reason the ledger above says so out loud.
 */
function diffComments(
  oldRec: EngineeringRecord,
  newRec: EngineeringRecord,
  key: string,
  push: (c: DocChange) => void,
) {
  const base = { kind: 'modified' as const, entityType: 'record' as const, entityId: key, entityKey: key, category: 'metadata' as const }
  const was = new Map(threadsOf(oldRec).map((t) => [t.id, t]))
  const now = new Map(threadsOf(newRec).map((t) => [t.id, t]))

  for (const [id, thread] of was) {
    if (now.has(id)) continue
    push({ ...base, field: threadName(thread), before: noteText(thread.notes[0]!), after: undefined })
  }
  for (const [id, thread] of now) {
    if (was.has(id)) continue
    push({ ...base, field: threadName(thread), before: undefined, after: noteText(thread.notes[0]!) })
  }

  for (const [id, thread] of now) {
    const old = was.get(id)
    if (!old) continue
    const name = threadName(thread)

    // Open and resolved are the whole state machine, so the transition either
    // way is one change and reads as a sentence rather than as a flag.
    if (isOpen(old) !== isOpen(thread)) {
      push({
        ...base, field: `${name} — state`,
        before: isOpen(old) ? 'open' : 'resolved',
        after: isOpen(thread) ? 'open' : 'resolved',
      })
    } else if ((old.resolved?.by ?? '') !== (thread.resolved?.by ?? '')) {
      push({ ...base, field: `${name} — resolved by`, before: old.resolved?.by, after: thread.resolved?.by })
    }

    const oldNotes = new Map(old.notes.map((n) => [n.id, n]))
    const newNotes = new Map(thread.notes.map((n) => [n.id, n]))
    for (const [noteId, note] of oldNotes) {
      if (newNotes.has(noteId)) continue
      push({ ...base, field: `${name} — reply`, before: noteText(note), after: undefined })
    }
    for (const [noteId, note] of newNotes) {
      if (oldNotes.has(noteId)) continue
      push({ ...base, field: `${name} — reply`, before: undefined, after: noteText(note) })
    }
    for (const [noteId, note] of newNotes) {
      const before = oldNotes.get(noteId)
      if (!before) continue
      // Notes are append-only in this product, so a changed body means a file
      // edited elsewhere — still worth reporting rather than swallowing.
      if (before.body !== note.body) {
        push({ ...base, field: `${name} — note`, before: before.body, after: note.body })
      }
      if ((before.by ?? '') !== (note.by ?? '')) {
        push({ ...base, field: `${name} — author`, before: before.by, after: note.by })
      }
    }
  }
}

/** A unit as a reviewer reads it: `AREA/UNIT`, or nothing when unassigned.
 *  Falls back to the raw id only when the unit is gone, which is the one case
 *  where there is no code left to print and silence would be misleading. */
function unitText(h: Hierarchy, unitId: string | undefined): DiffValue {
  if (!unitId) return undefined
  const unit = h.unitById.get(unitId)
  if (!unit) return `(deleted unit ${unitId})`
  const area = h.areaById.get(unit.areaId)
  return area ? `${area.code}/${unit.code}` : unit.code
}

/**
 * Areas and Units.
 *
 * Engineering, not metadata: which unit an object belongs to decides which
 * package it is bought under, which I/O cabinet it lands in and which
 * commissioning system signs it off. A code moving from U-101 to U-102 between
 * two issues is exactly the kind of thing a reviewer is looking for.
 *
 * Keyed on the stable id, so reordering either array — which ordinary editing
 * does — produces nothing at all. The arrays have no meaning beyond being a
 * place to keep the records.
 */
function diffHierarchy(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  const wasAreas = byId(before.areas ?? [])
  const nowAreas = byId(after.areas ?? [])
  for (const [id, a] of wasAreas) {
    if (!nowAreas.has(id)) push({ kind: 'removed', entityType: 'area', entityId: id, entityKey: a.code, category: 'engineering' })
  }
  for (const [id, a] of nowAreas) {
    const old = wasAreas.get(id)
    if (!old) {
      push({ kind: 'added', entityType: 'area', entityId: id, entityKey: a.code, category: 'engineering' })
      continue
    }
    if (old.code !== a.code) {
      push({ kind: 'renamed', entityType: 'area', entityId: id, entityKey: a.code, field: 'code', before: old.code, after: a.code, category: 'engineering' })
    }
    if ((old.name ?? '') !== (a.name ?? '')) {
      push({ kind: 'modified', entityType: 'area', entityId: id, entityKey: a.code, field: 'name', before: old.name, after: a.name, category: 'metadata' })
    }
  }

  const wasUnits = byId(before.units ?? [])
  const nowUnits = byId(after.units ?? [])
  const areaCode = (doc: ProjectDoc, areaId: string): DiffValue =>
    (doc.areas ?? []).find((a) => a.id === areaId)?.code ?? `(deleted area ${areaId})`
  for (const [id, u] of wasUnits) {
    if (!nowUnits.has(id)) push({ kind: 'removed', entityType: 'unit', entityId: id, entityKey: u.code, category: 'engineering' })
  }
  for (const [id, u] of nowUnits) {
    const old = wasUnits.get(id)
    if (!old) {
      push({ kind: 'added', entityType: 'unit', entityId: id, entityKey: u.code, category: 'engineering' })
      continue
    }
    if (old.code !== u.code) {
      push({ kind: 'renamed', entityType: 'unit', entityId: id, entityKey: u.code, field: 'code', before: old.code, after: u.code, category: 'engineering' })
    }
    if ((old.name ?? '') !== (u.name ?? '')) {
      push({ kind: 'modified', entityType: 'unit', entityId: id, entityKey: u.code, field: 'name', before: old.name, after: u.name, category: 'metadata' })
    }
    // A unit moving between areas reassigns everything in it at once, which is
    // why it is reported here rather than on each record.
    if (old.areaId !== u.areaId) {
      push({ kind: 'modified', entityType: 'unit', entityId: id, entityKey: u.code, field: 'area', before: areaCode(before, old.areaId), after: areaCode(after, u.areaId), category: 'engineering' })
    }
  }
}

/** A loop as a reviewer reads it, for a membership change. The NUMBER, never
 *  the id — and the raw id only when the loop is gone and there is no number
 *  left to print, where silence would be misleading. Mirrors `unitText`. */
function loopText(doc: ProjectDoc, loopId: string | undefined): DiffValue {
  if (!loopId) return undefined
  const loop = (doc.loops ?? []).find((l) => l.id === loopId)
  return loop ? loop.number : `(deleted loop ${loopId})`
}

/**
 * Persistent loops.
 *
 * Keyed on the stable id, so reordering `doc.loops` — which ordinary editing
 * does — produces nothing at all, and RENUMBERING is one `renamed` on the loop
 * rather than a change reported against every member. That is the whole reason
 * membership points at an id: `diffRegistry` compares `loopId` by id and
 * displays it by number, so only a genuine REASSIGNMENT lands there.
 *
 * `type` is engineering: what kind of loop this is decides what it must
 * contain, what it is commissioned as, and how it is checked. `name`,
 * `description` and `status` are metadata — a reviewer wants them listed, but
 * none of them changes the plant.
 *
 * MEMBERSHIP IS NOT DIFFED HERE. A member joining or leaving is a change to
 * the RECORD, and `diffRegistry` reports it there. Reporting it twice — once
 * on the record and once on the loop — would double every membership edit in
 * the table and leave a reviewer counting the same move as two.
 */
function diffLoops(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  const was = byId<Loop>(before.loops ?? [])
  const now = byId<Loop>(after.loops ?? [])

  for (const [id, loop] of was) {
    if (!now.has(id)) push({ kind: 'removed', entityType: 'loop', entityId: id, entityKey: loop.number, category: 'engineering' })
  }
  for (const [id, loop] of now) {
    const old = was.get(id)
    if (!old) {
      push({ kind: 'added', entityType: 'loop', entityId: id, entityKey: loop.number, category: 'engineering' })
      continue
    }
    if (old.number !== loop.number) {
      push({ kind: 'renamed', entityType: 'loop', entityId: id, entityKey: loop.number, field: 'number', before: old.number, after: loop.number, category: 'engineering' })
    }
    if ((old.type ?? '') !== (loop.type ?? '')) {
      push({ kind: 'modified', entityType: 'loop', entityId: id, entityKey: loop.number, field: 'type', before: old.type, after: loop.type, category: 'engineering' })
    }
    for (const field of ['name', 'description', 'status'] as const) {
      if ((old[field] ?? '') !== (loop[field] ?? '')) {
        push({ kind: 'modified', entityType: 'loop', entityId: id, entityKey: loop.number, field, before: old[field], after: loop[field], category: 'metadata' })
      }
    }
  }
}

function diffHmi(before: ProjectDoc, after: ProjectDoc, renames: Map<string, string>, push: (c: DocChange) => void) {
  const was = byId(before.hmiScreens ?? [])
  const now = byId(after.hmiScreens ?? [])

  for (const [id, screen] of was) {
    if (!now.has(id)) push({ kind: 'removed', entityType: 'hmi-screen', entityId: id, entityKey: screen.name, category: 'engineering' })
  }
  for (const [id, screen] of now) {
    if (!was.has(id)) {
      push({ kind: 'added', entityType: 'hmi-screen', entityId: id, entityKey: screen.name, category: 'engineering' })
      continue
    }
    const old = was.get(id)!
    if (old.name !== screen.name) {
      push({ kind: 'modified', entityType: 'hmi-screen', entityId: id, entityKey: screen.name, field: 'name', before: old.name, after: screen.name, category: 'metadata' })
    }
    diffWidgets(old, screen, renames, push)
    diffPipes(old, screen, push)
  }
}

function diffWidgets(b: HmiScreen, a: HmiScreen, renames: Map<string, string>, push: (c: DocChange) => void) {
  const was = byId(b.widgets)
  const now = byId(a.widgets)

  for (const [id, w] of was) {
    if (!now.has(id)) push({ kind: 'removed', entityType: 'hmi-widget', entityId: id, entityKey: w.tag ?? w.label, category: 'engineering' })
  }
  for (const [id, w] of now) {
    if (!was.has(id)) {
      push({ kind: 'added', entityType: 'hmi-widget', entityId: id, entityKey: w.tag ?? w.label, category: 'engineering' })
      continue
    }
    const old = was.get(id)!
    const key = w.tag ?? old.tag ?? w.label

    // A binding that only followed a renamed tag did not independently change.
    if (old.tag !== w.tag && !followedRename(old.tag, w.tag, renames)) {
      push({ kind: 'modified', entityType: 'hmi-widget', entityId: id, entityKey: key, field: 'tag', before: old.tag, after: w.tag, category: 'engineering' })
    }

    for (const { field, category, read } of WIDGET_FIELDS) {
      const wasV = read(old)
      const isV = read(w)
      if (wasV !== isV) push({ kind: 'modified', entityType: 'hmi-widget', entityId: id, entityKey: key, field, before: wasV, after: isV, category })
    }

    const oldPens = old.pens ?? []
    const newPens = w.pens ?? []
    const penCount = Math.max(oldPens.length, newPens.length)
    for (let i = 0; i < penCount; i++) {
      const wasV = oldPens[i]?.ref
      const isV = newPens[i]?.ref
      if (wasV === isV || followedRename(wasV, isV, renames)) continue
      push({ kind: 'modified', entityType: 'hmi-widget', entityId: id, entityKey: key, field: `pens[${i}]`, before: wasV, after: isV, category: 'engineering' })
    }

    for (const k of new Set([...Object.keys(old.props ?? {}), ...Object.keys(w.props ?? {})])) {
      const wasV = old.props?.[k] as DiffValue
      const isV = w.props?.[k] as DiffValue
      if (wasV === isV || followedRename(wasV, isV, renames)) continue
      push({ kind: 'modified', entityType: 'hmi-widget', entityId: id, entityKey: key, field: `props.${k}`, before: wasV, after: isV, category: 'engineering' })
    }
  }
}

/* ------------------------------------------------- document-level context */

/** Compare two flat string/number maps, emitting one change per differing key. */
function diffRecordMap(
  before: Record<string, DiffValue> | undefined,
  after: Record<string, DiffValue> | undefined,
  make: (field: string, was: DiffValue, is: DiffValue) => DocChange,
  push: (c: DocChange) => void,
) {
  for (const k of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const was = before?.[k]
    const is = after?.[k]
    if (was !== is) push(make(k, was, is))
  }
}

/**
 * WHAT THE DOCUMENT IS — the controlled-document identity fields.
 *
 * These used to be excluded wholesale, and for a good reason at the time: the
 * only things in `meta` were a name, an author and a `modified` stamp that
 * moves on every keystroke. P2-A put client, project number, plant, discipline
 * and document number in here, and those PRINT IN THE TITLE BLOCK. Changing
 * the client between two issues changes what the drawing claims to be, and a
 * comparison that stayed silent about it would be hiding the most consequential
 * kind of change there is.
 *
 * `created` and `modified` stay out. They are timestamps, not decisions.
 */
const META_FIELD_COVERAGE: Record<keyof ProjectDoc['meta'], 'compared' | string> = {
  name: 'compared',
  author: 'compared',
  client: 'compared',
  projectNumber: 'compared',
  plant: 'compared',
  discipline: 'compared',
  documentNumber: 'compared',
  created: 'Excluded: when the file was made, which no revision can change.',
  modified: 'Excluded: moves on every keystroke — pure noise in a comparison.',
}

const META_COMPARED = (Object.keys(META_FIELD_COVERAGE) as (keyof ProjectDoc['meta'])[])
  .filter((k) => META_FIELD_COVERAGE[k] === 'compared')

function diffDocumentMeta(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  for (const field of META_COMPARED) {
    const was = before.meta[field] ?? ''
    const is = after.meta[field] ?? ''
    if (was === is) continue
    push({
      kind: 'modified', entityType: 'document', entityId: 'document',
      entityKey: after.meta.name || before.meta.name,
      field, before: was || undefined, after: is || undefined, category: 'metadata',
    })
  }
}

/**
 * The company standard the drawing is checked against.
 *
 * Revision-significant, and arguably the most consequential thing on this
 * list: the standard decides what a tag may look like, which fields an object
 * must carry, and which checks run at what severity. Change it between two
 * issues and every QA finding in the report means something different — a
 * comparison that stayed silent about that would mislead the reviewer it
 * exists to inform.
 */
function diffStandard(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  const was = before.standard
  const now = after.standard
  if (!was && !now) return
  const id = now?.id ?? was?.id ?? 'standard'
  const key = now?.name ?? was?.name
  const at = (field: string, b: DiffValue, a: DiffValue, category: ChangeCategory = 'engineering'): DocChange =>
    ({ kind: 'modified', entityType: 'standard', entityId: id, entityKey: key, field, before: b, after: a, category })

  if (!was || !now) {
    push({ kind: now ? 'added' : 'removed', entityType: 'standard', entityId: id, entityKey: key, category: 'engineering' })
    return
  }
  // Naming the profile is bookkeeping; everything below changes what is valid.
  if (was.id !== now.id) push(at('id', was.id, now.id, 'metadata'))
  if (was.name !== now.name) push(at('name', was.name, now.name, 'metadata'))
  if ((was.version ?? '') !== (now.version ?? '')) push(at('version', was.version, now.version, 'metadata'))
  // The fingerprint is the one line that says "the rules moved" even when a
  // reviewer cannot see which of thirty settings did. Engineering, because a
  // different rule set means every finding in the report means something else.
  const wasPrint = fingerprintStandard(was)
  const nowPrint = fingerprintStandard(now)
  if (wasPrint !== nowPrint) push(at('fingerprint', wasPrint, nowPrint, 'engineering'))

  diffRecordMap(
    was.tagFormat as unknown as Record<string, DiffValue>,
    now.tagFormat as unknown as Record<string, DiffValue>,
    (f, b, a) => at(`tagFormat.${f}`, b, a), push,
  )
  diffRecordMap(
    { ...was.lineNumber, order: was.lineNumber.order.join(',') } as unknown as Record<string, DiffValue>,
    { ...now.lineNumber, order: now.lineNumber.order.join(',') } as unknown as Record<string, DiffValue>,
    (f, b, a) => at(`lineNumber.${f}`, b, a), push,
  )
  diffRecordMap(
    was.conventions as unknown as Record<string, DiffValue>,
    now.conventions as unknown as Record<string, DiffValue>,
    (f, b, a) => at(`conventions.${f}`, b, a), push,
  )
  diffRecordMap(
    Object.fromEntries(Object.entries(was.required).map(([k, v]) => [k, v.join(', ')])),
    Object.fromEntries(Object.entries(now.required).map(([k, v]) => [k, v.join(', ')])),
    (f, b, a) => at(`required.${f}`, b, a), push,
  )
  diffRecordMap(was.severityOverrides, now.severityOverrides, (f, b, a) => at(`severity.${f}`, b, a), push)
  const wasStatuses = (was.issueStatuses ?? []).join(', ')
  const nowStatuses = (now.issueStatuses ?? []).join(', ')
  if (wasStatuses !== nowStatuses) push(at('issueStatuses', wasStatuses, nowStatuses, 'metadata'))

  // The ISSUE POLICY, status by status. Engineering, not metadata: relaxing
  // what may be issued changes what the drawing is permitted to say about
  // itself, which is exactly the kind of change a reviewer reads a revision
  // diff to find. Rendered as one readable line per status so the change names
  // the gate rather than dumping an object.
  diffRecordMap(
    policyLines(was.issuePolicy),
    policyLines(now.issuePolicy),
    (f, b, a) => at(`issuePolicy.${f}`, b, a, 'engineering'),
    push,
  )
}

/** One canonical, human-readable line per gated status. Order-independent, so
 *  ticking the same boxes in a different order is not a change. */
function policyLines(policy: Record<string, IssueGate> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const status of Object.keys(policy ?? {}).sort()) {
    const g = policy![status]!
    const parts: string[] = []
    const blocked = [...(g.blockSeverities ?? [])].sort()
    parts.push(blocked.length ? `blocks ${blocked.join('/')}` : 'blocks nothing')
    if (g.allowAcceptedFindings === false) parts.push('accepted findings still block')
    if (g.requireChecker) parts.push('checker required')
    if (g.requireApprover) parts.push('approver required')
    if (g.requireQaEvaluation) parts.push('QA required')
    out[status] = parts.join('; ')
  }
  return out
}

/**
 * Process services.
 *
 * Engineering-significant because a line does not store its service — it
 * stores a `fluidId`, and the Fluid holds the name. Rename "Cooling Water" to
 * "Chilled Water" and every line carrying it changes meaning while every edge
 * in the document is byte-identical. The colour is how it is drawn, not what
 * it is.
 */
function diffFluids(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  const was = byId(before.fluids ?? [])
  const now = byId(after.fluids ?? [])
  for (const [id, f] of was) {
    if (!now.has(id)) push({ kind: 'removed', entityType: 'fluid', entityId: id, entityKey: f.name, category: 'engineering' })
  }
  for (const [id, f] of now) {
    const old = was.get(id)
    if (!old) {
      push({ kind: 'added', entityType: 'fluid', entityId: id, entityKey: f.name, category: 'engineering' })
      continue
    }
    if (old.name !== f.name) push({ kind: 'modified', entityType: 'fluid', entityId: id, entityKey: f.name, field: 'name', before: old.name, after: f.name, category: 'engineering' })
    if (old.color !== f.color) push({ kind: 'modified', entityType: 'fluid', entityId: id, entityKey: f.name, field: 'color', before: old.color, after: f.color, category: 'graphical' })
  }
}

/**
 * Budget and unit prices.
 *
 * Included, but as METADATA. A changed install factor or unit-price override
 * moves every number in the cost estimate, so hiding it would leave a reviewer
 * unable to explain why the estimate moved — but it changes the commercial
 * view of the plant, not the plant, so it must not inflate the engineering
 * count a reviewer uses to decide whether the design changed. `PlantNode.cost`
 * is classified the same way for the same reason.
 */
function diffBudget(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  const was = before.budget
  const now = after.budget
  if (!was && !now) return
  const at = (field: string, b: DiffValue, a: DiffValue): DocChange =>
    ({ kind: 'modified', entityType: 'budget', entityId: 'budget', field, before: b, after: a, category: 'metadata' })
  if (was?.currency !== now?.currency) push(at('currency', was?.currency, now?.currency))
  if (was?.total !== now?.total) push(at('total', was?.total, now?.total))
  if (was?.installFactor !== now?.installFactor) push(at('installFactor', was?.installFactor, now?.installFactor))
  diffRecordMap(was?.overrides, now?.overrides, (f, b, a) => at(`price.${f}`, b, a), push)
}

/**
 * Imported symbol definitions.
 *
 * Revision-significant: a custom symbol's PORTS decide what may connect to it
 * and its tagRule decides how it is named, so editing a definition changes the
 * engineering meaning of every instance already on the sheets without touching
 * a single node. The SVG changes how it draws, which is graphical.
 */
function diffCustomSymbols(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  const was = byId(before.customSymbols ?? [])
  const now = byId(after.customSymbols ?? [])
  for (const [id, d] of was) {
    if (!now.has(id)) push({ kind: 'removed', entityType: 'custom-symbol', entityId: id, entityKey: d.name, category: 'engineering' })
  }
  for (const [id, d] of now) {
    const old = was.get(id)
    if (!old) {
      push({ kind: 'added', entityType: 'custom-symbol', entityId: id, entityKey: d.name, category: 'engineering' })
      continue
    }
    const at = (field: string, b: DiffValue, a: DiffValue, category: ChangeCategory): DocChange =>
      ({ kind: 'modified', entityType: 'custom-symbol', entityId: id, entityKey: d.name, field, before: b, after: a, category })
    if (json(old.ports) !== json(d.ports)) push(at('ports', json(old.ports), json(d.ports), 'engineering'))
    if (old.tagRule !== d.tagRule) push(at('tagRule', old.tagRule, d.tagRule, 'engineering'))
    if (old.svg !== d.svg) push(at('svg', 'changed', 'changed', 'graphical'))
    if (json(old.gridSize) !== json(d.gridSize)) push(at('gridSize', json(old.gridSize), json(d.gridSize), 'graphical'))
    if (old.name !== d.name) push(at('name', old.name, d.name, 'metadata'))
    if (old.keywords.join(',') !== d.keywords.join(',')) push(at('keywords', old.keywords.join(','), d.keywords.join(','), 'metadata'))
  }
}

/**
 * HMI pipes.
 *
 * `aId`/`bId` are the widget anchors the flow network attaches to
 * (`sim/network.ts` reads them to decide what connects to what), so they are
 * engineering topology. The drawn points, width and inherited service colour
 * are how that run is rendered.
 */
function diffPipes(b: HmiScreen, a: HmiScreen, push: (c: DocChange) => void) {
  const was = byId(b.pipes)
  const now = byId(a.pipes)
  for (const [id] of was) {
    if (!now.has(id)) push({ kind: 'removed', entityType: 'hmi-pipe', entityId: id, category: 'engineering' })
  }
  for (const [id, pipe] of now) {
    const old = was.get(id)
    if (!old) {
      push({ kind: 'added', entityType: 'hmi-pipe', entityId: id, category: 'engineering' })
      continue
    }
    const at = (field: string, bv: DiffValue, av: DiffValue, category: ChangeCategory): DocChange =>
      ({ kind: 'modified', entityType: 'hmi-pipe', entityId: id, field, before: bv, after: av, category })
    if (old.aId !== pipe.aId) push(at('aId', old.aId, pipe.aId, 'engineering'))
    if (old.bId !== pipe.bId) push(at('bId', old.bId, pipe.bId, 'engineering'))
    if (json(old.points) !== json(pipe.points)) push(at('points', json(old.points), json(pipe.points), 'graphical'))
    if (old.width !== pipe.width) push(at('width', old.width, pipe.width, 'graphical'))
    if (old.color !== pipe.color) push(at('color', old.color, pipe.color, 'graphical'))
    if (old.flowRef !== pipe.flowRef) push(at('flowRef', old.flowRef, pipe.flowRef, 'metadata'))
  }
}

/**
 * Findings an engineer explicitly accepted.
 *
 * Persisted decisions, not transient checker state: "we looked at this and it
 * is fine, here is why". Between two issues, which of those were added or
 * withdrawn is exactly the kind of thing a reviewer asks about. Only the
 * add/remove is reported — the reasons live on the record.
 */
function diffAcceptedFindings(before: ProjectDoc, after: ProjectDoc, push: (c: DocChange) => void) {
  const was = before.qa?.ignored ?? {}
  const now = after.qa?.ignored ?? {}
  for (const k of Object.keys(was)) {
    if (!now[k]) push({ kind: 'removed', entityType: 'qa-accepted', entityId: k, entityKey: k, category: 'engineering' })
  }
  for (const k of Object.keys(now)) {
    if (!was[k]) push({ kind: 'added', entityType: 'qa-accepted', entityId: k, entityKey: k, category: 'engineering' })
  }
}

/**
 * The coverage LEDGER.
 *
 * Typed over `keyof ProjectDoc`, so adding a field to the document will not
 * compile until someone decides whether a revision comparison should report
 * it. That is the whole point: the previous failure here was silent omission,
 * and a list that has to be updated by hand would have been forgotten exactly
 * as `issueStatuses` was in the standard file.
 */
export const DOC_FIELD_COVERAGE: Record<keyof ProjectDoc, 'compared' | string> = {
  sheets: 'compared',
  registry: 'compared',
  hmiScreens: 'compared',
  standard: 'compared',
  fluids: 'compared',
  budget: 'compared',
  customSymbols: 'compared',
  qa: 'compared',
  areas: 'compared',
  units: 'compared',
  // Compared by stable id and displayed by number. MEMBERSHIP is compared on
  // the record (`loopId` below), not here, so a member moving is one change
  // rather than two.
  loops: 'compared',
  schemaVersion: 'Excluded: a migration artefact, identical for two snapshots of one project.',
  // The controlled-document identity fields. META_FIELD_COVERAGE above is the
  // second ledger, saying which of them are compared and which are timestamps.
  meta: 'compared',
  settings: 'Excluded: gridPx is a view preference, and tagSeparator/numberStart are the legacy home of settings the standard now owns (see migrate.ts) — reporting both would double-count one change.',
}

/**
 * The RECORD coverage ledger.
 *
 * `diffRegistry` compares `fields` generically — every signal, alarm and
 * general key a record carries is picked up without being named. Everything
 * BESIDE that bag is compared by hand, and a hand-written list is the thing
 * that quietly forgets. Typed over `keyof EngineeringRecord`, so a new
 * top-level property on a record will not compile until someone decides
 * whether a revision comparison should report it.
 */
export const RECORD_FIELD_COVERAGE: Record<keyof EngineeringRecord, 'compared' | string> = {
  fields: 'compared — every key, generically, so new engineering fields need no change here',
  status: 'compared',
  owner: 'compared',
  unitId: 'compared — by stable id, displayed as AREA/UNIT codes',
  loopId: 'compared — by stable id, displayed as the loop NUMBER, so renumbering a loop stays one change on the loop rather than one per member',
  nozzles: 'compared — nozzle by nozzle, matched on stable id and named by NUMBER, so reordering the schedule reports nothing and renumbering one reports one change',
  // METADATA rather than engineering, for the reason `owner` is: a review
  // comment does not change the plant. It IS something somebody decided
  // between two issues, so it is reported.
  //
  // Matched on the thread's stable id and each note's, so reordering reports
  // nothing and a reply is one change rather than a rewritten conversation.
  // `at` is EXCLUDED from the comparison — a timestamp is not an engineering
  // change, exactly as `updated` below is excluded — while `by` is compared,
  // because who said it is part of what was said. Threads carry no severity
  // and reach neither QA nor issue gating; see model/review.ts.
  comments: 'compared — thread by thread and note by note, matched on stable ids, named by the opening words; timestamps excluded, authors compared',
  key: 'Excluded: it IS the identity the comparison is keyed on; a changed key is a rename, reported on the node.',
  kind: 'Excluded: derived from the object that wears the tag, and a change there is already reported as the node changing kind.',
  rev: 'Excluded: stamped BY issuing, so comparing it across two issues reports the act of comparing.',
  updated: 'Excluded: a timestamp that moves on every keystroke — pure noise.',
}

/* --------------------------------------------------------------- revisions */

export type CompareFailure =
  | { ok: false; reason: 'missing-before' | 'missing-after' | 'missing-both'; message: string }

export type CompareResult = { ok: true; diff: DocDiff } | CompareFailure

/**
 * Compare two ISSUED revisions from their stored snapshots.
 *
 * If a snapshot is not on this machine the comparison is refused. It is never
 * substituted with the live document: a diff that silently compares "Rev A" to
 * "right now" and labels it "Rev A to Rev B" is worse than no answer, because
 * the reader has no way to tell.
 */
export function compareRevisions(
  a: Revision,
  b: Revision,
  snapshots: { before: ProjectDoc | undefined; after: ProjectDoc | undefined },
): CompareResult {
  const missingBefore = !snapshots.before
  const missingAfter = !snapshots.after
  if (missingBefore || missingAfter) {
    const reason = missingBefore && missingAfter ? 'missing-both' : missingBefore ? 'missing-before' : 'missing-after'
    const which =
      reason === 'missing-both' ? `Revisions ${a.code} and ${b.code} have no stored snapshots`
        : reason === 'missing-before' ? `Revision ${a.code} has no stored snapshot`
        : `Revision ${b.code} has no stored snapshot`
    return { ok: false, reason, message: `${which} on this machine, so there is nothing to compare against. Snapshots stay on the computer that issued them.` }
  }
  return {
    ok: true,
    diff: compareDocs(snapshots.before!, snapshots.after!, { before: a.qaAtIssue, after: b.qaAtIssue }),
  }
}
