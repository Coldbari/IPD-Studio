// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE DRAWING MUST DESCRIBE THE ISSUE, NOT THE PRINT.
 *
 * The defect this file exists for: the title block stamped `new Date()` into
 * the DATE field, so printing an issued Rev B tomorrow produced a controlled
 * drawing dated tomorrow. Every other check here follows from the same rule —
 * what is on the sheet comes off the frozen revision record, and where there
 * is no record there is a blank rather than a guess.
 *
 * `titleBlockSvg` is pure, so these exercise the real render that SVG, PNG and
 * both PDF paths all reach through `exportSvg`.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createEmptyDoc } from '../../src/model/doc'
import { titleBlockSvg } from '../../src/export/svg'
import { standardProvenance } from '../../src/model/provenance'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import type { ProjectDoc, Revision, Sheet } from '../../src/model/types'

const ISSUED: Revision = {
  id: 'r1', code: 'B', date: '2026-03-04', description: 'Relief valve added',
  preparedBy: 'P Nagpure', checkedBy: 'R Nair', approvedBy: 'A Bose',
  status: 'IFC', issuedAt: '2026-03-05T09:00:00.000Z',
  standard: standardProvenance({ ...DEFAULT_STANDARD, id: 'acme', name: 'Acme Standard', version: '2.1' }),
  qaAtIssue: { critical: 0, warning: 2, info: 4, total: 6 },
}

function docOf(over: Partial<ProjectDoc> = {}, sheetOver: Partial<Sheet> = {}): ProjectDoc {
  const base = createEmptyDoc('Crude Unit')
  return {
    ...base,
    sheets: [{ ...base.sheets[0]!, name: 'Sheet 1', drawingNumber: 'PID-1001', ...sheetOver }],
    ...over,
  }
}

const render = (doc: ProjectDoc, i = 0) => titleBlockSvg(doc, doc.sheets[i]!)
/** The text the block shows, with markup removed — so an assertion about what
 *  the drawing SAYS cannot be broken by moving a coordinate. */
const words = (svg: string) => svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

describe('13. an issued revision prints its ISSUE date, never the print date', () => {
  const doc = docOf({}, { revision: 'B', revisions: [ISSUED] })

  it('prints the date the engineer dated it', () => {
    expect(words(render(doc))).toContain('2026-03-04')
  })

  it('does not print today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(render(doc)).not.toContain(today)
  })

  it('falls back to the issue timestamp when the row was never dated', () => {
    const undated = docOf({}, { revision: 'B', revisions: [{ ...ISSUED, date: '' }] })
    expect(words(render(undated))).toContain('2026-03-05')
  })
})

describe('14. the issue is described from the frozen row', () => {
  const out = words(render(docOf({}, { revision: 'B', revisions: [ISSUED] })))

  it('revision code, status and the three names', () => {
    for (const v of ['IFC', 'P Nagpure', 'R Nair', 'A Bose']) expect(out, v).toContain(v)
  })

  it('and the standard it was judged by', () => {
    expect(out).toContain('CHECKED AGAINST')
    expect(out).toContain('Acme Standard v2.1')
    expect(out).toContain(ISSUED.standard!.fingerprint.slice(0, 8))
  })

  it('a revision issued before provenance existed says so rather than guessing', () => {
    const { standard, ...legacy } = ISSUED
    void standard
    const out2 = words(render(docOf({}, { revision: 'B', revisions: [legacy] })))
    expect(out2).toContain('not recorded')
    expect(out2).not.toContain('Acme')
  })
})

describe('18. work in progress is not disguised as an issue', () => {
  const wip = docOf({}, {
    revision: 'B',
    revisions: [ISSUED, { id: 'r2', code: 'C', date: '', description: 'In progress', preparedBy: 'PN', status: 'WIP' }],
  })

  it('the title block says NOT ISSUED', () => {
    expect(words(render(wip))).toContain('NOT ISSUED')
  })

  it('and labels the standard as the current one, not an issue record', () => {
    expect(words(render(wip))).toContain('CURRENT STANDARD (NOT AN ISSUE RECORD)')
  })

  it('a drawing that has never been issued is also marked NOT ISSUED', () => {
    expect(words(render(docOf()))).toContain('NOT ISSUED')
  })
})

