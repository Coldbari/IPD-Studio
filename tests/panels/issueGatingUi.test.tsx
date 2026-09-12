// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * WHAT THE ENGINEER SEES.
 *
 * The one rule these tests exist to hold: the reason an issue is refused is
 * never hidden. A greyed-out button that does not say why is worse than no
 * gate at all, because the engineer's only remaining move is to work around
 * the tool.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import type { IssueGate } from '../../src/model/standard'
import { revisionsOf } from '../../src/model/revision'
import { __resetSnapshots } from '../../src/persist/revisions'
import { resetQaCache } from '../../src/validate/engine'
import RevisionsDialog from '../../src/panels/RevisionsDialog'
import QaEvidenceDialog from '../../src/panels/QaEvidenceDialog'
import StandardsPage from '../../src/workspaces/StandardsPage'
import type { Revision } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const doc = () => useStore.getState().doc
const sheet = () => doc().sheets[0]!
const text = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''

async function mount(node: () => React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => { await act(async () => root.render(node())) }
  await render()
  return { host, render }
}

const click = async (el: Element | null, render: () => Promise<void>) => {
  await act(async () => { (el as HTMLButtonElement).click() })
  await render()
}

/** Two symbols on one tag — a critical finding. */
function seedCritical(): void {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  for (const x of [0, 96]) {
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  }
}

const withPolicy = (policy: Record<string, IssueGate>) =>
  useStore.getState().setStandard({ ...DEFAULT_STANDARD, issuePolicy: policy })

beforeEach(() => {
  document.body.innerHTML = ''
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('the revisions dialog before issuing', () => {
  it('shows the verdict, both counts, the checks run and the fingerprint', async () => {
    seedCritical()
    const { host, render } = await mount(() => <RevisionsDialog sheet={sheet()} onClose={() => {}} />)
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    expect(text(host, 'rev-pre-status')).toBeTruthy()
    expect(text(host, 'rev-pre-open')).toContain('critical')
    expect(text(host, 'rev-pre-accepted')).toContain('Accepted')
    expect(text(host, 'rev-pre-rules')).toMatch(/\d+ checks evaluated/)
    expect(text(host, 'rev-pre-disabled')).toContain('no checks switched off')
    expect(text(host, 'rev-pre-print')).toContain(DEFAULT_STANDARD.name)
  })

  it('says the status is ungated when no policy applies, and enables the button', async () => {
    seedCritical()
    const { host, render } = await mount(() => <RevisionsDialog sheet={sheet()} onClose={() => {}} />)
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    expect(text(host, 'rev-pre-ungated')).toContain('No issue policy is configured')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="rev-issue"]')!.disabled).toBe(false)
    expect(host.querySelector('[data-testid="rev-blocked"]')).toBeNull()
  })

  it('names every reason, and only then disables the button', async () => {
    seedCritical()
    withPolicy({ IFR: { blockSeverities: ['critical'], requireChecker: true, requireApprover: true } })
    const { host, render } = await mount(() => <RevisionsDialog sheet={sheet()} onClose={() => {}} />)
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    const draft = revisionsOf(sheet())[0]!
    expect(draft.status).toBe('WIP')
    // Move the draft to the gated status.
    await act(async () => { useStore.getState().updateRevision(sheet().id, draft.id, { status: 'IFR' }) })
    await render()

    expect(text(host, 'rev-blocked-title')).toContain('Cannot issue')
    const reasons = text(host, 'rev-blocked')
    expect(reasons).toContain('open critical')
    expect(reasons).toContain('checker is required')
    expect(reasons).toContain('approver is required')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="rev-issue"]')!.disabled).toBe(true)
  })

  it('lists the switched-off checks rather than implying they passed', async () => {
    seedCritical()
    useStore.getState().setStandard({ ...DEFAULT_STANDARD, severityOverrides: { 'no-relief': 'off' } })
    resetQaCache()
    const { host, render } = await mount(() => <RevisionsDialog sheet={sheet()} onClose={() => {}} />)
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    expect(text(host, 'rev-pre-disabled')).toContain('1 switched off: no-relief')
  })
})

