// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Cost of the DOM-free hot paths, at drawing sizes from 50 to 2,000 objects.
 *
 * Measures rather than asserts — the numbers move with the machine — so it is
 * skipped by default:
 *
 *     PERF=1 npx vitest run tests/perf/hotpaths.test.ts
 *
 * The two `findDock`/`snapGuides` rows are the same call with and without the
 * gesture-scoped index the canvas builds at grab time; the gap between them is
 * what that index is worth on every pointermove.
 */
import { expect, test } from 'vitest'
import '../../src/symbols/lib/index'
import type { PlantEdge, PlantNode, ProjectDoc } from '../../src/model/types'
import { createEmptyDoc } from '../../src/model/doc'
import { buildDockIndex, findDock, dockRadius } from '../../src/canvas/autoConnect'
import { buildSnapIndex, portWorld, snapGuides } from '../../src/canvas/alignment'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules } from '../../src/validate/engine'
import { projectCost } from '../../src/model/costs'
import { deriveLoops } from '../../src/store/selectors'

const SYMS = [
  'instr.bubble', 'valve.gate', 'valve.globe', 'valve.check', 'cv.globe',
  'pump.centrifugal', 'vessel.vertical', 'vessel.horizontal', 'fit.junction',
]

function gen(n: number): { doc: ProjectDoc; nodes: PlantNode[]; edges: PlantEdge[] } {
  const doc = createEmptyDoc('bench')
  const nodes: PlantNode[] = []
  const edges: PlantEdge[] = []
  const cols = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) {
    const symbolId = SYMS[i % SYMS.length]!
    nodes.push({
      id: `n${i}`,
      symbolId,
      kind: symbolId.startsWith('instr') ? 'instrument' : symbolId.startsWith('valve') || symbolId.startsWith('cv') ? 'valve' : 'equipment',
      x: (i % cols) * 96,
      y: Math.floor(i / cols) * 96,
      rotation: 0,
      tag: symbolId.startsWith('instr') ? { letters: 'FT', loop: String(100 + i) } : undefined,
      label: `Item ${i}`,
    })
  }
  // ~1 edge per node, chaining neighbours
  for (let i = 0; i + 1 < n; i++) {
    edges.push({
      id: `e${i}`,
      lineClass: i % 4 === 0 ? 'signal.electric' : 'process.major',
      source: { nodeId: `n${i}`, portId: 'e' },
      target: { nodeId: `n${i + 1}`, portId: 'w' },
    })
  }
  doc.sheets[0]!.nodes = nodes
  doc.sheets[0]!.edges = edges
  return { doc, nodes, edges }
}

function bench(label: string, iters: number, fn: () => void): number {
  fn(); fn(); fn() // warm
  const t0 = performance.now()
  for (let i = 0; i < iters; i++) fn()
  const ms = (performance.now() - t0) / iters
  process.stderr.write(`  ${label.padEnd(34)} ${ms.toFixed(3)} ms/call\n`)
  return ms
}

test.skipIf(!process.env.PERF)('hot path microbenchmarks', () => {
  // Guard against benchmarking an early return, and against the gesture index
  // and the one-shot path disagreeing.
  {
    const g = gen(20)
    const a = g.nodes[1]!
    const b = g.nodes[2]!
    const pa = portWorld(a, 'e')!
    const pb = portWorld(b, 'w')!
    const moved = { ...b, x: b.x + (pa.x - pb.x), y: b.y + (pa.y - pb.y) }
    // No edges: the pair in `g` is already wired, and findDock rightly refuses
    // to stack a second line on a connection that exists.
    const plain = findDock(moved, g.nodes, [], 'process.major', 40)
    const indexed = findDock(moved, g.nodes, [], 'process.major', 40, undefined, buildDockIndex(g.nodes, []))
    expect(plain).not.toBeNull()
    expect(indexed).toEqual(plain)
  }
  for (const n of [50, 100, 250, 500, 1000, 2000]) {
    const { doc, nodes, edges } = gen(n)
    const moving = { ...nodes[Math.floor(n / 2)]!, x: nodes[Math.floor(n / 2)]!.x + 3 }
    const iters = n <= 250 ? 300 : n <= 1000 ? 100 : 40
    process.stderr.write(`\n--- ${n} nodes / ${edges.length} edges ---\n`)
    bench('findDock, no index', iters, () => {
      findDock(moving, nodes, edges, 'process.major', dockRadius(1))
    })
    const dockIx = buildDockIndex(nodes, edges)
    bench('findDock, gesture index', iters, () => {
      findDock(moving, nodes, edges, 'process.major', dockRadius(1), undefined, dockIx)
    })
    bench('snapGuides, no index', iters, () => {
      snapGuides(moving, nodes, 4, edges)
    })
    const snapIx = buildSnapIndex(nodes, edges)
    bench('snapGuides, gesture index', iters, () => {
      snapGuides(moving, nodes, 4, edges, 8, snapIx)
    })
    bench('buildIndex (per doc change)', Math.max(10, iters / 5), () => { buildIndex(doc) })
    const ix = buildIndex(doc)
    bench('runRules (per doc change)', Math.max(10, iters / 5), () => { runRules(ix, {}) })
    bench('buildIndex+runRules = qaFor', Math.max(10, iters / 5), () => { runRules(buildIndex(doc), {}) })
    bench('projectCost (per doc change)', Math.max(10, iters / 2), () => { projectCost(doc) })
    bench('deriveLoops', Math.max(10, iters / 2), () => { deriveLoops(doc) })
    bench('JSON clone doc (autosave)', 10, () => { JSON.parse(JSON.stringify(doc)) })
  }
}, 600_000)

import { getSymbol } from '../../src/symbols/registry'
import { parseSvgToMarkup } from '../../src/canvas/markupParser'

test.skipIf(!process.env.PERF)('symbol markup build cost', () => {
  const ids = ['instr.bubble', 'valve.gate', 'pump.centrifugal', 'vessel.vertical', 'cv.globe']
  const t0 = performance.now()
  const N = 1000
  for (let i = 0; i < N; i++) {
    const def = getSymbol(ids[i % ids.length]!)
    parseSvgToMarkup(def.render(def.defaultConfig ?? {}))
  }
  const ms = performance.now() - t0
  process.stderr.write(`\n  render+parse markup: ${(ms / N).toFixed(4)} ms/node  => ${ms.toFixed(0)} ms for 1000 nodes\n`)
})
