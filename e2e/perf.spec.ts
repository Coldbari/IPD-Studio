// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The canvas performance harness.
 *
 * Not part of the normal suite — it takes about a minute, and its numbers move
 * with whatever else the machine is doing, so it measures rather than asserts.
 * Run it when touching the canvas:
 *
 *     PERF=1 npx playwright test e2e/perf.spec.ts --workers=1
 *
 * It reports, for 50 / 100 / 250 / 500 / 1,000 objects: time to first paint of
 * the drawing, how many cells the browser is actually holding, the synchronous
 * cost of one pointermove, frame times through a drag, long tasks during the
 * drag and after the drop, store writes, connector runs, network requests, and
 * a CPU profile of the top self-time functions in each phase.
 */
import { test, expect } from '@playwright/test'

/** Aggregate a CDP CPU profile into top self-time functions. */
function topSelf(profile: any, limit = 14): string[] {
  const byId = new Map<number, any>()
  for (const nd of profile.nodes) byId.set(nd.id, nd)
  const self = new Map<number, number>()
  const total = profile.timeDeltas?.reduce((a: number, b: number) => a + b, 0) ?? 0
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const id = profile.samples[i]
    const dt = profile.timeDeltas[i] ?? 0
    self.set(id, (self.get(id) ?? 0) + dt)
  }
  const rows = [...self.entries()]
    .map(([id, us]) => {
      const nd = byId.get(id)
      const f = nd?.callFrame ?? {}
      const url = String(f.url ?? '').replace(/^https?:\/\/localhost:5173/, '').split('?')[0]
      return { name: `${f.functionName || '(anonymous)'} ${url}:${(f.lineNumber ?? 0) + 1}`, ms: us / 1000 }
    })
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
  return [`   (profile total ${(total / 1000).toFixed(0)} ms)`, ...rows.map((r) => `   ${r.ms.toFixed(1).padStart(7)} ms  ${r.name}`)]
}

const SIZES = process.env.PERF ? [50, 100, 250, 500, 1000] : []

declare global {
  interface Window {
    __pid: { useStore: any; canvasRef: any }
    __perf: {
      frames: number[]
      long: number[]
      storeWrites: number
      renderDone: number
      moves: number
      moveMs: number
    }
  }
}

function buildDocSource(n: number): string {
  return `(() => {
    const SYMS = ['instr.bubble','valve.gate','valve.globe','valve.check','cv.globe','pump.centrifugal','vessel.vertical','vessel.horizontal','fit.junction']
    const PORTS = { 'instr.bubble': ['w','e'], 'valve.gate': ['w','e'], 'valve.globe': ['w','e'], 'valve.check': ['w','e'], 'cv.globe': ['w','e'], 'pump.centrifugal': ['suction','discharge'], 'vessel.vertical': ['n','s'], 'vessel.horizontal': ['w','e'], 'fit.junction': ['w','e'] }
    const n = ${n}
    const cols = Math.ceil(Math.sqrt(n))
    const nodes = [], edges = []
    for (let i = 0; i < n; i++) {
      const symbolId = SYMS[i % SYMS.length]
      nodes.push({ id: 'n' + i, symbolId,
        kind: symbolId.startsWith('instr') ? 'instrument' : (symbolId.startsWith('valve') || symbolId.startsWith('cv')) ? 'valve' : 'equipment',
        x: (i % cols) * 120, y: Math.floor(i / cols) * 120, rotation: 0,
        tag: symbolId.startsWith('instr') ? { letters: 'FT', loop: String(100 + i) } : undefined,
        label: 'Item ' + i })
    }
    for (let i = 0; i + 1 < n; i++) {
      const a = nodes[i], b = nodes[i+1]
      edges.push({ id: 'e' + i, lineClass: i % 4 === 0 ? 'signal.electric' : 'process.major',
        source: { nodeId: a.id, portId: PORTS[a.symbolId][1] },
        target: { nodeId: b.id, portId: PORTS[b.symbolId][0] } })
    }
    const now = new Date().toISOString()
    return { schemaVersion: 5, meta: { name: 'perf ' + n, author: '', created: now, modified: now },
      settings: { gridPx: 8, tagSeparator: '-', numberStart: 100 },
      sheets: [{ id: 'sh1', name: 'Sheet 1', drawingNumber: '', revision: '0', sheetSize: 'A1', nodes, edges }],
      hmiScreens: [], fluids: [] }
  })()`
}

