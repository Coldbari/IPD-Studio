// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP D — one equipment state machine, and the alarms that were missing.
 *
 * The audit found the same state expression written out three times (the
 * faceplate, the pump widget, the equipment widget), no STOPPING state at all,
 * and — worst — a tripped pump that stopped, journaled its command, and
 * annunciated nothing whatsoever.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { EQUIP_LABEL, equipmentState, isTurning } from '../../src/hmi/sim/state'
import type { EquipState } from '../../src/hmi/sim/state'
import { alarmMessage } from '../../src/hmi/sim/alarms'
import { renderWidget } from '../../src/hmi/widgets/index'
import { useSimStore } from '../../src/hmi/simStore'
import Faceplate from '../../src/hmi/Faceplate'
import { THEMES } from '../../src/hmi/theme'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const theme = THEMES.classic

// source -> P-1 -> HV-1 -> TK-1, with LT-1 reading the tank
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v', type: 'valve', x: 260, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 1e6, level0: 40 } },
    { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-1', props: { bindTank: 'TK-1' } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 270, y: 116 }] },
    { id: 'e3', points: [{ x: 300, y: 116 }, { x: 510, y: 100 }] },
  ],
}
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!
const sim = () => useSimStore.getState()
const tick = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(0.2) }
const stateOf = (tag: string) => equipmentState(sim().tags[tag])
const alarmIds = () => sim().alarms.map((a) => a.id).sort()

beforeEach(() => {
  document.body.innerHTML = ''
  sim().exitRun()
  sim().enterRun(screen)
})

describe('the state machine', () => {
  it('walks STOPPED -> STARTING -> RUNNING on a start command', () => {
    expect(stateOf('P-1')).toBe('stopped')
    sim().writeTag('P-1', 'RUN', 1)
    tick(1)
    expect(stateOf('P-1')).toBe('starting')
    tick(15)
    expect(stateOf('P-1')).toBe('running')
  })

  it('walks RUNNING -> STOPPING -> STOPPED on a stop command — the state the audit found missing', () => {
    sim().writeTag('P-1', 'RUN', 1)
    tick(15)
    sim().writeTag('P-1', 'RUN', 0)
    tick(1)
    expect(stateOf('P-1')).toBe('stopping')
    tick(20)
    expect(stateOf('P-1')).toBe('stopped')
  })

  it('a coasting pump still moves liquid; a tripped one does not', () => {
    sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('HV-1', 'OP', 100)
    tick(20)
    const running = Math.max(...Object.values(sim().pipeFlows))
    expect(running).toBeGreaterThan(0)

    sim().writeTag('P-1', 'RUN', 0)
    tick(2)
    expect(stateOf('P-1')).toBe('stopping')
    const coasting = Math.max(...Object.values(sim().pipeFlows))
    expect(coasting).toBeGreaterThan(0)
    expect(coasting).toBeLessThan(running)

    // a trip opens the breaker: delivery goes immediately, not by coasting
    sim().reset()
    sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('HV-1', 'OP', 100)
    tick(20)
    sim().writeTag('P-1', 'FAULT', 1)
    tick(1)
    expect(stateOf('P-1')).toBe('tripped')
    expect(Math.max(...Object.values(sim().pipeFlows))).toBe(0)
  })

  it('a trip outranks the run command, and out of service outranks everything', () => {
    expect(equipmentState({ RUN: 1, RAMP: 1, FAULT: 1 })).toBe('tripped')
    expect(equipmentState({ RUN: 1, RAMP: 1 }, { oos: true })).toBe('disabled')
    expect(equipmentState({ RUN: 1, RAMP: 1, FAULT: 1 }, { oos: true })).toBe('disabled')
  })

  it('every state has a word, and only the moving ones turn', () => {
    const all: EquipState[] = ['stopped', 'starting', 'running', 'stopping', 'tripped', 'disabled']
    for (const s of all) expect(EQUIP_LABEL[s]).toBeTruthy()
    expect(all.filter(isTurning)).toEqual(['starting', 'running', 'stopping'])
  })
})

