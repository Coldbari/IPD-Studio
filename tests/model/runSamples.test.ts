// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE RUN BASELINE — what `deriveRuns()` says about every bundled sample.
 *
 * The same contract `tests/validate/sampleBaseline.test.ts` holds for QA, and
 * for the same reason: the samples are the closest thing in the repo to real
 * user drawings, and Programs 2-4 are going to build a line list, a QA rule
 * and a DEXPI mapping on top of whatever this produces. A change here means
 * the derivation changed its mind about what a pipe IS on a real drawing, and
 * the pull request has to say why.
 *
 * Never update these numbers to make a build pass. Either the derivation is
 * right and the sample should change, or the derivation is wrong.
 *
 * WHAT THE BASELINE SHOWS TODAY, and it is worth reading before Program 2:
 *
 *  - Not one sample produces a conflict. No connected run carries two numbers,
 *    and no number appears on two runs. The derivation adds no noise to any
 *    drawing shipped with the product.
 *  - Runs are SHORT — one, two or three edges. These drawings connect
 *    equipment through a single valve, so a run is usually "tank, valve, tank".
 *  - Most runs are unnumbered: 5 of 8, 9 of 13, 3 of 3. That is the gap the P3
 *    audit measured from the other side, and it is what Program 3's line list
 *    will have to say something honest about.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/symbols/lib/index'
import { loadDoc } from '../../src/model/migrate'
import { buildIndex } from '../../src/model/projectIndex'
import { allRunConflicts, type RunConflict } from '../../src/model/run'
import { isProcessClass } from '../../src/canvas/lineStyle'

interface RunProfile {
  /** Process edges on the drawing; every one of them belongs to exactly one run. */
  processEdges: number
  runs: number
  /** edges-in-a-run -> how many runs are that long. */
  sizes: Record<number, number>
  /** Runs carrying exactly one line number, none at all, and several. */
  numbered: number
  unnumbered: number
  multiNumbered: number
  /** The line numbers those runs carry, sorted. These are `keyOfEdge` strings
   *  and are what a line list will join the registry on. */
  numbers: string[]
  conflicts: RunConflict[]
}

const load = (file: string) =>
  loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples', file), 'utf8')))

function profileOf(file: string): RunProfile {
  const ix = buildIndex(load(file))
  const sizes: Record<number, number> = {}
  for (const run of ix.runs) sizes[run.edgeIds.length] = (sizes[run.edgeIds.length] ?? 0) + 1
  return {
    processEdges: ix.allEdges.filter((e) => isProcessClass(e.edge.lineClass)).length,
    runs: ix.runs.length,
    sizes,
    numbered: ix.runs.filter((r) => r.number !== undefined).length,
    unnumbered: ix.runs.filter((r) => r.unnumbered).length,
    multiNumbered: ix.runs.filter((r) => r.numbers.length > 1).length,
    numbers: ix.runs.flatMap((r) => (r.number ? [r.number] : [])).sort(),
    conflicts: allRunConflicts(ix),
  }
}

/** Recorded 2026-09-13, at P3 Program 1. */
const BASELINE: Record<string, RunProfile> = {
  'sample-plant.pnid.json': {
    processEdges: 13,
    runs: 8,
    sizes: { 1: 3, 2: 5 },
    numbered: 3,
    unnumbered: 5,
    multiNumbered: 0,
    numbers: ['2"-CS150-P-001', '2"-CS150-P-002', '3"-CS150-P-003'],
    conflicts: [],
  },
  'sample-refinery-unit.pnid.json': {
    processEdges: 19,
    runs: 13,
    sizes: { 1: 7, 2: 6 },
    numbered: 4,
    unnumbered: 9,
    multiNumbered: 0,
    numbers: ['3"-CS150-P-001', '3"-CS150-P-002', '4"-CS150-P-003', '6"-CS300-S-010'],
    conflicts: [],
  },
  // Nothing drawn, so nothing to derive. A starter file that opened with a
  // piping model would be inventing one.
  'template-blank-a3.pnid.json': {
    processEdges: 0, runs: 0, sizes: {}, numbered: 0, unnumbered: 0, multiNumbered: 0, numbers: [], conflicts: [],
  },
  'template-utility-a1.pnid.json': {
    processEdges: 0, runs: 0, sizes: {}, numbered: 0, unnumbered: 0, multiNumbered: 0, numbers: [], conflicts: [],
  },
  // Three runs, one of them three edges long, and not a line number among them:
  // the HMI demo is drawn to be simulated, not to be issued.
  'template-hmi-demo.pnid.json': {
    processEdges: 6,
    runs: 3,
    sizes: { 1: 1, 2: 1, 3: 1 },
    numbered: 0,
    unnumbered: 3,
    multiNumbered: 0,
    numbers: [],
    conflicts: [],
  },
}

const FILES = Object.keys(BASELINE)

describe('the bundled samples have a recorded run profile', () => {
  for (const file of FILES) {
    it(`${file} derives exactly what the baseline records`, () => {
      expect(profileOf(file)).toEqual(BASELINE[file])
    })
  }
})

describe('every sample obeys the invariants, whatever its shape', () => {
  it('partitions the process edges: each in exactly one run, nothing else in any', () => {
    for (const file of FILES) {
      const ix = buildIndex(load(file))
      const claimed = ix.runs.flatMap((r) => r.edgeIds)
      const process = ix.allEdges.filter((e) => isProcessClass(e.edge.lineClass)).map((e) => e.edge.id)
      expect(new Set(claimed).size, file).toBe(claimed.length)
      expect(claimed.slice().sort(), file).toEqual(process.slice().sort())
      expect([...ix.runOfEdge.keys()].sort(), file).toEqual(process.slice().sort())
    }
  })

  it('keeps every run on one sheet, and every run non-empty', () => {
    for (const file of FILES) {
      const ix = buildIndex(load(file))
      const sheetOfEdge = new Map(ix.allEdges.map((e) => [e.edge.id, e.sheet.id]))
      for (const run of ix.runs) {
        expect(run.edgeIds.length, `${file} ${run.id}`).toBeGreaterThan(0)
        for (const id of run.edgeIds) expect(sheetOfEdge.get(id), `${file} ${run.id}`).toBe(run.sheetId)
      }
    }
  })

  it('derives identically on a second build', () => {
    for (const file of FILES) {
      const doc = load(file)
      expect(buildIndex(doc).runs, file).toEqual(buildIndex(doc).runs)
    }
  })

  it('keeps number, numbers and unnumbered consistent with each other', () => {
    for (const file of FILES) {
      for (const run of buildIndex(load(file)).runs) {
        expect(run.unnumbered, run.id).toBe(run.numbers.length === 0)
        expect(run.number, run.id).toBe(run.numbers.length === 1 ? run.numbers[0] : undefined)
      }
    }
  })

  it('leaves every sample document byte-identical', () => {
    for (const file of FILES) {
      const doc = load(file)
      const before = JSON.stringify(doc)
      const ix = buildIndex(doc)
      allRunConflicts(ix)
      expect(JSON.stringify(doc), file).toBe(before)
    }
  })
})
