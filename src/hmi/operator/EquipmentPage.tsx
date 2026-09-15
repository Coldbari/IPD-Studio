// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useSimStore } from '../simStore'
import { fmt } from '../widgets/shared'
import { EQUIP_LABEL } from '../sim/state'
import { equipmentCounts, equipmentRows } from './summary'
import type { EquipRow } from './summary'

type Filter = 'all' | 'running' | 'stopped' | 'faulted'

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All', running: 'Running', stopped: 'Stopped', faulted: 'Faulted / tripped',
}

const KIND_LABEL: Record<EquipRow['kind'], string> = {
  drive: 'Drives', valve: 'Valves', vessel: 'Vessels',
}

/** Filtering is a VIEW concern: it selects rows and touches no process state. */
function matches(r: EquipRow, f: Filter): boolean {
  if (f === 'all') return true
  // the state filters are about DRIVES: a valve is neither running nor stopped
  // in the sense this filter means, so it drops out rather than being miscounted
  if (r.kind !== 'drive') return false
  if (f === 'faulted') return r.state === 'tripped'
  if (f === 'running') return r.state === 'running' || r.state === 'starting' || r.state === 'stopping'
  return r.state === 'stopped' || r.state === 'disabled'
}

/**
 * Every physical object the running plant contains, with its live state.
 *
 * State comes from `equipmentState()` through `equipmentRows` — this page
 * derives nothing from raw RUN/FAULT booleans, which is the rule that keeps
 * it from ever disagreeing with the mimic or a faceplate about whether a pump
 * is running.
 */
export default function EquipmentPage({ onOpen }: { onOpen(tag: string): void }) {
  const tags = useSimStore((s) => s.tags)
  const defs = useSimStore((s) => s.defs)
  const alarms = useSimStore((s) => s.alarms)
  const oos = useSimStore((s) => s.oos)
  const equipFlows = useSimStore((s) => s.equipFlows)
  const [filter, setFilter] = useState<Filter>('all')

  const rows = equipmentRows(defs, tags, { oos, alarms, flows: equipFlows })
  const counts = equipmentCounts(rows)
  const shown = rows.filter((r) => matches(r, filter))
  const groups: EquipRow['kind'][] = ['drive', 'valve', 'vessel']

  return (
    <div className="op-page" data-testid="op-equipment">
      <div className="op-filters">
        <span className="lbl" style={{ marginLeft: 0 }}>Show</span>
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button key={f} data-testid={`equip-filter-${f}`} className={filter === f ? 'on' : ''}
            aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}
          </button>
        ))}
        <span className="op-spacer" style={{ flex: 1 }} />
        <span className="m" data-testid="equip-counts" style={{ color: 'var(--hmi-text-muted)' }}>
          {counts.running} running · {counts.stopped} stopped · {counts.faulted} faulted
        </span>
      </div>

      {rows.length === 0 && <p className="op-empty">This plant has no equipment.</p>}

      {groups.map((kind) => {
        const g = shown.filter((r) => r.kind === kind)
        if (g.length === 0) return null
        return (
          <section key={kind} data-testid={`equip-group-${kind}`}>
            <h3>{KIND_LABEL[kind]}</h3>
            <div className="op-wrap">
              <table className="op-table">
                <thead>
                  <tr>
                    <th>Tag</th><th>Description</th><th>State</th>
                    <th className="num">{kind === 'vessel' ? 'Level' : kind === 'valve' ? 'Position' : 'Flow'}</th>
                    <th>Alarm</th><th />
                  </tr>
                </thead>
                <tbody>
                  {g.map((r) => (
                    <tr key={r.tag} data-testid="equip-row" data-tag={r.tag} data-state={r.state ?? ''}>
                      <td>
                        <button className="op-link" data-testid="equip-open"
                          title={`Open ${r.tag}`} onClick={() => onOpen(r.tag)}>{r.tag}</button>
                      </td>
                      <td>{r.description}</td>
                      <td className="op-state">{r.state ? EQUIP_LABEL[r.state] : '—'}</td>
                      <td className="num">
                        {kind === 'drive'
                          ? (r.flow !== undefined ? `${fmt(r.flow)} m³/h` : '—')
                          : (r.value !== undefined ? `${fmt(r.value)} ${r.unit ?? ''}` : '—')}
                      </td>
                      <td>
                        {r.alarm
                          ? <span className={`al-prio al-prio-${r.alarm}`}>{r.alarm.toUpperCase()}</span>
                          : <span style={{ color: 'var(--hmi-text-muted)' }}>NONE</span>}
                      </td>
                      <td>
                        <button className="op-act" onClick={() => onOpen(r.tag)}>Detail</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {rows.length > 0 && shown.length === 0 && (
        <p className="op-empty" data-testid="equip-none">Nothing matches this filter.</p>
      )}
    </div>
  )
}
