// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The HMI panel must not offer a control that does nothing.
 *
 * P1-A made the registry authoritative for alarm limits and priority, but this
 * panel went on presenting them as ordinary editable widget properties. An
 * engineer could type `H = 80`, watch it save, and have the run keep using the
 * record's 95 — accepted, stored, and silently inert. These tests hold the
 * line that where the record speaks, the panel says so and stops pretending.
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

const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget =>
  ({ x: 0, y: 0, w: 64, h: 64, ...w })

/** One display widget on LT-101 carrying legacy alarm values of its own. */
function seed(props: HmiWidget['props'] = { LL: 5, L: 10, H: 80, HH: 95, deadband: 2, alarmDelay: 3, priority: 'low' }) {
  const base = createEmptyDoc('t')
  const screen = { ...createScreen(1), id: 'scr1', widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101', props })] }
  st().loadIntoStore({ ...base, hmiScreens: [screen] })
  st().setActiveScreen('scr1')
}

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => { await act(async () => root.render(<HmiPropertyPanel selection={['w1']} />)) }
  await render()
  return { host, render }
}

const byTestId = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const labelled = (host: HTMLElement, text: string): HTMLInputElement | null => {
  for (const row of host.querySelectorAll('label')) {
    if (row.querySelector('span')?.textContent === text) return row.querySelector('input')
  }
  return null
}

const tagDef = () => buildTagDefs(doc().hmiScreens, doc().registry).find((d) => d.name === 'LT-101')!

beforeEach(() => {
  document.body.innerHTML = ''
  seed()
})

describe('1. the registry wins over a conflicting widget value', () => {
  it('the effective alarm limit is the record, not the widget', () => {
    expect(tagDef().limits?.H).toBe(80) // widget value, while the record is silent
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '95')
    expect(tagDef().limits?.H).toBe(95)
    // and the widget's own value is left exactly where it was — not migrated,
    // not deleted, just no longer the answer
    expect(doc().hmiScreens[0]!.widgets[0]!.props?.H).toBe(80)
  })

  it('priority too', () => {
    st().setRecordField('LT-101', 'instrument', 'alarm.priority', 'high')
    expect(tagDef().priority).toBe('high')
    expect(doc().hmiScreens[0]!.widgets[0]!.props?.priority).toBe('low')
  })
})

describe('2. the panel says so', () => {
  it('an overridden limit is read-only and shows the record value', async () => {
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '95')
    const { host } = await mount()
    const owned = byTestId(host, 'prop-H-owned')
    expect(owned, 'H should render as overridden').toBeTruthy()
    expect(owned!.textContent).toBe('95')
    // no editable input for H any more
    expect(labelled(host, 'H')).toBeNull()
  })

  it('explains where the value comes from and offers a way to change it', async () => {
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '95')
    const { host } = await mount()
    const note = byTestId(host, 'alarm-owned-note')
    expect(note).toBeTruthy()
    expect(note!.textContent).toContain('engineering record')
    expect(note!.textContent).toContain('LT-101')
    expect(byTestId(host, 'alarm-open-record')).toBeTruthy()
  })

  it('an overridden priority is read-only too', async () => {
    st().setRecordField('LT-101', 'instrument', 'alarm.priority', 'high')
    const { host } = await mount()
    expect(byTestId(host, 'prop-priority-owned')!.textContent).toBe('high')
    expect(byTestId(host, 'prop-priority')).toBeNull()
  })

  it('limits the record is silent about stay editable, per value', async () => {
    // Only H is owned; LL/L/HH are still the widget's business.
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '95')
    const { host } = await mount()
    expect(byTestId(host, 'prop-H-owned')).toBeTruthy()
    for (const k of ['LL', 'L', 'HH']) {
      expect(labelled(host, k), `${k} should still be editable`).toBeTruthy()
      expect(byTestId(host, `prop-${k}-owned`)).toBeNull()
    }
  })
})

describe('3. editing the engineering value changes the effective value', () => {
  it('a record edit moves what the simulator will use, and what the panel shows', async () => {
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '95')
    const { host, render } = await mount()
    expect(byTestId(host, 'prop-H-owned')!.textContent).toBe('95')
    expect(tagDef().limits?.H).toBe(95)

    await act(async () => { st().setRecordField('LT-101', 'instrument', 'alarm.H', '70') })
    await render()
    expect(byTestId(host, 'prop-H-owned')!.textContent).toBe('70')
    expect(tagDef().limits?.H).toBe(70)
  })

  it('clearing the record hands the legacy widget value back', async () => {
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '95')
    expect(tagDef().limits?.H).toBe(95)
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '')
    const { host } = await mount()
    expect(tagDef().limits?.H).toBe(80)
    expect(labelled(host, 'H')).toBeTruthy()
    expect(byTestId(host, 'prop-H-owned')).toBeNull()
  })
})

describe('4. a legacy project with no registry alarm values behaves exactly as before', () => {
  it('every limit is editable and the widget values are what run', async () => {
    const { host } = await mount()
    expect(byTestId(host, 'alarm-owned-note')).toBeNull()
    for (const k of ['LL', 'L', 'H', 'HH']) {
      expect(labelled(host, k), k).toBeTruthy()
      expect(byTestId(host, `prop-${k}-owned`)).toBeNull()
    }
    expect(byTestId(host, 'prop-priority')).toBeTruthy()
    expect(tagDef().limits).toEqual({ LL: 5, L: 10, H: 80, HH: 95 })
    expect(tagDef().priority).toBe('low')
  })

  it('a widget with nothing set invents no limits', async () => {
    seed({})
    expect(tagDef().limits).toBeUndefined()
  })

  it('editing a legacy limit still works and still takes effect', async () => {
    const { host } = await mount()
    const input = labelled(host, 'H')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '85')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(doc().hmiScreens[0]!.widgets[0]!.props?.H).toBe(85)
    expect(tagDef().limits?.H).toBe(85)
  })
})

describe('deadband and on-delay remain HMI-owned', () => {
  it('they stay editable even when every alarm limit is owned by the record', async () => {
    for (const [k, v] of [['alarm.LL', '1'], ['alarm.L', '2'], ['alarm.H', '8'], ['alarm.HH', '9'], ['alarm.priority', 'high']]) {
      st().setRecordField('LT-101', 'instrument', k!, v!)
    }
    const { host } = await mount()
    expect(labelled(host, 'Deadband'), 'deadband stays HMI-owned').toBeTruthy()
    expect(labelled(host, 'On-delay s'), 'on-delay stays HMI-owned').toBeTruthy()
  })

  it('and the registry has no field for them, so the widget is still the source', () => {
    expect(tagDef().deadband).toBe(2)
    expect(tagDef().alarmDelay).toBe(3)
  })
})
