// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Zoom-dependent canvas performance.
 *
 * perf.spec.ts always measures at 1:1. This one holds the drawing and the
 * gestures constant and varies ONLY the camera scale — the variable the user's
 * report points at. Note the baseline: the editor opens FITTED, which on an A1
 * sheet is around 25%, so "zoomed in" for a user means 100% and up.
 *
 * Three gestures per zoom level: dragging a symbol, releasing it, and drawing
 * a line from one port to another.
 *
 *     PERF=1 npx playwright test e2e/zoom.spec.ts --workers=1
 *
 * Attribution switches, for isolating browser rendering cost:
 *     SHEET=none   strip the sheet page entirely (shadow + grid + border)
 *     SHEET=noshadow   keep the grid, drop the shadow geometry
 *     SHEET=nogrid     keep the shadow, drop the pattern fill
 *     SHEET=oldfilter  put the pre-fix feDropShadow back, for before/after
 */
import { test, expect } from '@playwright/test'
import { applySheetMode } from './sheet-mode'

const ZOOMS = (process.env.ZOOMS ?? '0.25,0.5,1,2,3,4').split(',').map(Number)
const SIZES = process.env.PERF ? (process.env.ZOOM_SIZES ?? '250').split(',').map(Number) : []
const SHEET = process.env.SHEET ?? 'full'

