// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { expect, test } from '@playwright/test'

/**
 * Big sheets only keep the cells near the window in the DOM (canvas/viewport.ts).
 * The thing that must never break because of it is the export: it clones the
 * live SVG, so an off-screen symbol missing from the DOM would be a symbol
 * missing from the customer's drawing.
 */

const N = 460 // over the 400-cell threshold on its own, before edges

function docSource(): string {
  return `(() => {
    const n = ${N}
    const nodes = [], edges = []
    for (let i = 0; i < n; i++) {
      nodes.push({ id: 'n' + i, symbolId: 'valve.gate', kind: 'valve',
        x: (i % 20) * 160, y: Math.floor(i / 20) * 160, rotation: 0 })
    }
    for (let i = 0; i + 1 < n; i++) {
      edges.push({ id: 'e' + i, lineClass: 'process.major',
        source: { nodeId: 'n' + i, portId: 'e' }, target: { nodeId: 'n' + (i + 1), portId: 'w' } })
    }
    const now = new Date().toISOString()
    return { schemaVersion: 5, meta: { name: 'virtualization', author: '', created: now, modified: now },
      settings: { gridPx: 8, tagSeparator: '-', numberStart: 100 },
      sheets: [{ id: 'sh1', name: 'Sheet 1', drawingNumber: '', revision: '0', sheetSize: 'A1', nodes, edges }],
      hmiScreens: [], fluids: [] }
  })()`
}

test('a virtualized sheet still exports every symbol', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)

  await page.evaluate((src) => {
    // eslint-disable-next-line no-eval
    ;(window as never as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid.useStore
      .getState()
      .loadIntoStore(eval(src))
  }, docSource())
  await expect(page.locator('[model-id]')).toHaveCount(N + (N - 1), { timeout: 60_000 })

  // Zoom to 1:1 on one corner: most of the drawing is now off screen.
  await page.evaluate(() => {
    const { paper } = (window as never as { __pid: { canvasRef: { paper: { scale(a: number, b: number): void; translate(x: number, y: number): void } } } }).__pid.canvasRef
    paper.scale(1, 1)
    paper.translate(0, 0)
  })
  await page.waitForTimeout(600)

  const mounted = await page.locator('[model-id]').count()
  expect(mounted, 'the sheet should be virtualized at 1:1').toBeLessThan(N + (N - 1))

  // The export must nonetheless carry every cell.
  const inExport = await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/export/svg.ts')) as {
      exportSvg(doc: unknown, sheet: unknown): string
    }
    const { useStore } = (window as never as { __pid: { useStore: { getState(): { doc: { sheets: unknown[] } } } } }).__pid
    const state = useStore.getState()
    const svg = mod.exportSvg(state.doc, state.doc.sheets[0])
    return (svg.match(/model-id=/g) ?? []).length
  })
  expect(inExport).toBe(N + (N - 1))

  // ...and the paper goes back to rendering only what is on screen.
  await page.waitForTimeout(600)
  expect(await page.locator('[model-id]').count()).toBeLessThan(N + (N - 1))

  // Panning brings the rest in. n315 sits at (2400, 2400) on this grid, well
  // inside the area the pan below puts on screen.
  expect(await page.locator('[model-id="n315"]').count(), 'off screen to begin with').toBe(0)
  const far = await page.evaluate(async () => {
    const { paper } = (window as never as { __pid: { canvasRef: { paper: { translate(x: number, y: number): void } } } }).__pid.canvasRef
    paper.translate(-2300, -2300)
    await new Promise((r) => setTimeout(r, 800))
    return document.querySelector('[model-id="n315"]') !== null
  })
  expect(far, 'a symbol panned into view should render').toBe(true)
})
