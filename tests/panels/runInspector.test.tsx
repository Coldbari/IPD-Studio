// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3 PROGRAM 3 — the Run context on a selected line, and the one action that
 * numbers a whole pipe.
 *
 * The panel stores nothing. Run membership is `ProjectIndex.runOfEdge`, derived
 * from the drawing every time; no node, no edge and no record gains a run id.
 * And the panel never says From/To — a run through a tee has three ends and
 * nothing in the model says which way anything flows.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import '../../src/symbols/lib/index'
import PropertyPanel from '../../src/panels/PropertyPanel'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import type { LineNumber, PlantEdge, PlantNode, ProjectDoc } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const doc = () => st().doc

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })
const tank = (id: string, label?: string) => node(id, 'equipment', 'vessel.tank', label ? { label } : {})
const valve = (id: string) => node(id, 'valve', 'valve.gate')
const tee = (id: string) => node(id, 'fitting', 'fit.junction')

const ln = (seq: string): LineNumber => ({ size: '6"', spec: 'CS150', service: 'CW', seq })

const edge = (id: string, a: string, b: string, over: Partial<PlantEdge> = {}): PlantEdge => ({
  id,
  lineClass: 'process.major',
  source: { nodeId: a, portId: 'e' },
  target: { nodeId: b, portId: 'w' },
  ...over,
})

function load(nodes: PlantNode[], edges: PlantEdge[]): ProjectDoc {
  const d = createEmptyDoc('runs')
  d.sheets[0]!.nodes = nodes
  d.sheets[0]!.edges = edges
  st().loadIntoStore(d)
  return d
}

let host: HTMLDivElement
let root: Root

