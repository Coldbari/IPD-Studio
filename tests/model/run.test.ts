// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3 Program 1 — what a derived piping run is, and what it refuses to decide.
 *
 * Most of these are assertions about RESTRAINT: that connectivity, not a typed
 * label, decides where a pipe ends; that a run carrying two numbers reports
 * both rather than picking one; that the extremities come back as a list rather
 * than a From/To pair the model cannot justify.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import {
  deriveRuns, runEnds, runConflicts, allRunConflicts, passesThrough,
  type Run,
} from '../../src/model/run'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import type { LineNumber, PlantEdge, PlantNode, ProjectDoc, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })

const ln = (seq: string): LineNumber => ({ size: '6"', spec: 'CS150', service: 'CW', seq })

/** An edge between two nodes. `n` gives it a line number. */
const edge = (
  id: string,
  a: string | { x: number; y: number },
  b: string | { x: number; y: number },
  over: Partial<PlantEdge> = {},
): PlantEdge => ({
  id,
  lineClass: 'process.major',
  source: typeof a === 'string' ? { nodeId: a, portId: 'e' } : a,
  target: typeof b === 'string' ? { nodeId: b, portId: 'w' } : b,
  ...over,
})

/** One sheet, with a fixed id so run ids are legible in a failure message. */
function sheetOf(id: string, nodes: PlantNode[], edges: PlantEdge[]): Sheet {
  return { ...createSheet(1), id, nodes, edges }
}

function docOf(...sheets: Sheet[]): ProjectDoc {
  return { ...createEmptyDoc('runs'), sheets }
}

const runsOf = (doc: ProjectDoc) => buildIndex(doc).runs
const idsOf = (runs: Run[]) => runs.map((r) => r.edgeIds)

/* Standard cast of hardware, by what the existing pass-through rule says. */
const tank = (id: string) => node(id, 'equipment', 'vessel.tank')
const valve = (id: string) => node(id, 'valve', 'valve.gate')
const pump = (id: string) => node(id, 'equipment', 'pump.centrifugal')
const tee = (id: string) => node(id, 'fitting', 'fit.junction')
const bubble = (id: string) => node(id, 'instrument', 'instr.bubble')

/* ----------------------------------------------------------- connectivity */

describe('a run is what is physically connected', () => {
  it('carries on through a valve', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')], [edge('e1', 'tk1', 'v1'), edge('e2', 'v1', 'tk2')]))
    expect(idsOf(runsOf(doc))).toEqual([['e1', 'e2']])
  })

  it('carries on through a pump, which moves the fluid but does not end it', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), pump('p1'), tank('tk2')], [edge('e1', 'tk1', 'p1'), edge('e2', 'p1', 'tk2')]))
    expect(idsOf(runsOf(doc))).toEqual([['e1', 'e2']])
  })

  it('stops at a vessel rather than crossing onto its other nozzles', () => {
    const doc = docOf(sheetOf('s1', [valve('v1'), tank('tk'), valve('v2')], [edge('e1', 'v1', 'tk'), edge('e2', 'tk', 'v2')]))
    expect(idsOf(runsOf(doc))).toEqual([['e1'], ['e2']])
  })

  it('joins all three legs of a tee into ONE run', () => {
    const doc = docOf(sheetOf('s1',
      [tank('tk1'), tee('t1'), tank('tk2'), tank('tk3')],
      [edge('e1', 'tk1', 't1'), edge('e2', 't1', 'tk2'), edge('e3', 't1', 'tk3')]))
    expect(idsOf(runsOf(doc))).toEqual([['e1', 'e2', 'e3']])
  })

  it('follows a branch several hops from where it started', () => {
    // tk1 -e1- v1 -e2- t1 -e3- v2 -e4- tk2, and t1 -e5- v3 -e6- tk3
    const doc = docOf(sheetOf('s1',
      [tank('tk1'), valve('v1'), tee('t1'), valve('v2'), tank('tk2'), valve('v3'), tank('tk3')],
      [edge('e1', 'tk1', 'v1'), edge('e2', 'v1', 't1'), edge('e3', 't1', 'v2'),
        edge('e4', 'v2', 'tk2'), edge('e5', 't1', 'v3'), edge('e6', 'v3', 'tk3')]))
    expect(idsOf(runsOf(doc))).toEqual([['e1', 'e2', 'e3', 'e4', 'e5', 'e6']])
  })

  it('ignores signal lines entirely — they are in no run', () => {
    const doc = docOf(sheetOf('s1', [valve('v1'), bubble('i1')], [
      edge('e1', 'v1', 'i1', { lineClass: 'signal.electric' }),
      edge('e2', 'v1', 'i1', { lineClass: 'signal.pneumatic' }),
    ]))
    expect(runsOf(doc)).toEqual([])
  })

  it('keeps a free end as one end of the run it is drawn on', () => {
    const doc = docOf(sheetOf('s1', [valve('v1')], [
      edge('e1', { x: 0, y: 0 }, 'v1'),
      edge('e2', 'v1', { x: 99, y: 0 }),
    ]))
    expect(idsOf(runsOf(doc))).toEqual([['e1', 'e2']])
  })

  it('gives a line with two free ends a run of its own', () => {
    const doc = docOf(sheetOf('s1', [], [edge('e1', { x: 0, y: 0 }, { x: 9, y: 0 })]))
    expect(idsOf(runsOf(doc))).toEqual([['e1']])
  })
})

