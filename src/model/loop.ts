// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE CONTROL LOOP, as an engineering entity rather than a coincidence of tag
 * numbers.
 *
 * WHAT THIS IS NOT. `store/selectors.ts` already derives loops by grouping
 * tagged nodes on (first ISA letter, loop number). That derivation is correct
 * for what it claims, it survives rename, delete/redraw and undo perfectly
 * because it stores nothing, and it stays exactly where it is. It cannot
 * express three things a deliverable needs: a loop TYPE, a cascade whose
 * members span two measured-variable families, and a loop identity a revision
 * diff can track. This module adds those; it replaces nothing.
 *
 * WHERE MEMBERSHIP LIVES. On the engineering RECORD (`loopId`), never on the
 * Loop and never on the drawn node. The same three reasons `unitId` is on the
 * record apply unchanged (see model/hierarchy.ts): a node is one placement of
 * a tag, delete-and-redraw is normal drafting, and two placements of one tag
 * must not be able to disagree. It buys one more thing here — `retagRegistry`
 * carries the whole record across a rename, so loop membership follows a
 * renamed object with no new code and, critically, with NO new machine-written
 * tag reference for model/references.ts to have to carry.
 *
 * A `Loop.members[]` array would have been the opposite trade: five new
 * reference paths to collect, rewrite, orphan, count and pin.
 *
 * IDENTITY IS THE ID. A ULID nothing displays and nothing may reuse. `number`
 * is what an engineer reads and is therefore expected to change — 101 becomes
 * 201 when the numbering is revised, and every member stays a member. Never a
 * number as a foreign key, and never an array index.
 *
 * COMPLETENESS IS STRUCTURAL, AND THE WORD IS LOAD-BEARING. `complete` here
 * means "the declared or suggested loop type's required roles are all
 * present". It is NOT a claim that the control scheme is correct, that the
 * tuning is sane, that the right variable is being measured, or that the loop
 * will work. This software cannot know any of that. Every message this module
 * produces says what it checked, so nobody can read a green tick as an
 * engineering approval.
 *
 * Everything here is pure and DOM-free.
 */

import { ulid } from 'ulid'
import { validateLetters } from '../isa/tag'
import type { Registry } from './registry'

/* ------------------------------------------------------------ member roles */

/**
 * What one member DOES in its loop, read from its ISA letters.
 *
 * Moved here from `export/loopDiagram.ts` unchanged. It was domain
 * classification living in an export module, already imported by the
 * assistant, which meant the product's only role classifier was owned by the
 * thing that prints a sheet. The export layer consumes it now.
 */
export type MemberRole = 'element' | 'transmitter' | 'controller' | 'final' | 'switch' | 'relay' | 'indicator' | 'other'

/**
 * The FUNCTION letters of a tag, via the structured parse.
 *
 * Kept local rather than shared with the identical helper in `model/ioList.ts`:
 * that one is private, and exporting it would make this module depend on
 * ioList, which depends on projectIndex, which depends on this — a cycle for
 * two lines. Both call the same `validateLetters`, so they cannot disagree
 * about what a function letter is.
 */
const functionLetters = (letters: string): string[] =>
  validateLetters(letters).parts.filter((p) => p.role === 'function').map((p) => p.letter)

export function classifyMember(letters: string): MemberRole {
  const last = letters[letters.length - 1]
  // V/Z/E/W are read off the LAST letter rather than the parse. That is safe
  // and stays: for any tag of two letters or more the last position is never
  // the measured variable, and H/L/M are the only trailing modifiers, so a
  // terminal V, Z, E or W is always the function letter.
  if (last === 'V' || last === 'Z') return 'final'
  if (last === 'E' || last === 'W') return 'element'
  // Everything below asks the PARSER which letters are functions.
  //
  // It used to ask the raw string — `letters.includes('C')`, then
  // `letters.includes('T')` — and that cannot work, because C and T each
  // appear in BOTH tables in isa/letters.ts: C is "User's Choice" as a first
  // letter and "Controller" as a succeeding one, T is "Temperature" and
  // "Transmitter". So a temperature indicator read as a transmitter, a
  // temperature switch read as a transmitter, and a user's-choice transmitter
  // read as a controller. `validateLetters` already separates measured
  // variable from modifier from function from state; it is the authority, and
  // now it is the only thing consulted.
  const funcs = functionLetters(letters)
  if (funcs.includes('C')) return 'controller'
  if (funcs.includes('T')) return 'transmitter'
  if (funcs.includes('S')) return 'switch'
  if (funcs.includes('Y')) return 'relay'
  if (funcs.includes('I') || funcs.includes('R') || funcs.includes('G')) return 'indicator'
  return 'other'
}

