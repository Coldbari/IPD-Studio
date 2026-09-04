// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * A real DevTools timeline, not a JavaScript sample.
 *
 * Every earlier harness measured JS: handler cost, a CPU profile, frame gaps.
 * That is exactly half the picture, and it is the half that says "fast". This
 * one records the same trace DevTools records — Recalculate Style, Layout,
 * Hit Test, Paint, Composite, Rasterize, GC — over the exact reported
 * workflow, and breaks the main thread down by where the time actually goes.
 *
 *     PERF=1 npx playwright test e2e/trace.spec.ts --workers=1
 *     PERF=1 DPR=2 SCREEN=1728x1080 PNID=~/Downloads/Test.pnid ...
 *     PERF=1 npx playwright test e2e/trace.spec.ts --browser=webkit   (Safari engine; no CDP, JS timings only)
 *
 * DOM census and drop-lifecycle stability are collected in the same run.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { applySheetMode } from './sheet-mode'

const ZOOMS = (process.env.ZOOMS ?? '1,2,3,4').split(',').map(Number)
const DPR = Number(process.env.DPR ?? 2)
const [SCREEN_W, SCREEN_H] = (process.env.SCREEN ?? '1728x1080').split('x').map(Number)
const PNID = (process.env.PNID ?? `${homedir()}/Downloads/Praharsh-Test-2.pnid`).replace(/^~/, homedir())
/** Attribution switch for the drawing sheet behind the symbols:
 *  full | noshadow | nogrid | none | oldfilter — see e2e/sheet-mode.ts. */
const SHEET = process.env.SHEET ?? 'full'

test.use({ viewport: { width: SCREEN_W!, height: SCREEN_H! }, deviceScaleFactor: DPR })

interface TraceEvent { ph?: string; name?: string; ts?: number; dur?: number; pid?: number; tid?: number }

/** DevTools' own categories, near enough for a summary. */
const CATEGORY: Record<string, string> = {
  FunctionCall: 'scripting', EvaluateScript: 'scripting', 'v8.callFunction': 'scripting',
  'V8.Execute': 'scripting', EventDispatch: 'scripting', TimerFire: 'scripting',
  FireAnimationFrame: 'scripting', RunMicrotasks: 'scripting', 'v8.run': 'scripting',
  ProfileCall: 'scripting', XHRReadyStateChange: 'scripting', FireIdleCallback: 'scripting',
  UpdateLayoutTree: 'style · recalc', ScheduleStyleRecalculation: 'style · recalc',
  Layout: 'layout', InvalidateLayout: 'layout', LayoutShift: 'layout',
  HitTest: 'hit test',
  Paint: 'paint', PrePaint: 'paint', PaintImage: 'paint', 'Paint.Image': 'paint',
  UpdateLayerTree: 'composite', CompositeLayers: 'composite', Commit: 'composite',
  Layerize: 'composite', UpdateLayer: 'composite', 'cc::LayerTreeHost::UpdateLayers': 'composite',
  'LocalFrameView::RunPaintLifecyclePhase': 'paint',
  'LocalFrameView::RunStyleAndLayoutLifecyclePhase': 'layout',
  'LocalFrameView::RunCompositingInputsLifecyclePhase': 'composite',
  RasterTask: 'raster', Rasterize: 'raster', 'Raster.Task': 'raster',
  MajorGC: 'gc', MinorGC: 'gc', GCEvent: 'gc', 'V8.GCScavenger': 'gc',
  'V8.GCFinalizeMC': 'gc', BlinkGC: 'gc', 'V8.GC_MC_BACKGROUND': 'gc',
  DecodeImage: 'decode', 'Decode Image': 'decode',
}

/** Self time by event name on one thread: nested complete events subtract
 *  from their container, the way DevTools' bottom-up view does. */
function selfTimes(list: TraceEvent[]): Map<string, number> {
  const evs = list.slice().sort((a, b) => a.ts! - b.ts! || b.dur! - a.dur!)
  const out = new Map<string, number>()
  const stack: { end: number; self: number; name: string }[] = []
  const flush = (n: { self: number; name: string }) => out.set(n.name, (out.get(n.name) ?? 0) + n.self)
  const closed: { self: number; name: string }[] = []
  for (const e of evs) {
    while (stack.length && stack[stack.length - 1]!.end <= e.ts!) closed.push(stack.pop()!)
    const parent = stack[stack.length - 1]
    if (parent) parent.self -= e.dur!
    stack.push({ end: e.ts! + e.dur!, self: e.dur!, name: e.name ?? '?' })
  }
  for (const n of stack) closed.push(n)
  for (const n of closed) flush(n)
  return out
}

