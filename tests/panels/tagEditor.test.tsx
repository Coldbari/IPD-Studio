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
import TagEditor from '../../src/panels/TagEditor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget => ({
  x: 0, y: 0, w: 64, h: 64, ...w,
})

async function mountFor(nodeId: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const node = useStore.getState().doc.sheets[0]!.nodes.find((n) => n.id === nodeId)!
  const root = createRoot(host)
  await act(async () => root.render(<TagEditor node={node} />))
  const rerender = async () => {
    const fresh = useStore.getState().doc.sheets[0]!.nodes.find((n) => n.id === nodeId)!
    await act(async () => root.render(<TagEditor node={fresh} />))
  }
  return { host, rerender }
}

/** React controls `value`, so a native set + input event is how a keystroke is
 *  delivered without the framework overwriting it. */
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const doc = () => useStore.getState().doc
const tagOf = (id: string) => doc().sheets[0]!.nodes.find((n) => n.id === id)?.tag
const loopInput = (host: HTMLElement) => host.querySelector('.tag-loop') as HTMLInputElement

/** A tagged instrument with a record and a bound HMI widget. */
function seedRenameCase(): string {
  useStore.getState().loadIntoStore({
    ...createEmptyDoc('t'),
    hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'Overview', pipes: [],
      widgets: [widget({ id: 'w1', type: 'tank', tag: 'LT-101', label: 'Tank Level' })] } as HmiScreen],
  })
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  useStore.getState().setRecordField('P-101', 'equipment', 'general.line', 'from LT-101 header')
  return id
}

beforeEach(() => {
  document.body.innerHTML = ''
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('renaming holds a draft', () => {
  it('does not touch the document while the digits are being typed', async () => {
    const id = seedRenameCase()
    const before = doc()
    const { host } = await mountFor(id)

    // "201" typed over "101", one character at a time.
    for (const v of ['10', '1', '2', '20', '201']) await type(loopInput(host), v)

    expect(doc()).toBe(before)
    expect(tagOf(id)).toEqual({ letters: 'LT', loop: '101' })
    expect(loopInput(host).value).toBe('201')
  })

  it('shows the impact of the draft, split into auto and review', async () => {
    const id = seedRenameCase()
    const { host } = await mountFor(id)
    await type(loopInput(host), '201')

    expect(host.querySelector('[data-testid="rename-impact"]')).not.toBeNull()
    const auto = host.querySelector('[data-testid="rename-impact-auto"]')!.textContent!
    expect(auto).toContain('1 engineering record')
    expect(auto).toContain('1 HMI widget')
    const review = host.querySelector('[data-testid="rename-impact-review"]')!.textContent!
    expect(review).toContain('general.line')
    expect(host.querySelector('[data-testid="rename-impact-blocked"]')).toBeNull()
  })

  it('applies once, carrying every AUTO reference and leaving review text alone', async () => {
    const id = seedRenameCase()
    const { host } = await mountFor(id)
    await type(loopInput(host), '201')
    await act(async () => {
      ;(host.querySelector('[data-testid="tag-apply"]') as HTMLButtonElement).click()
    })

    expect(tagOf(id)).toEqual({ letters: 'LT', loop: '201' })
    expect(doc().registry?.['LT-201']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc().hmiScreens[0]!.widgets[0]!.tag).toBe('LT-201')
    expect(doc().registry?.['P-101']?.fields['general.line']).toBe('from LT-101 header')
  })

  it('undoes the whole rename in one step', async () => {
    const id = seedRenameCase()
    const { host } = await mountFor(id)
    await type(loopInput(host), '201')
    await act(async () => {
      ;(host.querySelector('[data-testid="tag-apply"]') as HTMLButtonElement).click()
    })
    await act(async () => { useStore.temporal.getState().undo() })

    expect(tagOf(id)).toEqual({ letters: 'LT', loop: '101' })
    expect(doc().hmiScreens[0]!.widgets[0]!.tag).toBe('LT-101')
  })

  it('cancel discards the draft and changes nothing', async () => {
    const id = seedRenameCase()
    const before = doc()
    const { host } = await mountFor(id)
    await type(loopInput(host), '201')
    await act(async () => {
      ;(host.querySelector('[data-testid="tag-cancel"]') as HTMLButtonElement).click()
    })

    expect(doc()).toBe(before)
    expect(loopInput(host).value).toBe('101')
    expect(host.querySelector('[data-testid="rename-impact"]')).toBeNull()
  })

  it('reports a collision in the preview, before anything is committed', async () => {
    const id = seedRenameCase()
    useStore.getState().setRecordField('LT-201', 'instrument', 'signal.range', '0-250 bar')
    const before = doc()
    const { host } = await mountFor(id)
    await type(loopInput(host), '201')

    const blocked = host.querySelector('[data-testid="rename-impact-blocked"]')
    expect(blocked).not.toBeNull()
    expect(blocked!.textContent).toContain('already has an engineering record')
    expect(host.querySelector('[data-testid="rename-impact-auto"]')).toBeNull()
    expect(doc()).toBe(before)
  })

  it('a blocked rename stays blocked when applied, and changes nothing', async () => {
    const id = seedRenameCase()
    useStore.getState().setRecordField('LT-201', 'instrument', 'signal.range', '0-250 bar')
    const before = doc()
    const { host } = await mountFor(id)
    await type(loopInput(host), '201')
    await act(async () => {
      ;(host.querySelector('[data-testid="tag-apply"]') as HTMLButtonElement).click()
    })

    expect(doc()).toBe(before)
    expect(tagOf(id)).toEqual({ letters: 'LT', loop: '101' })
    expect(host.textContent).toContain('the rename was refused')
  })
})

describe('first tagging still commits live', () => {
  it('writes each keystroke, so auto-numbering and the QA report keep up', async () => {
    useStore.getState().loadIntoStore(createEmptyDoc('t'))
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const { host, rerender } = await mountFor(id)

    const letters = host.querySelector('.tag-letters') as HTMLInputElement
    await type(letters, 'FIC')
    await rerender()

    // Committed immediately, with a loop auto-assigned — no Apply required.
    expect(tagOf(id)?.letters).toBe('FIC')
    expect(tagOf(id)?.loop).toBeTruthy()
    expect(host.querySelector('[data-testid="rename-impact"]')).toBeNull()
  })
})
