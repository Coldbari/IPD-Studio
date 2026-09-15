// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useSimStore } from '../simStore'
import { useStore } from '../../store/store'
import { fmt } from '../widgets/shared'
import { alarmMessage } from '../sim/alarms'
import { EQUIP_LABEL } from '../sim/state'
import { QUALITY_GLYPH, QUALITY_LABEL } from '../sim/quality'
import type { OperatorPage } from './nav'
import {
  PROCESS_STATUS_WORD, alarmCounts, areaRows, equipmentCounts, equipmentRows,
  kpisByQuantity, measurementRows, processStatus, standingAlarms, worstByTag,
} from './summary'
import type { Measures } from '../sim/tags'
import type { FlowNode, FlowPath } from '../sim/topology'
import { equipmentState } from '../sim/state'
import type { Tags } from '../sim/engine'
import type { TagDef } from '../sim/tags'
import type { AlarmPriority } from '../sim/alarms'

const TERMINAL_WORD: Record<string, string> = { source: 'SUPPLY', sink: 'DESTINATION' }

/**
 * THE SIMPLIFIED PROCESS FLOW.
 *
 * Situational awareness, not a P&ID. It shows only what the fluid passes
 * through — supply, the drives and valves on the way, the vessel it lands in —
 * with each object's live state and its key value, and an arrow that is lit
 * only where something is actually flowing.
 *
 * The topology is the SAME one the solver uses, projected read-only in
 * `sim/topology.ts`. Nothing here re-derives process connectivity, and the
 * picture therefore cannot drift from the plant it describes: change the
 * drawing and this changes with it.
 */
