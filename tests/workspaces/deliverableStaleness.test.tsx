// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-6 — deliverable staleness on the Project workspace.
 *
 * What this protects:
 *
 *  1. IT IS LAZY. Comparing eight reports means generating sixteen. It must not
 *     happen on a render, so nothing is compared until the button is pressed —
 *     and the result is thrown away when the document moves.
 *  2. A MISSING SNAPSHOT SAYS SO, in words, and is never dressed up as
 *     "unchanged".
 *  3. It never uses a word for a state the product cannot observe.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaLive } from '../../src/validate/live'
import { navigateWorkspace, currentWorkspace } from '../../src/routes'
import { putSnapshot } from '../../src/persist/revisions'
import ProjectWorkspace from '../../src/workspaces/ProjectWorkspace'
import type { PlantNode, ProjectDoc, Revision } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const text = (host: HTMLElement, id: string) => q(host, id)?.textContent ?? ''

async function mount(): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<ProjectWorkspace />))
  return host
}
const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}
/** Press the button and let the snapshot promise settle. */
const compare = async (host: HTMLElement) => {
  await act(async () => {
    ;(q(host, 'ph-deliverables-run') as HTMLElement).click()
    // The snapshot read is a promise chain; let it settle inside act so the
    // resulting setState is not reported as an unwrapped update.
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

const vessel = (id: string, loop: string): PlantNode =>
  ({ id, symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0, tag: { letters: 'TK', loop } })

const revision = (over: Partial<Revision> & Pick<Revision, 'id' | 'code'>): Revision =>
  ({ date: '', description: '', preparedBy: 'PN', status: 'IFC', ...over })

function base(service = 'Feed'): ProjectDoc {
  const doc = createEmptyDoc('Feed water unit')
  doc.sheets[0] = { ...doc.sheets[0]!, drawingNumber: 'PID-1001', nodes: [vessel('a', '101')], edges: [] }
  doc.registry = { 'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'construction.material': service } } }
  return doc
}

/** An issued sheet whose snapshot is in the store, and today's document. */
async function issued(opts: { snapshot?: ProjectDoc | null; today?: ProjectDoc } = {}) {
  const snap = opts.snapshot === undefined ? base() : opts.snapshot
  if (snap) await putSnapshot('snap-a', snap)
  const doc = opts.today ?? base()
  doc.sheets[0] = {
    ...doc.sheets[0]!,
    revisions: [revision({
      id: 'r1', code: 'A', issuedAt: '2026-03-04T09:00:00.000Z',
      ...(snap ? { snapshotId: 'snap-a' } : {}),
    })],
  }
  st().loadIntoStore(doc)
}

beforeEach(() => {
  resetQaLive()
  st().loadIntoStore(createEmptyDoc('deliverables'))
  navigateWorkspace('draw')
})

describe('the section is lazy', () => {
  it('compares nothing until the button is pressed', async () => {
    await issued()
    const host = await mount()
    expect(q(host, 'ph-deliverables')).not.toBeNull()
    expect(q(host, 'ph-deliverables-jump')).toBeNull()
    expect(text(host, 'ph-deliverables-run')).toContain('Compare with the last issue')
  })

  it('says what it will compare against before it does', async () => {
    await issued()
    const host = await mount()
    const basis = text(host, 'ph-deliverables-basis')
    expect(basis).toContain('PID-1001')
    expect(basis).toContain('Rev A')
    expect(basis).toContain('2026-03-04')
  })

  it('says there is nothing to compare against on a project never issued', async () => {
    st().loadIntoStore(base())
    const host = await mount()
    expect(text(host, 'ph-deliverables-basis')).toContain('Nothing has been issued yet')
  })
})

describe('an unchanged model', () => {
  it('reports every comparable report as UNCHANGED', async () => {
    await issued()
    const host = await mount()
    await compare(host)
    expect(text(host, 'ph-deliv-equipment-list')).toBe('UNCHANGED')
    expect(text(host, 'ph-deliv-line-list')).toBe('UNCHANGED')
    expect(text(host, 'ph-deliverables-note')).toContain('still matches the issued model')
  })
})

describe('a changed model', () => {
  it('reports the report that moved as DIFFERS, and the others as UNCHANGED', async () => {
    await issued({ snapshot: base('CS'), today: base('SS316') })
    const host = await mount()
    await compare(host)
    expect(text(host, 'ph-deliv-equipment-list')).toBe('DIFFERS')
    expect(text(host, 'ph-deliv-line-list')).toBe('UNCHANGED')
    expect(text(host, 'ph-deliverables-note')).toContain('1 report would come out different')
  })
})

describe('an unavailable snapshot', () => {
  it('says NOT AVAILABLE HERE, never UNCHANGED, when the snapshot is on another machine', async () => {
    // Issued, with a snapshot id that was never stored here.
    const doc = base()
    doc.sheets[0] = {
      ...doc.sheets[0]!,
      revisions: [revision({ id: 'r1', code: 'A', issuedAt: '2026-03-04T09:00:00.000Z', snapshotId: 'somewhere-else' })],
    }
    st().loadIntoStore(doc)
    const host = await mount()
    await compare(host)
    expect(text(host, 'ph-deliv-equipment-list')).toBe('NOT AVAILABLE HERE')
    expect(host.textContent).toContain('not on this machine')
    expect(text(host, 'ph-deliverables-note')).toContain('Nothing could be compared')
  })

  it('says so when the revision kept no snapshot at all', async () => {
    await issued({ snapshot: null })
    const host = await mount()
    await compare(host)
    expect(text(host, 'ph-deliv-line-list')).toBe('NOT AVAILABLE HERE')
    expect(host.textContent).toContain('issued without a stored snapshot')
  })

  it('says so when nothing has been issued', async () => {
    st().loadIntoStore(base())
    const host = await mount()
    await compare(host)
    expect(text(host, 'ph-deliv-io-list')).toBe('NOT AVAILABLE HERE')
    expect(host.textContent).toContain('Nothing has been issued yet')
  })
})

describe('renderings', () => {
  it('are listed as NOT COMPARABLE with a reason, rather than hidden', async () => {
    await issued()
    const host = await mount()
    await compare(host)
    for (const id of ['svg', 'pdf-sheet', 'pdf-all', 'png', 'dxf', 'dexpi']) {
      expect(text(host, `ph-deliv-${id}`)).toBe('NOT COMPARABLE')
    }
    expect(host.textContent).toContain('Stamps the export date')
  })
})

describe('the result is not allowed to go stale', () => {
  it('is thrown away when the document changes', async () => {
    await issued()
    const host = await mount()
    await compare(host)
    expect(q(host, 'ph-deliverables-jump')).not.toBeNull()

    // An edit means the answer describes a document that no longer exists.
    await act(async () => { st().setRecordField('TK-101', 'equipment', 'construction.material', 'SS') })
    expect(q(host, 'ph-deliverables-jump')).toBeNull()
    expect(q(host, 'ph-deliverables-run')).not.toBeNull()
  })
})

describe('wording and navigation', () => {
  it('never uses a word for a state it cannot observe as a STATUS', async () => {
    await issued()
    const host = await mount()
    await compare(host)
    // The disclaimer below the list deliberately says the words — "it can say
    // nothing about which files were produced or approved". What must never
    // happen is one of them appearing as a verdict on a row.
    const states = [...host.querySelectorAll('.ph-state')].map((el) => el.textContent ?? '')
    expect(states).toHaveLength(14)
    for (const word of [/generated/i, /downloaded/i, /approved/i, /issued/i]) {
      expect(states.join(' ')).not.toMatch(word)
    }
    expect(new Set(states)).toEqual(new Set(['UNCHANGED', 'NOT COMPARABLE']))
  })

  it('says what the comparison does and does not mean', async () => {
    await issued()
    const host = await mount()
    await compare(host)
    expect(text(host, 'ph-deliverables-note')).toContain('not whether anything is wrong')
  })

  it('opens the Data workspace, where the reports are', async () => {
    await issued()
    const host = await mount()
    await compare(host)
    await click(q(host, 'ph-deliverables-jump'))
    expect(currentWorkspace()).toBe('data')
  })

  it('renders one row per deliverable without duplicate React keys', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    await issued()
    const host = await mount()
    await compare(host)
    expect(q(host, 'ph-deliverables-jump')!.querySelectorAll('.ph-row')).toHaveLength(14)
    expect(warn.mock.calls.flat().join(' ')).not.toContain('same key')
    warn.mockRestore()
  })
})
