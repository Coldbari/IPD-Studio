// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P1 hot paths, measured.
 *
 * The exit audit could say only that `ioListRows()` builds a second full
 * `ProjectIndex` per call — structural evidence, with no number attached,
 * because nothing in the repo measured the Data workspace. This does.
 *
 * Run with PERF=1 like the existing hot-path benchmark; it prints ms/call and
 * asserts nothing about timing, because a wall-clock threshold in CI is a
 * flake generator. The one thing it DOES assert is the structural claim: how
 * many full document walks one workspace render costs.
 */

import { expect, test } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { buildHierarchy, newArea, newUnit } from '../../src/model/hierarchy'
import { deriveIoList } from '../../src/model/ioList'
import {
  engineeringCsv, equipmentListRows, instrumentIndexRows, ioListReport,
  ioListRows, lineListRows, valveListRows,
} from '../../src/export/csv'
import { buildChangeSet, parseCsv } from '../../src/model/bulkEdit'
import { captureQaEvidence, fingerprintStandard } from '../../src/model/provenance'
import { evaluateConformance, issueBlockers } from '../../src/model/conformance'
import { conformanceCsv } from '../../src/export/csv'
import { standardOf } from '../../src/model/standard'
import { qaFor, resetQaCache } from '../../src/validate/engine'
import { runRules } from '../../src/validate/engine'
import { ALL_RULES } from '../../src/validate/rules/index'
import { noReceiver } from '../../src/validate/rules/instrumentation'
import { newLoop } from '../../src/model/loop'
import { deriveRuns, runOfEdgeMap } from '../../src/model/run'
import { loopViews } from '../../src/model/loopIndex'
import { planLoopAdoption } from '../../src/model/loopAdoption'
import { compareDocs } from '../../src/model/diff'
import { loopListCsv, loopListRows } from '../../src/export/csv'
import { persistentLoopDiagramSvg } from '../../src/export/loopDiagram'
import { serializeDoc } from '../../src/persist/file'
import { ENGINEERING_SPEC } from '../../src/export/csv'
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FINDINGS } from '../../src/model/provenance'
import type { PlantEdge, PlantNode, ProjectDoc } from '../../src/model/types'
import type { EngineeringRecord, Registry } from '../../src/model/registry'

/** A project the size of a real unit: tagged instruments wired to a DCS,
 *  numbered lines, equipment, a full registry and a declared hierarchy. */
function project(instruments: number): ProjectDoc {
  const doc = createEmptyDoc('perf')
  const nodes: PlantNode[] = []
  const edges: PlantEdge[] = []
  const registry: Registry = {}
  const areas = Array.from({ length: 8 }, (_, i) => newArea(`A${i}`))
  const units = areas.flatMap((a) => Array.from({ length: 5 }, (_, i) => newUnit(a.id, `U-${a.code}${i}`)))

  nodes.push({ id: 'dcs', symbolId: 'ctl.dcs', kind: 'equipment', x: 0, y: 0, rotation: 0 })
  for (let i = 0; i < instruments; i++) {
    const id = `n${i}`
    const key = `LT-${1000 + i}`
    nodes.push({ id, symbolId: 'instr.bubble', kind: 'instrument', x: (i % 60) * 40, y: Math.floor(i / 60) * 40, rotation: 0, tag: { letters: 'LT', loop: String(1000 + i) } })
    edges.push({ id: `s${i}`, lineClass: 'signal.electric', source: { nodeId: id, portId: 'e' }, target: { nodeId: 'dcs', portId: 'w' } })
    const rec: EngineeringRecord = {
      key, kind: 'instrument',
      fields: { 'signal.range': '0-10 bar', 'signal.units': 'bar', 'general.service': 'Feed', 'alarm.H': '8' },
      unitId: units[i % units.length]!.id,
    }
    registry[key] = rec
  }
  for (let i = 0; i < instruments / 4; i++) {
    const a = `n${i * 2}`
    const b = `n${i * 2 + 1}`
    if (!nodes.find((n) => n.id === a) || !nodes.find((n) => n.id === b)) continue
    edges.push({
      id: `l${i}`, lineClass: 'process.major',
      source: { nodeId: a, portId: 'w' }, target: { nodeId: b, portId: 'w' },
      lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: String(i).padStart(3, '0') },
    })
  }
  doc.sheets[0]!.nodes = nodes
  doc.sheets[0]!.edges = edges
  return { ...doc, registry, areas, units }
}

