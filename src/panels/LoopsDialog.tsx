// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import Modal from './Modal'
import { useStore } from '../store/store'
import { qaFor } from '../validate/engine'
import { loopViews, loopPlaceLabel, type LoopView } from '../model/loopIndex'
import { LOOP_TYPES, LOOP_TYPE_LABELS, asLoopType, type LoopCompleteness } from '../model/loop'
import { planLoopAdoption, type AdoptionRow } from '../model/loopAdoption'
import { RECORD_STATUSES } from '../model/registry'
import { locateCell } from '../canvas/locate'
import { printPersistentLoopDiagram } from '../export/loopDiagram'

/**
 * THE LOOP MANAGER.
 *
 * Built in the shape of the Areas dialog — a list you type into, live and
 * undoable — because a loop register is the same kind of thing: a handful of
 * declared objects an engineer edits in place, not a workflow that needs a
 * wizard.
 *
 * PERSISTENT FIRST, DERIVED SECOND, AND NEVER MIXED. The top list is
 * `doc.loops`: real engineering entities with a type, a status and a diff
 * history. Beneath it is what `deriveLoops()` observes from tag numbers, which
 * is read-only and stays read-only until somebody presses Adopt. Opening this
 * dialog persists nothing.
 *
 * COMPLETENESS COMES FROM `loopViews(ix)` — the same memoised evaluation the
 * QA rules read. A second opinion computed in a component is how a panel and a
 * report start disagreeing about whether a loop is finished.
 */

const STATE_LABEL: Record<LoopCompleteness, string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  broken: 'Broken',
  'not-applicable': 'Not checked',
  unknown: 'Type unstated',
}

