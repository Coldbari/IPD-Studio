// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Checks on PERSISTENT loops — the entity in `doc.loops`, not the grouping
 * `deriveLoops()` computes from tag numbers.
 *
 * THE TWO MODELS COEXIST, AND THESE RULES TOUCH ONLY ONE. `instrument-not-in-loop`,
 * `no-receiver` and `no-final-element` go on reading `ix.loops`, the derived
 * grouping, exactly as they did; nothing here changes what they report. A
 * project that has declared no persistent loops therefore gets no finding from
 * this file at all — every rule below starts by iterating `doc.loops`, which
 * is empty, or the records that reference one, of which there are none.
 *
 * That is deliberate and it is the whole migration strategy: adoption is
 * opt-in, so the checker must stay silent until someone opts in.
 *
 * WHAT "COMPLETE" MEANS HERE. Structure, and only structure — that the roles
 * the declared or safely-suggested loop type requires are present. Not that
 * the scheme is right, not that the correct variable is measured, not that it
 * will control. `evaluateLoop` (model/loop.ts) owns that judgement and every
 * message below repeats its limits, because a QA report that let a green tick
 * read as engineering approval would be worse than no report.
 */

import type { Rule, RuleFinding } from '../rules'
import { finding } from '../rules'
import { danglingLoopMembers, duplicateLoopNumbers, type Loop } from '../../model/loop'
import { loopViews, type LoopView } from '../../model/loopIndex'
import { deriveIoList } from '../../model/ioList'
import { placementOf } from '../../model/hierarchy'

/** Where a finding about a loop points: its first drawn member, so the report
 *  can jump to something. Absent when nothing of the loop is on a sheet. */
const at = (v: LoopView) => (v.anchor ? { targetId: v.anchor.targetId, sheetId: v.anchor.sheetId } : {})

const label = (loop: Loop) => (loop.name ? `Loop ${loop.number} (${loop.name})` : `Loop ${loop.number}`)

/* ------------------------------------------------------------- 1. orphans */

/**
 * A membership pointing at a loop that is not there.
 *
 * Critical, and the twin of `record-orphan-unit`: the object reads as assigned
 * everywhere it is listed and belongs to nothing. Keyed by the RECORD, because
 * the record is what is wrong and what the fix acts on — several records
 * stranded by one deleted loop are several findings, each acceptable on its
 * own.
 */
export const recordOrphanLoop: Rule = {
  id: 'record-orphan-loop',
  title: 'Objects assigned to a Loop that no longer exists',
  severity: 'critical',
  discipline: 'data',
  why: 'The object reads as belonging to a loop everywhere it is listed, and the loop is not in this project.',
  run(ix) {
    const out: RuleFinding[] = []
    // Already sorted by key, so the order is fixed without sorting again.
    for (const { key } of danglingLoopMembers(ix.doc.loops, ix.doc.registry)) {
      const first = ix.nodesByKey.get(key)?.[0]
      out.push(
        finding(recordOrphanLoop, key, `${key} is assigned to a Loop that is not in this project`, {
          ...(first ? { targetId: first.node.id, sheetId: first.sheet.id } : {}),
          fix: { label: 'Clear the loop assignment', spec: { kind: 'clear-loop', key } },
        }),
      )
    }
    return out
  },
}

/* ---------------------------------------------------------- 2. duplicates */

/**
 * Two loops wearing one number.
 *
 * Critical rather than the warning `duplicate-unit-code` gets, and the
 * difference is real: a unit code is scoped by its area and `resolveUnitByCode`
 * disambiguates on that, so two units numbered 101 are still resolvable. A loop
 * number has no scope. "The loop diagram for 101" is undefined, and so is every
 * deliverable filed under it.
 *
 * Reported, never repaired. Renumbering is an engineering decision and an
 * automatic one would rewrite an identity somebody chose.
 */
export const duplicateLoopNumber: Rule = {
  id: 'duplicate-loop-number',
  title: 'Loop number used twice',
  severity: 'critical',
  discipline: 'data',
  why: 'A loop number identifies the loop on its diagram, its datasheets and in the control system. Two loops wearing one number leaves every one of those pointing at a question.',
  run(ix) {
    const out: RuleFinding[] = []
    const views = loopViews(ix)
    const groups = [...duplicateLoopNumbers(ix.doc.loops).entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [, loops] of groups) {
      const sorted = [...loops].sort((a, b) => a.id.localeCompare(b.id))
      for (const loop of sorted) {
        const others = sorted.length - 1
        const view = views.find((v) => v.loop.id === loop.id)
        out.push(
          finding(
            duplicateLoopNumber,
            loop.id,
            `${label(loop)} shares its number with ${others} other loop${others === 1 ? '' : 's'} in this project`,
            { key: `${duplicateLoopNumber.id}:${loop.id}`, ...(view ? at(view) : {}) },
          ),
        )
      }
    }
    return out
  },
}