for (const n of SIZES) {
  test(`perf @ ${n} objects`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/app')
    await page.waitForFunction(() => '__pid' in window)

    // ---- initial render ------------------------------------------------
    const loadMs = await page.evaluate(async (src) => {
      const doc = eval(src)
      const want = doc.sheets[0].nodes.length + doc.sheets[0].edges.length
      const t0 = performance.now()
      window.__pid.useStore.getState().loadIntoStore(doc)
      // settled = every cell has a rendered view AND a frame has gone by with
      // the count stable, which is what "the drawing is on screen" means.
      await new Promise<void>((r) => {
        const deadline = performance.now() + 60000
        const tick = () => {
          if (document.querySelectorAll('[model-id]').length >= want || performance.now() > deadline) {
            requestAnimationFrame(() => r())
          } else requestAnimationFrame(tick)
        }
        tick()
      })
      return performance.now() - t0
    }, buildDocSource(n))

    await expect(page.locator('[model-id]')).toHaveCount(n + (n - 1), { timeout: 60_000 })
    // Recorded after the zoom-in below: on a big sheet the paper only keeps
    // what is near the window mounted, so this is the DOM the browser is
    // actually paying for while you draw.
    let mounted = n + (n - 1)

    // EXPERIMENT: swap the jumpover connector out to attribute its cost.
    if (process.env.PERF_NOJUMP) {
      await page.evaluate(async () => {
        const graph = window.__pid.canvasRef.graph
        for (const l of graph.getLinks()) l.set('connector', { name: 'normal' })
        await new Promise<void>((r) => setTimeout(r, 1500))
      })
    }

    // ---- instrumentation ------------------------------------------------
    await page.evaluate(() => {
      window.__perf = { frames: [], long: [], storeWrites: 0, renderDone: 0, moves: 0, moveMs: 0 }
      ;(window as any).__conn = 0
      ;(window as any).__batch = 0
      const paper0 = window.__pid.canvasRef.paper
      const ns = paper0.options.connectorNamespace
      if (ns && !ns.__counted) {
        const orig = ns.jumpover
        ns.jumpover = function (...a: unknown[]) { (window as any).__conn++; return orig.apply(this, a) }
        ns.__counted = true
      }
      paper0.model.on('batch:stop', () => { (window as any).__batch++ })
      window.__pid.useStore.subscribe(() => { window.__perf.storeWrites++ })
      window.__pid.canvasRef.paper.on('render:done', () => { window.__perf.renderDone++ })
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(e.duration) })
          .observe({ entryTypes: ['longtask'] })
      } catch { /* no longtask support */ }
      let last = performance.now()
      const loop = () => {
        const t = performance.now()
        window.__perf.frames.push(t - last)
        ;(window as any).__frameAt = ((window as any).__frameAt ?? [])
        ;(window as any).__frameAt.push(t)
        last = t
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })

    // Pick a LARGE symbol (vessel.vertical, every 9th) near the middle: an
    // 8px-radius invisible port halo covers most of a small symbol, and a
    // press that lands on one starts a LINK drag, not an element drag.
    const idx = (() => { let i = Math.floor(n / 2); while (i % 9 !== 6 && i < n - 1) i++; return i })()
    const target = `[model-id="n${idx}"]`
    await page.evaluate((i) => { (window as any).__idx = i }, idx)
    await page.evaluate(() => {
      // zoom to 1:1 around the middle node so the drag happens over dense content
      const { paper } = window.__pid.canvasRef
      const cell = window.__pid.canvasRef.graph.getCell('n' + (window as any).__idx)
      paper.scale(1, 1)
      const b = window.__pid.canvasRef.graph.getCell('n' + (window as any).__idx).getBBox()
      const size = paper.getComputedSize()
      paper.translate(size.width / 2 - b.x, size.height / 2 - b.y)
      void cell
    })
    await page.waitForTimeout(400)
    mounted = await page.locator('[model-id]').count()

    const box = await page.locator(target).first().boundingBox()
    if (!box) throw new Error('target not visible')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // §19: dragging must not talk to the network.
    const netDuringDrag: string[] = []
    let watchingNet = false
    page.on('request', (r) => { if (watchingNet) netDuringDrag.push(r.url()) })

    // reset counters right before the drag
    watchingNet = true
    await page.evaluate(() => {
      window.__perf.frames.length = 0
      window.__perf.long.length = 0
      window.__perf.storeWrites = 0
      window.__perf.renderDone = 0
      ;(window as any).__conn = 0
      ;(window as any).__batch = 0
    })

    // ---- the drag --------------------------------------------------------
    // Playwright's mouse API round-trips over CDP (~17 ms/move), which idles
    // the main thread between moves and flatters the frame rate. The gesture
    // is STARTED for real so JointJS sets its drag up exactly as a user would,
    // then the moves are dispatched in-page at full rate and each dispatch is
    // timed on its own: dispatchEvent is synchronous, so that IS the input
    // handler cost — the thing that decides whether the symbol tracks the
    // cursor or trails it.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await cdp.send('Profiler.start')

    const drag = await page.evaluate(async ({ cx, cy, id }) => {
      const cell = window.__pid.canvasRef.graph.getCell(id)
      const before = cell.position()
      const times: number[] = []
      const t0 = performance.now()
      const MOVES = 180
      for (let i = 0; i < MOVES; i++) {
        const x = cx + 40 * Math.sin(i / 9) + i * 0.5
        const y = cy + 30 * Math.cos(i / 7)
        const ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 })
        const t0 = performance.now()
        document.dispatchEvent(ev)
        times.push(performance.now() - t0)
        // yield every few moves so the async paper can actually paint,
        // mimicking a real input stream rather than a synchronous burst
        if (i % 3 === 2) await new Promise<void>((r) => requestAnimationFrame(() => r()))
      }
      const after = cell.position()
      return { times, moved: before.x !== after.x || before.y !== after.y, t0, t1: performance.now() }
    }, { cx, cy, id: `n${idx}` })

    watchingNet = false
    const dragProfile = (await cdp.send('Profiler.stop')).profile
    const during = await page.evaluate(() => ({
      frames: window.__perf.frames.slice(),
      at: ((window as any).__frameAt as number[] | undefined)?.slice() ?? [],
      long: window.__perf.long.slice(),
      storeWrites: window.__perf.storeWrites,
      renderDone: window.__perf.renderDone,
      conn: (window as any).__conn as number,
      batch: (window as any).__batch as number,
    }))
    const mt = drag.times.slice().sort((a, b) => a - b)
    const mpct = (p: number) => mt[Math.min(mt.length - 1, Math.floor(mt.length * p))]!
    const mmean = mt.reduce((s2, v) => s2 + v, 0) / mt.length

    // ---- the drop --------------------------------------------------------
    await page.evaluate(() => {
      window.__perf.long.length = 0
      window.__perf.storeWrites = 0
      window.__perf.renderDone = 0
      ;(window as any).__conn = 0
      ;(window as any).__batch = 0
    })
    const dropT0 = Date.now()
    await cdp.send('Profiler.start')
    await page.mouse.up()
    await page.waitForTimeout(1200) // let autosave (500ms debounce) land too
    const dropProfile = (await cdp.send('Profiler.stop')).profile
    const dropWall = Date.now() - dropT0
    const after = await page.evaluate(() => ({
      long: window.__perf.long.slice(),
      storeWrites: window.__perf.storeWrites,
      renderDone: window.__perf.renderDone,
      conn: (window as any).__conn as number,
      batch: (window as any).__batch as number,
    }))

    // Count only the frames painted BETWEEN the first and last synthetic move.
    // Outside that window the page is answering CDP round trips (profiler
    // start/stop, evaluate) during which rAF is suspended, and those gaps are
    // the harness, not the canvas.
    const fr = during.frames
      .filter((f, i) => f > 0 && during.at[i]! >= drag.t0 && during.at[i]! <= drag.t1)
      .sort((a, b) => a - b)
    const pct = (p: number) => (fr.length ? fr[Math.min(fr.length - 1, Math.floor(fr.length * p))]! : 0)
    const mean = fr.length ? fr.reduce((s, f) => s + f, 0) / fr.length : 0
    const lines = [
      ``,
      `################ ${n} objects (${n} nodes + ${n - 1} edges) ################`,
      `  initial render (loadIntoStore -> render:done) : ${loadMs.toFixed(0)} ms`,
      `  cells in the DOM while drawing at 1:1        : ${mounted} of ${n + (n - 1)}`,
      `  DRAG  element actually moved: ${drag.moved}   (${drag.times.length} synthetic moves)`,
      `        pointermove HANDLER  mean ${mmean.toFixed(2)} ms  p50 ${mpct(0.5).toFixed(2)}  p90 ${mpct(0.9).toFixed(2)}  p99 ${mpct(0.99).toFixed(2)}  max ${mt[mt.length-1].toFixed(2)}`,
      `        ${fr.length} frames observed`,
      `        frame mean ${mean.toFixed(1)} ms  p50 ${pct(0.5).toFixed(1)}  p90 ${pct(0.9).toFixed(1)}  p99 ${pct(0.99).toFixed(1)}  max ${(fr[fr.length - 1] ?? 0).toFixed(1)}`,
      `        effective FPS ${(mean ? 1000 / mean : 0).toFixed(1)}`,
      `        long tasks ${during.long.length} (total ${during.long.reduce((s, d) => s + d, 0).toFixed(0)} ms, max ${Math.max(0, ...during.long).toFixed(0)} ms)`,
      `        network requests during the drag ${netDuringDrag.length}${netDuringDrag.length ? ` -> ${netDuringDrag.slice(0, 3).join(', ')}` : ''}`,
      `        store writes during drag ${during.storeWrites}   render:done ${during.renderDone}   batch:stop ${during.batch}   connector runs ${during.conn}`,
      `  DROP  wall ${dropWall} ms`,
      `        long tasks after drop ${after.long.length} (total ${after.long.reduce((s, d) => s + d, 0).toFixed(0)} ms, max ${Math.max(0, ...after.long).toFixed(0)} ms)`,
      `        store writes after drop ${after.storeWrites}   render:done ${after.renderDone}   batch:stop ${after.batch}   connector runs ${after.conn}`,
    ]
    lines.push('  --- CPU self-time, DRAG ---', ...topSelf(dragProfile))
    lines.push('  --- CPU self-time, DROP (incl. autosave) ---', ...topSelf(dropProfile))
    process.stderr.write(lines.join('\n') + '\n')
  })
}

