// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The zoom sweep, run against a REAL drawing rather than a generated lattice.
 *
 * The synthetic sheets in perf.spec.ts and zoom.spec.ts explore 250-1,000
 * objects spread over an A1. A real IPD drawing is a different animal: about a
 * hundred cells packed onto an A3, quarter-turned and rescaled symbols, bent
 * pipes, flow arrows, per-symbol config — and small enough that viewport
 * culling never engages at all.
 *
 *     PERF=1 PNID=~/Downloads/Praharsh-Test-2.pnid \
 *       npx playwright test e2e/realdrawing.spec.ts --workers=1
 *
 * Reports, per zoom level, the four timings the user actually feels — press,
 * move, release, and how long until the canvas is quiet again — plus a
 * per-store-action breakdown of the release and a CPU profile.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const ZOOMS = (process.env.ZOOMS ?? '1,1.5,2,3,4').split(',').map(Number)

/**
 * The display matters as much as the drawing. Playwright defaults to a
 * 1280x720 window at deviceScaleFactor 1; a Retina laptop paints four times
 * the device pixels into a window twice the area, and paint cost is the one
 * thing that genuinely grows with zoom. DPR=2 SCREEN=1728x1080 models it.
 */
const DPR = Number(process.env.DPR ?? 1)
const [SCREEN_W, SCREEN_H] = (process.env.SCREEN ?? '1280x720').split('x').map(Number)
test.use({ viewport: { width: SCREEN_W!, height: SCREEN_H! }, deviceScaleFactor: DPR })
const PNID = (process.env.PNID ?? `${homedir()}/Downloads/Praharsh-Test-2.pnid`).replace(/^~/, homedir())

function topSelf(profile: any, limit = 12): { name: string; ms: number; via: string }[] {
  const byId = new Map<number, any>()
  const parent = new Map<number, number>()
  for (const nd of profile.nodes) byId.set(nd.id, nd)
  for (const nd of profile.nodes) for (const c of nd.children ?? []) parent.set(c, nd.id)
  const label = (id: number | undefined) => {
    const f = byId.get(id ?? -1)?.callFrame
    if (!f) return ''
    const url = String(f.url ?? '').replace(/^https?:\/\/localhost:5173/, '').split('?')[0]
    return `${f.functionName || '(anon)'}${url ? ' ' + url.replace('/node_modules/.vite/deps/', '~') : ''}`
  }
  const self = new Map<number, number>()
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const id = profile.samples[i]
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0))
  }
  const merged = new Map<string, { ms: number; via: string; viaMs: number }>()
  for (const [id, us] of self) {
    const key = label(id)
    const chain: string[] = []
    let p = parent.get(id)
    for (let d = 0; d < 3 && p !== undefined; d++) { chain.push(label(p)); p = parent.get(p) }
    const cur = merged.get(key)
    const ms = us / 1000
    if (!cur) merged.set(key, { ms, via: chain.join(' ← '), viaMs: ms })
    else { cur.ms += ms; if (ms > cur.viaMs) { cur.via = chain.join(' ← '); cur.viaMs = ms } }
  }
  return [...merged.entries()].map(([name, v]) => ({ name, ms: v.ms, via: v.via })).sort((a, b) => b.ms - a.ms).slice(0, limit)
}

const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b)
  const at = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : 0)
  return { mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0, p90: at(0.9), p99: at(0.99), max: s[s.length - 1] ?? 0, n: s.length }
}
const f = (v: number, d = 2) => v.toFixed(d).padStart(7)

