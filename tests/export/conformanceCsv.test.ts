// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE CONFORMANCE REPORT as a file somebody sends.
 *
 * Two properties do the work: it is DETERMINISTIC (the same issue produces the
 * same bytes, so two copies can be compared), and it is FORMULA-SAFE (it is
 * opened in Excel by people who did not write it).
 */

import { describe, expect, it } from 'vitest'
import { conformanceCsv } from '../../src/export/csv'
import { createEmptyDoc } from '../../src/model/doc'
import type { ProjectDoc, Revision, Sheet } from '../../src/model/types'
import type { ConformanceRecord } from '../../src/model/conformance'

const conformance: ConformanceRecord = {
  status: 'conformant-with-accepted',
  policyApplied: { blockSeverities: ['critical'], requireChecker: true },
  open: { critical: 0, warning: 2, info: 1, total: 3 },
  accepted: { critical: 1, warning: 0, info: 0, total: 1 },
  rulesEvaluated: 37,
  rulesDisabled: ['dangling-end', 'no-relief'],
}

const rev: Revision = {
  id: 'r1', code: 'B', date: '2026-03-01', description: 'IFC issue', preparedBy: 'PN',
  checkedBy: 'RN', approvedBy: 'AB', status: 'IFC',
  issuedAt: '2026-03-01T09:30:00.000Z',
  standard: { id: 'acme', name: 'Acme', version: '2.1', fingerprint: 'a1b2c3d4e5f60718' },
  qaAtIssue: { critical: 0, warning: 2, info: 1, total: 3 },
  qaEvidence: {
    capturedAt: '2026-03-01T09:30:00.000Z',
    omitted: 4,
    findings: [
      { ruleId: 'duplicate-tag', key: 'duplicate-tag:LT-101', entityKey: 'LT-101', severity: 'critical',
        ruleTitle: 'Duplicate tags', message: 'Two symbols carry LT-101',
        ignored: { reason: 'spare instrument, agreed', by: 'RN', at: '2026-02-28T00:00:00.000Z' } },
      { ruleId: 'missing-tag', key: 'missing-tag:n2', entityKey: 'n2', severity: 'warning',
        ruleTitle: 'Untagged symbols', message: 'This symbol has no tag' },
    ],
  },
  conformance,
}

function fixture(): { doc: ProjectDoc; sheet: Sheet } {
  const base = createEmptyDoc('Acme Ethylene')
  const doc: ProjectDoc = { ...base, meta: { ...base.meta, name: 'Acme Ethylene', documentNumber: 'DOC-9' } }
  const sheet: Sheet = { ...doc.sheets[0]!, name: 'Overview', drawingNumber: 'PID-001', revisions: [rev] }
  return { doc: { ...doc, sheets: [sheet] }, sheet }
}

const valueOf = (csv: string, key: string) =>
  csv.split('\n').find((l) => l.startsWith(`${key},`))?.slice(key.length + 1)

describe('the conformance CSV', () => {
  it('carries the metadata a transmittal is checked against', () => {
    const { doc, sheet } = fixture()
    const csv = conformanceCsv(doc, sheet, rev)

    expect(valueOf(csv, 'Project')).toBe('Acme Ethylene')
    expect(valueOf(csv, 'Document number')).toBe('DOC-9')
    expect(valueOf(csv, 'Drawing number')).toBe('PID-001')
    expect(valueOf(csv, 'Revision')).toBe('B')
    expect(valueOf(csv, 'Issue status')).toBe('IFC')
    expect(valueOf(csv, 'Issued at')).toBe('2026-03-01T09:30:00.000Z')
    expect(valueOf(csv, 'Standard name')).toBe('Acme')
    expect(valueOf(csv, 'Standard version')).toBe('2.1')
    expect(valueOf(csv, 'Standard fingerprint')).toBe('a1b2c3d4e5f60718')
    expect(valueOf(csv, 'Conformance')).toBe('Conformant with accepted findings')
  })

  it('keeps open and accepted counts apart, and names the disabled checks', () => {
    const { doc, sheet } = fixture()
    const csv = conformanceCsv(doc, sheet, rev)

    expect(valueOf(csv, 'Open findings — warning')).toBe('2')
    expect(valueOf(csv, 'Open findings — total')).toBe('3')
    expect(valueOf(csv, 'Accepted findings — critical')).toBe('1')
    expect(valueOf(csv, 'Accepted findings — total')).toBe('1')
    expect(valueOf(csv, 'Rules evaluated')).toBe('37')
    // Named, so a reviewer knows which questions were not asked.
    expect(valueOf(csv, 'Disabled checks')).toBe('dangling-end no-relief')
  })

  it('prints the frozen findings, marking each open or accepted', () => {
    const { doc, sheet } = fixture()
    const lines = conformanceCsv(doc, sheet, rev).split('\n')
    const header = lines.findIndex((l) => l.startsWith('Severity,'))
    expect(header).toBeGreaterThan(0)

    expect(lines[header + 1]).toContain('Accepted')
    expect(lines[header + 1]).toContain('spare instrument, agreed')
    expect(lines[header + 2]).toContain('Open')
    // And it says what it could not store.
    expect(lines.join('\n')).toContain('4 further findings were not stored')
  })

  it('is deterministic — the same issue twice is byte-identical', () => {
    const { doc, sheet } = fixture()
    expect(conformanceCsv(doc, sheet, rev)).toBe(conformanceCsv(doc, sheet, rev))
  })

  it('guards a hostile finding message against spreadsheet formula injection', () => {
    const { doc, sheet } = fixture()
    const hostile: Revision = {
      ...rev,
      qaEvidence: {
        ...rev.qaEvidence!,
        findings: [{
          ruleId: '=cmd|calc', key: 'k', entityKey: '@SUM(A1:A9)', severity: 'critical',
          ruleTitle: '+1+1', message: '=HYPERLINK("http://x","click")',
          ignored: { reason: '-2+3', at: 'now' },
        }],
      },
    }
    const csv = conformanceCsv(doc, sheet, hostile)
    // Every dangerous leading character is neutralised by the SHARED guard.
    expect(csv).toContain("'=cmd|calc")
    expect(csv).toContain("'@SUM(A1:A9)")
    expect(csv).toContain("'+1+1")
    expect(csv).toContain("'-2+3")
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
  })

  it('says "not recorded" for a legacy revision rather than inventing a verdict', () => {
    const { doc, sheet } = fixture()
    const legacy: Revision = {
      id: 'r0', code: 'A', date: '2025-01-01', description: 'old', preparedBy: 'PN', status: 'IFC',
      issuedAt: '2025-01-01T00:00:00.000Z',
      qaAtIssue: { critical: 1, warning: 0, info: 0, total: 1 },
    }
    const csv = conformanceCsv(doc, sheet, legacy)

    expect(valueOf(csv, 'Conformance')).toBe('Not recorded')
    expect(valueOf(csv, 'Standard fingerprint')).toBe('not recorded')
    expect(valueOf(csv, 'Rules evaluated')).toBe('not recorded')
    expect(valueOf(csv, 'Disabled checks')).toBe('not recorded')
    expect(valueOf(csv, 'Open findings — total')).toBe('1')
    expect(csv).toContain('Finding evidence not recorded for this revision')
  })
})