/* ---------------------------------------------------------- sheet refusal */

describe('a run never crosses a sheet', () => {
  it('splits a line continued on a second sheet into two runs', () => {
    const doc = docOf(
      sheetOf('s1', [tank('tk1'), valve('v1')], [edge('a1', 'tk1', 'v1', { lineNumber: ln('001') })]),
      sheetOf('s2', [valve('v2'), tank('tk2')], [edge('b1', 'v2', 'tk2', { lineNumber: ln('001') })]),
    )
    const runs = runsOf(doc)
    expect(runs.map((r) => r.sheetId)).toEqual(['s1', 's2'])
    expect(idsOf(runs)).toEqual([['a1'], ['b1']])
  })

  it('cannot be reached through a node id that appears on both sheets', () => {
    // Pathological, and only possible through an import that mints its own ids.
    // Adjacency is built per sheet, so the walk has nowhere to go.
    const doc = docOf(
      sheetOf('s1', [valve('shared'), tank('tk1')], [edge('a1', 'shared', 'tk1')]),
      sheetOf('s2', [valve('shared'), tank('tk2')], [edge('b1', 'shared', 'tk2')]),
    )
    expect(idsOf(runsOf(doc))).toEqual([['a1'], ['b1']])
  })
})

/* ------------------------------------------------------------- numbering */

describe('numbering is observed, never decided', () => {
  it('reports an unnumbered run as unnumbered, not as absent', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1')], [edge('e1', 'tk1', 'v1')]))
    const [run] = runsOf(doc)
    expect(run!.unnumbered).toBe(true)
    expect(run!.number).toBeUndefined()
    expect(run!.numbers).toEqual([])
  })

  it('names the number when exactly one was observed', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
      [edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'tk2', { lineNumber: ln('001') })]))
    const [run] = runsOf(doc)
    expect(run!.number).toBe('6"-CS150-CW-001')
    expect(run!.numbers).toEqual(['6"-CS150-CW-001'])
    expect(run!.unnumbered).toBe(false)
  })

  it('still names it when only some segments carry it', () => {
    // Numbering the main segment and leaving the short bits blank is ordinary
    // drafting, not a second line.
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
      [edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'tk2')]))
    const [run] = runsOf(doc)
    expect(run!.number).toBe('6"-CS150-CW-001')
    expect(run!.unnumbered).toBe(false)
  })

  it('refuses to pick a winner when one connected run carries two numbers', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
      [edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'tk2', { lineNumber: ln('002') })]))
    const [run] = runsOf(doc)
    // ONE run. The label did not cut the pipe.
    expect(runsOf(doc)).toHaveLength(1)
    expect(run!.edgeIds).toEqual(['e1', 'e2'])
    expect(run!.number).toBeUndefined()
    expect(run!.numbers).toEqual(['6"-CS150-CW-001', '6"-CS150-CW-002'])
    expect(run!.unnumbered).toBe(false)
  })

  it('separates "no number" from "several numbers", which both leave number absent', () => {
    const none = docOf(sheetOf('s1', [tank('a'), valve('b')], [edge('e1', 'a', 'b')]))
    const many = docOf(sheetOf('s1', [tank('a'), valve('b'), tank('c')],
      [edge('e1', 'a', 'b', { lineNumber: ln('001') }), edge('e2', 'b', 'c', { lineNumber: ln('002') })]))
    expect(runsOf(none)[0]!.number).toBeUndefined()
    expect(runsOf(many)[0]!.number).toBeUndefined()
    expect(runsOf(none)[0]!.unnumbered).toBe(true)
    expect(runsOf(many)[0]!.unnumbered).toBe(false)
  })

  it('ignores a line number whose parts are all blank, as keyOfEdge does', () => {
    const blank: LineNumber = { size: '', spec: '', service: '', seq: '' }
    const doc = docOf(sheetOf('s1', [tank('a'), valve('b')], [edge('e1', 'a', 'b', { lineNumber: blank })]))
    expect(runsOf(doc)[0]!.unnumbered).toBe(true)
  })
})

