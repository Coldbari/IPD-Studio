// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Turning a DERIVED loop into a PERSISTENT one, on purpose and never otherwise.
 *
 * `deriveLoops()` groups tagged symbols on (first ISA letter, loop number).
 * That grouping is an observation about how things are numbered. A persistent
 * Loop is a declaration about what the plant IS — it carries a type, it can
 * span measured-variable families, and a revision diff tracks it. Promoting one
 * to the other is an engineering decision, so this module plans and the user
 * decides.
 *
 * MODELLED ON `planLegacyMapping` (model/hierarchy.ts), deliberately, down to
 * the three verdicts: pure, deterministic, idempotent, and refusing wherever a
 * mapping cannot be proven. That module's rule was "the only safe mapping is an
 * exact, unique unit code"; the rule here is the same shape.
 *
 * WHAT IS NEVER USED TO MATCH: canvas position, visual proximity, string
 * similarity, or any fuzzy comparison of tags. The mapping runs on engineering
 * identity — `keyOfNode`, the same key the registry files a record under — and
 * on the structured ISA parse. Where identity cannot be established the row is
 * `attention` and the user is told why.
 *
 * Nothing here writes. `applyLoopAdoption` in the store is the only thing that
 * does, and it re-checks every row against the live document first.
 */

import type { ProjectIndex } from './projectIndex'
import { classifyMember, suggestLoopType, emptyRoles, type LoopType, type MemberRole } from './loop'
import { loopNumberKey } from './loop'
import { formatTag } from '../isa/tag'

export type AdoptVerdict = 'adopt' | 'skip' | 'attention'

export interface AdoptionRow {
  /** How the drawer already names this derived loop: 'F-101'. Also the number
   *  the persistent loop would be created with — see `loopNumber`. */
  ref: string
  /** The derived grouping's two halves, kept so a caller can show them apart. */
  family: string
  number: string
  /** Registry keys that would become members, sorted. Never node ids. */
  members: string[]
  /** Members left out because they carry no engineering identity — a tagged
   *  ANNOTATION is the real case, since `keyOfNode` excludes them. Named, never
   *  silently dropped. */
  excluded: string[]
  /** Only when `suggestLoopType` could decide. Absent is normal and fine. */
  suggestedType?: LoopType
  verdict: AdoptVerdict
  /** Why, in the words shown beside the row. */
  reason: string
  /**
   * The number to create the persistent Loop with, set only on `adopt`.
   *
   * It is the FULL derived ref — 'F-101', not '101'. Two derived loops can
   * share a bare number (F-101 and P-101 are different loops), and adopting
   * both as '101' would mint a duplicate-loop-number finding out of a
   * migration. The ref is unique across derived loops by construction.
   */
  loopNumber?: string
}

export interface AdoptionPlan {
  rows: AdoptionRow[]
  adopt: AdoptionRow[]
  needsAttention: AdoptionRow[]
  skipped: AdoptionRow[]
}

/** Members' roles, for the type suggestion. Only DRAWN members with letters —
 *  which, coming from a derived loop, is all of them. */
function rolesOfKeys(ix: ProjectIndex, keys: string[]): Record<MemberRole, string[]> {
  const roles = emptyRoles()
  for (const key of keys) {
    const letters = ix.nodesByKey.get(key)?.[0]?.node.tag?.letters
    if (letters) roles[classifyMember(letters)].push(key)
  }
  return roles
}

/**
 * What adopting the derived loops WOULD do, computed without doing any of it.
 *
 * Deterministic and idempotent: derived loops arrive sorted from
 * `deriveLoops`, member keys are sorted, and a loop whose members are already
 * assigned comes back as `skip`, so running it over an adopted project
 * produces an empty `adopt` list rather than a second copy of everything.
 */