test(`real drawing zoom sweep`, async ({ page }) => {
  test.skip(!process.env.PERF, 'perf harness — run with PERF=1')
  test.setTimeout(900_000)
  const raw = JSON.parse(readFileSync(PNID, 'utf8'))

  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)

  const summary = await page.evaluate(async (doc) => {
    const mod = (await import(/* @vite-ignore */ '/src/model/migrate.ts')) as { loadDoc(raw: unknown): any }
    const migrated = mod.loadDoc(doc)
    ;(window as any).__pid.useStore.getState().loadIntoStore(migrated)
    const sheet = migrated.sheets[0]
    return { nodes: sheet.nodes.length, edges: sheet.edges.length, size: sheet.sheetSize, name: migrated.meta.name }
  }, raw)

  await expect(page.locator('[model-id]')).toHaveCount(summary.nodes + summary.edges, { timeout: 60_000 })

  // Instrumentation: count and time the connector, the visibility callback,
  // and every store action a drop can reach.
  await page.evaluate(() => {
    const w = window as any
    w.__r = {
      frames: [] as { t: number; dt: number }[], long: [] as { t: number; d: number }[],
      renderDone: 0, conn: 0, connMs: 0, vis: 0, visMs: 0, actions: {} as Record<string, { n: number; ms: number }>,
    }
    const paper = w.__pid.canvasRef.paper
    paper.on('render:done', () => { w.__r.renderDone++ })

    const ns = paper.options.connectorNamespace
    if (ns && !ns.__timed) {
      const orig = ns.jumpover
      ns.jumpover = function (...a: unknown[]) {
        const s = performance.now(); const out = orig.apply(this, a)
        w.__r.conn++; w.__r.connMs += performance.now() - s; return out
      }
      ns.__timed = true
    }
    const vp = paper.options.viewport
    if (vp && !vp.__timed) {
      const wrapped = function (...a: unknown[]) {
        const s = performance.now(); const out = (vp as any).apply(this, a)
        w.__r.vis++; w.__r.visMs += performance.now() - s; return out
      }
      ;(wrapped as any).__timed = true
      paper.options.viewport = wrapped
    }
    // Zustand keeps its actions in state, so they can be replaced with timed
    // wrappers — a real per-stage breakdown of what a release costs.
    const store = w.__pid.useStore
    const NAMES = ['setNodePos', 'moveNodes', 'dockNode', 'addEdge', 'addBatch', 'setSelection', 'deleteIds', 'setEdge', 'setEdgeVertices']
    const patch: Record<string, unknown> = {}
    for (const nm of NAMES) {
      const fn = store.getState()[nm]
      if (typeof fn !== 'function') continue
      patch[nm] = (...a: unknown[]) => {
        const s = performance.now()
        const out = fn(...a)
        const rec = (w.__r.actions[nm] ??= { n: 0, ms: 0 })
        rec.n++; rec.ms += performance.now() - s
        return out
      }
    }
    store.setState(patch)

    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__r.long.push({ t: e.startTime, d: e.duration }) })
        .observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
    let last = performance.now()
    const loop = () => { const t = performance.now(); w.__r.frames.push({ t, dt: t - last }); last = t; requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  })

  // Pick a real symbol to drag: the largest one near the middle of the drawn
  // content, so the press lands on its body and not on a port halo.
  const target = await page.evaluate(() => {
    const { graph } = (window as any).__pid.canvasRef
    const els = graph.getElements()
    const cx = els.reduce((a: number, e: any) => a + e.getBBox().center().x, 0) / els.length
    const cy = els.reduce((a: number, e: any) => a + e.getBBox().center().y, 0) / els.length
    let best: { id: string; score: number } | null = null
    for (const e of els) {
      const b = e.getBBox()
      const d = Math.hypot(b.center().x - cx, b.center().y - cy)
      const score = b.width * b.height - d * 4
      if (!best || score > best.score) best = { id: String(e.id), score }
    }
    return best!.id
  })

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 80 })

  const lines: string[] = [
    '',
    `################ REAL DRAWING: ${summary.name} ################`,
    `  ${PNID}`,
    `  ${summary.nodes} symbols + ${summary.edges} lines = ${summary.nodes + summary.edges} cells on ${summary.size}`,
    `  display ${SCREEN_W}x${SCREEN_H} at DPR ${DPR}`,
    `  dragging ${target}`,
  ]

  for (const zoom of ZOOMS) {
    await page.evaluate(({ z, id }) => {
      const { paper, graph } = (window as any).__pid.canvasRef
      const b = graph.getCell(id).getBBox()
      paper.scale(z, z)
      const size = paper.getComputedSize()
      paper.translate(size.width / 2 - (b.x + b.width / 2) * z, size.height / 2 - (b.y + b.height / 2) * z)
    }, { z: zoom, id: target })
    await page.waitForTimeout(900)

    const mounted = await page.locator('[model-id]').count()
    const box = await page.locator(`[model-id="${target}"]`).first().boundingBox()
    if (!box) { lines.push(`  ${(zoom * 100).toFixed(0)}% — target off screen, skipped`); continue }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.evaluate(() => {
      const w = window as any
      w.__r.frames.length = 0; w.__r.long.length = 0
      w.__r.renderDone = 0; w.__r.conn = 0; w.__r.connMs = 0; w.__r.vis = 0; w.__r.visMs = 0; w.__r.actions = {}
    })
    await cdp.send('Profiler.start')

    // ---- press, move, release, settle -----------------------------------
    const run = await page.evaluate(async ({ cx, cy }) => {
      const w = window as any
      const el = document.elementFromPoint(cx, cy)
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 }
      const downT = performance.now()
      el?.dispatchEvent(new MouseEvent('mousedown', opts))
      const downMs = performance.now() - downT

      const times: number[] = []
      const t0 = performance.now()
      for (let i = 0; i < 140; i++) {
        const x = cx + 26 * Math.sin(i / 8) + i * 0.35
        const y = cy + 18 * Math.cos(i / 6)
        const s = performance.now()
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
        times.push(performance.now() - s)
        if (i % 3 === 2) await new Promise<void>((r) => requestAnimationFrame(() => r()))
      }
      const t1 = performance.now()

      const before = { conn: w.__r.conn, connMs: w.__r.connMs, vis: w.__r.vis, visMs: w.__r.visMs, rd: w.__r.renderDone, long: w.__r.long.length }
      w.__r.actions = {}
      const upT = performance.now()
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      const upSync = performance.now() - upT
      // painted = three settled frames; quiet = no long task and no render for 250 ms
      for (let i = 0; i < 3; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()))
      const painted = performance.now() - upT
      let quietFrom = performance.now()
      let rd = w.__r.renderDone
      let longN = w.__r.long.length
      while (performance.now() - quietFrom < 250 && performance.now() - upT < 4000) {
        await new Promise<void>((r) => setTimeout(r, 25))
        if (w.__r.renderDone !== rd || w.__r.long.length !== longN) { rd = w.__r.renderDone; longN = w.__r.long.length; quietFrom = performance.now() }
      }
      const quiet = quietFrom - upT
      await new Promise((r) => setTimeout(r, 400))
      return {
        downMs, times, t0, t1, upSync, painted, quiet,
        drop: {
          conn: w.__r.conn - before.conn, connMs: w.__r.connMs - before.connMs,
          vis: w.__r.vis - before.vis, visMs: w.__r.visMs - before.visMs,
          rd: w.__r.renderDone - before.rd,
          long: (w.__r.long as { d: number }[]).slice(before.long).reduce((a, b) => a + b.d, 0),
          actions: JSON.parse(JSON.stringify(w.__r.actions)) as Record<string, { n: number; ms: number }>,
        },
        dragConn: before.conn, dragConnMs: before.connMs, dragVis: before.vis, dragVisMs: before.visMs, dragRd: before.rd,
      }
    }, { cx, cy })

    const profile = (await cdp.send('Profiler.stop')).profile
    await page.mouse.up().catch(() => {})

    const during = await page.evaluate((t) => {
      const w = window as any
      return {
        frames: (w.__r.frames as { t: number; dt: number }[]).filter((fr) => fr.t >= t.t0 && fr.t <= t.t1).map((fr) => fr.dt),
        long: (w.__r.long as { t: number; d: number }[]).filter((l) => l.t >= t.t0 && l.t <= t.t1).map((l) => l.d),
      }
    }, { t0: run.t0, t1: run.t1 })

    const h = stats(run.times)
    const fr = stats(during.frames.filter((d) => d > 0))
    const acts = Object.entries(run.drop.actions)
      .map(([k, v]) => `${k} ${v.ms.toFixed(1)}ms x${v.n}`)
      .join('  ') || 'none'
    lines.push(
      ``,
      `  ── ${(zoom * 100).toFixed(0).padStart(3)}% ── ${mounted} of ${summary.nodes + summary.edges} cells in the DOM ───────────`,
      `     PRESS    mousedown handler ${run.downMs.toFixed(1)} ms`,
      `     MOVE     mean ${f(h.mean)}  p90 ${f(h.p90)}  p99 ${f(h.p99)}  max ${f(h.max)} ms   fps ${(fr.mean ? 1000 / fr.mean : 0).toFixed(1)}`,
      `              frame p90 ${f(fr.p90, 1)}  p99 ${f(fr.p99, 1)}  max ${f(fr.max, 1)} ms   long ${during.long.length} (${during.long.reduce((a, b) => a + b, 0).toFixed(0)} ms)`,
      `              connector ${run.dragConn} runs / ${run.dragConnMs.toFixed(1)} ms   visibility ${run.dragVis} calls / ${run.dragVisMs.toFixed(1)} ms   render:done ${run.dragRd}`,
      `     RELEASE  mouseup handler ${run.upSync.toFixed(1)} ms   painted ${run.painted.toFixed(1)} ms   quiet after ${run.quiet.toFixed(0)} ms   long ${run.drop.long.toFixed(0)} ms`,
      `              connector ${run.drop.conn} runs / ${run.drop.connMs.toFixed(1)} ms   visibility ${run.drop.vis} calls / ${run.drop.visMs.toFixed(1)} ms   render:done ${run.drop.rd}`,
      `              store: ${acts}`,
      `     CPU self-time:`,
      ...topSelf(profile).map((r) => `        ${r.ms.toFixed(1).padStart(7)} ms  ${r.name}${r.via ? `\n                        via ${r.via}` : ''}`),
    )
  }

  process.stderr.write(lines.join('\n') + '\n')
})

