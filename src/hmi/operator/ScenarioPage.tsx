// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE SCENARIO PAGE — what the plant is doing today, and what it is designed to
 * be, side by side.
 *
 * The distinction is the whole point of the page. A battery limit's record says
 * 3 barg; today the upstream unit is down and it is at 1. Both are true, they
 * are different kinds of truth, and an operator has to be able to see which one
 * is currently in force and where it came from.
 *
 * READ-ONLY WITH RESPECT TO THE DRAWING. Nothing here can change a pressure on
 * a record, a tag, a connection or a piece of geometry. The only things it can
 * do are apply a runtime override and take it away again — and neither touches
 * the document.
 *
 * NOTHING HERE CALCULATES A PROCESS VALUE. An override is a boundary condition
 * handed to the solver; every number on this page beside it is read back out of
 * the solved state. An overridden pressure is never written into a transmitter.
 */

import { useState } from 'react'
import { useSimStore } from '../simStore'
import { boundaryRole } from '../sim/processView'
import type { ViewEdge } from '../sim/processView'
import { OBSERVED_FROM_ROLE, formatBarg, scenarioFindings } from '../sim/scenario'
import type { Override, ValueSource } from '../sim/scenario'
import { SHUT_LEAK_MAX } from '../sim/hydraulic/solver'
import { SEVERITY_LABEL } from '../../model/diagnostics'

/** How each source reads to an operator. Words, because a source is not a
 *  severity and must not borrow one. */
const SOURCE_LABEL: Record<ValueSource, string> = {
  engineering: 'Engineering',
  scenario: 'Scenario',
  signal: 'Runtime boundary',
  default: 'Default (atmospheric)',
  invalid: 'Invalid',
}

/** What a terminal's record says its pressure DOES during a run. A static one
 *  says nothing, which is most of them. */
const SIGNAL_LABEL: Record<string, string> = {
  constant: 'Constant', step: 'Step', ramp: 'Ramp',
}

/** One terminal's row. */
function TerminalRow({ tag, onOverride, onRelease }: {
  tag: string
  onOverride(tag: string, pressure: string): void
  onRelease(tag: string): void
}) {
  const resolved = useSimStore((s) => s.terminals[tag])
  const view = useSimStore((s) => s.processView)
  const pipeFlows = useSimStore((s) => s.pipeFlows)
  const solved = useSimStore((s) => s.hydraulic.converged)
  const [draft, setDraft] = useState('')

  if (!resolved) return null
  const node = view?.nodes.find((n) => n.tag === tag)
  const flowOf = (e: ViewEdge) => e.pipeIds.reduce((v, p) => (v !== 0 ? v : (pipeFlows[p] ?? 0)), 0)
  // WHAT IT IS DOING, from the signed flow — the same rule the process view
  // uses, worded for a state table. Not a property of the terminal.
  const observed = node && view && solved
    ? OBSERVED_FROM_ROLE[boundaryRole(node, view.edges, flowOf, SHUT_LEAK_MAX)]
    : undefined
  const spec = useSimStore((s) => s.terminalSpec[tag])

  return (
    <tr data-testid="scn-terminal" data-tag={tag} data-source={resolved.source}>
      <td><strong>{tag}</strong></td>
      <td data-testid="scn-desc">{spec?.service ?? '—'}</td>
      <td className="num" data-testid="scn-engineering">
        {/* what the RECORD says. A dash means the record states nothing, and
            the terminal is on the documented atmospheric fallback. */}
        {spec?.barA === undefined ? '—' : formatBarg(spec.barA)}
      </td>
      <td className="num" data-testid="scn-active">{formatBarg(resolved.barA)}</td>
      <td data-testid="scn-signal">
        {resolved.signal ? SIGNAL_LABEL[resolved.signal] ?? resolved.signal : 'Static'}
      </td>
      <td data-testid="scn-source">{SOURCE_LABEL[resolved.source]}</td>
      <td data-testid="scn-observed">{observed ?? '—'}</td>
      <td>
        <div className="scn-edit">
          <input
            data-testid="scn-input" aria-label={`Override ${tag}`}
            value={draft} placeholder="e.g. 2 barg"
            onChange={(e) => setDraft(e.target.value)} />
          <button data-testid="scn-apply" className="op-link"
            onClick={() => { onOverride(tag, draft); setDraft('') }}>Override</button>
          {resolved.source === 'scenario' && (
            <button data-testid="scn-release" className="op-link"
              onClick={() => onRelease(tag)}>Release</button>
          )}
        </div>
      </td>
    </tr>
  )
}

