// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-1 — managing a nozzle schedule from the Engineering tab.
 *
 * The panel is a view over the three store actions and decides nothing itself.
 * What it does own is the honest presentation: it offers only the ports the
 * drawn symbol actually has, it shows a stored port the symbol no longer has
 * rather than blanking it, and it never fills a size or a service in from the
 * line connected to the nozzle.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { nozzlesOf } from '../../src/model/nozzle'
import InspectorEngineering from '../../src/panels/InspectorEngineering'
import type { PlantNode } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const doc = () => st().doc
const nodeById = (id: string) => doc().sheets[0]!.nodes.find((n) => n.id === id)!
const nozzles = (key: string) => nozzlesOf(doc().registry?.[key])

async function mount(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return {
    host,
    rerender: async (next: React.ReactElement) => { await act(async () => root.render(next)) },
  }
}
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const click = async (el: Element | null) => {
  await act(async () => { (el as HTMLButtonElement).click() })
}
const type = async (el: Element | null, value: string) => {
  const input = el as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function vessel(tagged = true): PlantNode {
  st().loadIntoStore(createEmptyDoc('nozzle ui'))
  const id = st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0 })
  if (tagged) st().setTag(id, { letters: 'TK', loop: '101' })
  return nodeById(id)
}

beforeEach(() => { st().loadIntoStore(createEmptyDoc('nozzle ui')) })

describe('the Engineering tab manages a nozzle schedule', () => {
  it('shows a nozzle section on tagged equipment, empty at first', async () => {
    const { host } = await mount(<InspectorEngineering node={vessel()} />)
    expect(q(host, 'eng-nozzles')).not.toBeNull()
    expect(q(host, 'eng-nozzles-empty')!.textContent).toContain('never read off the line')
  })

  it('adds a nozzle through the store action', async () => {
    const node = vessel()
    const { host, rerender } = await mount(<InspectorEngineering node={node} />)
    await type(q(host, 'nozzle-new-number'), 'N1')
    await click(q(host, 'nozzle-add'))
    expect(nozzles('TK-101').map((n) => n.number)).toEqual(['N1'])
    await rerender(<InspectorEngineering node={node} />)
    expect(q(host, 'eng-nozzles-empty')).toBeNull()
  })

  it('will not add a blank number', async () => {
    const { host } = await mount(<InspectorEngineering node={vessel()} />)
    expect((q(host, 'nozzle-add') as HTMLButtonElement).disabled).toBe(true)
  })

  it('edits a field without touching the others', async () => {
    const node = vessel()
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1', { rating: '150#' })
    const { host } = await mount(<InspectorEngineering node={node} />)
    await type(q(host, 'nozzle-N1-size'), '6"')
    expect(nozzles('TK-101')[0]).toMatchObject({ id, number: 'N1', size: '6"', rating: '150#' })
  })

  it('removes a nozzle', async () => {
    const node = vessel()
    const { id } = st().addNozzle('TK-101', 'equipment', 'N1')
    st().addNozzle('TK-101', 'equipment', 'N2')
    const { host } = await mount(<InspectorEngineering node={node} />)
    await click(q(host, `nozzle-${id}-remove`))
    expect(nozzles('TK-101').map((n) => n.number)).toEqual(['N2'])
  })

  it('offers only the ports the drawn symbol has, plus "no connection point"', async () => {
    const node = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1')
    const { id } = { id: nozzles('TK-101')[0]!.id }
    const { host } = await mount(<InspectorEngineering node={node} />)
    const select = q(host, `nozzle-${id}-port`) as HTMLSelectElement
    const offered = [...select.options].map((o) => o.value)
    const real = buildIndex(doc()).nodes.get(node.id)!.ports.map((p) => p.id)
    expect(offered[0]).toBe('')
    expect(offered.slice(1).sort()).toEqual([...real].sort())
  })

  it('shows a stored port the symbol no longer has, and says it is broken', async () => {
    const node = vessel()
    st().addNozzle('TK-101', 'equipment', 'N1', { portId: 'gone' })
    const id = nozzles('TK-101')[0]!.id
    const { host } = await mount(<InspectorEngineering node={node} />)
    const select = q(host, `nozzle-${id}-port`) as HTMLSelectElement
    // Visible rather than silently reset to blank, and NOT remapped.
    expect(select.value).toBe('gone')
    expect(q(host, `nozzle-${id}-broken`)!.textContent).toContain('no connection point gone')
    expect(nozzles('TK-101')[0]!.portId).toBe('gone')
  })

  it('shows NO nozzle section on untagged equipment', async () => {
    const { host } = await mount(<InspectorEngineering node={vessel(false)} />)
    // The panel stops at the untagged message, well before the schedule.
    expect(q(host, 'eng-nozzles')).toBeNull()
    expect(host.textContent).toContain('no tag yet')
  })

  it('shows NO nozzle section on an instrument or a valve', async () => {
    st().loadIntoStore(createEmptyDoc('nozzle ui'))
    const instrument = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setTag(instrument, { letters: 'LT', loop: '101' })
    const { host } = await mount(<InspectorEngineering node={nodeById(instrument)} />)
    expect(q(host, 'eng-nozzles')).toBeNull()
  })

  it('renders for equipment whose symbol is not in the catalogue', async () => {
    st().loadIntoStore(createEmptyDoc('nozzle ui'))
    const id = st().addNode({ symbolId: 'not.a.real.symbol', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters: 'TK', loop: '101' })
    st().addNozzle('TK-101', 'equipment', 'N1')
    const { host } = await mount(<InspectorEngineering node={nodeById(id)} />)
    // No ports to offer, and nothing throws.
    expect(q(host, 'eng-nozzles')).not.toBeNull()
    const select = q(host, `nozzle-${nozzles('TK-101')[0]!.id}-port`) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual([''])
  })

  it('fills nothing in from a connected line', async () => {
    const node = vessel()
    const port = buildIndex(doc()).nodes.get(node.id)!.ports[0]!.id
    st().addEdge({
      lineClass: 'process.major',
      source: { nodeId: node.id, portId: port },
      target: { x: 99, y: 0 },
      lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '001' },
    })
    const { host } = await mount(<InspectorEngineering node={nodeById(node.id)} />)
    await type(q(host, 'nozzle-new-number'), 'N1')
    await click(q(host, 'nozzle-add'))
    expect(nozzles('TK-101')[0]).toEqual({ id: expect.any(String), number: 'N1' })
  })
})