function analyse(events: TraceEvent[], t0: number, t1: number) {
  const complete = events.filter(
    (e) => e.ph === 'X' && typeof e.dur === 'number' && e.ts! >= t0 && e.ts! + e.dur! <= t1,
  )
  const byThread = new Map<string, TraceEvent[]>()
  for (const e of complete) {
    const k = `${e.pid}:${e.tid}`
    const arr = byThread.get(k)
    if (arr) arr.push(e)
    else byThread.set(k, [e])
  }
  // Name the threads from the trace's own metadata. Picking "whichever thread
  // ran the most top-level tasks" looks right until the main thread is idle —
  // which, once the shadow filter is gone, it very nearly is — and then the
  // compositor wins the count and every category reads as idle/other.
  const named = new Map<string, string>()
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') {
      const nm = (e as { args?: { name?: string } }).args?.name
      if (nm) named.set(`${e.pid}:${e.tid}`, nm)
    }
  }
  const runTasks = (k: string) => (byThread.get(k) ?? []).filter((e) => e.name === 'RunTask').length
  let mainKey = ''
  let mainTasks = -1
  for (const k of byThread.keys()) {
    if (named.get(k) !== 'CrRendererMain') continue
    const n = runTasks(k)
    if (n > mainTasks) { mainTasks = n; mainKey = k }
  }
  if (!mainKey) {
    for (const k of byThread.keys()) {
      const n = runTasks(k)
      if (n > mainTasks) { mainTasks = n; mainKey = k }
    }
  }
  const main = byThread.get(mainKey) ?? []
  const self = selfTimes(main)

  const cats = new Map<string, number>()
  const unmapped: [string, number][] = []
  for (const [name, us] of self) {
    if (name === 'RunTask' || name === 'ThreadControllerImpl::RunTask') { cats.set('idle/other', (cats.get('idle/other') ?? 0) + us); continue }
    const c = CATEGORY[name]
    if (c) cats.set(c, (cats.get(c) ?? 0) + us)
    else { unmapped.push([name, us]); cats.set('idle/other', (cats.get('idle/other') ?? 0) + us) }
  }
  // Raster runs off the main thread; count it separately so it is not lost.
  let rasterOther = 0
  for (const [k, arr] of byThread) {
    if (k === mainKey) continue
    for (const e of arr) if (e.name === 'RasterTask' || e.name === 'Rasterize') rasterOther += e.dur!
  }

  const tasks = main.filter((e) => e.name === 'RunTask').sort((a, b) => b.dur! - a.dur!)
  const longest = tasks[0]
  let longestBreakdown: [string, number][] = []
  if (longest) {
    const inside = main.filter((e) => e.ts! >= longest.ts! && e.ts! + e.dur! <= longest.ts! + longest.dur! && e !== longest)
    longestBreakdown = [...selfTimes(inside).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }
  return {
    cats: [...cats.entries()].sort((a, b) => b[1] - a[1]),
    unmapped: unmapped.sort((a, b) => b[1] - a[1]).slice(0, 8),
    rasterOtherMs: rasterOther / 1000,
    taskCount: tasks.length,
    longestMs: longest ? longest.dur! / 1000 : 0,
    longestBreakdown,
    over50: tasks.filter((t) => t.dur! > 50_000).length,
    over16: tasks.filter((t) => t.dur! > 16_000).length,
  }
}

const ms = (us: number) => (us / 1000).toFixed(1).padStart(8)

