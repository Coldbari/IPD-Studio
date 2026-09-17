// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useSimStore } from '../../src/hmi/simStore'
import Faceplate from '../../src/hmi/Faceplate'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// screen exercises the audit's empty-body cases: a tagged bar and a symbol
// resolving to a motor, plus a tank that alarms immediately (level0 > HH)
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 0, y: 0, w: 56, h: 56, tag: 'P-1' },
    { id: 'b', type: 'bar', x: 0, y: 100, w: 56, h: 144, tag: 'FI-1', props: { unit: 'm³/h', max: 20 } },
    { id: 's1', type: 'symbol', x: 0, y: 300, w: 64, h: 64, tag: 'P-1', props: { symbolId: 'pump.centrifugal' } },
    { id: 't', type: 'tank', x: 200, y: 0, w: 96, h: 128, tag: 'TK-1', props: { level0: 97 } },
    { id: 'c', type: 'display', x: 0, y: 500, w: 96, h: 40, tag: 'LIC-1', props: { controller: true, min: 0, max: 100 } },
  ],
  pipes: [],
}
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!

async function mount(el: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(el))
  return host
}

beforeEach(() => {
  document.body.innerHTML = ''
  useSimStore.getState().exitRun()
  useSimStore.getState().enterRun(screen)
})

describe('Faceplate v2', () => {
  it('a tagged bar widget gets a real measurement body (no more empty plates)', async () => {
    const host = await mount(<Faceplate widget={w('b')} onClose={() => {}} />)
    expect(host.innerHTML).toContain('PV')
    expect(host.innerHTML).toContain('m³/h')
  })

  it('a symbol whose tag is a motor gets Start/Stop', async () => {
    const host = await mount(<Faceplate widget={w('s1')} onClose={() => {}} />)
    expect(host.innerHTML).toContain('data-testid="fp-start"')
    expect(host.innerHTML).toContain('STOPPED')
  })

  it('shows the tag standing alarms with per-alarm Ack', async () => {
    useSimStore.getState().tickOnce(0.2) // evaluate alarms: TK-1 at 97 trips H+HH
    const host = await mount(<Faceplate widget={w('t')} onClose={() => {}} />)
    expect(host.innerHTML).toContain('data-testid="fp-alarms"')
    expect(host.innerHTML).toContain('HH')
    const ackBtns = [...host.querySelectorAll('[data-testid="fp-alarms"] button')]
    expect(ackBtns.length).toBeGreaterThan(0)
    await act(async () => (ackBtns[0] as HTMLButtonElement).click())
    expect(useSimStore.getState().alarms.some((a) => a.phase === 'acked')).toBe(true)
  })

  it('SP steppers clamp to the widget range', async () => {
    const host = await mount(<Faceplate widget={w('c')} onClose={() => {}} />)
    const plus = [...host.querySelectorAll('button')].find((b) => b.textContent === '+')!
    // Enough clicks to reach the top from anywhere on a 0-100 range. Sixty was
    // enough while `initTags` seeded every controller at 50; K15 does not, so
    // the count has to cover the whole travel rather than half of it. The
    // subject is the CLAMP, and it is unchanged.
    for (let i = 0; i < 120; i++) await act(async () => plus.click())
    expect(useSimStore.getState().tags['LIC-1']!.SP).toBe(100)
  })

  it('Escape closes the plate', async () => {
    let closed = false
    await mount(<Faceplate widget={w('p')} onClose={() => { closed = true }} />)
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(closed).toBe(true)
  })
})
