// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The canvas as an engineering instrument: what must stay true of the drawing
 * whatever the performance work does to how it is rendered.
 *
 * The sheet's page shadow must be gradient geometry and no filter, and must
 * still look like the filter it replaced. Zoom must not move a symbol, resize
 * one, break a connection, add or drop a jumpover hop, or stop snapping. Every
 * kind of component must place, drag and release. A symbol with pipes on it
 * must keep them. Drawing must touch the network never, and the export must
 * carry the whole drawing however little of it the canvas has mounted.
 *
 * Off by default because it needs a real drawing on disk:
 *
 *     VALIDATE=1 npx playwright test e2e/canvas-integrity.spec.ts --workers=1
 *     VALIDATE=1 DPR=2 SCREEN=1728x1080 PNID=~/Downloads/Test.pnid ...
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { applySheetMode } from './sheet-mode'

const DPR = Number(process.env.DPR ?? 2)
const [SCREEN_W, SCREEN_H] = (process.env.SCREEN ?? '1728x1080').split('x').map(Number)
const PNID = (process.env.PNID ?? `${homedir()}/Downloads/Praharsh-Test-2.pnid`).replace(/^~/, homedir())
const SHOTS = process.env.SHOTS ?? '/private/tmp/claude-501/-Users-praharsh-Project-Instrument-Diagram/90135170-0031-4fc9-9c3f-071c413120e0/scratchpad/shots'
const ZOOMS = [0.25, 0.5, 1, 1.5, 2, 3, 4]

test.use({ viewport: { width: SCREEN_W!, height: SCREEN_H! }, deviceScaleFactor: DPR })
test.skip(!process.env.VALIDATE, 'validation harness — run with VALIDATE=1')

const say = (s: string) => process.stderr.write(s + '\n')

async function loadReal(page: Page) {
  const raw = JSON.parse(readFileSync(PNID, 'utf8'))
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  const summary = await page.evaluate(async (doc) => {
    const mod = (await import(/* @vite-ignore */ '/src/model/migrate.ts')) as { loadDoc(raw: unknown): any }
    const m = mod.loadDoc(doc)
    ;(window as any).__pid.useStore.getState().loadIntoStore(m)
    return { nodes: m.sheets[0].nodes.length, edges: m.sheets[0].edges.length, size: m.sheets[0].sheetSize }
  }, raw)
  await expect(page.locator('[model-id]')).toHaveCount(summary.nodes + summary.edges, { timeout: 60_000 })
  return summary
}

/** Put the sheet's top-left corner at a known screen point, at the given scale. */
async function parkCorner(page: Page, scale: number, at = { x: 420, y: 320 }) {
  await page.evaluate(({ s, at }) => {
    const { paper } = (window as any).__pid.canvasRef
    paper.scale(s, s)
    const host = (paper.el as HTMLElement).getBoundingClientRect()
    const p = paper.localToClientPoint({ x: 0, y: 0 })
    const t = paper.translate()
    paper.translate(t.tx + (host.left + at.x - p.x), t.ty + (host.top + at.y - p.y))
  }, { s: scale, at })
  await page.waitForTimeout(450)
}

/**
 * A point on the page's LEFT edge, at the vertical middle of the canvas host.
 * Sampling at a fixed distance down the page instead walks off the bottom of
 * the window once the zoom is past 200% and lands on the status bar.
 */
async function probeLeftEdge(page: Page) {
  return page.evaluate(() => {
    const { paper } = (window as any).__pid.canvasRef
    const host = (paper.el as HTMLElement).getBoundingClientRect()
    const p = paper.localToClientPoint({ x: 0, y: 0 })
    return { x: Math.round(p.x), y: Math.round(host.top + host.height / 2) }
  })
}

// ───────────────────────────────────────────────────────────── §1 · §5 shadow

