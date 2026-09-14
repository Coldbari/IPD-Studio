// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE NOZZLE SCHEDULE, derived.
 *
 * One row per PERSISTENT nozzle — the ones an engineer entered on a record's
 * schedule (model/nozzle.ts) — never one per connection point on a symbol. A
 * `vessel.vertical` carries eleven ports and a real vessel might have four
 * nozzles; manufacturing seven from the catalogue would be the software
 * inventing equipment. The rule P3-4A stated for the DEXPI projection holds
 * here unchanged: a port is not a nozzle.
 *
 * NOTHING IS PERSISTED. `EngineeringRecord.nozzles` stays the only store, and
 * every other cell in the table is computed from the drawing on each read, so
 * the schedule cannot drift the way a maintained spreadsheet does. This is the
 * same shape as `deriveIoList`: pure, DOM-free, one `ProjectIndex` in, plain
 * rows out. It never calls `buildIndex` — the caller has already paid for one.
 *
 * WHAT IT REFUSES TO SAY. Nothing about size, rating, facing or service is
 * read off the connected line; those are blank until an engineer types them.
 * No flow direction, no inlet/outlet, no head/shell, and no port NAME unless
 * the catalogue itself establishes one — a nozzle at the top of a vessel is
 * not an inlet because it is at the top.
 *
 * THE ORPHAN IS NOT HIDDEN. A record whose symbol has been deleted keeps its
 * nozzles and keeps its rows, marked `not drawn`. That is the whole point of
 * keying engineering data by tag: delete-and-redraw is normal drafting, and a
 * schedule that quietly shortened itself would under-report the plant.
 */

import type { ProjectIndex } from './projectIndex'
import { edgesOf, portIdsOfKey } from './projectIndex'
import type { Run } from './run'
import { isPortEnd } from './types'
import { isProcessClass } from '../canvas/lineStyle'
import { nozzlesOf } from './nozzle'
import { getSymbol } from '../symbols/registry'
import { labelOfPort } from '../symbols/portLabels'
import { areaCodeOf, unitCodeOf } from './hierarchy'

/**
 * Where a nozzle stands between the schedule and the drawing. A FACT, never a
 * verdict: four of the six states are perfectly ordinary, and none of them is
 * a finding. The two that do mean something broken — `not drawn` and
 * `port missing` — are already reported by `orphan-record` and
 * `nozzle-port-missing`, which own them. This column restates what those rules
 * already know so a reader of the schedule can see it without opening Checks;
 * it is deliberately not a second validation system.
 *
 *  - `not located`    — no `portId`. A schedule legitimately runs ahead of the
 *                       drawing, so this is where most nozzles start.
 *  - `not drawn`      — nothing on any sheet wears the record's tag.
 *  - `port missing`   — the `portId` names no connection point any placement
 *                       currently has.
 *  - `no line`        — the port resolves and no process line is on it. A
 *                       spare or blanked nozzle is drawn exactly like this.
 *  - `connected`      — one process line.
 *  - `multiple lines` — more than one. A tee drawn at the nozzle is ordinary.
 */
export type NozzleStatus =
  | 'not located'
  | 'not drawn'
  | 'port missing'
  | 'no line'
  | 'connected'
  | 'multiple lines'

export interface NozzleScheduleRow {
  /**
   * Row identity: the record key and the nozzle's stable id.
   *
   * NOT a node id, and never an array index. One piece of equipment has many
   * nozzles and therefore many rows, so the drawn node cannot identify a row —
   * which is exactly the duplicate-key problem this field exists to solve.
   * `checkNozzles` only guarantees ids are unique WITHIN a record, so the key
   * is part of it.
   */
  rowId: string
  /** The owning record's key — the equipment tag. Always present: a nozzle
   *  cannot exist without a record, and a record cannot exist without a key. */
  key: string
  /** The nozzle's stable id. Never displayed. */
  nozzleId: string
  /** First drawn placement, for navigation. Empty when nothing is drawn. */
  nodeId: string
  sheetId: string

  /* --- derived from the drawing. Arrays, because one tag may be placed more
     than once and two placements may legitimately disagree. Distinct and
     sorted; the report layer joins them with the shared `joinDistinct`, the
     same convention the line list uses for a run carrying two records. */
  labels: string[]
  symbols: string[]
  sheetNames: string[]
  /** Authoritative catalogue port names only — see `portNames` below. */
  portNames: string[]
  /** Every line number on the runs this nozzle's port carries. */
  lineNumbers: string[]

  /* ------------------------------------- persistent, straight off the nozzle */
  number: string
  size: string
  rating: string
  facing: string
  service: string
  /** The stored `portId`, exactly as stored. A reference, not an identity. */
  portId: string
  notes: string

  status: NozzleStatus
  /** Resolved from the RECORD's unit assignment, never from the drawing. */
  areaCode: string
  unitCode: string
}

/** Distinct, non-empty, sorted — so two derivations of one document agree. */
const distinct = (values: readonly (string | undefined)[]): string[] =>
  [...new Set(values.filter((v): v is string => !!v))].sort()

/** Symbol display name, degrading to the raw id rather than throwing — the
 *  same guard `projectIndex.portsOfNode` and the CSV reports already make for
 *  a custom symbol that is not registered at the moment a report runs. */
function symbolName(symbolId: string): string {
  try {
    return getSymbol(symbolId).name
  } catch {
    return symbolId
  }
}

