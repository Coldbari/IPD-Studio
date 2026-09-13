// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3 PROGRAM 3 — ONE PHYSICAL RUN = ONE LINE LIST ROW.
 *
 * The list used to iterate `sheet.edges`, so a real pipe printed a row per
 * drawn segment and an unnumbered pipe printed nothing at all. It now asks
 * `ix.runs`, which is the same topology `duplicate-line-number` checks.
 *
 * Most of what follows is about what the list REFUSES to say: it never picks
 * one of several numbers, never states a flow direction, and never merges two
 * pipes because their numbers match.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { LINE_LIST_COLUMNS, LINE_LIST_SPEC, lineListCsv, lineListRows } from '../../src/export/csv'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { newArea, newUnit } from '../../src/model/hierarchy'
import type { EngineeringRecord } from '../../src/model/registry'
import type { LineNumber, PlantEdge, PlantNode, ProjectDoc, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })

const tank = (id: string, over: Partial<PlantNode> = {}) => node(id, 'equipment', 'vessel.tank', over)
const valve = (id: string) => node(id, 'valve', 'valve.gate')
const tee = (id: string) => node(id, 'fitting', 'fit.junction')
const orifice = (id: string) => node(id, 'instrument', 'fe.orifice')

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
const docOf = (...sheets: Sheet[]): ProjectDoc => ({ ...createEmptyDoc('lines'), sheets })

/** One cell of one row, by column NAME — never by position. */
const at = (doc: ProjectDoc, rowIndex: number, label: string): string =>
  lineListRows(doc)[rowIndex]!.cells[LINE_LIST_COLUMNS.indexOf(label)]!

const N1 = '6"-CS150-CW-001'
const N2 = '6"-CS150-CW-002'

/* ---------------------------------------------------------- run grouping */

describe('one physical run is one row', () => {
  it('gives a one-edge run one row', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    expect(lineListRows(doc)).toHaveLength(1)
    expect(at(doc, 0, 'Segments')).toBe('1')
  })

  it('gives a FOUR-edge run exactly one row', () => {
    // The case the P3 audit measured: pump, block valve, check valve, vessel.
    // Numbering all four honestly used to print four rows and three warnings.
    const doc = docOf(sheetOf('s1',
      [node('p1', 'equipment', 'pump.centrifugal'), valve('v1'), valve('v2'), tee('t1'), tank('tk')],
      [
        edge('e1', 'p1', 'v1', { lineNumber: ln('001') }),
        edge('e2', 'v1', 'v2', { lineNumber: ln('001') }),
        edge('e3', 'v2', 't1', { lineNumber: ln('001') }),
        edge('e4', 't1', 'tk', { lineNumber: ln('001') }),
      ]))
    expect(buildIndex(doc).runs).toHaveLength(1)
    expect(lineListRows(doc)).toHaveLength(1)
    expect(at(doc, 0, 'Line Number')).toBe(N1)
    expect(at(doc, 0, 'Segments')).toBe('4')
  })

  it('gives a ten-edge run one row', () => {
    const nodes: PlantNode[] = [tank('start'), ...Array.from({ length: 9 }, (_, i) => valve(`v${i}`)), tank('end')]
    const chain = ['start', ...Array.from({ length: 9 }, (_, i) => `v${i}`), 'end']
    const edges = chain.slice(0, -1).map((from, i) => edge(`e${i}`, from, chain[i + 1]!, { lineNumber: ln('001') }))
    const doc = docOf(sheetOf('s1', nodes, edges))
    expect(edges).toHaveLength(10)
    expect(lineListRows(doc)).toHaveLength(1)
    expect(at(doc, 0, 'Segments')).toBe('10')
  })

  it('lists an UNNUMBERED run, which the old list dropped entirely', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b')]))
    expect(lineListRows(doc)).toHaveLength(1)
    expect(at(doc, 0, 'Line Number')).toBe('')
    expect(at(doc, 0, 'Numbering')).toBe('unnumbered')
    // Nothing to hang a record on, so the row prints and cannot be edited.
    expect(lineListRows(doc)[0]!.recordKey).toBeNull()
  })

  it('leaves signal lines out — they are wired, not piped', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [
      edge('sig', 'a', 'b', { lineClass: 'signal.electric', lineNumber: ln('001') }),
    ]))
    expect(lineListRows(doc)).toEqual([])
  })

  it('reports each line class a run is drawn in', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), valve('v'), tank('b')], [
      edge('e1', 'a', 'v', { lineNumber: ln('001') }),
      edge('e2', 'v', 'b', { lineClass: 'pipe.jacketed', lineNumber: ln('001') }),
    ]))
    expect(lineListRows(doc)).toHaveLength(1)
    expect(at(doc, 0, 'Class')).toBe('pipe.jacketed, process.major')
  })
})

