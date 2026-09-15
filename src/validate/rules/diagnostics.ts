// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE ENGINEERING↔HMI DIAGNOSTICS, as Checks rules.
 *
 * Every rule here is an ADAPTER. None of them detects anything: detection
 * lives once, in `model/diagnostics.ts`, so the Checks workspace, the HMI
 * Diagnostics page and the reconciliation view cannot disagree about what is
 * wrong with a project. A rule's whole body is "take the findings that name
 * me, and say them the way the report says things".
 *
 * WHY MORE THAN ONE RULE PER CATEGORY. A `Rule` declares ONE severity, and in
 * this codebase that severity means "does this stop the drawing being issued"
 * — a house standard can gate issue on `critical` (`model/conformance.ts`).
 * The diagnostic severity means "can the operator layer work". They are
 * genuinely different questions, so a category whose findings differ on the
 * first axis maps onto two rules. The split is stated as data, in
 * `DIAGNOSTIC_RULE_CATEGORY`, and the ledger test fails if it drifts from the
 * adapters below.
 *
 * WHAT IS NOT HERE. `missing-tag` has no rule of its own: it is reported by
 * `orphaned-binding` in `rules/data.ts`, which has shipped, is keyed, and may
 * already carry acceptances. That rule now delegates to the same canonical
 * detection, so there is one implementation and one set of keys.
 */

import type { Rule, RuleFinding } from '../rules'
import type { DiagnosticFinding } from '../../model/diagnostics'
import { diagnosticsFor } from '../../model/diagnostics'
import type { ProjectIndex } from '../../model/projectIndex'

/**
 * One diagnostic, as a report finding.
 *
 * `key` is the diagnostic's own id, not `ruleId:entityKey`. That is deliberate:
 * a category reports several findings about one tag — three unit problems on
 * one transmitter, two broken bindings on one screen — and accepting one must
 * not silence the rest. It is the same escape hatch `orphaned-binding` already
 * uses, applied to every category.
 */
export function asRuleFinding(f: DiagnosticFinding): RuleFinding {
  const loc = f.location
  const targetId =
    loc.kind === 'sheet-node' ? loc.nodeId
    : loc.kind === 'sheet-edge' ? loc.edgeId
    : undefined
  return {
    ruleId: f.ruleId,
    key: f.id,
    entityKey: f.tag ?? f.objectId ?? f.id,
    // The action belongs in the report: a finding that says what is wrong and
    // not what to do about it is a finding people scroll past.
    message: `${f.message}. ${f.suggestedAction}`,
    ...(targetId ? { targetId } : {}),
    ...(loc.sheetId ? { sheetId: loc.sheetId } : {}),
    ...(loc.screenId
      ? {
          hmi: {
            screenId: loc.screenId,
            ...(loc.widgetId ? { widgetId: loc.widgetId } : {}),
            ...(loc.pipeId ? { pipeId: loc.pipeId } : {}),
          },
        }
      : {}),
    ...(f.fix ? { fix: f.fix } : {}),
  }
}

/** Findings that name this rule, already sorted by the canonical ordering. */
export const findingsFor = (ix: ProjectIndex, ruleId: string): RuleFinding[] =>
  diagnosticsFor(ix).findings.filter((f) => f.ruleId === ruleId).map(asRuleFinding)

/** Build one adapter. The body is the same every time — that is the point. */
function adapter(spec: Omit<Rule, 'run'>): Rule {
  return { ...spec, run: (ix) => findingsFor(ix, spec.id) }
}

/* ------------------------------------------------------- broken connection */

export const brokenProcessConnection: Rule = adapter({
  id: 'broken-process-connection',
  title: 'Lines attached to a symbol that is gone',
  // Critical: this is the DRAWING being internally inconsistent. The line
  // still renders, and nothing — the run derivation, the loop derivation, the
  // HMI import — can walk through that end.
  severity: 'critical',
  discipline: 'topology',
  why: 'A line naming a symbol the sheet does not have cannot be followed by anything that reads the drawing, however complete it looks.',
})

