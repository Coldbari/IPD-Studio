// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * "Zooming in must NOT permanently make the drawing slower."
 *
 * Measures the same drag at the same zoom three times: fresh, after twenty
 * zoom in/out cycles, and after twenty more with panning mixed in. If any
 * state accumulates behind zooming — views that mount and never unmount,
 * listeners, an index that grows — this is where it shows.
 *
 *     PERF=1 npx playwright test e2e/zoomchurn.spec.ts --workers=1
 */
import { test, expect } from '@playwright/test'

const N = Number(process.env.CHURN_SIZE ?? 500)

test('zooming around does not leave the canvas permanently slower', async ({ page }) => {
  test.skip(!process.env.PERF, 'perf harness — run with PERF=1')
  test.setTimeout(600_000)
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)

  await page.evaluate((n) => {
    const SYMS = ['instr.bubble', 'valve.gate', 'valve.globe', 'valve.check', 'cv.globe', 'pump.centrifugal', 'vessel.vertical', 'vessel.horizontal', 'fit.junction']
    const PORTS: Record<string, string[]> = { 'instr.bubble': ['w', 'e'], 'valve.gate': ['w', 'e'], 'valve.globe': ['w', 'e'], 'valve.check': ['w', 'e'], 'cv.globe': ['w', 'e'], 'pump.centrifugal': ['suction', 'discharge'], 'vessel.vertical': ['n', 's'], 'vessel.horizontal': ['w', 'e'], 'fit.junction': ['w', 'e'] }
    const cols = Math.ceil(Math.sqrt(n))
    const nodes: any[] = []
    const edges: any[] = []
    for (let i = 0; i < n; i++) {
      const symbolId = SYMS[i % SYMS.length]!
      nodes.push({ id: 'n' + i, symbolId, kind: 'valve', x: (i % cols) * 120, y: Math.floor(i / cols) * 120, rotation: 0, label: 'Item ' + i })
    }
    for (let i = 0; i + 1 < n; i++) {
      edges.push({ id: 'e' + i, lineClass: 'process.major',
        source: { nodeId: 'n' + i, portId: PORTS[nodes[i].symbolId]![1] },
        target: { nodeId: 'n' + (i + 1), portId: PORTS[nodes[i + 1].symbolId]![0] } })
    }
    const now = new Date().toISOString()
    ;(window as any).__pid.useStore.getState().loadIntoStore({
      schemaVersion: 5, meta: { name: 'churn', author: '', created: now, modified: now },
      settings: { gridPx: 8, tagSeparator: '-', numberStart: 100 },
      sheets: [{ id: 'sh1', name: 'Sheet 1', drawingNumber: '', revision: '0', sheetSize: 'A1', nodes, edges }],
      hmiScreens: [], fluids: [],
    })
  }, N)
  await expect(page.locator('[model-id]')).toHaveCount(N + (N - 1), { timeout: 60_000 })

  await page.evaluate(() => {
    const w = window as any
    w.__c = { frames: [] as { t: number; dt: number }[] }
    let last = performance.now()
    const loop = () => { const t = performance.now(); w.__c.frames.push({ t, dt: t - last }); last = t; requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  })

  const idx = (() => { let i = Math.floor(N / 2); while (i % 9 !== 6 && i < N - 1) i++; return i })()

  const settle = async () => {
    await page.evaluate(({ id }) => {
      const { paper, graph } = (window as any).__pid.canvasRef
      const b = graph.getCell(id).getBBox()
      paper.scale(1, 1)
      const size = paper.getComputedSize()
      paper.translate(size.width / 2 - (b.x + b.width / 2), size.height / 2 - (b.y + b.height / 2))
    }, { id: `n${idx}` })
    await page.waitForTimeout(900)
  }

  const measure = async (label: string) => {
    await settle()
    const mounted = await page.locator('[model-id]').count()
    const box = await page.locator(`[model-id="n${idx}"]`).first().boundingBox()
    if (!box) throw new Error('target off screen')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.evaluate(() => { (window as any).__c.frames.length = 0 })
    const r = await page.evaluate(async ({ cx, cy }) => {
      const times: number[] = []
      const t0 = performance.now()
      for (let i = 0; i < 120; i++) {
        const s = performance.now()
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: cx + 26 * Math.sin(i / 8) + i * 0.3, clientY: cy + 18 * Math.cos(i / 6), button: 0, buttons: 1 }))
        times.push(performance.now() - s)
        if (i % 3 === 2) await new Promise<void>((r2) => requestAnimationFrame(() => r2()))
      }
      const t1 = performance.now()
      const up = performance.now()
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      const upMs = performance.now() - up
      const w = window as any
      const frames = (w.__c.frames as { t: number; dt: number }[]).filter((fr) => fr.t >= t0 && fr.t <= t1).map((fr) => fr.dt)
      const heap = (performance as any).memory?.usedJSHeapSize ?? 0
      return { times, upMs, frames, heap }
    }, { cx, cy })
    await page.mouse.up().catch(() => {})
    await page.waitForTimeout(400)
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    return {
      label, mounted,
      move: mean(r.times),
      fps: 1000 / mean(r.frames.filter((d) => d > 0)),
      up: r.upMs,
      heapMb: r.heap / 1e6,
      svgNodes: await page.evaluate(() => document.querySelectorAll('.joint-paper svg *').length),
    }
  }

  const churn = async (rounds: number, pan: boolean) => {
    await page.evaluate(async ({ rounds, pan }) => {
      const { paper } = (window as any).__pid.canvasRef
      for (let i = 0; i < rounds; i++) {
        for (const z of [1, 2, 3, 4, 3, 2, 1, 0.5, 0.25, 0.5]) {
          paper.scale(z, z)
          if (pan) paper.translate(-200 - i * 7, -150 - i * 5)
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
        }
      }
      await new Promise((r) => setTimeout(r, 500))
    }, { rounds, pan })
  }

  const rows = [await measure('fresh')]
  await churn(20, false)
  rows.push(await measure('after 200 zoom steps'))
  await churn(20, true)
  rows.push(await measure('after 200 more, with panning'))

  process.stderr.write(
    `\n########## ${N} objects — does zooming leave it slower? ##########\n` +
      rows
        .map((r) =>
          `  ${r.label.padEnd(30)} fps ${r.fps.toFixed(1).padStart(5)}   pointermove ${r.move.toFixed(2)} ms   mouseup ${r.up.toFixed(1)} ms\n` +
          `  ${''.padEnd(30)} mounted ${String(r.mounted).padStart(5)} cells   svg nodes ${String(r.svgNodes).padStart(6)}   heap ${r.heapMb.toFixed(1)} MB`,
        )
        .join('\n') + '\n',
  )

  // The claim under test: performance comes back to baseline.
  expect(rows[2]!.move).toBeLessThan(rows[0]!.move * 2 + 0.3)
})
