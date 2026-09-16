// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useSimStore } from '../simStore'
import { fmt } from '../widgets/shared'
import { QUALITY_GLYPH, QUALITY_LABEL } from '../sim/quality'
import type { Quality } from '../sim/quality'
import { clockText } from '../sim/units'
import { measurementRows, worstByTag } from './summary'
import { useQa } from '../../validate/live'
import { diagnosticsFor, CATEGORY_LABEL, DIAGNOSTIC_CATEGORIES, SEVERITY_LABEL } from '../../model/diagnostics'
import { scenarioFindings } from '../sim/scenario'
import type { DiagnosticCategory, DiagnosticFinding, DiagnosticReport, DiagnosticSeverity } from '../../model/diagnostics'
import { locateHmi } from '../locate'

type Filter = 'all' | 'degraded' | 'unbound'

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All', degraded: 'Not good', unbound: 'No process model',
}

/**
 * The page has TWO subjects and they are never mixed into one table.
 *
 * LIVE is what each instrument is doing right now — its reading, whether it
 * can be trusted, what is producing it. ENGINEERING is what the project SAYS
 * about the plant, and whether the P&ID, the registry, the simulation and
 * these screens agree. A transmitter can be reading perfectly and still have a
 * unit that names the wrong quantity; a table that averaged those two ideas
 * into one status column would hide both.
 */
type Section = 'live' | 'scenario' | 'engineering'

const SEVERITY_TONE: Record<DiagnosticSeverity, string> = {
  error: 'var(--hmi-alarm-high)',
  warning: 'var(--hmi-alarm-medium)',
  info: 'var(--hmi-text-muted)',
}

/** Quality tones, from the design system. `uncertain` is deliberately the
 *  MUTED tone rather than a warning colour: a measurement with no model behind
 *  it is not an alarm, it is something nobody has bound yet. */
const QUALITY_TONE: Partial<Record<Quality, string>> = {
  bad: 'var(--hmi-bad)',
  forced: 'var(--hmi-forced)',
  stale: 'var(--hmi-stale)',
  uncertain: 'var(--hmi-text-muted)',
}

/**
 * LIVE instrumentation diagnostics.
 *
 * Not the engineering I/O list — that lives in the Data workspace and states
 * what an instrument IS. This states what each one is DOING right now: its
 * reading, the range that reading sits in, whether it can be trusted, what is
 * producing it and when it last updated.
 *
 * Every column is read from the canonical runtime: the compiled `TagDef` for
 * range and unit, `sim/quality.ts` for quality, the alarm list for alarm state,
 * and the Step F history for when a signal was last sampled. Nothing is
 * recomputed here.
 *
 * BESIDE IT, AND NEVER MIXED WITH IT, is the ENGINEERING section: the seven
 * diagnostic categories from `model/diagnostics.ts`, which compare the P&ID,
 * the engineering registry, the simulation and these screens against each
 * other. Those are computed when the DOCUMENT changes, not on the simulation
 * tick — an engineering finding does not need re-evaluating five times a
 * second, and one that blinked as the plant ran would be unreadable.
 */