test('the page shadow is gradient geometry, and looks like the filter did', async ({ page }) => {
  test.setTimeout(600_000)
  mkdirSync(SHOTS, { recursive: true })
  await loadReal(page)

  // No filter anywhere on the sheet, and the gradient defs are all present.
  const shape = await page.evaluate(() => {
    const g = document.querySelector('.pid-sheet')!
    const defs = document.querySelector('#pid-sheet-defs')!
    return {
      filters: g.querySelectorAll('[filter]').length,
      feDropShadow: document.querySelectorAll('feDropShadow').length,
      filterDefs: defs.querySelectorAll('filter').length,
      shadowRects: [...g.querySelectorAll('rect')].filter((r) => (r.getAttribute('fill') ?? '').startsWith('url(#pid-sh-')).length,
      gradients: defs.querySelectorAll('linearGradient, radialGradient').length,
      // anything else on the canvas that could cost a filter pass
      canvasFilters: document.querySelectorAll('.joint-paper [filter]').length,
    }
  })
  say(`\n################ §1 SHEET SHADOW — STRUCTURE ################`)
  say(`  feDropShadow elements anywhere in the document : ${shape.feDropShadow}`)
  say(`  <filter> definitions in the sheet defs         : ${shape.filterDefs}`)
  say(`  elements carrying filter= on the sheet         : ${shape.filters}`)
  say(`  elements carrying filter= anywhere on canvas   : ${shape.canvasFilters}`)
  say(`  gradient shadow rects / gradient defs          : ${shape.shadowRects} / ${shape.gradients}`)
  expect(shape.feDropShadow, 'no feDropShadow may remain').toBe(0)
  expect(shape.filterDefs, 'no filter definition may remain on the sheet').toBe(0)
  expect(shape.canvasFilters, 'nothing on the canvas may carry a filter').toBe(0)
  expect(shape.shadowRects).toBe(8)
  expect(shape.gradients).toBe(8)

  // The shadow must actually be visible: sample a column of pixels crossing
  // the page's left edge and check it darkens towards the page.
  say(`\n################ §1 SHEET SHADOW — RENDERING AT EACH ZOOM ################`)
  say(`  zoom    desk    shadow against the page      page     verdict`)
  const clips: Record<string, string> = {}
  for (const z of ZOOMS) {
    await parkCorner(page, z)
    const probe = await probeLeftEdge(page)
    // 240 CSS px of desk to the left of the page edge: at 400% the shadow is
    // 84 screen px wide, so a narrow crop would have no clean desk left in it
    // to compare against.
    const shot = await page.screenshot({ clip: { x: probe.x - 240, y: probe.y - 12, width: 260, height: 24 } })
    clips[String(z)] = shot.toString('base64')
    const scan = await page.evaluate(async ({ b64, dpr }) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      const row = Math.floor(bmp.height / 2)
      const d = ctx.getImageData(0, row, bmp.width, 1).data
      const lum: number[] = []
      for (let i = 0; i < bmp.width; i++) lum.push(d[i * 4]! * 0.299 + d[i * 4 + 1]! * 0.587 + d[i * 4 + 2]! * 0.114)
      // The page's own 1px border straddles the edge, and it is darker than
      // any shadow; keep 1 CSS px clear of it on both sides. Sampling further
      // out than that would find nothing at 25%, where the whole shadow is
      // five screen pixels wide — correctly so, since it scales with the page.
      const edge = Math.round(240 * dpr)
      const gap = Math.ceil(1 * dpr)
      const desk = lum.slice(0, Math.round(10 * dpr))
      const band = lum.slice(Math.round(10 * dpr), edge - gap)
      return {
        desk: desk.reduce((a, b) => a + b, 0) / desk.length,
        band: Math.min(...band),
        atEdge: lum[edge - gap - 1]!,
        page: lum[Math.min(lum.length - 1, edge + gap + Math.round(6 * dpr))]!,
      }
    }, { b64: shot.toString('base64'), dpr: DPR })
    // A shadow is a gradient: darkest against the page, lifting back to the
    // desk further out, and the page itself brighter than both.
    const ok = scan.atEdge < scan.desk - 3 && Math.abs(scan.band - scan.atEdge) < 1.5 && scan.page > scan.atEdge + 20
    say(
      `  ${String(Math.round(z * 100) + '%').padStart(5)}  ${scan.desk.toFixed(1).padStart(6)}  ` +
        `${scan.atEdge.toFixed(1).padStart(26)}  ${scan.page.toFixed(1).padStart(7)}     ${ok ? 'shadow present' : 'NO SHADOW'}`,
    )
    expect(ok, `a visible shadow at ${z * 100}%`).toBe(true)
    writeFileSync(`${SHOTS}/edge-gradient-${Math.round(z * 100)}.png`, shot)
    // and a whole-canvas frame for eyeballing
    writeFileSync(`${SHOTS}/canvas-gradient-${Math.round(z * 100)}.png`, await page.screenshot())
  }

  // Same crops with the OLD feDropShadow put back, compared numerically.
  say(`\n################ §5 GRADIENT vs FILTER — PIXEL COMPARISON ################`)
  say(`  zoom   mean |Δ|   max |Δ|   pixels over 8/255   verdict`)
  await page.evaluate(applySheetMode, 'oldfilter')
  await page.waitForTimeout(300)
  for (const z of ZOOMS) {
    await parkCorner(page, z)
    const probe = await probeLeftEdge(page)
    const shot = await page.screenshot({ clip: { x: probe.x - 240, y: probe.y - 12, width: 260, height: 24 } })
    writeFileSync(`${SHOTS}/edge-filter-${Math.round(z * 100)}.png`, shot)
    writeFileSync(`${SHOTS}/canvas-filter-${Math.round(z * 100)}.png`, await page.screenshot())
    const diff = await page.evaluate(async ([a, b]) => {
      const load = async (s: string) => {
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob())
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const x = c.getContext('2d')!
        x.drawImage(bmp, 0, 0)
        return x.getImageData(0, 0, bmp.width, bmp.height)
      }
      const A = await load(a!)
      const B = await load(b!)
      let sum = 0, max = 0, over = 0
      const n = Math.min(A.data.length, B.data.length) / 4
      for (let i = 0; i < n; i++) {
        let d = 0
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[i * 4 + k]! - B.data[i * 4 + k]!))
        sum += d; if (d > max) max = d; if (d > 8) over++
      }
      return { mean: sum / n, max, overPct: (over / n) * 100 }
    }, [clips[String(z)]!, shot.toString('base64')])
    say(
      `  ${String(Math.round(z * 100) + '%').padStart(5)}  ${diff.mean.toFixed(2).padStart(8)}  ` +
        `${String(diff.max).padStart(8)}  ${diff.overPct.toFixed(1).padStart(17)}%   ${diff.mean < 12 ? 'visually equivalent' : 'DIFFERENT'}`,
    )
    expect(diff.mean, `shadow at ${z * 100}% should look like the filter did`).toBeLessThan(12)
  }
  say(`  frames written to ${SHOTS}`)
})

// ──────────────────────────────────────────────────────────── §6 zoom is sane

