// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE EQUIPMENT NOZZLE, as an engineering object rather than a hole in a symbol.
 *
 * WHERE IT LIVES, AND WHY THERE. On the equipment's `EngineeringRecord`, in
 * `record.nozzles`. Not in `ProjectDoc`, not on the drawn node, and not as its
 * own `EntityKind`. The P3-4B audit settled this and the reasoning is worth
 * keeping next to the type:
 *
 *  - A nozzle is an engineering fact about a piece of equipment, and every
 *    engineering fact in this product hangs off the TAG, because
 *    delete-and-redraw is normal drafting. `deleteIds` never touches the
 *    registry, so a record — and now its nozzles — outlives the symbol.
 *  - Nesting them in the record means `retagRegistry`'s object spread carries
 *    the whole schedule across a rename for free. A `doc.nozzles[]` collection
 *    holding an equipment tag would instead need a NEW `RefWhere` member to
 *    collect, rewrite, orphan, count and pin — the same trade P2-C refused
 *    when it put loop membership on the record rather than in `Loop.members[]`.
 *  - A new `EntityKind` would change `DEFAULT_STANDARD`'s fingerprint:
 *    `canonicalStandard` serialises `required`, which is typed
 *    `Record<EntityKind, string[]>`. That is the trap Loop avoided too.
 *
 * THE OWNER IS NOT A FIELD. There is no `equipmentId` on a Nozzle. The record
 * it sits in IS the ownership boundary, which is why there is nothing to
 * rewrite on a rename and nothing to orphan on a delete.
 *
 * IDENTITY IS THE ID. A ULID nothing displays and nothing may reuse. `number`
 * is what an engineer reads and is therefore expected to change — N2 becomes
 * N3 when the schedule is revised, and the nozzle is the same nozzle. Never a
 * number as a key, and never an array index.
 *
 * WHAT IT REFUSES TO KNOW. Every field below except `id` and `number` is typed
 * by an engineer and absent until they type it. Nothing is inferred: not the
 * size from the connected line's `spec.size`, not the service from the line
 * number's service part, not the facing from which side of the symbol the port
 * sits on, not inlet/outlet from anything. Each of those is a plausible guess
 * and each would be the software inventing a specification.
 *
 * `portId` IS A DRAWING REFERENCE, NOT AN IDENTITY. It says which connection
 * point on the currently drawn symbol this nozzle is at, and it is optional
 * because a nozzle schedule legitimately runs ahead of the drawing. It cannot
 * be the identity: `addExtraPort` reuses `pin-N` ids after a deletion, a
 * catalogue port id belongs to the SYMBOL rather than to the equipment, and a
 * symbol carries every port it could ever have — `vessel.vertical` has eleven,
 * where a real vessel might have four nozzles.
 *
 * Everything here is pure and DOM-free.
 */

import { ulid } from 'ulid'

export interface Nozzle {
  /** Stable identity. Never displayed, never reused, never derived. */
  id: string
  /** What an engineer reads and prints: 'N1', 'N2A', 'M1'. Free text, because
   *  houses disagree about the shape, and expected to change. */
  number: string
  /**
   * The connection point on the drawn symbol, when the drawing has one.
   *
   * ABSENT IS NORMAL. A nozzle on a vessel's schedule need not have a line to
   * it yet, and the record outlives the symbol entirely. A `portId` that names
   * no port on the current symbol is a broken REFERENCE, not a malformed
   * document: it loads, and `nozzle-port-missing` reports it.
   */
  portId?: string
  /** Engineer-entered. Never read off the connected line. */
  size?: string
  /** Engineer-entered pressure class / rating. */
  rating?: string
  /** Engineer-entered flange facing or end connection. */
  facing?: string
  /** Engineer-entered service. Never read off the line number's service part. */
  service?: string
  notes?: string
}

/** What a nozzle may be created or edited with. `id` is never among them. */
export type NozzleInit = Partial<Omit<Nozzle, 'id'>>

export function newNozzle(number: string, init: NozzleInit = {}): Nozzle {
  const nozzle: Nozzle = { id: ulid(), number }
  // Absent rather than empty: a blank string in a saved document reads as "an
  // engineer typed nothing here", which is not the same as never asked.
  for (const key of ['portId', 'size', 'rating', 'facing', 'service', 'notes'] as const) {
    const value = init[key]
    if (value) nozzle[key] = value
  }
  return nozzle
}

