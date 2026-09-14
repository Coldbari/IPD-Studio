// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import type { PlantNode } from '../model/types'
import { FIELD_CATALOG } from '../model/fields'
import { RECORD_STATUSES, keyOfNode, kindOfNode, type EntityKind, type RecordStatus } from '../model/registry'
import { pauseHistory, resumeHistory, useStore } from '../store/store'
import { expandLetters } from '../isa/tag'
import DatasheetEditor from './DatasheetEditor'
import UnitPicker from './UnitPicker'
import LoopPicker from './LoopPicker'
import { LEGACY_AREA_FIELD, buildHierarchy, placementOf } from '../model/hierarchy'
import { LOOP_TYPE_LABELS } from '../model/loop'
import { nozzlesOf, type Nozzle } from '../model/nozzle'
import { showStatus } from '../feedback/notices'
import { portsOfNode } from '../model/projectIndex'

const STATUS_LABEL: Record<RecordStatus, string> = {
  draft: 'Draft',
  'in-review': 'In review',
  approved: 'Approved',
  issued: 'Issued',
}

/**
 * THE NOZZLE SCHEDULE for a piece of equipment, at its minimum.
 *
 * Everything here writes through the three authoritative store actions. The
 * panel decides nothing about numbering, collisions or history, and nothing is
 * inferred: size, rating, facing and service are blank until an engineer types
 * them, and connecting a line to a port does NOT fill any of them in.
 *
 * The port picker offers only the ports the drawn symbol actually has, and it
 * offers "no port" first, because a nozzle schedule legitimately runs ahead of
 * the drawing. A stored `portId` the symbol no longer has is shown as broken
 * rather than silently blanked or remapped to something that looks similar.
 */
