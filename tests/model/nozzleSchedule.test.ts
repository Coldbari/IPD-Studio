// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-2 — THE NOZZLE SCHEDULE, derived.
 *
 * The load-bearing claims, in order of how much damage getting them wrong
 * would do:
 *
 *  1. A port is not a nozzle. Eleven connection points on a vessel with one
 *     entered nozzle produce ONE row.
 *  2. An orphaned record keeps its rows. Deleting the symbol is drafting, not
 *     a decision to discard a schedule.
 *  3. Nothing is read off the connected line — not size, not service.
 *  4. A positional port label never prints as a port NAME.
 *  5. Two placements of one tag are one nozzle, not two rows.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { newArea, newUnit } from '../../src/model/hierarchy'
import { newNozzle } from '../../src/model/nozzle'
import type { Nozzle } from '../../src/model/nozzle'
import {
  countEquipmentWithoutNozzles,
  deriveNozzleSchedule,
  type NozzleScheduleRow,
} from '../../src/model/nozzleSchedule'
import type { EngineeringRecord } from '../../src/model/registry'
import type { LineNumber, PlantEdge, PlantNode, ProjectDoc, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })

/** A vertical vessel — ELEVEN connection points, and none of them named by the
 *  catalogue. That combination is the point of most of this file. */
const vessel = (id: string, tag: string, over: Partial<PlantNode> = {}) =>
  node(id, 'equipment', 'vessel.vertical', { tag: tagOf(tag), ...over })
/** A centrifugal pump — the rare symbol whose catalogue NAMES its ports. */
const pump = (id: string, tag: string) =>
  node(id, 'equipment', 'pump.centrifugal', { tag: tagOf(tag) })
const tank = (id: string, tag: string) => node(id, 'equipment', 'vessel.tank', { tag: tagOf(tag) })

function tagOf(tag: string): PlantNode['tag'] {
  const [letters, loop] = tag.split('-')
  return { letters: letters!, loop: loop! }
}

const ln = (seq: string, over: Partial<LineNumber> = {}): LineNumber =>
  ({ size: '6"', spec: 'CS150', service: 'CW', seq, ...over })

const edge = (
  id: string,
  a: string | { x: number; y: number },
  b: string | { x: number; y: number },
  over: Partial<PlantEdge> & { fromPort?: string; toPort?: string } = {},
): PlantEdge => {
  const { fromPort, toPort, ...rest } = over
  return {
    id,
    lineClass: 'process.major',
    source: typeof a === 'string' ? { nodeId: a, portId: fromPort ?? 'e' } : a,
    target: typeof b === 'string' ? { nodeId: b, portId: toPort ?? 'w' } : b,
    ...rest,
  }
}

const sheetOf = (id: string, nodes: PlantNode[], edges: PlantEdge[] = [], name?: string): Sheet =>
  ({ ...createSheet(1), id, nodes, edges, ...(name ? { name } : {}) })

const record = (key: string, nozzles: Nozzle[], over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'equipment', fields: {}, nozzles, ...over })

function docOf(
  sheets: Sheet[],
  registry: Record<string, EngineeringRecord> = {},
  over: Partial<ProjectDoc> = {},
): ProjectDoc {
  return { ...createEmptyDoc('nozzles'), sheets, registry, ...over }
}

const schedule = (doc: ProjectDoc): NozzleScheduleRow[] => deriveNozzleSchedule(buildIndex(doc))

/** One vessel, tagged TK-101, with the nozzles given. */
function oneVessel(nozzles: Nozzle[], edges: PlantEdge[] = [], over: Partial<PlantNode> = {}) {
  return docOf([sheetOf('s1', [vessel('v', 'TK-101', over)], edges, 'Sheet 1')], {
    'TK-101': record('TK-101', nozzles),
  })
}

/* ------------------------------------------------------------ row shape */