/* ------------------------------------------------------------- the entity */

/**
 * The loop types this engine evaluates STRUCTURALLY.
 *
 * Absent means NOT STATED — never "assume control". Same doctrine as
 * `SignalEngineering.type` in model/signalData.ts: what the engineer stated is
 * the answer, a derivation is a second opinion, and "the model does not say
 * enough" is a real verdict rather than an excuse to guess.
 */
export type LoopType =
  | 'control'
  | 'indication'
  | 'on-off'
  | 'alarm'
  | 'interlock'
  | 'cascade'
  | 'ratio'
  | 'manual'
  | 'safety'

export const LOOP_TYPES: readonly LoopType[] = [
  'control', 'indication', 'on-off', 'alarm', 'interlock', 'cascade', 'ratio', 'manual', 'safety',
]

export const LOOP_TYPE_LABELS: Record<LoopType, string> = {
  control: 'Control',
  indication: 'Indication only',
  'on-off': 'On/off',
  alarm: 'Alarm',
  interlock: 'Interlock',
  cascade: 'Cascade',
  ratio: 'Ratio',
  manual: 'Manual',
  safety: 'Safety-related',
}

/**
 * 'a' or 'an', whichever English wants in front of `word`.
 *
 * Every user-visible sentence that names a loop type has to BUILD its article,
 * because the type is interpolated. Hard-coding 'A' produced "A indication
 * only loop", "A on/off loop", "A alarm loop" and "A interlock loop" — in the
 * Loop Manager, the loop diagram, the Loop List CSV's Basis column and two QA
 * findings, all from the same three templates.
 *
 * This is the SPELLING rule, not the pronunciation one: it cannot know about
 * "a unit" or "an hour". That is safe for every word this product feeds it and
 * deliberately unsafe in general, so `tests/model/loopWording.test.ts` pins the
 * article for all nine loop types in BOTH spellings they are printed in — the
 * label ('on/off') and the raw key ('on-off') — and fails the day a type is
 * added that the rule gets wrong.
 */
export function articleFor(word: string, capitalised = false): string {
  const article = /^[aeiou]/i.test(word) ? 'an' : 'a'
  return capitalised ? article.charAt(0).toUpperCase() + article.slice(1) : article
}

export interface Loop {
  /** Stable identity. Never displayed, never reused, never derived. */
  id: string
  /** What the engineer reads and prints: '101', 'F-101', '21-LIC-101'.
   *  Free text, because houses genuinely disagree about the shape, and
   *  splitting family from number would write the derivation's accident
   *  into the schema. */
  number: string
  /** Optional long form: 'Reactor jacket temperature'. */
  name?: string
  /** Optional note. NOT a control narrative — that is out of scope. */
  description?: string
  /** Absent = NOT STATED. Evaluation then suggests, or reports `unknown`. */
  type?: LoopType
  /** Review state. A free string for the same reason `Revision.status` is
   *  one: the vocabulary is the house's, not the software's. */
  status?: string
}

export function newLoop(
  number: string,
  init: { name?: string; description?: string; type?: LoopType; status?: string } = {},
): Loop {
  return {
    id: ulid(),
    number,
    ...(init.name ? { name: init.name } : {}),
    ...(init.description ? { description: init.description } : {}),
    ...(init.type ? { type: init.type } : {}),
    ...(init.status ? { status: init.status } : {}),
  }
}