/** The comparable form of a nozzle number, matching `loopNumberKey`. */
export const nozzleNumberKey = (number: string): string => number.trim().toLowerCase()

/** The nozzles of one record, never undefined. */
export const nozzlesOf = (record: { nozzles?: readonly Nozzle[] } | undefined): readonly Nozzle[] =>
  record?.nozzles ?? []

/**
 * Nozzles that share a number WITHIN ONE RECORD, grouped by the comparable form.
 *
 * Scoped to the equipment deliberately. N1 on V-101 and N1 on V-102 are two
 * different nozzles on two different vessels, and nothing in the standard
 * profile asks for project-wide nozzle numbering. Blank numbers are skipped:
 * a nozzle with no number has nothing to collide on.
 */
export function duplicateNozzleNumbers(record: { nozzles?: readonly Nozzle[] } | undefined): Map<string, Nozzle[]> {
  const byNumber = new Map<string, Nozzle[]>()
  for (const nozzle of nozzlesOf(record)) {
    const key = nozzleNumberKey(nozzle.number)
    if (!key) continue
    const list = byNumber.get(key)
    if (list) list.push(nozzle)
    else byNumber.set(key, [nozzle])
  }
  for (const [key, list] of byNumber) if (list.length < 2) byNumber.delete(key)
  return byNumber
}

/** Would `number` collide with another nozzle on the same record? `exceptId`
 *  excludes the nozzle being renumbered, so setting its own number back is
 *  allowed. */
export function nozzleNumberTaken(
  record: { nozzles?: readonly Nozzle[] } | undefined,
  number: string,
  exceptId?: string,
): boolean {
  const key = nozzleNumberKey(number)
  if (!key) return false
  return nozzlesOf(record).some((n) => n.id !== exceptId && nozzleNumberKey(n.number) === key)
}

/** Nozzles on one record claiming the same connection point, grouped by port. */
export function duplicateNozzlePorts(record: { nozzles?: readonly Nozzle[] } | undefined): Map<string, Nozzle[]> {
  const byPort = new Map<string, Nozzle[]>()
  for (const nozzle of nozzlesOf(record)) {
    if (!nozzle.portId) continue
    const list = byPort.get(nozzle.portId)
    if (list) list.push(nozzle)
    else byPort.set(nozzle.portId, [nozzle])
  }
  for (const [port, list] of byPort) if (list.length < 2) byPort.delete(port)
  return byPort
}

/**
 * Nozzles pointing at a port the drawn symbol does not have.
 *
 * `available` is every port id the equipment currently offers — catalogue
 * ports plus user pins, which is exactly what `ProjectIndex` already holds per
 * node. A record with nothing drawn has no ports to check against and is NOT
 * reported here: that is `orphan-record`'s business, and calling every nozzle
 * on an orphan broken would bury the real breakage.
 */
export function danglingNozzlePorts(
  record: { nozzles?: readonly Nozzle[] } | undefined,
  available: ReadonlySet<string>,
): Nozzle[] {
  return nozzlesOf(record).filter((n) => n.portId !== undefined && !available.has(n.portId))
}

/* ------------------------------------------------------- document integrity */

/**
 * Load-time SHAPE check, drawing the line `checkLoops` draws: a malformed
 * shape refuses the file, a broken reference loads.
 *
 * A duplicate number or a `portId` naming nothing is a broken reference — the
 * document opens and QA says so. A nozzle that is not an object, or has no
 * string id, is a file this build cannot reason about at all.
 */
export function checkNozzles(registry: Record<string, { nozzles?: unknown }> | undefined): string | null {
  if (!registry) return null
  for (const key of Object.keys(registry)) {
    const raw = registry[key]?.nozzles
    if (raw === undefined) continue
    if (!Array.isArray(raw)) return `nozzles on ${key} is malformed`
    const seen = new Set<string>()
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) return `nozzles on ${key} is malformed`
      const nozzle = item as Partial<Nozzle>
      if (typeof nozzle.id !== 'string' || !nozzle.id) return `nozzles on ${key} is malformed`
      if (typeof nozzle.number !== 'string') return `nozzles on ${key} is malformed`
      if (seen.has(nozzle.id)) return `nozzles on ${key} contains a duplicate id: ${nozzle.id}`
      seen.add(nozzle.id)
    }
  }
  return null
}
