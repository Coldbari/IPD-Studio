// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 3 — the Loop Manager and the Inspector loop section.
 *
 * These assert that the UI is a VIEW: every edit lands in the document through
 * the Program 2 store actions, completeness is whatever `loopViews` says, and
 * a derived loop stays derived until somebody presses the button.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaCache } from '../../src/validate/engine'
import LoopsDialog from '../../src/panels/LoopsDialog'
import InspectorEngineering from '../../src/panels/InspectorEngineering'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const doc = () => st().doc
const loops = () => doc().loops ?? []
const rec = (key: string) => doc().registry?.[key]

async function mount(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(node))
  return host
}
const byTestId = (host: HTMLElement, id: string): HTMLElement | null =>
  host.querySelector(`[data-testid="${id}"]`)

const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}

async function setValue(el: HTMLElement | null, value: string) {
  expect(el, 'element to set').toBeTruthy()
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

/** Three tagged objects that form one derived loop. */
function seed() {
  st().loadIntoStore(createEmptyDoc('t'))
  const ids: Record<string, string> = {}
  for (const [letters, kind, symbolId] of [
    ['LT', 'instrument', 'instr.bubble'],
    ['LIC', 'instrument', 'instr.bubble'],
    ['LV', 'valve', 'cv.globe'],
  ] as const) {
    const id = st().addNode({ symbolId, kind, x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters, loop: '101' })
    ids[letters] = id
  }
  return ids
}

beforeEach(() => {
  document.body.innerHTML = ''
  resetQaCache()
  seed()
  useStore.temporal.getState().clear()
})

/* ------------------------------------------------------------ Loop Manager */

describe('the Loop Manager', () => {
  it('says so when nothing is declared, and never persists on open', async () => {
    const host = await mount(<LoopsDialog onClose={() => {}} />)
    expect(byTestId(host, 'loops-empty')).toBeTruthy()
    // Merely opening the dialog must not mint anything.
    expect(doc().loops).toBeUndefined()
  })

  it('lists persistent loops with number, type, member count, state and place', async () => {
    const { id } = st().addLoop('101', { name: 'Level', type: 'control' })
    st().assignLoop('LT-101', 'instrument', id!)
    st().assignLoop('LIC-101', 'instrument', id!)
    st().assignLoop('LV-101', 'valve', id!)

    const host = await mount(<LoopsDialog onClose={() => {}} />)
    expect((byTestId(host, `loop-number-${id}`) as HTMLInputElement).value).toBe('101')
    expect((byTestId(host, `loop-name-${id}`) as HTMLInputElement).value).toBe('Level')
    expect((byTestId(host, `loop-type-${id}`) as HTMLSelectElement).value).toBe('control')
    expect(byTestId(host, `loop-count-${id}`)!.textContent).toBe('3 members')
    // The state is whatever loopViews says — not a second opinion computed here.
    expect(byTestId(host, `loop-state-${id}`)!.textContent).toBe('Complete')
    expect(byTestId(host, `loop-place-${id}`)!.textContent).toBe('Unassigned')
  })

  it('creating a loop goes through the store and is undoable', async () => {
    const host = await mount(<LoopsDialog onClose={() => {}} />)
    await click(byTestId(host, 'loop-add'))
    expect(loops()).toHaveLength(1)
    await act(async () => st().undo())
    expect(loops()).toHaveLength(0)
  })

  it('editing number, type and status writes through the store actions', async () => {
    const { id } = st().addLoop('101')
    const host = await mount(<LoopsDialog onClose={() => {}} />)

    await setValue(byTestId(host, `loop-number-${id}`), '201')
    expect(loops()[0]!.number).toBe('201')
    expect(loops()[0]!.id).toBe(id)

    await setValue(byTestId(host, `loop-type-${id}`), 'cascade')
    expect(loops()[0]!.type).toBe('cascade')

    await setValue(byTestId(host, `loop-status-${id}`), 'in-review')
    expect(loops()[0]!.status).toBe('in-review')
  })

  it('surfaces a refusal from the store rather than deciding for itself', async () => {
    st().addLoop('101')
    const b = st().addLoop('102')
    const host = await mount(<LoopsDialog onClose={() => {}} />)

    await setValue(byTestId(host, `loop-number-${b.id}`), '101')

    expect(byTestId(host, 'loops-error')!.textContent).toMatch(/already exists/i)
    // And the document is untouched — the refusal was the store's.
    expect(loops().find((l) => l.id === b.id)!.number).toBe('102')
  })

  it('unassigns a member from the list, through the store', async () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    const host = await mount(<LoopsDialog onClose={() => {}} />)

    expect(byTestId(host, `loop-members-${id}`)!.textContent).toContain('LT-101')
    await click(byTestId(host, 'loop-unassign-LT-101'))
    expect(rec('LT-101')?.loopId).toBeUndefined()
  })

  it('shows a member that is no longer drawn as broken rather than hiding it', async () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    st().assignLoop('LIC-101', 'instrument', id!)
    // Delete the symbol; P0 keeps the record, so the loop keeps the member.
    const nodeId = doc().sheets[0]!.nodes.find((n) => n.tag?.letters === 'LT')!.id
    await act(async () => st().deleteIds([nodeId]))
    resetQaCache()

    const host = await mount(<LoopsDialog onClose={() => {}} />)
    expect(byTestId(host, `loop-state-${id}`)!.textContent).toBe('Broken')
    expect(byTestId(host, `loop-members-${id}`)!.textContent).toContain('LT-101 ⚠')
  })
})

