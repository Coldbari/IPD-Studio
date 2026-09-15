// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { navigateWorkspace, type Workspace } from '../routes'
import { useQa } from '../validate/live'
import { buildIndex } from '../model/projectIndex'
import { projectHealth, percentText, type KindCompleteness } from '../model/health'
import { currencyOf, moneyShort } from '../model/currency'
import {
  countStates,
  deliverableStatus,
  lastIssuedModel,
  type DeliverableRow,
  type DeliverableState,
  type IssuedInput,
  type IssuedModel,
} from '../model/deliverables'
import { getSnapshot } from '../persist/revisions'

/**
 * How each state reads to somebody deciding whether a package can go out.
 *
 * Deliberately NOT "generated", "downloaded" or "approved". This product
 * cannot observe any of those — `download()` clicks an anchor and is told
 * nothing, and the PDF paths print through a hidden iframe — so a word
 * implying it knew would be a lie in a document-control screen.
 */
const STATE_LABEL: Record<DeliverableState, string> = {
  unchanged: 'UNCHANGED',
  differs: 'DIFFERS',
  'no-snapshot': 'NOT AVAILABLE HERE',
  'not-comparable': 'NOT COMPARABLE',
}

const KIND_LABEL: Record<KindCompleteness['kind'], string> = {
  equipment: 'Equipment',
  line: 'Lines',
  instrument: 'Instruments',
  valve: 'Valves',
}

/**
 * WHERE DOES THIS PROJECT STAND?
 *
 * One screen over numbers that already existed in five workspaces. It computes
 * nothing: `projectHealth` reads the index, the standard, the QA report, the
 * cost estimate and the revision table, and this renders what it returns.
 *
 * EVERY NUMBER IS A JUMP, to the workspace that owns it. That is not a
 * convenience — it is what keeps the dashboard honest. A tile you cannot open
 * is a tile nobody can check, and a dashboard that disagrees with the report
 * behind it is worse than no dashboard.
 *
 * THERE IS NO DELIVERABLES TILE. The original design had one reading
 * "Datasheets 342 / 386". Nothing in this product tracks which deliverables
 * have been issued or whether they have gone stale, so that number would be
 * invented. The slot is left empty until there is something to put in it.
 *
 * `—` MEANS "NOTHING TO MEASURE", and it is never dressed up as 0%. A project
 * with no started equipment records has not specified 0% of its equipment; it
 * has not begun, and those read very differently to somebody deciding whether
 * a package can go out.
 */
/**
 * The issued side of the comparison, and WHY when there is none.
 *
 * Three distinct ways to have no document, and a reader deserves the right
 * sentence for each: nothing has ever been issued, the revision was issued
 * without a snapshot being kept, or the snapshot is simply on another machine.
 * Snapshots never travel in the `.pnid` — the same degradation the revision
 * comparison already makes.
 */
async function resolveIssued(model: IssuedModel | undefined): Promise<IssuedInput> {
  if (!model) return { ok: false, reason: 'Nothing has been issued yet.' }
  if (!model.snapshotId) return { ok: false, reason: `Rev ${model.code} was issued without a stored snapshot.` }
  const doc = await getSnapshot(model.snapshotId)
  if (!doc) return { ok: false, reason: `The snapshot for Rev ${model.code} is not on this machine.` }
  return { ok: true, doc }
}