/* ------------------------------------------------------------- conflicts */

describe('conflicts are reported, never repaired', () => {
  const twoNumbersOneRun = () => docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
    [edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'tk2', { lineNumber: ln('002') })]))

  const oneNumberTwoRuns = () => docOf(sheetOf('s1', [valve('v1'), tank('tk'), valve('v2')],
    [edge('e1', 'v1', 'tk', { lineNumber: ln('001') }), edge('e2', 'tk', 'v2', { lineNumber: ln('001') })]))

  it('reports several numbers on one connected run', () => {
    const ix = buildIndex(twoNumbersOneRun())
    expect(runConflicts(ix, ix.runs[0]!)).toEqual([
      { kind: 'multiple-numbers', runId: 's1:e1', sheetId: 's1', numbers: ['6"-CS150-CW-001', '6"-CS150-CW-002'] },
    ])
  })

  it('reports one number on two runs that are not connected', () => {
    const ix = buildIndex(oneNumberTwoRuns())
    expect(ix.runs).toHaveLength(2)
    expect(runConflicts(ix, ix.runs[0]!)).toEqual([
      { kind: 'number-split', number: '6"-CS150-CW-001', runIds: ['s1:e1', 's1:e2'] },
    ])
  })

  it('counts a line continued on another sheet as a split, and says nothing more', () => {
    const doc = docOf(
      sheetOf('s1', [tank('tk1'), valve('v1')], [edge('a1', 'tk1', 'v1', { lineNumber: ln('001') })]),
      sheetOf('s2', [valve('v2'), tank('tk2')], [edge('b1', 'v2', 'tk2', { lineNumber: ln('001') })]),
    )
    const ix = buildIndex(doc)
    expect(allRunConflicts(ix)).toEqual([
      { kind: 'number-split', number: '6"-CS150-CW-001', runIds: ['s1:a1', 's2:b1'] },
    ])
  })

  it('says nothing about a clean run', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
      [edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'tk2', { lineNumber: ln('001') })]))
    const ix = buildIndex(doc)
    expect(runConflicts(ix, ix.runs[0]!)).toEqual([])
    expect(allRunConflicts(ix)).toEqual([])
  })

  it('leaves the drawing untouched — nothing is renumbered', () => {
    const doc = twoNumbersOneRun()
    const before = JSON.stringify(doc)
    const ix = buildIndex(doc)
    allRunConflicts(ix)
    for (const run of ix.runs) runConflicts(ix, run)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('allRunConflicts agrees with runConflicts over every run', () => {
    const doc = docOf(sheetOf('s1',
      [tank('tk1'), valve('v1'), tank('tk2'), valve('v2'), tank('tk3')],
      [edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'tk2', { lineNumber: ln('002') }),
        edge('e3', 'tk2', 'v2', { lineNumber: ln('001') }), edge('e4', 'v2', 'tk3', { lineNumber: ln('001') })]))
    const ix = buildIndex(doc)
    const perRun = ix.runs.flatMap((r) => runConflicts(ix, r))
    const all = allRunConflicts(ix)
    // Same set of facts; `allRunConflicts` states a split once rather than once
    // per participating run.
    expect(new Set(all.map((c) => JSON.stringify(c)))).toEqual(new Set(perRun.map((c) => JSON.stringify(c))))
    expect(all.filter((c) => c.kind === 'number-split')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ ends */

describe('run ends say where a pipe stops and why', () => {
  it('names the equipment at both ends of a straight run', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
      [edge('e1', 'tk1', 'v1'), edge('e2', 'v1', 'tk2')]))
    const ix = buildIndex(doc)
    expect(runEnds(ix, ix.runs[0]!)).toEqual([
      { edgeId: 'e1', at: 'source', nodeId: 'tk1', reason: 'boundary' },
      { edgeId: 'e2', at: 'target', nodeId: 'tk2', reason: 'boundary' },
    ])
  })

  it('does not report the valve in the middle as an end', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
      [edge('e1', 'tk1', 'v1'), edge('e2', 'v1', 'tk2')]))
    const ix = buildIndex(doc)
    expect(runEnds(ix, ix.runs[0]!).some((e) => e.nodeId === 'v1')).toBe(false)
  })

  it('carries the terminating tag, when the equipment has one', () => {
    const doc = docOf(sheetOf('s1',
      [node('tk1', 'equipment', 'vessel.tank', { tag: { letters: 'TK', loop: '101' } }), valve('v1')],
      [edge('e1', 'tk1', 'v1')]))
    const ix = buildIndex(doc)
    expect(runEnds(ix, ix.runs[0]!)[0]).toEqual({
      edgeId: 'e1', at: 'source', nodeId: 'tk1', nodeKey: 'TK-101', reason: 'boundary',
    })
  })

  it('reports a free end as free, with no node to name', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1')], [edge('e1', { x: 0, y: 0 }, 'tk1')]))
    const ix = buildIndex(doc)
    expect(runEnds(ix, ix.runs[0]!)).toEqual([
      { edgeId: 'e1', at: 'source', reason: 'free' },
      { edgeId: 'e1', at: 'target', nodeId: 'tk1', reason: 'boundary' },
    ])
  })

  it('calls a valve with nothing on the far side a dead end, not a destination', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1')], [edge('e1', 'tk1', 'v1')]))
    const ix = buildIndex(doc)
    const ends = runEnds(ix, ix.runs[0]!)
    expect(ends.find((e) => e.nodeId === 'v1')?.reason).toBe('dead-end')
  })

  it('stops at an instrument, which is a boundary and not pass-through', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), bubble('i1')], [edge('e1', 'tk1', 'i1')]))
    const ix = buildIndex(doc)
    expect(runEnds(ix, ix.runs[0]!).find((e) => e.nodeId === 'i1')?.reason).toBe('boundary')
  })

  it('calls a port naming a node that is not in the document a dead end', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1')], [edge('e1', 'tk1', 'ghost')]))
    const ix = buildIndex(doc)
    expect(runEnds(ix, ix.runs[0]!).find((e) => e.at === 'target')).toEqual({
      edgeId: 'e1', at: 'target', nodeId: 'ghost', reason: 'dead-end',
    })
  })

  it('gives a branched run THREE ends and marks none of them From or To', () => {
    const doc = docOf(sheetOf('s1',
      [tank('tk1'), tee('t1'), tank('tk2'), tank('tk3')],
      [edge('e1', 'tk1', 't1'), edge('e2', 't1', 'tk2'), edge('e3', 't1', 'tk3')]))
    const ix = buildIndex(doc)
    const ends = runEnds(ix, ix.runs[0]!)
    expect(ends).toHaveLength(3)
    expect(ends.map((e) => e.nodeId).sort()).toEqual(['tk1', 'tk2', 'tk3'])
    // Nothing in the shape of the answer suggests a direction.
    expect(Object.keys(ends[0]!).sort()).toEqual(['at', 'edgeId', 'nodeId', 'reason'])
  })

  it('gives a closed loop of pipe no ends at all', () => {
    const doc = docOf(sheetOf('s1', [valve('v1'), valve('v2')],
      [edge('e1', 'v1', 'v2'), edge('e2', 'v2', 'v1')]))
    const ix = buildIndex(doc)
    expect(ix.runs).toHaveLength(1)
    expect(runEnds(ix, ix.runs[0]!)).toEqual([])
  })

  it('is deterministic, and sorted by edge then source-before-target', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), tee('t1'), tank('tk2')],
      [edge('e2', 't1', 'tk2'), edge('e1', 'tk1', 't1')]))
    const ix = buildIndex(doc)
    const once = runEnds(ix, ix.runs[0]!)
    expect(once).toEqual(runEnds(ix, ix.runs[0]!))
    expect(once.map((e) => `${e.edgeId}.${e.at}`)).toEqual(['e1.source', 'e2.target'])
  })
})

