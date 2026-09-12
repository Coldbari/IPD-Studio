// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'

/**
 * The regression this file exists for: renaming a P&ID tag used to move the
 * engineering record and leave every HMI binding pointing at a tag that no
 * longer existed — no warning, no finding, the widget simply went quiet.
 */

function widget(w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget {
  return { x: 0, y: 0, w: 64, h: 64, ...w }
}

/** A plant with LT-101 referenced from every machine-written place. */
function plantWithBoundScreen(): ProjectDoc {
  const screen: HmiScreen = {
    ...createScreen(1),
    id: 'scr1',
    name: 'Overview',
    widgets: [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101', label: 'Tank Level' }),
      widget({ id: 'w2', type: 'bar', tag: 'LT-101' }),
      widget({ id: 'w3', type: 'display', tag: 'LT-101' }),
      widget({ id: 'w4', type: 'gauge', tag: 'LT-101' }),
      widget({ id: 'w5', type: 'trend', tag: 'FT-200', pens: [{ ref: 'LT-101.PV' }, { ref: 'LT-101.SP' }] }),
      widget({ id: 'w6', type: 'lamp', props: { signal: 'LT-101.PV' } }),
      widget({ id: 'w7', type: 'display', tag: 'LIC-101', props: { bindTank: 'LT-101' } }),
    ],
    pipes: [],
  }
  return { ...createEmptyDoc('t'), hmiScreens: [screen] }
}

const doc = () => useStore.getState().doc
const screen = () => doc().hmiScreens[0]!
const byId = (id: string) => screen().widgets.find((w) => w.id === id)

/** Place an instrument already tagged LT-101 and give it a record + an
 *  accepted finding + a human note naming it elsewhere. */
function setUp(): string {
  useStore.getState().loadIntoStore(plantWithBoundScreen())
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  useStore.getState().setRecordField('P-101', 'equipment', 'general.line', 'from LT-101 header')
  useStore.getState().ignoreFinding('missing-tag:LT-101', 'spare')
  return id
}

beforeEach(() => { useStore.getState().loadIntoStore(createEmptyDoc('t')) })

describe('renaming a tag carries every machine reference with it', () => {
  it('moves the record, 4 widgets, 2 pens, a signal prop and a bindTank', () => {
    const id = setUp()
    useStore.getState().setTag(id, { letters: 'LT', loop: '201' })

    expect(doc().registry?.['LT-201']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc().registry?.['LT-101']).toBeUndefined()

    expect([byId('w1'), byId('w2'), byId('w3'), byId('w4')].map((w) => w?.tag))
      .toEqual(['LT-201', 'LT-201', 'LT-201', 'LT-201'])
    expect(byId('w5')?.pens?.map((p) => p.ref)).toEqual(['LT-201.PV', 'LT-201.SP'])
    expect(byId('w6')?.props?.signal).toBe('LT-201.PV')
    expect(byId('w7')?.props?.bindTank).toBe('LT-201')
    expect(doc().qa?.ignored['missing-tag:LT-201']?.reason).toBe('spare')
  })

  it('leaves the engineer’s own words alone', () => {
    const id = setUp()
    useStore.getState().setTag(id, { letters: 'LT', loop: '201' })
    expect(doc().registry?.['P-101']?.fields['general.line']).toBe('from LT-101 header')
  })

  it('undo restores every propagated reference in ONE step', () => {
    const id = setUp()
    const before = doc()
    useStore.getState().setTag(id, { letters: 'LT', loop: '201' })
    expect(byId('w1')?.tag).toBe('LT-201')

    useStore.temporal.getState().undo()

    expect(byId('w1')?.tag).toBe('LT-101')
    expect(byId('w5')?.pens?.map((p) => p.ref)).toEqual(['LT-101.PV', 'LT-101.SP'])
    expect(byId('w6')?.props?.signal).toBe('LT-101.PV')
    expect(byId('w7')?.props?.bindTank).toBe('LT-101')
    expect(doc().registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc().qa?.ignored['missing-tag:LT-101']).toBeDefined()
    expect(doc().sheets).toEqual(before.sheets)
  })
})

describe('collision refuses the whole operation', () => {
  /** LT-101 (record + HMI + pens + signal + bindTank + accepted finding)
   *  renamed onto LT-201, which already owns an engineering record. */
  function collide() {
    const id = setUp()
    useStore.getState().setRecordField('LT-201', 'instrument', 'signal.range', '0-250 bar')
    const before = doc()
    const result = useStore.getState().setTag(id, { letters: 'LT', loop: '201' })
    return { id, before, result }
  }

  it('leaves the document byte-for-byte identical — the strongest invariant', () => {
    const { before, result } = collide()
    expect(result.collision).toBe(true)
    // Same object reference: the store returned its state untouched, so there
    // is no partial document and zundo recorded no step.
    expect(doc()).toBe(before)
  })

  it('does not move the tag on the drawing', () => {
    const { id } = collide()
    const node = doc().sheets[0]!.nodes.find((n) => n.id === id)
    expect(node?.tag).toEqual({ letters: 'LT', loop: '101' })
  })

  it('merges no record — both survive with their own fields', () => {
    collide()
    expect(doc().registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc().registry?.['LT-201']?.fields['signal.range']).toBe('0-250 bar')
  })

  it('leaves every HMI, trend and QA reference on the old tag', () => {
    collide()
    expect([byId('w1'), byId('w2'), byId('w3'), byId('w4')].map((w) => w?.tag))
      .toEqual(['LT-101', 'LT-101', 'LT-101', 'LT-101'])
    expect(byId('w5')?.pens?.map((p) => p.ref)).toEqual(['LT-101.PV', 'LT-101.SP'])
    expect(byId('w6')?.props?.signal).toBe('LT-101.PV')
    expect(byId('w7')?.props?.bindTank).toBe('LT-101')
    expect(doc().qa?.ignored['missing-tag:LT-101']).toBeDefined()
    expect(doc().qa?.ignored['missing-tag:LT-201']).toBeUndefined()
  })

  it('refuses a colliding line renumber the same way', () => {
    useStore.getState().loadIntoStore(createEmptyDoc('t'))
    const a = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const b = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })
    const edge = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: a, portId: 'e' },
      target: { nodeId: b, portId: 'w' },
    })
    useStore.getState().setEdge(edge, { lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '001' } })
    useStore.getState().setRecordField('6"-CS-CW-001', 'line', 'spec.material', 'A106-B')
    useStore.getState().setRecordField('6"-CS-CW-002', 'line', 'spec.material', 'A333-6')
    const before = doc()

    const result = useStore.getState().setEdge(edge, {
      lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '002' },
    })

    expect(result.collision).toBe(true)
    expect(doc()).toBe(before)
    expect(doc().sheets[0]!.edges.find((e) => e.id === edge)?.lineNumber?.seq).toBe('001')
  })
})

