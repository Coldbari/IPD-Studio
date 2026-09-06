// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useStore } from '../store/store'
import { navigateWorkspace } from '../routes'
import { findingText, qaFor } from '../validate/engine'
import type { Severity } from '../validate/rules'
import { locateCell } from '../canvas/locate'
import { applyFix, describeFix, type FixSpec } from '../assist/fixes'
import { useT } from '../i18n'

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Information',
}

const SEVERITY_NOTE: Record<Severity, string> = {
  critical: 'These would stop the drawing being issued.',
  warning: 'Worth resolving before issue; not all of them are mistakes.',
  info: 'Observations. An engineer may well have meant it this way.',
}

const DISCIPLINES = ['tagging', 'topology', 'process', 'instrumentation', 'data'] as const

/**
 * The engineering QA report.
 *
 * Grouped by severity first and discipline second, because an engineer triages
 * by "what blocks issue", not by which function produced the finding. Ignored
 * items stay visible in their own collapsed section — a hidden ignore rots, and
 * the reason someone accepted a finding is exactly what the next reviewer needs.
 */
export default function ChecksWorkspace() {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const ignoreFinding = useStore((s) => s.ignoreFinding)
  const unignoreFinding = useStore((s) => s.unignoreFinding)
  const [discipline, setDiscipline] = useState<string>('all')
  const [showIgnored, setShowIgnored] = useState(false)

  const report = qaFor(doc)
  const groups = report.groups.filter((g) => discipline === 'all' || g.rule.discipline === discipline)

  const go = (sheetId?: string, targetId?: string) => {
    if (!targetId) return
    navigateWorkspace('draw')
    locateCell(targetId, sheetId)
  }

  // A fix can fail — the symbol may have moved on since the report was built.
  // Saying so beats a button that appears to do nothing.
  const runFix = (spec: FixSpec) => {
    const result = applyFix(spec)
    if (!result.ok) window.alert(result.message ? t(result.message) : t('That fix could not be applied.'))
  }

  const accept = (key: string, message: string) => {
    const reason = window.prompt(t('Accept this finding?') + '\n\n' + message + '\n\n' + t('Why is it acceptable? (recorded on the drawing)'))
    if (reason && reason.trim()) ignoreFinding(key, reason.trim())
  }

  // one heading per severity, emitted the first time that severity appears
  let lastSeverity: Severity | null = null

  return (
    <div className="ws">
      <header className="ws-head">
        <h1>{t('Checks')}</h1>
        <span className={`ws-tally${report.counts.critical ? ' bad' : ' ok'}`} data-testid="checks-tally">
          {report.counts.critical
            ? `${report.counts.critical} ${t('critical')}`
            : report.total === 0 ? t('No findings') : t('Nothing critical')}
        </span>
        {report.counts.warning > 0 && <span className="ws-tally soft">{report.counts.warning} {t('warning')}</span>}
        {report.counts.info > 0 && <span className="ws-tally">{report.counts.info} {t('info')}</span>}
        <span className="ws-sp" />
        <label className="ws-filter">
          {t('Discipline')}
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} data-testid="checks-discipline">
            <option value="all">{t('all')}</option>
            {DISCIPLINES.map((d) => <option key={d} value={d}>{t(d)}</option>)}
          </select>
        </label>
      </header>

      <div className="ws-body">
        {report.total === 0 && (
          <p className="ws-empty">
            {t('Nothing to fix — every tag parses, every line lands, and the instrumentation reads as complete.')}
          </p>
        )}

        {groups.map((g) => {
          const heading = g.rule.severity !== lastSeverity ? g.rule.severity : null
          lastSeverity = g.rule.severity
          return (
            <div key={g.rule.id}>
              {heading && (
                <div className={`ws-sev ${heading}`}>
                  <h2>{t(SEVERITY_LABEL[heading])}</h2>
                  <p>{t(SEVERITY_NOTE[heading])}</p>
                </div>
              )}
              <div className="ws-group" data-testid={`rule-${g.rule.id}`}>
                <div className="ws-group-head">
                  {t(g.rule.title)} <span>{g.findings.length}</span>
                  <em className="ws-group-disc">{t(g.rule.discipline)}</em>
                </div>
                {g.rule.why && <div className="ws-group-why">{t(g.rule.why)}</div>}
                {g.findings.map((f) => (
                  <div key={f.key} className="ws-issue">
                    <button
                      className="ws-issue-msg"
                      disabled={!f.targetId}
                      onClick={() => go(f.sheetId, f.targetId)}
                    >
                      {findingText(f.message, t)}
                    </button>
                    {f.fix && (
                      <button className="ws-issue-fix" title={t(describeFix(f.fix.spec, doc).blastRadius)} onClick={() => runFix(f.fix!.spec)}>
                        {t(f.fix.label)}
                      </button>
                    )}
                    <button
                      className="ws-issue-ignore"
                      title={t('Accept this finding, with a reason')}
                      onClick={() => accept(f.key, findingText(f.message, t))}
                    >
                      {t('Accept')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {report.ignored.length > 0 && (
          <div className="ws-ignored">
            <button className="ws-ignored-head" onClick={() => setShowIgnored((v) => !v)} data-testid="checks-ignored">
              {showIgnored ? '▾' : '▸'} {t('Accepted findings')} <span>{report.ignored.length}</span>
            </button>
            {showIgnored && (
              <div className="ws-group">
                {report.ignored.map(({ finding: f, entry }) => (
                  <div key={f.key} className="ws-issue">
                    <span className="ws-issue-msg muted">
                      {findingText(f.message, t)}
                      <em> — {entry.reason}{entry.by ? ` (${entry.by})` : ''}</em>
                    </span>
                    <button className="ws-issue-fix" onClick={() => unignoreFinding(f.key)}>{t('Reopen')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
