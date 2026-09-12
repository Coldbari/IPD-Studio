// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { getSnapshot } from '../persist/revisions'
import { compareRevisions } from '../model/diff'
import type { CompareResult, DocChange } from '../model/diff'
import { isIssued, revisionsOf } from '../model/revision'
import { CONFORMANCE_LABEL, historicalConformance } from '../model/conformance'
import type { Sheet } from '../model/types'

/**
 * Comparing two issued revisions.
 *
 * Only ISSUED revisions appear: an unissued row has no snapshot, so there is
 * nothing to compare. Snapshots are read when Compare is pressed and not
 * before — two whole documents out of IndexedDB is not work to do on a render.
 */

const ENTITY_LABEL: Record<DocChange['entityType'], string> = {
  sheet: 'Sheet',
  node: 'Symbol',
  edge: 'Line',
  record: 'Record',
  'hmi-screen': 'HMI screen',
  'hmi-widget': 'HMI widget',
  'hmi-pipe': 'HMI pipe',
  standard: 'Standard',
  fluid: 'Service',
  budget: 'Budget',
  'custom-symbol': 'Custom symbol',
  'qa-accepted': 'Accepted finding',
  area: 'Area',
  unit: 'Unit',
  loop: 'Loop',
  document: 'Document',
}

const show = (v: DocChange['before']): string =>
  v === undefined || v === '' ? '—' : String(v)

/**
 * What a reviewer reads in the "Tag / key" column.
 *
 * A loop prints as its NUMBER, which is what an engineer calls it. The ULID
 * behind it is the identity the comparison ran on and is deliberately not
 * shown — it identifies the loop to the software, not to the reader, and a
 * table full of 26-character ids is a table nobody scans.
 */
const keyOf = (c: DocChange): string =>
  c.entityType === 'loop' ? `Loop ${c.entityKey ?? '—'}` : c.entityKey ?? '—'

export default function RevisionCompare({ sheet }: { sheet: Sheet }) {
  const issued = revisionsOf(sheet).filter(isIssued)
  const [aId, setAId] = useState(() => issued[issued.length - 2]?.id ?? issued[0]?.id ?? '')
  const [bId, setBId] = useState(() => issued[issued.length - 1]?.id ?? '')
  const [result, setResult] = useState<CompareResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [engineeringOnly, setEngineeringOnly] = useState(true)

  if (issued.length < 2) {
    return (
      <p className="rev-compare-note" data-testid="rev-compare-note">
        Two issued revisions are needed before there is anything to compare.
      </p>
    )
  }

  const run = async () => {
    const a = issued.find((r) => r.id === aId)
    const b = issued.find((r) => r.id === bId)
    if (!a || !b) return
    setBusy(true)
    try {
      const [before, after] = await Promise.all([
        a.snapshotId ? getSnapshot(a.snapshotId) : undefined,
        b.snapshotId ? getSnapshot(b.snapshotId) : undefined,
      ])
      setResult(compareRevisions(a, b, { before, after }))
    } finally {
      setBusy(false)
    }
  }

  const changes = result?.ok
    ? result.diff.changes.filter((c) => !engineeringOnly || c.category === 'engineering')
    : []

  return (
    <div className="rev-compare" data-testid="rev-compare">
      <div className="rev-compare-bar">
        <label>From
          <select data-testid="cmp-a" value={aId} onChange={(e) => { setAId(e.target.value); setResult(null) }}>
            {issued.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
          </select>
        </label>
        <label>To
          <select data-testid="cmp-b" value={bId} onChange={(e) => { setBId(e.target.value); setResult(null) }}>
            {issued.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
          </select>
        </label>
        <button data-testid="cmp-run" disabled={busy || aId === bId} onClick={() => void run()}>
          Compare
        </button>
      </div>

      {result && !result.ok && (
        <div className="rev-compare-error" data-testid="cmp-error">{result.message}</div>
      )}

      {result?.ok && (
        <>
          <div className="rev-compare-summary" data-testid="cmp-summary">
            <span><b>{result.diff.counts.added}</b> added</span>
            <span><b>{result.diff.counts.removed}</b> removed</span>
            <span><b>{result.diff.counts.modified}</b> modified</span>
            <span><b>{result.diff.counts.renamed}</b> renamed</span>
          </div>
          {/* Conformance is CONTEXT for the two revisions, not a diff row.
              It is a historical property of each issue — what the drawing was
              judged to be at the time — so it belongs beside the comparison,
              not inside it. A change to the standard's issue policy DOES show
              up in the table, through the standard fingerprint and the
              `issuePolicy.*` fields, which is where a rules change belongs. */}
          <div className="rev-compare-conf" data-testid="cmp-conformance">
            {([['A', aId], ['B', bId]] as const).map(([side, id]) => {
              const rev = issued.find((r) => r.id === id)
              if (!rev) return null
              const h = historicalConformance(rev)
              return (
                <span key={side} data-testid={`cmp-conf-${side}`}>
                  Rev {rev.code}:{' '}
                  <span className={`rev-chip rev-chip-${h.status}`}>{CONFORMANCE_LABEL[h.status]}</span>
                  {h.record && ` (${h.record.open.total} open, ${h.record.accepted.total} accepted, ${h.record.rulesEvaluated} checks)`}
                </span>
              )
            })}
          </div>

          <div className="rev-compare-note">
            {result.diff.engineeringCount === 0
              ? 'No engineering data changed between these revisions.'
              : `${result.diff.engineeringCount} engineering change${result.diff.engineeringCount === 1 ? '' : 's'}.`}
            {result.diff.qa && (
              <> Checks at issue: {result.diff.qa.before?.total ?? '—'} → {result.diff.qa.after?.total ?? '—'}.</>
            )}
          </div>

          <label className="rev-compare-filter">
            <input type="checkbox" data-testid="cmp-eng-only" checked={engineeringOnly}
              onChange={(e) => setEngineeringOnly(e.target.checked)} />
            Engineering changes only
          </label>

          {changes.length === 0 ? (
            <p className="rev-compare-note" data-testid="cmp-empty">Nothing to show.</p>
          ) : (
            <table className="rev-compare-table" data-testid="cmp-table">
              <thead>
                <tr><th>Change</th><th>Entity</th><th>Tag / key</th><th>Field</th><th>Before</th><th>After</th></tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={`${c.entityType}-${c.entityId}-${c.field ?? ''}-${i}`} className={`cmp-${c.kind}`}>
                    <td>{c.kind}</td>
                    <td>{ENTITY_LABEL[c.entityType]}</td>
                    <td>{keyOf(c)}</td>
                    <td>{c.field ?? '—'}</td>
                    <td>{show(c.before)}</td>
                    <td>{show(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