test('zoom does not move, resize or disconnect anything', async ({ page }) => {
  test.setTimeout(600_000)
  await loadReal(page)

  const snapshot = () =>
    page.evaluate(() => {
      const { graph, paper } = (window as any).__pid.canvasRef
      const els = graph.getElements().map((e: any) => {
        const p = e.position(); const s = e.size()
        return `${e.id}@${p.x},${p.y}:${s.width}x${s.height}:${e.angle()}`
      }).sort()
      const links = graph.getLinks().map((l: any) => {
        const s = l.source(); const t = l.target()
        const v = paper.findViewByModel(l)
        const route = v && v.route ? v.route.length : -1
        return `${l.id}:${s.id ?? 'pt'}/${s.port ?? ''}->${t.id ?? 'pt'}/${t.port ?? ''}#${route}`
      }).sort()
      // jump hops are rendered as arcs in the link path
      const hops = [...document.querySelectorAll('.joint-link path[d]')]
        .reduce((n, p) => n + ((p.getAttribute('d') ?? '').match(/[Aa]/g)?.length ?? 0), 0)
      const labels = [...document.querySelectorAll('.joint-element text')].length
      return { els: els.join('|'), links: links.join('|'), hops, labels, cells: document.querySelectorAll('[model-id]').length }
    })

  await page.evaluate(() => { (window as any).__pid.canvasRef.paper.scale(1, 1) })
  await page.waitForTimeout(500)
  const base = await snapshot()
  say(`\n################ §6 ZOOM CORRECTNESS ################`)
  say(`  baseline at 100%: ${base.cells} cells, ${base.labels} label texts, ${base.hops} arc segments in link paths`)
  say(`  zoom    geometry   connections   jump hops   labels   cells`)

  for (const z of ZOOMS) {
    await page.evaluate((s) => { (window as any).__pid.canvasRef.paper.scale(s, s) }, z)
    await page.waitForTimeout(400)
    const s = await snapshot()
    say(
      `  ${String(Math.round(z * 100) + '%').padStart(5)}  ` +
        `${(s.els === base.els ? 'identical' : 'CHANGED').padStart(9)}   ` +
        `${(s.links === base.links ? 'identical' : 'CHANGED').padStart(11)}   ` +
        `${String(s.hops).padStart(9)}   ${String(s.labels).padStart(6)}   ${String(s.cells).padStart(5)}`,
    )
    expect(s.els, `element geometry must not change at ${z * 100}%`).toBe(base.els)
    expect(s.links, `connections must not change at ${z * 100}%`).toBe(base.links)
    expect(s.hops, `jumpover hops must not change at ${z * 100}%`).toBe(base.hops)
    expect(s.labels).toBe(base.labels)
  }

  // Zoom is reversible: back to 100% and everything is where it started.
  await page.evaluate(() => { (window as any).__pid.canvasRef.paper.scale(1, 1) })
  await page.waitForTimeout(400)
  const back = await snapshot()
  expect(back.els).toBe(base.els)
  expect(back.links).toBe(base.links)
  say(`  back at 100%: geometry ${back.els === base.els ? 'identical' : 'CHANGED'}, connections ${back.links === base.links ? 'identical' : 'CHANGED'}`)

  // Selection and snapping still work at 300%. Snapping lives in the drag, not
  // in the store, so it has to be exercised as a drag: a gesture that ends on
  // an odd pixel must land on the 8px grid, or on another symbol's edge if an
  // alignment guide caught it first.
  const sel = await page.evaluate(async () => {
    const w = window as any
    const { paper, graph } = w.__pid.canvasRef
    paper.scale(3, 3)
    await new Promise((r) => setTimeout(r, 400))
    const el = graph.getElements()[0]
    const id = String(el.id)
    const start = el.position()
    w.__pid.useStore.getState().setSelection([id])
    await new Promise((r) => setTimeout(r, 300))
    const highlighted = document.querySelectorAll('.joint-highlight-stroke').length

    w.__pid.useStore.getState().setSelection([])

    // Snapping is judged on a symbol standing on its own: an alignment guide
    // is also a legal landing, and next to a real drawing there is always one
    // within reach, which would make "did it snap to the grid?" unanswerable.
    const store = () => w.__pid.useStore.getState()
    const occupied = graph.getElements().map((e: any) => e.getBBox())
    const clear = (x: number, y: number) =>
      occupied.every((b: any) => Math.abs(b.x + b.width / 2 - x) > 220 || Math.abs(b.y + b.height / 2 - y) > 220)
    let spot = { x: 1200, y: 880 }
    outer: for (let y = 120; y < 1000; y += 40) {
      for (let x = 120; x < 1450; x += 40) {
        if (clear(x, y)) { spot = { x, y }; break outer }
      }
    }
    const lone = store().addNode({ symbolId: 'valve.gate', kind: 'valve', x: spot.x, y: spot.y, rotation: 0 })
    await new Promise((r) => setTimeout(r, 300))
    const cell = graph.getCell(lone)
    const lb = cell.getBBox()
    const host = (paper.el as HTMLElement).getBoundingClientRect()
    const p0 = paper.localToClientPoint({ x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 })
    const t = paper.translate()
    paper.translate(t.tx + (host.left + host.width / 2 - p0.x), t.ty + (host.top + host.height / 2 - p0.y))
    await new Promise((r) => setTimeout(r, 350))
    const p = paper.localToClientPoint({ x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 })
    const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()))
    const node = paper.findViewByModel(cell).el as SVGElement
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
    // 37 and 23 screen px at 300% is 12.33 and 7.67 document px: nothing that
    // could land on the grid by accident.
    for (let i = 1; i <= 10; i++) {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: p.x + i * 3.7, clientY: p.y + i * 2.3, button: 0, buttons: 1 }))
      await frame()
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
    await new Promise((r) => setTimeout(r, 300))
    const after = graph.getCell(lone).position()
    // A landing is legal if it is on the 8px grid, or if an alignment guide
    // caught it: the dragged symbol's left, centre or right edge lined up with
    // another symbol's left, centre or right. That is the rule the drag
    // implements (canvas/alignment.ts), so it is the rule to assert.
    const size = graph.getCell(lone).size()
    const onGuide = (v: number, axis: 'x' | 'y') =>
      graph.getElements().some((o: any) => {
        if (String(o.id) === String(lone)) return false
        const b = o.getBBox()
        const base = axis === 'x' ? [b.x, b.x + b.width / 2, b.x + b.width] : [b.y, b.y + b.height / 2, b.y + b.height]
        const sub = axis === 'x' ? [0, size.width / 2, size.width] : [0, size.height / 2, size.height]
        return base.some((g: number) => sub.some((k) => Math.abs(g - k - v) < 0.51))
      })
    store().setSelection([]); store().deleteIds([String(lone)])
    await new Promise((r) => setTimeout(r, 150))
    return {
      highlighted, start: spot, after,
      moved: after.x !== spot.x || after.y !== spot.y,
      onGrid: after.x % 8 === 0 && after.y % 8 === 0,
      guideX: onGuide(after.x, 'x'), guideY: onGuide(after.y, 'y'),
    }
  })
  const legalX = sel.after.x % 8 === 0 || sel.guideX
  const legalY = sel.after.y % 8 === 0 || sel.guideY
  say(
    `  at 300%: selection highlighters ${sel.highlighted}; symbol dragged ` +
      `${sel.start.x},${sel.start.y} → ${sel.after.x},${sel.after.y}` +
      `  x: ${sel.after.x % 8 === 0 ? 'on grid' : sel.guideX ? 'on an alignment guide' : 'NEITHER'}` +
      `  y: ${sel.after.y % 8 === 0 ? 'on grid' : sel.guideY ? 'on an alignment guide' : 'NEITHER'}`,
  )
  expect(sel.highlighted, 'selection must highlight at 300%').toBeGreaterThan(0)
  expect(sel.moved, 'the drag must move the symbol').toBe(true)
  expect(legalX, 'x must land on the grid or on an alignment guide').toBe(true)
  expect(legalY, 'y must land on the grid or on an alignment guide').toBe(true)
})