/** A stated type, or undefined when the value is absent or not one this build
 *  knows. A document written by a NEWER build may carry a type this one has
 *  never heard of; treating it as unstated is forward-compatible, and far
 *  better than throwing on load or silently evaluating it as something else. */
export function asLoopType(v: unknown): LoopType | undefined {
  return LOOP_TYPES.find((t) => t === v)
}

/* ---------------------------------------------------------- membership view */

/**
 * One member, as the evaluator needs to see it.
 *
 * `drawn` is the honest half. A record outlives the symbol that was deleted
 * (model/registry.ts makes that a contract, not an accident), so a loop can
 * legitimately name a member that is not on any sheet right now. That is a
 * BROKEN membership, and it must not read as a missing role — "you need a
 * final element" and "your final element is not in the drawing" are different
 * problems with different fixes.
 */
export interface LoopMember {
  /** Registry key — the formatted tag. */
  key: string
  /** ISA letters, or '' when the member carries none. */
  letters: string
  /** False when nothing on any sheet currently wears this key. */
  drawn: boolean
}

export function emptyRoles(): Record<MemberRole, string[]> {
  return { element: [], transmitter: [], controller: [], final: [], switch: [], relay: [], indicator: [], other: [] }
}

/** Members bucketed by role, each bucket holding registry keys in input order.
 *  Only DRAWN members with letters are classified: an unresolvable member has
 *  no letters to read and must not contribute a role it might not have. */
export function rolesOf(members: readonly LoopMember[]): Record<MemberRole, string[]> {
  const roles = emptyRoles()
  for (const m of members) {
    if (!m.drawn || !m.letters) continue
    roles[classifyMember(m.letters)].push(m.key)
  }
  return roles
}

/* ------------------------------------------------------------- suggestion */

/**
 * The type a loop LOOKS like, from its roles alone.
 *
 * Only four are ever suggested, and the omissions are the point:
 *
 *  - `alarm`, `interlock`, `ratio`, `manual` and `safety` are ENGINEERING
 *    INTENT. Letters do not carry intent. An LSHH wired to an XV is an
 *    interlock on one drawing and an on/off control loop on another, and the
 *    difference is a decision somebody made, not a fact the tag records.
 *  - A wrong suggestion that a user accepts is worse than no suggestion,
 *    which is the same reason `classifyIo` refuses to guess an actuator.
 *
 * Returns undefined when it cannot decide. The caller reports `unknown`.
 */
export function suggestLoopType(roles: Record<MemberRole, string[]>): LoopType | undefined {
  const measurement = roles.transmitter.length + roles.element.length
  const controllers = roles.controller.length
  const finals = roles.final.length
  const readout = roles.indicator.length + controllers

  if (controllers >= 2) return 'cascade'
  if (controllers >= 1 && measurement >= 1 && finals >= 1) return 'control'
  if (controllers === 0 && roles.switch.length >= 1 && finals >= 1) return 'on-off'
  if (finals === 0 && measurement >= 1 && readout >= 1) return 'indication'
  return undefined
}

/* ------------------------------------------------------------- evaluation */

/**
 * `complete` = the type's required ROLES are present. Nothing more.
 *
 * `not-applicable` = this engine does not judge this type's structure.
 * `unknown` = no type stated and nothing safe to suggest.
 * `broken` = a member cannot be resolved to something in the drawing.
 * `incomplete` = a required role is missing, or there are no members at all.
 */
export type LoopCompleteness = 'complete' | 'incomplete' | 'broken' | 'not-applicable' | 'unknown'

export interface LoopEvaluation {
  loopId: string
  completeness: LoopCompleteness
  /** The type the verdict was reached under, when there was one. */
  type?: LoopType
  typeSource: 'stated' | 'derived' | 'none'
  roles: Record<MemberRole, string[]>
  /** Required roles that are absent, in plain words. Empty unless incomplete —
   *  except on `safety`, where it says what WOULD have been looked for. */
  missing: string[]
  /** Member keys that are not drawn anywhere. Non-empty only when `broken`. */
  undrawn: string[]
  memberCount: number
  /** Why, in the words an engineer would use. Always states what was checked,
   *  so a `complete` verdict cannot be read as an engineering approval. */
  basis: string
}

