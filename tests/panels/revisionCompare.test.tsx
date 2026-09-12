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
import { issueRevision, __resetSnapshots } from '../../src/persist/revisions'
import { revisionsOf } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'
import RevisionCompare from '../../src/panels/RevisionCompare'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const doc = () => useStore.getState().doc
const sheet = () => doc().sheets[0]!

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => { await act(async () => root.render(<RevisionCompare sheet={sheet()} />)) }
  await render()
  return { host, render }
}

const click = async (el: Element | null, render: () => Promise<void>) => {
  await act(async () => { (el as HTMLButtonElement).click() })
  await render()
}

/** Issue Rev A, change one engineering value, issue Rev B. */
async function twoRevisions(): Promise<string> {
  const sheetId = sheet().id
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  const a = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
  await issueRevision(sheetId, a)

  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-16 bar')
  const b = useStore.getState().addRevision(sheetId, { code: 'B', status: 'IFC' })
  await issueRevision(sheetId, b)
  return sheetId
}

beforeEach(() => {
  document.body.innerHTML = ''
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('the revision comparison view', () => {
  it('says so when there is nothing to compare yet', async () => {
    const { host } = await mount()
    expect(host.querySelector('[data-testid="rev-compare-note"]')!.textContent)
      .toContain('Two issued revisions are needed')
  })

  it('lets the user pick two revisions and compare them', async () => {
    await twoRevisions()
    const { host, render } = await mount()

    const a = host.querySelector('[data-testid="cmp-a"]') as HTMLSelectElement
    const b = host.querySelector('[data-testid="cmp-b"]') as HTMLSelectElement
    expect([...a.options].map((o) => o.textContent)).toEqual(['A', 'B'])
    expect(a.value).not.toBe(b.value)

    await click(host.querySelector('[data-testid="cmp-run"]'), render)

    expect(host.querySelector('[data-testid="cmp-summary"]')!.textContent).toContain('modified')
    const table = host.querySelector('[data-testid="cmp-table"]')!
    expect(table.textContent).toContain('signal.range')
    expect(table.textContent).toContain('0-10 bar')
    expect(table.textContent).toContain('0-16 bar')
  })

  it('reports the QA counts recorded at each issue', async () => {
    await twoRevisions()
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="cmp-run"]'), render)
    expect(host.querySelector('.rev-compare-note')!.textContent).toContain('Checks at issue')
  })

  it('refuses clearly when a snapshot is not on this machine', async () => {
    await twoRevisions()
    // Simulate a project opened on another computer: metadata, no bodies.
    __resetSnapshots()
    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="cmp-run"]'), render)

    const err = host.querySelector('[data-testid="cmp-error"]')
    expect(err).not.toBeNull()
    expect(err!.textContent).toContain('no stored snapshot')
    expect(host.querySelector('[data-testid="cmp-table"]')).toBeNull()
    expect(host.querySelector('[data-testid="cmp-summary"]')).toBeNull()
  })

  it('comparing changes nothing — no mutation, no undo step', async () => {
    await twoRevisions()
    const before = doc()
    const undoDepth = useStore.temporal.getState().pastStates.length
    const rows = JSON.parse(JSON.stringify(revisionsOf(sheet())))

    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="cmp-run"]'), render)

    expect(doc()).toBe(before)
    expect(useStore.temporal.getState().pastStates.length).toBe(undoDepth)
    expect(revisionsOf(sheet())).toEqual(rows)
  })

  it('filters to engineering changes, and can show everything', async () => {
    const sheetId = sheet().id
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
    const a = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, a)
    // A purely graphical revision: the symbol moved, nothing else.
    useStore.getState().setNodePos(id, 128, 64)
    const b = useStore.getState().addRevision(sheetId, { code: 'B', status: 'IFC' })
    await issueRevision(sheetId, b)

    const { host, render } = await mount()
    await click(host.querySelector('[data-testid="cmp-run"]'), render)

    expect(host.querySelector('.rev-compare-note')!.textContent).toContain('No engineering data changed')
    expect(host.querySelector('[data-testid="cmp-empty"]')).not.toBeNull()

    // React wires a checkbox's onChange to the click event, so click it.
    await click(host.querySelector('[data-testid="cmp-eng-only"]'), render)
    // With the filter off, the purely graphical move is visible.
    const table = host.querySelector('[data-testid="cmp-table"]')
    expect(table).not.toBeNull()
    expect(table!.textContent).toContain('128')
  })
})
