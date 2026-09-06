// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import type { PlantNode } from '../model/types'
import { FIELD_CATALOG } from '../model/fields'
import { RECORD_STATUSES, keyOfNode, kindOfNode, type RecordStatus } from '../model/registry'
import { pauseHistory, resumeHistory, useStore } from '../store/store'
import { expandLetters } from '../isa/tag'
import DatasheetEditor from './DatasheetEditor'
import { useT } from '../i18n'

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
  const t = useT()
  const doc = useStore((s) => s.doc)
  const setRecordField = useStore((s) => s.setRecordField)
  const setRecordStatus = useStore((s) => s.setRecordStatus)
  const [datasheetOpen, setDatasheetOpen] = useState(false)

  const key = keyOfNode(node)
  const kind = kindOfNode(node)

  if (!kind) return <div className="drawer-empty">{t('Annotations carry no engineering record.')}</div>
  if (!key) {
    return (
      <div className="eng-untagged">
        <p>{t('This')} {t(kind)} {t('has no tag yet, so there is nothing to hang a record on.')}</p>
        <p className="prop-hint">
          {t('Give it a tag on the Symbol tab and its engineering record appears here — and follows it from then on, even if you delete and redraw the symbol.')}
        </p>
      </div>
    )
  }

  const record = doc.registry?.[key]
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
          title={t('Engineering status of this record')}
          value={record?.status ?? 'draft'}
          onChange={(e) => {
            // the record has to exist before it can carry a status
            if (!record) setRecordField(key, kind, '__touch', '')
            setRecordStatus(key, e.target.value as RecordStatus)
          }}
        >
          {RECORD_STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
        </select>
      </div>

      <div className="eng-progress" title={`${filled} ${t('of')} ${total} ${t('fields filled')}`}>
        <span style={{ width: `${total ? (filled / total) * 100 : 0}%` }} />
        <em>{filled}/{total}</em>
      </div>

      {sections.map((section) => (
        <section key={section.id} className="eng-section">
          <div className="prop-title">{t(section.title)}</div>
          {section.fields.map((f) => (
            <label className="eng-field" key={f.key}>
              <span>{t(f.label)}</span>
              <input
                data-testid={`eng-${f.key}`}
                value={valueOf(f.key)}
                onChange={(e) => { setRecordField(key, kind, f.key, e.target.value); pauseHistory() }}
                onBlur={resumeHistory}
              />
            </label>
          ))}
        </section>
      ))}

      {node.kind === 'instrument' && (
        <div className="prop-row">
          <button onClick={() => setDatasheetOpen(true)}>{t('Open as a datasheet…')}</button>
        </div>
      )}
      {datasheetOpen && <DatasheetEditor node={node} onClose={() => setDatasheetOpen(false)} />}
    </div>
  )
}
