// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP I — the two new surfaces, mounted.
 *
 * The Diagnostics page's engineering section and the reconciliation dialog,
 * driven against the real document store and the real runtime. What is being
 * checked is that the LIVE and the ENGINEERING answers stay separate, that
 * nothing is applied by looking at it, and that what the preview says is what
 * the apply does.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaLive } from '../../src/validate/live'
import { resetQaCache } from '../../src/validate/engine'
import { resetDiagnosticsCache } from '../../src/model/diagnostics'
import { fingerprintTag } from '../../src/model/reconcile'
import DiagnosticsPage from '../../src/hmi/operator/DiagnosticsPage'
import ReconcileDialog from '../../src/hmi/ReconcileDialog'
import { useHmiLocate, clearHmiLocate } from '../../src/hmi/locate'
import type { HmiScreen } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'
import type { PlantNode } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const bubble = (letters: string, loop: string, id: string): PlantNode => ({
  id, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters, loop },
})

/** LT-101 is drawn and shown; PT-102 is drawn and NOT shown; GONE-1 is shown
 *  and drawn nowhere. Between them that is one of most categories. */
const screen: HmiScreen = {
  id: 'scr1', name: 'Feed area', theme: 'classic',
  widgets: [
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { level0: 20 } },
    { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-101' } },
    { id: 'bad', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'GONE-1' },
  ],
  pipes: [{ id: 'e1', points: [{ x: 0, y: 118 }, { x: 510, y: 100 }], bId: 't' }],
}

function project(): ProjectDoc {
  const doc = createEmptyDoc('t')
  const sheet = doc.sheets[0]!
  sheet.name = 'Sheet 1'
  sheet.nodes = [
    bubble('LT', '101', 'lt101'),
    bubble('PT', '102', 'pt102'),
    { id: 'tk101', symbolId: 'vessel.tank', kind: 'equipment', x: 0, y: 0, rotation: 0, tag: { letters: 'TK', loop: '101' } },
  ]
  const withScreen: ProjectDoc = {
    ...doc,
    hmiScreens: [{ ...screen, fromSheetId: sheet.id }],
    registry: {
      'PT-102': { key: 'PT-102', kind: 'instrument', fields: { 'signal.units': 'm³/h' } },
    },
  }
  const baseline = { 'LT-101': fingerprintTag(withScreen, 'LT-101', sheet) }
  return { ...withScreen, hmiScreens: [{ ...withScreen.hmiScreens[0]!, baseline }] }
}

const roots: { unmount(): void }[] = []
async function mount(el: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(el))
  return host
}
const noop = () => {}
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const all = (host: HTMLElement, id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)]
const txt = (host: HTMLElement, id: string) => q(host, id)?.textContent ?? ''
const click = async (el: Element | null | undefined) => { await act(async () => (el as HTMLElement).click()) }

// The live QA watcher schedules an idle recompute after an edit. Left mounted,
// it fires during a LATER test and React rightly complains about a state update
// outside act(). Unmounting is the honest fix: a page nobody is looking at
// should not be recomputing anything.
afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
  resetQaLive()
})

beforeEach(() => {
  document.body.innerHTML = ''
  resetQaLive()
  resetQaCache()
  resetDiagnosticsCache()
  clearHmiLocate()
  useStore.getState().loadIntoStore(project())
  useSimStore.getState().exitRun()
  useSimStore.getState().enterRun(screen, useStore.getState().doc.registry)
})

// ── The Diagnostics page ────────────────────────────────────────────────────

describe('the Diagnostics page keeps live and engineering apart', () => {
  it('opens on the live runtime table and offers the engineering section beside it', async () => {
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    expect(q(host, 'diag-section-live')!.getAttribute('aria-pressed')).toBe('true')
    expect(q(host, 'diag-section-engineering')).not.toBeNull()
    // Live rows are present; engineering rows are not, because they are a
    // different subject and live somewhere else.
    expect(all(host, 'diag-row').length).toBeGreaterThan(0)
    expect(all(host, 'diag-eng-row')).toHaveLength(0)
  })

  it('carries the engineering finding count on the section, so it is visible without opening it', async () => {
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    expect(Number(txt(host, 'diag-eng-count'))).toBeGreaterThan(0)
  })

  it('shows every finding with its severity, its category and what to do', async () => {
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    await click(q(host, 'diag-section-engineering'))
    const rows = all(host, 'diag-eng-row')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.getAttribute('data-category')).toBeTruthy()
      expect(r.getAttribute('data-severity')).toBeTruthy()
    }
    expect(all(host, 'diag-eng-action').length).toBe(rows.length)
  })

  it('filters by severity and by category without changing what was found', async () => {
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    await click(q(host, 'diag-section-engineering'))
    const total = all(host, 'diag-eng-row').length

    await click(q(host, 'diag-sev-error'))
    const errors = all(host, 'diag-eng-row')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((r) => r.getAttribute('data-severity') === 'error')).toBe(true)

    await click(q(host, 'diag-sev-all'))
    expect(all(host, 'diag-eng-row')).toHaveLength(total)

    const select = q(host, 'diag-category') as HTMLSelectElement
    await act(async () => {
      select.value = 'missing-tag'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const filtered = all(host, 'diag-eng-row')
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((r) => r.getAttribute('data-category') === 'missing-tag')).toBe(true)
  })

  it('states the engineering verdict beside each live row, not folded into it', async () => {
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const row = all(host, 'diag-row').find((r) => r.getAttribute('data-tag') === 'GONE-1')!
    // GOOD quality AND an engineering error, at the same time, both visible.
    expect(row.getAttribute('data-quality')).not.toBe('bad')
    expect(row.querySelector('[data-testid="diag-eng-jump"]')).not.toBeNull()

    const clean = all(host, 'diag-row').find((r) => r.getAttribute('data-tag') === 'LT-101')!
    expect(clean.querySelector('[data-testid="diag-eng-cell"]')!.textContent).toContain('VALID')
  })

  it('navigates from a finding to its widget on the HMI screen', async () => {
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    await click(q(host, 'diag-section-engineering'))
    await click(all(host, 'diag-eng-locate')[0])
    expect(useHmiLocate.getState().request).toMatchObject({ screenId: 'scr1' })
  })

  it('navigates from a finding to the tag on its process screen', async () => {
    let jumped: string | null = null
    const host = await mount(<DiagnosticsPage onJumpTag={(t) => { jumped = t }} />)
    await click(q(host, 'diag-section-engineering'))
    await click(all(host, 'diag-eng-tag')[0])
    expect(jumped).toBeTruthy()
  })
})