// ───────────────────────────────────────────── §7 every component type places

const TYPES: { label: string; symbolId: string; kind: string; config?: Record<string, string> }[] = [
  { label: 'Pump', symbolId: 'pump.centrifugal', kind: 'equipment' },
  { label: 'Vessel', symbolId: 'vessel.tank', kind: 'equipment' },
  { label: 'Valve', symbolId: 'valve.gate', kind: 'valve' },
  { label: 'Control valve', symbolId: 'cv.ball', kind: 'valve' },
  { label: 'Globe valve', symbolId: 'valve.globe', kind: 'valve' },
  { label: 'Instrument', symbolId: 'instr.bubble', kind: 'instrument', config: { display: 'discrete', location: 'field' } },
  { label: 'Fitting', symbolId: 'fit.junction', kind: 'fitting' },
  { label: 'Actuator', symbolId: 'cv.globe', kind: 'valve', config: { actuator: 'piston', positioner: 'yes' } },
]

test('every component type places, drags and releases at 300%', async ({ page }) => {
  test.setTimeout(600_000)
  await loadReal(page)
  await page.evaluate(() => { (window as any).__pid.canvasRef.paper.scale(3, 3) })
  await page.waitForTimeout(400)

  say(`\n################ §7 COMPONENT PLACEMENT AT 300% ################`)
  say(`  component        press    move p99    release   settle   moved   rendered   links   grab point`)
  for (const t of TYPES) {
    const r = await page.evaluate(async (t) => {
      const w = window as any
      const { paper, graph } = w.__pid.canvasRef
      const store = w.__pid.useStore.getState()
      // place it in the middle of what is on screen
      const host = (paper.el as HTMLElement).getBoundingClientRect()
      const mid = paper.clientToLocalPoint({ x: host.left + host.width / 2, y: host.top + host.height / 2 })
      const id = store.addNode({ symbolId: t.symbolId, kind: t.kind, x: Math.round(mid.x / 8) * 8, y: Math.round(mid.y / 8) * 8, rotation: 0, ...(t.config ? { config: t.config } : {}) })
      await new Promise((r) => setTimeout(r, 250))
      const cell = graph.getCell(id)
      if (!cell) return { error: 'no cell' }
      const b = cell.getBBox()
      const p = paper.localToClientPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
      const hit = document.elementFromPoint(p.x, p.y) as SVGElement | null
      // A symbol small enough that its own port halos cover its middle — the
      // 8x8 branch junction is the one — would have the press start a line
      // instead of a move. Grab such a symbol by its view root, which is what
      // a user reaching for the body between the dots does.
      const onMagnet = Boolean(hit?.closest('.pid-port-hit') || hit?.getAttribute('magnet'))
      const el = onMagnet ? (paper.findViewByModel(cell).el as SVGElement) : hit
      const linksBefore = graph.getLinks().length
      const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()))

      let s = performance.now()
      el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
      const press = performance.now() - s

      const moves: number[] = []
      for (let i = 0; i < 40; i++) {
        const m = performance.now()
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: p.x + i * 2, clientY: p.y + 12 * Math.sin(i / 5), button: 0, buttons: 1 }))
        moves.push(performance.now() - m)
        if (i % 3 === 2) await frame()
      }
      s = performance.now()
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      const release = performance.now() - s
      for (let i = 0; i < 3; i++) await frame()
      const settle = performance.now() - s

      const after = graph.getCell(id).position()
      const rendered = document.querySelector(`[model-id="${id}"]`) !== null
      const strayLinks = graph.getLinks().length - linksBefore
      const sorted = moves.slice().sort((a, b) => a - b)
      const cleanup = graph.getLinks().slice(linksBefore).map((l: any) => String(l.id))
      store.setSelection([]); store.deleteIds([String(id), ...cleanup])
      await new Promise((r) => setTimeout(r, 120))
      return {
        press, movep99: sorted[Math.floor(sorted.length * 0.99)] ?? 0, release, settle,
        moved: after.x !== Math.round(mid.x / 8) * 8 || after.y !== Math.round(mid.y / 8) * 8,
        rendered, grabbedVia: onMagnet ? 'view root (ports cover the body)' : (hit?.getAttribute('joint-selector') ?? hit?.tagName ?? '?'),
        strayLinks,
      }
    }, t)
    expect((r as any).error, `${t.label} should place`).toBeUndefined()
    const v = r as any
    say(
      `  ${t.label.padEnd(15)} ${v.press.toFixed(2).padStart(6)}  ${v.movep99.toFixed(2).padStart(9)}  ` +
        `${v.release.toFixed(2).padStart(9)}  ${v.settle.toFixed(0).padStart(6)}  ${String(v.moved).padStart(6)}   ` +
        `${String(v.rendered).padStart(8)}   ${v.strayLinks} stray   grabbed by ${v.grabbedVia}`,
    )
    expect(v.rendered, `${t.label} must render`).toBe(true)
    expect(v.strayLinks, `${t.label} must not sprout a line while being moved`).toBe(0)
    expect(v.moved, `${t.label} must follow the drag`).toBe(true)
    expect(v.release, `${t.label} release must not block`).toBeLessThan(50)
  }
})

