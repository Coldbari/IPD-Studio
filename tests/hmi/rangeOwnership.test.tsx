// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The twin of `alarmOwnership.test.tsx`, for range and unit.
 *
 * Step A made the compiled TagDef the one thing every renderer draws with, so
 * `signal.range` and `signal.units` now decide the scale on a bar, the zones on
 * a gauge and the ticks on a faceplate — not just the alarm comparison. A Min
 * or Max field the panel still offered while the record stated a range would be
 * accepted, stored, and inert everywhere.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import { buildTagDefs } from '../../src/hmi/sim/tags'
import HmiPropertyPanel from '../../src/hmi/HmiPropertyPanel'
import type { HmiWidget } from '../../src/hmi/model'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const doc = () => useStore.getState().doc

function seed(props: HmiWidget['props'] = { min: 0, max: 100, unit: '%' }) {
  const base = createEmptyDoc('t')
  const screen = {
    ...createScreen(1), id: 'scr1',
    widgets: [{ id: 'w1', type: 'bar' as const, x: 0, y: 0, w: 56, h: 144, tag: 'PT-101', props }],
  }
  st().loadIntoStore({ ...base, hmiScreens: [screen] })
  st().setActiveScreen('scr1')
}

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<HmiPropertyPanel selection={['w1']} />))
  return host
}

const byTestId = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const labelled = (host: HTMLElement, text: string): HTMLInputElement | null => {
  for (const row of host.querySelectorAll('label')) {
    if (row.querySelector('span')?.textContent === text) return row.querySelector('input')
  }
  return null
}

const tagDef = () => buildTagDefs(doc().hmiScreens, doc().registry).find((d) => d.name === 'PT-101')!

beforeEach(() => {
  document.body.innerHTML = ''
  seed()
})

describe('where the record states a range', () => {
  beforeEach(() => st().setRecordField('PT-101', 'instrument', 'signal.range', '0-10 bar'))

  it('the compiled definition uses it, not the widget', () => {
    expect(tagDef()).toMatchObject({ min: 0, max: 10, unit: 'bar' })
  })

  it('the panel shows it read-only and says where it came from', async () => {
    const host = await mount()
    expect(byTestId(host, 'prop-min-owned')?.textContent).toBe('0')
    expect(byTestId(host, 'prop-max-owned')?.textContent).toBe('10')
    expect(byTestId(host, 'range-owned-note')?.textContent).toContain('PT-101')
    expect(labelled(host, 'Min'), 'no editable Min while the record owns it').toBeNull()
    expect(labelled(host, 'Max')).toBeNull()
  })

  it('an explicit unit field still outranks the one trailing the range', async () => {
    st().setRecordField('PT-101', 'instrument', 'signal.units', 'kPa')
    expect(tagDef().unit).toBe('kPa')
    expect(byTestId(await mount(), 'prop-unit-owned')?.textContent).toBe('kPa')
  })
})

describe('where the record is silent', () => {
  it('Min, Max and Unit stay editable and still take effect', async () => {
    const host = await mount()
    expect(byTestId(host, 'range-owned-note')).toBeNull()
    const max = labelled(host, 'Max')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(max, '250')
      max.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(doc().hmiScreens[0]!.widgets[0]!.props?.max).toBe(250)
    expect(tagDef().max).toBe(250)
  })

  it('a unit stated only on the widget is still the answer', () => {
    expect(tagDef().unit).toBe('%')
  })

  it('a record that states no range leaves the widget in charge', () => {
    st().setRecordField('PT-101', 'instrument', 'general.service', 'Instrument air')
    expect(tagDef().max).toBe(100)
  })
})

describe('a range the parser cannot read is not silently replaced', () => {
  it('falls back to the widget rather than inventing 0-100', () => {
    st().setRecordField('PT-101', 'instrument', 'signal.range', 'see datasheet')
    // `range-unreadable` reports it; the compiled def keeps the widget's values
    expect(tagDef()).toMatchObject({ min: 0, max: 100 })
  })
})
