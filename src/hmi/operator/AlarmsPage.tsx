// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useSimStore } from '../simStore'
import { alarmMessage } from '../sim/alarms'
import type { AlarmPriority, AlarmRecord } from '../sim/alarms'
import { clockText } from '../sim/units'
import { alarmCounts, alarmViewState } from './summary'
import type { AlarmViewState } from './summary'

type StateFilter = 'all' | 'active' | 'unacked' | 'acked' | 'cleared' | 'suppressed'
type PrioFilter = 'all' | AlarmPriority

const STATE_LABEL: Record<StateFilter, string> = {
  all: 'All', active: 'Active', unacked: 'Unacknowledged',
  acked: 'Acknowledged', cleared: 'Cleared', suppressed: 'Shelved / OOS',
}
/** `high` is the model's top priority; operators read it as critical. */
const PRIO_LABEL: Record<PrioFilter, string> = {
  all: 'All', high: 'Critical / high', medium: 'Medium', low: 'Low',
}
const PRIO_GLYPH: Record<AlarmPriority, string> = { high: '■', medium: '▲', low: '●' }

/** VIEW-ONLY. Selects which records are shown; the records themselves are
 *  untouched, and acknowledgement goes through the command path, not here. */
function matches(a: AlarmRecord, s: StateFilter, p: PrioFilter): boolean {
  if (p !== 'all' && a.priority !== p) return false
  const view = alarmViewState(a)
  switch (s) {
    case 'all': return true
    case 'active': return view === 'ACTIVE'
    case 'unacked': return view === 'ACTIVE' || view === 'CLEARED'
    case 'acked': return view === 'ACKNOWLEDGED'
    case 'cleared': return view === 'CLEARED'
    case 'suppressed': return view === 'SHELVED' || view === 'OUT OF SERVICE' || view === 'SUPPRESSED'
  }
}

/** The one meaning per state, from the design system. Resolved ones recede. */
const STATE_TONE: Partial<Record<AlarmViewState, string>> = {
  ACTIVE: 'var(--hmi-alarm-high)',
  CLEARED: 'var(--hmi-alarm-medium)',
  ACKNOWLEDGED: 'var(--hmi-text-muted)',
}

/**
 * The operator alarm list.
 *
 * Reads the canonical alarm state and NOTHING else — there is one alarm engine
 * (`sim/alarms.ts`), one lifecycle, one set of priorities, and this page is a
 * view of it. Acknowledgement calls the store's `ack`, which is the same path
 * the banner uses and the same one that writes the journal, so an ack from
 * here is indistinguishable from an ack anywhere else.
 *
 * The full ISA-18.2 lifecycle survives into the UI: ACTIVE, ACKNOWLEDGED and
 * CLEARED are distinct, and a suppressed alarm says WHICH kind of suppression
 * is hiding it rather than collapsing into a boolean.
 */