/* -------------------------------------------------------- 3. completeness */

/**
 * A loop missing a part the kind of loop it is requires.
 *
 * Warning, sitting exactly where `no-receiver` and `no-final-element` sit: a
 * real engineering gap that is also genuinely unfinished on plenty of
 * early-stage drawings.
 *
 * ONLY fires on `incomplete`. `broken` is already reported by `orphan-record`
 * against the member that is not drawn, and saying it twice would be noise;
 * `unknown` and `not-applicable` are verdicts, not faults; and an EMPTY loop is
 * `loop-empty`'s (info) business, not a warning.
 */
export const loopIncomplete: Rule = {
  id: 'loop-incomplete',
  title: 'Loops missing a part the loop type requires',
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'This checks structure only — which roles the stated loop type needs — never whether the control scheme is the right one.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const view of loopViews(ix)) {
      if (view.members.length === 0) continue
      if (view.evaluation.completeness !== 'incomplete') continue
      out.push(
        finding(
          loopIncomplete,
          view.loop.id,
          `${label(view.loop)} is structurally incomplete — it needs ${view.evaluation.missing.join(' and ')}. `
            + 'This checks structure only, not whether the scheme is correct.',
          { key: `${loopIncomplete.id}:${view.loop.id}`, ...at(view) },
        ),
      )
    }
    return out
  },
}

/* ---------------------------------------------------------- 4. unit split */

/**
 * One loop, members in two Units.
 *
 * Warning, not critical, because it is sometimes right: a field transmitter in
 * the process unit feeding a controller filed under the control room is a real
 * arrangement. It is usually a mis-assignment, which is what a warning is for.
 *
 * UNASSIGNED MEMBERS ARE IGNORED — not counted as a third unit, not treated as
 * a conflict. Whether an object must belong to a unit at all is a house
 * decision the standard already expresses. And the AREA is never the subject:
 * two units of one area is still two units, and one unit cannot be in two
 * areas. Nothing here reads `general.area` free text or a symbol's position.
 */
export const loopUnitsConflict: Rule = {
  id: 'loop-units-conflict',
  title: 'Loops whose members belong to different Units',
  severity: 'warning',
  discipline: 'data',
  why: 'A loop split across units is cut into two packages, two I/O cabinets and two commissioning systems. Sometimes that is the design; more often one member was filed in the wrong place.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const view of loopViews(ix)) {
      const loop = view.loop
      // The SHARED derivation. An unassigned member says nothing, and a member
      // assigned to a deleted unit is `record-orphan-unit`'s finding — both
      // rules live in `loopViews`, so the Loop Manager, the Loop list and this
      // check cannot disagree about which units a loop is in.
      const units = view.unitIds
      if (units.length < 2) continue
      const codes = units.map((id) => placementOf(ix.hierarchy, id).unit?.code ?? id)
      out.push(
        finding(loopUnitsConflict, loop.id, `${label(loop)} has members in ${units.length} units: ${codes.join(', ')}`, {
          key: `${loopUnitsConflict.id}:${loop.id}`,
          ...at(view),
        }),
      )
    }
    return out
  },
}

/* --------------------------------------------------------- 5. I/O conflict */

/** Loop types whose structure means something is driven from the system, so a
 *  loop with nothing going out is a contradiction rather than a gap. */
const DRIVEN_TYPES = new Set(['control', 'on-off', 'cascade', 'ratio', 'interlock', 'manual'])

const INPUTS = new Set(['AI', 'DI'])
const OUTPUTS = new Set(['AO', 'DO'])

/**
 * A loop whose I/O cannot do what the loop type says it does.
 *
 * EVERY VERDICT COMES FROM `deriveIoList`, the P1 classifier. Nothing here
 * re-derives a signal type, reads an HMI property, or decides that a valve is
 * an output because it is a valve — `classifyIo` already refuses all three, and
 * a second opinion beside it would eventually disagree with the I/O list a
 * cabinet is built from.
 *
 * THE GUARD THAT MATTERS: a single `unknown` among the members switches this
 * rule off for that loop. An unknown is the classifier saying the model does
 * not state enough; turning that into evidence of absence would be exactly the
 * confident wrong answer `model/ioList.ts` exists to avoid. It also needs at
 * least one REAL I/O point before it will speak, because a loop with no
 * signals drawn yet is unfinished, not contradictory — `dead-end-instrument`
 * already reports that.
 */