/* ------------------------------------------------------- derived vs persistent */

describe('derived loops stay derived', () => {
  it('are shown only as a preview, and adopting is an explicit press', async () => {
    const host = await mount(<LoopsDialog onClose={() => {}} />)
    // The preview is not even computed until asked for.
    expect(byTestId(host, 'loops-adopt')).toBeFalsy()
    await click(byTestId(host, 'loops-show-adopt'))

    expect(byTestId(host, 'adopt-row-L-101')!.textContent).toContain('adopt')
    // Still nothing persisted by looking.
    expect(doc().loops).toBeUndefined()

    await click(byTestId(host, 'adopt-apply'))
    expect(loops()).toHaveLength(1)
    expect(loops()[0]!.number).toBe('L-101')
    expect(byTestId(host, 'adopt-done')!.textContent).toMatch(/Declared 1 loop/)
  })

  it('adoption is one undo step and leaves the drawing alone', async () => {
    const nodesBefore = JSON.stringify(doc().sheets[0]!.nodes)
    const host = await mount(<LoopsDialog onClose={() => {}} />)
    await click(byTestId(host, 'loops-show-adopt'))
    await click(byTestId(host, 'adopt-apply'))

    expect(JSON.stringify(doc().sheets[0]!.nodes)).toBe(nodesBefore)
    await act(async () => st().undo())
    expect(doc().loops ?? []).toHaveLength(0)
    expect(rec('LT-101')?.loopId).toBeUndefined()
  })

  it('shows an attention row with its reason rather than adopting it', async () => {
    // A tagged annotation carries no record, so this loop cannot be adopted.
    const ann = st().addNode({ symbolId: 'note.text', kind: 'annotation', x: 0, y: 0, rotation: 0 })
    await act(async () => { st().setTag(ann, { letters: 'LZ', loop: '101' }) })
    resetQaCache()

    const host = await mount(<LoopsDialog onClose={() => {}} />)
    await click(byTestId(host, 'loops-show-adopt'))
    const row = byTestId(host, 'adopt-row-L-101')!
    expect(row.className).toContain('attention')
    expect(row.textContent).toMatch(/no engineering record/i)
    expect(byTestId(host, 'adopt-apply')).toBeFalsy()
  })
})

/* ---------------------------------------------------------------- Inspector */

describe('the Inspector loop section', () => {
  const nodeFor = (letters: string) => doc().sheets[0]!.nodes.find((n) => n.tag?.letters === letters)!

  it('says there are no loops yet, and never shows an id', async () => {
    const host = await mount(<InspectorEngineering node={nodeFor('LT')} />)
    expect(byTestId(host, 'eng-loop-note')!.textContent).toMatch(/No loops declared yet/i)
  })

  it('assigns and unassigns through the store, showing the NUMBER', async () => {
    const { id } = st().addLoop('101', { name: 'Level', type: 'control' })
    const host = await mount(<InspectorEngineering node={nodeFor('LT')} />)

    await setValue(byTestId(host, 'eng-loop'), id!)
    expect(rec('LT-101')!.loopId).toBe(id)
    expect(byTestId(host, 'eng-loop-note')!.textContent).toContain('Loop 101')
    expect(byTestId(host, 'eng-loop-note')!.textContent).not.toContain(id!)

    await setValue(byTestId(host, 'eng-loop'), '')
    expect(rec('LT-101')?.loopId).toBeUndefined()
  })

  it('a tag rename keeps the assignment, and the Inspector still shows it', async () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    await act(async () => { st().setTag(nodeFor('LT').id, { letters: 'LT', loop: '201' }) })

    expect(rec('LT-201')!.loopId).toBe(id)
    const host = await mount(<InspectorEngineering node={nodeFor('LT')} />)
    expect((byTestId(host, 'eng-loop') as HTMLSelectElement).value).toBe(id)
  })

  it('makes a broken assignment obvious and offers to repair it', async () => {
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    await act(async () => { st().removeLoop(id!) })
    // removeLoop cascades, so break it the only other way a document can: a
    // record left pointing at a loop that is not there.
    await act(async () => {
      st().loadIntoStore({
        ...doc(),
        loops: [],
        registry: { ...doc().registry, 'LT-101': { key: 'LT-101', kind: 'instrument', fields: {}, loopId: 'ghost' } },
      })
    })

    const host = await mount(<InspectorEngineering node={nodeFor('LT')} />)
    const broken = byTestId(host, 'eng-loop-broken')!
    expect(broken.textContent).toMatch(/Broken/i)
    expect(broken.textContent).toMatch(/not in the project/i)

    await click(byTestId(host, 'eng-loop-repair'))
    expect(rec('LT-101')?.loopId).toBeUndefined()
  })
})