/**
 * The zoom GESTURE, and the drag that follows it immediately.
 *
 * Every measurement so far set the camera with one `paper.scale()` call and
 * then waited a second before touching anything. That is not what a user does:
 * they roll a wheel or pinch a trackpad, which fires a stream of wheel events —
 * each one running the full zoom handler — and then start dragging straight
 * away, on whatever work that left queued.
 */
test('wheel zoom, then drag immediately', async ({ page }) => {
  test.skip(!process.env.PERF, 'perf harness — run with PERF=1')
  test.setTimeout(600_000)
  const raw = JSON.parse(readFileSync(PNID, 'utf8'))

  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  const summary = await page.evaluate(async (doc) => {
    const mod = (await import(/* @vite-ignore */ '/src/model/migrate.ts')) as { loadDoc(raw: unknown): any }
    const migrated = mod.loadDoc(doc)
    ;(window as any).__pid.useStore.getState().loadIntoStore(migrated)
    return { nodes: migrated.sheets[0].nodes.length, edges: migrated.sheets[0].edges.length }
  }, raw)
  await expect(page.locator('[model-id]')).toHaveCount(summary.nodes + summary.edges, { timeout: 60_000 })

  await page.evaluate(() => {
    const w = window as any
    w.__r = { frames: [] as { t: number; dt: number }[], long: [] as { t: number; d: number }[], renderDone: 0, vis: 0, visMs: 0 }
    const paper = w.__pid.canvasRef.paper
    paper.on('render:done', () => { w.__r.renderDone++ })
    const vp = paper.options.viewport
    if (vp && !(vp as any).__timed) {
      const wrapped = function (...a: unknown[]) {
        const s = performance.now(); const out = (vp as any).apply(this, a)
        w.__r.vis++; w.__r.visMs += performance.now() - s; return out
      }
      ;(wrapped as any).__timed = true
      paper.options.viewport = wrapped
    }
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__r.long.push({ t: e.startTime, d: e.duration }) })
        .observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
    let last = performance.now()
    const loop = () => { const t = performance.now(); w.__r.frames.push({ t, dt: t - last }); last = t; requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  })

  const target = await page.evaluate(() => {
    const { graph } = (window as any).__pid.canvasRef
    const els = graph.getElements()
    let best: { id: string; a: number } | null = null
    for (const e of els) {
      const b = e.getBBox()
      if (!best || b.width * b.height > best.a) best = { id: String(e.id), a: b.width * b.height }
    }
    return best!.id
  })

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 80 })
  await cdp.send('Profiler.start')

  const out = await page.evaluate(async ({ id }) => {
    const w = window as any
    const { paper, graph } = w.__pid.canvasRef
    const host = document.querySelector('.canvas-host') as HTMLElement
    const r = host.getBoundingClientRect()
    const px = r.left + r.width / 2
    const py = r.top + r.height / 2

    // Put the target under the pointer at 1:1 first.
    const b = graph.getCell(id).getBBox()
    paper.scale(1, 1)
    const size = paper.getComputedSize()
    paper.translate(size.width / 2 - (b.x + b.width / 2), size.height / 2 - (b.y + b.height / 2))
    await new Promise((res) => setTimeout(res, 800))

    // --- the zoom gesture: a trackpad's worth of wheel events -------------
    w.__r.frames.length = 0; w.__r.long.length = 0; w.__r.vis = 0; w.__r.visMs = 0; w.__r.renderDone = 0
    const wheelTimes: number[] = []
    const zt0 = performance.now()
    for (let i = 0; i < 24; i++) {
      const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: px, clientY: py, deltaY: -40 })
      const s = performance.now()
      host.dispatchEvent(ev)
      wheelTimes.push(performance.now() - s)
      if (i % 2 === 1) await new Promise<void>((res) => requestAnimationFrame(() => res()))
    }
    const zoomMs = performance.now() - zt0
    const zoomFrames = (w.__r.frames as { t: number; dt: number }[]).filter((fr) => fr.t >= zt0).map((fr) => fr.dt)
    const zoomStats = {
      wheelTimes, zoomMs, scale: paper.scale().sx,
      frames: zoomFrames, long: (w.__r.long as { t: number; d: number }[]).filter((l) => l.t >= zt0).map((l) => l.d),
      vis: w.__r.vis, visMs: w.__r.visMs, renderDone: w.__r.renderDone,
    }

    // --- drag IMMEDIATELY, no settle -------------------------------------
    const bb = graph.getCell(id).getBBox()
    const p = paper.localToClientPoint({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 })
    const el = document.elementFromPoint(p.x, p.y)
    w.__r.frames.length = 0; w.__r.long.length = 0; w.__r.vis = 0; w.__r.visMs = 0; w.__r.renderDone = 0
    const downT = performance.now()
    el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
    const downMs = performance.now() - downT
    const times: number[] = []
    const t0 = performance.now()
    for (let i = 0; i < 120; i++) {
      const s = performance.now()
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: p.x + 24 * Math.sin(i / 8) + i * 0.3, clientY: p.y + 16 * Math.cos(i / 6), button: 0, buttons: 1 }))
      times.push(performance.now() - s)
      if (i % 3 === 2) await new Promise<void>((res) => requestAnimationFrame(() => res()))
    }
    const t1 = performance.now()
    const upT = performance.now()
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
    const upSync = performance.now() - upT
    for (let i = 0; i < 3; i++) await new Promise<void>((res) => requestAnimationFrame(() => res()))
    const painted = performance.now() - upT
    await new Promise((res) => setTimeout(res, 400))
    return {
      zoom: zoomStats,
      drag: {
        downMs, times, upSync, painted,
        frames: (w.__r.frames as { t: number; dt: number }[]).filter((fr) => fr.t >= t0 && fr.t <= t1).map((fr) => fr.dt),
        long: (w.__r.long as { t: number; d: number }[]).filter((l) => l.t >= t0).map((l) => l.d),
        vis: w.__r.vis, visMs: w.__r.visMs, renderDone: w.__r.renderDone,
      },
    }
  }, { id: target })

  const profile = (await cdp.send('Profiler.stop')).profile
  const w = stats(out.zoom.wheelTimes)
  const zf = stats(out.zoom.frames.filter((d) => d > 0))
  const dh = stats(out.drag.times)
  const df = stats(out.drag.frames.filter((d) => d > 0))
  process.stderr.write(
    [
      '',
      `################ WHEEL ZOOM, THEN DRAG — ${summary.nodes + summary.edges} cells, ${SCREEN_W}x${SCREEN_H} @ DPR ${DPR} ################`,
      `  ZOOM GESTURE  24 wheel events over ${out.zoom.zoomMs.toFixed(0)} ms, 100% -> ${(out.zoom.scale * 100).toFixed(0)}%`,
      `                wheel handler mean ${f(w.mean)}  p90 ${f(w.p90)}  max ${f(w.max)} ms`,
      `                frames ${zf.n}  fps ${(zf.mean ? 1000 / zf.mean : 0).toFixed(1)}  p90 ${f(zf.p90, 1)}  max ${f(zf.max, 1)} ms`,
      `                long ${out.zoom.long.length} (${out.zoom.long.reduce((a, b) => a + b, 0).toFixed(0)} ms)   visibility ${out.zoom.vis} calls / ${out.zoom.visMs.toFixed(1)} ms   render:done ${out.zoom.renderDone}`,
      `  DRAG AFTER    mousedown ${out.drag.downMs.toFixed(1)} ms`,
      `                pointermove mean ${f(dh.mean)}  p90 ${f(dh.p90)}  p99 ${f(dh.p99)}  max ${f(dh.max)} ms`,
      `                fps ${(df.mean ? 1000 / df.mean : 0).toFixed(1)}  frame p90 ${f(df.p90, 1)}  max ${f(df.max, 1)} ms   long ${out.drag.long.length} (${out.drag.long.reduce((a, b) => a + b, 0).toFixed(0)} ms)`,
      `                release ${out.drag.upSync.toFixed(1)} ms sync, painted ${out.drag.painted.toFixed(1)} ms   visibility ${out.drag.vis} calls / ${out.drag.visMs.toFixed(1)} ms`,
      `  CPU self-time (zoom + drag):`,
      ...topSelf(profile).map((r) => `     ${r.ms.toFixed(1).padStart(7)} ms  ${r.name}${r.via ? `\n                     via ${r.via}` : ''}`),
    ].join('\n') + '\n',
  )
})

