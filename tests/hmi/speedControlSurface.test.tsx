// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K14 — THE SPEED LOOP ON THE FACEPLATES THAT ALREADY EXIST.
 *
 * No redesign. Two additions, each for a reason the brief names:
 *
 *  - THE PUMP'S PLATE says who is commanding its speed and takes the control
 *    away while a loop owns it. That is not decoration: a slider the operator
 *    can still move would be a command the next tick overwrites, which is the
 *    competing write K14 is required not to have.
 *  - THE CONTROLLER'S PLATE shows the machine it drives, the speed it
 *    COMMANDED and the speed the shaft actually reached — K12's distinction,
 *    kept visible now that a loop rather than a person is asking.
 *
 * A COLOUR IS STILL A SEVERITY. AUTO and MANUAL are normal states and read in
 * the ordinary text tone. Only saturation — the loop having run out of machine,
 * which means the setpoint is not reachable — takes a warning colour.
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
  id: 'k14ui', name: 'K14 UI', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 120, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'fv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const duty = { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' }
const driven: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment',
    fields: { ...duty, 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
}
/** The same plant whose machine declares a drive but has no loop on it. */
const noLoop: HmiScreen = {
  ...screen,
  widgets: screen.widgets.filter((w) => w.id !== 'pic'),
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
const start = (s: HmiScreen = screen) => { sim().exitRun(); sim().enterRun(s, driven) }
const advance = (seconds: number) => act(() => {
  for (let i = 0; i < seconds; i++) sim().tickOnce(1)
})
const lineUp = (sp: number) => act(() => {
  sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  sim().writeTag('PIC-1', 'SP', sp)
})
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)

afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
})
beforeEach(() => { document.body.innerHTML = ''; start() })

// ── The pump's plate ────────────────────────────────────────────────────────

describe('the pump faceplate names its controller and stands aside', () => {
  it('says which loop commands the speed, and in which mode', async () => {
    lineUp(3); advance(30)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    const owner = q(host, 'fp-speed-owner')!
    expect(owner.getAttribute('data-loop')).toBe('PIC-1')
    expect(owner.getAttribute('data-mode')).toBe('AUTO')
    expect(owner.textContent).toContain('PIC-1')
  })

  it('and disables the speed control while the loop owns it', async () => {
    lineUp(3); advance(30)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect((q(host, 'fp-speed') as HTMLInputElement).disabled).toBe(true)
    expect((q(host, 'fp-speed-50') as HTMLButtonElement).disabled).toBe(true)
    // ...in MANUAL too: the controller is still the only writer of SPD
    act(() => sim().writeTag('PIC-1', 'MODE', 0))
    advance(1)
    const host2 = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect(q(host2, 'fp-speed-owner')!.getAttribute('data-mode')).toBe('MANUAL')
    expect((q(host2, 'fp-speed') as HTMLInputElement).disabled).toBe(true)
  })

  it('a VSD machine with NO loop keeps its speed control, exactly as K12 left it', async () => {
    start(noLoop)
    act(() => { sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1) })
    advance(30)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect(q(host, 'fp-speed-owner')).toBeNull()
    expect((q(host, 'fp-speed') as HTMLInputElement).disabled).toBe(false)
  })

  it('and both speeds are still shown apart', async () => {
    lineUp(3); advance(30)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect(q(host, 'fp-v-actual-speed')).not.toBeNull()
    expect(q(host, 'fp-v-speed-command')).not.toBeNull()
  })
})

// ── The controller's plate ──────────────────────────────────────────────────

describe('the controller faceplate shows the machine it is driving', () => {
  it('names it, and shows the command beside the shaft', async () => {
    lineUp(3); advance(200)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const drive = q(host, 'fp-drive')!
    expect(drive.textContent).toContain('P-1')
    expect(q(host, 'fp-v-speed-command')).not.toBeNull()
    expect(q(host, 'fp-v-actual-speed')).not.toBeNull()
  })

  it('a valve-driven loop gets no drive section', async () => {
    const withValve: HmiScreen = {
      ...screen,
      widgets: screen.widgets.map((x) => (x.id === 'fv' ? { ...x, tag: 'PV-1' } : x)),
    }
    sim().exitRun(); sim().enterRun(withValve, driven)
    advance(5)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect(q(host, 'fp-drive')).toBeNull()
  })

  it('MODE is a normal state and carries no alarm colour', async () => {
    lineUp(3); advance(60)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const auto = q(host, 'fp-auto') as HTMLButtonElement
    expect(auto.getAttribute('aria-pressed')).toBe('true')
    expect(auto.getAttribute('style') ?? '').not.toContain('color')
    expect(q(host, 'fp-saturated')).toBeNull()      // nothing abnormal here
  })

  it('SATURATION is said out loud, and only when it is true', async () => {
    lineUp(3); advance(200)
    const ok = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect(q(ok, 'fp-saturated')).toBeNull()

    act(() => sim().writeTag('PIC-1', 'SP', 9))     // more than the plant can make
    advance(60)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const sat = q(host, 'fp-saturated')!
    expect(sat.getAttribute('data-sat')).toBe('1')
    expect(sat.textContent).toContain('AT MAXIMUM')

    act(() => sim().writeTag('PIC-1', 'SP', 0.5))   // less than the drive will run at
    advance(400)
    const low = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect(q(low, 'fp-saturated')!.getAttribute('data-sat')).toBe('-1')
    expect(q(low, 'fp-saturated')!.textContent).toContain('AT MINIMUM')
  })

  it('the output slider still needs MANUAL, and MANUAL still reaches the drive', async () => {
    lineUp(3); advance(60)
    const auto = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect((q(auto, 'fp-op') as HTMLInputElement).disabled).toBe(true)

    act(() => sim().writeTag('PIC-1', 'MODE', 0))
    advance(1)
    const man = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const slider = q(man, 'fp-op') as HTMLInputElement
    expect(slider.disabled).toBe(false)
    act(() => sim().writeTag('PIC-1', 'OP', 40))
    advance(20)
    expect(sim().tags['P-1']!.SPD).toBe(40)
    expect(sim().tags['P-1']!.RAMP).toBeCloseTo(0.4, 6)
  })
})