test('devtools timeline over the reported workflow', async ({ page, browserName }) => {
  test.skip(!process.env.PERF, 'perf harness — run with PERF=1')
  test.skip(browserName !== 'chromium', 'needs CDP tracing')
  test.setTimeout(900_000)
  const raw = JSON.parse(readFileSync(PNID, 'utf8'))

  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  const summary = await page.evaluate(async (doc) => {
    const mod = (await import(/* @vite-ignore */ '/src/model/migrate.ts')) as { loadDoc(raw: unknown): any }
    const migrated = mod.loadDoc(doc)
    ;(window as any).__pid.useStore.getState().loadIntoStore(migrated)
    return { nodes: migrated.sheets[0].nodes.length, edges: migrated.sheets[0].edges.length, size: migrated.sheets[0].sheetSize, name: migrated.meta.name }
  }, raw)
  await expect(page.locator('[model-id]')).toHaveCount(summary.nodes + summary.edges, { timeout: 60_000 })

  await page.evaluate(applySheetMode, SHEET)

  const target = await page.evaluate(() => {
    const { graph } = (window as any).__pid.canvasRef
    let best: { id: string; a: number } | null = null
    for (const e of graph.getElements()) {
      const b = e.getBBox()
      if (!best || b.width * b.height > best.a) best = { id: String(e.id), a: b.width * b.height }
    }
    return best!.id
  })

  const cdp = await page.context().newCDPSession(page)
  const lines: string[] = [
    '',
    `################ DEVTOOLS TIMELINE ################`,
    `  ${PNID}`,
    `  ${summary.nodes} symbols + ${summary.edges} lines on ${summary.size} · ${SCREEN_W}x${SCREEN_H} @ DPR ${DPR} · ${browserName} · sheet=${SHEET}`,
  ]

  for (const zoom of ZOOMS) {
    // Park the camera at 100% on the target, then let the traced window
    // include the zoom itself — that is the reported workflow.
    await page.evaluate(({ id }) => {
      const { paper, graph } = (window as any).__pid.canvasRef
      const b = graph.getCell(id).getBBox()
      paper.scale(1, 1)
      const s = paper.getComputedSize()
      paper.translate(s.width / 2 - (b.x + b.width / 2), s.height / 2 - (b.y + b.height / 2))
    }, { id: target })
    await page.waitForTimeout(700)

    const events: TraceEvent[] = []
    const onData = (p: { value: TraceEvent[] }) => { for (const e of p.value) events.push(e) }
    cdp.on('Tracing.dataCollected', onData as never)
    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: {
        includedCategories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'blink.user_timing',
        ],
      },
    } as never)

    const run = await page.evaluate(async ({ id, z }) => {
      const w = window as any
      const { paper, graph } = w.__pid.canvasRef
      const host = document.querySelector('.canvas-host') as HTMLElement
      const r = host.getBoundingClientRect()
      const px = r.left + r.width / 2
      const py = r.top + r.height / 2
      const t0 = performance.now()
      // Anchor the trace window with user-timing marks: trace timestamps ride
      // a different clock from performance.now(), and these come back in the
      // trace under blink.user_timing so the boundaries can be found exactly.
      performance.mark('pid-trace-start')
      performance.mark('pid-zoom-start')

      // 1. zoom, as a wheel gesture. One notch is a factor of 1.1 either way,
      //    so z below 1 wheels out rather than doing nothing.
      const notches = Math.round(Math.log(z) / Math.log(1.1))
      const dy = notches < 0 ? 40 : -40
      for (let i = 0; i < Math.abs(notches); i++) {
        host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: px, clientY: py, deltaY: dy }))
        await new Promise<void>((res) => requestAnimationFrame(() => res()))
      }
      await new Promise((res) => setTimeout(res, 250))
      performance.mark('pid-zoom-end')

      // 2. drag the symbol
      const bb = graph.getCell(id).getBBox()
      const p = paper.localToClientPoint({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 })
      const el = document.elementFromPoint(p.x, p.y)
      const domBefore = document.querySelectorAll('.joint-paper svg *').length
      performance.mark('pid-drag-start')
      el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
      for (let i = 0; i < 120; i++) {
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: p.x + 26 * Math.sin(i / 8) + i * 0.3, clientY: p.y + 18 * Math.cos(i / 6), button: 0, buttons: 1 }))
        if (i % 3 === 2) await new Promise<void>((res) => requestAnimationFrame(() => res()))
      }
      // 3. release, and watch the DOM settle
      performance.mark('pid-drag-end')
      performance.mark('pid-release-start')
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      const census: Record<string, number> = { at0: document.querySelectorAll('.joint-paper svg *').length }
      await new Promise((res) => setTimeout(res, 100)); census.at100 = document.querySelectorAll('.joint-paper svg *').length
      await new Promise((res) => setTimeout(res, 400)); census.at500 = document.querySelectorAll('.joint-paper svg *').length
      await new Promise((res) => setTimeout(res, 500)); census.at1000 = document.querySelectorAll('.joint-paper svg *').length
      performance.mark('pid-release-end')

      const q = (s: string) => document.querySelectorAll(s).length
      performance.mark('pid-trace-end')
      return {
        t0, t1: performance.now(), scale: paper.scale().sx, domBefore, census,
        dom: {
          svgNodes: q('.joint-paper svg *'), cells: q('[model-id]'), paths: q('.joint-paper svg path'),
          texts: q('.joint-paper svg text'), circles: q('.joint-paper svg circle'),
          ports: q('.pid-port-hit'), highlighters: q('.joint-highlight-stroke'), tools: q('.joint-tools'),
          hidden: q('.joint-paper svg [display="none"], .joint-paper svg [visibility="hidden"]'),
        },
      }
    }, { id: target, z: zoom })

    await cdp.send('Tracing.end')
    await new Promise<void>((res) => { cdp.once('Tracing.tracingComplete', () => res()) })
    cdp.off('Tracing.dataCollected', onData as never)

    const markTs = (name: string) => events.find((e) => e.name === name)?.ts
    const t0us = markTs('pid-trace-start') ?? -Infinity
    const t1us = markTs('pid-trace-end') ?? Infinity
    if (!Number.isFinite(t0us) || !Number.isFinite(t1us)) {
      lines.push(`  (trace window markers missing — reporting the whole trace)`)
    }
    const a = analyse(events, t0us, t1us)
    const total = a.cats.reduce((s, [, v]) => s + v, 0)
    const phase = (from: string, to: string) => {
      const f = markTs(from)
      const t = markTs(to)
      if (f === undefined || t === undefined) return null
      const p = analyse(events, f, t)
      const busy = p.cats.reduce((s2, [, v]) => s2 + v, 0)
      return { ms: (t - f) / 1000, busy: busy / 1000, raster: p.rasterOtherMs, longest: p.longestMs, cats: p.cats }
    }
    const zoomPhase = phase('pid-zoom-start', 'pid-zoom-end')
    const dragPhase = phase('pid-drag-start', 'pid-drag-end')
    const relPhase = phase('pid-release-start', 'pid-release-end')
    const row = (label: string, p: ReturnType<typeof phase>) =>
      p ? `     ${label.padEnd(8)} ${p.ms.toFixed(0).padStart(5)} ms wall · main thread ${p.busy.toFixed(1).padStart(7)} ms · raster ${p.raster.toFixed(1).padStart(8)} ms · longest task ${p.longest.toFixed(1)} ms` : `     ${label}: no marks`

    lines.push(
      ``,
      `  ── zoom to ${(run.scale * 100).toFixed(0)}% ── window ${(run.t1 - run.t0).toFixed(0)} ms ──────────────`,
      `     DOM  ${run.dom.svgNodes} svg nodes · ${run.dom.cells} cells · ${run.dom.paths} paths · ${run.dom.texts} texts · ${run.dom.circles} circles`,
      `          ${run.dom.ports} port hit areas · ${run.dom.highlighters} highlighters · ${run.dom.tools} tool layers · ${run.dom.hidden} hidden`,
      `     DROP lifecycle svg nodes: before ${run.domBefore} → at release ${run.census.at0} → +100ms ${run.census.at100} → +500ms ${run.census.at500} → +1s ${run.census.at1000}`,
      row('ZOOM', zoomPhase),
      row('DRAG', dragPhase),
      row('RELEASE', relPhase),
      `     MAIN THREAD  ${a.taskCount} tasks, ${a.over16} over 16 ms, ${a.over50} over 50 ms; longest ${a.longestMs.toFixed(1)} ms`,
      ...a.cats.map(([c, us]) => `       ${ms(us)} ms  ${c}${total ? `  (${((us / total) * 100).toFixed(0)}%)` : ''}`),
      `       ${a.rasterOtherMs.toFixed(1).padStart(8)} ms  raster, other threads`,
      a.longestBreakdown.length
        ? `     LONGEST TASK ${a.longestMs.toFixed(1)} ms — ${a.longestBreakdown.map(([n, v]) => `${n} ${(v / 1000).toFixed(1)}`).join(' · ')}`
        : `     LONGEST TASK ${a.longestMs.toFixed(1)} ms`,
      a.unmapped.length ? `     uncategorised: ${a.unmapped.map(([n, v]) => `${n} ${(v / 1000).toFixed(1)}`).join(' · ')}` : '',
    )
  }
  process.stderr.write(lines.filter(Boolean).join('\n') + '\n')
})

