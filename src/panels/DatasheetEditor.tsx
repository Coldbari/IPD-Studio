// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { fieldsFor } from '../model/datasheet'
import { fieldValue, keyOfNode, kindOfNode } from '../model/registry'
import type { PlantNode } from '../model/types'
import { formatTag } from '../isa/tag'
import { expandLetters } from '../isa/tag'
import { pauseHistory, resumeHistory, useStore } from '../store/store'
import { printDatasheet } from '../export/datasheetPdf'
import { useT } from '../i18n'

const SECTION_TITLES: Record<string, string> = {
  general: 'General',
  process: 'Process Conditions',
  element: 'Element / Body',
  signal: 'Signal & Electrical',
}

/** The datasheet form is a print-shaped VIEW of the engineering record — the
 *  same values the inspector's Engineering tab shows, not a second store. An
 *  untagged instrument has no record to write to, so it still writes the legacy
 *  per-node datasheet and the migration picks it up once a tag is given. */
export default function DatasheetEditor({ node, onClose }: { node: PlantNode; onClose: () => void }) {
  const t = useT()
  const setDatasheet = useStore((s) => s.setDatasheet)
  const setRecordField = useStore((s) => s.setRecordField)
  const doc = useStore((s) => s.doc)
  const recordKey = keyOfNode(node)
  const kind = kindOfNode(node)
  const write = (fieldKey: string, value: string) => {
    if (recordKey && kind) setRecordField(recordKey, kind, fieldKey, value)
    else setDatasheet(node.id, { [fieldKey]: value })
  }
  const letters = node.tag?.letters ?? 'XX'
  const sections = fieldsFor(letters)
  const title = node.tag ? formatTag(node.tag, '-') : t('Untagged instrument')

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="datasheet-box" onClick={(e) => e.stopPropagation()}>
        <div className="datasheet-head">
          <div>
            <b>{title}</b>
            <span className="datasheet-sub"> {expandLetters(letters)}</span>
          </div>
          <div className="prop-row">
            <button onClick={() => printDatasheet(doc, node)}>{t('Print PDF')}</button>
            <button onClick={onClose}>{t('Close')}</button>
          </div>
        </div>
        <div className="datasheet-body">
          {Object.entries(sections).map(([section, fields]) =>
            fields.length === 0 ? null : (
              <section key={section}>
                <div className="prop-title">{t(SECTION_TITLES[section] ?? section)}</div>
                {fields.map((f) => (
                  <label className="datasheet-field" key={f.key}>
                    <span>{t(f.label)}</span>
                    <input
                      value={fieldValue(doc.registry, node, f.key)}
                      onChange={(e) => { write(f.key, e.target.value); pauseHistory() }}
                      onBlur={resumeHistory}
                    />
                  </label>
                ))}
              </section>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