// ───────────────────────────────────────── §8 connected components stay right

test('connected components keep their pipes when dragged at 300%', async ({ page }) => {
  test.setTimeout(600_000)
  await loadReal(page)

  say(`\n################ §8 CONNECTED COMPONENTS ################`)
  const cases = await page.evaluate(async () => {
    const w = window as any
    const { paper, graph } = w.__pid.canvasRef
    paper.scale(3, 3)
    await new Promise((r) => setTimeout(r, 400))
    const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()))
    const degree = new Map<string, number>()
    for (const l of graph.getLinks()) {
      for (const end of [l.source(), l.target()]) if (end.id) degree.set(String(end.id), (degree.get(String(end.id)) ?? 0) + 1)
    }
    const els = graph.getElements()
    const pick = (want: (d: number) => boolean) => els.find((e: any) => want(degree.get(String(e.id)) ?? 0))
    const ports = (e: any) => (e.getPorts?.() ?? []).length
    // A real drawing may have nothing loose on it; place one so the case is
    // covered rather than skipped.
    let placed: string | null = null
    if (!pick((d: number) => d === 0)) {
      const b = graph.getBBox()
      placed = w.__pid.useStore.getState().addNode({ symbolId: 'valve.gate', kind: 'valve', x: Math.round((b.x + 40) / 8) * 8, y: Math.round((b.y + b.height + 80) / 8) * 8, rotation: 0 })
      await new Promise((r) => setTimeout(r, 300))
    }
    const targets = [
      { label: 'unconnected', el: placed ? graph.getCell(placed) : pick((d: number) => d === 0) },
      { label: 'one pipe', el: pick((d: number) => d === 1) },
      { label: 'several pipes', el: els.slice().sort((a: any, b: any) => (degree.get(String(b.id)) ?? 0) - (degree.get(String(a.id)) ?? 0))[0] },
      { label: 'many ports', el: els.slice().sort((a: any, b: any) => ports(b) - ports(a))[0] },
    ]
    const out: any[] = []
    for (const t of targets) {
      if (!t.el) { out.push({ label: t.label, skipped: true }); continue }
      const id = String(t.el.id)
      const links = graph.getConnectedLinks(t.el)
      const before = links.map((l: any) => `${l.id}:${l.source().id ?? 'pt'}/${l.source().port ?? ''}->${l.target().id ?? 'pt'}/${l.target().port ?? ''}`).sort().join('|')
      const routesBefore = links.map((l: any) => (paper.findViewByModel(l)?.route ?? []).length).join(',')
      const startPos = t.el.position()
      // put it on screen, then drag it with real events
      const b = t.el.getBBox()
      const host = (paper.el as HTMLElement).getBoundingClientRect()
      const p0 = paper.localToClientPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
      const tr = paper.translate()
      paper.translate(tr.tx + (host.left + host.width / 2 - p0.x), tr.ty + (host.top + host.height / 2 - p0.y))
      await new Promise((r) => setTimeout(r, 350))
      const p = paper.localToClientPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
      const el = document.elementFromPoint(p.x, p.y)
      el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
      const moves: number[] = []
      for (let i = 0; i < 40; i++) {
        const m = performance.now()
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: p.x + i * 1.5, clientY: p.y + 10 * Math.sin(i / 5), button: 0, buttons: 1 }))
        moves.push(performance.now() - m)
        if (i % 3 === 2) await frame()
      }
      const s = performance.now()
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      const release = performance.now() - s
      for (let i = 0; i < 4; i++) await frame()
      await new Promise((r) => setTimeout(r, 250))
      const after = graph.getConnectedLinks(graph.getCell(id))
      const afterStr = after.map((l: any) => `${l.id}:${l.source().id ?? 'pt'}/${l.source().port ?? ''}->${l.target().id ?? 'pt'}/${l.target().port ?? ''}`).sort().join('|')
      const routesAfter = after.map((l: any) => (paper.findViewByModel(l)?.route ?? []).length).join(',')
      const endPos = graph.getCell(id).position()
      const sorted = moves.slice().sort((a, b) => a - b)
      out.push({
        label: t.label, id, ports: ports(t.el), pipes: links.length,
        sameEnds: before === afterStr, routesBefore, routesAfter,
        moved: endPos.x !== startPos.x || endPos.y !== startPos.y,
        movep99: sorted[Math.floor(sorted.length * 0.99)] ?? 0, release,
        broken: after.filter((l: any) => {
          const v = paper.findViewByModel(l)
          return !v || !v.el || !(v.el as SVGElement).querySelector('path')
        }).length,
      })
      // put it back
      w.__pid.useStore.getState().setNodePos(id, startPos.x, startPos.y)
      await new Promise((r) => setTimeout(r, 150))
    }
    if (placed) {
      w.__pid.useStore.getState().setSelection([])
      w.__pid.useStore.getState().deleteIds([placed])
      await new Promise((r) => setTimeout(r, 150))
    }
    return out
  })

  say(`  case            ports  pipes   move p99   release   ends kept   routes before→after   broken`)
  for (const c of cases as any[]) {
    if (c.skipped) { say(`  ${c.label.padEnd(15)} (no such symbol in this drawing)`); continue }
    say(
      `  ${c.label.padEnd(15)} ${String(c.ports).padStart(5)}  ${String(c.pipes).padStart(5)}   ` +
        `${c.movep99.toFixed(2).padStart(8)}  ${c.release.toFixed(2).padStart(8)}   ${String(c.sameEnds).padStart(9)}   ` +
        `${(c.routesBefore || '-')}→${(c.routesAfter || '-')}   ${c.broken}`,
    )
    expect(c.sameEnds, `${c.label}: pipes must stay attached to the same ports`).toBe(true)
    expect(c.broken, `${c.label}: every pipe must still render`).toBe(0)
    expect(c.moved, `${c.label}: the symbol must actually move`).toBe(true)
  }
})

