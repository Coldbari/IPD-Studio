// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP H — the faceplate, per equipment type.
 *
 * One structure, adapted content. A pump's plate carries a command and no
 * setpoint; a transmitter's carries a range and no start button. These pin
 * that adaptation, the mode indication, and the states an operator must be
 * able to tell apart without opening anything else.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useSimStore } from '../../src/hmi/simStore'
import Faceplate from '../../src/hmi/Faceplate'
import { THEMES } from '../../src/hmi/theme'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'PV-101', props: { throttle: true } },
    { id: 'hv', type: 'valve', x: 380, y: 95, w: 48, h: 32, tag: 'HV-101' },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { level0: 40 } },
    { id: 'pt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'PT-101', props: { bindPipe: 'e2' } },
    { id: 'pic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'PIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
}
const registry: Registry = {
  'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'construction.volume': '50 m³' } },
}
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!
const sim = () => useSimStore.getState()
const tick = (n: number, dt = 1) => { for (let i = 0; i < n; i++) sim().tickOnce(dt) }

async function plate(widget: HmiWidget, theme: 'classic' | 'hp' = 'classic') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Faceplate widget={widget} theme={theme} onClose={() => {}} />))
  return host
}
const has = (h: HTMLElement, id: string) => h.querySelector(`[data-testid="${id}"]`)

beforeEach(() => {
  document.body.innerHTML = ''
  sim().exitRun()
  sim().enterRun(screen, registry)
})

describe('a pump plate', () => {
  it('shows identity, state and a command — and no setpoint', async () => {
    const host = await plate(w('p'))
    expect(host.getAttribute.call(host.querySelector('[data-testid="faceplate"]')!, 'data-kind')).toBe('motor')
    expect(host.textContent).toContain('P-101')
    expect(host.querySelector('.fp-state')!.textContent).toBe('STOPPED')
    expect(has(host, 'fp-start')).not.toBeNull()
    expect(has(host, 'fp-stop')).not.toBeNull()
    expect(has(host, 'fp-sp'), 'a pump has no setpoint').toBeNull()
    expect(has(host, 'fp-range'), 'a pump has no instrument range').toBeNull()
  })

  it('the issued command is the one shown as selected', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    tick(10)
    const host = await plate(w('p'))
    expect(has(host, 'fp-start')!.className).toContain('on')
    expect(has(host, 'fp-stop')!.className).not.toContain('on')
  })

  it('a trip is unmistakable and offers its reset', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    tick(10)
    sim().writeTag('P-101', 'FAULT', 1)
    tick(1)
    const host = await plate(w('p'))
    const state = host.querySelector('.fp-state')!
    expect(state.textContent).toBe('TRIPPED')
    expect(state.getAttribute('data-state')).toBe('tripped')
    expect(has(host, 'fp-fault-reset')).not.toBeNull()
  })

  it('out of service is distinct from a healthy stopped pump', async () => {
    const stopped = await plate(w('p'))
    expect(stopped.querySelector('.fp-state')!.textContent).toBe('STOPPED')
    expect(has(stopped, 'fp-oos')).toBeNull()

    document.body.innerHTML = ''
    sim().toggleOos('P-101')
    const disabled = await plate(w('p'))
    expect(disabled.querySelector('.fp-state')!.textContent).toBe('DISABLED')
    expect(has(disabled, 'fp-oos')).not.toBeNull()
  })
})

describe('a control-valve plate', () => {
  it('shows command, position and its output control', async () => {
    sim().writeTag('PV-101', 'OP', 70)
    tick(5)
    const host = await plate(w('v'))
    expect(has(host, 'fp-v-command')).not.toBeNull()
    expect(has(host, 'fp-v-position')).not.toBeNull()
    expect(has(host, 'fp-op')).not.toBeNull()
    expect(host.querySelector('.fp-state')!.textContent).toMatch(/% OPEN/)
    expect(has(host, 'fp-start'), 'a valve is not started').toBeNull()
  })

  it('reports deviation when the position is not following the command', async () => {
    // PIC-101 drives PV-101, so the COMMAND has to come from the loop — a
    // write straight to the valve's OP is overwritten on the next tick. In
    // MANUAL the operator's output is the command, which is what this test
    // means by one.
    //
    // It used to write to the valve directly and still pass, because a
    // controller-driven valve was seeded 40 % open at RUN and the controller
    // then drove its output away from that: the deviation came from the seed,
    // not from the stuck valve. That seed is gone (K3.3, Finding 3) — every
    // throttling valve now starts shut — so the fixture has to state the
    // command it means.
    sim().writeTag('PIC-101', 'MODE', 0)
    sim().writeTag('PV-101', 'STUCK', 1) // jammed at 0 %
    sim().writeTag('PIC-101', 'OP', 100) // ...while being told to open fully
    tick(10)
    const host = await plate(w('v'))
    expect(sim().tags['PV-101']!.POS).toBe(0)   // it really did not move
    expect(sim().tags['PV-101']!.DEVT!).toBeGreaterThan(0)
    expect(has(host, 'fp-v-deviation')).not.toBeNull()
  })

  it('a hand valve gets OPEN and CLOSE, and shows which it is', async () => {
    const host = await plate(w('hv'))
    expect(has(host, 'fp-open')).not.toBeNull()
    expect(has(host, 'fp-shut')).not.toBeNull()
    expect(host.querySelector('.fp-state')!.textContent).toMatch(/OPEN|CLOSED/)
  })
})

