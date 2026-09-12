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
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import { clearTagImpact } from '../../src/model/references'
import { orphanedBinding } from '../../src/validate/rules/data'
import { buildIndex } from '../../src/model/projectIndex'
import TagEditor from '../../src/panels/TagEditor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget =>
  ({ x: 0, y: 0, w: 64, h: 64, ...w })

const doc = () => useStore.getState().doc
const tagOf = (id: string) => doc().sheets[0]!.nodes.find((n) => n.id === id)?.tag

/** LT-101 referenced from every AUTO path, plus a prose mention. */
function seed(): string {
  useStore.getState().loadIntoStore({
    ...createEmptyDoc('t'),
    hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'Overview', pipes: [], widgets: [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101', label: 'Tank Level' }),
      widget({ id: 'w2', type: 'trend', pens: [{ ref: 'LT-101.PV' }] }),
      widget({ id: 'w3', type: 'lamp', props: { signal: 'LT-101.PV' } }),
      widget({ id: 'w4', type: 'display', tag: 'LIC-1', props: { bindTank: 'LT-101', bindPipe: 'LT-101' } }),
    ] } as HmiScreen],
  })
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  useStore.getState().setRecordField('P-101', 'equipment', 'general.line', 'from LT-101 header')
  useStore.getState().ignoreFinding('missing-tag:LT-101', 'spare')
  return id
}

async function mountFor(nodeId: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => {
    const n = doc().sheets[0]!.nodes.find((x) => x.id === nodeId)!
    await act(async () => root.render(<TagEditor node={n} />))
  }
  await render()
  return { host, render }
}

/** Empty both tag fields, the way a user clearing a tag would. */
async function clearFields(host: HTMLElement) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  for (const sel of ['.tag-loop', '.tag-letters']) {
    const input = host.querySelector(sel) as HTMLInputElement
    await act(async () => {
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('clearTagImpact', () => {
  it('finds nothing for a tag nothing references', () => {
    seed()
    const i = clearTagImpact(doc(), 'ZZ-999')
    expect(i.counts.orphaned).toBe(0)
    expect(i.counts.review).toBe(0)
  })

  it('finds the record, widget, pen, signal and bindTank that will be stranded', () => {
    seed()
    const i = clearTagImpact(doc(), 'LT-101')
    expect(i.counts.byWhere.registry).toBe(1)
    expect(i.counts.byWhere['hmi-widget']).toBe(1)
    expect(i.counts.byWhere['hmi-pen']).toBe(1)
    expect(i.counts.byWhere['hmi-signal']).toBe(1)
    expect(i.counts.byWhere['hmi-bind']).toBe(1)
    expect(i.counts.byWhere['qa-ignored']).toBe(1)
    expect(i.counts.orphaned).toBe(6)
  })

  it('keeps human text as review, and bindPipe out entirely', () => {
    seed()
    const i = clearTagImpact(doc(), 'LT-101')
    expect(i.counts.review).toBe(1)
    expect(i.review[0]!.where).toBe('record-field')
    expect([...i.orphaned, ...i.review].some((r) => r.path.field === 'bindPipe')).toBe(false)
  })

  it('mutates nothing', () => {
    seed()
    const before = doc()
    const snapshot = JSON.stringify(before)
    clearTagImpact(before, 'LT-101')
    expect(doc()).toBe(before)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('is inert for a key that does not exist', () => {
    seed()
    expect(clearTagImpact(doc(), null).counts.orphaned).toBe(0)
  })
})

describe('clearing a tag in the editor', () => {
  it('previews what will be stranded, and does not call it a rename', async () => {
    const id = seed()
    const { host } = await mountFor(id)
    await clearFields(host)

    expect(host.querySelector('[data-testid="clear-impact"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="rename-impact"]')).toBeNull()
    const text = host.querySelector('[data-testid="clear-impact-orphans"]')!.textContent!
    expect(text).toContain('Nothing follows a cleared tag')
    expect(text).toContain('engineering record')
    expect(text).toContain('HMI widget')
    expect(host.querySelector('[data-testid="clear-impact-review"]')!.textContent).toContain('general.line')
  })

  it('requires an explicit confirmation — the button says what it does', async () => {
    const id = seed()
    const { host } = await mountFor(id)
    await clearFields(host)
    expect(host.querySelector('[data-testid="tag-apply"]')).toBeNull()
    expect(host.querySelector('[data-testid="tag-clear"]')!.textContent).toContain('Clear the tag')
  })

  it('the preview alone changes nothing', async () => {
    const id = seed()
    const before = doc()
    const { host } = await mountFor(id)
    await clearFields(host)
    expect(doc()).toBe(before)
    expect(tagOf(id)).toEqual({ letters: 'LT', loop: '101' })
  })

  it('cancel leaves the document untouched', async () => {
    const id = seed()
    const before = doc()
    const { host, render } = await mountFor(id)
    await clearFields(host)
    await act(async () => { (host.querySelector('[data-testid="tag-cancel"]') as HTMLButtonElement).click() })
    await render()
    expect(doc()).toBe(before)
    expect(tagOf(id)).toEqual({ letters: 'LT', loop: '101' })
  })

  it('confirming performs the clear, and P0-B then reports the orphans', async () => {
    const id = seed()
    const { host } = await mountFor(id)
    await clearFields(host)
    await act(async () => { (host.querySelector('[data-testid="tag-clear"]') as HTMLButtonElement).click() })

    expect(tagOf(id)).toBeUndefined()
    // The record is not deleted — it is stranded, which is what the preview said.
    expect(doc().registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    // Human text is still untouched.
    expect(doc().registry?.['P-101']?.fields['general.line']).toBe('from LT-101 header')

    const found = orphanedBinding.run(buildIndex(doc())).filter((f) => f.entityKey === 'LT-101')
    expect(found.length).toBeGreaterThanOrEqual(4)
  })
})