/**
 * §18 — a long editing session must not leak. Places, moves, connects,
 * deletes, undoes and redoes for thousands of operations, then compares the
 * heap after a forced collection against the same measurement taken once the
 * caches have warmed up.
 */
test('a long editing session leaves memory flat', async ({ page }) => {
  test.skip(!process.env.PERF, 'perf harness — run with PERF=1')
  test.setTimeout(300_000)
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate((src) => { window.__pid.useStore.getState().loadIntoStore(eval(src)) }, buildDocSource(250))
  await expect(page.locator('[model-id]')).toHaveCount(499, { timeout: 60_000 })

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.enable')

  const churn = (rounds: number) =>
    page.evaluate(async (n) => {
      const { useStore } = window.__pid
      for (let i = 0; i < n; i++) {
        const s = useStore.getState()
        const id = s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 40 + (i % 50) * 8, y: 40, rotation: 0 })
        s.setNodePos(id, 48 + (i % 50) * 8, 56)
        s.addEdge({ lineClass: 'process.major', source: { nodeId: id, portId: 'e' }, target: { x: 400, y: 400 } })
        s.setSelection([id])
        s.deleteSelected()
        s.undo()
        s.redo()
        if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      await new Promise((r) => setTimeout(r, 300))
    }, rounds)

  const heap = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage')
    await page.waitForTimeout(250)
    return page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
  }

  // A heap that stays flat is only half the answer: SVG nodes, JointJS cell
  // views, highlighters and link tools are the things a canvas actually leaks,
  // and they can pile up while the heap looks fine.
  const census = () =>
    page.evaluate(() => {
      const { paper } = window.__pid.canvasRef as unknown as { paper: { dumpViews?: () => void; _views?: Record<string, unknown> } }
      const q = (sel: string) => document.querySelectorAll(sel).length
      return {
        svgNodes: q('.joint-paper svg *'),
        cells: q('[model-id]'),
        views: Object.keys((paper as { _views?: Record<string, unknown> })._views ?? {}).length,
        highlighters: q('.joint-highlight-stroke'),
        tools: q('.joint-tools'),
        ports: q('.pid-port-hit'),
      }
    })

  await churn(200) // warm every cache and fill the undo stack to its limit
  const before = await heap()
  const domBefore = await census()
  await churn(1500)
  const after = await heap()
  const domAfter = await census()

  const growthMb = (after - before) / 1024 / 1024
  const row = (k: keyof typeof domBefore) =>
    `  ${String(k).padEnd(14)} ${String(domBefore[k]).padStart(7)} → ${String(domAfter[k]).padStart(7)}   ${domAfter[k] - domBefore[k] >= 0 ? '+' : ''}${domAfter[k] - domBefore[k]}\n`
  process.stderr.write(
    `\n################ memory over a long session ################\n` +
      `  heap after warm-up (200 edit cycles) : ${(before / 1e6).toFixed(1)} MB\n` +
      `  heap after 1,500 more edit cycles    : ${(after / 1e6).toFixed(1)} MB\n` +
      `  growth                               : ${growthMb.toFixed(1)} MB\n` +
      `  --- DOM and view census, same two points ---\n` +
      (['svgNodes', 'cells', 'views', 'highlighters', 'tools', 'ports'] as const).map(row).join(''),
  )
  // The undo stack is capped at 200 states, so a steady-state session should
  // not keep climbing. Generous bound: this is a leak detector, not a budget.
  expect(growthMb).toBeLessThan(40)
  // Every cycle it runs puts a symbol and a line on the sheet and takes them
  // off again, so the canvas must end where it started, not 1,500 nodes up.
  expect(Math.abs(domAfter.svgNodes - domBefore.svgNodes), 'SVG nodes must not accumulate').toBeLessThan(50)
  expect(Math.abs(domAfter.views - domBefore.views), 'cell views must not accumulate').toBeLessThan(10)
  expect(domAfter.highlighters, 'no highlighter may be left behind').toBeLessThan(5)
  expect(domAfter.tools, 'no link tool layer may be left behind').toBeLessThan(5)
})