/**
 * The same drag driven by REAL pointer input.
 *
 * Every measurement above dispatches synthetic `mousemove` events on the
 * document. That reproduces the application's handler cost exactly, but it
 * skips what the browser itself does on a real move: hit-testing the point
 * against the SVG, resolving `:hover`, and applying whatever that triggers —
 * and this app's hover rule changes a port dot's RADIUS, which is a geometry
 * attribute, so it can force layout. Playwright's mouse API goes through
 * Chromium's full input pipeline, so this is the closest thing to a hand on a
 * trackpad that a test can produce.
 */
test('real pointer input across the drawing', async ({ page }) => {
  test.skip(!process.env.PERF, 'perf harness — run with PERF=1')
  test.setTimeout(600_000)
  const raw = JSON.parse(readFileSync(PNID, 'utf8'))

  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  const summary = await page.evaluate(async (doc) => {
    const mod = (await import(/* @vite-ignore */ '/src/model/migrate.ts')) as { loadDoc(raw: unknown): any }
    const migrated = mod.loadDoc(doc)
    ;(window as any).__pid.useStore.getState().loadIntoStore(migrated)
    return { nodes: migrated.sheets[0].nodes.length, edges: migrated.sheets[0].edges.length }
  }, raw)
  await expect(page.locator('[model-id]')).toHaveCount(summary.nodes + summary.edges, { timeout: 60_000 })

  await page.evaluate(() => {
    const w = window as any
    w.__r = { frames: [] as { t: number; dt: number }[], long: [] as { t: number; d: number }[] }
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__r.long.push({ t: e.startTime, d: e.duration }) })
        .observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
    let last = performance.now()
    const loop = () => { const t = performance.now(); w.__r.frames.push({ t, dt: t - last }); last = t; requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  })

  const target = await page.evaluate(() => {
    const { graph } = (window as any).__pid.canvasRef
    let best: { id: string; a: number } | null = null
    for (const e of graph.getElements()) {
      const b = e.getBBox()
      if (!best || b.width * b.height > best.a) best = { id: String(e.id), a: b.width * b.height }
    }
    return best!.id
  })

  const lines = ['', `################ REAL POINTER INPUT — ${summary.nodes + summary.edges} cells, ${SCREEN_W}x${SCREEN_H} @ DPR ${DPR} ################`]

  for (const zoom of ZOOMS) {
    await page.evaluate(({ z, id }) => {
      const { paper, graph } = (window as any).__pid.canvasRef
      const b = graph.getCell(id).getBBox()
      paper.scale(z, z)
      const size = paper.getComputedSize()
      paper.translate(size.width / 2 - (b.x + b.width / 2) * z, size.height / 2 - (b.y + b.height / 2) * z)
    }, { z: zoom, id: target })
    await page.waitForTimeout(800)

    const box = await page.locator(`[model-id="${target}"]`).first().boundingBox()
    if (!box) { lines.push(`  ${(zoom * 100).toFixed(0)}% — off screen`); continue }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Hover sweep first: cross the drawing without a button down, so the only
    // cost is the browser hit-testing and resolving :hover.
    await page.evaluate(() => { const w = window as any; w.__r.frames.length = 0; w.__r.long.length = 0 })
    const hoverT0 = Date.now()
    await page.mouse.move(cx - 300, cy)
    await page.mouse.move(cx + 300, cy + 120, { steps: 60 })
    await page.mouse.move(cx - 300, cy - 120, { steps: 60 })
    const hoverWall = Date.now() - hoverT0
    const hover = await page.evaluate(() => {
      const w = window as any
      return { frames: (w.__r.frames as { dt: number }[]).map((f) => f.dt), long: (w.__r.long as { d: number }[]).map((l) => l.d) }
    })

    // Then a real drag of the symbol.
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.evaluate(() => { const w = window as any; w.__r.frames.length = 0; w.__r.long.length = 0 })
    const dragT0 = Date.now()
    for (let i = 0; i < 5; i++) await page.mouse.move(cx + 40 + i * 26, cy + 24 * (i % 2 ? 1 : -1), { steps: 24 })
    const dragWall = Date.now() - dragT0
    const drag = await page.evaluate(() => {
      const w = window as any
      return { frames: (w.__r.frames as { dt: number }[]).map((f) => f.dt), long: (w.__r.long as { d: number }[]).map((l) => l.d) }
    })
    await page.evaluate(() => { const w = window as any; w.__r.long.length = 0 })
    const upT0 = Date.now()
    await page.mouse.up()
    await page.waitForTimeout(900)
    const after = await page.evaluate(() => (window as any).__r.long as { d: number }[])
    const upWall = Date.now() - upT0

    const hf = stats(hover.frames.filter((d) => d > 0))
    const df = stats(drag.frames.filter((d) => d > 0))
    lines.push(
      ``,
      `  ── ${(zoom * 100).toFixed(0).padStart(3)}% ──────────────────────────────────`,
      `     HOVER sweep 120 real moves in ${hoverWall} ms   fps ${(hf.mean ? 1000 / hf.mean : 0).toFixed(1)}  frame p90 ${f(hf.p90, 1)} max ${f(hf.max, 1)} ms   long ${hover.long.length} (${hover.long.reduce((a, b) => a + b, 0).toFixed(0)} ms)`,
      `     DRAG  120 real moves in ${dragWall} ms   fps ${(df.mean ? 1000 / df.mean : 0).toFixed(1)}  frame p90 ${f(df.p90, 1)} max ${f(df.max, 1)} ms   long ${drag.long.length} (${drag.long.reduce((a, b) => a + b, 0).toFixed(0)} ms)`,
      `     DROP  release to quiet ${upWall} ms   long after release ${after.length} (${after.reduce((a, b) => a + b.d, 0).toFixed(0)} ms)`,
    )
  }
  process.stderr.write(lines.join('\n') + '\n')
})