describe('the revisions dialog after issuing', () => {
  it('shows a conformance chip on the issued row, and offers the report', async () => {
    seedCritical()
    const { host, render } = await mount(() => <RevisionsDialog sheet={sheet()} onClose={() => {}} />)
    await click(host.querySelector('[data-testid="rev-start"]'), render)
    const code = revisionsOf(sheet())[0]!.code
    await click(host.querySelector('[data-testid="rev-issue"]'), render)

    expect(revisionsOf(sheet())[0]!.issuedAt).toBeDefined()
    expect(text(host, `rev-conf-${code}`)).toBe('Conformant')
    expect(host.querySelector(`[data-testid="rev-conf-csv-${code}"]`)).not.toBeNull()
  })

  it('shows Not recorded for a revision issued before conformance existed', async () => {
    const legacy: Revision = {
      id: 'r1', code: 'A', date: '2025-01-01', description: 'old', preparedBy: 'PN', status: 'IFC',
      issuedAt: '2025-01-01T00:00:00.000Z', qaAtIssue: { critical: 1, warning: 0, info: 0, total: 1 },
    }
    useStore.getState().loadIntoStore({
      ...createEmptyDoc('t'),
      sheets: createEmptyDoc('t').sheets.map((s) => ({ ...s, revisions: [legacy] })),
    })
    const { host } = await mount(() => <RevisionsDialog sheet={sheet()} onClose={() => {}} />)

    expect(text(host, 'rev-conf-A')).toContain('Not recorded')
    expect(text(host, 'rev-conf-A')).toContain('finding evidence not recorded')
  })
})

describe('the QA evidence dialog', () => {
  const rev: Revision = {
    id: 'r1', code: 'B', date: '', description: '', preparedBy: '', status: 'IFC',
    issuedAt: '2026-01-01T00:00:00.000Z',
    conformance: {
      status: 'conformant-with-accepted',
      open: { critical: 0, warning: 2, info: 0, total: 2 },
      accepted: { critical: 1, warning: 0, info: 0, total: 1 },
      rulesEvaluated: 37, rulesDisabled: ['no-relief', 'dangling-end'],
    },
    qaEvidence: {
      capturedAt: '2026-01-01T00:00:00.000Z', omitted: 0,
      findings: [
        { ruleId: 'duplicate-tag', key: 'k1', entityKey: 'LT-101', severity: 'critical',
          ruleTitle: 'Duplicate tags', message: 'two symbols',
          ignored: { reason: 'agreed with client', at: '2025-12-01T00:00:00.000Z' } },
        { ruleId: 'missing-tag', key: 'k2', entityKey: 'n2', severity: 'warning', ruleTitle: 'Untagged', message: 'no tag' },
        { ruleId: 'missing-tag', key: 'k3', entityKey: 'n3', severity: 'warning', ruleTitle: 'Untagged', message: 'no tag' },
      ],
    },
  }

  it('separates open from accepted, and never sums them', async () => {
    const { host } = await mount(() => <QaEvidenceDialog revision={rev} onClose={() => {}} />)
    expect(text(host, 'qae-open')).toContain('0 critical')
    expect(text(host, 'qae-open')).toContain('2 total')
    expect(text(host, 'qae-accepted')).toContain('1 critical')
    expect(text(host, 'qae-accepted')).toContain('1 total')
  })

  it('states the verdict and says plainly that disabled checks did not run', async () => {
    const { host } = await mount(() => <QaEvidenceDialog revision={rev} onClose={() => {}} />)
    expect(text(host, 'qae-verdict')).toContain('Conformant with accepted findings')
    expect(text(host, 'qae-rules')).toContain('37 checks evaluated')
    const disabled = text(host, 'qae-disabled')
    expect(disabled).toContain('did not run')
    expect(disabled).toContain('no-relief')
    expect(disabled).toContain('dangling-end')
  })

  it('says so when a revision has no conformance record at all', async () => {
    const { host } = await mount(() => <QaEvidenceDialog revision={{ ...rev, conformance: undefined }} onClose={() => {}} />)
    expect(text(host, 'qae-verdict')).toContain('Not recorded')
    expect(text(host, 'qae-rules')).toContain('not recorded')
  })
})

describe('the standards page policy editor', () => {
  it('shows a row per issue status, ungated to start with', async () => {
    const { host } = await mount(() => <StandardsPage />)
    expect(host.querySelector('[data-testid="std-issue-policy"]')).not.toBeNull()
    for (const status of ['WIP', 'IFR', 'IFA', 'IFC', 'AS-BUILT']) {
      expect(host.querySelector(`[data-testid="std-policy-${status}"]`), status).not.toBeNull()
      expect(host.querySelector<HTMLInputElement>(`[data-testid="std-policy-${status}-block-critical"]`)!.checked).toBe(false)
    }
  })

  it('does not apply the recommended policy until the engineer adopts it AND saves', async () => {
    const { host, render } = await mount(() => <StandardsPage />)
    expect(doc().standard?.issuePolicy).toBeUndefined()

    await click(host.querySelector('[data-testid="std-policy-recommended"]'), render)

    // The draft has it; the project does not, until the page is applied.
    expect(host.querySelector<HTMLInputElement>('[data-testid="std-policy-IFC-block-critical"]')!.checked).toBe(true)
    expect(doc().standard?.issuePolicy).toBeUndefined()
  })

  it('warns that a policy change moves the standard fingerprint', async () => {
    const { host } = await mount(() => <StandardsPage />)
    expect(text(host, 'std-policy-print')).toContain('fingerprint')
  })
})
