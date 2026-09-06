// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useStore } from '../store/store'
import { navigateWorkspace } from '../routes'
import { locateCell } from '../canvas/locate'
import {
  INSTRUMENT_INDEX_COLUMNS,
  LINE_LIST_COLUMNS,
  downloadInstrumentIndex,
  downloadLineList,
  instrumentIndexRows,
  lineListRows,
  type ReportRow,
} from '../export/csv'
import { useT } from '../i18n'

type Tab = 'instruments' | 'lines'

/**
 * The generated reports, on screen instead of only in a downloaded CSV.
 *
 * These are the SAME rows the CSV writers emit, so what you read here is what
 * ships. Read-only for now: editing writes back to the engineering record,
 * which does not exist yet (that is the registry, v0.15).
 */
export default function DataWorkspace() {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const [tab, setTab] = useState<Tab>('instruments')

  const rows = tab === 'instruments' ? instrumentIndexRows(doc) : lineListRows(doc)
  const columns = (tab === 'instruments' ? INSTRUMENT_INDEX_COLUMNS : LINE_LIST_COLUMNS).map((c) => t(c))

  // Invariant: every row in every report is a jump, never just text.
  const jump = (r: ReportRow) => {
    navigateWorkspace('draw')
    locateCell(r.id, r.sheetId)
  }

  return (
    <div className="ws">
      <header className="ws-head">
        <h1>{t('Data')}</h1>
        <div className="ws-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'instruments'} data-testid="data-tab-instruments"
            className={tab === 'instruments' ? 'on' : ''} onClick={() => setTab('instruments')}>
            {t('Instrument index')} <span className="ws-count">{instrumentIndexRows(doc).length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'lines'} data-testid="data-tab-lines"
            className={tab === 'lines' ? 'on' : ''} onClick={() => setTab('lines')}>
            {t('Line list')} <span className="ws-count">{lineListRows(doc).length}</span>
          </button>
        </div>
        <span className="ws-sp" />
        <button onClick={() => (tab === 'instruments' ? downloadInstrumentIndex() : downloadLineList())}>
          {t('Export CSV')}
        </button>
      </header>

      <div className="ws-body">
        {rows.length === 0 ? (
          <p className="ws-empty">
            {tab === 'instruments'
              ? t('No tagged instruments yet. Tag a symbol on the drawing and it appears here.')
              : t('No numbered lines yet. Give a process line a line number and it appears here.')}
          </p>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  {columns.map((c) => <th key={c}>{c}</th>)}
                  <th aria-label={t('Go to the drawing')} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {r.cells.map((cell, i) => (
                      <td key={i} className={i === 0 ? 'ws-key' : undefined}>{cell || '—'}</td>
                    ))}
                    <td className="ws-jump">
                      <button title={t('Show this on the drawing')} onClick={() => jump(r)}>{t('Locate')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