export default function ProjectWorkspace() {
  const doc = useStore((s) => s.doc)
  // The same report the rail badge and the Checks workspace read — one QA run
  // per document, shared, so the three cannot disagree.
  const qa = useQa()
  const health = useMemo(() => projectHealth(buildIndex(doc), qa), [doc, qa])

  const go = (w: Workspace) => () => navigateWorkspace(w)

  const bar = (fraction: number | undefined) => (
    <div className="ph-bar" aria-hidden="true">
      <span style={{ width: fraction === undefined ? 0 : `${Math.round(fraction * 100)}%` }} />
    </div>
  )

  // The same short form the budget chip on the toolbar prints, so the
  // dashboard and the chip cannot show two different numbers for one estimate.
  const cur = currencyOf(health.budget.currency)
  const money = (usd: number) => moneyShort(usd, cur)

  const latest = health.revisions

  /*
   * DELIVERABLE STALENESS, computed only when somebody asks for it.
   *
   * Comparing eight reports means generating sixteen of them, each with its
   * own index walk — two orders of magnitude more than the health projection
   * above, which runs on every render. So it is NOT in the memo: the button
   * starts it, and a document edit throws the answer away rather than silently
   * showing one that was true a keystroke ago.
   */
  const issuedModel = useMemo(() => lastIssuedModel(doc), [doc])
  const [check, setCheck] = useState<
    { phase: 'idle' } | { phase: 'running' } | { phase: 'done'; rows: DeliverableRow[] }
  >({ phase: 'idle' })

  // A result describes one document. When the document moves, it stops being
  // an answer — better to ask again than to show a stale staleness report.
  useEffect(() => { setCheck({ phase: 'idle' }) }, [doc])

  const runCheck = async () => {
    setCheck({ phase: 'running' })
    // The caller owns the async fetch and hands a plain document to the pure
    // projection — the shape `compareRevisions` already established.
    const issued = await resolveIssued(issuedModel)
    setCheck({ phase: 'done', rows: deliverableStatus(useStore.getState().doc, issued) })
  }

  const counts = check.phase === 'done' ? countStates(check.rows) : null

  return (
    <div className="ws">
      <header className="ws-head">
        <h1>Project</h1>
        <span className="ws-sp" />
        <span className="ph-title" data-testid="ph-name">{doc.meta.name || 'Untitled project'}</span>
      </header>

      <div className="ws-body ph-body">
        <p className="ws-note">
          Every number here is derived from the drawing and its engineering records — nothing on this
          screen is stored. Click any tile to open the workspace that owns it.
        </p>

        <div className="ph-grid">
          {/* -------------------------------------------------- what is on it */}
          <section className="ph-card" data-testid="ph-counts">
            <h2>What is drawn</h2>
            <button className="ph-jump" data-testid="ph-counts-jump" onClick={go('data')}>
              <span className="ph-row"><b data-testid="ph-count-equipment">{health.counts.equipment}</b> Equipment</span>
              <span className="ph-row"><b data-testid="ph-count-lines">{health.counts.lines}</b> Lines</span>
              <span className="ph-row"><b data-testid="ph-count-instruments">{health.counts.instruments}</b> Instruments</span>
              <span className="ph-row"><b data-testid="ph-count-valves">{health.counts.valves}</b> Valves</span>
              <span className="ph-row ph-row-quiet"><b>{health.counts.sheets}</b> {health.counts.sheets === 1 ? 'Sheet' : 'Sheets'}</span>
            </button>
            {/* A LINE is a physical run, which is what one line list row is —
                said out loud, because "214 lines" and "214 drawn segments" are
                very different numbers and only one of them is engineering. */}
            <p className="prop-hint">A line is one connected run of pipe, not one drawn segment.</p>
          </section>

          {/* ------------------------------------------------- completeness */}
          <section className="ph-card" data-testid="ph-completeness">
            <h2>Engineering completeness</h2>
            <button className="ph-jump" data-testid="ph-completeness-jump" onClick={go('data')}>
              <span className="ph-big" data-testid="ph-overall">{percentText(health.completeness.overall)}</span>
              {bar(health.completeness.overall)}
              {health.completeness.byKind.map((k) => (
                <span className="ph-row" key={k.kind}>
                  <b data-testid={`ph-complete-${k.kind}`}>{percentText(k.fraction)}</b> {KIND_LABEL[k.kind]}
                </span>
              ))}
            </button>
            <p className="prop-hint" data-testid="ph-completeness-note">
              {health.completeness.records === 0
                ? 'No engineering record has been started yet, so there is nothing to measure — which is not the same as 0%.'
                : `Required fields filled, across ${health.completeness.records} started record${health.completeness.records === 1 ? '' : 's'}. Which fields are required comes from the active standard.`}
            </p>
          </section>

          {/* ----------------------------------------------------------- QA */}
          <section className="ph-card" data-testid="ph-qa">
            <h2>Quality</h2>
            <button className="ph-jump" data-testid="ph-qa-jump" onClick={go('checks')}>
              <span className="ph-row"><b data-testid="ph-qa-critical">{health.qa.critical}</b> Critical</span>
              <span className="ph-row"><b data-testid="ph-qa-warning">{health.qa.warning}</b> Warning</span>
              <span className="ph-row"><b data-testid="ph-qa-info">{health.qa.info}</b> Information</span>
              <span className="ph-row ph-row-quiet"><b>{health.qa.accepted}</b> Accepted</span>
            </button>
            {/* "Nothing was found" and "nobody looked" are different answers, so
                the report says how many checks it actually ran. */}
            <p className="prop-hint" data-testid="ph-qa-note">
              {health.qa.rulesEvaluated} check{health.qa.rulesEvaluated === 1 ? '' : 's'} ran
              {health.qa.rulesDisabled > 0 ? `, ${health.qa.rulesDisabled} switched off by the standard` : ''}.
            </p>
          </section>

          {/* ------------------------------------------------------- budget */}
          <section className="ph-card" data-testid="ph-budget">
            <h2>Estimate</h2>
            <button className="ph-jump" data-testid="ph-budget-jump" onClick={go('draw')}>
              <span className="ph-big" data-testid="ph-budget-total">
                {money(health.budget.total)}
              </span>
              {health.budget.target !== undefined && (
                <>
                  {bar(Math.min(health.budget.fraction ?? 0, 1))}
                  <span className="ph-row">
                    <b data-testid="ph-budget-fraction">{percentText(health.budget.fraction)}</b>
                    {' of '}{money(health.budget.target)}
                  </span>
                </>
              )}
            </button>
            <p className="prop-hint" data-testid="ph-budget-note">
              {health.budget.target === undefined
                ? 'No budget target set — the estimate stands on its own. Set one from the budget chip on the drawing toolbar.'
                : `Installed estimate against the target. Hardware alone is ${money(health.budget.hardware)}.`}
              {health.budget.unpriced > 0 && ` ${health.budget.unpriced} symbol${health.budget.unpriced === 1 ? ' carries' : 's carry'} no price.`}
            </p>
          </section>

          {/* ---------------------------------------------------- revisions */}
          <section className="ph-card ph-card-wide" data-testid="ph-revisions">
            <h2>Revisions</h2>
            <button className="ph-jump" data-testid="ph-revisions-jump" onClick={go('draw')}>
              {latest.map((r) => (
                <span className="ph-row" key={r.sheetId}>
                  <b data-testid={`ph-rev-${r.sheetId}`}>{r.code || '—'}</b>
                  {' '}{r.drawingNumber || r.sheetName}
                  <span className="ph-row-quiet">
                    {r.issued ? ` · issued${r.issuedAt ? ` ${r.issuedAt.slice(0, 10)}` : ''}` : ' · not issued'}
                    {r.open > 0 ? ` · ${r.open} open` : ''}
                  </span>
                </span>
              ))}
            </button>
            <p className="prop-hint">
              The revision table lives in the sheet properties on the drawing.
            </p>
          </section>

          {/* ----------------------------------------- deliverable staleness */}
          <section className="ph-card ph-card-wide" data-testid="ph-deliverables">
            <h2>Deliverable staleness</h2>
            <p className="prop-hint" data-testid="ph-deliverables-basis">
              {issuedModel
                ? `Regenerates each report from the document as it stands and as it was at ${issuedModel.drawingNumber || issuedModel.sheetName} Rev ${issuedModel.code}, issued ${issuedModel.issuedAt.slice(0, 10)}, and says which files would come out different.`
                : 'Nothing has been issued yet, so there is no model to compare against.'}
            </p>

            {check.phase !== 'done' ? (
              <button
                className="ph-run"
                data-testid="ph-deliverables-run"
                disabled={check.phase === 'running'}
                onClick={() => void runCheck()}
              >
                {check.phase === 'running' ? 'Comparing…' : 'Compare with the last issue'}
              </button>
            ) : (
              <>
                <button className="ph-jump" data-testid="ph-deliverables-jump" onClick={go('data')}>
                  {check.rows.map((r) => (
                    <span className="ph-row" key={r.id}>
                      <b className={`ph-state ph-state-${r.state}`} data-testid={`ph-deliv-${r.id}`}>
                        {STATE_LABEL[r.state]}
                      </b>
                      {' '}{r.label}
                      {r.reason && <span className="ph-row-quiet"> · {r.reason}</span>}
                    </span>
                  ))}
                </button>
                <p className="prop-hint" data-testid="ph-deliverables-note">
                  {counts!.differs > 0
                    ? `${counts!.differs} report${counts!.differs === 1 ? '' : 's'} would come out different from the issued model.`
                    : counts!.unchanged > 0
                      ? 'Every comparable report still matches the issued model.'
                      : 'Nothing could be compared.'}
                  {' '}This says which files have moved, not whether anything is wrong — and it can
                  say nothing about which files were produced or approved, because it cannot see that.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