function Flowsheet({ paths, defs, tags, flows, oos, worst, onJumpTag }: {
  paths: FlowPath[]
  defs: Record<string, TagDef>
  tags: Tags
  flows: Record<string, number>
  oos: Record<string, true>
  worst: Map<string, AlarmPriority>
  onJumpTag(tag: string): void
}) {
  const nodeOf = (n: FlowNode, key: string) => {
    if (n.tag === undefined) {
      return (
        <div key={key} className="op-node term" data-testid="flow-node" data-kind={n.kind}>
          <div className="nt">{TERMINAL_WORD[n.kind] ?? n.kind.toUpperCase()}</div>
        </div>
      )
    }
    const t = tags[n.tag]
    const def = defs[n.tag]
    const state = n.kind === 'pump' || n.kind === 'heater'
      ? equipmentState(t, { oos: oos[n.tag] === true })
      : undefined
    const value = n.kind === 'tank' ? t?.PV
      : n.kind === 'valve' ? (t?.POS ?? t?.OP ?? ((t?.OPEN ?? 0) >= 0.5 ? 100 : 0))
      : undefined
    const unit = n.kind === 'tank' ? (def?.unit ?? '%') : '%'
    return (
      <button key={key} className="op-node" data-testid="flow-node"
        data-tag={n.tag} data-kind={n.kind}
        {...(state ? { 'data-state': state } : {})}
        {...(worst.get(n.tag) ? { 'data-alarm': worst.get(n.tag) } : {})}
        title={`Show ${n.tag}`} onClick={() => onJumpTag(n.tag!)}>
        <div className="nt">{n.tag}</div>
        {value !== undefined && <div className="nv">{fmt(value, 0)} {unit}</div>}
        {state && <div className="ns">{EQUIP_LABEL[state]}</div>}
      </button>
    )
  }
  return (
    <div className="op-flow" data-testid="op-flowsheet">
      {paths.map((p) => {
        const q = flows[p.branchId] ?? 0
        return (
          <div key={p.branchId} className="op-flow-path" data-testid="flow-path" data-flow={q > 0 ? 1 : 0}>
            {p.nodes.map((n, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i > 0 && (
                  <span className="op-flow-arrow" data-flowing={q > 0 ? 1 : 0} aria-hidden
                    title={q > 0 ? `${q.toFixed(1)} m³/h` : 'no flow'}>
                    {q > 0 ? '\u2192' : '\u22ef'}
                  </span>
                )}
                {nodeOf(n, `${p.branchId}-${i}`)}
              </span>
            ))}
            <span className="op-flow-arrow" style={{ marginLeft: 'var(--hmi-space-md)' }}>
              <span className="nv" data-testid="flow-rate">{q > 0 ? `${fmt(q)} m\u00b3/h` : 'no flow'}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

const QUANTITY_LABEL: Record<Measures, string> = {
  level: 'Level', flow: 'Flow', pressure: 'Pressure', temperature: 'Temperature',
}

const PRIO_GLYPH = { high: '■', medium: '▲', low: '●' } as const

/**
 * THE DYNAMIC OVERVIEW.
 *
 * Derived from live runtime state on every render — not a screen of widgets
 * generated once at import, which is what `overview.ts` produces and which
 * goes stale the moment the project changes. Nothing here is configured,
 * nothing is hardcoded, and a quantity the plant does not measure is ABSENT
 * rather than shown as a dash: an overview that implies a pressure reading
 * exists when none does is worse than one that stays quiet.
 *
 * It answers, in order: is it running, is anything wrong, how much, where,
 * and what are the numbers.
 */
export default function Overview({ onPage, onGoToScreen, onJumpTag }: {
  onPage(p: OperatorPage): void
  onGoToScreen(screenId: string): void
  onJumpTag(tag: string): void
}) {
  const alarms = useSimStore((s) => s.alarms)
  const tags = useSimStore((s) => s.tags)
  const defs = useSimStore((s) => s.defs)
  const quality = useSimStore((s) => s.quality)
  const oos = useSimStore((s) => s.oos)
  const equipFlows = useSimStore((s) => s.equipFlows)
  const topology = useSimStore((s) => s.topology)
  const branchFlows = useSimStore((s) => s.branchFlows)
  const screens = useStore((s) => s.doc.hmiScreens)

  const counts = alarmCounts(alarms)
  const equip = equipmentRows(defs, tags, { oos, alarms, flows: equipFlows })
  const eq = equipmentCounts(equip)
  const status = processStatus(counts, eq)
  const measures = measurementRows(defs, tags, { quality, alarms })
  const kpis = kpisByQuantity(measures)
  const areas = areaRows(screens, defs, tags, alarms, oos)
  const worst = worstByTag(alarms)
  const standing = standingAlarms(alarms)
    .slice()
    .sort((a, b) => (a.phase === b.phase ? b.since - a.since : a.phase === 'active' ? -1 : 1))

  const kpi = (label: string, value: string | number, opts: { unit?: string; tone?: 'attn' | 'bad'; testId: string } = { testId: '' }) => (
    <div className={`op-kpi${opts.tone ? ` ${opts.tone}` : ''}`} data-testid={opts.testId}>
      <div className="k">{label}</div>
      <div className="v">{value}{opts.unit && <span className="u">{opts.unit}</span>}</div>
    </div>
  )

  return (
    <div className="op-page" data-testid="op-overview">
      <section>
        <h3>Plant status</h3>
        <div className="op-kpis">
          {kpi('Process status', PROCESS_STATUS_WORD[status], {
            testId: 'kpi-status',
            ...(status === 'alarm' ? { tone: 'bad' as const } : status === 'attention' ? { tone: 'attn' as const } : {}),
          })}
          {kpi('Active alarms', counts.active, {
            testId: 'kpi-alarms', ...(counts.active > 0 ? { tone: 'attn' as const } : {}),
          })}
          {kpi('Unacknowledged', counts.unacked, {
            testId: 'kpi-unacked', ...(counts.unacked > 0 ? { tone: 'attn' as const } : {}),
          })}
          {kpi('Critical (high)', counts.high, {
            testId: 'kpi-critical', ...(counts.high > 0 ? { tone: 'bad' as const } : {}),
          })}
          {kpi('Equipment running', `${eq.running} / ${eq.total}`, { testId: 'kpi-running' })}
          {kpi('Equipment faulted', eq.faulted, {
            testId: 'kpi-faulted', ...(eq.faulted > 0 ? { tone: 'bad' as const } : {}),
          })}
        </div>
      </section>

      {topology.length > 0 && (
        <section>
          <h3>Process flow</h3>
          <Flowsheet paths={topology} defs={defs} tags={tags} flows={branchFlows}
            oos={oos} worst={worst} onJumpTag={onJumpTag} />
        </section>
      )}

      <section>
        <h3>Process areas</h3>
        {areas.length === 0 ? (
          <p className="op-empty">No process screens in this project.</p>
        ) : (
          <div className="op-cards">
            {areas.map((a) => (
              <button key={a.screenId} className="op-card" data-testid="op-area"
                data-attention={a.worst ?? undefined}
                title={`Open ${a.name}`}
                onClick={() => onGoToScreen(a.screenId)}>
                <div className="t">
                  <span>{a.name}</span>
                  {a.worst && <span className={`al-prio al-prio-${a.worst}`}>{PRIO_GLYPH[a.worst]} {a.alarms}</span>}
                </div>
                <div className="m">
                  {a.running} running{a.faulted > 0 ? ` · ${a.faulted} faulted` : ''} · {a.tags.length} tags
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>Key process values</h3>
        {kpis.length === 0 ? (
          <p className="op-empty" data-testid="op-no-kpis">
            This plant produces no live measurements — nothing to summarise.
          </p>
        ) : (
          kpis.map((g) => (
            <div key={g.measures} style={{ marginBottom: 10 }} data-testid={`kpi-group-${g.measures}`}>
              <div className="k" style={{ marginBottom: 'var(--hmi-space-sm)' }}>
                {QUANTITY_LABEL[g.measures]}
              </div>
              <div className="op-kpis">
                {g.rows.slice(0, 6).map((r) => (
                  <div key={r.tag} className={`op-kpi${r.alarm === 'high' ? ' bad' : r.alarm ? ' attn' : ''}`}
                    data-testid={`kpi-tag-${r.tag}`}>
                    <div className="k" style={{ display: 'flex', gap: 'var(--hmi-space-sm)', alignItems: 'baseline' }}>
                      <span>{r.tag}</span>
                      {/* the badge is separated from the tag: run together it
                          read as part of the engineering identifier */}
                      {r.quality && r.quality.q !== 'good' && (
                        <span className="op-badge" data-testid={`kpi-quality-${r.tag}`}
                          title={`${QUALITY_LABEL[r.quality.q]} — ${r.quality.why}`}>
                          {QUALITY_GLYPH[r.quality.q]} {QUALITY_LABEL[r.quality.q]}
                        </span>
                      )}
                    </div>
                    <div className="v">
                      {fmt(r.pv)}{r.unit && <span className="u">{r.unit}</span>}
                    </div>
                  </div>
                ))}
                {g.rows.length > 6 && (
                  <div className="op-kpi"><div className="k">and</div><div className="v">+{g.rows.length - 6}</div></div>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <section>
        <h3>Standing alarms</h3>
        {standing.length === 0 ? (
          <p className="op-empty" data-testid="op-no-alarms">No standing alarms.</p>
        ) : (
          <>
            <div className="op-wrap">
              <table className="op-table">
                <thead>
                  <tr><th>Pri</th><th>Tag</th><th>Condition</th><th>State</th></tr>
                </thead>
                <tbody>
                  {standing.slice(0, 6).map((a) => (
                    <tr key={a.id} data-testid="op-overview-alarm">
                      <td><span className={`al-prio al-prio-${a.priority}`}>{PRIO_GLYPH[a.priority]}</span></td>
                      <td>
                        <button className="op-link" title={`Show ${a.tag} on its screen`}
                          onClick={() => onJumpTag(a.tag)}>{a.tag}</button>
                      </td>
                      <td>{a.level} — {alarmMessage(a)}</td>
                      <td>{a.phase.toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="op-act" style={{ marginTop: 8 }} data-testid="op-goto-alarms"
              onClick={() => onPage('alarms')}>
              All {standing.length} alarms →
            </button>
          </>
        )}
      </section>

      {eq.total > 0 && (
        <section>
          <h3>Equipment</h3>
          <div className="op-cards">
            {equip.filter((r) => r.kind === 'drive').slice(0, 8).map((r) => (
              <button key={r.tag} className="op-card" data-testid="op-overview-equip"
                title={`Show ${r.tag}`} onClick={() => onJumpTag(r.tag)}>
                <div className="t">
                  <span>{r.tag}</span>
                  <span className="op-state">{r.state ? EQUIP_LABEL[r.state] : ''}</span>
                </div>
                <div className="m">
                  {r.description}
                  {r.flow !== undefined && r.flow > 0 && ` · ${fmt(r.flow)} m³/h`}
                </div>
              </button>
            ))}
          </div>
          <button className="op-act" style={{ marginTop: 8 }} data-testid="op-goto-equipment"
            onClick={() => onPage('equipment')}>All equipment →</button>
        </section>
      )}
    </div>
  )
}
