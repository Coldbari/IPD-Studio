// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K13 — THE OPERATING ENVELOPE, ON THE SURFACES THAT ALREADY EXIST.
 *
 * No new page. One line on the pump's faceplate saying where the machine is
 * being run, and one block on the Diagnostics page's LIVE section saying it in
 * the vocabulary that page already uses.
 *
 * The rule the tests below enforce is the one ISA-101 cares about: A COLOUR IS
 * A SEVERITY. A machine running normally, a drive on its way to a new speed
 * and a machine whose record states no limit all read in the ordinary text
 * tone. The alarm palette is reserved for the two conditions that earn it.
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
  id: 'k13ui', name: 'K13 UI', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 600, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 40 } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 118 }, { x: 196, y: 118 }], bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 596, y: 150 }], aId: 'fv', aPort: 'out', bId: 't', bPort: 'bottom' },
  ],
}

const registry: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.minFlow': '10 m³/h',
    'duty.vsd': 'Yes', 'duty.minSpeed': '20 %' } },
  'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
}
const bare: Registry = {
  'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
  'TK-1': registry['TK-1']!,
}

const project = (reg: Registry): ProjectDoc =>
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
const start = (reg: Registry) => {
  useStore.getState().loadIntoStore(project(reg))
  sim().exitRun()
  sim().enterRun(screen, reg)
}
const advance = (seconds: number, dt = 1) => {
  act(() => { for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt) })
}
const lineUp = () => act(() => {
  sim().writeTag('FV-1', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
})
const pump: HmiWidget = screen.widgets[0]!
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const rows = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="diag-env-row"]')]

afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
  resetQaLive()
})

beforeEach(() => {
  document.body.innerHTML = ''
  resetQaLive(); resetQaCache(); resetDiagnosticsCache()
  start(registry)
})

// ── The faceplate ───────────────────────────────────────────────────────────

describe('the pump faceplate says where the machine is being run', () => {
  it('a healthy machine reads NORMAL, in the ordinary text tone', async () => {
    lineUp(); advance(30)
    const host = await mount(<Faceplate widget={pump} onClose={() => {}} />)
    const el = q(host, 'fp-envelope')!
    expect(el.getAttribute('data-state')).toBe('NORMAL')
    // no severity, therefore no colour from the alarm palette
    expect(el.getAttribute('data-severity')).toBe('none')
    expect(el.textContent).toContain('Operating envelope')
  })

  it('dead-headed, it reads DEAD-HEAD and earns the alarm tone', async () => {
    lineUp(); advance(30)
    act(() => sim().writeTag('FV-1', 'OP', 0))
    advance(30)
    const host = await mount(<Faceplate widget={pump} onClose={() => {}} />)
    const el = q(host, 'fp-envelope')!
    expect(el.getAttribute('data-state')).toBe('DEAD-HEAD')
    expect(el.getAttribute('data-severity')).toBe('error')
  })

  it('below the stated minimum it is a WARNING, not an alarm', async () => {
    lineUp(); advance(20)
    act(() => sim().writeTag('FV-1', 'OP', 5))
    advance(30)
    const host = await mount(<Faceplate widget={pump} onClose={() => {}} />)
    expect(q(host, 'fp-envelope')!.getAttribute('data-state')).toBe('BELOW MINIMUM FLOW')
    expect(q(host, 'fp-envelope')!.getAttribute('data-severity')).toBe('warning')
    // and the limit it is being judged against is on the plate beside it
    expect(q(host, 'fp-v-minimum-flow')!.textContent).toContain('10.0')
  })

  it('NORMAL VSD RAMPING IS NOT A FAULT', async () => {
    lineUp(); advance(30)
    act(() => sim().writeTag('P-1', 'SPD', 60))
    advance(1)                                  // mid-ramp, command ≠ shaft
    const host = await mount(<Faceplate widget={pump} onClose={() => {}} />)
    const el = q(host, 'fp-envelope')!
    expect(el.getAttribute('data-state')).toBe('NORMAL')
    expect(el.getAttribute('data-severity')).toBe('none')
    // ...and the two speeds are both on the plate, apart, as K12 left them
    expect(q(host, 'fp-v-actual-speed')!.textContent).not.toBe(q(host, 'fp-v-speed-command')!.textContent)
  })

  it('a machine whose record states no limit says so, and it is not an alarm', async () => {
    start(bare)
    lineUp(); advance(30)
    const host = await mount(<Faceplate widget={pump} onClose={() => {}} />)
    const el = q(host, 'fp-envelope')!
    expect(el.getAttribute('data-state')).toBe('LIMIT UNKNOWN')
    expect(el.getAttribute('data-severity')).toBe('info')
    expect(q(host, 'fp-v-minimum-flow')).toBeNull()   // there is none to show
  })

  it('a stopped machine is not being operated outside anything', async () => {
    advance(5)
    const host = await mount(<Faceplate widget={pump} onClose={() => {}} />)
    const el = q(host, 'fp-envelope')!
    expect(el.getAttribute('data-state')).toBe('STOPPED')
    expect(el.getAttribute('data-severity')).toBe('none')
  })
})

// ── The Diagnostics page ────────────────────────────────────────────────────

describe('the Diagnostics page carries the envelope on its LIVE section', () => {
  it('a healthy plant shows no envelope block at all', async () => {
    lineUp(); advance(30)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(q(host, 'diag-envelope')).toBeNull()
  })

  it('a dead-headed machine appears as an ERROR, with its tag and its evidence', async () => {
    lineUp(); advance(30)
    act(() => sim().writeTag('FV-1', 'OP', 0))
    advance(30)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(q(host, 'diag-envelope')).not.toBeNull()
    const row = rows(host)[0]!
    expect(row.getAttribute('data-tag')).toBe('P-1')
    expect(row.getAttribute('data-severity')).toBe('error')
    expect(row.textContent).toContain('dead-headed')
    expect(row.textContent).toContain('ERROR')
  })

  it('it is LIVE, not ENGINEERING — the record is not what is wrong', async () => {
    lineUp(); advance(30)
    act(() => sim().writeTag('FV-1', 'OP', 0))
    advance(30)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    // the live section is the one that opens, and the block is on it
    expect(q(host, 'diag-section-live')!.getAttribute('aria-pressed')).toBe('true')
    expect(q(host, 'diag-envelope')).not.toBeNull()
    // switching to Engineering takes it away: a different subject
    await act(async () => (q(host, 'diag-section-engineering') as HTMLElement).click())
    expect(q(host, 'diag-envelope')).toBeNull()
  })

  it('the "no limit stated" row is INFO, and says which field would fix it', async () => {
    start(bare)
    lineUp(); advance(30)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    const row = rows(host)[0]!
    expect(row.getAttribute('data-severity')).toBe('info')
    expect(row.textContent).toContain('minimum-flow limit unavailable')
    expect(row.textContent).toContain('Minimum flow')
  })

  it('and it clears itself when the plant comes back into its envelope', async () => {
    lineUp(); advance(20)
    act(() => sim().writeTag('FV-1', 'OP', 5))
    advance(30)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(rows(host)).toHaveLength(1)
    act(() => sim().writeTag('FV-1', 'OP', 100))
    advance(30)
    await act(async () => {})
    expect(q(host, 'diag-envelope')).toBeNull()
  })
})