/** The same project with persistent loops declared and every record assigned,
 *  `per` members to a loop. Program 1 adds no way to CREATE these in the app —
 *  this builds them directly, which is all a model-layer benchmark needs. */
function withLoops(doc: ProjectDoc, per: number): ProjectDoc {
  const keys = Object.keys(doc.registry ?? {})
  const loops = Array.from({ length: Math.ceil(keys.length / per) }, (_, i) => newLoop(String(100 + i)))
  const registry: Registry = { ...doc.registry }
  keys.forEach((k, i) => { registry[k] = { ...registry[k]!, loopId: loops[Math.floor(i / per)]!.id } })
  return { ...doc, loops, registry }
}

function bench(label: string, iters: number, fn: () => void): number {
  fn(); fn()
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) fn()
  const ms = (performance.now() - t0) / iters
  process.stderr.write(`  ${label.padEnd(38)} ${ms.toFixed(3)} ms/call\n`)
  return ms
}

/**
 * STRUCTURAL, and therefore always run.
 *
 * A wall-clock number belongs behind PERF=1; an invariant does not. The one
 * that matters here is that the I/O tab's rows and its excluded count come off
 * ONE index walk and cannot drift from the CSV's rows — `ioListReport` exists
 * for exactly that, and a later "optimisation" that gave them separate walks
 * would break this rather than quietly double the work.
 */
test('the I/O rows and the excluded count come from one consistent walk', () => {
  const doc = project(120)
  // A local gauge with no wiring: deliberately excluded, and counted.
  doc.sheets[0]!.nodes.push({
    id: 'gauge', symbolId: 'instr.bubble', kind: 'instrument',
    x: 0, y: 0, rotation: 0, tag: { letters: 'PI', loop: '900' },
  })

  const report = ioListReport(doc)
  expect(report.rows.map((r) => r.recordKey)).toEqual(ioListRows(doc).map((r) => r.recordKey))
  expect(report.excluded).toBe(1)
  expect(report.rows.some((r) => r.recordKey === 'PI-900')).toBe(false)

  // And the derived list agrees with the report built from the same index.
  const ix = buildIndex(doc)
  expect(deriveIoList(ix)).toHaveLength(report.rows.length)
})

/**
 * D8 SCALING EVIDENCE.
 *
 * A rule being faster at one size proves nothing about its complexity. This
 * measures `no-receiver` across four sizes and prints the cost PER NODE: a
 * linear rule holds that roughly flat as N grows, a quadratic one doubles it
 * every time N doubles.
 *
 * The old implementation ran `ix.allNodes.some(...)` inside a loop over
 * `ix.allNodes`. The new one makes one pass over `ix.loops` to count receivers
 * and one pass over `ix.allNodes` to ask — so the per-node figure should stay
 * within noise of itself from 250 to 2,000.
 */
test.skipIf(!process.env.PERF)('no-receiver scales linearly', () => {
  process.stderr.write('\n  --- no-receiver scaling ---\n')
  const rows: { n: number; ms: number; per: number }[] = []
  for (const n of [250, 500, 1000, 2000]) {
    const ix = buildIndex(project(n))
    noReceiver.run(ix); noReceiver.run(ix)
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) noReceiver.run(ix)
    const ms = (performance.now() - t0) / 20
    rows.push({ n, ms, per: (ms * 1000) / n })
  }
  for (const r of rows) {
    process.stderr.write(`  n=${String(r.n).padStart(5)}  ${r.ms.toFixed(3)} ms  ${r.per.toFixed(4)} us/node\n`)
  }
  const first = rows[0]!
  const last = rows[rows.length - 1]!
  process.stderr.write(
    `  8x the nodes -> ${(last.ms / first.ms).toFixed(1)}x the time` +
    ` (linear ~8x, quadratic ~64x); us/node ${first.per.toFixed(4)} -> ${last.per.toFixed(4)}\n`,
  )
  // Linear would be ~8x for an 8x size increase; quadratic ~64x. Twice the
  // linear expectation is a generous ceiling that still fails loudly on a
  // reintroduced nested scan.
  expect(last.ms / first.ms).toBeLessThan(16)
})

