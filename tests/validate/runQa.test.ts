// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3 PROGRAM 2 — QA asks the RUN, not the edge.
 *
 * `duplicate-line-number` used to flag every edge past the first that wore a
 * number. A real pipe is drawn in segments, so numbering one honestly produced
 * a warning per segment: the product was telling engineers not to number their
 * pipes. Now the question is "is this number on more than one PIPE", which is
 * what the rule always meant.
 *
 * Most of what follows is about what is NOT a duplicate. Three real drawing
 * patterns used to be reported and must not be, and each is a separate piece of
 * evidence in the model rather than an inference about the plant.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules } from '../../src/validate/engine'
import { runContinuity } from '../../src/model/run'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import type { LineNumber, PlantEdge, PlantNode, ProjectDoc, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })

const tank = (id: string) => node(id, 'equipment', 'vessel.tank')
const valve = (id: string) => node(id, 'valve', 'valve.gate')
const tee = (id: string) => node(id, 'fitting', 'fit.junction')
const orifice = (id: string) => node(id, 'instrument', 'fe.orifice')
const offpage = (id: string, link?: PlantNode['link']) => node(id, 'annotation', 'ann.offpage', link ? { link } : {})

const ln = (seq: string, over: Partial<LineNumber> = {}): LineNumber =>
  ({ size: '6"', spec: 'CS150', service: 'CW', seq, ...over })

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

const sheetOf = (id: string, nodes: PlantNode[], edges: PlantEdge[]): Sheet =>
  ({ ...createSheet(1), id, nodes, edges })

const docOf = (...sheets: Sheet[]): ProjectDoc => ({ ...createEmptyDoc('runqa'), sheets })

const dupes = (doc: ProjectDoc) =>
  runRules(buildIndex(doc)).groups.find((g) => g.rule.id === 'duplicate-line-number')?.findings ?? []

const N1 = '6"-CS150-CW-001'

/* ------------------------------------------------- one pipe, many segments */

describe('one pipe drawn in segments is not a duplicate', () => {
  it('says nothing about three segments of one run all numbered the same', () => {
    // tk1 -e1- v1 -e2- v2 -e3- tk2, every edge numbered 6"-CS150-CW-001.
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), valve('v2'), tank('tk2')], [
      edge('e1', 'tk1', 'v1', { lineNumber: ln('001') }),
      edge('e2', 'v1', 'v2', { lineNumber: ln('001') }),
      edge('e3', 'v2', 'tk2', { lineNumber: ln('001') }),
    ]))
    expect(buildIndex(doc).runs).toHaveLength(1)
    expect(dupes(doc)).toEqual([])
  })

  it('says nothing when a branch of the same run carries the number too', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), tee('t1'), tank('tk2'), tank('tk3')], [
      edge('e1', 'tk1', 't1', { lineNumber: ln('001') }),
      edge('e2', 't1', 'tk2', { lineNumber: ln('001') }),
      edge('e3', 't1', 'tk3', { lineNumber: ln('001') }),
    ]))
    expect(dupes(doc)).toEqual([])
  })

  it('says nothing about a header carrying several DIFFERENT numbers', () => {
    // The legitimate branching case: one connected run, three numbers, and no
    // evidence in the model that any of it is wrong. Nothing is reported.
    const doc = docOf(sheetOf('s1', [tank('tk1'), tee('t1'), tank('tk2'), tank('tk3')], [
      edge('e1', 'tk1', 't1', { lineNumber: ln('001', { size: '12"' }) }),
      edge('e2', 't1', 'tk2', { lineNumber: ln('010', { size: '2"' }) }),
      edge('e3', 't1', 'tk3', { lineNumber: ln('011', { size: '2"' }) }),
    ]))
    const ix = buildIndex(doc)
    expect(ix.runs).toHaveLength(1)
    expect(ix.runs[0]!.numbers).toHaveLength(3)
    expect(runRules(ix).groups.flatMap((g) => g.findings).filter((f) => f.ruleId.startsWith('run-'))).toEqual([])
    expect(dupes(doc)).toEqual([])
  })
})

/* ------------------------------------------------------- real duplicates */