// ───────────────────────────────────────────── §10 virtualization behaviour

/** Over the 400-cell threshold on its own, before edges. */
const BIG = 460

function bigSheetSource(): string {
  return `(() => {
    const n = ${BIG}
    const nodes = [], edges = []
    for (let i = 0; i < n; i++) nodes.push({ id: 'n' + i, symbolId: 'valve.gate', kind: 'valve',
      x: (i % 20) * 160, y: Math.floor(i / 20) * 160, rotation: 0 })
    for (let i = 0; i + 1 < n; i++) edges.push({ id: 'e' + i, lineClass: 'process.major',
      source: { nodeId: 'n' + i, portId: 'e' }, target: { nodeId: 'n' + (i + 1), portId: 'w' } })
    const now = new Date().toISOString()
    return { schemaVersion: 5, meta: { name: 'virtualization', author: '', created: now, modified: now },
      settings: { gridPx: 8, tagSeparator: '-', numberStart: 100 },
      sheets: [{ id: 'sh1', name: 'Sheet 1', drawingNumber: '', revision: '0', sheetSize: 'A1', nodes, edges }],
      hmiScreens: [], fluids: [] }
  })()`
}

test('a virtualized sheet mounts what is on screen, settles, and still edits', async ({ page }) => {
  test.setTimeout(600_000)
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate((src) => { (window as any).__pid.useStore.getState().loadIntoStore(eval(src)) }, bigSheetSource())
  await expect(page.locator('[model-id]')).toHaveCount(BIG + (BIG - 1), { timeout: 60_000 })

  const r = await page.evaluate(async (total) => {
    const w = window as any
    const { paper, graph } = w.__pid.canvasRef
    // count how often the visibility callback runs, to catch a mount/unmount loop
    let visCalls = 0
    let visMs = 0
    const vp = paper.options.viewport
    paper.options.viewport = function (...a: unknown[]) {
      const t = performance.now()
      const out = (vp as any).apply(this, a)
      visCalls++
      visMs += performance.now() - t
      return out
    }

    paper.scale(1, 1)
    paper.translate(0, 0)
    await new Promise((res) => setTimeout(res, 800))
    const mountedAtCorner = document.querySelectorAll('[model-id]').length

    // Nothing is moving: the callback must go quiet rather than churn.
    visCalls = 0
    visMs = 0
    const before = document.querySelectorAll('[model-id]').length
    const mountedSeen = new Set<string>()
    const record = () => { for (const el of document.querySelectorAll('[model-id]')) mountedSeen.add(el.getAttribute('model-id')!) }
    record()
    const firstSet = new Set(mountedSeen)
    await new Promise((res) => setTimeout(res, 1500))
    record()
    const idleCalls = visCalls
    const idleMs = visMs
    // Churn is what matters: a cell that came or went while nothing moved.
    const idleChurn = mountedSeen.size - firstSet.size
    const idleStable = document.querySelectorAll('[model-id]').length === before

    // Pan somewhere else and let it settle.
    paper.translate(-2300, -2300)
    await new Promise((res) => setTimeout(res, 900))
    const mountedAfterPan = document.querySelectorAll('[model-id]').length
    visCalls = 0
    visMs = 0
    const settledSet = new Set<string>()
    for (const el of document.querySelectorAll('[model-id]')) settledSet.add(el.getAttribute('model-id')!)
    await new Promise((res) => setTimeout(res, 1500))
    let churnAfterPan = 0
    const nowSet = new Set<string>()
    for (const el of document.querySelectorAll('[model-id]')) nowSet.add(el.getAttribute('model-id')!)
    for (const id of nowSet) if (!settledSet.has(id)) churnAfterPan++
    for (const id of settledSet) if (!nowSet.has(id)) churnAfterPan++
    const idleCallsAfterPan = visCalls
    const idleMsAfterPan = visMs

    // No blank areas: everything whose box is inside the window must be there.
    const host = (paper.el as HTMLElement).getBoundingClientRect()
    const tl = paper.clientToLocalPoint({ x: host.left, y: host.top })
    const br = paper.clientToLocalPoint({ x: host.right, y: host.bottom })
    let onScreen = 0
    let missing = 0
    for (const e of graph.getElements()) {
      const b = e.getBBox()
      if (b.x + b.width < tl.x || b.x > br.x || b.y + b.height < tl.y || b.y > br.y) continue
      onScreen++
      if (!document.querySelector(`[model-id="${e.id}"]`)) missing++
    }

    // Selection and line drawing still work on the part that is mounted.
    const visible = graph.getElements().find((e: any) => document.querySelector(`[model-id="${e.id}"]`))
    w.__pid.useStore.getState().setSelection([String(visible.id)])
    await new Promise((res) => setTimeout(res, 300))
    const highlighted = document.querySelectorAll('.joint-highlight-stroke').length
    w.__pid.useStore.getState().setSelection([])

    const linksBefore = graph.getLinks().length
    const halo = document.querySelector('[joint-selector="portBody"]') as SVGElement | null
    if (halo) {
      const hb = halo.getBoundingClientRect()
      const sx = hb.x + hb.width / 2
      const sy = hb.y + hb.height / 2
      halo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0, buttons: 1 }))
      for (let i = 0; i < 30; i++) {
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + i * 3, clientY: sy + 8, button: 0, buttons: 1 }))
        if (i % 3 === 2) await new Promise<void>((res) => requestAnimationFrame(() => res()))
      }
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
      await new Promise((res) => setTimeout(res, 400))
    }
    const linksAdded = graph.getLinks().length - linksBefore

    paper.options.viewport = vp
    return {
      total, mountedAtCorner, idleCalls, idleMs, idleChurn, idleStable,
      mountedAfterPan, idleCallsAfterPan, idleMsAfterPan, churnAfterPan,
      onScreen, missing, highlighted, linksAdded,
    }
  }, BIG + (BIG - 1))

  say(`\n################ §10 VIRTUALIZATION ################`)
  say(`  cells in the document                       : ${r.total}`)
  say(`  mounted at 1:1 on the corner                : ${r.mountedAtCorner}`)
  say(`  mounted after panning 2300,2300             : ${r.mountedAfterPan}`)
  say(`  symbols inside the window / not mounted     : ${r.onScreen} / ${r.missing}`)
  say(`  mount/unmount churn over 1.5 s of stillness : ${r.idleChurn} before the pan, ${r.churnAfterPan} after   count stable: ${r.idleStable}`)
  say(`  visibility re-tests while idle              : ${r.idleCalls} calls / ${r.idleMs.toFixed(1)} ms   (after the pan ${r.idleCallsAfterPan} / ${r.idleMsAfterPan.toFixed(1)} ms)`)
  say(`  selection highlighters · lines drawn        : ${r.highlighted} · ${r.linksAdded}`)
  expect(r.mountedAtCorner, 'the sheet should be virtualized').toBeLessThan(r.total)
  // JointJS re-evaluates the viewport predicate every frame for as long as a
  // `viewport` callback is set — that is how the library keeps the mounted set
  // right when content moves under a still camera. What must never happen is
  // views actually coming and going while nothing moves.
  expect(r.idleChurn, 'nothing may mount or unmount while the canvas is still').toBe(0)
  expect(r.churnAfterPan, 'a settled pan must not leave a mount/unmount loop').toBe(0)
  // 88 ms over 1.5 s when this was written: 0.06 ms a frame at 919 cells.
  // The bound is loose on purpose — it is here to catch a tenfold regression,
  // not to pin a number that varies with the machine.
  expect(r.idleMs, 'the idle re-test must stay off the frame budget').toBeLessThan(150)
  expect(r.idleStable).toBe(true)
  expect(r.missing, 'nothing inside the window may be left unrendered').toBe(0)
  expect(r.highlighted, 'selection must work on a virtualized sheet').toBeGreaterThan(0)
  expect(r.linksAdded, 'a line must still be drawable on a virtualized sheet').toBeGreaterThan(0)

  // And what the same per-frame re-test costs a drawing the size of a real
  // one, where the predicate short-circuits on the cell count and virtualizing
  // never engages at all.
  const small = await loadReal(page)
  await page.waitForTimeout(600)
  const s2 = await page.evaluate(async () => {
    const { paper } = (window as any).__pid.canvasRef
    let calls = 0
    let ms = 0
    const vp = paper.options.viewport
    paper.options.viewport = function (...a: unknown[]) {
      const t = performance.now()
      const out = (vp as any).apply(this, a)
      calls++
      ms += performance.now() - t
      return out
    }
    await new Promise((res) => setTimeout(res, 1500))
    paper.options.viewport = vp
    return { calls, ms }
  })
  say(`  the same, on the real ${small.nodes + small.edges}-cell drawing   : ${s2.calls} calls / ${s2.ms.toFixed(1)} ms over 1.5 s`)
  expect(s2.ms, 'a normal drawing must not pay for virtualization').toBeLessThan(40)
})

