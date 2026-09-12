// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { revisionsOf } from '../../src/model/revision'
import { __resetSnapshots } from '../../src/persist/revisions'
import { resetQaCache } from '../../src/validate/engine'
import RevisionsDialog from '../../src/panels/RevisionsDialog'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const doc = () => useStore.getState().doc
const sheet = () => doc().sheets[0]!

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => {
    await act(async () => root.render(<RevisionsDialog sheet={sheet()} onClose={() => {}} />))
  }
  await render()
  return { host, render }
}

const click = async (el: Element | null, render: () => Promise<void>) => {
  await act(async () => { (el as HTMLButtonElement).click() })
  await render()
}

beforeEach(() => {
  document.body.innerHTML = ''
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('the revisions dialog', () => {
  it('offers to start a table when there is none', async () => {
    const { host } = await mount()
    expect(host.querySelector('[data-testid="rev-start"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="rev-table"]')).toBeNull()
  })

  it('creates a revision the user can fill in', async () => {
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    expect(revisionsOf(sheet())).toHaveLength(1)
    const editor = host.querySelector('[data-testid="rev-editor"]')
    expect(editor).not.toBeNull()
    for (const id of ['rev-code', 'rev-date', 'rev-status', 'rev-description', 'rev-prepared', 'rev-checked', 'rev-approved']) {
      expect(host.querySelector(`[data-testid="${id}"]`), id).not.toBeNull()
    }
  })

  it('offers exactly the statuses the standard profile configures', async () => {
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    const options = [...host.querySelectorAll('[data-testid="rev-status"] option')].map((o) => o.textContent)
    expect(options).toEqual(['WIP', 'IFR', 'IFA', 'IFC', 'AS-BUILT'])
  })

  it('follows a company profile with its own statuses', async () => {
    useStore.getState().setStandard({ ...DEFAULT_STANDARD, issueStatuses: ['DRAFT', 'ISSUED'] })
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    const options = [...host.querySelectorAll('[data-testid="rev-status"] option')].map((o) => o.textContent)
    expect(options).toEqual(['DRAFT', 'ISSUED'])
  })

  it('shows the QA state before issuing, without blocking it', async () => {
    useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    expect(host.querySelector('[data-testid="rev-qa"]')!.textContent).toContain('finding')
    expect((host.querySelector('[data-testid="rev-issue"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('lists history, and tells work in progress apart from what was issued', async () => {
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    // Before issuing: the row reads as work in progress.
    expect(host.querySelector('[data-testid="rev-table"]')).not.toBeNull()
    expect(host.querySelector('.rev-badge-wip')).not.toBeNull()
    expect(host.querySelector('.rev-badge-issued')).toBeNull()
    expect(host.querySelector('tr.rev-open')).not.toBeNull()

    await click(host.querySelector('[data-testid="rev-issue"]'), render)

    // After: issued, with the QA count kept beside it, and no open editor.
    expect(host.querySelector('.rev-badge-issued')).not.toBeNull()
    expect(host.querySelector('.rev-badge-wip')).toBeNull()
    expect(host.querySelector('tr.rev-issued')).not.toBeNull()
    expect(host.querySelector('[data-testid="rev-editor"]')).toBeNull()
  })

  it('shows both rows once a second revision is started', async () => {
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="rev-start"]'), render)
    await click(host.querySelector('[data-testid="rev-issue"]'), render)
    await click(host.querySelector('[data-testid="rev-start"]'), render)

    expect(host.querySelectorAll('.rev-table tbody tr')).toHaveLength(2)
    expect(host.querySelector('.rev-badge-issued')).not.toBeNull()
    expect(host.querySelector('.rev-badge-wip')).not.toBeNull()
    // A → B, suggested and still editable.
    expect(revisionsOf(sheet()).map((r) => r.code)).toEqual(['A', 'B'])
  })

  it('creating and issuing never touches the drawing', async () => {
    useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const before = { nodes: sheet().nodes, registry: doc().registry, screens: doc().hmiScreens }
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="rev-start"]'), render)
    await click(host.querySelector('[data-testid="rev-issue"]'), render)

    expect(sheet().nodes).toBe(before.nodes)
    expect(doc().registry).toBe(before.registry)
    expect(doc().hmiScreens).toBe(before.screens)
  })
})