/** What each type structurally requires. Expressed ONLY in terms of the role
 *  buckets `classifyMember` produces, so every rule here is computable today
 *  with no second classifier. */
interface TypeRule {
  /** Missing role names, given the roles and function letters present. */
  missing(roles: Record<MemberRole, string[]>, fns: Set<string>, hand: boolean): string[]
  /** True when this engine declines to judge the structure. */
  notApplicable?: boolean
}

const measurementOf = (r: Record<MemberRole, string[]>) => r.transmitter.length + r.element.length
const readoutOf = (r: Record<MemberRole, string[]>) => r.indicator.length + r.controller.length

const TYPE_RULES: Record<LoopType, TypeRule> = {
  indication: {
    missing: (r) => [
      ...(measurementOf(r) >= 1 ? [] : ['a measurement']),
      ...(readoutOf(r) >= 1 ? [] : ['a readout (indicator or controller)']),
    ],
  },
  control: {
    missing: (r) => [
      ...(measurementOf(r) >= 1 ? [] : ['a measurement']),
      ...(r.controller.length >= 1 ? [] : ['a controller']),
      ...(r.final.length >= 1 ? [] : ['a final control element']),
    ],
  },
  'on-off': {
    missing: (r) => [
      ...(r.switch.length + measurementOf(r) >= 1 ? [] : ['a switch or a measurement']),
      ...(r.final.length >= 1 ? [] : ['a final control element']),
    ],
  },
  alarm: {
    missing: (r, fns) => [
      ...(measurementOf(r) + r.switch.length >= 1 ? [] : ['a measurement or a switch']),
      ...(fns.has('A') ? [] : ['an alarm (A) function']),
    ],
  },
  interlock: {
    missing: (r) => [
      ...(r.switch.length + r.transmitter.length >= 1 ? [] : ['an initiator (switch or transmitter)']),
      ...(r.final.length >= 1 ? [] : ['a final control element']),
    ],
  },
  cascade: {
    missing: (r) => [
      ...(r.controller.length >= 2 ? [] : ['a second controller']),
      ...(measurementOf(r) >= 1 ? [] : ['a measurement']),
      ...(r.final.length >= 1 ? [] : ['a final control element']),
    ],
  },
  ratio: {
    missing: (r) => [
      ...(measurementOf(r) >= 2 ? [] : ['a second measurement']),
      ...(r.controller.length >= 1 ? [] : ['a controller']),
      ...(r.final.length >= 1 ? [] : ['a final control element']),
    ],
  },
  manual: {
    missing: (r, _fns, hand) => [
      ...(hand ? [] : ['a hand controller (HIC / HC)']),
      ...(r.final.length >= 1 ? [] : ['a final control element']),
    ],
  },
  safety: {
    // Evaluated for transparency, then declined. A SIF's real structure is
    // voting, trip conditions and proof testing; claiming to have checked it
    // from ISA letters would be a lie, and SIS is Phase 3 work.
    notApplicable: true,
    missing: (r) => [
      ...(r.switch.length + r.transmitter.length >= 1 ? [] : ['an initiator (switch or transmitter)']),
      ...(r.final.length >= 1 ? [] : ['a final control element']),
    ],
  },
}

/**
 * Evaluate one loop against its members. Pure, deterministic, order-fixed.
 *
 * The order matters and is fixed so two callers cannot reach different
 * verdicts for one loop:
 *
 *   1. a member that cannot be resolved   → broken
 *   2. no members at all                  → incomplete (distinct from broken)
 *   3. no type, and nothing safe to guess → unknown
 *   4. a type this engine will not judge  → not-applicable
 *   5. required roles                     → complete | incomplete
 */