// ── The reconciliation dialog ───────────────────────────────────────────────

describe('the reconciliation dialog', () => {
  it('summarises the difference and applies nothing by being opened', async () => {
    const before = useStore.getState().doc
    const host = await mount(<ReconcileDialog onClose={noop} />)
    expect(txt(host, 'rc-count-added')).toContain('1')       // PT-102
    expect(txt(host, 'rc-count-removed')).toContain('1')     // GONE-1
    expect(all(host, 'rc-item').length).toBe(2)
    expect(useStore.getState().doc).toBe(before)
    expect(q(host, 'rc-apply')!.hasAttribute('disabled')).toBe(true)
  })

  it('previews exactly the changes it will make, and only once chosen', async () => {
    const host = await mount(<ReconcileDialog onClose={noop} />)
    expect(all(host, 'rc-preview-line')).toHaveLength(0)
    const added = all(host, 'rc-item').find((r) => r.getAttribute('data-status') === 'added')!
    await click(added.querySelector('[data-testid="rc-action-add"]'))
    const lines = all(host, 'rc-preview-line').map((l) => l.textContent)
    expect(lines).toEqual(['+ Add PT-102'])
    expect(q(host, 'rc-apply')!.hasAttribute('disabled')).toBe(false)
  })

  it('applies the chosen change as one undoable step and leaves the rest alone', async () => {
    let closed = false
    const host = await mount(<ReconcileDialog onClose={() => { closed = true }} />)
    const added = all(host, 'rc-item').find((r) => r.getAttribute('data-status') === 'added')!
    await click(added.querySelector('[data-testid="rc-action-add"]'))
    await click(q(host, 'rc-apply'))

    expect(closed).toBe(true)
    const widgets = useStore.getState().doc.hmiScreens[0]!.widgets
    expect(widgets.some((w) => w.tag === 'PT-102')).toBe(true)
    // The REMOVED item was not chosen, so the widget reading a deleted tag is
    // still exactly where the engineer left it.
    expect(widgets.some((w) => w.tag === 'GONE-1')).toBe(true)
    expect(widgets.find((w) => w.id === 'lt')!.x).toBe(700)

    useStore.getState().undo()
    expect(useStore.getState().doc.hmiScreens[0]!.widgets.some((w) => w.tag === 'PT-102')).toBe(false)
  })

  it('offers a remap destination for a removed object, chosen by the engineer', async () => {
    const host = await mount(<ReconcileDialog onClose={noop} />)
    const removed = all(host, 'rc-item').find((r) => r.getAttribute('data-status') === 'removed')!
    const select = removed.querySelector('[data-testid="rc-action-remap"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    // No default: the software does not pick which tag a widget should read.
    expect(select.value).toBe('')
    await act(async () => {
      select.value = 'PT-102'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(all(host, 'rc-preview-line').map((l) => l.textContent))
      .toEqual(['→ Point the GONE-1 object at PT-102'])
  })

  it('says so, rather than comparing, when the screen has no P&ID source', async () => {
    const doc = useStore.getState().doc
    useStore.getState().loadIntoStore({
      ...doc,
      hmiScreens: [{ ...doc.hmiScreens[0]!, fromSheetId: undefined }],
    })
    const host = await mount(<ReconcileDialog onClose={noop} />)
    expect(q(host, 'rc-no-source')).not.toBeNull()
    expect(all(host, 'rc-item')).toHaveLength(0)
  })

  it('does not disturb the running plant', async () => {
    const sim = () => useSimStore.getState()
    for (let i = 0; i < 10; i++) sim().tickOnce(1)
    const t = sim().t
    const history = sim().history
    const host = await mount(<ReconcileDialog onClose={noop} />)
    const added = all(host, 'rc-item').find((r) => r.getAttribute('data-status') === 'added')!
    await click(added.querySelector('[data-testid="rc-action-add"]'))
    await click(q(host, 'rc-apply'))
    expect(sim().t).toBe(t)
    expect(sim().history).toBe(history)
  })
})
