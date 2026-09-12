// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import Modal from './Modal'
import { countsOfEvidence, provenanceLabel } from '../model/provenance'
import { CONFORMANCE_LABEL, historicalConformance } from '../model/conformance'
import type { Revision } from '../model/types'
import type { Severity } from '../validate/rules'

/**
 * WHAT QA FOUND WHEN THIS REVISION WAS ISSUED.
 *
 * Read-only, and read-only in the strong sense: every value here comes out of
 * the revision row exactly as it was frozen. Nothing is recomputed against the
 * current document, the current standard or the current rule set — the whole
 * point is to show what was true then, even when that disagrees with now.
 *
 * Deliberately not a QA management screen. There is nothing to fix, accept or
 * re-run here; the live report already does all of that. This answers one
 * question an auditor asks and then gets out of the way.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical', warning: 'Warning', info: 'Info',
}

export default function QaEvidenceDialog({ revision, onClose }: { revision: Revision; onClose(): void }) {
  const [filter, setFilter] = useState<Severity | 'all'>('all')
  const evidence = revision.qaEvidence

  const counts = useMemo(() => (evidence ? countsOfEvidence(evidence) : null), [evidence])
  const history = useMemo(() => historicalConformance(revision), [revision])
  /**
   * OPEN and ACCEPTED, counted apart.
   *
   * They must never be added together into one number. An accepted finding is
   * a decision somebody signed; an open one is a defect nobody has answered.
   * Preferring the frozen `conformance` counts over a recount of the stored
   * findings matters when the evidence was capped — the record knows the real
   * totals even when it could not keep every row.
   */
  const split = useMemo(() => {
    if (history.record) return { open: history.record.open, accepted: history.record.accepted, exact: true }
    const open = { critical: 0, warning: 0, info: 0, total: 0 }
    const accepted = { critical: 0, warning: 0, info: 0, total: 0 }
    for (const f of evidence?.findings ?? []) {
      const into = f.ignored ? accepted : open
      into[f.severity] += 1
      into.total += 1
    }
    return { open, accepted, exact: (evidence?.omitted ?? 0) === 0 }
  }, [history, evidence])
  const shown = useMemo(
    () => (evidence ? evidence.findings.filter((f) => filter === 'all' || f.severity === filter) : []),
    [evidence, filter],
  )

  return (
    <Modal title={`QA at issue — Rev ${revision.code}`} onClose={onClose} width={760}>
      <div className="qae" data-testid="qa-evidence">
        {!evidence ? (
          /* Honest about the gap rather than filling it. A revision issued
             before P2-A has no evidence and none can be reconstructed — the
             findings depended on a rule set and a standard that are not
             recorded anywhere. */
          <p className="qae-none" data-testid="qae-none">
            No QA evidence was recorded for this revision. It was issued by a build that stored only
            the finding counts{revision.qaAtIssue ? ` (${revision.qaAtIssue.total} in total)` : ''}, and
            what they were counts of cannot be reconstructed.
          </p>
        ) : (
          <>
            <div className="qae-verdict" data-testid="qae-verdict">
              <span className={`rev-chip rev-chip-${history.status}`}>{CONFORMANCE_LABEL[history.status]}</span>
              {history.record && (
                <>
                  <span data-testid="qae-rules">{history.record.rulesEvaluated} checks evaluated</span>
                  <span data-testid="qae-disabled">
                    {history.record.rulesDisabled.length === 0
                      ? 'No checks were switched off.'
                      : /* Stated plainly. A switched-off check did not pass —
                           nobody ran it, and a record that blurs the two is
                           the thing this dialog exists to prevent. */
                        `${history.record.rulesDisabled.length} check${history.record.rulesDisabled.length === 1 ? ' was' : 's were'} switched off and did not run: ${history.record.rulesDisabled.join(', ')}`}
                  </span>
                </>
              )}
              {!history.record && (
                <span data-testid="qae-rules">Rules evaluated not recorded for this revision.</span>
              )}
            </div>

            <div className="qae-split" data-testid="qae-split">
              <div data-testid="qae-open">
                <b>Open findings</b> — {split.open.critical} critical · {split.open.warning} warning · {split.open.info} info · {split.open.total} total
              </div>
              <div data-testid="qae-accepted">
                <b>Accepted findings</b> — {split.accepted.critical} critical · {split.accepted.warning} warning · {split.accepted.info} info · {split.accepted.total} total
              </div>
            </div>

            <div className="qae-head" data-testid="qae-head">
              <span className="qae-all">All recorded:</span>
              <span><b>{counts!.critical}</b> critical</span>
              <span><b>{counts!.warning}</b> warning</span>
              <span><b>{counts!.info}</b> info</span>
              <span className="qae-sp" />
              {revision.standard ? (
                <span className="qae-std" data-testid="qae-standard" title={revision.standard.fingerprint}>
                  Checked against {provenanceLabel(revision.standard)}
                </span>
              ) : (
                <span className="qae-std" data-testid="qae-standard">Standard not recorded</span>
              )}
            </div>

            <div className="qae-filters">
              {(['all', 'critical', 'warning', 'info'] as const).map((s) => (
                <button
                  key={s}
                  data-testid={`qae-filter-${s}`}
                  className={filter === s ? 'on' : ''}
                  onClick={() => setFilter(s)}
                >
                  {s === 'all' ? 'All' : SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>

            <div className="qae-body">
              <table data-testid="qae-table">
                <thead>
                  <tr><th>Severity</th><th>Check</th><th>Object</th><th>Finding</th><th>Accepted</th></tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.key} className={f.ignored ? 'qae-ignored' : undefined}>
                      <td className={`qae-sev qae-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</td>
                      <td>{f.ruleTitle}</td>
                      <td className="qae-entity">{f.entityKey}</td>
                      <td>{f.message}</td>
                      <td>
                        {f.ignored ? (
                          <span title={`${f.ignored.by ? `${f.ignored.by}, ` : ''}${f.ignored.at}`}>
                            Accepted — {f.ignored.reason}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <p className="qae-none">Nothing at this severity.</p>}
            </div>

            {evidence.omitted > 0 && (
              <p className="qae-note" data-testid="qae-omitted">
                {evidence.omitted} further finding{evidence.omitted === 1 ? '' : 's'} {evidence.omitted === 1 ? 'was' : 'were'} not
                stored — the record keeps the most severe first so a project's history stays a size that
                can be sent. The counts above are the full totals.
              </p>
            )}
            <p className="qae-note">Recorded {evidence.capturedAt.slice(0, 10)}. This record is frozen and is not recomputed.</p>
          </>
        )}
      </div>
    </Modal>
  )
}
