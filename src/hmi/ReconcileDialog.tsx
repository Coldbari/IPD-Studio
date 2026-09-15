// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import Modal from '../panels/Modal'
import { useStore, activeHmiScreen } from '../store/store'
import type { ReconcileAction, ReconcileChoice, ReconcileItem, ReconcileStatus } from '../model/reconcile'
import { planFor, planIsEmpty, previewLines, reconcileScreen } from '../model/reconcile'

/**
 * THE RECONCILIATION VIEW.
 *
 * What this REPLACED is the point of it. The old Re-import button rebuilt the
 * screen from its sheet and threw away everything a person had done to it —
 * every widget moved, every display added, every group arranged. It was one
 * confirm dialog away at all times, and the confirm said "this replaces the
 * screen", which is true and is not the same as understanding what you are
 * about to lose.
 *
 * So: show the DIFFERENCE, let the engineer choose per item, preview exactly
 * what will happen, and apply it as one undoable step. Anything not chosen is
 * left alone on both sides. Nothing is ever applied by opening this dialog.
 *
 * REMAP is offered with a destination the ENGINEER picks, from the tags this
 * sheet gained while the one on the screen was lost — the renumbering case,
 * bounded to plausible answers. It is never offered with a destination the
 * software chose. A widget can of course be rebound to anything at all; that
 * is the property panel's tag picker, with the whole plant to choose from, and
 * this dialog does not try to replace it.
 */
export default function ReconcileDialog({ onClose }: { onClose(): void }) {
  const doc = useStore((s) => s.doc)
  const screen = useStore(activeHmiScreen)
  const applyReconciliation = useStore((s) => s.applyReconciliation)
  const [choices, setChoices] = useState<Record<string, ReconcileChoice>>({})
  const [showUnchanged, setShowUnchanged] = useState(false)

  const report = useMemo(
    () => (screen ? reconcileScreen(doc, screen.id) : null),
    [doc, screen],
  )
  const plan = useMemo(() => (report ? planFor(report, choices) : null), [report, choices])

  if (!screen) return null

  if (!report) {
    return (
      <Modal title="Reconcile with the P&ID" onClose={onClose} width={520}>
        <p data-testid="rc-no-source" style={{ maxWidth: '58ch', lineHeight: 1.5 }}>
          <strong>{screen.name}</strong> was not built from a P&amp;ID sheet, so there is no engineering
          source to compare it against. Screens built by <em>Build from P&amp;ID sheet…</em> can be
          reconciled; a hand-built screen or a generated overview is yours alone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </Modal>
    )
  }

  const set = (tag: string, action: ReconcileAction, target?: string) =>
    setChoices((c) => ({
      ...c,
      [tag]: c[tag]?.action === action && c[tag]?.target === target
        ? { action: 'ignore' }
        : { action, ...(target ? { target } : {}) },
    }))

  const visible = report.items.filter((i) => showUnchanged || i.status !== 'unchanged')
  const lines = plan ? previewLines(plan) : []

  const apply = () => {
    if (!plan || planIsEmpty(plan)) return
    applyReconciliation(plan)
    onClose()
  }

  return (
    <Modal title={`Reconcile ${screen.name} with ${report.sheetName}`} onClose={onClose} width={860}>
      <div>
        {/* THE SUMMARY, first. An engineer decides whether to read the list at
            all from these four numbers. */}
        <div className="op-kpis" data-testid="rc-summary" style={{ marginBottom: 12 }}>
          {(['added', 'removed', 'changed', 'unchanged'] as ReconcileStatus[]).map((s) => (
            <div key={s} className="op-kpi" data-testid={`rc-count-${s}`}>
              <div className="k">{s}</div>
              <div className="v">{report.counts[s]}</div>
            </div>
          ))}
        </div>

        {report.baselineMissing && (
          <p className="op-sub" data-testid="rc-no-baseline" style={{ marginBottom: 12 }}>
            This screen predates change tracking, so <strong>changed</strong> cannot be computed for it yet —
            that zero means “not measured”, not “nothing changed”. Additions and removals are exact.
            Applying anything here records a baseline, and changes are reported from then on.
          </p>
        )}

        <div style={{ maxHeight: 360, overflow: 'auto', border: 'var(--hmi-border-thin) solid var(--hmi-border)' }}
          data-testid="rc-items">
          {visible.length === 0 && (
            <p className="op-empty" data-testid="rc-none">
              {report.counts.unchanged > 0
                ? 'This screen matches the P&ID. Nothing to reconcile.'
                : 'Nothing on this screen and nothing on the sheet.'}
            </p>
          )}
          {visible.map((item) => (
            <Row key={item.tag} item={item} choice={choices[item.tag] ?? { action: 'ignore' }} onChoose={set} />
          ))}
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, cursor: 'pointer' }}>
          <input type="checkbox" data-testid="rc-show-unchanged" checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)} />
          <span className="op-sub" style={{ margin: 0 }}>
            Show the {report.counts.unchanged} objects that match
          </span>
        </label>

        {/* THE PREVIEW. Step I §20: nothing is applied until this has been
            shown, and what it lists is exactly what the apply performs — both
            are built from the same plan. */}
        <div className="rc-preview" data-testid="rc-preview">
          {lines.length === 0 ? (
            <span>Nothing selected. Closing this dialog changes nothing on either side.</span>
          ) : (
            <>
              <strong>Apply {lines.length} change{lines.length === 1 ? '' : 's'}</strong>
              <ul>{lines.map((l) => <li key={l} data-testid="rc-preview-line">{l}</li>)}</ul>
              <span className="op-sub" style={{ display: 'block', marginTop: 6 }}>
                One undo step. Nothing else on this screen moves, and the running simulation,
                its history and its alarms are untouched.
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}>Cancel</button>
          <button data-testid="rc-apply" disabled={lines.length === 0}
            style={{
              background: lines.length ? 'var(--hmi-accent)' : 'var(--hmi-surface-sunken)',
              color: lines.length ? 'var(--hmi-text-on-accent)' : 'var(--hmi-text-muted)',
              border: 'none', borderRadius: 'var(--hmi-radius-sm)', padding: '4px 14px',
            }}
            onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </Modal>
  )
}