test.skipIf(!process.env.PERF)('P1 hot paths', () => {
  const doc = project(500)
  process.stderr.write(`\n  project: ${doc.sheets[0]!.nodes.length} nodes, ${doc.sheets[0]!.edges.length} edges, ${Object.keys(doc.registry!).length} records, ${doc.units!.length} units\n`)

  bench('buildIndex', 20, () => { buildIndex(doc) })
  bench('buildHierarchy', 200, () => { buildHierarchy(doc) })

  /*
   * P3 PROGRAM 1 — what deriving piping runs costs inside `buildIndex`.
   *
   * The gate was `buildIndex` + 0.3 ms. Measured PAIRED against d0b0da4, three
   * runs each, minutes apart on one warm machine:
   *
   *   buildIndex, before   0.984 / 0.990 / 0.942 ms   median 0.984
   *   buildIndex, after    1.225 / 1.303 / 1.266 ms   median 1.266
   *   delta                                           +0.282 ms
   *
   * The two lines below are what that delta IS, so a later regression can be
   * attributed rather than guessed at. Note the shape of this fixture: its 125
   * process edges join instrument to instrument, and an instrument is not
   * pass-through, so every run is a single edge. That is the WORST case per
   * edge — 125 separate walks, each allocating its own working set — and a
   * drawing whose pipes actually connect gets more edges per walk for less.
   */
  const ixRuns = buildIndex(doc)
  bench('deriveRuns (index reused)', 50, () => { deriveRuns(ixRuns) })
  bench('runOfEdgeMap (index reused)', 200, () => { runOfEdgeMap(ixRuns.runs) })
  process.stderr.write(`  (runs: ${ixRuns.runs.length} over ${ixRuns.runOfEdge.size} process edges)\n`)

  /*
   * THE P2-C PROGRAM 1 PERFORMANCE CRITERION.
   *
   * NOT an absolute threshold. The criterion is NO REGRESSION against the
   * measured pre-Program-1 baseline on THIS fixture, and the history is worth
   * keeping because the first attempt got it wrong:
   *
   *   An absolute 1.2 ms gate was proposed from the P2-C audit, which had
   *   measured `tests/perf/hotpaths.test.ts` gen(500) — 500 NODES, no
   *   registry, no hierarchy, roughly one tagged instrument in nine. That
   *   fixture costs ~1.07 ms and passes. A real 500-INSTRUMENT project, which
   *   is what project(500) below builds, costs ~9 ms and always did. The gate
   *   was measuring a different thing from the one it named.
   *
   * MEASURED on project(500) — 501 nodes, 625 edges, 500 records, 40 units.
   * Baseline and current taken minutes apart on one warm machine, the baseline
   * from a worktree at the pre-Program-1 commit, because numbers taken an hour
   * apart on a machine that has been running suites are not comparable.
   *
   *                                    BASELINE (median)   PROGRAM 1 (median)
   *   runRules, index reused              6.52 ms             6.13 ms   FASTER
   *   buildIndex, no loops declared       0.62 ms             0.64 ms   equal
   *   buildIndex + runRules, fresh index  8.79 ms             9.11 ms   +0.32
   *   deriveIoList, index reused          0.585 ms            0.000 ms  memo
   *   buildIndex, 125 loops / 500 members     n/a             0.88 ms   +0.27
   *
   * READ THE FIRST ROW, NOT THE THIRD. `qaFor` memoises one report per
   * document, so what a user pays on an edit is one index build and one rule
   * pass over an index that is then RETAINED. That is row one, and Program 1
   * is ~0.4 ms faster there: the deriveIoList memo hands `io-type-unclassified`
   * its rows for free on every pass after the first.
   *
   * Row three rebuilds the index on every iteration, which no interaction
   * does. It keeps 20+ live indexes, and the memo holds a 500-row array
   * against each, so the +0.32 ms there is GC pressure the application never
   * generates — at most one or two indexes are reachable at a time in the real
   * app. It is kept in the fixture because it is the pair the original gate
   * named, and dropping a number because it is inconvenient is how a benchmark
   * stops being trusted.
   *
   * A project with NO persistent loops pays nothing; 125 loops over 500
   * assigned records cost about +0.27 ms on the index build.
   *
   * P2-C PROGRAM 2 added the seven loop rules. Measured the same way, against
   * the Program 1 commit in a worktree, minutes apart:
   *
   *                                   PROGRAM 1 (median)  PROGRAM 2 (median)
   *   runRules, index reused, no loops     5.86 ms            6.07 ms   +0.21
   *   runRules, 125 loops assigned            n/a             6.48 ms
   *   the seven loop rules, no loops          n/a             0.05 ms
   *   the seven loop rules, 125 loops         n/a             0.41 ms
   *
   * Read the +0.21 honestly: only ~0.05 ms of it is the loop rules DOING
   * anything on a project with no loops. The rest is the engine's fixed
   * per-rule overhead — an override lookup, a try/catch, two Set allocations —
   * paid seven more times. That is the price of a rule existing, not of it
   * being slow, and the only way to avoid it is to ship fewer checks.
   *
   * Two costs were found here and fixed rather than absorbed, both in Program
   * 2's own code: `danglingLoopMembers` allocated an Object.entries pair array
   * over the whole registry on every pass (0.145 -> 0.025 ms with `for...in`),
   * and three rules each rebuilt the same per-loop evaluation (0.60 -> 0.07 ms
   * once `loopViews()` memoised it on the index).
   *
   * `loop-units-conflict` is now the most expensive of the seven at ~0.25 ms
   * with 125 loops, because it is the one rule that walks members without
   * using the shared evaluation. Named here rather than buried: it is 4% of
   * the rule pass and has not been optimised further.
   *
   * P2-C PROGRAM 3 added the workflow. Measured on the same fixture:
   *
   *   loopViews, no loops declared                 ~0.00 ms (over buildIndex)
   *   loopViews, 125 loops, cold index             ~0.09 ms (over buildIndex)
   *   loopViews, 125 loops, memo hit                0.000 ms
   *   planLoopAdoption, 125 derived loops           0.50 ms
   *   compareDocs incl. diffLoops, 125 loops        1.73 ms
   *
   * The Loop Manager's data preparation IS `loopViews(ix)` — the panel derives
   * nothing of its own and re-reads the index `qaFor` already caches — so the
   * memo-hit row is what a re-render costs. Adoption planning and the revision
   * comparison are both user-initiated and neither is on a render path.
   *
   * No O(N^2) anywhere in the workflow: every one of these is a single pass
   * over the loops or the records, off the one ProjectIndex.
   *
   * P2-C PROGRAM 4 added the Loop list and the diagram projection:
   *
   *   loopListRows, no loops declared               0.000 ms (early return)
   *   loopListRows, 125 loops                       ~2.2 ms
   *   loopListCsv, 125 loops                        ~2.1 ms
   *   persistentLoopDiagramSvg, one loop            ~0.85 ms
   *   the seven loop rules, 125 loops    0.41 -> 0.245 ms
   *
   * The report figures each include their own `buildIndex` and one
   * `deriveIoList`, which is how every other report in this file works; none
   * of them is on a render path. A project with no declared loops returns an
   * empty list without walking anything.
   *
   * The loop RULES got faster: `loop-units-conflict` was the one rule walking
   * members without the shared evaluation, and moving it onto `LoopView.unitIds`
   * — the derivation the Loop Manager and the Loop list also read — removed a
   * duplicate pass rather than adding a fourth implementation of "which units
   * is this loop in".
   *
   * THE DOMINANT COST WAS NOT THE LOOP LAYER. `no-receiver` alone was ~4 ms of
   * the rule pass: it ran `ix.allNodes.some(...)` inside a loop over
   * `ix.allNodes`, so 500 x 501 on this fixture. P2-C deliberately left it
   * alone; D8 then fixed it as its own task, off `ix.loops`, and the numbers
   * below are the paired before/after taken from a worktree at the pre-D8
   * commit minutes apart on one machine:
   *
   *                                 BEFORE (D8)   AFTER (D8)
   *   no-receiver, n=500              4.65 ms       0.18 ms    26x
   *   no-receiver, n=2000            57.14 ms       0.51 ms   113x
   *   runRules, index reused          5.70 ms       2.14 ms    2.7x
   *   buildIndex + runRules           9.36 ms       4.41 ms    2.1x
   *
   * The scaling test above is what makes "O(N)" a claim rather than a hope:
   * 8x the nodes cost the old version 42.3x the time and cost this one 4.0x.
   */
  bench('buildIndex + runRules (per edit)', 20, () => { runRules(buildIndex(doc), {}) })
  // The SAME pass on a reused index — the shape `qaFor` actually has, since it
  // memoises one report per document. The line above rebuilds the index every
  // iteration, which no user interaction does.
  const rix0 = buildIndex(doc)
  bench('runRules only (index reused)', 20, () => { runRules(rix0, {}) })

  // Per-rule attribution. Without it "QA is slow" is a feeling; with it the
  // two rules that actually cost anything are named, and an optimisation can
  // be aimed rather than sprayed.
  // P2-C Program 1: what the persistent-loop layer costs when a project
  // actually HAS loops. The plain fixture declares none, so `buildIndex` above
  // short-circuits past the record walk — measuring only that would be
  // measuring the absence of the feature.
  const looped = withLoops(doc, 4)
  const rixWarm = buildIndex(doc)
  process.stderr.write(`  (loop fixture: ${looped.loops!.length} loops over ${Object.keys(looped.registry!).length} records)\n`)
  bench('buildIndex, no loops declared', 20, () => { buildIndex(doc) })
  bench('buildIndex, 125 loops assigned', 20, () => { buildIndex(looped) })

  /*
   * P2-C PROGRAM 2: what the seven loop rules cost.
   *
   * Measured on BOTH shapes, because they answer different questions:
   *
   *   no loops declared  — every project that has not adopted them. Each rule
   *                        iterates `doc.loops`, which is empty, so this is the
   *                        cost of the feature being present but unused.
   *   125 loops assigned — a fully adopted project of this size.
   */
  const lix = buildIndex(looped)
  bench('runRules, no loops declared', 20, () => { runRules(rixWarm, {}) })
  bench('runRules, 125 loops assigned', 20, () => { runRules(lix, {}) })

  const LOOP_RULE_IDS = new Set([
    'record-orphan-loop', 'duplicate-loop-number', 'loop-incomplete',
    'loop-units-conflict', 'loop-io-conflict', 'loop-type-unstated', 'loop-empty',
  ])
  for (const [name, ix2] of [['no loops', rixWarm], ['125 loops', lix]] as const) {
    let total = 0
    const each: string[] = []
    for (const r of ALL_RULES) {
      if (!LOOP_RULE_IDS.has(r.id)) continue
      r.run(ix2); r.run(ix2)
      const t0 = performance.now()
      for (let i = 0; i < 20; i++) r.run(ix2)
      const ms = (performance.now() - t0) / 20
      total += ms
      each.push(`${r.id}=${ms.toFixed(3)}`)
    }
    process.stderr.write(`  loop rules, ${name.padEnd(10)} TOTAL ${total.toFixed(3)} ms/call\n`)
    process.stderr.write(`    ${each.join('  ')}\n`)
  }

  // P2-C PROGRAM 3: what the loop workflow costs. The Loop Manager's data
  // preparation IS `loopViews(ix)` — it computes nothing of its own — so
  // measuring that measures the panel.
  bench('loopViews, no loops declared', 50, () => { loopViews(buildIndex(doc)) })
  bench('loopViews, 125 loops (cold index)', 50, () => { loopViews(buildIndex(looped)) })
  bench('loopViews, 125 loops (memo hit)', 200, () => { loopViews(lix) })
  bench('planLoopAdoption, 125 derived', 20, () => { planLoopAdoption(lix) })
  const renamed = { ...looped, loops: (looped.loops ?? []).map((l, i) => (i % 2 ? { ...l, number: `${l.number}b` } : l)) }
  bench('diffLoops via compareDocs, 125 loops', 20, () => { compareDocs(looped, renamed) })

  // P2-C PROGRAM 4: the Loop list and the diagram projection.
  bench('loopListRows, no loops declared', 20, () => { loopListRows(doc) })
  bench('loopListRows, 125 loops', 20, () => { loopListRows(looped) })
  bench('loopListCsv, 125 loops', 20, () => { loopListCsv(looped) })
  const firstLoop = looped.loops![0]!.id
  bench('persistentLoopDiagramSvg', 20, () => { persistentLoopDiagramSvg(looped, firstLoop) })

  const rix = buildIndex(doc)
  const costs = ALL_RULES.map((r) => {
    r.run(rix); r.run(rix)
    const t0 = performance.now()
    for (let i = 0; i < 10; i++) r.run(rix)
    return { id: r.id, ms: (performance.now() - t0) / 10 }
  }).sort((a, b) => b.ms - a.ms)
  process.stderr.write(`  --- per rule (top 6 of ${costs.length}) ---\n`)
  for (const c of costs.slice(0, 6)) process.stderr.write(`  ${c.id.padEnd(38)} ${c.ms.toFixed(3)} ms/call\n`)
  process.stderr.write(`  ${'ALL OTHER RULES'.padEnd(38)} ${costs.slice(6).reduce((n, c) => n + c.ms, 0).toFixed(3)} ms/call\n`)

  const ix = buildIndex(doc)
  bench('deriveIoList (index reused)', 50, () => { deriveIoList(ix) })
  bench('ioListRows (builds its own index)', 20, () => { ioListRows(doc) })
  bench('instrumentIndexRows', 20, () => { instrumentIndexRows(doc) })
  bench('lineListRows', 20, () => { lineListRows(doc) })
  bench('all five reports (one render)', 10, () => {
    instrumentIndexRows(doc); ioListReport(doc); lineListRows(doc)
    equipmentListRows(doc); valveListRows(doc)
  })

  const csv = engineeringCsv(doc)
  bench('engineeringCsv', 20, () => { engineeringCsv(doc) })
  bench('buildChangeSet (full re-import)', 20, () => {
    buildChangeSet(doc, parseCsv(csv), ENGINEERING_SPEC)
  })
})


