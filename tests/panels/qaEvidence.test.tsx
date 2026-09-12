// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * "What exactly did QA find when this revision was issued?" — answered from
 * the frozen record, through the rendered dialog.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import QaEvidenceDialog from '../../src/panels/QaEvidenceDialog'
import { standardProvenance } from '../../src/model/provenance'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import type { QaFindingRecord } from '../../src/model/provenance'
import type { Revision } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const f = (over: Partial<QaFindingRecord> & Pick<QaFindingRecord, 'key' | 'severity'>): QaFindingRecord => ({
  ruleId: 'r', entityKey: 'LT-101', ruleTitle: 'A check', message: 'something', ...over,
})

const FINDINGS: QaFindingRecord[] = [
  f({ key: 'duplicate-tag:LT-101', severity: 'critical', ruleId: 'duplicate-tag', ruleTitle: 'Duplicate tags', message: 'LT-101 is used twice' }),
  f({ key: 'orphan-record:PT-300', severity: 'warning', ruleId: 'orphan-record', ruleTitle: 'Orphan records', entityKey: 'PT-300', message: 'PT-300 has no symbol', ignored: { reason: 'Redrawn next revision', by: 'PN', at: '2026-01-02T00:00:00.000Z' } }),
  f({ key: 'io-type-unclassified:FE-200', severity: 'info', ruleId: 'io-type-unclassified', ruleTitle: 'Unclassifiable signals', entityKey: 'FE-200', message: 'FE-200 cannot be classified' }),
]

const revision = (over: Partial<Revision> = {}): Revision => ({
  id: 'r1', code: 'B', date: '2026-03-04', description: 'Relief valve added',
  preparedBy: 'PN', status: 'IFC', issuedAt: '2026-03-05T09:00:00.000Z',
  standard: standardProvenance({ ...DEFAULT_STANDARD, id: 'acme', name: 'Acme Standard', version: '2.1' }),
  qaAtIssue: { critical: 1, warning: 1, info: 1, total: 3 },
  qaEvidence: { findings: FINDINGS, omitted: 0, capturedAt: '2026-03-05T09:00:00.000Z' },
  ...over,
})

async function mount(r: Revision) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => { await act(async () => root.render(<QaEvidenceDialog revision={r} onClose={() => {}} />)) }
  await render()
  return { host, render }
}

const byTestId = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const click = async (el: Element | null, render: () => Promise<void>) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
  await render()
}

beforeEach(() => { document.body.innerHTML = '' })

describe('the evidence a revision carries', () => {
  it('lists every finding with its rule, object and message', async () => {
    const { host } = await mount(revision())
    const text = byTestId(host, 'qae-table')!.textContent!
    for (const v of ['Duplicate tags', 'LT-101', 'LT-101 is used twice', 'Orphan records', 'PT-300', 'FE-200']) {
      expect(text, v).toContain(v)
    }
  })

  it('shows an accepted finding as accepted, with its reason', async () => {
    const { host } = await mount(revision())
    const row = [...host.querySelectorAll('tr')].find((r) => r.textContent?.includes('PT-300'))!
    expect(row.className).toContain('qae-ignored')
    expect(row.textContent).toContain('Redrawn next revision')
  })

  it('names the standard the findings were produced by', async () => {
    const { host } = await mount(revision())
    expect(byTestId(host, 'qae-standard')!.textContent).toContain('Acme Standard v2.1')
  })

  it('summarises by severity', async () => {
    const { host } = await mount(revision())
    const head = byTestId(host, 'qae-head')!.textContent!
    expect(head).toContain('1 critical')
    expect(head).toContain('1 warning')
    expect(head).toContain('1 info')
  })

  it('filters by severity', async () => {
    const { host, render } = await mount(revision())
    await click(byTestId(host, 'qae-filter-critical'), render)
    const text = byTestId(host, 'qae-table')!.textContent!
    expect(text).toContain('LT-101')
    expect(text).not.toContain('FE-200')
  })

  it('says when it had to leave findings out', async () => {
    const { host } = await mount(revision({
      qaEvidence: { findings: FINDINGS, omitted: 57, capturedAt: '2026-03-05T09:00:00.000Z' },
    }))
    expect(byTestId(host, 'qae-omitted')!.textContent).toContain('57')
  })
})

describe('a revision with no evidence', () => {
  it('says so rather than showing an empty table that looks like a clean report', async () => {
    const { standard, qaEvidence, ...legacy } = revision()
    void standard; void qaEvidence
    const { host } = await mount(legacy)
    const none = byTestId(host, 'qae-none')!
    expect(none.textContent).toContain('No QA evidence was recorded')
    // and it still reports the counts it DOES have, so the row is not useless
    expect(none.textContent).toContain('3')
    expect(byTestId(host, 'qae-table')).toBeNull()
  })
})
