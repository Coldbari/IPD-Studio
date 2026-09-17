// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K16 — AUTHORITY ON THE SURFACES THAT ALREADY EXIST.
 *
 * A loop that has stopped controlling looks exactly like one that is
 * satisfied: output steady, PV near setpoint, no alarm. The difference is
 * whether anything it computes can reach the plant, and that is what these two
 * additions say — one line on the controller's own plate, one block on the
 * diagnostics page's LIVE section.
 *
 * A COLOUR IS STILL A SEVERITY. A stopped machine is a NORMAL plant state and
 * reads in the muted tone; a stuck actuator and an untrustworthy measurement
 * do not. MANUAL is not a fault and a ramping drive is not an alarm.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaLive } from '../../src/validate/live'
import { resetQaCache } from '../../src/validate/engine'
import { resetDiagnosticsCache } from '../../src/model/diagnostics'
import Faceplate from '../../src/hmi/Faceplate'
import DiagnosticsPage from '../../src/hmi/operator/DiagnosticsPage'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const screen: HmiScreen = {
  id: 'k16ui', name: 'K16 UI', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 120, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const reg: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
}
const project = (): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [screen], registry: reg })

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
const start = () => {
  useStore.getState().loadIntoStore(project())
  sim().exitRun(); sim().enterRun(screen, reg)
}
const advance = (seconds: number) => act(() => {
  for (let i = 0; i < seconds; i++) sim().tickOnce(1)
})
const lineUp = () => act(() => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  sim().writeTag('PIC-1', 'SP', 3)
})
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const rows = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="diag-loop-row"]')]

afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
  resetQaLive()
})
beforeEach(() => {
  document.body.innerHTML = ''
  resetQaLive(); resetQaCache(); resetDiagnosticsCache()
  start()
})

// ── The controller's plate ──────────────────────────────────────────────────

describe('the controller faceplate says whether it can reach the plant', () => {
  it('a working loop reads AVAILABLE, in the ordinary text tone', async () => {
    lineUp(); advance(200)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const el = q(host, 'fp-authority')!
    expect(el.getAttribute('data-authority')).toBe('available')
    expect(el.getAttribute('data-severity')).toBe('none')
    expect(el.textContent).toContain('CONTROL AUTHORITY AVAILABLE')
  })

  it('a stopped machine reads UNAVAILABLE — and is information, not an alarm', async () => {
    lineUp(); advance(200)
    act(() => sim().writeTag('P-1', 'RUN', 0))
    advance(5)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const el = q(host, 'fp-authority')!
    expect(el.getAttribute('data-authority')).toBe('de-energised')
    expect(el.getAttribute('data-severity')).toBe('info')
    expect(el.textContent).toContain('CONTROL AUTHORITY UNAVAILABLE')
  })

  it('REQUESTED and ACTUATOR are shown apart, and TRACKING while they differ', async () => {
    lineUp(); advance(400)
    const steady = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect(q(steady, 'fp-v-requested')).not.toBeNull()
    expect(q(steady, 'fp-v-actuator')).not.toBeNull()
    expect(q(steady, 'fp-tracking')).toBeNull()      // arrived: not a fault

    act(() => sim().writeTag('P-1', 'RUN', 0))
    advance(6)
    const stopped = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    // commanded somewhere, turning nowhere — and the plate shows both numbers
    expect(q(stopped, 'fp-tracking')).not.toBeNull()
    expect(q(stopped, 'fp-v-actuator')!.textContent).toContain('0')
  })

  it('MANUAL is not a fault on the plate either', async () => {
    lineUp(); advance(200)
    act(() => { sim().writeTag('PIC-1', 'MODE', 0); sim().writeTag('PIC-1', 'OP', 40) })
    advance(10)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect(q(host, 'fp-authority')!.getAttribute('data-severity')).toBe('none')
    expect(q(host, 'fp-man')!.getAttribute('aria-pressed')).toBe('true')
  })
})

// ── The Diagnostics page ────────────────────────────────────────────────────

describe('the Diagnostics page lists the loops that cannot act', () => {
  it('a healthy plant shows no control-loop block at all', async () => {
    lineUp(); advance(200)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(q(host, 'diag-loops')).toBeNull()
  })

  it('a stopped machine appears as INFO, naming the machine and what was held', async () => {
    lineUp(); advance(200)
    act(() => sim().writeTag('P-1', 'RUN', 0))
    advance(5)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    const row = rows(host)[0]!
    expect(row.getAttribute('data-tag')).toBe('PIC-1')
    expect(row.getAttribute('data-severity')).toBe('info')
    expect(row.textContent).toContain('P-1')
    expect(row.textContent).toContain('held where the plant left them')
  })

  it('it is LIVE, not ENGINEERING — the records are not what is wrong', async () => {
    lineUp(); advance(200)
    act(() => sim().writeTag('P-1', 'RUN', 0))
    advance(5)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(q(host, 'diag-section-live')!.getAttribute('aria-pressed')).toBe('true')
    expect(q(host, 'diag-loops')).not.toBeNull()
    await act(async () => (q(host, 'diag-section-engineering') as HTMLElement).click())
    expect(q(host, 'diag-loops')).toBeNull()
  })

  it('and it clears the moment the machine is started again', async () => {
    lineUp(); advance(200)
    act(() => sim().writeTag('P-1', 'RUN', 0))
    advance(5)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(rows(host)).toHaveLength(1)
    act(() => sim().writeTag('P-1', 'RUN', 1))
    advance(5)
    await act(async () => {})
    expect(q(host, 'diag-loops')).toBeNull()
  })
})