async function show(edgeId: string) {
  await act(async () => { st().setSelection([edgeId]) })
  await act(async () => { root.render(<PropertyPanel />) })
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`)
const text = (id: string) => q(id)?.textContent ?? ''

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

/* --------------------------------------------------- resolving to the run */

describe('a selected line shows its run', () => {
  it('resolves the edge to the run that contains it', async () => {
    load([tank('a', 'Feed drum'), valve('v'), tank('b', 'Product tank')],
      [edge('e1', 'a', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'b', { lineNumber: ln('001') })])
    // Both edges are one run, so selecting either shows the same run.
    await show('e1')
    const first = text('run-number') + text('run-segments') + text('run-ends')
    await show('e2')
    expect(text('run-number') + text('run-segments') + text('run-ends')).toBe(first)
  })

  it('shows the number, the segment count, the sheet and the ends', async () => {
    load([tank('a', 'Feed drum'), valve('v'), tank('b', 'Product tank')],
      [edge('e1', 'a', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'b', { lineNumber: ln('001') })])
    await show('e1')
    expect(text('run-number')).toContain('6"-CS150-CW-001')
    expect(text('run-segments')).toContain('2 segments')
    expect(text('run-ends')).toContain('2 ends')
    expect(text('run-ends')).toContain('Feed drum')
    expect(text('run-ends')).toContain('Product tank')
    expect(q('run-section')!.textContent).toContain('Sheet 1')
  })

  it('never labels an end From or To', async () => {
    load([tank('a', 'Feed drum'), tee('t'), tank('b', 'Product tank'), tank('c', 'Slops')],
      [edge('e1', 'a', 't'), edge('e2', 't', 'b'), edge('e3', 't', 'c')])
    await show('e1')
    // Three ends, and the panel says so rather than inventing a pair.
    expect(text('run-ends')).toContain('3 ends')
    expect(q('run-section')!.textContent).not.toMatch(/\bFrom\b|\bTo\b/)
  })

  it('says a signal line belongs to no run', async () => {
    load([tank('a'), node('i', 'instrument', 'instr.bubble')],
      [edge('sig', 'a', 'i', { lineClass: 'signal.electric' })])
    await show('sig')
    // Not a pipe, so the section is not rendered at all.
    expect(q('run-section')).toBeNull()
  })
})

/* ------------------------------------------------------ the three states */

describe('the panel states the numbering honestly', () => {
  it('says unnumbered when no segment carries a number', async () => {
    load([tank('a'), valve('v'), tank('b')], [edge('e1', 'a', 'v'), edge('e2', 'v', 'b')])
    await show('e1')
    expect(text('run-number')).toContain('Unnumbered')
    expect(text('run-number')).toContain('no segment of this pipe carries a number')
  })

  it('names both numbers when one run carries two, and picks neither', async () => {
    load([tank('a'), valve('v'), tank('b')],
      [edge('e1', 'a', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'b', { lineNumber: ln('002') })])
    await show('e1')
    expect(text('run-number')).toContain('2 line numbers')
    expect(text('run-number')).toContain('6"-CS150-CW-001')
    expect(text('run-number')).toContain('6"-CS150-CW-002')
  })

  it('surfaces a QA conflict when the same number is on another run', async () => {
    load([tank('a'), tank('b'), tank('c'), tank('d')],
      [edge('e1', 'a', 'b', { lineNumber: ln('001') }), edge('e2', 'c', 'd', { lineNumber: ln('001') })])
    await show('e1')
    expect(text('run-conflicts')).toContain('is also on 1 other run')
  })

  it('shows no conflict row for a clean run', async () => {
    load([tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })])
    await show('e1')
    expect(q('run-conflicts')).toBeNull()
  })
})

/* -------------------------------------------------- numbering a whole run */

describe('numbering the whole run', () => {
  const numberOf = (id: string) => {
    const e = doc().sheets[0]!.edges.find((x) => x.id === id)!
    return e.lineNumber ? [e.lineNumber.size, e.lineNumber.spec, e.lineNumber.service, e.lineNumber.seq].join('-') : ''
  }

  it('puts the number on every UNNUMBERED segment, in one undo step', async () => {
    load([tank('a'), valve('v1'), valve('v2'), tank('b')],
      [edge('e1', 'a', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'v2'), edge('e3', 'v2', 'b')])
    const before = useStore.temporal.getState().pastStates.length
    await show('e1')
    await act(async () => { (q('run-apply-number') as HTMLButtonElement).click() })

    expect(numberOf('e2')).toBe('6"-CS150-CW-001')
    expect(numberOf('e3')).toBe('6"-CS150-CW-001')
    expect(useStore.temporal.getState().pastStates.length).toBe(before + 1)

    // And one undo puts all of it back.
    await act(async () => { st().undo() })
    expect(numberOf('e2')).toBe('')
    expect(numberOf('e3')).toBe('')
  })

  it('never overwrites a segment that already carries a different number', async () => {
    load([tank('a'), valve('v1'), valve('v2'), tank('b')], [
      edge('e1', 'a', 'v1', { lineNumber: ln('001') }),
      edge('e2', 'v1', 'v2', { lineNumber: ln('999') }),
      edge('e3', 'v2', 'b'),
    ])
    const result = st().applyLineNumberToRun('e1')
    expect(result).toEqual({ applied: 1, skipped: 1 })
    expect(numberOf('e2')).toBe('6"-CS150-CW-999')
    expect(numberOf('e3')).toBe('6"-CS150-CW-001')
  })

  it('touches nothing outside the run', async () => {
    load([tank('a'), valve('v'), tank('b'), tank('c'), tank('d')], [
      edge('e1', 'a', 'v', { lineNumber: ln('001') }),
      edge('e2', 'v', 'b'),
      edge('other', 'c', 'd'),
    ])
    st().applyLineNumberToRun('e1')
    expect(numberOf('e2')).toBe('6"-CS150-CW-001')
    expect(numberOf('other')).toBe('')
  })

  it('refuses when the source line has no number of its own', () => {
    load([tank('a'), valve('v'), tank('b')], [edge('e1', 'a', 'v'), edge('e2', 'v', 'b')])
    const before = JSON.stringify(doc())
    expect(st().applyLineNumberToRun('e1')).toEqual({ applied: 0, skipped: 0 })
    expect(JSON.stringify(doc())).toBe(before)
  })

  it('records no undo step when there is nothing to do', () => {
    load([tank('a'), valve('v'), tank('b')],
      [edge('e1', 'a', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'b', { lineNumber: ln('001') })])
    const before = useStore.temporal.getState().pastStates.length
    expect(st().applyLineNumberToRun('e1')).toEqual({ applied: 0, skipped: 1 })
    expect(useStore.temporal.getState().pastStates.length).toBe(before)
  })

  it('makes the four-segment pipe one line-list row, which is the point', () => {
    load([tank('a'), valve('v1'), valve('v2'), tee('t'), tank('b')], [
      edge('e1', 'a', 'v1', { lineNumber: ln('001') }),
      edge('e2', 'v1', 'v2'), edge('e3', 'v2', 't'), edge('e4', 't', 'b'),
    ])
    expect(st().applyLineNumberToRun('e1')).toEqual({ applied: 3, skipped: 0 })
    const ix = buildIndex(doc())
    expect(ix.runs).toHaveLength(1)
    expect(ix.runs[0]!.number).toBe('6"-CS150-CW-001')
    expect(ix.runs[0]!.edgeIds).toHaveLength(4)
  })

  it('hides the button when every other segment is already numbered', async () => {
    load([tank('a'), valve('v'), tank('b')],
      [edge('e1', 'a', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'b', { lineNumber: ln('001') })])
    await show('e1')
    expect(q('run-apply-number')).toBeNull()
  })

  it('creates no run id anywhere in the document', () => {
    load([tank('a'), valve('v'), tank('b')],
      [edge('e1', 'a', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'b')])
    st().applyLineNumberToRun('e1')
    const runId = buildIndex(doc()).runs[0]!.id
    // Run identity is derived. Nothing may persist it.
    expect(JSON.stringify(doc())).not.toContain(runId)
  })
})