export default function ScenarioPage() {
  const scenario = useSimStore((s) => s.scenario)
  const terminals = useSimStore((s) => s.terminals)
  const problems = useSimStore((s) => s.scenarioProblems)
  const apply = useSimStore((s) => s.applyScenario)
  const clear = useSimStore((s) => s.clearScenario)
  const reset = useSimStore((s) => s.reset)

  const tags = Object.keys(terminals).sort()
  const findings = scenarioFindings(problems)

  /** Replace this tag's override, keeping every other one. Replacing rather
   *  than appending is what stops the UI producing the duplicate-override
   *  state K8 reports — the operator asked for one value, so they get one. */
  const setOverride = (tag: string, pressure: string) => {
    const kept = (scenario?.overrides ?? []).filter(
      (o) => !(o.kind === 'terminal-pressure' && o.tag === tag))
    const next: Override[] = pressure.trim() === ''
      ? kept
      : [...kept, { kind: 'terminal-pressure', tag, pressure: pressure.trim() }]
    apply({ id: scenario?.id ?? 'operator', name: scenario?.name ?? 'Operator scenario', overrides: next })
  }

  const equipment = (scenario?.overrides ?? []).filter(
    (o): o is Extract<Override, { kind: 'signal' }> => o.kind === 'signal')

  return (
    <div className="op-page" data-testid="op-scenario">
      <section className="op-section">
        <h3 className="op-h">Runtime scenario</h3>
        <div className="scn-bar">
          <span data-testid="scn-state" className={scenario ? 'scn-on' : ''}>
            {scenario ? `Applied: ${scenario.name}` : 'No scenario applied — the plant is on its engineering records'}
          </span>
          <span className="op-spacer" />
          <button data-testid="scn-clear" disabled={!scenario} onClick={() => clear()}>
            Clear scenario
          </button>
          <button data-testid="scn-reset" onClick={() => reset()}>Reset plant</button>
        </div>
        {/* The two are NOT the same action, and saying so is the point. K8
            chose deliberately that clearing a scenario does not rewind a
            command an operator gave. */}
        <p className="op-note" data-testid="scn-note">
          <strong>Clear scenario</strong> removes runtime boundary overrides only. Equipment
          commands stay where they were put — an operator undoes a command with a command.
          <strong> Reset plant</strong> returns the whole simulation to its starting state.
        </p>
      </section>

      {findings.length > 0 && (
        <section className="op-section" data-testid="scn-problems">
          <h3 className="op-h">Scenario problems</h3>
          <ul className="scn-problems">
            {findings.map((f) => (
              <li key={f.id} data-testid="scn-problem" data-tag={f.tag} data-severity={f.severity}>
                <span className="scn-sev">{SEVERITY_LABEL[f.severity]}</span>
                <strong>{f.tag}</strong> {f.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="op-section">
        <h3 className="op-h">Terminals</h3>
        {tags.length === 0 ? (
          <p className="op-empty" data-testid="scn-no-terminals">
            This plant has no tagged terminals. Every unterminated line is atmospheric.
          </p>
        ) : (
          <div className="op-wrap">
            <table className="op-table">
              <thead>
                <tr>
                  <th>Tag</th><th>Service</th><th className="num">Engineering</th>
                  <th className="num">Active</th><th>Runtime source</th><th>Source</th>
                  <th>Observed</th><th>Runtime override</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <TerminalRow key={t} tag={t} onOverride={setOverride}
                    onRelease={(tag) => setOverride(tag, '')} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="op-note">
          A terminal states a <strong>pressure</strong>, never a direction. “Observed” is what the
          solved flow is doing at this instant, and it changes when the plant does.
        </p>
      </section>

      {equipment.length > 0 && (
        <section className="op-section" data-testid="scn-equipment">
          <h3 className="op-h">Equipment overrides in this scenario</h3>
          <ul className="scn-problems">
            {equipment.map((o, i) => (
              <li key={`${o.tag}-${o.signal}-${i}`} data-testid="scn-equip" data-tag={o.tag}>
                <strong>{o.tag}</strong> {o.signal} = {o.value}
              </li>
            ))}
          </ul>
          <p className="op-note">
            Applied through the ordinary operator write path, so the journal carries them like
            any other command — and clearing the scenario does not take them back.
          </p>
        </section>
      )}
    </div>
  )
}