// ─────────────────────────────────────────────────────── §13 drawing is local

test('zoom, pan, drag, drop and connect make no network requests', async ({ page }) => {
  test.setTimeout(600_000)
  await loadReal(page)
  await page.waitForTimeout(800)

  const seen: string[] = []
  const onReq = (r: { url(): string; resourceType(): string }) => {
    const u = r.url()
    // Vite's dev client keeps a websocket and fetches modules on demand; the
    // production bundle has neither. Everything else is a real request.
    if (u.startsWith('data:') || u.startsWith('blob:')) return
    seen.push(`${r.resourceType()} ${u.replace('http://localhost:5173', '')}`)
  }
  page.on('request', onReq as never)

  await page.evaluate(async () => {
    const w = window as any
    const { paper, graph } = w.__pid.canvasRef
    const host = document.querySelector('.canvas-host') as HTMLElement
    const r = host.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()))
    for (let i = 0; i < 11; i++) { host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: -40 })); await frame() }
    const t = paper.translate(); paper.translate(t.tx - 200, t.ty - 150)
    for (let i = 0; i < 5; i++) await frame()
    const el0 = graph.getElements()[0]
    const b = el0.getBBox()
    const tr = paper.translate()
    const p0 = paper.localToClientPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
    paper.translate(tr.tx + (cx - p0.x), tr.ty + (cy - p0.y))
    await new Promise((res) => setTimeout(res, 300))
    const p = paper.localToClientPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
    const el = document.elementFromPoint(p.x, p.y)
    el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
    for (let i = 0; i < 40; i++) { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: p.x + i * 2, clientY: p.y + 8, button: 0, buttons: 1 })); if (i % 3 === 2) await frame() }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
    await new Promise((res) => setTimeout(res, 400))
    const halo = document.querySelector('[joint-selector="portBody"]') as SVGElement | null
    if (halo) {
      const hb = halo.getBoundingClientRect()
      halo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: hb.x + hb.width / 2, clientY: hb.y + hb.height / 2, button: 0, buttons: 1 }))
      for (let i = 0; i < 30; i++) { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: hb.x + i * 3, clientY: hb.y + 6, button: 0, buttons: 1 })); if (i % 3 === 2) await frame() }
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }))
    }
    await new Promise((res) => setTimeout(res, 600))
  })
  await page.waitForTimeout(1200)
  page.off('request', onReq as never)

  say(`\n################ §13 NETWORK DURING DRAWING ################`)
  say(`  requests observed during zoom + pan + drag + drop + connect: ${seen.length}`)
  for (const s of seen.slice(0, 20)) say(`    ${s}`)
  expect(seen, 'drawing must not talk to the network').toEqual([])
})