/**
 * The acceptance sequence, measured end to end.
 *
 * Open the real drawing, zoom to 200-300%, drag a symbol, move it, release,
 * immediately drag another, draw a connection, pan, zoom again — twice through
 * — with the DevTools timeline running the whole way. What must not appear is
 * a freeze: a main-thread task long enough to be felt after a placement.
 */
test('acceptance: the reported workflow, twice through', async ({ page, browserName }) => {
  test.skip(!process.env.PERF, 'perf harness — run with PERF=1')
  test.skip(browserName !== 'chromium', 'needs CDP tracing')
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

  await page.evaluate(() => {
    const w = window as any
    w.__a = { frames: [] as number[], long: [] as number[] }
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__a.long.push(e.duration) })
        .observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
    let last = performance.now()
    const loop = () => { const t = performance.now(); w.__a.frames.push(t - last); last = t; requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  })

  const cdp = await page.context().newCDPSession(page)
  const events: TraceEvent[] = []
  const onData = (p: { value: TraceEvent[] }) => { for (const e of p.value) events.push(e) }
  cdp.on('Tracing.dataCollected', onData as never)
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'] },
  } as never)

  const out = await page.evaluate(async () => {
    const w = window as any
    const { paper, graph } = w.__pid.canvasRef
    const host = document.querySelector('.canvas-host') as HTMLElement
    const r = host.getBoundingClientRect()
    const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()))
    const move = (x: number, y: number, buttons = 1) =>
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }))
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
      el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
      for (let i = 0; i < 60; i++) { move(p.x + 20 * Math.sin(i / 7) + i * 0.5, p.y + 14 * Math.cos(i / 5)); if (i % 3 === 2) await frame() }
      const t = performance.now()
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      const sync = performance.now() - t
      for (let i = 0; i < 3; i++) await frame()
      return { sync, painted: performance.now() - t }
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
    const pan = async (dx: number, dy: number) => {
      const t = paper.translate()
      paper.translate(t.tx + dx, t.ty + dy)
      for (let i = 0; i < 6; i++) await frame()
    }

    performance.mark('pid-trace-start')
    const drops: { sync: number; painted: number }[] = []
    const lines: any[] = []
    const dragged: string[] = []
    for (let round = 0; round < 2; round++) {
      await wheel(11, -1)                      // zoom in to ~285%
      await new Promise((res) => setTimeout(res, 200))
      const a = biggest(dragged); dragged.push(a)
      drops.push(await dragSymbol(a))          // drag, move, release
      const b = biggest(dragged); dragged.push(b)
      drops.push(await dragSymbol(b))          // immediately drag another
      lines.push(await drawLine())             // create a connection
      await pan(-160, -120)                    // pan
      await wheel(11, 1)                       // zoom back out
      await new Promise((res) => setTimeout(res, 200))
    }
    performance.mark('pid-trace-end')
    await new Promise((res) => setTimeout(res, 400))
    return { drops, lines, frames: w.__a.frames as number[], long: w.__a.long as number[], scale: paper.scale().sx }
  })

  await cdp.send('Tracing.end')
  await new Promise<void>((res) => { cdp.once('Tracing.tracingComplete', () => res()) })
  cdp.off('Tracing.dataCollected', onData as never)
  const mark = (n: string) => events.find((e) => e.name === n)?.ts
  const a = analyse(events, mark('pid-trace-start') ?? -Infinity, mark('pid-trace-end') ?? Infinity)
  const fr = out.frames.filter((d) => d > 0).sort((x, y) => x - y)
  const at = (p: number) => fr[Math.min(fr.length - 1, Math.floor(fr.length * p))] ?? 0
  const mean = fr.reduce((s, v) => s + v, 0) / (fr.length || 1)

  process.stderr.write(
    [
      '',
      `################ ACCEPTANCE SEQUENCE — ${summary.nodes + summary.edges} cells, ${SCREEN_W}x${SCREEN_H} @ DPR ${DPR}, sheet=${SHEET} ################`,
      `  two rounds of: zoom in ~285% → drag+release → drag another+release → draw a line → pan → zoom out`,
      `  frames ${fr.length}  fps ${(1000 / mean).toFixed(1)}  p90 ${at(0.9).toFixed(1)} ms  p99 ${at(0.99).toFixed(1)} ms  max ${(fr[fr.length - 1] ?? 0).toFixed(1)} ms`,
      `  releases: ${out.drops.map((d) => `${d.sync.toFixed(1)} ms sync / ${d.painted.toFixed(0)} ms painted`).join('  ·  ')}`,
      `  lines drawn: ${out.lines.map((l) => (l ? `press ${l.down.toFixed(1)} ms, release ${l.up.toFixed(1)} ms, +${l.added}` : 'none')).join('  ·  ')}`,
      `  main thread: ${a.taskCount} tasks, ${a.over16} over 16 ms, ${a.over50} over 50 ms; longest ${a.longestMs.toFixed(1)} ms`,
      `  long tasks (PerformanceObserver): ${out.long.length} (${out.long.reduce((s, v) => s + v, 0).toFixed(0)} ms)`,
      ...a.cats.map(([c, us]) => `    ${ms(us)} ms  ${c}`),
      `    ${a.rasterOtherMs.toFixed(1).padStart(8)} ms  raster, other threads`,
    ].join('\n') + '\n',
  )
  expect(a.over50, 'no task long enough to feel as a freeze').toBe(0)
})