/* --------------------------------------------------------- determinism */

describe('runs are deterministic', () => {
  const wide = () => docOf(sheetOf('s1',
    [tank('tk1'), valve('v1'), tank('tk2'), valve('v2'), tank('tk3'), valve('v3')],
    [edge('e5', 'tk1', 'v1'), edge('e3', 'v1', 'tk2'), edge('e9', 'tk2', 'v2'),
      edge('e1', 'v2', 'tk3'), edge('e7', 'tk3', 'v3')]))

  it('produces identical output from two builds of one document', () => {
    const doc = wide()
    expect(buildIndex(doc).runs).toEqual(buildIndex(doc).runs)
  })

  it('names each run after its smallest edge id, whatever order it was drawn in', () => {
    const runs = runsOf(wide())
    expect(runs.map((r) => r.id)).toEqual(['s1:e1', 's1:e3', 's1:e7'])
    for (const run of runs) expect(run.id).toBe(`s1:${run.edgeIds[0]}`)
  })

  it('orders runs by sheet first, then by id', () => {
    const doc = docOf(
      sheetOf('s1', [tank('a'), valve('b')], [edge('z9', 'a', 'b')]),
      sheetOf('s2', [tank('c'), valve('d')], [edge('a1', 'c', 'd')]),
    )
    // Sheet order wins: 's1:z9' sorts after 's2:a1' as a string, and does not
    // come after it here.
    expect(runsOf(doc).map((r) => r.id)).toEqual(['s1:z9', 's2:a1'])
  })

  it('keeps a run id when a later segment is added to it', () => {
    const before = runsOf(docOf(sheetOf('s1', [tank('a'), valve('b')], [edge('e1', 'a', 'b')])))
    const after = runsOf(docOf(sheetOf('s1', [tank('a'), valve('b'), tank('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')])))
    expect(after[0]!.id).toBe(before[0]!.id)
  })

  it('sorts edgeIds inside a run', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tee('t'), tank('c')],
      [edge('e9', 't', 'c'), edge('e2', 'a', 't')]))
    expect(runsOf(doc)[0]!.edgeIds).toEqual(['e2', 'e9'])
  })
})

