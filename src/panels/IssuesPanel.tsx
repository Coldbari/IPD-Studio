// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useStore } from '../store/store'
import { findingText, qaFor } from '../validate/engine'
import { locateCell } from '../canvas/locate'
import { navigateWorkspace } from '../routes'
import { applyFix } from '../assist/fixes'
import { useT } from '../i18n'

/**
 * The glance version while you draw: criticals and warnings only, newest rule
 * groups flattened. The full report — information, filters, accept-with-reason
 * — lives in the Checks workspace, one click away.
 */
export default function IssuesPanel() {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const report = qaFor(doc)

  const go = (sheetId?: string, targetId?: string) => locateCell(targetId, sheetId)

  const shown = report.groups.filter((g) => g.rule.severity !== 'info')

  if (report.total === 0) {
    return <div className="drawer-empty">{t('No findings — the drawing is clean.')}</div>
  }

  return (
    <div className="drawer-list">
      {shown.length === 0 && (
        <div className="drawer-group">{t('Nothing critical —')} {report.counts.info} {t(report.counts.info === 1 ? 'observation' : 'observations')} {t('in Checks')}</div>
      )}
      {shown.map((g) => (
        <section key={g.rule.id}>
          <div className={`drawer-group sev-${g.rule.severity}`}>
            {t(g.rule.title)} ({g.findings.length})
          </div>
          {g.findings.map((f) => (
            <div key={f.key} className="advisor-row">
              <button className="drawer-item" disabled={!f.targetId} onClick={() => go(f.sheetId, f.targetId)}>
                {findingText(f.message, t)}
              </button>
              {f.fix && (
                <button className="advisor-fix" title={t(f.fix.label)} onClick={() => applyFix(f.fix!.spec)}>{t('Fix')}</button>
              )}
            </div>
          ))}
        </section>
      ))}
      <button className="drawer-more" onClick={() => navigateWorkspace('checks')}>
        {t('Open the full report in Checks →')}
      </button>
    </div>
  )
}