describe('one row per persistent nozzle', () => {
  it('gives one nozzle one row, and the eleven unused ports none', () => {
    const rows = schedule(oneVessel([newNozzle('N1')]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.number).toBe('N1')
    // The symbol offers eleven connection points. A schedule built from those
    // would be the software inventing ten nozzles nobody specified.
    expect(buildIndex(oneVessel([newNozzle('N1')])).nodes.get('v')!.ports).toHaveLength(11)
  })

  it('gives four nozzles four rows with distinct row ids', () => {
    const rows = schedule(oneVessel([newNozzle('N1'), newNozzle('N2'), newNozzle('N3'), newNozzle('N4')]))
    expect(rows.map((r) => r.number)).toEqual(['N1', 'N2', 'N3', 'N4'])
    expect(new Set(rows.map((r) => r.rowId)).size).toBe(4)
  })

  it('produces nothing at all when no record carries a nozzle', () => {
    expect(schedule(docOf([sheetOf('s1', [vessel('v', 'TK-101')])], {
      'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'general.service': 'Feed' } },
    }))).toEqual([])
  })

  it('produces nothing for an empty document', () => {
    expect(schedule(createEmptyDoc('empty'))).toEqual([])
  })

  it('carries the equipment key and the nozzle id on every row', () => {
    const n = newNozzle('N1')
    const row = schedule(oneVessel([n]))[0]!
    expect(row.key).toBe('TK-101')
    expect(row.nozzleId).toBe(n.id)
    expect(row.rowId).toContain('TK-101')
    expect(row.rowId).toContain(n.id)
  })
})

/* ------------------------------------------------------------- ordering */

describe('ordering is deterministic', () => {
  it('sorts records by key', () => {
    const doc = docOf(
      [sheetOf('s1', [vessel('c', 'TK-103'), vessel('a', 'TK-101'), vessel('b', 'TK-102')])],
      {
        'TK-103': record('TK-103', [newNozzle('N1')]),
        'TK-101': record('TK-101', [newNozzle('N1')]),
        'TK-102': record('TK-102', [newNozzle('N1')]),
      },
    )
    expect(schedule(doc).map((r) => r.key)).toEqual(['TK-101', 'TK-102', 'TK-103'])
  })

  it('keeps the STORED nozzle order, and does not sort numbers lexicographically', () => {
    // N10 before N2 is what an engineer typed and what the Inspector shows.
    // `localeCompare` would put N10 between N1 and N2 and disagree with the
    // panel the numbers were entered in.
    const rows = schedule(oneVessel([newNozzle('N2'), newNozzle('N10'), newNozzle('N1')]))
    expect(rows.map((r) => r.number)).toEqual(['N2', 'N10', 'N1'])
  })

  it('two derivations of one document agree exactly', () => {
    const doc = oneVessel([newNozzle('N2'), newNozzle('N1')])
    expect(schedule(doc)).toEqual(schedule(doc))
  })

  it('mutates nothing it was given', () => {
    const nozzles = [newNozzle('N2'), newNozzle('N1')]
    const doc = oneVessel(nozzles)
    const before = JSON.stringify(doc)
    const ix = buildIndex(doc)
    deriveNozzleSchedule(ix)
    deriveNozzleSchedule(ix)
    expect(JSON.stringify(doc)).toBe(before)
    expect(doc.registry!['TK-101']!.nozzles!.map((n) => n.number)).toEqual(['N2', 'N1'])
  })
})

/* --------------------------------------------------------- persistent data */

describe('persistent fields are copied, and nothing else is invented', () => {
  it('carries every entered field through', () => {
    const n = newNozzle('N1', {
      size: '6"', rating: '150#', facing: 'RF', service: 'Cooling water', notes: 'spare',
      portId: 'n',
    })
    const row = schedule(oneVessel([n]))[0]!
    expect(row).toMatchObject({
      number: 'N1', size: '6"', rating: '150#', facing: 'RF',
      service: 'Cooling water', notes: 'spare', portId: 'n',
    })
  })

  it('leaves an unentered field blank rather than undefined', () => {
    const row = schedule(oneVessel([newNozzle('N1')]))[0]!
    expect([row.size, row.rating, row.facing, row.service, row.notes, row.portId]).toEqual(['', '', '', '', '', ''])
  })

  it('fills NOTHING in from the connected line', () => {
    // A 6" cooling-water line lands on the nozzle. The nozzle's own size and
    // service stay blank: reading them off the pipe would be the software
    // writing a specification.
    const doc = oneVessel(
      [newNozzle('N1', { portId: 'n' })],
      [edge('e1', 'v', { x: 99, y: 0 }, { fromPort: 'n', lineNumber: ln('001') })],
    )
    const row = schedule(doc)[0]!
    expect(row.size).toBe('')
    expect(row.service).toBe('')
    expect(row.rating).toBe('')
    expect(row.facing).toBe('')
    // The line number is reported as what it is — a derived fact, in its own
    // column — and never as the nozzle's spec.
    expect(row.lineNumbers).toEqual(['6"-CS150-CW-001'])
  })
})

/* ------------------------------------------------------------ status */

describe('connection status', () => {
  const statusOf = (doc: ProjectDoc) => schedule(doc)[0]!.status

  it('not located — the nozzle has no portId', () => {
    expect(statusOf(oneVessel([newNozzle('N1')]))).toBe('not located')
  })

  it('not drawn — nothing on any sheet wears the tag, and the nozzle still appears', () => {
    const doc = docOf([sheetOf('s1', [])], { 'V-101': record('V-101', [newNozzle('N1'), newNozzle('N2')]) })
    const rows = schedule(doc)
    expect(rows.map((r) => r.number)).toEqual(['N1', 'N2'])
    expect(rows.every((r) => r.status === 'not drawn')).toBe(true)
    expect(rows[0]!.nodeId).toBe('')
  })

  it('not drawn wins even when the nozzle also has no port', () => {
    // With nothing drawn there are no ports to check against, so every
    // question below `not drawn` is unanswerable rather than answered.
    const doc = docOf([sheetOf('s1', [])], { 'V-101': record('V-101', [newNozzle('N1', { portId: 'n' })]) })
    expect(schedule(doc)[0]!.status).toBe('not drawn')
  })

  it('port missing — the portId names nothing on the symbol', () => {
    expect(statusOf(oneVessel([newNozzle('N1', { portId: 'gone' })]))).toBe('port missing')
    // And it is NOT remapped to something that looks similar.
    expect(schedule(oneVessel([newNozzle('N1', { portId: 'gone' })]))[0]!.portId).toBe('gone')
  })

  it('no line — the port resolves and nothing is piped to it', () => {
    expect(statusOf(oneVessel([newNozzle('N1', { portId: 'n' })]))).toBe('no line')
  })

  it('connected — exactly one process line', () => {
    const doc = oneVessel(
      [newNozzle('N1', { portId: 'n' })],
      [edge('e1', 'v', { x: 99, y: 0 }, { fromPort: 'n', lineNumber: ln('001') })],
    )
    expect(statusOf(doc)).toBe('connected')
  })

  it('multiple lines — a tee drawn at the nozzle', () => {
    const doc = oneVessel([newNozzle('N1', { portId: 'n' })], [
      edge('e1', 'v', { x: 99, y: 0 }, { fromPort: 'n', lineNumber: ln('001') }),
      edge('e2', 'v', { x: 99, y: 50 }, { fromPort: 'n', lineNumber: ln('002') }),
    ])
    expect(statusOf(doc)).toBe('multiple lines')
    expect(schedule(doc)[0]!.lineNumbers).toEqual(['6"-CS150-CW-001', '6"-CS150-CW-002'])
  })

  it('a line on a DIFFERENT port leaves this nozzle unconnected', () => {
    const doc = oneVessel(
      [newNozzle('N1', { portId: 'n' })],
      [edge('e1', 'v', { x: 99, y: 0 }, { fromPort: 's', lineNumber: ln('001') })],
    )
    expect(statusOf(doc)).toBe('no line')
    expect(schedule(doc)[0]!.lineNumbers).toEqual([])
  })
})

/* ------------------------------------------------------- line derivation */

describe('connected line', () => {
  it('is blank for an unnumbered run, and no number is invented', () => {
    const doc = oneVessel(
      [newNozzle('N1', { portId: 'n' })],
      [edge('e1', 'v', { x: 99, y: 0 }, { fromPort: 'n' })],
    )
    expect(schedule(doc)[0]!.status).toBe('connected')
    expect(schedule(doc)[0]!.lineNumbers).toEqual([])
  })

  it('reports EVERY number on a run carrying several', () => {
    // A header and its branch are one connected run wearing two numbers. The
    // run model refuses to pick one, and so does this.
    const doc = docOf(
      [sheetOf('s1', [vessel('v', 'TK-101'), tank('t', 'TK-900')], [
        edge('e1', 'v', 't', { fromPort: 'n', toPort: 'w', lineNumber: ln('001') }),
        edge('e2', 'v', 't', { fromPort: 'n', toPort: 'e', lineNumber: ln('002') }),
      ])],
      { 'TK-101': record('TK-101', [newNozzle('N1', { portId: 'n' })]) },
    )
    const row = schedule(doc)[0]!
    expect(row.lineNumbers).toEqual(['6"-CS150-CW-001', '6"-CS150-CW-002'])
  })

  it('IGNORES a signal line — it is not piping and has no run', () => {
    const doc = oneVessel(
      [newNozzle('N1', { portId: 'n' })],
      [edge('e1', 'v', { x: 99, y: 0 }, { fromPort: 'n', lineClass: 'signal.electric' })],
    )
    const row = schedule(doc)[0]!
    // Not counted as a line, and no run is fabricated to hold it.
    expect(row.status).toBe('no line')
    expect(row.lineNumbers).toEqual([])
  })

  it('counts a process line and ignores a signal line on the same port', () => {
    const doc = oneVessel([newNozzle('N1', { portId: 'n' })], [
      edge('e1', 'v', { x: 99, y: 0 }, { fromPort: 'n', lineNumber: ln('001') }),
      edge('e2', 'v', { x: 99, y: 50 }, { fromPort: 'n', lineClass: 'signal.electric' }),
    ])
    expect(schedule(doc)[0]!.status).toBe('connected')
  })

  it('invents no cross-sheet continuation', () => {
    // The nozzle's line continues on sheet 2 through an off-page connector.
    // Runs are sheet-local by construction and the schedule reports the LOCAL
    // run only — it does not replace it with the continuation.
    const doc = docOf(
      [
        sheetOf('s1', [vessel('v', 'TK-101'), node('opc1', 'annotation', 'ann.offpage', { link: { nodeId: 'opc2', sheetId: 's2' } })], [
          edge('e1', 'v', 'opc1', { fromPort: 'n', toPort: 'w', lineNumber: ln('001') }),
        ], 'Sheet 1'),
        sheetOf('s2', [node('opc2', 'annotation', 'ann.offpage'), tank('t', 'TK-900')], [
          edge('e2', 'opc2', 't', { fromPort: 'e', toPort: 'w', lineNumber: ln('002') }),
        ], 'Sheet 2'),
      ],
      { 'TK-101': record('TK-101', [newNozzle('N1', { portId: 'n' })]) },
    )
    expect(schedule(doc)[0]!.lineNumbers).toEqual(['6"-CS150-CW-001'])
  })
})

/* --------------------------------------------------------- port names */

describe('port name', () => {
  it('prints the catalogue name where the catalogue establishes one', () => {
    const doc = docOf([sheetOf('s1', [pump('p', 'P-101')])], {
      'P-101': record('P-101', [newNozzle('N1', { portId: 'discharge' })]),
    })
    expect(schedule(doc)[0]!.portNames).toEqual(['Discharge'])
  })

  it('is BLANK for a positional label — a top nozzle is not an inlet', () => {
    // `vessel.vertical` names none of its eleven points. `portLabel` still
    // describes where they sit ("Top connection"), and that description must
    // never appear in an engineering column.
    const row = schedule(oneVessel([newNozzle('N1', { portId: 'n' })]))[0]!
    expect(row.portNames).toEqual([])
  })

  it('is blank for a user-added pin', () => {
    const doc = oneVessel([newNozzle('N1', { portId: 'pin-1' })], [], {
      extraPorts: [{ id: 'pin-1', x: 20, y: 20, kind: 'process' }],
    })
    const row = schedule(doc)[0]!
    expect(row.status).toBe('no line')
    expect(row.portNames).toEqual([])
  })

  it('collects the AUTHORITATIVE names across placements with different symbols', () => {
    // One tag, drawn once as a pump and once as a vessel — a legitimate
    // duplicate the `duplicate-tag` rule reports on its own. `discharge` is
    // named by the pump's catalogue and does not exist on the vessel, so the
    // vessel contributes nothing rather than a positional guess.
    const doc = docOf(
      [
        sheetOf('s1', [pump('a', 'P-101')], [], 'Sheet 1'),
        sheetOf('s2', [vessel('b', 'P-101')], [], 'Sheet 2'),
      ],
      { 'P-101': record('P-101', [newNozzle('N1', { portId: 'discharge' })]) },
    )
    const row = schedule(doc)[0]!
    expect(row.portNames).toEqual(['Discharge'])
    expect(row.symbols).toEqual(['Centrifugal Pump', 'Vertical Vessel'])
  })

  it('stays blank when NEITHER symbol names the port', () => {
    const doc = docOf(
      [
        sheetOf('s1', [vessel('a', 'TK-101')], [], 'Sheet 1'),
        sheetOf('s2', [tank('b', 'TK-101')], [], 'Sheet 2'),
      ],
      { 'TK-101': record('TK-101', [newNozzle('N1', { portId: 'n' })]) },
    )
    // Both have a port `n`; neither catalogue says what it is for.
    expect(schedule(doc)[0]!.portNames).toEqual([])
  })

  it('is blank when the nozzle has no port at all', () => {
    expect(schedule(oneVessel([newNozzle('N1')]))[0]!.portNames).toEqual([])
  })
})

/* ------------------------------------------------------- placements */

describe('several placements of one tag', () => {
  const twoPlacements = (nozzles: Nozzle[], edges: { s1?: PlantEdge[]; s2?: PlantEdge[] } = {}) =>
    docOf(
      [
        sheetOf('s1', [vessel('a', 'TK-101', { label: 'Feed drum' })], edges.s1 ?? [], 'Sheet 1'),
        sheetOf('s2', [vessel('b', 'TK-101', { label: 'Feed drum (ref)' })], edges.s2 ?? [], 'Sheet 2'),
      ],
      { 'TK-101': record('TK-101', nozzles) },
    )

  it('is ONE nozzle and ONE row, not one row per placement', () => {
    const rows = schedule(twoPlacements([newNozzle('N1')]))
    expect(rows).toHaveLength(1)
  })

  it('SORTS the derived values, so document order cannot leak into a deliverable', () => {
    // Sheet 2 is drawn first. The schedule must still read "Sheet 1; Sheet 2",
    // because the order two vessels happened to be placed in is not a fact
    // about the equipment.
    const doc = docOf(
      [
        sheetOf('s2', [vessel('b', 'TK-101', { label: 'Zulu' })], [], 'Sheet 2'),
        sheetOf('s1', [vessel('a', 'TK-101', { label: 'Alpha' })], [], 'Sheet 1'),
      ],
      { 'TK-101': record('TK-101', [newNozzle('N1')]) },
    )
    const row = schedule(doc)[0]!
    expect(row.sheetNames).toEqual(['Sheet 1', 'Sheet 2'])
    expect(row.labels).toEqual(['Alpha', 'Zulu'])
  })

  it('reports BOTH sheets and both labels rather than silently picking the first', () => {
    const row = schedule(twoPlacements([newNozzle('N1')]))[0]!
    expect(row.sheetNames).toEqual(['Sheet 1', 'Sheet 2'])
    expect(row.labels).toEqual(['Feed drum', 'Feed drum (ref)'])
    // One symbol, so one entry — distinct, not repeated.
    expect(row.symbols).toEqual(['Vertical Vessel'])
  })

  it('resolves the port against EITHER placement', () => {
    // The pin exists only on the second placement. The port is still real.
    const doc = docOf(
      [
        sheetOf('s1', [vessel('a', 'TK-101')], [], 'Sheet 1'),
        sheetOf('s2', [vessel('b', 'TK-101', { extraPorts: [{ id: 'pin-1', x: 4, y: 4, kind: 'process' }] })], [], 'Sheet 2'),
      ],
      { 'TK-101': record('TK-101', [newNozzle('N1', { portId: 'pin-1' })]) },
    )
    expect(schedule(doc)[0]!.status).toBe('no line')
  })

  it('collects the lines drawn at the port on each placement', () => {
    const doc = twoPlacements([newNozzle('N1', { portId: 'n' })], {
      s1: [edge('e1', 'a', { x: 99, y: 0 }, { fromPort: 'n', lineNumber: ln('001') })],
      s2: [edge('e2', 'b', { x: 99, y: 0 }, { fromPort: 'n', lineNumber: ln('002') })],
    })
    const row = schedule(doc)[0]!
    expect(row.lineNumbers).toEqual(['6"-CS150-CW-001', '6"-CS150-CW-002'])
    expect(row.status).toBe('multiple lines')
  })
})

/* --------------------------------------------------------- hierarchy */

describe('area and unit', () => {
  it('come from the RECORD assignment, never from the drawing', () => {
    const area = newArea('A-10', 'Utilities')
    const unit = newUnit(area.id, 'U-101', 'Cooling')
    const doc = docOf(
      [sheetOf('s1', [vessel('v', 'TK-101')])],
      { 'TK-101': record('TK-101', [newNozzle('N1'), newNozzle('N2')], { unitId: unit.id }) },
      { areas: [area], units: [unit] },
    )
    const rows = schedule(doc)
    expect(rows.map((r) => [r.areaCode, r.unitCode])).toEqual([['A-10', 'U-101'], ['A-10', 'U-101']])
  })

  it('are blank when nothing is assigned, and the nozzle still appears', () => {
    const row = schedule(oneVessel([newNozzle('N1')]))[0]!
    expect([row.areaCode, row.unitCode]).toEqual(['', ''])
  })
})

/* ------------------------------------------------------ excluded count */

describe('equipment carrying no nozzles', () => {
  it('is counted, so an exclusion cannot read as an omission', () => {
    const doc = docOf(
      [sheetOf('s1', [vessel('a', 'TK-101'), vessel('b', 'TK-102'), vessel('c', 'TK-103')])],
      {
        'TK-101': record('TK-101', [newNozzle('N1')]),
        'TK-102': record('TK-102', []),
        'TK-103': { key: 'TK-103', kind: 'equipment', fields: {} },
      },
    )
    expect(countEquipmentWithoutNozzles(buildIndex(doc))).toBe(2)
  })

  it('counts only EQUIPMENT records — a valve has no nozzle schedule', () => {
    const doc = docOf([sheetOf('s1', [])], {
      'FV-101': { key: 'FV-101', kind: 'valve', fields: {} },
      'FT-101': { key: 'FT-101', kind: 'instrument', fields: {} },
    })
    expect(countEquipmentWithoutNozzles(buildIndex(doc))).toBe(0)
  })
})
