// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import Modal from './Modal'
import RevisionCompare from './RevisionCompare'
import { useStore } from '../store/store'
import { issueRevision } from '../persist/revisions'
import { issueGateFor, issueStatusesOf } from '../model/standard'
import { isIssued, revisionsOf } from '../model/revision'
import QaEvidenceDialog from './QaEvidenceDialog'
import { fingerprintStandard, provenanceLabel } from '../model/provenance'
import { standardOf } from '../model/standard'
import { qaFor } from '../validate/engine'
import { downloadConformance } from '../export/csv'
import { CONFORMANCE_LABEL, evaluateConformance, historicalConformance, issueBlockers } from '../model/conformance'
import type { Revision, Sheet } from '../model/types'

/**
 * The revision table of one drawing.
 *
 * Deliberately small. It records what happened — code, date, reason, who
 * prepared/checked/approved, and at what status — and it captures the state
 * when the drawing is issued.
 *
 * It gates an issue ONLY when the house has configured a gate for that status.
 * With no `issuePolicy` the behaviour is exactly what it always was: engineers
 * knowingly issue with findings open, and a tool that refuses on its own
 * authority gets worked around by exporting a PDF instead. A gate the company
 * wrote down is a different thing from a gate the software invented.
 *
 * Where a gate does apply, the disabled button below is UX, not enforcement.
 * The refusal lives in `markIssued`; this screen's job is to make the reason
 * visible before someone clicks, and to never hide it afterwards.
 */