/* -------------------------------------------------------------- numbering */

describe('numbering is stated, never chosen', () => {
  it('prints the single number and its parts', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    expect(at(doc, 0, 'Line Number')).toBe(N1)
    expect([at(doc, 0, 'Size'), at(doc, 0, 'Spec'), at(doc, 0, 'Service'), at(doc, 0, 'Seq')])
      .toEqual(['6"', 'CS150', 'CW', '001'])
    expect(at(doc, 0, 'Numbering')).toBe('')
  })

  it('takes the parts from an edge that WEARS the number, not by re-splitting it', () => {
    // A separator inside a part would make re-splitting the joined key wrong.
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')],
      [edge('e1', 'a', 'b', { lineNumber: { size: '6"', spec: 'CS-150', service: 'CW', seq: '001' } })]))
    expect(at(doc, 0, 'Spec')).toBe('CS-150')
    expect(at(doc, 0, 'Line Number')).toBe('6"-CS-150-CW-001')
  })

  it('refuses to pick one of several numbers on one physical run', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), valve('v'), tank('b')], [
      edge('e1', 'a', 'v', { lineNumber: ln('001') }),
      edge('e2', 'v', 'b', { lineNumber: ln('002') }),
    ]))
    expect(lineListRows(doc)).toHaveLength(1)
    expect(at(doc, 0, 'Line Number')).toBe('')
    expect(at(doc, 0, 'Numbering')).toBe(`2 numbers: ${N1}; ${N2}`)
    // No parts either: parts of two different numbers in one cell mean nothing.
    expect([at(doc, 0, 'Size'), at(doc, 0, 'Seq')]).toEqual(['', ''])
    // And no record, because there is no single record to edit through.
    expect(lineListRows(doc)[0]!.recordKey).toBeNull()
  })

  it('says nothing judgemental about a header carrying branch numbers', () => {
    // Program 2 established this is a legitimate pattern. The list states the
    // fact and stops; the word "conflict" appears nowhere.
    const doc = docOf(sheetOf('s1', [tank('a'), tee('t'), tank('b'), tank('c')], [
      edge('e1', 'a', 't', { lineNumber: ln('001', { size: '12"' }) }),
      edge('e2', 't', 'b', { lineNumber: ln('010', { size: '2"' }) }),
      edge('e3', 't', 'c', { lineNumber: ln('011', { size: '2"' }) }),
    ]))
    expect(at(doc, 0, 'Numbering')).toMatch(/^3 numbers: /)
    expect(lineListCsv(doc).toLowerCase()).not.toContain('conflict')
    expect(lineListCsv(doc).toLowerCase()).not.toContain('error')
  })

  it('still names the number when only some segments carry it', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), valve('v'), tank('b')], [
      edge('e1', 'a', 'v', { lineNumber: ln('001') }),
      edge('e2', 'v', 'b'),
    ]))
    expect(at(doc, 0, 'Line Number')).toBe(N1)
    expect(at(doc, 0, 'Numbering')).toBe('')
    expect(at(doc, 0, 'Segments')).toBe('2')
  })

  it('distinguishes unnumbered from a blank line-number object', () => {
    const blank: LineNumber = { size: '', spec: '', service: '', seq: '' }
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: blank })]))
    expect(at(doc, 0, 'Numbering')).toBe('unnumbered')
  })
})

/* ------------------------------------------------ disconnected, same number */