function NozzleSection({ node, recordKey, kind }: { node: PlantNode; recordKey: string; kind: EntityKind }) {
  const doc = useStore((s) => s.doc)
  const addNozzle = useStore((s) => s.addNozzle)
  const updateNozzle = useStore((s) => s.updateNozzle)
  const removeNozzle = useStore((s) => s.removeNozzle)
  const [draft, setDraft] = useState('')

  const nozzles = nozzlesOf(doc.registry?.[recordKey])
  // The shared resolver, which already degrades to no ports for a symbol the
  // catalogue does not have rather than throwing. Keyed on the two fields it
  // reads, exactly as before: the store hands this panel a new `node` object
  // on every edit, and rebuilding the list for each would be work nothing
  // asked for.
  const ports = useMemo(() => portsOfNode(node).map((p) => p.id), [node.symbolId, node.extraPorts])

  const field = (nozzle: Nozzle, name: 'size' | 'rating' | 'facing' | 'service', label: string) => (
    <label className="eng-field" key={name}>
      <span>{label}</span>
      <input
        data-testid={`nozzle-${nozzle.number}-${name}`}
        value={nozzle[name] ?? ''}
        onChange={(e) => { updateNozzle(recordKey, nozzle.id, { [name]: e.target.value }); pauseHistory() }}
        onBlur={resumeHistory}
      />
    </label>
  )

  return (
    <section className="eng-section" data-testid="eng-nozzles">
      <div className="prop-title">Nozzles</div>
      {nozzles.length === 0 && (
        <p className="prop-hint" data-testid="eng-nozzles-empty">
          No nozzles on this record yet. A nozzle is engineering data — its size, rating and service are
          typed here, never read off the line connected to it.
        </p>
      )}
      {nozzles.map((nozzle) => (
        <div className="nozzle" key={nozzle.id} data-testid={`nozzle-${nozzle.id}`}>
          <div className="nozzle-head">
            <input
              className="nozzle-number"
              aria-label="Nozzle number"
              data-testid={`nozzle-${nozzle.id}-number`}
              defaultValue={nozzle.number}
              onBlur={(e) => {
                const result = updateNozzle(recordKey, nozzle.id, { number: e.target.value })
                if (!result.ok) {
                  showStatus(result.reason ?? 'That nozzle number is not available', { kind: 'warning' })
                  e.target.value = nozzle.number
                }
              }}
            />
            <select
              aria-label="Connection point"
              data-testid={`nozzle-${nozzle.id}-port`}
              value={nozzle.portId ?? ''}
              onChange={(e) => updateNozzle(recordKey, nozzle.id, { portId: e.target.value })}
            >
              <option value="">— no connection point —</option>
              {ports.map((id) => <option key={id} value={id}>{id}</option>)}
              {/* A stored port the symbol no longer has still shows, so the
                  value is visible rather than silently reset to blank. */}
              {nozzle.portId && !ports.includes(nozzle.portId) && (
                <option value={nozzle.portId}>{nozzle.portId} (not on this symbol)</option>
              )}
            </select>
            <button
              data-testid={`nozzle-${nozzle.id}-remove`}
              title={`Remove nozzle ${nozzle.number}`}
              onClick={() => removeNozzle(recordKey, nozzle.id)}
            >
              ✕
            </button>
          </div>
          {nozzle.portId && !ports.includes(nozzle.portId) && (
            <p className="prop-hint eng-loop-broken" data-testid={`nozzle-${nozzle.id}-broken`}>
              <b>Broken:</b> this symbol has no connection point {nozzle.portId}. Nothing has been
              reassigned — pick one above, or leave it for the record.
            </p>
          )}
          {field(nozzle, 'size', 'Size')}
          {field(nozzle, 'rating', 'Rating')}
          {field(nozzle, 'facing', 'Facing')}
          {field(nozzle, 'service', 'Service')}
        </div>
      ))}
      <div className="tag-row">
        <input
          placeholder="number (N1)"
          aria-label="New nozzle number"
          data-testid="nozzle-new-number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          data-testid="nozzle-add"
          disabled={!draft.trim()}
          onClick={() => {
            const result = addNozzle(recordKey, kind, draft)
            if (result.ok) setDraft('')
            else showStatus(result.reason ?? 'That nozzle could not be added', { kind: 'warning' })
          }}
        >
          Add nozzle
        </button>
      </div>
    </section>
  )
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
  const assignLoop = useStore((s) => s.assignLoop)
  const unassignLoop = useStore((s) => s.unassignLoop)
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

      {/*
        THE LOOP. A reference, like the unit above it — the same shape of
        control, writing the same shape of value: a stable id, displayed by the
        number an engineer reads. The id never appears on screen.

        A `loopId` naming no loop is shown as BROKEN rather than silently blank.
        Nothing is fabricated to fill the gap: the loop is gone, the record says
        so, and there is a button to say so too.
      */}
      <section className="eng-section eng-place">
        <div className="prop-title">Control loop</div>
        <label className="eng-field">
          <span>Loop</span>
          <LoopPicker
            testId="eng-loop"
            loops={doc.loops ?? []}
            value={record?.loopId}
            onChange={(loopId) => {
              // Straight to the authoritative actions. The panel decides
              // nothing about collisions, membership or history.
              if (loopId) assignLoop(key, kind, loopId)
              else unassignLoop(key)
            }}
          />
        </label>
        {(() => {
          const loop = record?.loopId ? (doc.loops ?? []).find((l) => l.id === record.loopId) : undefined
          if (record?.loopId && !loop) {
            return (
              <p className="prop-hint eng-loop-broken" data-testid="eng-loop-broken">
                <b>Broken:</b> this object is assigned to a loop that is not in the project any more.{' '}
                <button data-testid="eng-loop-repair" onClick={() => unassignLoop(key)}>
                  Clear the assignment
                </button>
              </p>
            )
          }
          if (!loop) {
            return (
              <p className="prop-hint" data-testid="eng-loop-note">
                {(doc.loops ?? []).length === 0
                  ? 'No loops declared yet — add them under Loops on the toolbar.'
                  : 'Not assigned to a loop.'}
              </p>
            )
          }
          return (
            <p className="prop-hint" data-testid="eng-loop-note">
              Loop {loop.number}
              {loop.name ? ` — ${loop.name}` : ''}
              {loop.type ? ` · ${LOOP_TYPE_LABELS[loop.type]}` : ' · type not stated'}
            </p>
          )
        })()}
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

      {/* Equipment only for now: a nozzle is a connection on a vessel, a pump
          or an exchanger. Valves and instruments have ports too, but nothing
          in the model says those are nozzles. */}
      {kind === 'equipment' && <NozzleSection node={node} recordKey={key} kind={kind} />}

      {node.kind === 'instrument' && (
        <div className="prop-row">
          <button onClick={() => setDatasheetOpen(true)}>Open as a datasheet…</button>
        </div>
      )}
      {datasheetOpen && <DatasheetEditor node={node} onClose={() => setDatasheetOpen(false)} />}
    </div>
  )
}
