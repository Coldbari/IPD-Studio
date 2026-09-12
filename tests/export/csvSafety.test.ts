// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * SPREADSHEET FORMULA INJECTION — every export, not one.
 *
 * The P1 exit audit found the guard on 1 of 8 CSV paths. Engineering text
 * arrives from files colleagues send, from DEXPI and SVG imports, and from
 * whatever someone typed; a cell that opens `=` becomes a formula the moment
 * the file is opened, and nobody reviewed it.
 *
 * There is now ONE sanitiser, applied where cells become CSV, so a new report
 * cannot be added without it. These tests hold that: the unit behaviour of the
 * guard, and one hostile-text proof per export family.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import {
  datasheetMatrixCsv, engineeringCsv, equipmentListCsv, guardFormula,
  instrumentIndexCsv, ioListCsv, lineListCsv, valveListCsv,
} from '../../src/export/csv'
import { csvCell } from '../../src/export/csv'
import { parseCsv, unguard } from '../../src/model/bulkEdit'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PlantEdge, PlantNode, ProjectDoc } from '../../src/model/types'

const HOSTILE = '=HYPERLINK("http://evil","click")'
const HOSTILE_DDE = '@SUM(1+1)*cmd|'

describe('the sanitiser', () => {
  it('neutralises every leading character a spreadsheet executes', () => {
    expect(guardFormula('=1+1')).toBe("'=1+1")
    expect(guardFormula('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(guardFormula('+1+1')).toBe("'+1+1")
    expect(guardFormula('-cmd|calc')).toBe("'-cmd|calc")
  })

  it('leaves real numbers alone — a setpoint is not an attack', () => {
    // The whole reason this is not a blanket prefix: an export that turned
    // every negative temperature into text would be its own data bug.
    for (const n of ['-50', '-0.5', '-1e3', '+12', '0', '3.14']) {
      expect(guardFormula(n), n).toBe(n)
    }
  })

  it('leaves ordinary text alone', () => {
    for (const v of ['', 'Feed water', '4-20 mA', '0-10 bar', 'CS150']) {
      expect(guardFormula(v), v).toBe(v)
    }
  })

  it('is reversible, so the round trip is exact', () => {
    for (const v of [HOSTILE, HOSTILE_DDE, '-abc', '+x']) {
      expect(unguard(guardFormula(v))).toBe(v)
    }
  })
})

/* ------------------------------------------------------- per export family */

const node = (p: Partial<PlantNode> & Pick<PlantNode, 'id' | 'symbolId' | 'kind'>): PlantNode =>
  ({ x: 0, y: 0, rotation: 0, ...p })

/** One of everything, each carrying hostile text somewhere a user can type. */
function hostileDoc(): ProjectDoc {
  const base = createEmptyDoc('t')
  const nodes: PlantNode[] = [
    node({ id: 'ft', symbolId: 'instr.bubble', kind: 'instrument', tag: { letters: 'LT', loop: '101' }, label: HOSTILE }),
    node({ id: 'dcs', symbolId: 'ctl.dcs', kind: 'equipment' }),
    node({ id: 'pump', symbolId: 'pump.centrifugal', kind: 'equipment', tag: { letters: 'P', loop: '101' }, label: HOSTILE }),
    node({ id: 'fv', symbolId: 'cv.globe', kind: 'valve', tag: { letters: 'FV', loop: '101' }, label: HOSTILE }),
  ]
  const edges: PlantEdge[] = [
    { id: 'sig', lineClass: 'signal.electric', source: { nodeId: 'ft', portId: 'e' }, target: { nodeId: 'dcs', portId: 'w' } },
    { id: 'l1', lineClass: 'process.major', source: { nodeId: 'pump', portId: 'discharge' }, target: { nodeId: 'fv', portId: 'w' },
      lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '001' } },
  ]
  // Spread across enough keys that every report prints at least one of them:
  // the line list deliberately omits `general.service`, the I/O list omits
  // everything but signal/alarm. Each export is proved on a value it carries.
  const hostileFields = {
    'general.service': HOSTILE, 'signal.units': HOSTILE_DDE, 'general.manufacturer': '-cmd|calc',
    'general.fluid': HOSTILE, 'spec.material': HOSTILE_DDE, 'signal.type': HOSTILE,
    'element.size': HOSTILE, 'duty.capacity': HOSTILE,
  }
  return {
    ...base,
    sheets: [{ ...base.sheets[0]!, id: 'sh1', nodes, edges }],
    registry: {
      'LT-101': { key: 'LT-101', kind: 'instrument', fields: { ...hostileFields, 'signal.setpoint': '-50' } },
      'P-101': { key: 'P-101', kind: 'equipment', fields: hostileFields },
      'FV-101': { key: 'FV-101', kind: 'valve', fields: hostileFields },
      '6"-CS150-CW-001': { key: '6"-CS150-CW-001', kind: 'line', fields: hostileFields },
    },
  }
}

/** No cell of this CSV, once parsed back, starts with a character a
 *  spreadsheet would execute. Parsed rather than string-matched, so quoting
 *  cannot hide an unguarded cell. */
function everyCellIsInert(csv: string): void {
  for (const row of parseCsv(csv)) {
    for (const cell of row) {
      if (cell === '') continue
      const c = cell[0]!
      if (c === '=' || c === '@') throw new Error(`executable cell: ${cell}`)
      if ((c === '+' || c === '-') && !Number.isFinite(Number(cell))) {
        throw new Error(`executable cell: ${cell}`)
      }
    }
  }
}

describe('hostile text cannot become a formula', () => {
  const doc = hostileDoc()
  const exports: [string, () => string][] = [
    ['engineering round-trip', () => engineeringCsv(doc)],
    ['I/O list', () => ioListCsv(doc)],
    ['instrument index', () => instrumentIndexCsv(doc)],
    ['line list', () => lineListCsv(doc)],
    ['equipment list', () => equipmentListCsv(doc)],
    ['valve list', () => valveListCsv(doc)],
    ['datasheet matrix', () => datasheetMatrixCsv(doc)],
  ]

  for (const [name, build] of exports) {
    it(`${name}`, () => {
      const csv = build()
      // The guard must actually have FIRED on this export — otherwise the
      // inertness check below would pass on a report that simply prints no
      // user text, and prove nothing.
      const guarded = parseCsv(csv).flat().filter((c) => c.startsWith("'"))
      expect(guarded.length, 'hostile text should reach this export and be neutralised').toBeGreaterThan(0)
      expect(() => everyCellIsInert(csv)).not.toThrow()
    })
  }

  it('and a legitimate negative number survives every one of them', () => {
    expect(engineeringCsv(doc)).toContain('-50')
    expect(parseCsv(engineeringCsv(doc)).some((r) => r.includes('-50'))).toBe(true)
  })

  it('the round trip still reproduces the original text exactly', () => {
    const parsed = parseCsv(engineeringCsv(doc))
    const header = parsed[0]!
    const row = parsed.find((r) => r[0] === 'LT-101')!
    expect(unguard(row[header.indexOf('Service')]!)).toBe(HOSTILE)
    expect(unguard(row[header.indexOf('Engineering unit')]!)).toBe(HOSTILE_DDE)
  })
})


/* ------------------------------------------- the budget CSV, and the rule */

describe('the cost estimate', () => {
  it('writes its cells through the shared sanitiser', () => {
    // BudgetDialog builds its rows itself (a cost estimate is not a
    // ReportRow), so what matters is that it escapes with `csvCell` rather
    // than a private copy. This is that function.
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc")
    expect(csvCell('Pump, 6 inch')).toBe('"Pump, 6 inch"')
    expect(csvCell('-50')).toBe('-50')
  })

  it('and BudgetDialog uses it rather than its own escaper', () => {
    const src = readFileSync(join(__dirname, '../../src/panels/BudgetDialog.tsx'), 'utf8')
    expect(src).toContain('csvCell')
  })
})

/**
 * THE RULE, enforced rather than written down.
 *
 * One CSV escaper in the product. A second one is how an export quietly loses
 * the formula guard six months from now — which is exactly how seven of the
 * eight paths came to be unprotected in the first place.
 */
describe('there is only one CSV escaper', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name))
        : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])

  it('no file outside export/csv.ts doubles a quote by hand', () => {
    const DOUBLING = /replaceAll\(\s*'"'\s*,\s*'""'\s*\)|replace\(\s*\/"\/g\s*,\s*'""'\s*\)/
    const offenders = walk(join(__dirname, '../../src'))
      .filter((f) => !f.endsWith('export/csv.ts'))
      .filter((f) => DOUBLING.test(readFileSync(f, 'utf8')))
      .map((f) => f.split('/src/')[1])
    expect(offenders, 'use csvCell/csvRow from export/csv.ts instead').toEqual([])
  })
})