/**
 * P2-A: what provenance costs.
 *
 * Two things could have gone wrong and neither did: a fingerprint recomputed
 * on every render, and a QA evidence payload that makes a project file too big
 * to send. Both are measured rather than assumed.
 */
test('provenance does not bloat the document', () => {
  resetQaCache()
  const doc = project(300)
  const report = qaFor(doc)
  const evidence = captureQaEvidence(report)
  const provenance = { standard: fingerprintStandard(standardOf(doc)), qaEvidence: evidence }

  const bare = serializeDoc(doc, { pretty: false }).length
  const added = JSON.stringify(provenance).length
  process.stderr.write(
    `\n  document ${(bare / 1024).toFixed(0)} kB` +
    `, provenance per issue ${(added / 1024).toFixed(1)} kB` +
    `, ${evidence.findings.length} findings (+${evidence.omitted} omitted)\n`,
  )

  // A project must be able to carry a long revision history inside the ~900 kB
  // cloud ceiling, so one issue has to stay small.
  expect(added).toBeLessThan(56_000)
  // And the cap has to actually hold on a report this size.
  expect(evidence.findings.length).toBeLessThanOrEqual(MAX_EVIDENCE_FINDINGS)
  expect(JSON.stringify(evidence.findings).length).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES)
})

test.skipIf(!process.env.PERF)('P2-A provenance hot paths', () => {
  resetQaCache()
  const doc = project(500)
  const std = standardOf(doc)
  const report = qaFor(doc)

  bench('fingerprintStandard', 500, () => { fingerprintStandard(std) })
  bench('captureQaEvidence', 50, () => { captureQaEvidence(report) })
  bench('serializeDoc (no provenance)', 10, () => { serializeDoc(doc, { pretty: false }) })
})