export default function RevisionsDialog({ sheet, onClose }: { sheet: Sheet; onClose(): void }) {
  const doc = useStore((s) => s.doc)
  const addRevision = useStore((s) => s.addRevision)
  const updateRevision = useStore((s) => s.updateRevision)
  const deleteRevision = useStore((s) => s.deleteRevision)
  const statuses = useMemo(() => issueStatusesOf(doc.standard), [doc.standard])
  const rows = revisionsOf(sheet)
  const [evidence, setEvidence] = useState<Revision | null>(null)
  /** The fingerprint of the standard the project is on RIGHT NOW, so a row can
   *  say whether the rules have moved since it was issued — without any row
   *  being rewritten to match. */
  const liveFingerprint = useMemo(() => fingerprintStandard(standardOf(doc)), [doc])
  const open = rows.filter((r) => !isIssued(r))
  const [busy, setBusy] = useState(false)
  /** Reasons the last attempt was refused. Only ever set from what the STORE
   *  returned, never from the local pre-check — if the two ever disagreed, the
   *  one that actually refused the write is the one worth reading. */
  const [refused, setRefused] = useState<string[]>([])

  // Shown before issuing, so nobody stamps a drawing without seeing the report.
  const qa = useMemo(() => qaFor(doc), [doc])

  const draft = open[open.length - 1]

  // The gate for the status this draft would be issued at, and what it says
  // right now. Same functions the store runs, over the same cached report.
  const gate = draft ? issueGateFor(doc.standard, draft.status) : undefined
  const verdict = useMemo(() => evaluateConformance(qa, gate), [qa, gate])
  const blockers = useMemo(
    () => (draft ? issueBlockers(draft, gate, qa, verdict) : []),
    [draft, gate, qa, verdict],
  )

  const startRevision = () => {
    addRevision(sheet.id, {
      code: nextCode(rows),
      status: statuses[0] ?? 'WIP',
      date: new Date().toISOString().slice(0, 10),
    })
  }

  const issue = async (rev: Revision) => {
    setBusy(true)
    try {
      const res = await issueRevision(sheet.id, rev.id)
      setRefused(res.ok ? [] : res.blockers)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Revisions — ${sheet.drawingNumber || sheet.name}`} onClose={onClose} width={560} busy={busy}>
      <div className="rev-dialog" data-testid="revisions-dialog">
        {rows.length === 0 && (
          <p className="rev-empty">
            This drawing has no revision table yet. Starting one records what changed, who
            prepared it, and the state of the checks when it was issued.
          </p>
        )}

        {rows.length > 0 && (
          <table className="rev-table" data-testid="rev-table">
            <thead>
              <tr>
                <th>Rev</th><th>Date</th><th>Description</th><th>Status</th>
                <th>By</th><th>Chk</th><th>App</th><th>Issued</th><th>Checked against</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.id} className={isIssued(r) ? 'rev-issued' : 'rev-open'} data-testid={`rev-row-${r.code}`}>
                  <td>{r.code}</td>
                  <td>{r.date || '—'}</td>
                  <td>{r.description || '—'}</td>
                  <td>{r.status}</td>
                  <td>{r.preparedBy || '—'}</td>
                  <td>{r.checkedBy || '—'}</td>
                  <td>{r.approvedBy || '—'}</td>
                  <td>
                    {isIssued(r) ? (
                      <span className="rev-badge-issued" title={r.issuedAt}>
                        Issued
                        {r.qaAtIssue ? ` · ${r.qaAtIssue.total} finding${r.qaAtIssue.total === 1 ? '' : 's'}` : ''}
                      </span>
                    ) : (
                      <span className="rev-badge-wip">Work in progress</span>
                    )}
                  </td>
                  {/* The provenance column: which rules this issue was judged
                      by, and whether the evidence for that judgement survived.
                      Both are read straight off the frozen row. */}
                  <td className="rev-prov">
                    {!isIssued(r) ? (
                      <span className="rev-prov-none">—</span>
                    ) : r.standard ? (
                      <>
                        <span
                          data-testid={`rev-std-${r.code}`}
                          className={r.standard.fingerprint === liveFingerprint ? 'rev-prov-same' : 'rev-prov-moved'}
                          title={
                            r.standard.fingerprint === liveFingerprint
                              ? `Fingerprint ${r.standard.fingerprint} — the project standard is still this one`
                              : `Fingerprint ${r.standard.fingerprint} — the project standard has changed since this issue. History is unaffected.`
                          }
                        >
                          {provenanceLabel(r.standard)}
                        </span>
                        {r.standard.fingerprint !== liveFingerprint && (
                          <span className="rev-prov-moved-note" data-testid={`rev-std-moved-${r.code}`}> · standard has changed since</span>
                        )}
                      </>
                    ) : (
                      <span className="rev-prov-none" data-testid={`rev-std-missing-${r.code}`}>not recorded</span>
                    )}
                    {isIssued(r) && <ConformanceChip revision={r} />}
                    {isIssued(r) && (
                      <button
                        className="rev-evidence"
                        data-testid={`rev-conf-csv-${r.code}`}
                        onClick={() => downloadConformance(sheet, r)}
                        title="A portable conformance report for this issue — verdict, standard fingerprint and the frozen findings"
                      >
                        Conformance CSV
                      </button>
                    )}
                    {isIssued(r) && (
                      <button
                        className="rev-evidence"
                        data-testid={`rev-evidence-${r.code}`}
                        onClick={() => setEvidence(r)}
                        title={r.qaEvidence ? 'What QA found when this was issued' : 'No evidence was recorded for this revision'}
                      >
                        {r.qaEvidence ? `QA evidence (${r.qaEvidence.findings.length + r.qaEvidence.omitted})` : 'QA evidence —'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {revisionsOf(sheet).filter(isIssued).length >= 1 && (
          <details className="rev-compare-wrap" data-testid="rev-compare-wrap">
            <summary>Compare revisions</summary>
            <RevisionCompare sheet={sheet} />
          </details>
        )}

        {draft ? (
          <div className="rev-editor" data-testid="rev-editor">
            <div className="rev-editor-title">Revision {draft.code}</div>
            <div className="rev-grid">
              <label>Rev
                <input data-testid="rev-code" value={draft.code}
                  onChange={(e) => updateRevision(sheet.id, draft.id, { code: e.target.value })} />
              </label>
              <label>Date
                <input data-testid="rev-date" type="date" value={draft.date}
                  onChange={(e) => updateRevision(sheet.id, draft.id, { date: e.target.value })} />
              </label>
              <label>Status
                <select data-testid="rev-status" value={draft.status}
                  onChange={(e) => updateRevision(sheet.id, draft.id, { status: e.target.value })}>
                  {statuses.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </label>
              <label className="rev-wide">Reason for revision
                <input data-testid="rev-description" value={draft.description}
                  placeholder="What changed, and why"
                  onChange={(e) => updateRevision(sheet.id, draft.id, { description: e.target.value })} />
              </label>
              <label>Prepared by
                <input data-testid="rev-prepared" value={draft.preparedBy}
                  onChange={(e) => updateRevision(sheet.id, draft.id, { preparedBy: e.target.value })} />
              </label>
              <label>Checked by
                <input data-testid="rev-checked" value={draft.checkedBy ?? ''}
                  onChange={(e) => updateRevision(sheet.id, draft.id, { checkedBy: e.target.value })} />
              </label>
              <label>Approved by
                <input data-testid="rev-approved" value={draft.approvedBy ?? ''}
                  onChange={(e) => updateRevision(sheet.id, draft.id, { approvedBy: e.target.value })} />
              </label>
            </div>

            <div className="rev-qa" data-testid="rev-qa">
              {qa.total === 0
                ? 'The checks are clean.'
                : `${qa.total} open finding${qa.total === 1 ? '' : 's'}` +
                  (qa.counts.critical ? ` — ${qa.counts.critical} critical` : '') +
                  '. Issuing records this; it does not clear it.'}
            </div>

            {/* What would be frozen onto the row if this were issued now, and
                what the house's policy makes of it. Every number here is the
                one the store will record — not a second calculation. */}
            <div className="rev-pre" data-testid="rev-pre">
              <div className="rev-pre-line">
                <span className={`rev-chip rev-chip-${verdict.status}`} data-testid="rev-pre-status">
                  {CONFORMANCE_LABEL[verdict.status]}
                </span>
                <span data-testid="rev-pre-open">
                  Open: {verdict.open.critical} critical · {verdict.open.warning} warning · {verdict.open.info} info
                </span>
                <span data-testid="rev-pre-accepted">
                  Accepted: {verdict.accepted.critical} critical · {verdict.accepted.warning} warning · {verdict.accepted.info} info
                </span>
              </div>
              <div className="rev-pre-line rev-pre-dim">
                <span data-testid="rev-pre-rules">{verdict.rulesEvaluated} checks evaluated</span>
                <span data-testid="rev-pre-disabled">
                  {verdict.rulesDisabled.length === 0
                    ? 'no checks switched off'
                    : `${verdict.rulesDisabled.length} switched off: ${verdict.rulesDisabled.join(', ')}`}
                </span>
                <span data-testid="rev-pre-print" title="Fingerprint of the standard this would be issued against">
                  {provenanceLabel({ ...standardOf(doc), fingerprint: liveFingerprint })}
                </span>
              </div>
              {!gate && (
                <div className="rev-pre-dim" data-testid="rev-pre-ungated">
                  No issue policy is configured for {draft.status}, so nothing blocks this issue.
                </div>
              )}
            </div>

            {(blockers.length > 0 || refused.length > 0) && (
              /* The reason is never hidden behind a greyed-out button. */
              <div className="rev-blocked" data-testid="rev-blocked">
                <div className="rev-blocked-title" data-testid="rev-blocked-title">
                  Cannot issue {draft.code} as {draft.status}
                </div>
                <ul>
                  {(refused.length > 0 ? refused : blockers).map((why) => (
                    <li key={why}>{why}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rev-actions">
              <button className="rev-issue" data-testid="rev-issue" disabled={busy || blockers.length > 0}
                onClick={() => void issue(draft)}>
                Issue {draft.code} as {draft.status}
              </button>
              <button data-testid="rev-discard" disabled={busy}
                onClick={() => deleteRevision(sheet.id, draft.id)}>
                Discard
              </button>
            </div>
          </div>
        ) : (
          <div className="rev-actions">
            <button className="rev-issue" data-testid="rev-start" onClick={startRevision}>
              Start a revision
            </button>
          </div>
        )}
      </div>
      {evidence && <QaEvidenceDialog revision={evidence} onClose={() => setEvidence(null)} />}
    </Modal>
  )
}

/**
 * The frozen verdict on an issued row.
 *
 * Read straight off the revision. Nothing here consults the current standard
 * or the current report — a revision issued as Conformant stays Conformant
 * even after the rules tighten, because that is what the record says happened.
 */
function ConformanceChip({ revision }: { revision: Revision }) {
  const h = historicalConformance(revision)
  const title = h.record
    ? `Open ${h.record.open.total} · accepted ${h.record.accepted.total} · ${h.record.rulesEvaluated} checks evaluated` +
      (h.record.rulesDisabled.length ? ` · ${h.record.rulesDisabled.length} switched off` : '')
    : h.countsOnly
      ? `${h.open.total} finding${h.open.total === 1 ? '' : 's'} were counted at issue, but the findings themselves were not recorded`
      : 'This revision predates conformance recording'
  return (
    <span className={`rev-chip rev-chip-${h.status}`} data-testid={`rev-conf-${revision.code}`} title={title}>
      {CONFORMANCE_LABEL[h.status]}
      {h.countsOnly && <span className="rev-chip-note"> · finding evidence not recorded</span>}
    </span>
  )
}

/** 0 → A → B …, and numeric tables keep counting. Only ever a SUGGESTION: the
 *  code is editable, because house conventions are not ours to decide. */
function nextCode(rows: Revision[]): string {
  const last = rows[rows.length - 1]?.code?.trim()
  if (!last) return 'A'
  if (/^\d+$/.test(last)) return String(Number(last) + 1)
  const m = /^([A-Za-z])$/.exec(last)
  if (m) {
    const c = m[1]!
    return c === 'Z' || c === 'z' ? `${c}A` : String.fromCharCode(c.charCodeAt(0) + 1)
  }
  return `${last}1`
}