describe('one number on two unconnected pipes is still a duplicate', () => {
  it('reports two runs on one sheet that never touch', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), valve('b'), tank('c'), valve('d')], [
      edge('e1', 'a', 'b', { lineNumber: ln('001') }),
      edge('e2', 'c', 'd', { lineNumber: ln('001') }),
    ]))
    const found = dupes(doc)
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toBe(`Line number ${N1} is used on 2 runs that are not connected to each other`)
  })

  it('reports ONE finding for the number, not one per edge', () => {
    // Four runs, four edges, one number. The old rule produced three findings.
    const nodes = ['a', 'b', 'c', 'd'].flatMap((n) => [tank(`${n}1`), valve(`${n}2`)])
    const edges = ['a', 'b', 'c', 'd'].map((n, i) => edge(`e${i}`, `${n}1`, `${n}2`, { lineNumber: ln('001') }))
    const doc = docOf(sheetOf('s1', nodes, edges))
    const found = dupes(doc)
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('4 runs')
  })

  it('still reports two lines that are attached to nothing at all', () => {
    // The case tests/validate/rules.test.ts has always covered.
    const doc = docOf(sheetOf('s1', [], [
      edge('e1', { x: 0, y: 0 }, { x: 9, y: 0 }, { lineNumber: ln('001') }),
      edge('e2', { x: 0, y: 9 }, { x: 9, y: 9 }, { lineNumber: ln('001') }),
    ]))
    expect(dupes(doc)).toHaveLength(1)
  })

  it('still reports two runs that meet at a VESSEL', () => {
    // A vessel transforms what passes through it, so the inlet and the outlet
    // are two lines. Nothing is joined here.
    const doc = docOf(sheetOf('s1', [valve('v1'), tank('tk'), valve('v2')], [
      edge('e1', 'v1', 'tk', { lineNumber: ln('001') }),
      edge('e2', 'tk', 'v2', { lineNumber: ln('001') }),
    ]))
    expect(buildIndex(doc).runs).toHaveLength(2)
    expect(dupes(doc)).toHaveLength(1)
  })

  it('keeps covering a number typed onto a line that is not piping', () => {
    // `runOfEdge` holds process edges only. A signal line carrying a number is
    // an island of one and still collides with a pipe wearing the same number.
    const doc = docOf(sheetOf('s1', [tank('a'), valve('b')], [
      edge('e1', 'a', 'b', { lineNumber: ln('001') }),
      edge('sig', 'a', 'b', { lineClass: 'signal.electric', lineNumber: ln('001') }),
    ]))
    expect(buildIndex(doc).runOfEdge.has('sig')).toBe(false)
    expect(dupes(doc)).toHaveLength(1)
  })
})

/* ------------------------------------------------ in-line instrument split */

describe('a run split by an in-line instrument is one line', () => {
  it('says nothing about a number on both sides of an orifice plate', () => {
    // `passesThrough` rejects instruments by KIND, so an orifice ends a run.
    // That is our model's doing, not the drawing's — and the two sides are
    // one pipe with something measuring it.
    const doc = docOf(sheetOf('s1', [tank('tk1'), orifice('fe1'), tank('tk2')], [
      edge('e1', 'tk1', 'fe1', { lineNumber: ln('001') }),
      edge('e2', 'fe1', 'tk2', { lineNumber: ln('001') }),
    ]))
    const ix = buildIndex(doc)
    expect(ix.runs).toHaveLength(2)
    const cluster = runContinuity(ix)
    expect(cluster.get(ix.runs[0]!.id)).toBe(cluster.get(ix.runs[1]!.id))
    expect(dupes(doc)).toEqual([])
  })

  it('joins three segments through two instruments', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), orifice('fe1'), orifice('fe2'), tank('tk2')], [
      edge('e1', 'tk1', 'fe1', { lineNumber: ln('001') }),
      edge('e2', 'fe1', 'fe2', { lineNumber: ln('001') }),
      edge('e3', 'fe2', 'tk2', { lineNumber: ln('001') }),
    ]))
    const ix = buildIndex(doc)
    expect(ix.runs).toHaveLength(3)
    expect(new Set(runContinuity(ix).values())).toHaveLength(1)
    expect(dupes(doc)).toEqual([])
  })

  it('does not join two pipes that merely touch the same VALVE', () => {
    // Unreachable by construction — a valve passes through, so they would be
    // one run — but the assertion pins that continuity never invents a join.
    const doc = docOf(sheetOf('s1', [tank('tk1'), valve('v1'), tank('tk2')], [
      edge('e1', 'tk1', 'v1'), edge('e2', 'v1', 'tk2'),
    ]))
    const ix = buildIndex(doc)
    expect(ix.runs).toHaveLength(1)
  })
})

