// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-2 — the Nozzle schedule in the Data workspace.
 *
 * The claims that matter on screen: several nozzles on ONE vessel render as
 * several rows without React complaining about duplicate keys, no cell is
 * editable, and a project with no nozzles says so rather than looking broken.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import DataWorkspace from '../../src/workspaces/DataWorkspace'
import type { PlantNode } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

async function mount(): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<DataWorkspace />))
  return host
}

const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const openNozzles = async (host: HTMLElement) => click(q(host, 'data-tab-nozzles'))

const vessel = (id: string, loop: string): PlantNode =>
  ({ id, symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0, tag: { letters: 'TK', loop } })

/** A project with one vessel carrying `numbers`, plus an untouched second one. */
function seed(numbers: string[], extra = true) {
  const doc = createEmptyDoc('Nozzles')
  doc.sheets[0]!.nodes = extra ? [vessel('a', '101'), vessel('b', '102')] : [vessel('a', '101')]
  useStore.getState().loadIntoStore(doc)
  for (const n of numbers) useStore.getState().addNozzle('TK-101', 'equipment', n)
  if (extra) useStore.getState().setRecordField('TK-102', 'equipment', 'general.service', 'Spare')
}

beforeEach(() => {
  useStore.getState().loadIntoStore(createEmptyDoc('Nozzles'))
})

describe('the Nozzle schedule tab', () => {
  it('is present, and counts the nozzles rather than the equipment', async () => {
    seed(['N1', 'N2', 'N3'])
    const host = await mount()
    expect(q(host, 'data-tab-nozzles')!.textContent).toContain('Nozzle schedule')
    expect(q(host, 'data-tab-nozzles')!.textContent).toContain('3')
  })

  it('renders one row per nozzle from ONE drawn vessel, with no duplicate-key warning', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    seed(['N1', 'N2', 'N3'])
    const host = await mount()
    await openNozzles(host)
    const rows = q(host, 'data-table-nozzles')!.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    // React logs "Encountered two children with the same key" through
    // console.error. Three rows off one node id is exactly that case.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('same key')
    warn.mockRestore()
  })

  it('shows the nozzle numbers and their status', async () => {
    seed(['N1'])
    const host = await mount()
    await openNozzles(host)
    const text = q(host, 'data-table-nozzles')!.textContent!
    expect(text).toContain('TK-101')
    expect(text).toContain('N1')
    expect(text).toContain('not located')
  })

  it('has NO editable cell — nozzles are entered on the Engineering tab', async () => {
    seed(['N1'])
    const host = await mount()
    await openNozzles(host)
    const table = q(host, 'data-table-nozzles')!
    expect(table.querySelectorAll('.ws-cell-btn')).toHaveLength(0)
    expect(table.querySelectorAll('.ws-cell-sel')).toHaveLength(0)
  })

  it('says the equipment carrying no nozzles was left out, so an exclusion is not an omission', async () => {
    seed(['N1'])
    const host = await mount()
    await openNozzles(host)
    expect(q(host, 'data-excluded')!.textContent).toContain('1 equipment record has no nozzles')
  })

  it('renders an explanation rather than an empty table when nothing is entered', async () => {
    seed([])
    const host = await mount()
    await openNozzles(host)
    expect(q(host, 'data-table-nozzles')).toBeNull()
    expect(host.querySelector('.ws-empty')!.textContent).toContain('not a connection point on a symbol')
  })

  it('filters by text like every other report', async () => {
    seed(['N1', 'N2'])
    const host = await mount()
    await openNozzles(host)
    const input = q(host, 'data-filter') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'N2')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(q(host, 'data-table-nozzles')!.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('keeps the nozzle when the vessel is deleted', async () => {
    seed(['N1'], false)
    useStore.getState().deleteIds(['a'])
    const host = await mount()
    await openNozzles(host)
    const text = q(host, 'data-table-nozzles')!.textContent!
    expect(text).toContain('N1')
    expect(text).toContain('not drawn')
  })
})
