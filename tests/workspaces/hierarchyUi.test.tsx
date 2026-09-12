// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { LEGACY_AREA_FIELD } from '../../src/model/hierarchy'
import AreasDialog from '../../src/panels/AreasDialog'
import DataWorkspace from '../../src/workspaces/DataWorkspace'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const doc = () => useStore.getState().doc
const st = () => useStore.getState()

async function mount(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return host
}

function byTestId(host: HTMLElement, testid: string, tagName?: string): HTMLElement | null {
  for (const el of host.querySelectorAll('[data-testid]')) {
    if (el.getAttribute('data-testid') !== testid) continue
    if (tagName && el.tagName !== tagName) continue
    return el as HTMLElement
  }
  return null
}

const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}

/** React listens for `input`/`change` delegated from the document, so the
 *  value has to be set through the native setter first. */
async function setValue(el: HTMLElement | null, value: string) {
  expect(el, 'element to set').toBeTruthy()
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

/** Two tagged instruments with records, so the Data workspace has rows. */
function seed() {
  st().loadIntoStore(createEmptyDoc('t'))
  for (const [letters, loop] of [['LT', '101'], ['PT', '200']] as const) {
    const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters, loop })
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  seed()
})

/* ------------------------------------------------------------- 13, 14, 16 */

describe('the Areas & units dialog', () => {
  const open = () => mount(<AreasDialog onClose={() => {}} />)

  it('13: creates an area', async () => {
    const host = await open()
    await click(byTestId(host, 'area-add'))
    expect(doc().areas).toHaveLength(1)
    const id = doc().areas![0]!.id
    await setValue(byTestId(host, `area-code-${id}`), '100')
    expect(doc().areas![0]!.code).toBe('100')
  })

  it('14: creates a unit under that area', async () => {
    const host = await open()
    await click(byTestId(host, 'area-add'))
    const areaId = doc().areas![0]!.id
    await click(byTestId(host, `unit-add-${areaId}`))
    expect(doc().units).toHaveLength(1)
    expect(doc().units![0]!.areaId).toBe(areaId)
  })

  it('16: renames an area and a unit without breaking the assignment', async () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    const host = await open()
    await setValue(byTestId(host, `area-code-${areaId}`), '200')
    await setValue(byTestId(host, `unit-code-${unitId}`), 'U-102')
    await setValue(byTestId(host, `unit-name-${unitId}`), 'Reactor feed')
    expect(doc().areas![0]!.code).toBe('200')
    expect(doc().units![0]!.code).toBe('U-102')
    expect(doc().units![0]!.name).toBe('Reactor feed')
    expect(doc().registry!['LT-101']!.unitId).toBe(unitId)
  })

  it('shows the area → unit relationship, and how many objects hang off each unit', async () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    const host = await open()
    const area = byTestId(host, `area-${areaId}`)
    // the unit is rendered INSIDE its area, which is the relationship
    expect(area!.querySelector(`[data-testid="unit-${unitId}"]`)).toBeTruthy()
    expect(area!.querySelector('.areas-count')!.textContent).toBe('1')
  })

  it('warns what a delete will clear, and does nothing when declined', async () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    const host = await open()
    await click(byTestId(host, `area-del-${areaId}`))
    expect(confirmSpy.mock.calls[0]![0]).toContain('unassigns 1 object')
    expect(doc().areas).toHaveLength(1)
    confirmSpy.mockReturnValue(true)
    await click(byTestId(host, `area-del-${areaId}`))
    expect(doc().areas).toHaveLength(0)
    expect(doc().registry!['LT-101']!.unitId).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('offers the legacy mapping only for values that match a unit exactly', async () => {
    st().setRecordField('LT-101', 'instrument', LEGACY_AREA_FIELD, 'U-101')
    st().setRecordField('PT-200', 'instrument', LEGACY_AREA_FIELD, 'Reactor')
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    const host = await open()
    expect(byTestId(host, 'areas-unmapped')!.textContent).toContain('PT-200')
    await click(byTestId(host, 'areas-map-legacy'))
    expect(doc().registry!['LT-101']!.unitId).toBe(unitId)
    expect(doc().registry!['PT-200']!.unitId).toBeUndefined()
    // and the free text is untouched either way
    expect(doc().registry!['PT-200']!.fields[LEGACY_AREA_FIELD]).toBe('Reactor')
  })
})

/* ------------------------------------------------------------- 15, 17, 18 */

describe('the Data workspace', () => {
  it('15: assigns a unit from the table, writing the stable id', async () => {
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    const host = await mount(<DataWorkspace />)
    const sel = byTestId(host, 'unit-LT-101') as HTMLSelectElement
    expect(sel).toBeTruthy()
    await setValue(sel, unitId)
    expect(doc().registry!['LT-101']!.unitId).toBe(unitId)
  })

  it('15: shows the area beside it, read-only', async () => {
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    const host = await mount(<DataWorkspace />)
    const row = (byTestId(host, 'unit-LT-101') as HTMLElement).closest('tr')!
    const cells = [...row.querySelectorAll('td')].map((c) => c.textContent)
    expect(cells).toContain('100')
    // and there is no control for it — the area follows the unit
    expect(row.querySelectorAll('select')).toHaveLength(1)
  })

  it('clears an assignment back to nothing', async () => {
    const unitId = st().addUnit(st().addArea('100'), 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    const host = await mount(<DataWorkspace />)
    await setValue(byTestId(host, 'unit-LT-101'), '')
    expect(doc().registry!['LT-101']!.unitId).toBeUndefined()
  })

  it('17: filters by area', async () => {
    const areaId = st().addArea('100')
    const other = st().addArea('200')
    const unitId = st().addUnit(areaId, 'U-101')
    st().addUnit(other, 'U-201')
    st().assignUnit('LT-101', 'instrument', unitId)
    const host = await mount(<DataWorkspace />)
    const rows = () => byTestId(host, 'data-table-instruments')!.querySelectorAll('tbody tr').length
    expect(rows()).toBe(2)
    await setValue(byTestId(host, 'data-filter-area'), areaId)
    expect(rows()).toBe(1)
    await setValue(byTestId(host, 'data-filter-area'), other)
    expect(rows()).toBe(0)
    // 21, restated for the table: the unassigned rows are findable, not hidden
    await setValue(byTestId(host, 'data-filter-area'), '__none')
    expect(rows()).toBe(1)
  })

  it('18: filters by unit', async () => {
    const areaId = st().addArea('100')
    const u1 = st().addUnit(areaId, 'U-101')
    const u2 = st().addUnit(areaId, 'U-102')
    st().assignUnit('LT-101', 'instrument', u1)
    st().assignUnit('PT-200', 'instrument', u2)
    const host = await mount(<DataWorkspace />)
    const rows = () => byTestId(host, 'data-table-instruments')!.querySelectorAll('tbody tr').length
    await setValue(byTestId(host, 'data-filter-unit'), u1)
    expect(rows()).toBe(1)
    await setValue(byTestId(host, 'data-filter-unit'), u2)
    expect(rows()).toBe(1)
    await setValue(byTestId(host, 'data-filter-unit'), '__none')
    expect(rows()).toBe(0)
  })

  it('hides the filters entirely until a hierarchy exists', async () => {
    const host = await mount(<DataWorkspace />)
    expect(byTestId(host, 'data-filter-area')).toBeNull()
    expect(byTestId(host, 'data-filter-unit')).toBeNull()
  })
})
