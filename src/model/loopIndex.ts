// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Loop evaluations, derived once per index.
 *
 * WHY THIS IS A SEPARATE MODULE. `model/loop.ts` is pure and knows nothing
 * about the index; `model/projectIndex.ts` cannot evaluate loops because a
 * verdict needs the finished index. This sits above both and imports each, so
 * neither has to reach for the other.
 *
 * WHY IT IS MEMOISED. Three of the seven loop rules ask the same question of
 * the same loops — is it complete, does it have a type, do its signals agree —
 * and measured on a 500-instrument project with 125 loops they were paying for
 * three separate passes of `membersOf` + `evaluateLoop`. A `ProjectIndex` is
 * built fresh per document and never mutated, so an evaluation derived from one
 * can only ever have a single value; caching on its identity is safe for the
 * same reason `deriveIoList`'s memo is.
 *
 * The returned array and its evaluations are SHARED. Treat them as read-only,
 * like `qaFor`'s report.
 */

import type { ProjectIndex } from './projectIndex'
import { evaluateLoop, type Loop, type LoopEvaluation, type LoopMember } from './loop'
import { placementOf } from './hierarchy'

export interface LoopView {
  loop: Loop
  members: LoopMember[]
  evaluation: LoopEvaluation
  /** First drawn member, so a report or a panel can jump somewhere. */
  anchor?: { targetId: string; sheetId: string }
  /**
   * The distinct, EXISTING units the members are assigned to, sorted by code.
   *
   * A loop owns no `unitId` of its own — a record names its unit, the unit
   * names its area, and a third copy on the loop would be a third answer to
   * one question (model/hierarchy.ts says this about areas; it is the same
   * argument one level up). So it is derived, once, here — and the Loop
   * Manager, the Loop list and `loop-units-conflict` all read THIS rather than
   * each walking the members again and eventually disagreeing.
   *
   * Unassigned members contribute nothing, and a member assigned to a unit
   * that has been deleted is left out: that is `record-orphan-unit`'s finding,
   * and counting it here would report one mistake as two.
   */
  unitIds: string[]
}

/**
 * The members of one loop, as `evaluateLoop` needs to see them.
 *
 * `drawn` comes off `nodesByKey` — the index already knows which keys are worn
 * by something on a sheet. A record whose symbol was deleted is still a member
 * (model/registry.ts makes records outlive symbols on purpose) and its loop
 * reads BROKEN rather than incomplete, which is a different problem with a
 * different fix.
 */
function membersOf(ix: ProjectIndex, loopId: string): LoopMember[] {
  const keys = ix.loopMembers.get(loopId) ?? []
  return keys.map((key) => {
    const node = ix.nodesByKey.get(key)?.[0]?.node
    return { key, letters: node?.tag?.letters ?? '', drawn: Boolean(node) }
  })
}

function anchorOf(ix: ProjectIndex, loopId: string): LoopView['anchor'] {
  for (const key of ix.loopMembers.get(loopId) ?? []) {
    const hit = ix.nodesByKey.get(key)?.[0]
    if (hit) return { targetId: hit.node.id, sheetId: hit.sheet.id }
  }
  return undefined
}

const VIEWS = new WeakMap<ProjectIndex, LoopView[]>()

/**
 * Every persistent loop with its members and its verdict, in a FIXED order.
 *
 * Sorted by `id` — the stable identity — rather than by number, which the user
 * is expected to change, or by array position, which ordinary editing
 * reorders. Two runs over one document therefore report identically, which is
 * what lets a QA finding be tracked from one revision to the next.
 *
 * Empty for every document that has declared no loops, which is every document
 * written before they existed.
 */
export function loopViews(ix: ProjectIndex): LoopView[] {
  const hit = VIEWS.get(ix)
  if (hit) return hit

  const loops = [...(ix.doc.loops ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  const views = loops.map((loop) => {
    const members = membersOf(ix, loop.id)
    const anchor = anchorOf(ix, loop.id)
    const units = new Set<string>()
    for (const m of members) {
      const unitId = ix.records[m.key]?.unitId
      if (unitId && ix.hierarchy.unitById.has(unitId)) units.add(unitId)
    }
    const unitIds = [...units].sort((a, b) =>
      (ix.hierarchy.unitById.get(a)?.code ?? a).localeCompare(ix.hierarchy.unitById.get(b)?.code ?? b))
    return {
      loop,
      members,
      evaluation: evaluateLoop(loop, members),
      ...(anchor ? { anchor } : {}),
      unitIds,
    }
  })
  VIEWS.set(ix, views)
  return views
}

/**
 * Where a loop sits in the plant, as a reader sees it.
 *
 * ONE formatter, so the Loop Manager and the Loop list cannot describe the
 * same loop two ways. `Mixed units` is a real answer, not a failure: a
 * transmitter in the process unit feeding a controller filed under the control
 * room is a legitimate arrangement, and `loop-units-conflict` is what decides
 * whether it is worth a warning.
 */
export function loopPlaceLabel(ix: ProjectIndex, view: LoopView): string {
  if (view.unitIds.length === 0) return 'Unassigned'
  if (view.unitIds.length > 1) return `Mixed units (${view.unitIds.length})`
  const place = placementOf(ix.hierarchy, view.unitIds[0])
  if (!place.unit) return 'Unassigned'
  return place.area ? `${place.area.code} / ${place.unit.code}` : place.unit.code
}
