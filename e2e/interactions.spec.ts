import { expect, test, type Page } from '@playwright/test'

/* Pointer-level coverage for the v0.3.1 interaction fixes:
   - symbols drag by their interior, not just their outline strokes
   - port-to-port drags connect and auto-pick a legal line class
   - short accidental drags near a port do NOT leave ghost stub lines
   - clicking a line opens the floating quick editor
   - side panels collapse and restore */

interface PidHook {
  useStore: { getState(): any }
  canvasRef: { paper?: any }
}
declare global {
  interface Window { __pid: PidHook }
}

/** Client-space point for a sheet-local point, via the live paper transform. */
async function clientPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([lx, ly]) => {
    const p = window.__pid.canvasRef.paper!.localToClientPoint({ x: lx, y: ly })
    return { x: p.x, y: p.y }
  }, [x, y])
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

test('move, connect, ghost-stub guard, quick line editor, panel collapse', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))

  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const fic = s.addNode({
      symbolId: 'instr.bubble', kind: 'instrument', x: 320, y: 96, rotation: 0,
      config: { display: 'discrete', location: 'field' }, tag: { letters: 'FIC', loop: '101' },
    })
    const valve = s.addNode({
      symbolId: 'cv.globe', kind: 'valve', x: 312, y: 240, rotation: 0,
      config: { actuator: 'diaphragm', fail: 'none' },
    })
    s.setSelection([])
    return { tank, fic, valve }
  })
  await expect(page.locator('[model-id]')).toHaveCount(3)

  // --- connection points are visible dots -------------------------------
  await expect(page.locator(`[model-id="${ids.tank}"] .pid-port-dot`)).toHaveCount(12)

  // --- drag the tank by its interior (not an outline stroke) -------------
  // Tank is 64x56 at (96,96); its center (128,124) has no stroke underneath.
  await drag(page, await clientPoint(page, 128, 124), await clientPoint(page, 208, 124))
  const tankPos = await page.evaluate((id) => {
    const s = window.__pid.useStore.getState()
    const sheet = s.doc.sheets[0]
    const n = sheet.nodes.find((n: any) => n.id === id)
    return { x: n.x, y: n.y }
  }, ids.tank)
  expect(tankPos.x).toBeGreaterThanOrEqual(168)
  expect(tankPos.y).toBe(96)

  // --- port-to-port drag connects, auto-picking a signal class -----------
  // Active line class stays the default process.major; FIC south port (both)
  // to valve top signal port must still connect, as signal.electric.
  // FIC bubble at (320,96), port s at local (20,40) -> sheet (340,136).
  // Valve at (312,240), port sig at local (32,0) -> sheet (344,240).
  await drag(page, await clientPoint(page, 340, 136), await clientPoint(page, 344, 240), 20)
  const edges1 = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges)
  expect(edges1).toHaveLength(1)
  expect(edges1[0].lineClass).toBe('signal.electric')
  expect(edges1[0].source.portId).toBe('s')
  expect(edges1[0].target.portId).toBe('sig')

  // The bubble s port (x=340) was 4px off the valve sig port (x=344); the
  // connect must auto-nudge the instrument so the line runs dead straight.
  const ficX = await page.evaluate(
    (id) => window.__pid.useStore.getState().doc.sheets[0].nodes.find((n: any) => n.id === id).x,
    ids.fic,
  )
  expect(ficX).toBe(324)

  // --- short drag from a port into blank leaves no ghost stub ------------
  await drag(page, await clientPoint(page, 232, 152), await clientPoint(page, 244, 158))
  const edges2 = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges)
  expect(edges2).toHaveLength(1)

  // --- clicking the line opens the quick editor and can retype it --------
  const mid = await clientPoint(page, 344, 188)
  await page.mouse.click(mid.x, mid.y)
  await expect(page.locator('.line-popover')).toBeVisible()
  await page.locator('.line-popover select').selectOption('signal.pneumatic')
  const cls = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges[0].lineClass)
  expect(cls).toBe('signal.pneumatic')

  // --- panels collapse into strips and come back --------------------------
  await page.locator('.palette .panel-collapse').click()
  await expect(page.locator('.strip-left')).toBeVisible()
  await expect(page.locator('.palette')).toHaveCount(0)
  await page.locator('.strip-left').click()
  await expect(page.locator('.palette')).toBeVisible()
  await page.locator('.props .panel-collapse').click()
  await expect(page.locator('.strip-right')).toBeVisible()
  await page.locator('.strip-right').click()
  await expect(page.locator('.props')).toBeVisible()

  // --- converter is searchable ------------------------------------------
  await page.locator('.palette-search').fill('i/p')
  await expect(page.locator('.palette-entry', { hasText: 'Signal Converter' })).toBeVisible()
})