/* ---------------------------------------------------------- runOfEdge */

describe('runOfEdge is complete and says nothing it should not', () => {
  const mixed = () => docOf(
    sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2'), bubble('i1')], [
      edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }),
      edge('e2', 'v1', 'tk2'),
      edge('sig1', 'v1', 'i1', { lineClass: 'signal.electric' }),
      edge('free', { x: 0, y: 0 }, { x: 9, y: 9 }),
    ]),
    sheetOf('s2', [tank('tk3'), valve('v2')], [edge('e3', 'tk3', 'v2')]),
  )

  it('has an entry for every process edge and no other', () => {
    const ix = buildIndex(mixed())
    expect([...ix.runOfEdge.keys()].sort()).toEqual(['e1', 'e2', 'e3', 'free'])
    expect(ix.runOfEdge.has('sig1')).toBe(false)
  })

  it('points every entry at a run that exists, and covers every run', () => {
    const ix = buildIndex(mixed())
    const byId = new Map(ix.runs.map((r) => [r.id, r]))
    for (const [edgeId, runId] of ix.runOfEdge) {
      expect(byId.get(runId), runId).toBeDefined()
      expect(byId.get(runId)!.edgeIds).toContain(edgeId)
    }
    const claimed = ix.runs.flatMap((r) => r.edgeIds)
    expect(claimed.sort()).toEqual([...ix.runOfEdge.keys()].sort())
    expect(new Set(claimed).size).toBe(claimed.length) // no edge in two runs
  })

  it('is empty for a document with nothing drawn', () => {
    const ix = buildIndex(createEmptyDoc('bare'))
    expect(ix.runs).toEqual([])
    expect(ix.runOfEdge.size).toBe(0)
  })
})