export function planLoopAdoption(ix: ProjectIndex): AdoptionPlan {
  const rows: AdoptionRow[] = []
  const takenNumbers = new Map<string, string>()
  for (const loop of ix.doc.loops ?? []) takenNumbers.set(loopNumberKey(loop.number), loop.number)

  for (const derived of ix.loops) {
    const ref = `${derived.family}-${derived.loop}`
    const base = { ref, family: derived.family, number: derived.loop }

    // Split the members by whether they carry an engineering identity at all.
    // `keyOfNode` excludes annotations, so a tagged note joins a derived loop
    // (deriveLoops does not filter by kind) and can never carry a record.
    const members = new Set<string>()
    const excluded: string[] = []
    for (const m of derived.members) {
      const key = ix.nodes.get(m.nodeId)?.key
      if (key) members.add(key)
      else excluded.push(formatTag(m.tag, '-'))
    }
    const keys = [...members].sort()
    excluded.sort()

    const roles = rolesOfKeys(ix, keys)
    const suggested = suggestLoopType(roles)
    const row = (verdict: AdoptVerdict, reason: string, extra: Partial<AdoptionRow> = {}): AdoptionRow => ({
      ...base,
      members: keys,
      excluded,
      ...(suggested ? { suggestedType: suggested } : {}),
      verdict,
      reason,
      ...extra,
    })

    // 1. Unsupported membership. Refused rather than adopted-without, because
    //    the loop the user is looking at in the drawer is not the loop they
    //    would get, and a migration that quietly drops a member is the worst
    //    kind.
    if (excluded.length > 0) {
      rows.push(row('attention', `${excluded.join(', ')} ${excluded.length === 1 ? 'carries' : 'carry'} no engineering record — an annotation cannot be a loop member. Retag or remove ${excluded.length === 1 ? 'it' : 'them'} first.`))
      continue
    }

    // 2. Not enough to be a loop. `instrument-not-in-loop` already reports a
    //    lone instrument as info; minting a one-member Loop adds nothing.
    if (keys.length < 2) {
      rows.push(row('skip', keys.length === 0
        ? 'No members with an engineering record.'
        : `Only ${keys[0]} is numbered ${ref} — a loop of one is not worth declaring.`))
      continue
    }

    // 3. What the members are ALREADY assigned to. This is where idempotence
    //    lives, and where anything uncertain stops.
    const assigned = new Map<string, string[]>()
    const unassigned: string[] = []
    for (const key of keys) {
      const loopId = ix.loopOfKey.get(key)
      if (loopId) assigned.set(loopId, [...(assigned.get(loopId) ?? []), key])
      else unassigned.push(key)
    }

    if (assigned.size > 1) {
      const numbers = [...assigned.keys()]
        .map((id) => ix.loopsById.get(id)?.number ?? id)
        .sort((a, b) => a.localeCompare(b))
      rows.push(row('attention', `Its members are already split across ${assigned.size} loops (${numbers.join(', ')}) — which one this should be is not something to guess.`))
      continue
    }

    if (assigned.size === 1) {
      const [loopId, owned] = [...assigned.entries()][0]!
      const number = ix.loopsById.get(loopId)?.number ?? loopId
      if (unassigned.length === 0) {
        rows.push(row('skip', `Already adopted as Loop ${number}.`))
      } else {
        // Deliberately NOT "assign the rest too". Some members being out is a
        // decision somebody may have made on purpose, and re-making it here
        // would be the migration overruling the engineer.
        rows.push(row('attention', `${owned.length} of ${keys.length} members already belong to Loop ${number}; ${unassigned.join(', ')} ${unassigned.length === 1 ? 'does' : 'do'} not. Assign the rest from the Loop Manager if that is what you want.`))
      }
      continue
    }

    // 4. Nothing assigned yet. The only remaining obstacle is the number.
    const clash = takenNumbers.get(loopNumberKey(ref))
    if (clash !== undefined) {
      rows.push(row('attention', `Loop ${clash} already exists and nothing is assigned to it from here. Adopting would create a second loop numbered ${ref}.`))
      continue
    }

    rows.push(row('adopt', `${keys.length} members${suggested ? `, looks like a ${suggested} loop` : ''}.`, { loopNumber: ref }))
  }

  return {
    rows,
    adopt: rows.filter((r) => r.verdict === 'adopt'),
    needsAttention: rows.filter((r) => r.verdict === 'attention'),
    skipped: rows.filter((r) => r.verdict === 'skip'),
  }
}
