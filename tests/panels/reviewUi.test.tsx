// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-7 — review comments on the Engineering tab, and on the Project workspace.
 *
 * Two things the UI must get right beyond working:
 *
 *  1. IT DOES NOT LOOK LIKE QA. No severity word, no claim that anything is
 *     blocked, and the panel says in words where the rules actually speak.
 *  2. AN ABSENT AUTHOR SHOWS AS NOTHING. Inventing "Unknown" would be worse
 *     than admitting nobody was named.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaLive } from '../../src/validate/live'
import { navigateWorkspace, currentWorkspace } from '../../src/routes'
import { threadsOf } from '../../src/model/review'
import InspectorEngineering from '../../src/panels/InspectorEngineering'
import ProjectWorkspace from '../../src/workspaces/ProjectWorkspace'
import type { PlantNode } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const doc = () => st().doc
const threads = (key = 'P-101') => threadsOf(doc().registry?.[key])
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const text = (host: HTMLElement, id: string) => q(host, id)?.textContent ?? ''

async function mount(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, rerender: async (n: React.ReactElement) => { await act(async () => root.render(n)) } }
}
const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}
const type = async (el: Element | null, value: string) => {
  const input = el as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const nodeById = (id: string) => doc().sheets[0]!.nodes.find((n) => n.id === id)!

/** A tagged pump, with the document author named unless told otherwise. */
function pump(author = 'P Nagpure'): PlantNode {
  const base = createEmptyDoc('review ui')
  base.meta.author = author
  st().loadIntoStore(base)
  const id = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 })
  st().setTag(id, { letters: 'P', loop: '101' })
  return nodeById(id)
}

beforeEach(() => {
  resetQaLive()
  st().loadIntoStore(createEmptyDoc('review ui'))
  navigateWorkspace('draw')
})