describe('two pipes with one number stay two rows', () => {
  it('never merges disconnected runs', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b'), tank('c'), tank('d')], [
      edge('e1', 'a', 'b', { lineNumber: ln('001') }),
      edge('e2', 'c', 'd', { lineNumber: ln('001') }),
    ]))
    const rows = lineListRows(doc)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.cells[0])).toEqual([N1, N1])
    // Both rows join the same record — which is what one line number means.
    expect(rows.map((r) => r.recordKey)).toEqual([N1, N1])
  })

  it('keeps a cross-sheet continuation as two rows, one per sheet', () => {
    const doc = docOf(
      sheetOf('s1', [tank('a'), node('op1', 'annotation', 'ann.offpage', { link: { sheetId: 's2', nodeId: 'op2' } })],
        [edge('e1', 'a', 'op1', { lineNumber: ln('001') })]),
      sheetOf('s2', [node('op2', 'annotation', 'ann.offpage'), tank('b')],
        [edge('e2', 'op2', 'b', { lineNumber: ln('001') })]),
    )
    // The line list is a projection of physical runs, and a run never crosses
    // a sheet. That the two are one line is `duplicate-line-number`'s business,
    // and it stays silent — see tests/validate/runQa.test.ts.
    expect(lineListRows(doc)).toHaveLength(2)
    expect(lineListRows(doc).map((r) => r.sheetId)).toEqual(['s1', 's2'])
  })
})

/* -------------------------------------------------------------- endpoints */

describe('endpoints are topology, not direction', () => {
  it('names both ends of an ordinary two-ended run', () => {
    const doc = docOf(sheetOf('s1',
      [tank('tk1', { tag: { letters: 'TK', loop: '101' } }), valve('v'), tank('tk2', { label: 'Day tank' })],
      [edge('e1', 'tk1', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'tk2', { lineNumber: ln('001') })]))
    expect(at(doc, 0, 'From')).toBe('TK-101')
    expect(at(doc, 0, 'To')).toBe('Day tank')
    expect(at(doc, 0, 'Ends')).toBe('TK-101; Day tank')
  })

  it('reports a free end as a free end', () => {
    const doc = docOf(sheetOf('s1', [tank('a', { label: 'T-900' })],
      [edge('e1', { x: 0, y: 0 }, 'a', { lineNumber: ln('001') })]))
    expect(at(doc, 0, 'From')).toBe('free end')
    expect(at(doc, 0, 'To')).toBe('T-900')
  })

  it('falls back tag, then label, then symbol name — never a node id', () => {
    // The same ladder `nodeName` uses for every other report. An id is not
    // something an engineer reads, so it never reaches a deliverable.
    const doc = docOf(sheetOf('s1',
      [tank('withTag', { tag: { letters: 'TK', loop: '1' } }), tee('t'), tank('withLabel', { label: 'Day tank' }), tank('bare')],
      [edge('e1', 'withTag', 't'), edge('e2', 't', 'withLabel'), edge('e3', 't', 'bare')]))
    expect(at(doc, 0, 'Ends')).toBe('TK-1; Day tank; Storage Tank')
  })

  it('does NOT collapse a branched run into a false From/To pair', () => {
    const doc = docOf(sheetOf('s1',
      [tank('a', { label: 'Feed drum' }), tee('t'), tank('b', { label: 'Product tank' }), tank('c', { label: 'Slops' })], [
        edge('e1', 'a', 't', { lineNumber: ln('001') }),
        edge('e2', 't', 'b', { lineNumber: ln('001') }),
        edge('e3', 't', 'c', { lineNumber: ln('001') }),
      ]))
    expect(at(doc, 0, 'From')).toBe('3 ends')
    expect(at(doc, 0, 'To')).toBe('3 ends')
    // Nothing is lost: the Ends column carries all three, and they are three
    // DIFFERENT terminals — a run through a tee genuinely has no From/To pair.
    expect(at(doc, 0, 'Ends')).toBe('Feed drum; Product tank; Slops')
  })

  it('says so when a run has no open ends at all', () => {
    const doc = docOf(sheetOf('s1', [valve('v1'), valve('v2')], [
      edge('e1', 'v1', 'v2', { lineNumber: ln('001') }),
      edge('e2', 'v2', 'v1', { lineNumber: ln('001') }),
    ]))
    expect(at(doc, 0, 'Ends')).toBe('(no open ends)')
    expect([at(doc, 0, 'From'), at(doc, 0, 'To')]).toEqual(['', ''])
  })

  it('orders the ends the same way twice, whatever order the sheet holds them', () => {
    const A = tank('a', { label: 'Feed drum' })
    const B = tank('b', { label: 'Product tank' })
    const C = tank('c', { label: 'Slops' })
    const forward = docOf(sheetOf('s1', [A, tee('t'), B, C], [
      edge('e1', 'a', 't'), edge('e2', 't', 'b'), edge('e3', 't', 'c'),
    ]))
    const shuffled = docOf(sheetOf('s1', [C, B, tee('t'), A], [
      edge('e3', 't', 'c'), edge('e1', 'a', 't'), edge('e2', 't', 'b'),
    ]))
    expect(at(forward, 0, 'Ends')).toBe('Feed drum; Product tank; Slops')
    expect(at(shuffled, 0, 'Ends')).toBe(at(forward, 0, 'Ends'))
  })

  it('does not use the flow arrow to orient From and To', () => {
    // `edge.arrow` is the only direction evidence in the document and it is
    // per edge. Reversing it must change nothing in the list.
    const base = (arrow: PlantEdge['arrow']) => docOf(sheetOf('s1', [tank('a'), tank('b')],
      [edge('e1', 'a', 'b', { lineNumber: ln('001'), arrow })]))
    expect(lineListRows(base('flow'))[0]!.cells).toEqual(lineListRows(base('none'))[0]!.cells)
  })
})