describe('the mimic reports state in words, not colour alone', () => {
  const draw = (widget: HmiWidget, values: Record<string, number>, oos = false) =>
    renderToStaticMarkup(<svg>{renderWidget({ widget, theme, sim: values, oos })}</svg>)

  it('the pump widget prints its state and tags the element with it', () => {
    const html = draw(w('p'), { RUN: 1, RAMP: 0.4 })
    expect(html).toContain('data-state="starting"')
    expect(html).toContain('STARTING')
  })

  it('a disabled drive reads DISABLED rather than looking merely stopped', () => {
    expect(draw(w('p'), { RUN: 1, RAMP: 1 }, true)).toContain('DISABLED')
  })

  it('the equipment widget uses the identical machine', () => {
    const eq: HmiWidget = { id: 'e', type: 'equip', x: 0, y: 0, w: 64, h: 64, tag: 'C-1', props: { symbolId: 'blower' } }
    expect(draw(eq, { RUN: 0, RAMP: 0.5 })).toContain('data-state="stopping"')
  })
})

describe('a tripped drive annunciates', () => {
  it('raises a high-priority TRIP alarm the banner can show', () => {
    expect(alarmIds()).not.toContain('P-1:TRIP')
    sim().writeTag('P-1', 'FAULT', 1)
    tick(1)
    const trip = sim().alarms.find((a) => a.id === 'P-1:TRIP')!
    expect(trip).toBeDefined()
    expect(trip.priority).toBe('high')
    expect(alarmMessage(trip)).toMatch(/reset required/i)
  })

  it('clears when the trip is reset, and acks like any other alarm', () => {
    sim().writeTag('P-1', 'FAULT', 1)
    tick(1)
    sim().ack('P-1:TRIP')
    expect(sim().alarms.find((a) => a.id === 'P-1:TRIP')!.phase).toBe('acked')
    sim().writeTag('P-1', 'FAULT', 0)
    tick(1)
    expect(alarmIds()).not.toContain('P-1:TRIP')
  })

  it('the trip appears in the journal as an event, not just a command', () => {
    sim().writeTag('P-1', 'FAULT', 1)
    tick(1)
    expect(sim().journal.some((e) => e.what === 'ALARM' && e.tag === 'P-1')).toBe(true)
  })
})

describe('an invalid instrument annunciates too', () => {
  it('raises a BAD diagnostic alarm distinct from any process alarm', () => {
    sim().writeTag('LT-1', 'BAD', 1)
    tick(1)
    const bad = sim().alarms.find((a) => a.id === 'LT-1:BAD')!
    expect(bad.priority).toBe('medium')
    expect(alarmMessage(bad)).toMatch(/not valid/i)
    sim().writeTag('LT-1', 'BAD', 0)
    tick(1)
    expect(sim().alarms.find((a) => a.id === 'LT-1:BAD')!.phase).toBe('cleared')
  })
})

describe('limit alarms now carry what they tripped against', () => {
  it('reads as a sentence with both numbers and the unit', () => {
    const screen2: HmiScreen = {
      id: 's2', name: 'S2', theme: 'classic',
      widgets: [{ id: 'd', type: 'display', x: 0, y: 0, w: 96, h: 40, tag: 'PT-1', props: { min: 0, max: 60, unit: 'bar', H: 50, base: 55 } }],
      pipes: [],
    }
    sim().exitRun()
    sim().enterRun(screen2)
    tick(1)
    const a = sim().alarms.find((x) => x.id === 'PT-1:H')!
    expect(a.limit).toBe(50)
    expect(a.unit).toBe('bar')
    expect(alarmMessage(a)).toMatch(/^5[0-9.]+ bar above 50 bar$/)
  })
})

describe('the faceplate reads from the same machine', () => {
  it('shows STOPPING while the pump coasts, and offers a trip reset only when tripped', async () => {
    sim().writeTag('P-1', 'RUN', 1)
    tick(15)
    sim().writeTag('P-1', 'RUN', 0)
    tick(1)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<Faceplate widget={w('p')} onClose={() => {}} />))
    expect(host.querySelector('.fp-state')!.getAttribute('data-state')).toBe('stopping')
    expect(host.querySelector('[data-testid="fp-fault-reset"]')).toBeNull()

    await act(async () => sim().writeTag('P-1', 'FAULT', 1))
    expect(host.querySelector('.fp-state')!.textContent).toBe('TRIPPED')
    expect(host.querySelector('[data-testid="fp-fault-reset"]')).not.toBeNull()
  })
})