/**
 * P2-B: what conformance costs.
 *
 * The design claim is that conformance is a FOLD over a report that already
 * exists — no second index, no second document walk. That is a structural
 * claim, so it is asserted structurally here and timed behind PERF=1.
 */
test('conformance is a fold, not a second traversal', () => {
  resetQaCache()
  const doc = project(300)
  const report = qaFor(doc)

  // The evaluator never touches the document. Stripping the index off the
  // report would break anything that tried to walk it from here.
  const detached = { ...report, index: undefined as never }
  const gate = { blockSeverities: ['critical' as const], requireChecker: true }
  const verdict = evaluateConformance(detached, gate)

  expect(verdict.rulesEvaluated).toBe(report.rulesEvaluated)
  expect(verdict.open.total).toBe(report.total)
  expect(issueBlockers({ status: 'IFC' }, gate, detached, verdict).length).toBeGreaterThan(0)

  // And the frozen record stays small — it is counts and rule ids, never findings.
  const bytes = JSON.stringify(verdict).length
  process.stderr.write(`\n  conformance record ${bytes} bytes for ${report.total} findings\n`)
  expect(bytes).toBeLessThan(2_000)
})

test.skipIf(!process.env.PERF)('P2-B conformance hot paths', () => {
  resetQaCache()
  const doc = project(500)
  const report = qaFor(doc)
  const gate = { blockSeverities: ['critical' as const], requireChecker: true }
  const verdict = evaluateConformance(report, gate)
  const sheet = doc.sheets[0]!
  const rev = {
    id: 'r1', code: 'A', date: '', description: '', preparedBy: '', status: 'IFC',
    issuedAt: '2026-01-01T00:00:00.000Z', conformance: verdict,
    qaEvidence: captureQaEvidence(report),
  }

  bench('evaluateConformance', 2000, () => { evaluateConformance(report, gate) })
  bench('issueBlockers', 2000, () => { issueBlockers(rev, gate, report, verdict) })
  bench('conformanceCsv', 200, () => { conformanceCsv(doc, sheet, rev) })
})