/**
 * Every nozzle in the document, in the one order two builds always agree on.
 *
 * RECORDS SORTED BY KEY, then nozzles in STORED ORDER. Stored order carries no
 * engineering meaning — the store appends, and the diff matches on id so
 * reordering reports nothing — but it is what the Inspector shows, and a
 * deliverable that listed a vessel's nozzles in a different order from the
 * panel they were typed into would be two answers to one question. Sorting by
 * number instead would need numeric collation this product has not invented:
 * `localeCompare` puts N10 between N1 and N2.
 *
 * EVERY record with nozzles is included, not only those of kind `equipment`.
 * The panel offers the schedule on equipment alone, so that is all any
 * document written by this product holds — but a nozzle filed anywhere else is
 * engineering data somebody entered, and hiding it would be worse than showing
 * it under the tag it is filed against.
 */
export function deriveNozzleSchedule(ix: ProjectIndex): NozzleScheduleRow[] {
  // Nothing to do for every project that has not adopted nozzles, which is
  // every project written before they existed. The same early return
  // `loopListRows` makes for a document that has declared no loops.
  const keys = Object.keys(ix.records).filter((k) => nozzlesOf(ix.records[k]).length > 0)
  if (keys.length === 0) return []
  keys.sort()

  // ONE map for the whole schedule. `ix.runs` is an array, so a `find` per
  // nozzle would make this quadratic in the number of runs.
  const runById = new Map<string, Run>(ix.runs.map((r) => [r.id, r]))

  const rows: NozzleScheduleRow[] = []
  for (const key of keys) {
    const record = ix.records[key]!
    const drawn = ix.nodesByKey.get(key) ?? []
    const available = portIdsOfKey(ix, key)

    // Per-record and therefore computed once, not once per nozzle.
    const labels = distinct(drawn.map((d) => d.node.label))
    const symbols = distinct(drawn.map((d) => symbolName(d.node.symbolId)))
    const sheetNames = distinct(drawn.map((d) => d.sheet.name))
    const areaCode = areaCodeOf(ix.hierarchy, record.unitId)
    const unitCode = unitCodeOf(ix.hierarchy, record.unitId)

    for (const nozzle of nozzlesOf(record)) {
      const portId = nozzle.portId ?? ''

      // Process edges on this port, across every placement of the tag. A
      // signal line is not piping and is not counted: `isProcessClass` is the
      // product's one answer to "is this pipe", and `runOfEdge` has no entry
      // for anything else, so forcing one in would fabricate a run.
      const edgeIds = new Set<string>()
      const runNumbers: string[] = []
      if (portId && available.has(portId)) {
        for (const placement of drawn) {
          for (const edge of edgesOf(ix, placement.node.id)) {
            if (!isProcessClass(edge.lineClass)) continue
            const onPort = [edge.source, edge.target].some(
              (end) => isPortEnd(end) && end.nodeId === placement.node.id && end.portId === portId,
            )
            if (!onPort || edgeIds.has(edge.id)) continue
            edgeIds.add(edge.id)
            const runId = ix.runOfEdge.get(edge.id)
            const run = runId ? runById.get(runId) : undefined
            // The run's OWN numbers, whatever it has: one for an ordinary
            // line, several for a header carrying its branches', none at all
            // for an unnumbered run. Nothing is invented for the last case —
            // the cell is simply blank, as the line list leaves it.
            if (run) runNumbers.push(...run.numbers)
          }
        }
      }

      // Only where the CATALOGUE names the point. A positional description
      // ("Top connection") is true of every symbol and says nothing about what
      // the connection is for, so it must never print in an engineering
      // column. This is the P3-4A rule, unchanged.
      const portNames = distinct(
        portId
          ? drawn.map((d) => {
              const label = labelOfPort(d.node, portId)
              return label?.authoritative ? label.text : undefined
            })
          : [],
      )

      rows.push({
        // NUL as the separator: a record key is user-supplied and could
        // otherwise collide with an id across the join. The same escape the
        // Data workspace's own `cellId` uses.
        rowId: `${key}\u0000${nozzle.id}`,
        key,
        nozzleId: nozzle.id,
        nodeId: drawn[0]?.node.id ?? '',
        sheetId: drawn[0]?.sheet.id ?? '',
        labels,
        symbols,
        sheetNames,
        portNames,
        lineNumbers: distinct(runNumbers),
        number: nozzle.number,
        size: nozzle.size ?? '',
        rating: nozzle.rating ?? '',
        facing: nozzle.facing ?? '',
        service: nozzle.service ?? '',
        portId,
        notes: nozzle.notes ?? '',
        status: statusOf(drawn.length > 0, portId, available, edgeIds.size),
        areaCode,
        unitCode,
      })
    }
  }
  return rows
}

/**
 * The six states, in the order they are decided.
 *
 * NOT DRAWN WINS FIRST, even over a nozzle with no `portId`. With nothing on a
 * sheet there are no connection points to check against, so every question
 * below it is unanswerable rather than answered — which is exactly why
 * `nozzle-port-missing` skips an undrawn record too, leaving `orphan-record`
 * to say it once.
 */
function statusOf(
  isDrawn: boolean,
  portId: string,
  available: ReadonlySet<string>,
  processEdges: number,
): NozzleStatus {
  if (!isDrawn) return 'not drawn'
  if (!portId) return 'not located'
  if (!available.has(portId)) return 'port missing'
  if (processEdges === 0) return 'no line'
  return processEdges === 1 ? 'connected' : 'multiple lines'
}

/**
 * Equipment records carrying no nozzles at all.
 *
 * Reported beside the schedule for the reason the I/O list reports its
 * `excluded` count: a reader has to be able to tell an exclusion from an
 * omission. "Fourteen nozzles" means something different from "fourteen
 * nozzles, and nine other vessels have none entered yet", and the second is
 * what a schedule is usually read to find out.
 */
export function countEquipmentWithoutNozzles(ix: ProjectIndex): number {
  let n = 0
  for (const key of Object.keys(ix.records)) {
    const record = ix.records[key]!
    if (record.kind === 'equipment' && nozzlesOf(record).length === 0) n++
  }
  return n
}