// ─────────────────────────────────── §11 export is complete at any zoom level

test('export at 400% carries the whole drawing', async ({ page }) => {
  test.setTimeout(600_000)
  const summary = await loadReal(page)
  await page.evaluate(() => {
    const { paper } = (window as any).__pid.canvasRef
    paper.scale(4, 4)
    paper.translate(-3000, -2000)
  })
  await page.waitForTimeout(700)

  const r = await page.evaluate(async () => {
    const w = window as any
    const svgMod = (await import(/* @vite-ignore */ '/src/export/svg.ts')) as { exportSvg(doc: unknown, sheet: unknown): string }
    const pngMod = (await import(/* @vite-ignore */ '/src/export/png.ts')) as { renderSheetPng(scale?: number): Promise<{ blob: Blob; width: number; height: number }> }
    const st = w.__pid.useStore.getState()
    const sheet = st.doc.sheets[0]
    const svg = svgMod.exportSvg(st.doc, sheet)
    const png = await pngMod.renderSheetPng(2)
    return {
      mounted: document.querySelectorAll('[model-id]').length,
      inSvg: (svg.match(/model-id=/g) ?? []).length,
      texts: (svg.match(/<text/g) ?? []).length,
      paths: (svg.match(/<path/g) ?? []).length,
      hasFilter: /feDropShadow|filter="url\(#pid-sheet-shadow/.test(svg),
      hasSheetShadow: /url\(#pid-sh-/.test(svg),
      nodes: sheet.nodes.length, edges: sheet.edges.length,
      png: { w: png.width, h: png.height, bytes: png.blob.size },
    }
  })
  say(`\n################ §11 EXPORT AT 400% ################`)
  say(`  document           : ${r.nodes} symbols + ${r.edges} lines`)
  say(`  mounted on canvas  : ${r.mounted} cells`)
  say(`  in exported SVG    : ${r.inSvg} cells · ${r.texts} texts · ${r.paths} paths`)
  say(`  sheet chrome in SVG: shadow filter ${r.hasFilter} · shadow gradients ${r.hasSheetShadow}`)
  say(`  PNG                : ${r.png.w}x${r.png.h}, ${(r.png.bytes / 1024).toFixed(0)} KB`)
  expect(r.inSvg, 'every cell must be in the export').toBe(summary.nodes + summary.edges)
  expect(r.png.bytes).toBeGreaterThan(10_000)
})
