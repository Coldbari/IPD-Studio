// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Loop } from '../model/loop'

/**
 * Pick the Loop an object belongs to.
 *
 * A picker, never a text box — the twin of `UnitPicker`, and for the same
 * reason: a loop is a reference to something the project has DECLARED, so the
 * only values that can be chosen are the ones that exist. Typing a number here
 * would mean "101", "101 " and "F-101" were three different loops as far as
 * anything downstream could tell.
 *
 * The value it reads and writes is the stable `Loop.id`. What it DISPLAYS is
 * the number, because that is what an engineer calls it and the id is not for
 * human eyes.
 *
 * ONE component for the inspector and anywhere else that assigns. A second
 * picker that happened to write the same field is how two places start
 * disagreeing about what "unassigned" means.
 */
export default function LoopPicker({
  loops, value, onChange, className, testId, disabled,
}: {
  loops: readonly Loop[]
  /** The stable loop id, or undefined when unassigned. */
  value: string | undefined
  onChange(loopId: string | undefined): void
  className?: string
  testId?: string
  disabled?: boolean
}) {
  const sorted = [...loops].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
  // A loop id that names nothing must still be selectable-as-is, or opening
  // the picker on a broken record would silently reassign it to nothing — the
  // same trap `UnitPicker` guards against for a unit whose area was deleted.
  const broken = value !== undefined && !sorted.some((l) => l.id === value)

  return (
    <select
      className={className}
      data-testid={testId}
      aria-label="Loop"
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">— not assigned —</option>
      {sorted.map((l) => (
        <option key={l.id} value={l.id}>{l.name ? `${l.number} — ${l.name}` : l.number}</option>
      ))}
      {broken && <option value={value}>⚠ missing loop</option>}
    </select>
  )
}