describe('15. the revision table', () => {
  const second: Revision = { ...ISSUED, id: 'r0', code: 'A', date: '2026-01-02', description: 'First issue', status: 'IFR' }

  it('lists issued rows with their stored values', () => {
    const out = words(render(docOf({}, { revision: 'B', revisions: [second, ISSUED] })))
    for (const v of ['REV', 'DESCRIPTION', 'First issue', '2026-01-02', 'IFR', 'Relief valve added', 'IFC']) {
      expect(out, v).toContain(v)
    }
  })

  it('newest first', () => {
    const out = words(render(docOf({}, { revision: 'B', revisions: [second, ISSUED] })))
    expect(out.indexOf('Relief valve added')).toBeLessThan(out.indexOf('First issue'))
  })

  it('shows issued rows only — a draft is not history', () => {
    const out = words(render(docOf({}, {
      revision: 'B',
      revisions: [ISSUED, { id: 'r2', code: 'C', date: '', description: 'Still drafting', preparedBy: 'PN', status: 'WIP' }],
    })))
    expect(out).toContain('Relief valve added')
    expect(out).not.toContain('Still drafting')
  })

  it('says so when there is nothing issued', () => {
    expect(words(render(docOf()))).toContain('No revisions issued')
  })

  it('caps long histories and counts what it left out', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...ISSUED, id: `r${i}`, code: String(i), description: `Issue ${i}` }))
    const out = words(render(docOf({}, { revision: '8', revisions: many })))
    expect(out).toContain('+ 3 earlier revisions')
    expect(out).toContain('Issue 8')
    expect(out).not.toContain('Issue 2')
  })

  it('is deterministic — the same document renders identically', () => {
    const doc = docOf({}, { revision: 'B', revisions: [second, ISSUED] })
    expect(render(doc)).toBe(render(doc))
  })

  it('is read off the stored row, not recomputed from the live document', () => {
    // The live project is on a different standard and a different author; the
    // historical row must be unmoved by either.
    const base = createEmptyDoc('x')
    const doc = docOf(
      {
        meta: { ...base.meta, name: 'Crude Unit', author: 'Someone Else' },
        standard: { ...DEFAULT_STANDARD, id: 'other', name: 'Other Standard' },
      },
      { revision: 'B', revisions: [ISSUED] },
    )
    const out = words(render(doc))
    expect(out).toContain('Acme Standard v2.1')
    expect(out).not.toContain('Other Standard')
    expect(out).toContain('P Nagpure')
  })
})

describe('16. sheet X of Y', () => {
  it('counts the sheets of the document and locates this one', () => {
    const base = createEmptyDoc('multi')
    const doc: ProjectDoc = {
      ...base,
      sheets: [
        { ...base.sheets[0]!, id: 's1', name: 'Sheet 1' },
        { ...base.sheets[0]!, id: 's2', name: 'Sheet 2' },
        { ...base.sheets[0]!, id: 's3', name: 'Sheet 3' },
      ],
    }
    expect(words(render(doc, 0))).toContain('1 of 3')
    expect(words(render(doc, 1))).toContain('2 of 3')
    expect(words(render(doc, 2))).toContain('3 of 3')
  })
})

describe('17. absent metadata is blank, never invented', () => {
  it('every controlled field has a labelled place, empty or not', () => {
    const out = words(render(docOf()))
    for (const label of ['CLIENT', 'PROJECT No.', 'PLANT / FACILITY', 'DISCIPLINE', 'DOCUMENT No.']) {
      expect(out, label).toContain(label)
    }
    expect(out).toContain('—')
  })

  it('prints what IS filled in', () => {
    const base = createEmptyDoc('Crude Unit')
    const doc = docOf({
      meta: {
        ...base.meta, name: 'Crude Unit', client: 'Northern Refining',
        projectNumber: 'J-4471', plant: 'Teesside', discipline: 'Process',
        documentNumber: 'NR-J4471-PID',
      },
    })
    const out = words(render(doc))
    for (const v of ['Northern Refining', 'J-4471', 'Teesside', 'Process', 'NR-J4471-PID', 'PID-1001']) {
      expect(out, v).toContain(v)
    }
  })

  it('escapes text rather than letting it break the SVG', () => {
    const base = createEmptyDoc('x')
    const doc = docOf({ meta: { ...base.meta, name: 'A & B <hostile>', client: '"quoted"' } })
    const svg = render(doc)
    expect(svg).toContain('&amp;')
    expect(svg).toContain('&lt;hostile&gt;')
    expect(svg).not.toContain('<hostile>')
  })
})


/**
 * ONE TITLE BLOCK, reached by every visual deliverable.
 *
 * SVG, PNG and both PDF paths must not be able to drift apart — a PNG that
 * printed a different date from the PDF of the same sheet would be worse than
 * either being wrong, because nobody would know which to believe.
 */
describe('8. every visual export shares the controlled path', () => {
  const src = (f: string) => readFileSync(join(__dirname, '../../src/export', f), 'utf8')

  for (const file of ['png.ts', 'printPdf.ts', 'printAll.ts']) {
    it(`${file} renders through exportSvg`, () => {
      expect(src(file)).toContain('exportSvg')
    })
  }

  it('and exportSvg is the only caller of the title block', () => {
    const svg = src('svg.ts')
    expect(svg).toContain('titleBlockSvg(doc, sheet)')
    for (const file of ['png.ts', 'printPdf.ts', 'printAll.ts', 'dxf.ts', 'dexpi.ts']) {
      expect(src(file), file).not.toContain('titleBlockSvg')
    }
  })
})