export function evaluateLoop(loop: Loop, members: readonly LoopMember[]): LoopEvaluation {
  const roles = rolesOf(members)
  const stated = asLoopType(loop.type)
  const suggested = stated ? undefined : suggestLoopType(roles)
  const type = stated ?? suggested
  const typeSource: LoopEvaluation['typeSource'] = stated ? 'stated' : suggested ? 'derived' : 'none'
  const undrawn = members.filter((m) => !m.drawn).map((m) => m.key)

  const base = {
    loopId: loop.id,
    roles,
    undrawn,
    memberCount: members.length,
    ...(type ? { type } : {}),
    typeSource,
  }

  if (undrawn.length > 0) {
    return {
      ...base,
      completeness: 'broken',
      missing: [],
      basis: `${undrawn.length === 1 ? 'A member is' : `${undrawn.length} members are`} not in the drawing: ${undrawn.join(', ')}. The engineering record is still here — redraw the object, or remove it from the loop.`,
    }
  }

  if (members.length === 0) {
    return {
      ...base,
      completeness: 'incomplete',
      missing: [],
      basis: 'This loop has no members yet — nothing is assigned to it.',
    }
  }

  if (!type) {
    return {
      ...base,
      completeness: 'unknown',
      missing: [],
      basis: 'No loop type is stated, and the members do not say which one this is. State the type to have its structure checked.',
    }
  }

  const fns = new Set<string>()
  for (const m of members) if (m.drawn && m.letters) for (const f of functionLetters(m.letters)) fns.add(f)
  const hand = members.some((m) => m.drawn && m.letters.startsWith('H') && classifyMember(m.letters) === 'controller')

  const rule = TYPE_RULES[type]
  const missing = rule.missing(roles, fns, hand)
  const kind = LOOP_TYPE_LABELS[type].toLowerCase()

  if (rule.notApplicable) {
    return {
      ...base,
      completeness: 'not-applicable',
      missing,
      basis: `${articleFor(kind, true)} ${kind} loop's structure is not checked here — voting, trip conditions and proof testing are what make one sound, and none of them are in this model.`,
    }
  }

  if (missing.length > 0) {
    return {
      ...base,
      completeness: 'incomplete',
      missing,
      basis: `${articleFor(kind, true)} ${kind} loop needs ${missing.join(' and ')}.`,
    }
  }

  return {
    ...base,
    completeness: 'complete',
    missing: [],
    // Says what was checked, deliberately. A tick that reads as "this loop is
    // correct" would be the software claiming an engineering judgement it has
    // no way to make.
    basis: `Every part ${articleFor(kind)} ${kind} loop needs is present. This checks the structure only — not whether the scheme is right.`,
  }
}

/**
 * The reserved required-field key for a Loop assignment.
 *
 * NOT in `FIELD_CATALOG`, for the reason `UNIT_FIELD` is not: a loop is not a
 * text field, it is a reference edited with a picker and stored as a stable
 * id. But "an object must belong to a loop before its record is usable" is
 * exactly what `StandardProfile.required` exists to express, and a second
 * mechanism beside it would be a second place to look.
 *
 * DELIBERATELY NOT IN `DEFAULT_STANDARD.required`. Whether an instrument must
 * belong to a declared loop is a house decision, and adding it to the default
 * would change the fingerprint of every project that never asked for it — and
 * fire the requirement at every one of them at once. A house that wants it
 * ticks the box, its own fingerprint moves, and that is correct: the house
 * changed its standard.
 */
export const LOOP_FIELD = 'general.loop'

export const LOOP_FIELD_LABELS: Record<string, string> = {
  [LOOP_FIELD]: 'Loop',
}

/* ------------------------------------------------------------ uniqueness */

/**
 * The comparable form of a loop number: trimmed and case-folded.
 *
 * ONE definition, exported so the store's duplicate refusal and the
 * `duplicate-loop-number` rule ask the same question. Two implementations of
 * "the same number" is how a store starts accepting what QA then reports, or
 * refusing what QA thinks is fine.
 *
 * Trimmed and case-folded because "101 " out of a paste and "101" typed are
 * the same loop to every engineer who will ever read them, exactly as
 * `resolveUnitByCode` treats a unit code.
 */
export const loopNumberKey = (number: string): string => number.trim().toLowerCase()

