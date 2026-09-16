// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useSimStore } from '../simStore'
import { alarmCounts } from './summary'

/**
 * The operator workstation's pages.
 *
 * RUNTIME UI STATE, not document state: which page is open is a property of
 * this session at this station, and persisting it would put an operator's
 * navigation into the engineering drawing's undo history.
 */
export type OperatorPage = 'overview' | 'flow' | 'process' | 'equipment' | 'alarms' | 'trends' | 'scenario' | 'diagnostics'

export const OPERATOR_PAGES: readonly OperatorPage[] = [
  'overview', 'flow', 'process', 'equipment', 'alarms', 'trends', 'scenario', 'diagnostics',
]

export const PAGE_LABEL: Record<OperatorPage, string> = {
  overview: 'Overview',
  flow: 'Process flow',
  process: 'Mimic',
  equipment: 'Equipment',
  alarms: 'Alarms',
  trends: 'Trends',
  scenario: 'Scenario',
  diagnostics: 'Diagnostics',
}

/** What each page is for, so an icon-free bar still explains itself. */
const PAGE_HINT: Record<OperatorPage, string> = {
  overview: 'Plant status, alarms and key values at a glance',
  flow: 'The plant laid out the way the process runs, with live flow and pressure',
  process: 'The drawn mimic screens — the P&ID geometry, with live values',
  equipment: 'Every drive, valve and vessel with its live state',
  alarms: 'The full alarm list, with filters and acknowledgement',
  trends: 'Plot any recorded signal over 1 to 60 minutes',
  scenario: 'What the plant is doing today, against what its records say it is',
  diagnostics: 'Live instrument readings, quality and ranges',
}

/**
 * The page bar. One row, always in the same place, reachable from anywhere in
 * RUN — the workstation's spine.
 *
 * The ALARMS entry carries the standing count so trouble is visible from every
 * page without the operator going looking, which is the ISA-101 pattern the
 * per-screen nav dots already follow. It reads the same `alarmCounts` every
 * other page does rather than counting for itself.
 */
export default function OperatorNav({ page, onPage, crumb }: {
  page: OperatorPage
  onPage(p: OperatorPage): void
  /** Where inside PROCESS the operator currently is. */
  crumb?: string
}) {
  // Subscribe to the COUNTS, not to the alarm array. The store hands out a new
  // array every tick, so selecting it would re-render this bar five times a
  // second forever; a number only changes when the number changes.
  const active = useSimStore((s) => alarmCounts(s.alarms).active)
  const unacked = useSimStore((s) => alarmCounts(s.alarms).unacked)

  return (
    <nav className="op-nav" aria-label="Operator pages">
      {OPERATOR_PAGES.map((p) => (
        <button
          key={p}
          data-testid={`op-nav-${p}`}
          className={p === page ? 'on' : ''}
          aria-current={p === page ? 'page' : undefined}
          title={PAGE_HINT[p]}
          onClick={() => onPage(p)}
        >
          {PAGE_LABEL[p]}
          {p === 'alarms' && active > 0 && (
            <span className="op-count" data-testid="op-nav-alarm-count"
              title={`${unacked} unacknowledged of ${active} standing`}>
              {active}
            </span>
          )}
        </button>
      ))}
      <span className="op-spacer" />
      {page === 'process' && crumb && (
        <span className="op-crumb" data-testid="op-crumb">
          {PAGE_LABEL.process} <span aria-hidden>›</span> <strong>{crumb}</strong>
        </span>
      )}
    </nav>
  )
}