test('typical loop places wired+tagged; advisor flags and fixes the missing I/P', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))

  // one click drops a complete flow loop, numbered per component type
  await page.locator('.typical-entry', { hasText: 'Flow control' }).click()
  const tags = await page.evaluate(() =>
    window.__pid.useStore.getState().doc.sheets[0].nodes
      .map((n: any) => (n.tag ? `${n.tag.letters}-${n.tag.loop}` : '?'))
      .sort(),
  )
  expect(tags).toEqual(['FE-100', 'FIC-100', 'FT-100', 'FV-100', 'FY-100'])

  // wire an electric signal straight into a diaphragm valve -> advisor offers the fix
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const lic = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 480, y: 96, rotation: 0, tag: { letters: 'LIC', loop: '100' } })
    const lv = s.addNode({ symbolId: 'cv.globe', kind: 'valve', x: 476, y: 320, rotation: 0, config: { actuator: 'diaphragm', fail: 'fc' }, tag: { letters: 'LV', loop: '100' } })
    s.addEdge({ lineClass: 'signal.electric', source: { nodeId: lic, portId: 's' }, target: { nodeId: lv, portId: 'sig' } })
  })
  await page.locator('.drawer-tabs button', { hasText: 'Issues' }).click()
  await expect(page.locator('.advisor-fix')).toHaveCount(1)
  await page.locator('.advisor-fix').click()
  const converters = await page.evaluate(() =>
    window.__pid.useStore.getState().doc.sheets[0].nodes
      .filter((n: any) => n.symbolId === 'instr.converter')
      .map((n: any) => `${n.tag.letters}-${n.tag.loop}`),
  )
  expect(converters).toContain('LY-100')
  await expect(page.locator('.advisor-fix')).toHaveCount(0)
})

test('polish: grouped undo, label drag, line re-attach, .pnid save name', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0, label: 'Hot Tank' })
    const lt = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 320, y: 96, rotation: 0, tag: { letters: 'LT', loop: '100' } })
    const edge = s.addEdge({ lineClass: 'process.impulse', source: { nodeId: lt, portId: 'w' }, target: { nodeId: tank, portId: 'e' } })
    s.setSelection([])
    return { tank, lt, edge }
  })

  await expect(page.locator('[model-id]')).toHaveCount(3) // rendered before clicking

  // --- grouped undo: typing a label is ONE undo step --------------------
  const cp = (x, y) => page.evaluate(([lx, ly]) => window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly }), [x, y]) as Promise<{ x: number; y: number }>
  const tc = await cp(128, 124)
  await page.mouse.click(tc.x, tc.y) // select tank
  const labelInput = page.locator('.props input[placeholder="Service / name"]')
  await labelInput.click()
  await labelInput.pressSequentially(' II', { delay: 30 })
  await labelInput.blur()
  await page.keyboard.press('ControlOrMeta+z')
  const label = await page.evaluate((id) =>
    window.__pid.useStore.getState().doc.sheets[0].nodes.find((n: any) => n.id === id).label, ids.tank)
  expect(label).toBe('Hot Tank')

  // --- drag the label text to a new spot --------------------------------
  // tank label baseline is local y=164; grab mid-glyph slightly above it
  const from = await cp(128, 160)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 16, { steps: 8 })
  await page.mouse.up()
  const off = await page.evaluate((id) =>
    window.__pid.useStore.getState().doc.sheets[0].nodes.find((n: any) => n.id === id).labelOffset, ids.tank)
  expect(off.x).toBeGreaterThanOrEqual(32)
  expect(off.y).toBeGreaterThanOrEqual(10)

  // --- re-attach the line's tank end to a different nozzle --------------
  await page.evaluate((id) => window.__pid.useStore.getState().setSelection([id]), ids.edge)
  await page.waitForTimeout(300)
  const arrow = page.locator('.joint-tool.target-arrowhead, [data-tool-name="target-arrowhead"]').first()
  const abox = await arrow.boundingBox()
  expect(abox).toBeTruthy()
  const dest = await cp(160, 96) // tank n1 roof nozzle
  await page.mouse.move(abox!.x + abox!.width / 2, abox!.y + abox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(dest.x, dest.y, { steps: 10 })
  await page.mouse.up()
  const target = await page.evaluate((id) =>
    window.__pid.useStore.getState().doc.sheets[0].edges.find((e: any) => e.id === id).target, ids.edge)
  expect(target.nodeId).toBe(ids.tank)
  expect(target.portId).not.toBe('e')

  // --- saving downloads a .pnid file ------------------------------------
  // headless Chromium's native save picker never resolves; use the fallback
  await page.evaluate(() => { (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pnid$/)

  // --- dropping a .pnid file on the canvas opens it ----------------------
  await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__pid.useStore.getState().doc))
    doc.meta.name = 'Dropped Drawing'
    const dt = new DataTransfer()
    dt.items.add(new File([JSON.stringify(doc)], 'dropped.pnid', { type: 'application/x-pnid' }))
    document.querySelector('.canvas-host')!.dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
    )
  })
  await expect(page.locator('.doc-name')).toContainText('Dropped Drawing')
})