export default function LoopsDialog({ onClose }: { onClose(): void }) {
  const doc = useStore((s) => s.doc)
  const addLoop = useStore((s) => s.addLoop)
  const updateLoop = useStore((s) => s.updateLoop)
  const removeLoop = useStore((s) => s.removeLoop)
  const unassignLoop = useStore((s) => s.unassignLoop)
  const applyLoopAdoption = useStore((s) => s.applyLoopAdoption)
  const [error, setError] = useState<string | null>(null)
  const [adopted, setAdopted] = useState<{ loops: number; assigned: number } | null>(null)
  const [showAdopt, setShowAdopt] = useState(false)

  // The index the whole application already builds and caches per document —
  // never a second walk for one dialog.
  const ix = qaFor(doc).index
  const views = useMemo(() => loopViews(ix), [ix])
  const plan = useMemo(() => (showAdopt ? planLoopAdoption(ix) : null), [ix, showAdopt])

  /** Every store call goes through here so one refusal is reported one way.
   *  The components never decide anything — the store does. */
  const act = (r: { ok: boolean; reason?: string }) => {
    setError(r.ok ? null : (r.reason ?? 'That could not be done.'))
    return r.ok
  }

  const del = (view: LoopView) => {
    const n = view.members.length
    const detail = n ? ` This unassigns ${n} object${n === 1 ? '' : 's'}; their records are kept.` : ''
    if (!confirm(`Delete loop ${view.loop.number}?${detail}`)) return
    act(removeLoop(view.loop.id))
  }

  return (
    <Modal title="Loops" onClose={onClose} width={640}>
      <div className="loops" data-testid="loops-dialog">
        {error && <p className="loops-error" data-testid="loops-error">{error}</p>}

        {views.length === 0 && (
          <p className="loops-empty" data-testid="loops-empty">
            No loops declared yet. A loop is the control function a group of instruments performs
            together — it carries a type, it can span more than one measured variable, and a revision
            comparison tracks it. Create one below, or adopt what the tag numbers already imply.
          </p>
        )}

        {views.map((view) => {
          const loop = view.loop
          const state = view.evaluation.completeness
          return (
            <section key={loop.id} className="loops-row" data-testid={`loop-${loop.id}`}>
              <div className="loops-main">
                <input
                  className="loops-number"
                  data-testid={`loop-number-${loop.id}`}
                  aria-label="Loop number"
                  placeholder="Number"
                  value={loop.number}
                  onChange={(e) => act(updateLoop(loop.id, { number: e.target.value }))}
                />
                <input
                  className="loops-name"
                  data-testid={`loop-name-${loop.id}`}
                  aria-label="Loop name"
                  placeholder="Name (optional)"
                  value={loop.name ?? ''}
                  onChange={(e) => act(updateLoop(loop.id, { name: e.target.value }))}
                />
                <select
                  className="loops-type"
                  data-testid={`loop-type-${loop.id}`}
                  aria-label="Loop type"
                  value={loop.type ?? ''}
                  onChange={(e) => act(updateLoop(loop.id, { type: asLoopType(e.target.value) }))}
                >
                  <option value="">— type not stated —</option>
                  {LOOP_TYPES.map((t) => <option key={t} value={t}>{LOOP_TYPE_LABELS[t]}</option>)}
                </select>
                <select
                  className="loops-status"
                  data-testid={`loop-status-${loop.id}`}
                  aria-label="Loop status"
                  value={loop.status ?? ''}
                  onChange={(e) => act(updateLoop(loop.id, { status: e.target.value }))}
                >
                  <option value="">— no status —</option>
                  {RECORD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  data-testid={`loop-diagram-${loop.id}`}
                  title="Print an ISA-5.4-style loop sheet for this loop"
                  onClick={() => printPersistentLoopDiagram(doc, loop.id)}
                >
                  Diagram
                </button>
                <button data-testid={`loop-del-${loop.id}`} title="Delete this loop" onClick={() => del(view)}>✕</button>
              </div>

              <div className="loops-meta">
                <span className={`loops-state loops-state-${state}`} data-testid={`loop-state-${loop.id}`}>
                  {STATE_LABEL[state]}
                </span>
                <span data-testid={`loop-count-${loop.id}`}>
                  {view.members.length} member{view.members.length === 1 ? '' : 's'}
                </span>
                <span data-testid={`loop-place-${loop.id}`}>{loopPlaceLabel(ix, view)}</span>
                {/* The verdict's own words, so the panel cannot paraphrase the
                    rule into something stronger than it says. */}
                <span className="loops-basis">{view.evaluation.basis}</span>
              </div>

              {view.members.length > 0 && (
                <div className="loops-members" data-testid={`loop-members-${loop.id}`}>
                  {view.members.map((m) => (
                    <span key={m.key} className={m.drawn ? 'loops-member' : 'loops-member loops-member-gone'}>
                      <button
                        className="loops-member-go"
                        disabled={!m.drawn}
                        title={m.drawn ? 'Find on the drawing' : 'Not on any sheet'}
                        onClick={() => locateCell(ix.nodesByKey.get(m.key)?.[0]?.node.id ?? '')}
                      >
                        {m.key}{m.drawn ? '' : ' ⚠'}
                      </button>
                      <button
                        className="loops-member-x"
                        data-testid={`loop-unassign-${m.key}`}
                        title={`Remove ${m.key} from this loop`}
                        onClick={() => act(unassignLoop(m.key))}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </section>
          )
        })}

        <button className="loops-add" data-testid="loop-add" onClick={() => {
          // A number is required, so the new row is born with a free one
          // rather than an empty box the store would refuse.
          const used = new Set((doc.loops ?? []).map((l) => l.number))
          let n = 100
          while (used.has(String(n))) n += 1
          act(addLoop(String(n)))
        }}>
          ＋ Add loop
        </button>

        <AdoptionSection
          plan={plan}
          shown={showAdopt}
          onShow={() => setShowAdopt(true)}
          adopted={adopted}
          onApply={(rows) => setAdopted(applyLoopAdoption(rows))}
        />
      </div>
    </Modal>
  )
}

/**
 * Derived loops, and what adopting them would do.
 *
 * READ-ONLY until the user presses the button. The preview is computed by
 * `planLoopAdoption`, which is pure — opening this section writes nothing, and
 * there is no migration on project load anywhere in the product.
 */
function AdoptionSection({
  plan, shown, onShow, adopted, onApply,
}: {
  plan: ReturnType<typeof planLoopAdoption> | null
  shown: boolean
  onShow(): void
  adopted: { loops: number; assigned: number } | null
  onApply(rows: AdoptionRow[]): void
}) {
  if (!shown) {
    return (
      <section className="loops-derived">
        <button data-testid="loops-show-adopt" onClick={onShow}>
          Adopt loops from tag numbers…
        </button>
        <p className="prop-hint">
          Shows what the tag numbers already imply, and what declaring each one would do. Nothing is
          created until you say so.
        </p>
      </section>
    )
  }
  if (!plan) return null

  return (
    <section className="loops-derived" data-testid="loops-adopt">
      <div className="prop-title">Derived from tag numbers</div>
      {plan.rows.length === 0 && (
        <p className="prop-hint" data-testid="adopt-none">No tagged instruments share a loop number yet.</p>
      )}

      {plan.adopt.length > 0 && (
        <>
          <p className="prop-hint">
            {plan.adopt.length} can be declared exactly as they are drawn. The derived grouping stays
            where it is either way — nothing is renamed, moved or deleted.
          </p>
          <button data-testid="adopt-apply" onClick={() => onApply(plan.adopt)}>
            Adopt {plan.adopt.length} loop{plan.adopt.length === 1 ? '' : 's'}
          </button>
        </>
      )}
      {adopted && (
        <p className="prop-hint" data-testid="adopt-done">
          Declared {adopted.loops} loop{adopted.loops === 1 ? '' : 's'} and assigned {adopted.assigned} object
          {adopted.assigned === 1 ? '' : 's'}.
        </p>
      )}

      <ul className="loops-plan" data-testid="adopt-plan">
        {plan.rows.map((r) => (
          <li key={r.ref} className={`loops-plan-${r.verdict}`} data-testid={`adopt-row-${r.ref}`}>
            <b>{r.ref}</b>
            <span className="loops-plan-verdict">{r.verdict}</span>
            {r.suggestedType && <span className="loops-plan-type">{LOOP_TYPE_LABELS[r.suggestedType]}</span>}
            <span className="loops-plan-members">{r.members.join(', ') || '—'}</span>
            <span className="loops-plan-reason">{r.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
