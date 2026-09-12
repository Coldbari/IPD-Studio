// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE QA BASELINE.
 *
 * What every bundled sample reports, rule by rule, written down.
 *
 * The samples are the closest thing in the repo to real user drawings, and a
 * new rule reaches every one of them on the day it ships. Without this, the
 * only way to find out that a check fires eleven times on the project we hand
 * new users is for a new user to find out — and a report that opens full of
 * noise is a report people switch off.
 *
 * So the numbers below are a CONTRACT, not a snapshot to re-bless. A diff here
 * means a rule changed what it says about real drawings, and the pull request
 * has to say why. Never update these to make a build pass: either the rule is
 * right and the sample should be fixed, or the rule is wrong.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/symbols/lib/index'
import { loadDoc } from '../../src/model/migrate'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules } from '../../src/validate/engine'
import { ALL_RULES } from '../../src/validate/rules/index'

const load = (file: string) =>
  loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples', file), 'utf8')))

/** rule id -> finding count, omitting rules that found nothing. */
function profileOf(file: string): Record<string, number> {
  const report = runRules(buildIndex(load(file)))
  const out: Record<string, number> = {}
  for (const g of report.groups) if (g.findings.length) out[g.rule.id] = g.findings.length
  return out
}

/**
 * Recorded 2026-09-11, at the close of the P1 hardening pass.
 *
 * `io-type-unclassified` is the P1-B rule the exit audit flagged as able to
 * add findings to unchanged legacy projects. Measured rather than estimated,
 * its real blast radius across all five shipped samples is ONE finding, on the
 * HMI demo. That is the number the audit was missing, and it is why the rule
 * ships at `info` rather than being softened.
 *
 * Note also what is NOT here after the hardening pass: no sample gained an
 * `io-type-unclassified` finding from the classifier being made stricter about
 * valves. Refusing to guess cost nothing on real drawings.
 */
const BASELINE: Record<string, Record<string, number>> = {
  'sample-plant.pnid.json': {
    'equipment-no-record': 4,
    'no-relief': 1,
  },
  'sample-refinery-unit.pnid.json': {
    'equipment-no-record': 12,
    'no-relief': 2,
    'required-field-empty': 1,
  },
  // The two blank templates have nothing drawn on them, and a starter file
  // that opened with findings would be a poor welcome.
  'template-blank-a3.pnid.json': {},
  'template-utility-a1.pnid.json': {},
  'template-hmi-demo.pnid.json': {
    'dangling-end': 2,
    'io-type-unclassified': 1,
    'needs-ip-converter': 1,
    'no-fail-position': 1,
    'no-relief': 1,
  },
}

describe('the bundled samples have a recorded QA profile', () => {
  for (const file of Object.keys(BASELINE)) {
    it(`${file} reports exactly what the baseline records`, () => {
      expect(profileOf(file)).toEqual(BASELINE[file])
    })
  }

  it('every rule the baseline names still exists', () => {
    const ids = new Set(ALL_RULES.map((r) => r.id))
    for (const counts of Object.values(BASELINE)) {
      for (const id of Object.keys(counts)) expect(ids, id).toContain(id)
    }
  })
})
