// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K17 — THE CASCADE, ON THE FACEPLATE THAT ALREADY EXISTS.
 *
 * No new page. Two loops, each already having a plate, each now saying which
 * end of the link it is:
 *
 *     PIC-1   MASTER  → FIC-1 → P-101
 *     FIC-1   SLAVE   SP from PIC-1
 *
 * The chain matters because neither plate on its own explains where a number
 * goes. The master's output is a SETPOINT; the slave is the only thing that
 * writes the drive; and an operator looking at the master should not have to
 * infer that from two screens.
 *
 * A slave's setpoint belongs to its master, so the entry is taken away — one
 * writer, said on the surface, exactly as K14 did with the pump's own speed.
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
  id: 'k17ui', name: 'K17 UI', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2', min: 0, max: 10, unit: 'bar' } },
    { id: 'pic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'PIC-1', props: { controller: true, min: 0, max: 10, unit: 'bar' } },
    { id: 'ft', type: 'display', x: 900, y: 160, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 220, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const reg = (to = 'FIC-1'): Registry => ({
  'P-101': { key: 'P-101', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'PIC-1': { key: 'PIC-1', kind: 'instrument', fields: { 'signal.cascadeTo': to } },
})
const project = (r: Registry): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [screen], registry: r })

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
const start = (r: Registry = reg()) => {
  useStore.getState().loadIntoStore(project(r))
  sim().exitRun(); sim().enterRun(screen, r)
}
const advance = (seconds: number) => act(() => {
  for (let i = 0; i < seconds; i++) sim().tickOnce(1)
})
const lineUp = (sp = 3) => act(() => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-101', 'RUN', 1)
  sim().writeTag('PIC-1', 'SP', sp)
})
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)

afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
  resetQaLive()
})
beforeEach(() => {
  document.body.innerHTML = ''
  resetQaLive(); resetQaCache(); resetDiagnosticsCache()
  start()
})

// ── The chain ───────────────────────────────────────────────────────────────

describe('each plate says which end of the cascade it is', () => {
  it('the MASTER shows the whole chain, right down to the machine', async () => {
    lineUp(); advance(300)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const el = q(host, 'fp-cascade')!
    expect(el.getAttribute('data-role')).toBe('master')
    expect(el.getAttribute('data-link')).toBe('FIC-1')
    expect(el.textContent).toContain('MASTER')
    expect(el.textContent).toContain('FIC-1')
    expect(el.textContent).toContain('P-101')
  })

  it('the SLAVE says whose setpoint it is carrying', async () => {
    lineUp(); advance(300)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    const el = q(host, 'fp-cascade')!
    expect(el.getAttribute('data-role')).toBe('slave')
    expect(el.textContent).toContain('SLAVE')
    expect(el.textContent).toContain('SP from PIC-1')
  })

  it('and a slave cannot be given a setpoint by hand while its master owns it', async () => {
    lineUp(); advance(300)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    const sp = q(host, 'fp-sp') as HTMLInputElement
    expect(sp.disabled).toBe(true)
    expect(sp.getAttribute('title')).toContain('PIC-1 sets this setpoint')
    // the master's own setpoint is the operator's, and stays enterable
    const m = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect((q(m, 'fp-sp') as HTMLInputElement).disabled).toBe(false)
  })

  it('the master shows the setpoint it COMMANDED beside the one in force', async () => {
    lineUp(); advance(300)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect(q(host, 'fp-v-commanded-sp')).not.toBeNull()
    expect(q(host, 'fp-v-effective-sp')).not.toBeNull()
    // in the slave's units, not the master's per cent
    expect(q(host, 'fp-v-commanded-sp')!.textContent).toContain('m³/h')
  })
})

// ── States the operator has to be able to read ──────────────────────────────

describe('the states a cascade can be in', () => {
  it('a slave in MANUAL leaves the master with no authority, as information', async () => {
    lineUp(); advance(300)
    act(() => sim().writeTag('FIC-1', 'MODE', 0))
    advance(3)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    const a = q(host, 'fp-authority')!
    expect(a.getAttribute('data-authority')).toBe('downstream')
    expect(a.getAttribute('data-severity')).toBe('info')   // normal, not an alarm
  })

  it('a refused cascade says NOT IN SERVICE on the master\'s plate', async () => {
    start(reg('FIC-9'))
    advance(5)
    const host = await mount(<Faceplate widget={w('pic')} onClose={() => {}} />)
    expect(q(host, 'fp-cascade-problem')).not.toBeNull()
    expect(q(host, 'fp-cascade-problem')!.textContent).toContain('NOT IN SERVICE')
    // and it drives nothing, so its authority says so too
    expect(q(host, 'fp-authority')!.getAttribute('data-authority')).toBe('no-actuator')
  })

  it('the diagnostics page lists the unavailable slave, on LIVE', async () => {
    lineUp(); advance(300)
    act(() => sim().writeTag('P-101', 'RUN', 0))
    advance(5)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    const rows = [...host.querySelectorAll('[data-testid="diag-loop-row"]')]
    expect(rows.map((r) => r.getAttribute('data-tag')).sort()).toEqual(['FIC-1', 'PIC-1'])
    const pic = rows.find((r) => r.getAttribute('data-tag') === 'PIC-1')!
    expect(pic.getAttribute('data-severity')).toBe('info')
    expect(pic.textContent).toContain('FIC-1')
    expect(pic.textContent).toContain('not following it')
  })

  it('a healthy cascade produces no findings at all', async () => {
    lineUp(); advance(400)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(q(host, 'diag-loops')).toBeNull()
  })

  it('and a setpoint at the end of the slave\'s range is INFO, not an alarm', async () => {
    lineUp(9); advance(400)                       // more pressure than the plant makes
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    const rows = [...host.querySelectorAll('[data-testid="diag-loop-row"]')]
    const limited = rows.find((r) => r.textContent?.includes('configured setpoint range'))!
    expect(limited.getAttribute('data-tag')).toBe('PIC-1')
    expect(limited.getAttribute('data-severity')).toBe('info')
  })
})
