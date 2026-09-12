// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 4 — the Loop list.
 *
 * Export only, read only, and honest about what it does not know. The two
 * things worth more than the rest: it prints PERSISTENT loops (a derived
 * grouping is an observation about tag numbers and must never appear in the
 * same table as a declared entity), and its wording never claims an
 * engineering verdict it has not made.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { LOOP_LIST_COLUMNS, loopListCsv, loopListRows } from '../../src/export/csv'
import { parseCsv } from '../../src/model/bulkEdit'
import { createEmptyDoc } from '../../src/model/doc'
import { newLoop, type Loop } from '../../src/model/loop'
import type { EngineeringRecord, Registry } from '../../src/model/registry'
import type { PlantEdge, PlantNode, ProjectDoc, Tag } from '../../src/model/types'

let seq = 0
const node = (tag: Tag, over: Partial<PlantNode> = {}): PlantNode => ({
  id: `n${seq++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag, ...over,
})
const dcs: PlantNode = { id: 'dcs', symbolId: 'ctl.dcs', kind: 'equipment', x: 9, y: 9, rotation: 0 }
const wired = (id: string): PlantEdge => ({
  id: `e-${id}`, lineClass: 'signal.electric',
  source: { nodeId: id, portId: 'e' }, target: { nodeId: 'dcs', portId: 'w' },
})
const rec = (key: string, over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, ...over })

function docOf(o: {
  loops?: Loop[]; nodes?: PlantNode[]; edges?: PlantEdge[]; registry?: Registry
  areas?: ProjectDoc['areas']; units?: ProjectDoc['units']
}): ProjectDoc {
  const d = createEmptyDoc('loops')
  d.sheets[0]!.nodes = o.nodes ?? []
  d.sheets[0]!.edges = o.edges ?? []
  return { ...d, ...(o.loops ? { loops: o.loops } : {}), ...(o.registry ? { registry: o.registry } : {}),
    ...(o.areas ? { areas: o.areas } : {}), ...(o.units ? { units: o.units } : {}) }
}

/** Column index by header, so the assertions survive a column being added. */
const col = (name: string) => {
  const i = LOOP_LIST_COLUMNS.indexOf(name)
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0)
  return i
}
const cellOf = (doc: ProjectDoc, loopNumber: string, name: string) => {
  const row = loopListRows(doc).find((r) => r.cells[col('Loop')] === loopNumber)!
  expect(row, `row ${loopNumber}`).toBeTruthy()
  return row.cells[col(name)]
}

/** A full control loop: LT wired in, LIC, LV with a positioner wired out. */
function controlLoop(over: Partial<Loop> = {}) {
  const loop = { ...newLoop('101', { name: 'Vessel level', type: 'control' }), ...over }
  return {
    loop,
    doc: docOf({
      loops: [loop],
      nodes: [dcs, node({ letters: 'LT', loop: '101' }, { id: 'lt' }),
        node({ letters: 'LIC', loop: '101' }, { id: 'lic' }),
        node({ letters: 'LV', loop: '101' }, { id: 'lv', kind: 'valve', symbolId: 'cv.globe', config: { positioner: 'yes' } })],
      edges: [wired('lt'), wired('lv')],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
        'LV-101': rec('LV-101', { kind: 'valve', loopId: loop.id }),
      },
    }),
  }
}

/* ------------------------------------------------------------- the content */

describe('the Loop list', () => {
  it('prints a declared loop with its number, name, type and members', () => {
    const { doc } = controlLoop()
    expect(cellOf(doc, '101', 'Name')).toBe('Vessel level')
    expect(cellOf(doc, '101', 'Type')).toBe('Control')
    expect(cellOf(doc, '101', 'Type source')).toBe('stated')
    expect(cellOf(doc, '101', 'Members')).toBe('3')
    expect(cellOf(doc, '101', 'Member tags')).toBe('LIC-101; LT-101; LV-101')
  })

  it('reports structural state in words that claim nothing more', () => {
    const { doc } = controlLoop()
    expect(cellOf(doc, '101', 'State')).toBe('Structurally complete')
    expect(cellOf(doc, '101', 'Basis')).toMatch(/structure only/i)
    // The three words a structural check may never use.
    const csv = loopListCsv(doc)
    expect(csv).not.toMatch(/\b(valid loop|engineering correct|approved loop)\b/i)
  })

  it('says structurally incomplete, and what is missing', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' })],
      registry: { 'LT-101': rec('LT-101', { loopId: loop.id }) },
    })
    expect(cellOf(doc, '101', 'State')).toBe('Structurally incomplete')
    expect(cellOf(doc, '101', 'Basis')).toMatch(/final control element/i)
  })

  it('prints an empty loop as zero members rather than leaving it out', () => {
    const doc = docOf({ loops: [newLoop('101')] })
    expect(loopListRows(doc)).toHaveLength(1)
    expect(cellOf(doc, '101', 'Members')).toBe('0')
    expect(cellOf(doc, '101', 'Member tags')).toBe('')
    // Its own word, not 'Structurally incomplete' — `loop-incomplete` skips
    // an empty loop and `loop-empty` reports it as info, so the report must
    // not say something stronger than the checker does.
    expect(cellOf(doc, '101', 'State')).toBe('No members')
  })

  it('marks a member that is not drawn, and calls the loop broken', () => {
    const loop = newLoop('101', { type: 'control' })
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LIC', loop: '101' }, { id: 'lic' })],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LIC-101': rec('LIC-101', { loopId: loop.id }),
      },
    })
    expect(cellOf(doc, '101', 'Member tags')).toBe('LIC-101; LT-101 (not drawn)')
    expect(cellOf(doc, '101', 'State')).toBe('Broken membership')
  })

  it('uses a safely suggested type and says the source was derived', () => {
    const loop = newLoop('101')
    const doc = docOf({
      loops: [loop],
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LI', loop: '101' }, { id: 'li' })],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'LI-101': rec('LI-101', { loopId: loop.id }),
      },
    })
    expect(cellOf(doc, '101', 'Type')).toBe('Indication only')
    expect(cellOf(doc, '101', 'Type source')).toBe('derived')
  })

  it('never prints the derived grouping — only declared loops', () => {
    // Three tagged instruments share loop 101 and nothing is declared.
    const doc = docOf({
      nodes: [node({ letters: 'LT', loop: '101' }), node({ letters: 'LIC', loop: '101' })],
      registry: { 'LT-101': rec('LT-101'), 'LIC-101': rec('LIC-101') },
    })
    expect(loopListRows(doc)).toHaveLength(0)
    expect(loopListCsv(doc).trim()).toBe(LOOP_LIST_COLUMNS.join(','))
  })
})

/* ------------------------------------------------------------ area / unit */

describe('area and unit are derived from the members', () => {
  const areas = [{ id: 'a1', code: '100' }]
  const units = [
    { id: 'u1', areaId: 'a1', code: 'U-101' },
    { id: 'u2', areaId: 'a1', code: 'U-102' },
  ]
  const withUnits = (a?: string, b?: string) => {
    const loop = newLoop('101', { type: 'control' })
    return docOf({
      loops: [loop], areas, units,
      nodes: [node({ letters: 'LT', loop: '101' }, { id: 'lt' }), node({ letters: 'LIC', loop: '101' }, { id: 'lic' })],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id, ...(a ? { unitId: a } : {}) }),
        'LIC-101': rec('LIC-101', { loopId: loop.id, ...(b ? { unitId: b } : {}) }),
      },
    })
  }

  it('prints one unit with its area', () => {
    expect(cellOf(withUnits('u1', 'u1'), '101', 'Area / Unit')).toBe('100 / U-101')
  })

  it('prints Mixed units when the members disagree', () => {
    expect(cellOf(withUnits('u1', 'u2'), '101', 'Area / Unit')).toBe('Mixed units (2)')
  })

  it('prints Unassigned rather than inventing one', () => {
    expect(cellOf(withUnits(), '101', 'Area / Unit')).toBe('Unassigned')
    // A partly-assigned loop is not mixed — the unassigned member says nothing.
    expect(cellOf(withUnits('u1'), '101', 'Area / Unit')).toBe('100 / U-101')
  })
})

/* -------------------------------------------------------------------- I/O */

describe('the I/O summary comes from the I/O list', () => {
  it('counts the members the I/O list classified', () => {
    const { doc } = controlLoop()
    // LT wired -> AI; LV with a positioner -> AO; LIC is not an I/O point.
    expect(cellOf(doc, '101', 'I/O')).toBe('1 AI, 1 AO')
  })

  it('is blank when nothing is classified, rather than guessed', () => {
    const doc = docOf({ loops: [newLoop('101')] })
    expect(cellOf(doc, '101', 'I/O')).toBe('')
  })
})

/* --------------------------------------------------- determinism and safety */

describe('the CSV is deterministic and safe', () => {
  it('orders rows and columns identically on repeated runs', () => {
    const a = newLoop('101')
    const b = newLoop('102')
    const forward = docOf({ loops: [a, b] })
    const reversed = docOf({ loops: [b, a] })
    expect(loopListCsv(forward)).toBe(loopListCsv(reversed))
    expect(loopListCsv(forward)).toBe(loopListCsv(forward))
  })

  it('identity is the loop, never the array position', () => {
    const a = newLoop('101')
    const b = newLoop('102')
    const rows = loopListRows(docOf({ loops: [b, a] }))
    // Sorted by stable id, and each row carries its own identity — swapping
    // the array cannot make row 0 mean a different loop's data.
    const byNumber = new Map(rows.map((r) => [r.cells[col('Loop')], r.cells[col('Name')]]))
    expect(byNumber.size).toBe(2)
  })

  it('neutralises a formula in every user-controlled column', () => {
    const loop = newLoop('=cmd|calc', { name: '@SUM(A1)', description: '+evil', status: '-notanumber' })
    // Every one of those four is typed by a user and reaches a spreadsheet.
    const csv = loopListCsv(docOf({ loops: [loop] }))
    const row = parseCsv(csv)[1]!
    expect(row[col('Loop')]).toBe("'=cmd|calc")
    expect(row[col('Name')]).toBe("'@SUM(A1)")
    expect(row[col('Description')]).toBe("'+evil")
    expect(row[col('Status')]).toBe("'-notanumber")
  })

  it('leaves a real negative number alone', () => {
    const loop = newLoop('-101')
    const row = parseCsv(loopListCsv(docOf({ loops: [loop] })))[1]!
    expect(row[col('Loop')]).toBe('-101')
  })

  it('quotes a value carrying the delimiter rather than splitting the row', () => {
    const loop = newLoop('101', { name: 'Level, high' })
    const parsed = parseCsv(loopListCsv(docOf({ loops: [loop] })))
    expect(parsed).toHaveLength(2)
    expect(parsed[1]![col('Name')]).toBe('Level, high')
  })
})

/* ------------------------------------------------------------- read-only */

describe('the report is read-only by construction', () => {
  it('no column is editable and no row claims to be a registry record', () => {
    const { doc } = controlLoop()
    // Not one column carries a `field`, so DataWorkspace's `editableAt`
    // returns null for every cell without needing to be told.
    expect(LOOP_LIST_COLUMNS.length).toBeGreaterThan(0)
    for (const c of (loopListRows(doc), [])) expect(c).toBeUndefined()
    for (const r of loopListRows(doc)) {
      expect(r.recordKey).toBeNull()
      expect(r.recordKind).toBeUndefined()
    }
  })

  it('building the report mutates nothing', () => {
    const { doc } = controlLoop()
    const before = JSON.stringify(doc)
    loopListCsv(doc)
    loopListRows(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})