test('stretch, duplicate, live group drag, branch tap into a pipe', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    const c = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 200, y: 320, rotation: 0 })
    const pipe = s.addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    s.setSelection([])
    return { a, b, c, pipe }
  })
  await expect(page.locator('[model-id]')).toHaveCount(4)
  const cp = (x, y) => page.evaluate(([lx, ly]) => window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly }), [x, y]) as Promise<{ x: number; y: number }>

  // --- stretch: widen tank A from the panel ------------------------------
  await page.mouse.click(...Object.values(await cp(128, 124)) as [number, number])
  // per-axis stretch moved behind an "advanced" disclosure: it cost two
  // permanent rows and six buttons in front of every symbol's real properties
  await page.getByTestId('prop-stretch').locator('summary').click()
  await page.locator('.props button[title="Wider"]').click()
  const sxA = await page.evaluate((id) =>
    window.__pid.useStore.getState().doc.sheets[0].nodes.find((n: any) => n.id === id).scaleX, ids.a)
  expect(sxA).toBe(1.25)

  // --- duplicate with Ctrl+D ---------------------------------------------
  await page.keyboard.press('ControlOrMeta+d')
  await expect(page.locator('[model-id]')).toHaveCount(5)

  // --- live group drag: select two tanks, drag one, both move ------------
  await page.evaluate((ids) => window.__pid.useStore.getState().setSelection([ids.b, ids.c]), ids)
  const from = await cp(432, 124) // inside tank B
  const to = await cp(432, 204)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  const moved = await page.evaluate((ids) => {
    const nodes = window.__pid.useStore.getState().doc.sheets[0].nodes
    return { b: nodes.find((n: any) => n.id === ids.b).y, c: nodes.find((n: any) => n.id === ids.c).y }
  }, ids)
  expect(moved.b).toBe(176) // 96 + 80
  expect(moved.c).toBe(400) // 320 + 80

  // --- branch tap: drop a line from tank C onto the A->B pipe ------------
  // pipe runs horizontally at y=128... after B moved, reroute happened; use
  // a fresh straight pipe between two fixed points instead
  const tap = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const d = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 480, rotation: 0 })
    const e = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 480, rotation: 0 })
    s.addEdge({ lineClass: 'process.major', source: { nodeId: d, portId: 'e' }, target: { nodeId: e, portId: 'w' } })
    s.setSelection([])
    return { d, e }
  })
  await page.waitForTimeout(400)
  const edgesBefore = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges.length)
  // drag from tank C bottom port down... use tank C's s port -> drop on the new pipe (midpoint ~ (280,512))
  const start = await cp(232, 400 + 56) // C moved to y=400; s port at (232,456)
  const drop = await cp(280, 512)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(drop.x, drop.y, { steps: 12 })
  await page.mouse.up()
  const after = await page.evaluate(() => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    return {
      junctions: sheet.nodes.filter((n: any) => n.symbolId === 'fit.junction').length,
      edges: sheet.edges.length,
      classes: sheet.edges.map((e: any) => e.lineClass),
    }
  })
  expect(after.junctions).toBe(1)
  expect(after.edges).toBe(edgesBefore + 2) // pipe -> two halves + branch
  expect(after.classes.every((c: string) => c === 'process.major')).toBe(true)
})

test('port dots show only on hover or while linking; nodes resize from the panel', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))
  const tank = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const id = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    s.setSelection([])
    return id
  })
  await expect(page.locator('[model-id]')).toHaveCount(1)
  const dot = page.locator(`[model-id="${tank}"] .pid-port-dot`).first()

  // hidden at rest, shown on hover
  await expect(dot).toHaveCSS('opacity', '0')
  await page.mouse.move(...Object.values(await clientPoint(page, 128, 124)) as [number, number])
  await expect(dot).toHaveCSS('opacity', '1')

  // while dragging from a port the paper enters linking mode
  const from = await clientPoint(page, 128, 96) // tank n port
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y - 40, { steps: 8 })
  await expect(page.locator('.joint-paper.pid-linking')).toHaveCount(1)
  await page.mouse.move(from.x + 8, from.y + 2, { steps: 4 })
  await page.mouse.up() // short stub -> discarded
  await expect(page.locator('.joint-paper.pid-linking')).toHaveCount(0)
  const edges = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges.length)
  expect(edges).toBe(0)

  // resize from the property panel
  await page.mouse.click(...Object.values(await clientPoint(page, 128, 124)) as [number, number])
  await page.locator('.props button[title="Larger"]').click()
  const scale = await page.evaluate(
    (id) => window.__pid.useStore.getState().doc.sheets[0].nodes.find((n: any) => n.id === id).scale,
    tank,
  )
  expect(scale).toBe(1.25)
  // the canvas now opens fitted to the window, so pin it to 1:1 before
  // measuring an on-screen box in unscaled pixels
  await page.getByTestId('tb-zoom-pct').click()
  // the async paper applies the resize a frame later — poll, don't snapshot
  await expect
    .poll(async () => {
      const box = await page.locator(`[model-id="${tank}"] [joint-selector="hit"]`).boundingBox()
      return box ? Math.round(box.width) : 0
    })
    .toBe(80) // 64 * 1.25
})