export const loopIoConflict: Rule = {
  id: 'loop-io-conflict',
  title: 'Loops whose signals cannot do what the loop type says',
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'Read from the same classification the I/O list publishes. Where a single member cannot be classified, this says nothing at all rather than guessing.',
  run(ix) {
    const rows = new Map(deriveIoList(ix).map((r) => [r.key, r]))
    const out: RuleFinding[] = []

    for (const view of loopViews(ix)) {
      const { loop, members, evaluation: verdict } = view
      if (members.length === 0) continue
      // Only a loop whose type is settled AND whose structure implies
      // something is driven. An unknown type has nothing to contradict.
      if (!verdict.type || !DRIVEN_TYPES.has(verdict.type)) continue
      if (verdict.completeness === 'broken') continue

      let inputs = 0
      let outputs = 0
      let classified = 0
      let unknown = false
      for (const m of members) {
        // A member with no row is one the list left out as `none` — a local
        // gauge, a relief valve, a control-system function. That is a decision,
        // not a gap, so it neither counts nor silences the rule.
        const type = rows.get(m.key)?.type
        if (type === undefined) continue
        if (type === 'unknown') { unknown = true; break }
        classified += 1
        if (INPUTS.has(type)) inputs += 1
        if (OUTPUTS.has(type)) outputs += 1
      }
      if (unknown || classified === 0) continue
      if (inputs > 0 && outputs > 0) continue

      const missing = inputs === 0 ? 'nothing measuring into the control system' : 'nothing the control system drives'
      out.push(
        finding(
          loopIoConflict,
          loop.id,
          `${label(loop)} is a ${verdict.type} loop with ${missing} — every member is classified, and none of them is ${inputs === 0 ? 'an input (AI/DI)' : 'an output (AO/DO)'}`,
          { key: `${loopIoConflict.id}:${loop.id}`, ...at(view) },
        ),
      )
    }
    return out
  },
}

/* --------------------------------------------------------- 6. type unstated */

/**
 * A loop nobody has said the kind of.
 *
 * Info, and the deliberate twin of `io-type-unclassified`: not a mistake in the
 * drawing, but the thing that stops the structure being checked at all. It
 * carries the same shape of message — state it once and it is settled for
 * every report afterwards.
 *
 * Fires only when `suggestLoopType` ALSO declined. A loop whose members plainly
 * read as a control loop is left alone; guessing out loud and nagging about the
 * guess would be two mistakes.
 */
export const loopTypeUnstated: Rule = {
  id: 'loop-type-unstated',
  title: 'Loops with no stated type',
  severity: 'info',
  discipline: 'instrumentation',
  why: 'Nothing can check the structure of a loop without knowing what kind of loop it is meant to be, and that is not something to guess.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const view of loopViews(ix)) {
      if (view.members.length === 0) continue
      if (view.evaluation.completeness !== 'unknown') continue
      out.push(
        finding(
          loopTypeUnstated,
          view.loop.id,
          `${label(view.loop)} has no stated type, and its members do not say which one it is — state the type to have its structure checked`,
          { key: `${loopTypeUnstated.id}:${view.loop.id}`, ...at(view) },
        ),
      )
    }
    return out
  },
}

/* --------------------------------------------------------------- 7. empty */

/**
 * A loop with nothing in it.
 *
 * Info, because you have almost certainly just created it. It is explicitly
 * NOT broken (nothing dangles), NOT an incomplete warning (there is no
 * structure to be short of) and NOT an orphan record (no record is involved).
 * Separating those four states is the point of `LoopCompleteness` having five
 * members rather than two.
 */
export const loopEmpty: Rule = {
  id: 'loop-empty',
  title: 'Loops with no members',
  severity: 'info',
  discipline: 'data',
  why: 'Nothing is assigned to it yet, so it appears on no deliverable. Usually it was just created.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const view of loopViews(ix)) {
      if (view.members.length > 0) continue
      out.push(
        finding(loopEmpty, view.loop.id, `${label(view.loop)} has no members assigned to it`, {
          key: `${loopEmpty.id}:${view.loop.id}`,
        }),
      )
    }
    return out
  },
}

export const LOOP_RULES: Rule[] = [
  recordOrphanLoop,
  duplicateLoopNumber,
  loopIncomplete,
  loopUnitsConflict,
  loopIoConflict,
  loopTypeUnstated,
  loopEmpty,
]