export default function DiagnosticsPage({ onJumpTag }: { onJumpTag(tag: string): void }) {
  const [section, setSection] = useState<Section>('live')
  // the runtime half of the diagnostics story: overrides that are not in effect
  const scenario = scenarioFindings(useSimStore((st) => st.scenarioProblems))
  const tags = useSimStore((s) => s.tags)
  const defs = useSimStore((s) => s.defs)
  const quality = useSimStore((s) => s.quality)
  const alarms = useSimStore((s) => s.alarms)
  const history = useSimStore((s) => s.history)
  useSimStore((s) => s.historyVersion) // history mutates in place; this re-renders us
  const t = useSimStore((s) => s.t)
  const [filter, setFilter] = useState<Filter>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | DiagnosticSeverity>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | DiagnosticCategory>('all')

  /**
   * The engineering diagnostics, off the simulation's back.
   *
   * `useQa` already watches the document and recomputes when the browser is
   * idle after an edit — never during one. Reading its index means the
   * diagnostics ride that same schedule and that same cache: one compile per
   * document, shared with the Checks report, and nothing on the 5 Hz path.
   */
  const qa = useQa()
  const diag = diagnosticsFor(qa.index)
  const byTag = new Map<string, DiagnosticFinding[]>()
  for (const f of diag.findings) {
    if (!f.tag) continue
    byTag.set(f.tag, [...(byTag.get(f.tag) ?? []), f])
  }

  const rows = measurementRows(defs, tags, { quality, alarms })
  const worst = worstByTag(alarms)
  const shown = rows.filter((r) =>
    filter === 'all' ? true
    : filter === 'degraded' ? (r.quality?.q ?? 'good') !== 'good'
    : r.source === 'NO MODEL' || r.source === 'NO PRODUCER')
  const degraded = rows.filter((r) => (r.quality?.q ?? 'good') !== 'good').length
  const unbound = rows.filter((r) => r.source === 'NO MODEL' || r.source === 'NO PRODUCER').length

  /** How long since this signal was last sampled, in process time. */
  const lastUpdate = (ref: string): string => {
    const w = history.getSeries(ref, 0, 1e12, 2)
    if (w.t.length === 0) return 'never'
    const age = t - w.t[w.t.length - 1]!
    return age <= 2 ? 'LIVE' : `${clockText(age)} ago`
  }

  const shownFindings = diag.findings.filter(
    (f) =>
      (severityFilter === 'all' || f.severity === severityFilter) &&
      (categoryFilter === 'all' || f.category === categoryFilter),
  )

  return (
    <div className="op-page" data-testid="op-diagnostics">
      {/* The two subjects, named. A tab rather than a merged table because a
          GOOD live reading and a wrong engineering unit are both true at once
          and neither cancels the other. */}
      <div className="op-filters" data-testid="diag-sections">
        <span className="lbl" style={{ marginLeft: 0 }}>Diagnostics</span>
        <button data-testid="diag-section-live" className={section === 'live' ? 'on' : ''}
          aria-pressed={section === 'live'} onClick={() => setSection('live')}
          title="What each instrument is reading right now">Live runtime</button>
        <button data-testid="diag-section-scenario" className={section === 'scenario' ? 'on' : ''}
          aria-pressed={section === 'scenario'} onClick={() => setSection('scenario')}
          title="Runtime overrides the operator asked for that are not in effect">
          Scenario
          {scenario.length > 0 && (
            <span className="op-count" data-testid="diag-scn-count">{scenario.length}</span>
          )}
        </button>
        <button data-testid="diag-section-engineering" className={section === 'engineering' ? 'on' : ''}
          aria-pressed={section === 'engineering'} onClick={() => setSection('engineering')}
          title="Where the P&ID, the engineering records, the simulation and these screens disagree">
          Engineering
          {diag.total > 0 && (
            <span className="op-count" data-testid="diag-eng-count"
              title={`${diag.counts.error} error, ${diag.counts.warning} warning, ${diag.counts.info} info`}>
              {diag.total}
            </span>
          )}
        </button>
      </div>

      {section === 'scenario' ? (
        /**
         * SCENARIO PROBLEMS, through the diagnostics architecture rather than
         * beside it. They carry the existing `DiagnosticSeverity` and are
         * rendered with the same conventions as the other two sections — a
         * third subject on one page, not a third engine.
         *
         * Every one of them means the same thing: an override the operator
         * asked for is NOT in effect, so the plant is not in the state they
         * believe it is in. That is what `error` already means here.
         */
        <section className="op-section" data-testid="diag-scenario">
          {scenario.length === 0 ? (
            <p className="op-empty" data-testid="diag-scn-none">
              No scenario problems. Runtime overrides, if any, are all in effect.
            </p>
          ) : (
            <ul className="scn-problems">
              {scenario.map((f) => (
                <li key={f.id} data-testid="diag-scn-row" data-tag={f.tag} data-severity={f.severity}>
                  <span className="scn-sev">{SEVERITY_LABEL[f.severity]}</span>
                  <strong>{f.tag}</strong> {f.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : section === 'engineering' ? (
        <EngineeringSection
          diag={diag}
          shown={shownFindings}
          severityFilter={severityFilter}
          categoryFilter={categoryFilter}
          onSeverity={setSeverityFilter}
          onCategory={setCategoryFilter}
          onJumpTag={onJumpTag}
        />
      ) : (
      <>
      <div className="op-filters">
        <span className="lbl" style={{ marginLeft: 0 }}>Show</span>
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button key={f} data-testid={`diag-filter-${f}`} className={filter === f ? 'on' : ''}
            aria-pressed={filter === f} onClick={() => setFilter(f)}>{FILTER_LABEL[f]}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span data-testid="diag-counts" style={{ color: 'var(--hmi-text-muted)' }}>
          {rows.length} instruments · {degraded} not good · {unbound} without a process model
        </span>
      </div>

      <div className="op-wrap">
        <table className="op-table">
          <thead>
            <tr>
              <th>Tag</th><th>Description</th><th>Type</th>
              <th className="num">PV</th><th>Unit</th><th className="num">Range</th>
              <th>Quality</th><th>Source</th><th>Last update</th><th>Alarm</th>
              <th title="Engineering findings about this tag — configuration, not live data">Engineering</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const q = r.quality?.q ?? 'good'
              const alarm = worst.get(r.tag)
              return (
                <tr key={r.tag} data-testid="diag-row" data-tag={r.tag}
                  data-quality={q} data-source={r.source}>
                  <td>
                    <button className="op-link" data-testid="diag-jump"
                      title={`Show ${r.tag} on its process screen`}
                      onClick={() => onJumpTag(r.tag)}>{r.tag}</button>
                  </td>
                  <td>{r.description}</td>
                  <td>{r.measures ? r.measures.toUpperCase() : '—'}</td>
                  <td className="num" data-testid="diag-pv">{q === 'bad' ? '- - -' : fmt(r.pv, 2)}</td>
                  <td>{r.unit ?? '—'}</td>
                  <td className="num">{r.min}–{r.max}</td>
                  <td style={QUALITY_TONE[q] ? { color: QUALITY_TONE[q] } : undefined}
                    title={r.quality?.why}>
                    {QUALITY_GLYPH[q] && <span style={{ marginRight: 4 }}>{QUALITY_GLYPH[q]}</span>}
                    {QUALITY_LABEL[q]}
                  </td>
                  <td>{r.source}</td>
                  <td>{lastUpdate(`${r.tag}.PV`)}</td>
                  <td>
                    {alarm
                      ? <span className={`al-prio al-prio-${alarm}`}>{alarm.toUpperCase()}</span>
                      : <span style={{ color: 'var(--hmi-text-muted)' }}>NONE</span>}
                  </td>
                  {/* Step I §15: the engineering verdict sits BESIDE the live
                      one, never folded into it. GOOD quality and a wrong unit
                      are independent facts and both have to be visible. */}
                  <td data-testid="diag-eng-cell">
                    {(() => {
                      const mine = byTag.get(r.tag) ?? []
                      if (mine.length === 0) return <span style={{ color: 'var(--hmi-text-muted)' }}>VALID</span>
                      const worstSev = mine.some((f) => f.severity === 'error') ? 'error'
                        : mine.some((f) => f.severity === 'warning') ? 'warning' : 'info'
                      return (
                        <button className="op-link" data-testid="diag-eng-jump"
                          style={{ color: SEVERITY_TONE[worstSev] }}
                          title={mine.map((f) => `${SEVERITY_LABEL[f.severity]}: ${f.message}`).join('\n')}
                          onClick={() => { setSection('engineering'); setCategoryFilter('all'); setSeverityFilter('all') }}>
                          {mine.length} finding{mine.length === 1 ? '' : 's'}
                        </button>
                      )
                    })()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && (
        <p className="op-empty" data-testid="diag-none">
          {rows.length === 0 ? 'This plant has no instruments.' : 'Nothing matches this filter.'}
        </p>
      )}

      {unbound > 0 && (
        <p className="op-empty" data-testid="diag-unbound-note">
          A measurement with <strong>no process model</strong> has nothing behind it — its value drifts near
          an idle figure and is reported UNCERTAIN rather than presented as a reading. Bind it to a vessel or
          a line in the editor, or open <strong>Engineering</strong> above to see every object this applies to.
        </p>
      )}
      </>
      )}
    </div>
  )
}

/**
 * ENGINEERING VALIDATION — the seven categories, as an operator can read them.
 *
 * A summary first (how many errors, warnings, observations), then filters, then
 * the findings themselves: what is wrong, what it means, and what to do. Every
 * row states its CATEGORY and its SEVERITY, because "17 findings" is not
 * actionable and "3 broken bindings and 14 objects the simulation has no model
 * for" is.
 *
 * Reading only. Nothing on this page changes the project — repairs are made in
 * the editor, where the object and its properties are, and reconciliation is
 * its own explicit review. An operator station that could silently rewrite the
 * engineering source would be the opposite of what Step I is for.
 */
function EngineeringSection({
  diag, shown, severityFilter, categoryFilter, onSeverity, onCategory, onJumpTag,
}: {
  diag: DiagnosticReport
  shown: DiagnosticFinding[]
  severityFilter: 'all' | DiagnosticSeverity
  categoryFilter: 'all' | DiagnosticCategory
  onSeverity(v: 'all' | DiagnosticSeverity): void
  onCategory(v: 'all' | DiagnosticCategory): void
  onJumpTag(tag: string): void
}) {
  return (
    <>
      <div className="op-kpis" data-testid="diag-eng-summary">
        {(['error', 'warning', 'info'] as const).map((sev) => (
          <div key={sev} className="op-kpi" data-testid={`diag-eng-${sev}`}
            data-rule={diag.counts[sev] > 0 ? sev : undefined}
            style={diag.counts[sev] > 0 ? { borderLeftColor: SEVERITY_TONE[sev] } : undefined}>
            <div className="k">{SEVERITY_LABEL[sev]}</div>
            <div className="v">{diag.counts[sev]}</div>
          </div>
        ))}
      </div>

      <div className="op-filters">
        <span className="lbl" style={{ marginLeft: 0 }}>Severity</span>
        {(['all', 'error', 'warning', 'info'] as const).map((v) => (
          <button key={v} data-testid={`diag-sev-${v}`} className={severityFilter === v ? 'on' : ''}
            aria-pressed={severityFilter === v} onClick={() => onSeverity(v)}>
            {v === 'all' ? 'All' : SEVERITY_LABEL[v]}
          </button>
        ))}
        <span className="lbl">Category</span>
        <select data-testid="diag-category" value={categoryFilter}
          onChange={(e) => onCategory(e.target.value as 'all' | DiagnosticCategory)}>
          <option value="all">All categories</option>
          {DIAGNOSTIC_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]} ({diag.byCategory[c]})</option>
          ))}
        </select>
      </div>

      <div className="op-wrap">
        <table className="op-table">
          <thead>
            <tr>
              <th>Severity</th><th>Category</th><th>Tag</th>
              <th>Finding</th><th>Where</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} data-testid="diag-eng-row" data-category={f.category}
                data-severity={f.severity} data-tag={f.tag}>
                <td><span className="op-sev" style={{ color: SEVERITY_TONE[f.severity] }}>{SEVERITY_LABEL[f.severity]}</span></td>
                <td>{CATEGORY_LABEL[f.category]}</td>
                <td>
                  {/* Navigation, where there is somewhere to go. A finding about
                      a tag the plant runs opens its process screen; one about a
                      tag that only exists on paper has nowhere to jump to and
                      says so by not offering. */}
                  {f.tag
                    ? <button className="op-link" data-testid="diag-eng-tag"
                        title={`Show ${f.tag} on its process screen`}
                        onClick={() => onJumpTag(f.tag!)}>{f.tag}</button>
                    : <span style={{ color: 'var(--hmi-text-muted)' }}>—</span>}
                </td>
                <td>
                  {f.message}
                  {f.details && <div className="op-sub">{f.details}</div>}
                  <div className="op-sub" data-testid="diag-eng-action"><strong>Do:</strong> {f.suggestedAction}</div>
                </td>
                <td>
                  {f.location.screenId
                    ? <button className="op-link" data-testid="diag-eng-locate"
                        title="Open this on its HMI screen in the editor"
                        onClick={() => locateHmi(f.location.screenId!, f.location.widgetId)}>HMI screen</button>
                    : <span style={{ color: 'var(--hmi-text-muted)' }}>
                        {f.source === 'pid' ? 'P&ID' : f.source === 'registry' ? 'Record' : 'Runtime'}
                      </span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && (
        <p className="op-empty" data-testid="diag-eng-none">
          {diag.total === 0
            ? 'The P&ID, the engineering records, the simulation and these screens agree. Nothing to reconcile.'
            : 'Nothing matches this filter.'}
        </p>
      )}
    </>
  )
}
