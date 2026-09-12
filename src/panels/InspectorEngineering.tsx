// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import type { PlantNode } from '../model/types'
import { FIELD_CATALOG } from '../model/fields'
import { RECORD_STATUSES, keyOfNode, kindOfNode, type RecordStatus } from '../model/registry'
import { pauseHistory, resumeHistory, useStore } from '../store/store'
import { expandLetters } from '../isa/tag'
import DatasheetEditor from './DatasheetEditor'
import UnitPicker from './UnitPicker'
import { LEGACY_AREA_FIELD, buildHierarchy, placementOf } from '../model/hierarchy'

const STATUS_LABEL: Record<RecordStatus, string> = {
  draft: 'Draft',
  'in-review': 'In review',
  approved: 'Approved',
  issued: 'Issued',
}

/**
 * The engineering record for the selected object — the thing the drawing is a
 * view of. Fields come from the catalog for this kind of object, so a valve is
 * asked about its trim and fail position while an instrument is asked about its
 * calibrated range.
 *
 * Values are read registry-first with a fallback to the object's legacy
 * `node.datasheet`, so a document saved before schemaVersion 5 shows its data
 * here immediately, and the first edit writes it into the record for good.
 */
export default function InspectorEngineering({ node }: { node: PlantNode }) {
  const doc = useStore((s) => s.doc)
  const setRecordField = useStore((s) => s.setRecordField)
  const setRecordStatus = useStore((s) => s.setRecordStatus)
  const assignUnit = useStore((s) => s.assignUnit)
  const [datasheetOpen, setDatasheetOpen] = useState(false)
  // Above the early returns, because a hook may not sit behind one — and
  // memoised on the document because this panel re-renders on every keystroke
  // in every field beneath it.
  const hierarchy = useMemo(() => buildHierarchy(doc), [doc])

  const key = keyOfNode(node)
  const kind = kindOfNode(node)

  if (!kind) return <div className="drawer-empty">Annotations carry no engineering record.</div>
  if (!key) {
    return (
      <div className="eng-untagged">
        <p>This {kind} has no tag yet, so there is nothing to hang a record on.</p>
        <p className="prop-hint">
          Give it a tag on the Symbol tab and its engineering record appears here — and follows it from then on,
          even if you delete and redraw the symbol.
        </p>
      </div>
    )
  }

  const record = doc.registry?.[key]
  // Area is READ, never set: it follows the unit, and offering a second
  // control for it would be offering a way to make the two disagree.
  const place = placementOf(hierarchy, record?.unitId)
  const sections = FIELD_CATALOG[kind]
  const valueOf = (fieldKey: string) => record?.fields[fieldKey] ?? node.datasheet?.[fieldKey] ?? ''
  const filled = sections.flatMap((s) => s.fields).filter((f) => valueOf(f.key).trim() !== '').length
  const total = sections.reduce((n, s) => n + s.fields.length, 0)

  return (
    <div className="eng">
      <div className="eng-head">
        <div>
          <b>{key}</b>
          {node.tag && <span className="datasheet-sub"> {expandLetters(node.tag.letters)}</span>}
        </div>
        <select
          className="eng-status"
          title="Engineering status of this record"
          value={record?.status ?? 'draft'}
          onChange={(e) => {
            // the record has to exist before it can carry a status
            if (!record) setRecordField(key, kind, '__touch', '')
            setRecordStatus(key, e.target.value as RecordStatus)
          }}
        >
          {RECORD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <div className="eng-progress" title={`${filled} of ${total} fields filled`}>
        <span style={{ width: `${total ? (filled / total) * 100 : 0}%` }} />
        <em>{filled}/{total}</em>
      </div>

      {/*
        Above the catalogue, not inside it. Where an object sits in the plant
        is not one more datasheet value to type — it is a reference, and it is
        the thing every other deliverable groups by, so it reads first.
      */}
      <section className="eng-section eng-place">
        <div className="prop-title">Plant hierarchy</div>
        <label className="eng-field">
          <span>Unit</span>
          <UnitPicker
            testId="eng-unit"
            hierarchy={hierarchy}
            value={record?.unitId}
            onChange={(unitId) => assignUnit(key, kind, unitId)}
          />
        </label>
        <p className="prop-hint" data-testid="eng-area">
          {hierarchy.areas.length === 0
            ? 'No areas defined yet — add them under Areas on the toolbar.'
            : place.area
              ? `Area ${place.area.code}${place.area.name ? ` — ${place.area.name}` : ''}`
              : place.unit
                ? 'This unit’s area is missing from the project.'
                : 'Not assigned to a unit.'}
        </p>
      </section>

      {sections.map((section) => (
        <section key={section.id} className="eng-section">
          <div className="prop-title">{section.title}</div>
          {section.fields.map((f) => (
            <div key={f.key}>
              <label className="eng-field">
                <span>{f.label}</span>
                <input
                  data-testid={`eng-${f.key}`}
                  className={f.key === LEGACY_AREA_FIELD ? 'eng-legacy' : undefined}
                  value={valueOf(f.key)}
                  onChange={(e) => { setRecordField(key, kind, f.key, e.target.value); pauseHistory() }}
                  onBlur={resumeHistory}
                />
              </label>
              {/* The one field that is deliberately still here and deliberately
                  no longer the answer. Existing values are untouched and still
                  export; what changes is that nobody is invited to add more. */}
              {f.key === LEGACY_AREA_FIELD && (
                <p className="prop-hint eng-legacy-note" data-testid="eng-legacy-area-note">
                  Legacy free text, kept so nothing typed before is lost. Use <b>Unit</b> above for new
                  work — it is structured, filters, and survives a code change.
                </p>
              )}
            </div>
          ))}
        </section>
      ))}

      {node.kind === 'instrument' && (
        <div className="prop-row">
          <button onClick={() => setDatasheetOpen(true)}>Open as a datasheet…</button>
        </div>
      )}
      {datasheetOpen && <DatasheetEditor node={node} onClose={() => setDatasheetOpen(false)} />}
    </div>
  )
}