export const brokenHmiBinding: Rule = adapter({
  id: 'broken-hmi-binding',
  title: 'HMI bindings pointing at something that is not there',
  // Warning, not critical, and the reason matters: an operator screen must
  // never block issuing a P&ID. The same findings are ERRORs on the
  // Diagnostics page, where the question is whether the plant can run.
  severity: 'warning',
  discipline: 'data',
  why: 'A measurement bound to a line that no longer exists reads a confident zero with GOOD quality. That is worse than a gap — it is a wrong number nobody questions.',
})

/* ------------------------------------------------------ missing instrument */

export const missingInstrument: Rule = adapter({
  id: 'missing-instrument',
  title: 'P&ID objects the operator screens do not show',
  // INFO. Not a drawing defect at all: a screen legitimately omits things, and
  // this only speaks about sheets a screen was actually built from. It is an
  // observation for the reconciliation view to act on, not an omission.
  severity: 'info',
  discipline: 'data',
  why: 'These sit on a sheet an HMI screen was built from, so they are inside the operator layer’s scope. Reconcile the screen to place them, or decide they are engineering-only.',
})

export const controllerNoMeasurement: Rule = adapter({
  id: 'controller-no-measurement',
  title: 'Controllers with no measurement',
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'A controller takes its PV from the tag sharing its ISA family and loop number that measures the same quantity. Without one it has nothing to control.',
})

/* ------------------------------------------------------------ range / unit */

export const invalidRange: Rule = adapter({
  id: 'invalid-range',
  title: 'Engineering ranges that cannot be read',
  // Critical, and the only one of these that should block issue: a range that
  // does not ascend is wrong on the datasheet, wrong in the I/O list and wrong
  // on every screen built from it.
  severity: 'critical',
  discipline: 'data',
  why: 'A range that does not ascend gives every display a negative span, puts limit ticks off the scale, and cannot be checked against an alarm.',
})

export const invalidUnit: Rule = adapter({
  id: 'invalid-unit',
  title: 'Units that name a different quantity',
  severity: 'critical',
  discipline: 'data',
  why: 'The ISA first letter says what the instrument measures. A unit from another quantity means the number on the screen is not what its label claims, and nothing is converted.',
})

export const unitAdvisory: Rule = adapter({
  id: 'unit-advisory',
  title: 'Units worth a second look',
  // INFO: each of these is legitimate somewhere. A per cent scale on a
  // pressure transmitter is a real way to write a signal range — it is just
  // not what the simulation puts in the tag, and saying so once is useful.
  severity: 'info',
  discipline: 'data',
  why: 'A per cent scale on a dimensioned measurement, a unit after the range contradicting the unit field, or a unit this build cannot convert.',
})

/* ---------------------------------------------------------------- runtime */

export const missingSimulationModel: Rule = adapter({
  id: 'missing-simulation-model',
  title: 'Objects the simulation has no model for',
  // INFO on the drawing axis: nothing about the P&ID is wrong. On the
  // Diagnostics page these are WARNINGs, because the plant cannot produce a
  // value or a state for them.
  severity: 'info',
  discipline: 'process',
  why: 'A measurement with nothing behind it drifts near an idle figure and is reported UNCERTAIN; a device on no flow path can be commanded and the process will not respond. Neither is bad data — it is an absent model.',
})

export const unboundHmiObject: Rule = adapter({
  id: 'unbound-hmi-object',
  title: 'HMI objects connected to nothing',
  severity: 'warning',
  discipline: 'data',
  why: 'This is the visual-only process value the architecture audit warned about: a widget that looks exactly like a live reading and is not one.',
})

export const diagnosticsEngine: Rule = adapter({
  id: 'diagnostics-engine',
  title: 'Engineering diagnostics that could not run',
  severity: 'critical',
  discipline: 'data',
  why: 'One category failed. The other six still ran, and what they found is above.',
})

export const DIAGNOSTIC_RULES: Rule[] = [
  brokenProcessConnection,
  brokenHmiBinding,
  missingInstrument,
  controllerNoMeasurement,
  invalidRange,
  invalidUnit,
  unitAdvisory,
  missingSimulationModel,
  unboundHmiObject,
  diagnosticsEngine,
]
