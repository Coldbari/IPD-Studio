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

export interface LoopView {
  loop: Loop
  members: LoopMember[]
  evaluation: LoopEvaluation
  /** First drawn member, so a report or a panel can jump somewhere. */
  anchor?: { targetId: string; sheetId: string }
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
    return {
      loop,
      members,
      evaluation: evaluateLoop(loop, members),
      ...(anchor ? { anchor } : {}),
    }
  })
  VIEWS.set(ix, views)
  return views
}