/**
 * Loops that share a number, grouped by the comparable form.
 *
 * Only genuine collisions are returned — a number worn by one loop is not in
 * the map. Blank numbers are skipped: a loop with no number has nothing to
 * collide on, and reporting every blank as a duplicate of every other blank
 * would bury the real conflicts.
 */
export function duplicateLoopNumbers(loops: readonly Loop[] | undefined): Map<string, Loop[]> {
  const byNumber = new Map<string, Loop[]>()
  for (const loop of loops ?? []) {
    const k = loopNumberKey(loop.number)
    if (!k) continue
    const list = byNumber.get(k)
    if (list) list.push(loop)
    else byNumber.set(k, [loop])
  }
  for (const [k, list] of byNumber) if (list.length < 2) byNumber.delete(k)
  return byNumber
}

/** Would `number` collide with an existing loop? `exceptId` excludes the loop
 *  being renumbered, so setting a loop's own number back to itself is allowed. */
export function loopNumberTaken(
  loops: readonly Loop[] | undefined,
  number: string,
  exceptId?: string,
): boolean {
  const k = loopNumberKey(number)
  if (!k) return false
  return (loops ?? []).some((l) => l.id !== exceptId && loopNumberKey(l.number) === k)
}

/* ------------------------------------------------------- document integrity */

/** A record whose `loopId` names a loop that is not in the project. */
export interface DanglingLoopRef {
  /** Registry key of the record holding the broken reference. */
  key: string
  /** The id it points at, which resolves to nothing. */
  loopId: string
}

/**
 * Membership references that point at nothing.
 *
 * The other half of `broken`: `evaluateLoop` reports a member that is not
 * DRAWN, and this reports a member whose LOOP is gone. Both are broken
 * membership; they are separate functions because they have separate fixes
 * (redraw the object, versus clear the assignment) and separate subjects.
 *
 * Reported, never repaired. Nothing here writes, and a dangling reference must
 * load rather than refuse the file — the document is perfectly readable and
 * refusing it would strand the user with something they cannot fix.
 */
export function danglingLoopMembers(
  loops: readonly Loop[] | undefined,
  registry: Registry | undefined,
): DanglingLoopRef[] {
  const ids = new Set((loops ?? []).map((l) => l.id))
  const out: DanglingLoopRef[] = []
  // `for...in` rather than Object.entries: the registry is the biggest map in
  // the document and entries() allocates a pair array for all of it before the
  // first assignment is read. This runs on every QA pass of every project,
  // including the overwhelming majority that have no loops at all, so it has
  // to cost nothing there.
  if (registry) {
    for (const key in registry) {
      const loopId = registry[key]?.loopId
      if (loopId && !ids.has(loopId)) out.push({ key, loopId })
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Is the `loops` array what it claims to be?
 *
 * STRUCTURAL only, and the line is the one `checkHierarchy` draws: a malformed
 * SHAPE means the file is not what it says it is and loading half of it would
 * put the project somewhere nothing downstream can describe. A BROKEN
 * REFERENCE is an ordinary engineering situation and loads fine.
 *
 * Duplicate ids ARE rejected, unlike the hierarchy's (a gap noted separately):
 * two loops sharing a stable id makes every membership ambiguous, and no
 * consumer could pick between them.
 *
 * Returns the problem, or null when the array is well-formed. It does not
 * throw, so this module stays free of the loader's error type and the loader
 * keeps owning what a bad document does.
 */
export function checkLoops(doc: { loops?: unknown }): string | null {
  if (doc.loops === undefined) return null
  if (!Array.isArray(doc.loops)) return 'loops is malformed'
  const seen = new Set<string>()
  for (const l of doc.loops) {
    if (typeof l !== 'object' || l === null) return 'loops is malformed'
    const loop = l as Partial<Loop>
    if (typeof loop.id !== 'string' || !loop.id) return 'loops is malformed'
    if (typeof loop.number !== 'string') return 'loops is malformed'
    if (seen.has(loop.id)) return `loops contains a duplicate id: ${loop.id}`
    seen.add(loop.id)
  }
  return null
}
