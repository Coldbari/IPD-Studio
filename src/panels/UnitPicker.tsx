// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Hierarchy } from '../model/hierarchy'
import { areaLabel, unitLabel } from '../model/hierarchy'

/**
 * Pick the Unit an object belongs to.
 *
 * A picker, never a text box. A Unit is a reference to something the project
 * has declared, so the only values that can be chosen are the ones that exist —
 * which is the difference between an assignment and the free-text box this
 * replaces, where "Reactor", "reactor" and "Reactor area" were three different
 * plants as far as anything downstream could tell.
 *
 * Grouped by area, so the relationship is visible in the act of using it, and
 * so two areas that both number a unit 101 are still told apart.
 *
 * ONE component for the inspector and the data table. A second picker that
 * happened to write the same field is how two places start disagreeing about
 * what "unassigned" means.
 */
export default function UnitPicker({
  hierarchy, value, onChange, className, testId, disabled,
}: {
  hierarchy: Hierarchy
  /** The stable unit id, or undefined when unassigned. */
  value: string | undefined
  onChange(unitId: string | undefined): void
  className?: string
  testId?: string
  disabled?: boolean
}) {
  // A unit whose area was deleted still has to be selectable-as-is, or opening
  // the picker on a broken record would silently reassign it to nothing.
  const orphans = hierarchy.units.filter((u) => !hierarchy.areaById.has(u.areaId))

  return (
    <select
      className={className}
      data-testid={testId}
      aria-label="Unit"
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">— not assigned —</option>
      {hierarchy.areas.map((area) => (
        <optgroup key={area.id} label={areaLabel(area)}>
          {(hierarchy.unitsByArea.get(area.id) ?? []).map((u) => (
            <option key={u.id} value={u.id}>{unitLabel(u)}</option>
          ))}
        </optgroup>
      ))}
      {orphans.length > 0 && (
        <optgroup label="Area missing">
          {orphans.map((u) => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
        </optgroup>
      )}
    </select>
  )
}
