// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import Modal from './Modal'
import { useStore } from '../store/store'
import { buildHierarchy, planLegacyMapping } from '../model/hierarchy'

/**
 * Areas and the Units inside them.
 *
 * Built in the shape of the Fluids dialog, not as a hierarchy manager: a list
 * you type into, with the units indented under their area. There is no tree
 * widget, no drag-and-drop and no bulk editor, because there are two levels
 * and an engineer declaring them once at the start of a project should not
 * have to learn an interface to do it.
 *
 * EDITS ARE LIVE AND UNDOABLE. Typing in a code field renames it immediately,
 * and every object assigned to it stays assigned — assignments point at the
 * stable id, so a code is only ever a label. That is exactly what makes this
 * safe to type in: there is no rename operation to get wrong.
 */
export default function AreasDialog({ onClose }: { onClose(): void }) {
  const doc = useStore((s) => s.doc)
  const addArea = useStore((s) => s.addArea)
  const updateArea = useStore((s) => s.updateArea)
  const removeArea = useStore((s) => s.removeArea)
  const addUnit = useStore((s) => s.addUnit)
  const updateUnit = useStore((s) => s.updateUnit)
  const removeUnit = useStore((s) => s.removeUnit)
  const applyLegacyMapping = useStore((s) => s.applyLegacyMapping)
  const [mapped, setMapped] = useState<number | null>(null)

  const h = useMemo(() => buildHierarchy(doc), [doc])

  /** How many engineering records point at each unit — the number the user
   *  needs before deleting one. One pass, not one scan per unit. */
  const assigned = useMemo(() => {
    const counts = new Map<string, number>()
    for (const rec of Object.values(doc.registry ?? {})) {
      if (rec.unitId) counts.set(rec.unitId, (counts.get(rec.unitId) ?? 0) + 1)
    }
    return counts
  }, [doc.registry])

  const legacy = useMemo(() => planLegacyMapping(doc), [doc])

  const deleteArea = (id: string, code: string) => {
    const units = (doc.units ?? []).filter((u) => u.areaId === id)
    const count = units.reduce((n, u) => n + (assigned.get(u.id) ?? 0), 0)
    const detail = units.length
      ? ` This also deletes ${units.length} unit${units.length === 1 ? '' : 's'}${count ? ` and unassigns ${count} object${count === 1 ? '' : 's'}` : ''}.`
      : ''
    if (!confirm(`Delete area ${code}?${detail}`)) return
    removeArea(id)
  }

  const deleteUnit = (id: string, code: string) => {
    const count = assigned.get(id) ?? 0
    const detail = count ? ` This unassigns ${count} object${count === 1 ? '' : 's'}.` : ''
    if (!confirm(`Delete unit ${code}?${detail}`)) return
    removeUnit(id)
  }

  return (
    <Modal title="Areas & units" onClose={onClose} width={560}>
      <div className="areas" data-testid="areas-dialog">
        {h.areas.length === 0 && (
          <p className="areas-empty">
            No areas yet. An area is the top level a plant is divided into — 100, OSBL, Tank farm — and a
            unit sits inside one. Objects are assigned to units, and every deliverable can then be cut by
            either.
          </p>
        )}

        {h.areas.map((area) => (
          <section key={area.id} className="areas-area" data-testid={`area-${area.id}`}>
            <div className="areas-row">
              <input
                className="areas-code"
                data-testid={`area-code-${area.id}`}
                aria-label="Area code"
                placeholder="Code"
                value={area.code}
                onChange={(e) => updateArea(area.id, { code: e.target.value })}
              />
              <input
                className="areas-name"
                data-testid={`area-name-${area.id}`}
                aria-label="Area name"
                placeholder="Name (optional)"
                value={area.name ?? ''}
                onChange={(e) => updateArea(area.id, { name: e.target.value })}
              />
              <button
                data-testid={`area-del-${area.id}`}
                title="Delete this area and its units"
                onClick={() => deleteArea(area.id, area.code)}
              >
                ✕
              </button>
            </div>

            <div className="areas-units">
              {(h.unitsByArea.get(area.id) ?? []).map((unit) => (
                <div key={unit.id} className="areas-row areas-unit" data-testid={`unit-${unit.id}`}>
                  <input
                    className="areas-code"
                    data-testid={`unit-code-${unit.id}`}
                    aria-label="Unit code"
                    placeholder="Code"
                    value={unit.code}
                    onChange={(e) => updateUnit(unit.id, { code: e.target.value })}
                  />
                  <input
                    className="areas-name"
                    data-testid={`unit-name-${unit.id}`}
                    aria-label="Unit name"
                    placeholder="Name (optional)"
                    value={unit.name ?? ''}
                    onChange={(e) => updateUnit(unit.id, { name: e.target.value })}
                  />
                  <span className="areas-count" title="Objects assigned to this unit">
                    {assigned.get(unit.id) ?? 0}
                  </span>
                  <button
                    data-testid={`unit-del-${unit.id}`}
                    title="Delete this unit"
                    onClick={() => deleteUnit(unit.id, unit.code)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="areas-add-unit"
                data-testid={`unit-add-${area.id}`}
                onClick={() => addUnit(area.id, '')}
              >
                ＋ Add unit
              </button>
            </div>
          </section>
        ))}

        <button className="areas-add" data-testid="area-add" onClick={() => addArea('')}>
          ＋ Add area
        </button>

        {/*
          The legacy bridge. Everything that predates the hierarchy lived in one
          free-text box labelled "Area / Unit", so nothing here guesses: only a
          value that is EXACTLY one declared unit code is offered, the rest are
          listed as still to be assigned, and the original text is never touched
          either way.
        */}
        {legacy.rows.length > 0 && (
          <section className="areas-legacy" data-testid="areas-legacy">
            <div className="prop-title">Free-text areas from before</div>
            <p className="areas-note">
              {legacy.mapped.length} of {legacy.rows.length} match a unit code exactly and can be assigned
              now. The rest are listed below and keep their original text either way — nothing is
              overwritten.
            </p>
            {legacy.mapped.length > 0 && (
              <button
                data-testid="areas-map-legacy"
                onClick={() => setMapped(applyLegacyMapping(legacy.rows))}
              >
                Assign {legacy.mapped.length} matching record{legacy.mapped.length === 1 ? '' : 's'}
              </button>
            )}
            {mapped !== null && (
              <p className="areas-note" data-testid="areas-mapped">Assigned {mapped}.</p>
            )}
            {legacy.needsAttention.length > 0 && (
              <ul className="areas-unmapped" data-testid="areas-unmapped">
                {legacy.needsAttention.slice(0, 20).map((r) => (
                  <li key={r.key}><b>{r.key}</b> — {r.reason}</li>
                ))}
                {legacy.needsAttention.length > 20 && (
                  <li>…and {legacy.needsAttention.length - 20} more.</li>
                )}
              </ul>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
