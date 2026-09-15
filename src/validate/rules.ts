// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectIndex } from '../model/projectIndex'
import type { FixSpec } from '../assist/fixes'

/**
 * A single engineering check.
 *
 * Replaces the old split between `runChecks` (errors) and `runSuggestions`
 * (advice), which encoded severity as the ABSENCE of a field and could not
 * express the middle. A rule now declares what it is, and the report groups by
 * that rather than by which function produced it.
 */
export type Severity = 'critical' | 'warning' | 'info'

/** How an engineer triages, not how the code is organised. */
export type Discipline =
  | 'tagging'
  | 'topology'
  | 'process'
  | 'instrumentation'
  | 'data'

/**
 * A repair offered by a rule, as DATA.
 *
 * Deliberately not a closure: a fix has to be showable before it is run — named
 * in a confirmation, previewed with its blast radius, recorded in a revision,
 * and replayed in a test. `applyFix(spec)` in assist/fixes.ts is the one place
 * that performs one.
 */
export interface Fix {
  label: string
  spec: FixSpec
}

export interface RuleFinding {
  ruleId: string
  /**
   * Stable identity for this finding: the rule plus the ENGINEERING key of
   * what it is about, never a node id. That is what lets an "ignore" survive
   * deleting and redrawing the symbol, and lets a finding be tracked from one
   * revision to the next.
   */
  key: string
  /** Tag, line number, or a synthetic id when the subject has no key yet. */
  entityKey: string
  message: string
  /** Node or edge id, so the report can jump to it. */
  targetId?: string
  sheetId?: string
  /**
   * Where this finding lives on an OPERATOR SCREEN, when it is about one.
   *
   * Separate from `targetId`/`sheetId` because it is a different coordinate
   * system with a different destination: those take you to a symbol on a sheet
   * in the Draw workspace, this takes you to a widget on a screen in the HMI
   * workspace. Collapsing them into one id would make a report unable to say
   * which of the two it meant.
   */
  hmi?: { screenId: string; widgetId?: string; pipeId?: string }
  fix?: Fix
}

export interface Rule {
  id: string
  /** Group heading in the report — plain engineering language. */
  title: string
  severity: Severity
  discipline: Discipline
  /** One-line statement of why this matters, shown under the group. */
  why?: string
  run(ix: ProjectIndex): RuleFinding[]
}

/** Helper for rules: build a finding with the key convention applied. */
export function finding(
  rule: Pick<Rule, 'id'>,
  entityKey: string,
  message: string,
  extra: { targetId?: string; sheetId?: string; fix?: Fix; key?: string } = {},
): RuleFinding {
  const { key, ...rest } = extra
  // `key` is an escape hatch for the rare rule that reports several findings
  // about ONE engineering key and must let them be accepted separately — an
  // orphaned HMI binding, for instance, where the same missing tag can be read
  // by four different widgets and silencing one must not silence the rest.
  // Everything else takes the default and stays keyed by rule + entity.
  return { ruleId: rule.id, key: key ?? `${rule.id}:${entityKey}`, entityKey, message, ...rest }
}
