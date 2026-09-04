// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The same acceptance gesture on every engine, measured with nothing but the
 * clock and requestAnimationFrame — no CDP, so WebKit and Firefox can run it
 * and the numbers can be put side by side.
 *
 *     CROSS=1 npx playwright test e2e/browsers.spec.ts --workers=1
 *     CROSS=1 npx playwright test e2e/browsers.spec.ts --browser=webkit --workers=1
 *     CROSS=1 SHEET=oldfilter npx playwright test e2e/browsers.spec.ts --browser=webkit
 *
 * This is where the sheet filter's real cost showed up. Chromium rasterises on
 * its own threads and never dropped a frame, so three rounds of profiling
 * called the drag fast. The same gesture on the same machine, WebKit, with the
 * pre-fix filter restored: 2.7 fps, and 2.2 seconds between letting go of a
 * symbol and seeing it land. Without it: the harness's 30 fps cap, and 100 ms.
 * Firefox sits between the two — 42 fps with the filter, 60 without.
 *
 * Note the cap: Playwright's WebKit build ticks requestAnimationFrame at 30 Hz
 * here, headless or headed, so 30 fps is this harness's ceiling and not a
 * measurement of Safari. Real Safari needs "Allow remote automation" turned on
 * in its Developer settings before WebDriver can reach it.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { applySheetMode } from './sheet-mode'

const DPR = Number(process.env.DPR ?? 2)
const [SCREEN_W, SCREEN_H] = (process.env.SCREEN ?? '1728x1080').split('x').map(Number)
const PNID = (process.env.PNID ?? `${homedir()}/Downloads/Praharsh-Test-2.pnid`).replace(/^~/, homedir())
/** full | oldfilter — see e2e/sheet-mode.ts. Lets the same engine be measured
 *  with and without the pre-fix full-page filter. */
const SHEET = process.env.SHEET ?? 'full'

test.use({ viewport: { width: SCREEN_W!, height: SCREEN_H! }, deviceScaleFactor: DPR })
test.skip(!process.env.CROSS, 'cross-browser harness — run with CROSS=1')