describe('a controller plate', () => {
  it('shows PV, SP and OUT with the mode unmissable', async () => {
    const host = await plate(w('pic'))
    expect(host.textContent).toContain('PV')
    expect(host.textContent).toContain('SP')
    expect(host.textContent).toContain('OUT')
    // the mode is a pair of full-width buttons, the selected one filled —
    // never a small coloured dot
    const auto = has(host, 'fp-auto')!
    const man = has(host, 'fp-man')!
    expect(auto.textContent).toBe('AUTO')
    expect(man.textContent).toBe('MANUAL')
    expect(auto.className).toContain('on')
    expect(auto.getAttribute('aria-pressed')).toBe('true')
    expect(man.className).not.toContain('on')
  })

  it('switching to MANUAL moves the selected state with it', async () => {
    sim().writeTag('PIC-101', 'MODE', 0)
    const host = await plate(w('pic'))
    expect(has(host, 'fp-man')!.className).toContain('on')
    expect(has(host, 'fp-auto')!.className).not.toContain('on')
    expect(has(host, 'fp-man')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('output entry is available in MANUAL and locked in AUTO', async () => {
    const auto = await plate(w('pic'))
    expect((has(auto, 'fp-op') as HTMLInputElement).disabled).toBe(true)
    document.body.innerHTML = ''
    sim().writeTag('PIC-101', 'MODE', 0)
    const man = await plate(w('pic'))
    expect((has(man, 'fp-op') as HTMLInputElement).disabled).toBe(false)
  })
})

describe('a transmitter plate', () => {
  it('shows the reading, its range, its quality and its source', async () => {
    tick(5)
    const host = await plate(w('pt'))
    expect(has(host, 'fp-range')!.textContent).toMatch(/0–10/)
    expect(host.textContent).toContain('bar')
    expect(host.textContent).toContain('GOOD')
    expect(host.textContent).toContain('SIMULATION')
    expect(has(host, 'fp-start'), 'a transmitter is not commanded').toBeNull()
    expect(has(host, 'fp-auto')).toBeNull()
  })

  it('a forced reading is badged, and the source says who put it there', async () => {
    sim().writeTag('PT-101', 'FORCED', 1)
    tick(2)
    const host = await plate(w('pt'))
    const badge = has(host, 'fp-quality')!
    expect(badge.getAttribute('data-quality')).toBe('forced')
    expect(badge.textContent).toBe('FORCED')
    expect(host.textContent).toContain('OPERATOR')
  })

  it('a failed instrument shows no number at all', async () => {
    sim().writeTag('PT-101', 'BAD', 1)
    tick(2)
    const host = await plate(w('pt'))
    expect(host.textContent).toContain('- - -')
    expect(has(host, 'fp-quality')!.textContent).toBe('BAD')
  })
})

describe('a vessel plate', () => {
  it('shows what it holds and the conditions inside it', async () => {
    tick(5)
    const host = await plate(w('t'))
    expect(has(host, 'fp-v-level')).not.toBeNull()
    expect(has(host, 'fp-v-volume')!.textContent).toContain('m³')
    expect(has(host, 'fp-v-pressure')!.textContent).toContain('bar')
    expect(has(host, 'fp-v-temperature')!.textContent).toContain('°C')
  })

  it('reports the flows in and out once the plant is moving', async () => {
    // PIC-101 owns PV-101 by family+loop, so the operator takes MANUAL before
    // setting the valve — writing OP behind a controller in AUTO does nothing
    sim().writeTag('PIC-101', 'MODE', 0)
    sim().writeTag('PIC-101', 'OP', 100)
    sim().writeTag('P-101', 'RUN', 1)
    tick(20)
    expect(Math.max(0, ...Object.values(sim().branchFlows)), 'the plant is moving').toBeGreaterThan(0)
    const host = await plate(w('t'))
    expect(has(host, 'fp-v-inlet-flow')!.textContent).toContain('m³/h')
  })
})

describe('alarms on a plate', () => {
  it('a quiet tag says NONE; an alarming one lists it with an ack', async () => {
    const quiet = await plate(w('pt'))
    expect(quiet.querySelector('[data-testid="fp-alarm-section"]')!.textContent).toContain('NONE')

    document.body.innerHTML = ''
    sim().writeTag('TK-101', 'PV', 97)
    tick(2)
    const loud = await plate(w('t'))
    expect(has(loud, 'fp-alarms')).not.toBeNull()
    expect(loud.textContent).toMatch(/above/)
  })
})

describe('the plate follows the theme', () => {
  it('renders in both themes without a hardcoded tone leaking through', async () => {
    tick(5)
    const dark = await plate(w('pt'), 'classic')
    const darkHtml = dark.innerHTML
    document.body.innerHTML = ''
    const light = await plate(w('pt'), 'hp')
    const lightHtml = light.innerHTML
    // the SVG scale takes theme values directly, so the two must differ
    expect(darkHtml).toContain(THEMES.classic.liquid)
    expect(lightHtml).toContain(THEMES.hp.liquid)
    expect(lightHtml).not.toContain(THEMES.classic.liquid)
  })
})