const ACTION_LABEL: Record<ReconcileAction, string> = {
  ignore: 'Ignore', add: 'Add', remove: 'Remove', remap: 'Remap', update: 'Update',
}

/** What each action will do, said before it is chosen rather than after. */
const ACTION_HINT: Record<ReconcileAction, string> = {
  ignore: 'Leave both the drawing and the screen exactly as they are',
  add: 'Create an HMI object for this tag, below everything already on the screen',
  remove: 'Delete this widget from the screen. Nothing on any sheet changes',
  remap: 'Point this widget at a tag the sheet gained, keeping it where it is',
  update: 'Record the current engineering data as this screen’s baseline',
}

function Row({ item, choice, onChoose }: {
  item: ReconcileItem
  choice: ReconcileChoice
  onChoose(tag: string, action: ReconcileAction, target?: string): void
}) {
  return (
    <div className="rc-item" data-testid="rc-item" data-tag={item.tag} data-status={item.status}
      data-choice={choice.action}>
      <span className="rc-status">{item.status}</span>
      <div>
        <div className="rc-tag">{item.tag}</div>
        <div className="op-sub" style={{ marginTop: 2 }}>{item.message}</div>
        {item.changes?.map((c) => (
          <div key={c.field} className="rc-change" data-testid="rc-change">
            {c.label}: <b>{c.from || '—'}</b> → <b>{c.to || '—'}</b>
          </div>
        ))}
      </div>
      <div className="rc-actions">
        {item.actions.map((a) =>
          a === 'remap' ? (
            // A destination the ENGINEER picks, from the tags this sheet
            // actually gained. There is no default and no guess.
            <select key={a} data-testid="rc-action-remap"
              value={choice.action === 'remap' ? choice.target ?? '' : ''}
              title={ACTION_HINT.remap}
              onChange={(e) => onChoose(item.tag, e.target.value ? 'remap' : 'ignore', e.target.value || undefined)}>
              <option value="">Remap to…</option>
              {item.remapTo?.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <button key={a} data-testid={`rc-action-${a}`} data-action={a}
              className={choice.action === a ? 'on' : ''}
              aria-pressed={choice.action === a} title={ACTION_HINT[a]}
              onClick={() => onChoose(item.tag, a)}>
              {ACTION_LABEL[a]}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
