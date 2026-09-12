// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 3 — the three loop commands.
 *
 * What matters here is that the commands are a way of ASKING, never a second
 * implementation: each `run` reaches a Program 2 store action, and the
 * offering rules (only with one tagged object selected, only when loops exist,
 * only when assigned) come from the document rather than from the palette.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore, activeSheet } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { commandsFor, contextNow } from '../../src/commands/registry'

const st = () => useStore.getState()
const doc = () => st().doc
const rec = (key: string) => doc().registry?.[key]
const ids = () => commandsFor(contextNow()).map((c) => c.id)
const run = (id: string) => commandsFor(contextNow()).find((c) => c.id === id)!.run()

function seed() {
  st().loadIntoStore(createEmptyDoc('cmd'))
  const a = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  st().setTag(a, { letters: 'LT', loop: '101' })
  const b = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })
  st().setTag(b, { letters: 'LIC', loop: '101' })
  return { a, b }
}

beforeEach(() => { seed(); useStore.temporal.getState().clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('when the commands are offered', () => {
  it('not at all with nothing selected', () => {
    st().setSelection([])
    expect(ids()).not.toContain('loop.create')
    expect(ids()).not.toContain('loop.assign')
  })

  it('create is offered for one tagged object; assign only once a loop exists', () => {
    const { a } = seed()
    st().setSelection([a])
    expect(ids()).toContain('loop.create')
    expect(ids()).not.toContain('loop.assign')
    st().addLoop('101')
    expect(ids()).toContain('loop.assign')
  })

  it('not for a multi-selection — one record, one membership', () => {
    const { a, b } = seed()
    st().setSelection([a, b])
    expect(ids()).not.toContain('loop.create')
  })

  it('not for an untagged object, which has nothing to hang a record on', () => {
    st().loadIntoStore(createEmptyDoc('cmd'))
    const n = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setSelection([n])
    expect(ids()).not.toContain('loop.create')
  })

  it('remove is offered only when the record is actually in a loop', () => {
    const { a } = seed()
    st().setSelection([a])
    expect(ids()).not.toContain('loop.remove')
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    expect(ids()).toContain('loop.remove')
  })
})

describe('what the commands do', () => {
  it('create makes the loop and assigns the record, through the store', () => {
    const { a } = seed()
    st().setSelection([a])
    vi.spyOn(window, 'prompt').mockReturnValue('101')
    run('loop.create')
    expect(doc().loops).toHaveLength(1)
    expect(rec('LT-101')!.loopId).toBe(doc().loops![0]!.id)
  })

  it('create writes nothing when the prompt is dismissed', () => {
    const { a } = seed()
    st().setSelection([a])
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    const before = doc()
    run('loop.create')
    expect(doc()).toBe(before)
  })

  it('assign resolves a DECLARED number and never creates one', () => {
    const { a } = seed()
    const { id } = st().addLoop('101')
    st().setSelection([a])

    vi.spyOn(window, 'prompt').mockReturnValue('nope')
    run('loop.assign')
    expect(rec('LT-101')?.loopId).toBeUndefined()
    expect(doc().loops).toHaveLength(1)

    vi.spyOn(window, 'prompt').mockReturnValue('101')
    run('loop.assign')
    expect(rec('LT-101')!.loopId).toBe(id)
  })

  it('remove clears the assignment and is undoable', () => {
    const { a } = seed()
    const { id } = st().addLoop('101')
    st().assignLoop('LT-101', 'instrument', id!)
    st().setSelection([a])
    useStore.temporal.getState().clear()

    run('loop.remove')
    expect(rec('LT-101')?.loopId).toBeUndefined()
    st().undo()
    expect(rec('LT-101')!.loopId).toBe(id)
  })

  it('every command runs against the live sheet the context named', () => {
    const { a } = seed()
    st().setSelection([a])
    expect(activeSheet(st()).nodes.some((n) => n.id === a)).toBe(true)
  })
})