/* ---------------------------------------------------- cross-sheet continuity */

describe('a line continued on another sheet is not a duplicate', () => {
  const twoSheets = (link: PlantNode['link'] | undefined, back: PlantNode['link'] | undefined = undefined) =>
    docOf(
      sheetOf('s1', [tank('tk1'), offpage('op1', link)], [edge('a1', 'tk1', 'op1', { lineNumber: ln('001') })]),
      sheetOf('s2', [offpage('op2', back), tank('tk2')], [edge('b1', 'op2', 'tk2', { lineNumber: ln('001') })]),
    )

  it('follows the link the offpage-link rule already validates', () => {
    const doc = twoSheets({ sheetId: 's2', nodeId: 'op2' })
    const ix = buildIndex(doc)
    expect(ix.runs).toHaveLength(2)
    expect(ix.runs[0]!.sheetId).not.toBe(ix.runs[1]!.sheetId)
    expect(dupes(doc)).toEqual([])
  })

  it('accepts the link written in EITHER direction', () => {
    // The property panel writes the pointer on one connector only; nothing
    // makes it reciprocal, so neither side may be privileged.
    expect(dupes(twoSheets(undefined, { sheetId: 's1', nodeId: 'op1' }))).toEqual([])
    expect(dupes(twoSheets({ sheetId: 's2', nodeId: 'op2' }, { sheetId: 's1', nodeId: 'op1' }))).toEqual([])
  })

  it('reports a duplicate when NOTHING links the two sheets', () => {
    // Conservative by construction: with no link there is no evidence of
    // continuation, and the rule says what it can see.
    const found = dupes(twoSheets(undefined))
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('2 runs')
  })

  it('reports a duplicate when the link points at the wrong connector', () => {
    const doc = docOf(
      sheetOf('s1', [tank('tk1'), offpage('op1', { sheetId: 's2', nodeId: 'elsewhere' })],
        [edge('a1', 'tk1', 'op1', { lineNumber: ln('001') })]),
      sheetOf('s2', [offpage('op2'), tank('tk2'), offpage('elsewhere')],
        [edge('b1', 'op2', 'tk2', { lineNumber: ln('001') })]),
    )
    expect(dupes(doc)).toHaveLength(1)
  })

  it('joins two runs that share ONE connector on one sheet', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), offpage('op1'), tank('tk2')], [
      edge('e1', 'tk1', 'op1', { lineNumber: ln('001') }),
      edge('e2', 'op1', 'tk2', { lineNumber: ln('001') }),
    ]))
    expect(dupes(doc)).toEqual([])
  })
})

/* ----------------------------------------------------- finding identity */