/* ------------------------------------------------- the pass-through rule */

describe('pass-through is the rule the product already had', () => {
  it('conducts through valves, fittings and inline equipment', () => {
    expect(passesThrough(valve('v'))).toBe(true)
    expect(passesThrough(tee('t'))).toBe(true)
    expect(passesThrough(pump('p'))).toBe(true)
  })

  it('stops at vessels, exchangers, instruments and annotations', () => {
    expect(passesThrough(tank('tk'))).toBe(false)
    expect(passesThrough(node('hx', 'equipment', 'hx.shell-tube'))).toBe(false)
    expect(passesThrough(bubble('i'))).toBe(false)
    expect(passesThrough(node('n', 'annotation', 'ann.text'))).toBe(false)
  })

  it('PINNED: a run stops at an in-line flow element, because it is an instrument', () => {
    // NOT an endorsement — a recorded consequence of the existing rule.
    // `fe.*` symbols carry tagRule 'isa-instrument', so they are placed as
    // kind 'instrument', and `passesThrough` rejects every instrument before it
    // ever consults the category. 'flow-elements' being in PASS_CATEGORIES is
    // therefore unreachable. A line through an orifice plate derives as TWO
    // runs today. Changing that changes what a fluid assignment colours as
    // well, so it is a P3 Program 2 decision, not a Program 1 edit.
    const fe = node('fe1', 'instrument', 'fe.orifice')
    expect(passesThrough(fe)).toBe(false)
    const doc = docOf(sheetOf('s1', [tank('tk1'), fe, tank('tk2')],
      [edge('e1', 'tk1', 'fe1', { lineNumber: ln('001') }), edge('e2', 'fe1', 'tk2', { lineNumber: ln('001') })]))
    const ix = buildIndex(doc)
    expect(idsOf(ix.runs)).toEqual([['e1'], ['e2']])
    // And it surfaces honestly, as one number on two runs.
    expect(allRunConflicts(ix)).toEqual([
      { kind: 'number-split', number: '6"-CS150-CW-001', runIds: ['s1:e1', 's1:e2'] },
    ])
  })

  it('PINNED: an off-page connector is a boundary, so a run stops there', () => {
    const op = node('op1', 'annotation', 'ann.offpage')
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), op],
      [edge('e1', 'tk1', 'v1'), edge('e2', 'v1', 'op1')]))
    const ix = buildIndex(doc)
    expect(idsOf(ix.runs)).toEqual([['e1', 'e2']])
    expect(runEnds(ix, ix.runs[0]!).find((e) => e.nodeId === 'op1')?.reason).toBe('boundary')
  })
})

/* ------------------------------------------------------------- purity */

describe('deriving runs is a read', () => {
  it('changes nothing about the document', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')],
      [edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }), edge('e2', 'v1', 'tk2')]))
    const before = JSON.stringify(doc)
    const ix = buildIndex(doc)
    deriveRuns(ix)
    for (const run of ix.runs) runEnds(ix, run)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('derives the same runs from a finished index as the index itself holds', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), tee('t1'), tank('tk2'), tank('tk3')],
      [edge('e1', 'tk1', 't1'), edge('e2', 't1', 'tk2'), edge('e3', 't1', 'tk3')]))
    const ix = buildIndex(doc)
    expect(deriveRuns(ix)).toEqual(ix.runs)
  })
})