describe('the review section', () => {
  it('shows an empty state that says these are not QA findings', async () => {
    const { host } = await mount(<InspectorEngineering node={pump()} />)
    expect(q(host, 'eng-review')).not.toBeNull()
    const empty = text(host, 'eng-review-empty')
    expect(empty).toContain('no severity')
    expect(empty).toContain('Checks')
  })

  it('adds a thread through the store action, attributed to the document author', async () => {
    const node = pump()
    const { host, rerender } = await mount(<InspectorEngineering node={node} />)
    await type(q(host, 'rev-new-body'), 'Design pressure looks low for this duty.')
    await click(q(host, 'rev-add'))

    expect(threads()).toHaveLength(1)
    expect(threads()[0]!.notes[0]).toMatchObject({
      body: 'Design pressure looks low for this duty.',
      by: 'P Nagpure',
    })
    await rerender(<InspectorEngineering node={node} />)
    expect(q(host, 'eng-review-empty')).toBeNull()
    expect(host.textContent).toContain('Design pressure looks low')
  })

  it('will not add a blank comment', async () => {
    const { host } = await mount(<InspectorEngineering node={pump()} />)
    expect((q(host, 'rev-add') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows NO author when nobody is named, rather than inventing one', async () => {
    const node = pump('')
    st().addThread('P-101', 'equipment', 'an unattributed note')
    const { host } = await mount(<InspectorEngineering node={node} />)
    expect(host.textContent).toContain('an unattributed note')
    expect(host.textContent).not.toMatch(/unknown|anonymous/i)
  })

  it('shows the date of each note', async () => {
    const node = pump()
    st().addThread('P-101', 'equipment', 'dated')
    const { host } = await mount(<InspectorEngineering node={node} />)
    expect(host.querySelector('time')!.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('replies in the same thread, in order', async () => {
    const node = pump()
    const { id } = st().addThread('P-101', 'equipment', 'Check the seal plan.')
    const { host } = await mount(<InspectorEngineering node={node} />)
    await click(q(host, `rev-${id}-reply`))
    await type(q(host, `rev-${id}-reply-body`), 'Agreed — API 682 plan 11.')
    await click(q(host, `rev-${id}-reply-send`))

    expect(threads()).toHaveLength(1)
    expect(threads()[0]!.notes.map((n) => n.body)).toEqual(['Check the seal plan.', 'Agreed — API 682 plan 11.'])
  })

  it('resolves and reopens, keeping one thread with one id', async () => {
    const node = pump()
    const { id } = st().addThread('P-101', 'equipment', 'a question')
    const { host, rerender } = await mount(<InspectorEngineering node={node} />)

    await click(q(host, `rev-${id}-resolve`))
    await rerender(<InspectorEngineering node={node} />)
    expect(text(host, `rev-${id}-resolved`)).toContain('Resolved by P Nagpure')
    expect(q(host, `rev-${id}-resolve`)).toBeNull()

    await click(q(host, `rev-${id}-reopen`))
    await rerender(<InspectorEngineering node={node} />)
    expect(threads()).toHaveLength(1)
    expect(threads()[0]!.id).toBe(id)
    expect(q(host, `rev-${id}-resolve`)).not.toBeNull()
  })

  it('counts open threads, and stops counting a resolved one', async () => {
    const node = pump()
    st().addThread('P-101', 'equipment', 'one')
    const { id } = st().addThread('P-101', 'equipment', 'two')
    const { host, rerender } = await mount(<InspectorEngineering node={node} />)
    expect(text(host, 'eng-review-open')).toBe('2 open')

    st().resolveThread('P-101', id!)
    await rerender(<InspectorEngineering node={node} />)
    expect(text(host, 'eng-review-open')).toBe('1 open')
  })

  it('offers NO edit control — a correction is another note', async () => {
    const node = pump()
    const { id } = st().addThread('P-101', 'equipment', 'first wording')
    const { host } = await mount(<InspectorEngineering node={node} />)
    expect(q(host, `rev-${id}-edit`)).toBeNull()
    expect(q(host, `rev-${id}-delete`)).toBeNull()
    expect(host.textContent).not.toMatch(/\bedit\b/i)
  })

  it('never uses QA language, and never claims anything is blocked', async () => {
    const node = pump()
    st().addThread('P-101', 'equipment', 'a note')
    const { host } = await mount(<InspectorEngineering node={node} />)
    const section = q(host, 'eng-review')!.textContent!
    for (const word of [/critical/i, /warning/i, /severity of/i, /blocks/i, /finding/i]) {
      expect(section).not.toMatch(word)
    }
  })

  it('appears on a VALVE too — anything with a record can be reviewed', async () => {
    st().loadIntoStore(createEmptyDoc('review ui'))
    const id = st().addNode({ symbolId: 'valve.gate', kind: 'valve', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters: 'FV', loop: '101' })
    const { host } = await mount(<InspectorEngineering node={nodeById(id)} />)
    expect(q(host, 'eng-review')).not.toBeNull()
    // …and the nozzle schedule does not, which is equipment-only.
    expect(q(host, 'eng-nozzles')).toBeNull()
  })

  it('does NOT appear on an untagged object — there is nowhere to hang it', async () => {
    st().loadIntoStore(createEmptyDoc('review ui'))
    const id = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    const { host } = await mount(<InspectorEngineering node={nodeById(id)} />)
    expect(q(host, 'eng-review')).toBeNull()
    expect(host.textContent).toContain('no tag yet')
  })
})

describe('the Project workspace summary', () => {
  const seed = () => {
    pump()
    st().addThread('P-101', 'equipment', 'one')
    st().addThread('P-101', 'equipment', 'two')
  }

  it('counts unresolved threads and the objects carrying them', async () => {
    seed()
    const { host } = await mount(<ProjectWorkspace />)
    expect(text(host, 'ph-review-open')).toBe('2')
    expect(host.textContent).toContain('on 1 object')
  })

  it('drops the count as threads are resolved', async () => {
    seed()
    const [a] = threads()
    st().resolveThread('P-101', a!.id)
    const { host } = await mount(<ProjectWorkspace />)
    expect(text(host, 'ph-review-open')).toBe('1')
  })

  it('reads zero on a project with no comments, without pretending otherwise', async () => {
    pump()
    const { host } = await mount(<ProjectWorkspace />)
    expect(text(host, 'ph-review-open')).toBe('0')
  })

  it('says it is not QA, right where it sits beside the QA tile', async () => {
    seed()
    const { host } = await mount(<ProjectWorkspace />)
    const note = text(host, 'ph-review-note')
    expect(note).toContain('no severity'.replace(' ', ' '))
    expect(note).toContain('never block an issue')
    expect(note).toContain('Checks')
  })

  it('opens the Data workspace', async () => {
    seed()
    const { host } = await mount(<ProjectWorkspace />)
    await click(q(host, 'ph-review-jump'))
    expect(currentWorkspace()).toBe('data')
  })
})
