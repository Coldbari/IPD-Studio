// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useQa } from '../validate/live'
import { locateCell } from '../canvas/locate'
import { navigateWorkspace } from '../routes'
import { applyFix } from '../assist/fixes'
import { showStatus } from '../feedback/notices'

/**
 * The glance version while you draw: criticals and warnings only, newest rule
 * groups flattened. The full report — information, filters, accept-with-reason
 * — lives in the Checks workspace, one click away.
 */
export default function IssuesPanel() {
  const report = useQa()

  const go = (sheetId?: string, targetId?: string) => locateCell(targetId, sheetId)

  const shown = report.groups.filter((g) => g.rule.severity !== 'info')

  if (report.total === 0) {
    return <div className="drawer-empty">No findings — the drawing is clean.</div>
  }

  return (
    <div className="drawer-list">
      {shown.length === 0 && (
        <div className="drawer-group">Nothing critical — {report.counts.info} observation{report.counts.info === 1 ? '' : 's'} in Checks</div>
      )}
      {/* Findings this panel deliberately does not list still have to be
          accounted for. This line only appeared when the visible list was
          COMPLETELY empty, so a report with one warning and four observations
          showed one row and said nothing about the rest. */}
      {shown.length > 0 && report.counts.info > 0 && (
        <div className="drawer-aside">
          {report.counts.info} observation{report.counts.info === 1 ? '' : 's'} not shown here — see Checks
        </div>
      )}
      {shown.map((g) => (
        <section key={g.rule.id}>
          <div className={`drawer-group sev-${g.rule.severity}`}>
            {g.rule.title} ({g.findings.length})
          </div>
          {g.findings.map((f) => (
            <div key={f.key} className="advisor-row">
              <button className="drawer-item" disabled={!f.targetId} onClick={() => go(f.sheetId, f.targetId)}>
                {f.message}
              </button>
              {/* The result used to be dropped entirely here: a fix that no
                  longer applied left a button that appeared to do nothing. The
                  Checks workspace reported it; this panel did not. */}
              {f.fix && (
                <button className="advisor-fix" title={f.fix.label} onClick={() => {
                  const r = applyFix(f.fix!.spec)
                  if (!r.ok) {
                    showStatus(
                      r.message ?? 'That fix no longer applies — the drawing has moved on since this finding was raised.',
                      { kind: 'warning' },
                    )
                  }
                }}>Fix</button>
              )}
            </div>
          ))}
        </section>
      ))}
      <button className="drawer-more" onClick={() => navigateWorkspace('checks')}>
        Open the full report in Checks →
      </button>
    </div>
  )
}