function topSelf(profile: any, limit = 10): { name: string; ms: number; via: string }[] {
  const byId = new Map<number, any>()
  const parent = new Map<number, number>()
  for (const nd of profile.nodes) byId.set(nd.id, nd)
  for (const nd of profile.nodes) for (const c of nd.children ?? []) parent.set(c, nd.id)
  const label = (id: number | undefined) => {
    const f = byId.get(id ?? -1)?.callFrame
    if (!f) return ''
    const url = String(f.url ?? '').replace(/^https?:\/\/localhost:5173/, '').split('?')[0]
    return `${f.functionName || '(anon)'}${url ? ' ' + url.replace('/node_modules/.vite/deps/', '~').replace(/^\/src\//, 'src/') : ''}`
  }
  const self = new Map<number, number>()
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const id = profile.samples[i]
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0))
  }
  // Merge the same function across nodes, keeping the heaviest caller chain.
  const merged = new Map<string, { ms: number; via: string; viaMs: number }>()
  for (const [id, us] of self) {
    const key = label(id)
    const chain: string[] = []
    let p = parent.get(id)
    for (let d = 0; d < 3 && p !== undefined; d++) { chain.push(label(p)); p = parent.get(p) }
    const cur = merged.get(key)
    const ms = us / 1000
    if (!cur) merged.set(key, { ms, via: chain.join(' ← '), viaMs: ms })
    else {
      cur.ms += ms
      if (ms > cur.viaMs) { cur.via = chain.join(' ← '); cur.viaMs = ms }
    }
  }
  return [...merged.entries()].map(([name, v]) => ({ name, ms: v.ms, via: v.via })).sort((a, b) => b.ms - a.ms).slice(0, limit)
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
    return { schemaVersion: 5, meta: { name: 'zoom ' + n, author: '', created: now, modified: now },
      settings: { gridPx: 8, tagSeparator: '-', numberStart: 100 },
      sheets: [{ id: 'sh1', name: 'Sheet 1', drawingNumber: '', revision: '0', sheetSize: 'A1', nodes, edges }],
      hmiScreens: [], fluids: [] }
  })()`
}

const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  const at = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : 0)
  return { mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: s[s.length - 1] ?? 0, n: s.length }
}
const f = (v: number, d = 2) => v.toFixed(d).padStart(6)

for (const n of SIZES) {
  test(`zoom sweep @ ${n} objects [sheet=${SHEET}]`, async ({ page }) => {
    test.setTimeout(900_000)
    await page.goto('/app')
    await page.waitForFunction(() => '__pid' in window)
    await page.evaluate((src) => { (window as any).__pid.useStore.getState().loadIntoStore(eval(src)) }, buildDocSource(n))
    await expect(page.locator('[model-id]')).toHaveCount(n + (n - 1), { timeout: 60_000 })

    await page.evaluate(() => {
      const w = window as any
      w.__z = { frames: [] as { t: number; dt: number }[], long: [] as { t: number; d: number }[], renderDone: 0, storeWrites: 0, conn: 0, batch: 0 }
      const paper = w.__pid.canvasRef.paper
      paper.on('render:done', () => { w.__z.renderDone++ })
      paper.model.on('batch:stop', () => { w.__z.batch++ })
      w.__pid.useStore.subscribe(() => { w.__z.storeWrites++ })
      const ns = paper.options.connectorNamespace
      if (ns && !ns.__counted) {
        const orig = ns.jumpover
        ns.jumpover = function (...a: unknown[]) { w.__z.conn++; return orig.apply(this, a) }
        ns.__counted = true
      }
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__z.long.push({ t: e.startTime, d: e.duration }) })
          .observe({ entryTypes: ['longtask'] })
      } catch { /* unsupported */ }
      let last = performance.now()
      const loop = () => { const t = performance.now(); w.__z.frames.push({ t, dt: t - last }); last = t; requestAnimationFrame(loop) }
      requestAnimationFrame(loop)
    })
    // Attribution switches: take pieces of the drawing sheet out and see what
    // the frames do. The sheet is re-rendered on sheet-size change, so this is
    // applied once and the sweep never changes sheet size.
    await page.evaluate(applySheetMode, SHEET)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })

    const idx = (() => { let i = Math.floor(n / 2); while (i % 9 !== 6 && i < n - 1) i++; return i })()
    const lines: string[] = ['', `########## ${n} objects · sheet=${SHEET} ##########`]

    for (const zoom of ZOOMS) {
      await page.evaluate(({ z, id }) => {
        const { paper, graph } = (window as any).__pid.canvasRef
        const b = graph.getCell(id).getBBox()
        paper.scale(z, z)
        const size = paper.getComputedSize()
        paper.translate(size.width / 2 - (b.x + b.width / 2) * z, size.height / 2 - (b.y + b.height / 2) * z)
      }, { z: zoom, id: `n${idx}` })
      await page.waitForTimeout(900)

      const mounted = await page.locator('[model-id]').count()
      const box = await page.locator(`[model-id="n${idx}"]`).first().boundingBox()
      if (!box) { lines.push(`  ${(zoom * 100).toFixed(0)}% — target off screen, skipped`); continue }
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2

      // ---------------- DRAG + RELEASE ----------------
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(60)
      await page.evaluate(() => {
        const w = window as any
        w.__z.frames.length = 0; w.__z.long.length = 0
        w.__z.renderDone = 0; w.__z.storeWrites = 0; w.__z.conn = 0; w.__z.batch = 0
      })
      await cdp.send('Profiler.start')

      const drag = await page.evaluate(async ({ cx, cy }) => {
        const times: number[] = []
        const t0 = performance.now()
        for (let i = 0; i < 150; i++) {
          const x = cx + 30 * Math.sin(i / 9) + i * 0.4
          const y = cy + 22 * Math.cos(i / 7)
          const s = performance.now()
          document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
          times.push(performance.now() - s)
          if (i % 3 === 2) await new Promise<void>((r) => requestAnimationFrame(() => r()))
        }
        return { times, t0, t1: performance.now() }
      }, { cx, cy })

      // The release is what the user calls "a delay before it is placed": the
      // synchronous handler chain, then however long the page takes to paint
      // three settled frames afterwards.
      const release = await page.evaluate(async () => {
        const w = window as any
        const before = { conn: w.__z.conn, renderDone: w.__z.renderDone, writes: w.__z.storeWrites, long: w.__z.long.length }
        const t0 = performance.now()
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
        const sync = performance.now() - t0
        for (let i = 0; i < 3; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()))
        const painted = performance.now() - t0
        await new Promise((r) => setTimeout(r, 600))
        return {
          sync, painted,
          conn: w.__z.conn - before.conn,
          renderDone: w.__z.renderDone - before.renderDone,
          writes: w.__z.storeWrites - before.writes,
          long: (w.__z.long as { d: number }[]).slice(before.long).reduce((a, b) => a + b.d, 0),
        }
      })
      const dragProfile = (await cdp.send('Profiler.stop')).profile
      await page.mouse.up().catch(() => {})

      const during = await page.evaluate((t) => {
        const w = window as any
        return {
          frames: (w.__z.frames as { t: number; dt: number }[]).filter((fr) => fr.t >= t.t0 && fr.t <= t.t1).map((fr) => fr.dt),
          long: (w.__z.long as { t: number; d: number }[]).filter((l) => l.t >= t.t0 && l.t <= t.t1).map((l) => l.d),
          renderDone: w.__z.renderDone, conn: w.__z.conn, batch: w.__z.batch, writes: w.__z.storeWrites,
        }
      }, { t0: drag.t0, t1: drag.t1 })

      // ---------------- LINE DRAW ----------------
      await cdp.send('Profiler.start')
      // Press the connection point on one symbol, pull to the next, let go.
      const link = await page.evaluate(async ({ id }) => {
        const w = window as any
        const { paper, graph } = w.__pid.canvasRef
        const src = graph.getCell(id)
        if (!src) return null
        const before = graph.getLinks().length
        const halo = document.querySelector(`[model-id="${id}"] [joint-selector="portBody"]`) as SVGElement | null
        if (!halo) return null
        const r = halo.getBoundingClientRect()
        const sx = r.x + r.width / 2
        const sy = r.y + r.height / 2
        const down = performance.now()
        halo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0, buttons: 1 }))
        const downMs = performance.now() - down
        const times: number[] = []
        const t0 = performance.now()
        for (let i = 0; i < 90; i++) {
          const x = sx + i * 2.2
          const y = sy + 14 * Math.sin(i / 6)
          const s = performance.now()
          document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
          times.push(performance.now() - s)
          if (i % 3 === 2) await new Promise<void>((r2) => requestAnimationFrame(() => r2()))
        }
        const t1 = performance.now()
        const up = performance.now()
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
        const upMs = performance.now() - up
        await new Promise((r2) => setTimeout(r2, 500))
        return { downMs, upMs, times, t0, t1, added: graph.getLinks().length - before }
      }, { id: `n${idx}` })
      const linkProfile = (await cdp.send('Profiler.stop')).profile

      const h = stats(drag.times)
      const fr = stats(during.frames.filter((d) => d > 0))
      const lh = link ? stats(link.times) : null
      lines.push(
        ``,
        `  ── ${(zoom * 100).toFixed(0).padStart(3)}% ── mounted ${String(mounted).padStart(4)} cells ──────────────────────`,
        `     DRAG  fps ${(fr.mean ? 1000 / fr.mean : 0).toFixed(1).padStart(5)}   frame p90 ${f(fr.p90, 1)}  p99 ${f(fr.p99, 1)}  max ${f(fr.max, 1)} ms`,
        `           pointermove mean ${f(h.mean)}  p90 ${f(h.p90)}  p99 ${f(h.p99)}  max ${f(h.max)} ms`,
        `           long ${during.long.length} (${during.long.reduce((a, b) => a + b, 0).toFixed(0)} ms)   render:done ${during.renderDone}  connector ${during.conn}`,
        `     DROP  mouseup handler ${release.sync.toFixed(1)} ms   3 frames later ${release.painted.toFixed(1)} ms   long ${release.long.toFixed(0)} ms`,
        `           connector ${release.conn}  render:done ${release.renderDone}  store writes ${release.writes}`,
        link && lh
          ? `     LINE  mousedown ${link.downMs.toFixed(1)} ms   move mean ${f(lh.mean)}  p90 ${f(lh.p90)}  max ${f(lh.max)} ms   mouseup ${link.upMs.toFixed(1)} ms   (+${link.added} link)`
          : `     LINE  no port halo found`,
        `     CPU self-time, drag+release:`,
        ...topSelf(dragProfile).map((r) => `        ${r.ms.toFixed(1).padStart(7)} ms  ${r.name}${r.via ? `\n                        via ${r.via}` : ''}`),
        `     CPU self-time, LINE DRAW:`,
        ...topSelf(linkProfile).map((r) => `        ${r.ms.toFixed(1).padStart(7)} ms  ${r.name}${r.via ? `\n                        via ${r.via}` : ''}`),
      )
    }
    process.stderr.write(lines.join('\n') + '\n')
  })
}