export default function AlarmsPage({ onJumpTag }: { onJumpTag(tag: string): void }) {
  const alarms = useSimStore((s) => s.alarms)
  const shelved = useSimStore((s) => s.shelved)
  const oos = useSimStore((s) => s.oos)
  const t = useSimStore((s) => s.t)
  const ack = useSimStore((s) => s.ack)
  const shelve = useSimStore((s) => s.shelve)
  const unshelve = useSimStore((s) => s.unshelve)
  const toggleOos = useSimStore((s) => s.toggleOos)
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [prio, setPrio] = useState<PrioFilter>('all')
  const [tagFilter, setTagFilter] = useState('')

  const counts = alarmCounts(alarms)
  const needle = tagFilter.trim().toLowerCase()
  const rows = alarms
    .filter((a) => matches(a, stateFilter, prio))
    .filter((a) => needle === '' || a.tag.toLowerCase().includes(needle))
    .sort((a, b) => b.since - a.since)

  return (
    <div className="op-page" data-testid="op-alarms">
      <div className="op-kpis" style={{ marginBottom: 10 }}>
        <div className="op-kpi" data-testid="alarms-kpi-active"><div className="k">Active</div><div className="v">{counts.active}</div></div>
        <div className="op-kpi" data-testid="alarms-kpi-unacked"><div className="k">Unacknowledged</div><div className="v">{counts.unacked}</div></div>
        <div className="op-kpi" data-testid="alarms-kpi-high"><div className="k">Critical / high</div><div className="v">{counts.high}</div></div>
        <div className="op-kpi"><div className="k">Medium</div><div className="v">{counts.medium}</div></div>
        <div className="op-kpi"><div className="k">Low</div><div className="v">{counts.low}</div></div>
        <div className="op-kpi" data-testid="alarms-kpi-suppressed"><div className="k">Suppressed</div><div className="v">{counts.suppressed}</div></div>
      </div>

      <div className="op-filters">
        <span className="lbl" style={{ marginLeft: 0 }}>State</span>
        {(Object.keys(STATE_LABEL) as StateFilter[]).map((f) => (
          <button key={f} data-testid={`alarm-filter-${f}`} className={stateFilter === f ? 'on' : ''}
            aria-pressed={stateFilter === f} onClick={() => setStateFilter(f)}>{STATE_LABEL[f]}</button>
        ))}
        <span className="lbl">Priority</span>
        {(Object.keys(PRIO_LABEL) as PrioFilter[]).map((f) => (
          <button key={f} data-testid={`alarm-prio-${f}`} className={prio === f ? 'on' : ''}
            aria-pressed={prio === f} onClick={() => setPrio(f)}>{PRIO_LABEL[f]}</button>
        ))}
        <span className="lbl">Tag</span>
        <input data-testid="alarm-tag-filter" aria-label="Filter by tag" placeholder="any"
          value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={{ width: 90 }} />
        <span style={{ flex: 1 }} />
        <button className="op-act" data-testid="alarm-ack-all" onClick={() => ack()}>Acknowledge all</button>
      </div>

      <div className="op-wrap">
        <table className="op-table">
          <thead>
            <tr>
              <th>Time</th><th>Pri</th><th>Tag</th><th>Type</th><th>Message</th>
              <th className="num">Value</th><th className="num">Limit</th><th>Unit</th>
              <th>State</th><th>Ack</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const view = alarmViewState(a)
              return (
                <tr key={a.id} data-testid="alarm-row" data-tag={a.tag} data-state={view} data-prio={a.priority}>
                  <td className="num">{clockText(a.since)}</td>
                  <td><span className={`al-prio al-prio-${a.priority}`} title={a.priority}>{PRIO_GLYPH[a.priority]}</span></td>
                  <td>
                    <button className="op-link" data-testid="alarm-jump"
                      title={`Show ${a.tag} on its process screen`}
                      onClick={() => onJumpTag(a.tag)}>{a.tag}</button>
                  </td>
                  <td>{a.level}</td>
                  <td>{alarmMessage(a)}</td>
                  <td className="num">{a.value !== undefined ? a.value.toFixed(1) : '—'}</td>
                  <td className="num">{a.limit !== undefined ? a.limit.toFixed(1) : '—'}</td>
                  <td>{a.unit ?? '—'}</td>
                  <td style={STATE_TONE[view] ? { color: STATE_TONE[view] } : undefined}>{view}</td>
                  <td>{view === 'ACKNOWLEDGED' ? 'YES' : 'NO'}</td>
                  <td>
                    {a.sup === undefined && a.phase !== 'acked' && (
                      <button className="op-act" data-testid="alarm-ack" onClick={() => ack(a.id)}>Ack</button>
                    )}
                    {a.sup === 'shelved' && (
                      <button className="op-act" onClick={() => unshelve(a.id)}>Unshelve</button>
                    )}
                    {a.sup === undefined && (
                      <button className="op-act" style={{ marginLeft: 4 }}
                        title="Shelve for 15 minutes — it returns by itself"
                        onClick={() => shelve(a.id, 15)}>Shelve</button>
                    )}
                    <button className="op-act" style={{ marginLeft: 4 }}
                      title={`${oos[a.tag] ? 'Return' : 'Take'} ${a.tag} ${oos[a.tag] ? 'to' : 'out of'} service`}
                      onClick={() => toggleOos(a.tag)}>{oos[a.tag] ? 'In svc' : 'OOS'}</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="op-empty" data-testid="alarms-none">
          {alarms.length === 0 ? 'No alarms — the plant is quiet.' : 'No alarms match this filter.'}
        </p>
      )}

      {Object.keys(shelved).length > 0 && (
        <p className="op-empty" data-testid="alarms-shelved-note">
          {Object.keys(shelved).length} shelved; the soonest returns in{' '}
          {clockText(Math.max(0, Math.min(...Object.values(shelved)) - t))}.
        </p>
      )}
    </div>
  )
}
