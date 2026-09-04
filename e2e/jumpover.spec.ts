// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { expect, test } from '@playwright/test'

/**
 * Crossing hops are drawn by JointJS's jumpover connector fed a spatial
 * shortlist (canvas/jumpover.ts), and refreshed only on the lines a change
 * could have affected. Both halves are load-bearing for the drawing being
 * readable, and neither is visible to the unit tests, so they are pinned here:
 * a lattice of crossing runs must sprout hops, and removing the crossings must
 * take them away again.
 */

const arcsInPaths = () =>
  Array.from(document.querySelectorAll('.joint-link[model-id] [joint-selector="line"]')).filter((p) =>
    (p.getAttribute('d') ?? '').includes('C'),
  ).length

test('lines that cross draw hops, and stop when they no longer cross', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)

  await page.evaluate(() => {
    const nodes: unknown[] = []
    const edges: unknown[] = []
    for (let i = 0; i < 48; i++) {
      nodes.push({ id: 'n' + i, symbolId: 'valve.gate', kind: 'valve',
        x: (i % 12) * 130, y: Math.floor(i / 12) * 130, rotation: i % 2 ? 90 : 0 })
    }
    for (let i = 0; i + 1 < 48; i++) {
      if (i % 12 === 11) continue
      edges.push({ id: 'h' + i, lineClass: 'process.major',
        source: { nodeId: 'n' + i, portId: 'e' }, target: { nodeId: 'n' + (i + 1), portId: 'w' } })
    }
    for (let i = 0; i + 12 < 48; i++) {
      edges.push({ id: 'v' + i, lineClass: 'process.minor',
        source: { nodeId: 'n' + i, portId: 'e' }, target: { nodeId: 'n' + (i + 12), portId: 'w' } })
    }
    const now = new Date().toISOString()
    ;(window as never as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid.useStore
      .getState()
      .loadIntoStore({
        schemaVersion: 5, meta: { name: 'hops', author: '', created: now, modified: now },
        settings: { gridPx: 8, tagSeparator: '-', numberStart: 100 },
        sheets: [{ id: 'sh1', name: 'Sheet 1', drawingNumber: '', revision: '0', sheetSize: 'A1', nodes, edges }],
        hmiScreens: [], fluids: [],
      })
  })

  await expect.poll(() => page.evaluate(arcsInPaths), { timeout: 30_000 }).toBeGreaterThan(10)
  const withCrossings = await page.evaluate(arcsInPaths)

  // Take the vertical runs away: nothing crosses anything any more, so the
  // hops on the horizontal runs have to come off — which only happens if the
  // targeted refresh reaches lines whose CROSSING changed, not just lines
  // that moved.
  await page.evaluate(() => {
    const { useStore } = (window as never as {
      __pid: { useStore: { getState(): { doc: { sheets: { edges: { id: string }[] }[] }; deleteIds(ids: string[]): void } } }
    }).__pid
    const s = useStore.getState()
    s.deleteIds(s.doc.sheets[0]!.edges.filter((e) => e.id.startsWith('v')).map((e) => e.id))
  })

  await expect.poll(() => page.evaluate(arcsInPaths), { timeout: 30_000 }).toBeLessThan(withCrossings / 2)
})
