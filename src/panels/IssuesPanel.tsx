// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useQa } from '../validate/live'
import { locateCell } from '../canvas/locate'
import { navigateWorkspace } from '../routes'
import { applyFix } from '../assist/fixes'

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
              {f.fix && (
                <button className="advisor-fix" title={f.fix.label} onClick={() => applyFix(f.fix!.spec)}>Fix</button>
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