test('the reported workflow, twice through, on this engine', async ({ page, browserName }) => {
  test.setTimeout(900_000)
  const raw = JSON.parse(readFileSync(PNID, 'utf8'))
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  const summary = await page.evaluate(async (doc) => {
    const mod = (await import(/* @vite-ignore */ '/src/model/migrate.ts')) as { loadDoc(raw: unknown): any }
    const m = mod.loadDoc(doc)
    ;(window as any).__pid.useStore.getState().loadIntoStore(m)
    return { nodes: m.sheets[0].nodes.length, edges: m.sheets[0].edges.length }
  }, raw)
  await expect(page.locator('[model-id]')).toHaveCount(summary.nodes + summary.edges, { timeout: 60_000 })
  await page.evaluate(applySheetMode, SHEET)
  await page.waitForTimeout(800)

  const out = await page.evaluate(async () => {
    const w = window as any
    const { paper, graph } = w.__pid.canvasRef
    const host = document.querySelector('.canvas-host') as HTMLElement
    const r = host.getBoundingClientRect()
    const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()))
    const move = (x: number, y: number, buttons = 1) =>
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }))

    const frames: number[] = []
    let last = performance.now()
    let running = true
    const loop = () => { const t = performance.now(); frames.push(t - last); last = t; if (running) requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
    const long: number[] = []
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration) })
        .observe({ entryTypes: ['longtask'] })
    } catch { /* WebKit has no longtask */ }

    const biggest = (skip: string[]) => {
      let best: any = null
      for (const e of graph.getElements()) {
        if (skip.includes(String(e.id))) continue
        const b = e.getBBox()
        if (!best || b.width * b.height > best.a) best = { id: String(e.id), a: b.width * b.height }
      }
      return best.id as string
    }
    const dragSymbol = async (id: string) => {
      const b = graph.getCell(id).getBBox()
      const p = paper.localToClientPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
      const el = document.elementFromPoint(p.x, p.y)
      const t0 = performance.now()
      el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
      const press = performance.now() - t0
      const moves: number[] = []
      for (let i = 0; i < 60; i++) {
        const m = performance.now()
        move(p.x + 20 * Math.sin(i / 7) + i * 0.5, p.y + 14 * Math.cos(i / 5))
        moves.push(performance.now() - m)
        if (i % 3 === 2) await frame()
      }
      const t = performance.now()
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      const sync = performance.now() - t
      for (let i = 0; i < 3; i++) await frame()
      moves.sort((a, b) => a - b)
      return { press, movep99: moves[Math.floor(moves.length * 0.99)] ?? 0, sync, painted: performance.now() - t }
    }
    const drawLine = async () => {
      const halo = document.querySelector('[joint-selector="portBody"]') as SVGElement | null
      if (!halo) return null
      const hb = halo.getBoundingClientRect()
      const sx = hb.x + hb.width / 2
      const sy = hb.y + hb.height / 2
      const before = graph.getLinks().length
      const t = performance.now()
      halo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0, buttons: 1 }))
      const down = performance.now() - t
      for (let i = 0; i < 50; i++) { move(sx + i * 2, sy + 10 * Math.sin(i / 5)); if (i % 3 === 2) await frame() }
      const u = performance.now()
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      return { down, up: performance.now() - u, added: graph.getLinks().length - before }
    }
    const wheel = async (n: number, dir: number) => {
      for (let i = 0; i < n; i++) {
        host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: centre.x, clientY: centre.y, deltaY: dir * 40 }))
        await frame()
      }
    }

    const zoomFrames: number[][] = []
    const dragFrames: number[][] = []
    const mark = () => frames.length
    const since = (i: number) => frames.slice(i)

    const drops: any[] = []
    const lines: any[] = []
    const dragged: string[] = []
    for (let round = 0; round < 2; round++) {
      let i = mark(); await wheel(11, -1); zoomFrames.push(since(i))
      await new Promise((res) => setTimeout(res, 200))
      const a = biggest(dragged); dragged.push(a)
      i = mark(); drops.push(await dragSymbol(a)); dragFrames.push(since(i))
      const b = biggest(dragged); dragged.push(b)
      drops.push(await dragSymbol(b))
      lines.push(await drawLine())
      const t = paper.translate(); paper.translate(t.tx - 160, t.ty - 120)
      for (let k = 0; k < 6; k++) await frame()
      await wheel(11, 1)
      await new Promise((res) => setTimeout(res, 200))
    }
    await new Promise((res) => setTimeout(res, 400))
    running = false
    const st = (xs: number[]) => {
      const s = xs.filter((v) => v > 0).sort((a, b) => a - b)
      const at = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0
      return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / (s.length || 1), p90: at(0.9), p99: at(0.99), max: s[s.length - 1] ?? 0 }
    }
    return {
      all: st(frames), zoom: st(zoomFrames.flat()), drag: st(dragFrames.flat()),
      drops, lines, long: { n: long.length, ms: long.reduce((a, b) => a + b, 0) },
      scale: paper.scale().sx,
    }
  })

  const f = (v: number) => v.toFixed(1).padStart(6)
  process.stderr.write(
    [
      '',
      `################ ${browserName.toUpperCase()} — ${summary.nodes + summary.edges} cells, ${SCREEN_W}x${SCREEN_H} @ DPR ${DPR}, sheet=${SHEET}${process.env.HEADED_NOTE ?? ''} ################`,
      `  frames (whole run)  n ${out.all.n}  fps ${(1000 / out.all.mean).toFixed(1)}  p90 ${f(out.all.p90)} ms  p99 ${f(out.all.p99)} ms  max ${f(out.all.max)} ms`,
      `  frames during zoom  n ${out.zoom.n}  fps ${(1000 / out.zoom.mean).toFixed(1)}  p99 ${f(out.zoom.p99)} ms  max ${f(out.zoom.max)} ms`,
      `  frames during drag  n ${out.drag.n}  fps ${(1000 / out.drag.mean).toFixed(1)}  p99 ${f(out.drag.p99)} ms  max ${f(out.drag.max)} ms`,
      ...out.drops.map(
        (d: any, i: number) =>
          `  drag ${i + 1}: press ${d.press.toFixed(2)} ms · move p99 ${d.movep99.toFixed(2)} ms · release ${d.sync.toFixed(2)} ms sync, ${d.painted.toFixed(0)} ms to paint`,
      ),
      `  lines: ${out.lines.map((l: any) => (l ? `press ${l.down.toFixed(1)} ms, release ${l.up.toFixed(1)} ms, +${l.added}` : 'none')).join('  ·  ')}`,
      `  long tasks: ${out.long.n} (${out.long.ms.toFixed(0)} ms)${out.long.n === 0 ? ' — WebKit reports none; it has no longtask entry type' : ''}`,
    ].join('\n') + '\n',
  )
  // Every release must return within a frame on every engine.
  for (const d of out.drops as any[]) expect(d.sync, 'a release must not block').toBeLessThan(16)
})