describe('the copy case is unchanged', () => {
  it('copies the record when another symbol still wears the old tag', () => {
    useStore.getState().loadIntoStore(plantWithBoundScreen())
    const a = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const b = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 64, y: 0, rotation: 0 })
    useStore.getState().setTag(a, { letters: 'LT', loop: '101' })
    useStore.getState().setTag(b, { letters: 'LT', loop: '101' })
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')

    useStore.getState().setTag(a, { letters: 'LT', loop: '201' })

    // b still wears LT-101, so its record stays as well as moving to LT-201.
    expect(doc().registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc().registry?.['LT-201']?.fields['signal.range']).toBe('0-10 bar')
  })
})

describe('renumbering a line', () => {
  it('carries the line record and re-keys its accepted finding', () => {
    useStore.getState().loadIntoStore(createEmptyDoc('t'))
    const a = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const b = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })
    const edge = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: a, portId: 'e' },
      target: { nodeId: b, portId: 'w' },
    })
    useStore.getState().setEdge(edge, { lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '001' } })
    useStore.getState().setRecordField('6"-CS-CW-001', 'line', 'spec.material', 'A106-B')
    useStore.getState().ignoreFinding('line-no-service:6"-CS-CW-001', 'utility')

    useStore.getState().setEdge(edge, { lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '002' } })

    expect(doc().registry?.['6"-CS-CW-002']?.fields['spec.material']).toBe('A106-B')
    expect(doc().registry?.['6"-CS-CW-001']).toBeUndefined()
    expect(doc().qa?.ignored['line-no-service:6"-CS-CW-002']?.reason).toBe('utility')
  })
})