/* ----------------------------------------------------------- determinism */

describe('the list is deterministic', () => {
  const busy = () => docOf(
    sheetOf('s2', [tank('x'), valve('vx'), tank('y')], [
      edge('z1', 'x', 'vx', { lineNumber: ln('009') }), edge('z2', 'vx', 'y', { lineNumber: ln('009') }),
    ]),
    sheetOf('s1', [tank('a'), tank('b'), tank('c'), orifice('fe')], [
      edge('m2', 'a', 'b', { lineNumber: ln('002') }),
      edge('m1', 'b', 'fe'), edge('m3', 'fe', 'c'),
    ]),
  )

  it('produces identical rows and identical CSV from two calls', () => {
    const doc = busy()
    expect(lineListRows(doc)).toEqual(lineListRows(doc))
    expect(lineListCsv(doc)).toBe(lineListCsv(doc))
  })

  it('orders rows by sheet, then by the run id', () => {
    const doc = busy()
    const ix = buildIndex(doc)
    expect(lineListRows(doc).map((r) => r.id)).toEqual(ix.runs.map((r) => r.edgeIds[0]))
    expect(lineListRows(doc).map((r) => r.sheetId)).toEqual(ix.runs.map((r) => r.sheetId))
  })

  it('changes nothing about the document', () => {
    const doc = busy()
    const before = JSON.stringify(doc)
    lineListRows(doc)
    lineListCsv(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

/* ------------------------------------------------------------ CSV safety */

describe('CSV safety is unchanged', () => {
  it('neutralises a formula in every cell a run can reach', () => {
    const doc = docOf(sheetOf('s1',
      [tank('a', { label: '=cmd|calc' }), tank('b', { label: '+SUM(A1)' })],
      [edge('e1', 'a', 'b', { lineNumber: { size: '=1+1', spec: '@x', service: '-9', seq: '001' } })]))
    const csv = lineListCsv(doc)
    // Every dangerous lead character is quoted away by the shared `csvCell`.
    expect(csv).not.toMatch(/(^|,)=/m)
    expect(csv).not.toMatch(/(^|,)\+/m)
    expect(csv).not.toMatch(/(^|,)@/m)
    expect(csv).toContain("'=cmd|calc")
    expect(csv).toContain("'=1+1")
  })

  it('quotes an embedded quote and keeps the header row stable', () => {
    const doc = docOf(sheetOf('s1', [tank('a', { label: 'Feed, "main"' }), tank('b')],
      [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    expect(lineListCsv(doc)).toContain('"Feed, ""main"""')
    expect(lineListCsv(doc).split('\n')[0]).toBe(LINE_LIST_COLUMNS.map((c) => (/[",\n]/.test(c) ? `"${c}"` : c)).join(','))
  })
})

/* ------------------------------------------------- the field-coverage ledger */

/**
 * WHERE EVERY COLUMN COMES FROM, now that the row is a run.
 *
 * The same discipline `DOC_FIELD_COVERAGE` applies to the revision diff: a
 * column added without a ruling fails the test below rather than shipping with
 * nobody having decided what it means at run level.
 */
type Source =
  /** Read straight off the derived `Run`. */
  | 'run'
  /** The engineering record, joined on the run's one line number. */
  | 'registry'
  /** The sheet or the run's topology (`runEnds`). */
  | 'topology'
  /** Edge-specific, so aggregated deterministically over the run's edges. */
  | 'aggregated'

const FIELD_COVERAGE: Record<string, Source> = {
  'Line Number': 'run',
  Class: 'aggregated',
  Size: 'run',
  Spec: 'run',
  Service: 'run',
  Seq: 'run',
  Sheet: 'topology',
  From: 'topology',
  To: 'topology',
  Fluid: 'registry',
  'Nominal size': 'registry',
  'Pipe class / rating': 'registry',
  Material: 'registry',
  'Schedule / thickness': 'registry',
  'Design pressure': 'registry',
  'Design temperature': 'registry',
  'Operating pressure': 'registry',
  'Operating temperature': 'registry',
  Insulation: 'registry',
  Tracing: 'registry',
  'Test pressure': 'registry',
  Area: 'registry',
  Unit: 'registry',
  Segments: 'run',
  Ends: 'topology',
  Numbering: 'run',
}

describe('every line-list column has a ruling', () => {
  it('covers exactly the columns the report prints', () => {
    expect([...LINE_LIST_COLUMNS].sort()).toEqual(Object.keys(FIELD_COVERAGE).sort())
  })

  it('kept every original column at its original position', () => {
    expect(LINE_LIST_SPEC.slice(0, 9).map((c) => c.label)).toEqual([
      'Line Number', 'Class', 'Size', 'Spec', 'Service', 'Seq', 'Sheet', 'From', 'To',
    ])
    // Area and Unit have not moved either; the new columns went on the end.
    expect(LINE_LIST_SPEC.slice(-3).map((c) => c.label)).toEqual(['Segments', 'Ends', 'Numbering'])
  })

  it('leaves every registry column editable and every derived one read-only', () => {
    for (const column of LINE_LIST_SPEC) {
      const source = FIELD_COVERAGE[column.label]!
      // A `field` is what makes a cell editable in the Data workspace. Only a
      // registry-backed column may carry one; nothing else has anywhere to
      // write to.
      if (source === 'registry' && !column.assign) expect(column.field, column.label).toBeTruthy()
      else expect(column.field, column.label).toBeUndefined()
    }
  })

  it('has no column that lost its meaning at run level', () => {
    // Nothing was dropped. If a future column cannot be stated for a run, it
    // belongs in a different report rather than printed as a guess.
    expect(Object.values(FIELD_COVERAGE)).not.toContain('invalid')
  })
})

/* ------------------------------------- P3 audit P1-1: multi-number records */

/**
 * A run carrying two numbers used to print BLANK registry and hierarchy cells,
 * because the row resolved its record through `run.number` — which is
 * undefined the moment there is more than one. Both records existed and were
 * filled in; the deliverable simply stopped showing them, and since a line
 * record is editable only through this table, they became unreachable too.
 *
 * They are aggregated now, by the same rule the `Class` column already used:
 * distinct non-empty values, sorted, joined. Where two records disagree, BOTH
 * are printed. Nothing is merged, reinterpreted or chosen.
 */
describe('a multi-number run keeps every record behind it', () => {
  const AREA = newArea('100')
  const UNIT_A = newUnit(AREA.id, 'U-101')
  const UNIT_B = newUnit(AREA.id, 'U-202')

  const rec = (key: string, fields: Record<string, string>, unitId?: string): EngineeringRecord =>
    ({ key, kind: 'line', fields, ...(unitId ? { unitId } : {}) })

  /** A 12" header and its 2" branch: one connected run, two numbers, two
   *  records that legitimately disagree about material and size. */
  function header(): ProjectDoc {
    const big = { size: '12"', spec: 'CS150', service: 'CW', seq: '001' }
    const small = { size: '2"', spec: 'CS300', service: 'CW', seq: '010' }
    const base = docOf(sheetOf('s1', [tank('a', { label: 'Feed drum' }), tee('t'), tank('b', { label: 'Product tank' })], [
      edge('e1', 'a', 't', { lineNumber: big }),
      edge('e2', 't', 'b', { lineNumber: small }),
    ]))
    return {
      ...base,
      areas: [AREA],
      units: [UNIT_A, UNIT_B],
      registry: {
        '12"-CS150-CW-001': rec('12"-CS150-CW-001', {
          'general.fluid': 'Cooling water',
          'spec.size': 'DN300',
          'spec.class': 'CS150',
          'spec.material': 'Carbon Steel',
          'design.pressure': '16 barg',
        }, UNIT_A.id),
        '2"-CS300-CW-010': rec('2"-CS300-CW-010', {
          'general.fluid': 'Cooling water',
          'spec.size': 'DN50',
          'spec.class': 'CS300',
          'spec.material': 'Stainless Steel',
          'design.pressure': '16 barg',
        }, UNIT_B.id),
      },
    }
  }

  it('is still exactly one row for one physical run', () => {
    const doc = header()
    expect(buildIndex(doc).runs).toHaveLength(1)
    expect(lineListRows(doc)).toHaveLength(1)
    expect(at(doc, 0, 'Segments')).toBe('2')
  })

  it('still names both numbers and still picks neither', () => {
    const doc = header()
    expect(at(doc, 0, 'Line Number')).toBe('')
    expect(at(doc, 0, 'Numbering')).toBe('2 numbers: 12"-CS150-CW-001; 2"-CS300-CW-010')
    expect(lineListRows(doc)[0]!.recordKey).toBeNull()
  })

  it('prints BOTH values where the two records disagree', () => {
    const doc = header()
    expect(at(doc, 0, 'Material')).toBe('Carbon Steel; Stainless Steel')
    expect(at(doc, 0, 'Pipe class / rating')).toBe('CS150; CS300')
    expect(at(doc, 0, 'Nominal size')).toBe('DN300; DN50')
  })

  it('prints one value where the two records agree', () => {
    const doc = header()
    expect(at(doc, 0, 'Fluid')).toBe('Cooling water')
    expect(at(doc, 0, 'Design pressure')).toBe('16 barg')
  })

  it('discards nothing: every populated value reaches the row', () => {
    const doc = header()
    const printed = lineListRows(doc)[0]!.cells.join('\u0000')
    for (const record of Object.values(doc.registry!)) {
      for (const value of Object.values(record.fields)) {
        expect(printed, `${record.key} -> ${value}`).toContain(value)
      }
    }
  })

  it('aggregates the hierarchy the same way, and never infers one', () => {
    const doc = header()
    // Both records sit in area 100, in two different units. One area, two units.
    expect(at(doc, 0, 'Area')).toBe('100')
    expect(at(doc, 0, 'Unit')).toBe('U-101; U-202')
  })

  it('leaves an unassigned record out rather than blanking the assigned one', () => {
    const doc = header()
    const reg = { ...doc.registry! }
    reg['2"-CS300-CW-010'] = { ...reg['2"-CS300-CW-010']!, unitId: undefined }
    const one = { ...doc, registry: reg }
    expect(at(one, 0, 'Unit')).toBe('U-101')
    expect(at(one, 0, 'Area')).toBe('100')
  })

  it('stays read-only, because there is no one record to edit', () => {
    const doc = header()
    expect(lineListRows(doc)[0]!.recordKey).toBeNull()
    expect(lineListRows(doc)[0]!.recordKind).toBe('line')
  })

  it('serialises the aggregate as one field — the separator is not a delimiter', () => {
    const doc = header()
    const lines = lineListCsv(doc).trim().split('\n')
    // Two numbers, still one row.
    expect(lines).toHaveLength(2)
    // `; ` needs no quoting precisely because it is not a comma, so it is
    // emitted bare and the field count is unchanged.
    expect(lines[1]!).toContain('Carbon Steel; Stainless Steel')
    expect(lines[1]!).toContain('U-101; U-202')
  })

  it('still escapes an aggregated value that IS dangerous', () => {
    const doc = header()
    const reg = { ...doc.registry! }
    reg['12"-CS150-CW-001'] = {
      ...reg['12"-CS150-CW-001']!,
      fields: { ...reg['12"-CS150-CW-001']!.fields, 'spec.material': '=cmd|calc' },
    }
    reg['2"-CS300-CW-010'] = {
      ...reg['2"-CS300-CW-010']!,
      fields: { ...reg['2"-CS300-CW-010']!.fields, 'spec.material': 'A106, Gr "B"' },
    }
    const csv = lineListCsv({ ...doc, registry: reg })
    // The shared `csvCell` runs over the JOINED cell, so the aggregate is
    // guarded as one value: '=' sorts before 'A', leads the cell and picks up
    // the apostrophe; the comma and the quotes then force the whole field to
    // be quoted, with its own quotes doubled.
    expect(csv).toContain(`"'=cmd|calc; A106, Gr ""B"""`)
    // Nothing in the file starts a cell with a formula lead.
    expect(csv).not.toMatch(/(^|,)=/m)
    // Still one row: the comma sits inside a quoted field, not a new column.
    expect(csv.trim().split('\n')).toHaveLength(2)
  })

  it('changes nothing about the document', () => {
    const doc = header()
    const before = JSON.stringify(doc)
    lineListCsv(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

/* ------------------------------- P3 audit P1-1: single-number regression */

describe('a single-number run prints exactly what it printed before', () => {
  const AREA = newArea('200')
  const UNIT = newUnit(AREA.id, 'U-900')

  function plain(): ProjectDoc {
    const base = docOf(sheetOf('s1', [tank('a', { label: 'Feed drum' }), valve('v'), tank('b', { label: 'Product tank' })], [
      edge('e1', 'a', 'v', { lineNumber: ln('001') }),
      edge('e2', 'v', 'b', { lineNumber: ln('001') }),
    ]))
    return {
      ...base,
      areas: [AREA],
      units: [UNIT],
      registry: {
        [N1]: {
          key: N1,
          kind: 'line',
          unitId: UNIT.id,
          fields: {
            'general.fluid': 'Cooling water',
            'spec.size': 'DN150',
            'spec.class': 'CS150',
            'spec.material': 'A106 Gr B',
            'spec.schedule': 'Sch 40',
            'design.pressure': '16 barg',
            'design.temperature': '120 C',
            'design.operatingPressure': '8 barg',
            'design.operatingTemperature': '45 C',
            'design.insulation': 'PP 50mm',
            'design.tracing': 'Electric',
            'design.testPressure': '24 barg',
          },
        },
      },
    }
  }

  it('produces the exact cell array, column for column', () => {
    expect(lineListRows(plain())[0]!.cells).toEqual([
      N1, 'process.major', '6"', 'CS150', 'CW', '001', 'Sheet 1', 'Feed drum', 'Product tank',
      'Cooling water', 'DN150', 'CS150', 'A106 Gr B', 'Sch 40',
      '16 barg', '120 C', '8 barg', '45 C', 'PP 50mm', 'Electric', '24 barg',
      '200', 'U-900',
      '2', 'Feed drum; Product tank', '',
    ])
  })

  it('keeps its record key and stays editable', () => {
    const row = lineListRows(plain())[0]!
    expect(row.recordKey).toBe(N1)
    expect(row.recordKind).toBe('line')
  })

  it('still prints nothing for a field the record does not carry', () => {
    const doc = plain()
    const reg = { ...doc.registry! }
    reg[N1] = { ...reg[N1]!, fields: { 'spec.material': 'A106 Gr B' } }
    expect(at({ ...doc, registry: reg }, 0, 'Fluid')).toBe('')
    expect(at({ ...doc, registry: reg }, 0, 'Material')).toBe('A106 Gr B')
  })

  it('still prints nothing when the number names no record at all', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    expect(at(doc, 0, 'Material')).toBe('')
    expect(at(doc, 0, 'Area')).toBe('')
    expect(lineListRows(doc)[0]!.recordKey).toBe(N1)
  })
})