describe('the finding is stable and says which rule it is', () => {
  const twoRuns = () => docOf(sheetOf('s1', [tank('a'), valve('b'), tank('c'), valve('d')], [
    edge('zz', 'a', 'b', { lineNumber: ln('001') }),
    edge('aa', 'c', 'd', { lineNumber: ln('001') }),
  ]))

  it('is keyed by the line number alone, so it survives a redraw', () => {
    const found = dupes(twoRuns())
    expect(found[0]!.key).toBe(`duplicate-line-number:${N1}`)
    expect(found[0]!.entityKey).toBe(N1)
    // No node or edge id anywhere in the identity.
    expect(found[0]!.key).not.toContain('zz')
    expect(found[0]!.key).not.toContain('aa')
  })

  it('points at the SECOND run by edge id, whatever order the sheet holds them in', () => {
    const forward = dupes(twoRuns())
    const reversed = dupes(docOf(sheetOf('s1', [tank('a'), valve('b'), tank('c'), valve('d')], [
      edge('aa', 'c', 'd', { lineNumber: ln('001') }),
      edge('zz', 'a', 'b', { lineNumber: ln('001') }),
    ])))
    expect(forward[0]!.targetId).toBe('zz')
    expect(reversed[0]!.targetId).toBe('zz')
  })

  it('keeps its severity, discipline and title', () => {
    const group = runRules(buildIndex(twoRuns())).groups.find((g) => g.rule.id === 'duplicate-line-number')!
    expect(group.rule.severity).toBe('warning')
    expect(group.rule.discipline).toBe('topology')
    expect(group.rule.title).toBe('Duplicate line numbers')
  })

  it('is deterministic across two runs of the engine', () => {
    const doc = twoRuns()
    expect(dupes(doc)).toEqual(dupes(doc))
  })

  it('orders findings by line number when several collide', () => {
    const doc = docOf(sheetOf('s1',
      [tank('a'), valve('b'), tank('c'), valve('d'), tank('e'), valve('f'), tank('g'), valve('h')], [
        edge('e1', 'a', 'b', { lineNumber: ln('002') }), edge('e2', 'c', 'd', { lineNumber: ln('002') }),
        edge('e3', 'e', 'f', { lineNumber: ln('001') }), edge('e4', 'g', 'h', { lineNumber: ln('001') }),
      ]))
    expect(dupes(doc).map((f) => f.entityKey)).toEqual([N1, '6"-CS150-CW-002'])
  })
})

/* --------------------------------------------------------- runContinuity */

describe('runContinuity joins only what the drawing states', () => {
  it('maps a lone run to itself', () => {
    const ix = buildIndex(docOf(sheetOf('s1', [tank('a'), valve('b')], [edge('e1', 'a', 'b')])))
    expect(runContinuity(ix).get(ix.runs[0]!.id)).toBe(ix.runs[0]!.id)
  })

  it('picks the smallest run id as the group, whatever order it joined in', () => {
    const doc = docOf(sheetOf('s1', [tank('t1'), orifice('fe1'), orifice('fe2'), tank('t2')], [
      edge('e5', 'fe1', 'fe2'), edge('e1', 't1', 'fe1'), edge('e9', 'fe2', 't2'),
    ]))
    const ix = buildIndex(doc)
    const cluster = runContinuity(ix)
    expect(new Set(cluster.values())).toEqual(new Set(['s1:e1']))
  })

  it('joins nothing across a free end or a dead end', () => {
    // Two lines ending in space near each other are not one line.
    const doc = docOf(sheetOf('s1', [], [
      edge('e1', { x: 0, y: 0 }, { x: 9, y: 0 }, { lineNumber: ln('001') }),
      edge('e2', { x: 9, y: 0 }, { x: 20, y: 0 }, { lineNumber: ln('001') }),
    ]))
    const ix = buildIndex(doc)
    expect(ix.runs).toHaveLength(2)
    expect(new Set(runContinuity(ix).values())).toHaveLength(2)
  })

  it('changes nothing about the document', () => {
    const doc = docOf(sheetOf('s1', [tank('tk1'), orifice('fe1'), tank('tk2')], [
      edge('e1', 'tk1', 'fe1', { lineNumber: ln('001') }),
      edge('e2', 'fe1', 'tk2', { lineNumber: ln('001') }),
    ]))
    const before = JSON.stringify(doc)
    runContinuity(buildIndex(doc))
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('covers every run, always', () => {
    const doc = docOf(
      sheetOf('s1', [tank('a'), orifice('fe'), tank('b'), valve('v')], [
        edge('e1', 'a', 'fe'), edge('e2', 'fe', 'b'), edge('e3', 'b', 'v'),
      ]),
      sheetOf('s2', [tank('c'), valve('d')], [edge('e4', 'c', 'd')]),
    )
    const ix = buildIndex(doc)
    const cluster = runContinuity(ix)
    expect(cluster.size).toBe(ix.runs.length)
    for (const run of ix.runs) expect(ix.runs.some((r) => r.id === cluster.get(run.id))).toBe(true)
  })
})
