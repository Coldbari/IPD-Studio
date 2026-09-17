// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K15 — THE FLOW LOOP AND THE MISSING SETPOINT, ON THE EXISTING PLATE.
 *
 * Nothing was redesigned. The controller faceplate K14 built already carries
 * loop, mode, SP, PV, output, saturation and — for a speed loop — the machine
 * with its command beside its shaft. A flow loop is a speed loop, so it gets
 * all of that without a line of new layout, and these tests are what say so.
 *
 * The one change K15 needed is smaller and more important: an ABSENT setpoint
 * now reads as absent. It used to read as 50.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import Faceplate from '../../src/hmi/Faceplate'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const screen: HmiScreen = {
  id: 'k15ui', name: 'K15 UI', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 120, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

/** ...and one whose controller drives a valve and measures nothing. */
const noMeasurement: HmiScreen = {
  ...screen,
  widgets: [
    ...screen.widgets
      .filter((w) => w.id !== 'hv')
      .map((w) => (w.id === 'ft' ? { ...w, props: { min: 0, max: 60, unit: 'm³/h' } } : w)),
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
  ],
}

const reg: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
}

const roots: { unmount(): void }[] = []
async function mount(el: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(el))
  return host
}

const sim = () => useSimStore.getState()
const start = (s: HmiScreen = screen) => { sim().exitRun(); sim().enterRun(s, reg) }
const advance = (seconds: number) => act(() => {
  for (let i = 0; i < seconds; i++) sim().tickOnce(1)
})
const lineUp = (sp?: number) => act(() => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  if (sp !== undefined) sim().writeTag('FIC-1', 'SP', sp)
})
const w = (id: string, s: HmiScreen = screen): HmiWidget => s.widgets.find((x) => x.id === id)!
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)

afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
})
beforeEach(() => { document.body.innerHTML = ''; start() })

// ── §18. Everything the brief asks for, on the plate that already existed ───

describe('the flow controller faceplate carries the whole loop', () => {
  it('loop, mode, SP, PV, output — and the machine with both its speeds', async () => {
    lineUp(25); advance(200)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)

    expect(host.textContent).toContain('FIC-1')                 // the loop
    expect(q(host, 'fp-auto')!.getAttribute('aria-pressed')).toBe('true')  // mode
    expect(host.textContent).toContain('SP')
    expect(host.textContent).toContain('PV')
    expect(q(host, 'fp-sp')).not.toBeNull()

    const drive = q(host, 'fp-drive')!                          // the machine
    expect(drive.textContent).toContain('P-1')
    expect(q(host, 'fp-v-speed-command')).not.toBeNull()        // SPD command
    expect(q(host, 'fp-v-actual-speed')).not.toBeNull()         // actual RAMP
  })

  it('SAT appears only when the loop has run out of machine', async () => {
    lineUp(25); advance(200)
    const ok = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    expect(q(ok, 'fp-saturated')).toBeNull()

    act(() => sim().writeTag('FIC-1', 'SP', 55))
    advance(200)
    const high = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    expect(q(high, 'fp-saturated')!.getAttribute('data-sat')).toBe('1')
    expect(q(high, 'fp-saturated')!.textContent).toContain('AT MAXIMUM')
  })

  it('AUTO, MANUAL and a drive mid-ramp are all normal — no alarm colour', async () => {
    lineUp(25); advance(200)
    act(() => sim().writeTag('FIC-1', 'SP', 34))
    advance(1)                                   // mid-ramp: command ≠ shaft
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    expect(q(host, 'fp-saturated')).toBeNull()
    expect((q(host, 'fp-auto') as HTMLElement).getAttribute('style') ?? '').not.toContain('color')

    act(() => sim().writeTag('FIC-1', 'MODE', 0))
    advance(1)
    const man = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    expect(q(man, 'fp-man')!.getAttribute('aria-pressed')).toBe('true')
    expect(q(man, 'fp-saturated')).toBeNull()
  })

  it('and the pump\'s own plate names the loop and stands aside', async () => {
    lineUp(25); advance(60)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect(q(host, 'fp-speed-owner')!.getAttribute('data-loop')).toBe('FIC-1')
    expect((q(host, 'fp-speed') as HTMLInputElement).disabled).toBe(true)
  })
})

// ── The setpoint that is not there ──────────────────────────────────────────

describe('an absent setpoint reads as absent', () => {
  it('a loop with nothing to aim at shows no number, and says why', async () => {
    start(noMeasurement)
    expect(sim().tags['FIC-1']!.SP).toBeUndefined()
    const host = await mount(<Faceplate widget={w('fic', noMeasurement)} onClose={() => {}} />)
    const row = q(host, 'fp-sp-row')!
    expect(row.getAttribute('data-sp')).toBe('unavailable')
    const input = q(host, 'fp-sp') as HTMLInputElement
    expect(input.value).toBe('')                  // not 50, and not 0
    expect(input.getAttribute('title')).toContain('nothing to aim at')
  })

  it('and the operator can still give it one', async () => {
    start(noMeasurement)
    const host = await mount(<Faceplate widget={w('fic', noMeasurement)} onClose={() => {}} />)
    const plus = [...host.querySelectorAll('button')].find((b) => b.textContent === '+')!
    await act(async () => plus.click())
    expect(sim().tags['FIC-1']!.SP).toBeDefined()
    const after = await mount(<Faceplate widget={w('fic', noMeasurement)} onClose={() => {}} />)
    expect(q(after, 'fp-sp-row')!.getAttribute('data-sp')).toBe('set')
  })

  it('a calm-started loop shows the setpoint it started from', async () => {
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    expect(q(host, 'fp-sp-row')!.getAttribute('data-sp')).toBe('set')
    expect((q(host, 'fp-sp') as HTMLInputElement).value).toBe(String(sim().tags['FIC-1']!.SP))
  })
})
