// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useSimStore } from './simStore'
import type { AlarmPriority, AlarmRecord, JournalEntry } from './sim/alarms'
import { commandText } from './sim/commands'
import { useStore } from '../store/store'
import { useT } from '../i18n'

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`

const phaseRank = (p: AlarmRecord['phase']) => (p === 'active' ? 0 : p === 'cleared' ? 1 : 2)
const prioRank = (p: AlarmPriority) => (p === 'high' ? 0 : p === 'medium' ? 1 : 2)

/** ISA-18.2 style: three priorities as shape + color so they survive
 *  color-blindness — high ■ red, medium ▲ orange, low ● yellow. */
function PrioIcon({ priority }: { priority: AlarmPriority }) {
  return priority === 'high' ? <span className="al-prio al-prio-high" aria-label="high">■</span>
    : priority === 'medium' ? <span className="al-prio al-prio-medium" aria-label="medium">▲</span>
    : <span className="al-prio al-prio-low" aria-label="low">●</span>
}

type SortKey = 'time' | 'pri' | 'tag' | 'level' | 'value' | 'state'

/** Docked alarm strip above the mimic + expandable summary/journal.
 *  Clicking a tag navigates to the screen that shows it (and pulses it). */
export default function AlarmBanner({ onJump }: { onJump?(tag: string): void }) {
  const tr = useT()
  const alarms = useSimStore((s) => s.alarms)
  const journal = useSimStore((s) => s.journal)
  const shelvedMap = useSimStore((s) => s.shelved)
  const oosMap = useSimStore((s) => s.oos)
  const t = useSimStore((s) => s.t)
  const ack = useSimStore((s) => s.ack)
  const shelve = useSimStore((s) => s.shelve)
  const unshelve = useSimStore((s) => s.unshelve)
  const toggleOos = useSimStore((s) => s.toggleOos)
  const screens = useStore((s) => s.doc.hmiScreens)
  const setActiveScreen = useStore((s) => s.setActiveScreen)
  const [open, setOpen] = useState<'none' | 'summary' | 'journal'>('none')
  const [jFilter, setJFilter] = useState<'all' | 'alarms' | 'commands'>('all')
  const [pFilter, setPFilter] = useState<'all' | AlarmPriority>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'state', dir: 1 })
  const oosTags = Object.keys(oosMap)
  if (alarms.length === 0 && journal.length === 0 && oosTags.length === 0) return null

  // standing = what actually annunciates; suppressed/pending live in sections
  const standing = alarms.filter((a) => !a.sup && a.phase !== 'pending')
  const shelvedRows = Object.entries(shelvedMap)
  const sbdRecs = alarms.filter((a) => a.sup === 'design')

  const cmp = (a: AlarmRecord, b: AlarmRecord): number => {
    const d =
      sort.key === 'time' ? a.since - b.since
      : sort.key === 'pri' ? prioRank(a.priority) - prioRank(b.priority)
      : sort.key === 'tag' ? a.tag.localeCompare(b.tag, undefined, { numeric: true })
      : sort.key === 'level' ? a.level.localeCompare(b.level)
      : sort.key === 'value' ? (a.value ?? 0) - (b.value ?? 0)
      : phaseRank(a.phase) - phaseRank(b.phase)
    // stable, meaningful tiebreak: priority then recency
    return d * sort.dir || prioRank(a.priority) - prioRank(b.priority) || b.since - a.since
  }
  const rows = [...standing].sort(cmp)
  const summaryRows = pFilter === 'all' ? rows : rows.filter((a) => a.priority === pFilter)
  const shown = rows.slice(0, 3)
  const unacked = standing.filter((a) => a.phase !== 'acked')
  const nBy = (p: AlarmPriority) => unacked.filter((a) => a.priority === p).length

  const jumpTo = (tag: string) => {
    if (onJump) return onJump(tag)
    const sc = screens.find((s) => s.widgets.some((w) => w.tag === tag))
    if (sc) setActiveScreen(sc.id)
  }

  const header = (key: SortKey, label: string) => (
    <button className={`al-all al-th${sort.key === key ? ' al-on' : ''}`}
      onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▴' : ' ▾') : ''}
    </button>
  )

  const ShelveSelect = ({ id }: { id: string }) => (
    <select className="al-shelve" value="" title={tr('Shelve: hide temporarily, auto-returns')}
      onChange={(e) => { if (e.target.value) shelve(id, Number(e.target.value)) }}>
      <option value="">{tr('Shelve…')}</option>
      <option value="5">{tr('5 min')}</option>
      <option value="15">{tr('15 min')}</option>
      <option value="30">{tr('30 min')}</option>
    </select>
  )

  const journalShown = journal.filter((ev) =>
    jFilter === 'all' ? true : jFilter === 'commands' ? ev.what === 'CMD' : ev.what !== 'CMD')
  const journalLine = (ev: JournalEntry) =>
    `[${mmss(ev.t)}] ${ev.tag} ${ev.what === 'CMD' ? commandText(ev) : `${ev.what} ${ev.level}`}`
  const copyJournal = () => {
    void navigator.clipboard?.writeText(journalShown.map(journalLine).join('\n')).catch(() => {})
  }

  return (
    <div className="hmi-alarmwrap">
      <div className="hmi-alarmbar" data-testid="alarm-bar">
        <span className={`al-count${unacked.length > 0 ? ' hmi-blink' : ''}`}>⚠ {standing.length}</span>
        {nBy('high') > 0 && <span className="al-prio al-prio-high">■ {nBy('high')}</span>}
        {nBy('medium') > 0 && <span className="al-prio al-prio-medium">▲ {nBy('medium')}</span>}
        {nBy('low') > 0 && <span className="al-prio al-prio-low">● {nBy('low')}</span>}
        {shown.map((a, i) => (
          <span key={a.id} className={`al-chip ${a.phase}${a.phase !== 'acked' ? ' hmi-blink' : ''}`}>
            <PrioIcon priority={a.priority} />
            <span className="al-time">{mmss(a.since)}</span>
            <button className="al-tag" title={tr("Show this tag's screen")} onClick={() => jumpTo(a.tag)}><strong>{a.tag}</strong></button>
            <span>{a.level}</span>
            <span className="al-phase">{a.phase.toUpperCase()}</span>
            <button data-testid={i === 0 ? 'alarm-ack' : undefined} onClick={() => ack(a.id)}>{tr('Ack')}</button>
          </span>
        ))}
        {rows.length > 3 && <span className="al-more">+{rows.length - 3} {tr('more')}</span>}
        <span style={{ flex: 1 }} />
        <button className="al-all" data-testid="alarm-summary-toggle"
          onClick={() => setOpen(open === 'summary' ? 'none' : 'summary')}>
          {open === 'summary' ? `▴ ${tr('Summary')}` : `▾ ${tr('Summary')}`}
        </button>
        <button className="al-all" onClick={() => setOpen(open === 'journal' ? 'none' : 'journal')}>
          {open === 'journal' ? `▴ ${tr('Journal')}` : `▾ ${tr('Journal')}`}
        </button>
        <button data-testid="alarm-ack-all" className="al-all" onClick={() => ack()}>{tr('Ack all')}</button>
      </div>
      {open === 'summary' && (
        <div className="hmi-alarmpanel" data-testid="alarm-summary">
          <div className="al-row" style={{ borderBottom: '1px solid #ffffff2a' }}>
            {(['all', 'high', 'medium', 'low'] as const).map((f) => (
              <button key={f} className={`al-all${pFilter === f ? ' al-on' : ''}`}
                data-testid={`sum-${f}`} onClick={() => setPFilter(f)}>
                {f === 'all' ? tr('All') : tr(f)}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            {header('time', tr('Time'))}{header('pri', tr('Pri'))}{header('tag', tr('Tag'))}
            {header('level', tr('Lvl'))}{header('value', tr('Value'))}{header('state', tr('State'))}
          </div>
          {summaryRows.length === 0 && <p className="al-empty">{tr('No standing alarms.')}</p>}
          {summaryRows.map((a) => (
            <div key={a.id} className={`al-row ${a.phase}`}>
              <PrioIcon priority={a.priority} />
              <span className="al-time">{mmss(a.since)}</span>
              <button className="al-tag" onClick={() => jumpTo(a.tag)}><strong>{a.tag}</strong></button>
              <span style={{ width: 24 }}>{a.level}</span>
              <span className="al-time" style={{ width: 44 }}>{a.value !== undefined ? a.value.toFixed(1) : '—'}</span>
              <span className="al-phase">{a.phase.toUpperCase()}</span>
              <span style={{ flex: 1 }} />
              <ShelveSelect id={a.id} />
              <button title={tr('Take out of service') + ' ' + a.tag}
                onClick={() => toggleOos(a.tag)}>{tr('OOS')}</button>
              {a.phase !== 'acked' && <button onClick={() => ack(a.id)}>{tr('Ack')}</button>}
            </div>
          ))}
          {shelvedRows.length > 0 && (
            <>
              <p className="al-section">{tr('Shelved')} ({shelvedRows.length})</p>
              {shelvedRows.map(([id, until]) => (
                <div key={id} className="al-row acked" data-testid="shelved-row">
                  <span>⏸</span>
                  <span><strong>{id.replace(':', ' ')}</strong></span>
                  <span className="al-time">{tr('back in')} {mmss(Math.max(0, until - t))}</span>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => unshelve(id)}>{tr('Unshelve')}</button>
                </div>
              ))}
            </>
          )}
          {oosTags.length > 0 && (
            <>
              <p className="al-section">{tr('Out of service')} ({oosTags.length})</p>
              {oosTags.map((tag) => (
                <div key={tag} className="al-row acked" data-testid="oos-row">
                  <span>⊘</span>
                  <button className="al-tag" onClick={() => jumpTo(tag)}><strong>{tag}</strong></button>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => toggleOos(tag)}>{tr('Back in service')}</button>
                </div>
              ))}
            </>
          )}
          {sbdRecs.length > 0 && (
            <>
              <p className="al-section">{tr('Suppressed by design')} ({sbdRecs.length}){tr(' — no running pump on their line')}</p>
              {sbdRecs.map((a) => (
                <div key={a.id} className="al-row acked" data-testid="sbd-row">
                  <span>⊘</span>
                  <span><strong>{a.tag}</strong> {a.level}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {open === 'journal' && (
        <div className="hmi-alarmpanel" data-testid="alarm-journal">
          <div className="al-row" style={{ borderBottom: '1px solid #ffffff2a' }}>
            {(['all', 'alarms', 'commands'] as const).map((f) => (
              <button key={f} className={`al-all${jFilter === f ? ' al-on' : ''}`}
                data-testid={`journal-${f}`} onClick={() => setJFilter(f)}>
                {tr(f)}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button className="al-all" data-testid="journal-copy" title={tr('Copy the visible journal lines')}
              onClick={copyJournal}>{tr('⧉ Copy')}</button>
          </div>
          {journalShown.length === 0 && <p className="al-empty">{tr('No events yet.')}</p>}
          {journalShown.map((ev, i) => (
            <div key={i} className="al-row">
              <span className="al-time">{mmss(ev.t)}</span>
              <span className={`al-what al-what-${ev.what.toLowerCase()}`}>{tr(ev.what)}</span>
              <button className="al-tag" onClick={() => jumpTo(ev.tag)}><strong>{ev.tag}</strong></button>
              <span>{ev.what === 'CMD' ? tr(commandText(ev)) : ev.level}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
