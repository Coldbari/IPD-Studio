import { expect, test, type Page } from '@playwright/test'

/* Pointer-level coverage for the v0.3.1 interaction fixes:
   - symbols drag by their interior, not just their outline strokes
   - port-to-port drags connect and auto-pick a legal line class
   - short accidental drags near a port do NOT leave ghost stub lines
   - clicking a line opens the floating quick editor
   - side panels collapse and restore */

interface PidHook {
  useStore: { getState(): any }
  canvasRef: { paper?: any; graph?: any }
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
  const popover = page.locator('.line-popover')
  const dragHandle = popover.locator('.line-popover-drag')
  const beforePopover = (await popover.boundingBox())!
  const handleBox = (await dragHandle.boundingBox())!
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 96, handleBox.y + handleBox.height / 2 + 48, { steps: 8 })
  await page.mouse.up()
  const afterPopover = (await popover.boundingBox())!
  expect(afterPopover.x).toBeGreaterThan(beforePopover.x + 80)
  expect(afterPopover.y).toBeGreaterThan(beforePopover.y + 32)
  await page.locator('.line-popover select').selectOption('signal.pneumatic')
  const afterEditPopover = (await popover.boundingBox())!
  expect(Math.abs(afterEditPopover.x - afterPopover.x)).toBeLessThan(3)
  expect(Math.abs(afterEditPopover.y - afterPopover.y)).toBeLessThan(3)
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
  const cp = (x: number, y: number) => page.evaluate(([lx, ly]) => window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly }), [x, y]) as Promise<{ x: number; y: number }>
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
  const cp = (x: number, y: number) => page.evaluate(([lx, ly]) => window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly }), [x, y]) as Promise<{ x: number; y: number }>

  // --- stretch: widen tank A from the panel ------------------------------
  await page.mouse.click(...Object.values(await cp(128, 124)) as [number, number])
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
      junctions: new Set(sheet.edges.flatMap((e: any) => [e.source.junctionId, e.target.junctionId]).filter(Boolean)).size,
      edges: sheet.edges.length,
      classes: sheet.edges.map((e: any) => e.lineClass),
    }
  })
  expect(after.junctions).toBe(1)
  expect(after.edges).toBe(edgesBefore + 2) // pipe -> two halves + branch
  expect(after.classes.every((c: string) => c === 'process.major')).toBe(true)
})

test('Ctrl-drag connects two pipes directly and deleting one section keeps its neighbors', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await page.waitForFunction(() => Boolean(window.__pid.canvasRef.paper))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    const c = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 296, rotation: 0 })
    const d = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 296, rotation: 0 })
    const upper = s.addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    const lower = s.addEdge({ lineClass: 'process.major', source: { nodeId: c, portId: 'e' }, target: { nodeId: d, portId: 'w' } })
    s.setSelection([])
    return { upper, lower }
  })
  const cp = (x: number, y: number) => page.evaluate(([lx, ly]) => {
    const p = window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly })
    return { x: p.x, y: p.y }
  }, [x, y])

  const upperMid = await cp(280, 128)
  const beforeClick = await page.evaluate(() => structuredClone(window.__pid.useStore.getState().doc.sheets[0].edges))
  await page.mouse.click(upperMid.x, upperMid.y)
  let topology = await page.evaluate(() => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    return { nodes: sheet.nodes.length, edges: sheet.edges.length }
  })
  expect(topology).toEqual({ nodes: 4, edges: 2 })
  await expect.poll(() => page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges)).toEqual(beforeClick)

  const lowerMid = await cp(280, 328)
  await page.keyboard.down('Control')
  await page.mouse.move(upperMid.x, upperMid.y)
  await page.mouse.down()
  await page.mouse.move(lowerMid.x, lowerMid.y, { steps: 16 })
  await page.mouse.up()
  await page.keyboard.up('Control')

  const connected = await page.evaluate((ids) => {
    const s = window.__pid.useStore.getState()
    const sheet = s.doc.sheets[0]
    return {
      nodes: sheet.nodes.length,
      junctions: new Set(sheet.edges.flatMap((edge: any) => [edge.source.junctionId, edge.target.junctionId]).filter(Boolean)).size,
      edges: sheet.edges.length,
      oldEdgesRemain: sheet.edges.some((edge: any) => edge.id === ids.upper || edge.id === ids.lower),
      selection: s.selection,
    }
  }, ids)
  expect(connected.junctions).toBe(2)
  expect(connected.edges).toBe(5)
  expect(connected.oldEdgesRemain).toBe(false)
  expect(connected.selection).toHaveLength(1)

  await page.keyboard.press('Delete')
  topology = await page.evaluate(() => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    return {
      nodes: sheet.nodes.length,
      junctions: new Set(sheet.edges.flatMap((edge: any) => [edge.source.junctionId, edge.target.junctionId]).filter(Boolean)).size,
      edges: sheet.edges.length,
    }
  })
  expect(topology).toEqual({ nodes: 4, junctions: 2, edges: 4 })
})

test('Ctrl-dragging from an unselected pipe creates a free branch', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef.paper))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    s.addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    s.setSelection([])
  })
  const cp = (x: number, y: number) => page.evaluate(([lx, ly]) => {
    const p = window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly })
    return { x: p.x, y: p.y }
  }, [x, y])
  const start = await cp(280, 128)
  const end = await cp(280, 248)
  await page.keyboard.down('Control')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 14 })

  const preview = page.locator('.pid-branch-preview path').last()
  await expect(preview).toHaveAttribute('stroke-width', '2.5')
  await expect(preview).not.toHaveAttribute('stroke-dasharray', /.+/)
  const duringDrag = await page.evaluate(() => ({
    docEdges: window.__pid.useStore.getState().doc.sheets[0].edges.length,
    graphLinks: window.__pid.canvasRef.graph.getLinks().length,
  }))
  expect(duringDrag).toEqual({ docEdges: 1, graphLinks: 1 })

  await page.mouse.up()
  await page.keyboard.up('Control')

  const topology = await page.evaluate(() => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    return {
      nodes: sheet.nodes.length,
      junctions: new Set(sheet.edges.flatMap((edge: any) => [edge.source.junctionId, edge.target.junctionId]).filter(Boolean)).size,
      edges: sheet.edges.length,
      freeEnds: sheet.edges.flatMap((edge: any) => [edge.source, edge.target])
        .filter((end: any) => !end.nodeId && !end.junctionId).length,
    }
  })
  expect(topology).toEqual({ nodes: 2, junctions: 1, edges: 3, freeEnds: 1 })
  await expect(page.locator('.pid-branch-preview')).toHaveCount(0)

  // The branch gesture must fully release pointer state. A normal line can be
  // drawn immediately from another device port without refreshing the page.
  const port = await cp(128, 96)
  const free = await cp(128, 48)
  await page.mouse.move(port.x, port.y)
  await page.mouse.down()
  await page.mouse.move(free.x, free.y, { steps: 8 })
  await expect(page.locator('.joint-paper.pid-linking')).toHaveCount(1)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges.length)).toBe(4)
})

test('branching a waypointed line keeps its route and leaves other lines alone', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef?.paper))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addBatch([], [
      {
        id: 'tapped', lineGroupId: 'tapped', lineClass: 'process.major', routing: 'fixed',
        source: { x: 128, y: 128 }, target: { x: 432, y: 128 },
        vertices: [{ x: 128, y: 256 }, { x: 280, y: 256 }, { x: 280, y: 128 }],
      },
      {
        id: 'other', lineGroupId: 'other', lineClass: 'process.major', routing: 'fixed',
        source: { x: 128, y: 464 }, target: { x: 432, y: 464 },
        vertices: [{ x: 128, y: 336 }, { x: 280, y: 336 }, { x: 280, y: 464 }],
      },
    ])
    s.setSelection([])
  })
  // wait until the tapped line has a rendered connection to tap into
  await page.waitForFunction(() => {
    const graph = window.__pid.canvasRef.graph
    const view = graph?.getCell('tapped')?.findView(window.__pid.canvasRef.paper)
    return Boolean(view && view.getConnection())
  })
  const beforeOther = await page.evaluate(() => {
    const edge = window.__pid.useStore.getState().doc.sheets[0].edges.find((e: any) => e.id === 'other')
    return JSON.parse(JSON.stringify(edge))
  })

  // ctrl+drag from the tapped line's bottom run to empty space
  const start = await clientPoint(page, 200, 256)
  const end = await clientPoint(page, 200, 360)
  await page.keyboard.down('Control')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.up('Control')

  const after = await page.evaluate(() => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    const junctionEdges = sheet.edges.filter((e: any) => e.id !== 'other')
    const junctionId = junctionEdges
      .flatMap((e: any) => [e.source, e.target])
      .map((end: any) => end.junctionId)
      .find(Boolean)
    const fromStart = junctionEdges.find((e: any) => e.source.x === 128 && e.source.y === 128)
    const toEnd = junctionEdges.find((e: any) => e.target.x === 432 && e.target.y === 128)
    return {
      edges: sheet.edges.length,
      junctionId,
      fromStart: fromStart && {
        source: fromStart.source,
        target: fromStart.target,
        vertices: fromStart.vertices,
        routing: fromStart.routing,
      },
      toEnd: toEnd && {
        source: toEnd.source,
        target: toEnd.target,
        vertices: toEnd.vertices,
        routing: toEnd.routing,
      },
      other: sheet.edges.find((e: any) => e.id === 'other'),
    }
  })

  expect(after.edges).toBe(4) // untouched line + two halves + branch
  expect(after.junctionId).toBeTruthy()
  // the original route survives: (128,128) v (128,256) h (280,256) v (280,128) h (432,128)
  expect(after.fromStart).toMatchObject({
    source: { x: 128, y: 128 },
    target: { x: 200, y: 256, junctionId: after.junctionId },
    vertices: [{ x: 128, y: 256 }],
    routing: 'fixed',
  })
  expect(after.toEnd).toMatchObject({
    source: { x: 200, y: 256, junctionId: after.junctionId },
    target: { x: 432, y: 128 },
    vertices: [{ x: 280, y: 256 }, { x: 280, y: 128 }],
    routing: 'fixed',
  })
  // the untouched line is bit-for-bit unchanged
  expect(after.other).toEqual(beforeOther)
})

test('ordinary pipe drag does not start a branch', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef.paper))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    s.addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    s.setSelection([])
  })
  const start = await page.evaluate(() => window.__pid.canvasRef.paper.localToClientPoint({ x: 280, y: 128 }))
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y + 80, { steps: 10 })
  await page.mouse.up()
  expect(await page.evaluate(() => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    return { nodes: sheet.nodes.length, edges: sheet.edges.length }
  })).toEqual({ nodes: 2, edges: 1 })
  await expect(page.locator('.pid-branch-preview')).toHaveCount(0)
})

test('branch and main-line arrows stay on their own endpoint segments', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef?.paper))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    const junction = { x: 280, y: 128, junctionId: 'arrow-junction' }
    s.addBatch([], [
      { id: 'main-left', lineGroupId: 'main-arrow-line', lineClass: 'process.major', routing: 'fixed', source: { nodeId: a, portId: 'e' }, target: junction },
      { id: 'main-right', lineGroupId: 'main-arrow-line', lineClass: 'process.major', routing: 'fixed', source: junction, target: { nodeId: b, portId: 'w' } },
      { id: 'branch', lineGroupId: 'branch-arrow-line', lineClass: 'process.major', routing: 'fixed', source: { x: 280, y: 0 }, target: junction },
    ])
    s.setEdge('main-left', { arrow: 'flow' })
    s.setEdge('branch', { arrow: 'flow' })
    s.setSelection([])
    return { a, b }
  })
  await page.waitForTimeout(200)
  const state = await page.evaluate(() => {
    const p = window.__pid.canvasRef.paper
    const graph = window.__pid.canvasRef.graph
    const link = (id: string) => {
      const cell = graph.getCell(id)
      return {
        source: cell.source(),
        target: cell.target(),
        marker: cell.attr('line/targetMarker'),
      }
    }
    return {
      edges: window.__pid.useStore.getState().doc.sheets[0].edges,
      mainLeft: link('main-left'),
      mainRight: link('main-right'),
      branch: link('branch'),
      branchPath: p.svg.querySelector('[model-id="branch"] [joint-selector="line"]')?.getAttribute('d') ?? '',
      markers: [...p.svg.querySelectorAll('marker')].map((marker) => marker.innerHTML),
    }
  })
  expect(state.edges.find((edge: any) => edge.id === 'main-right')?.arrow).toBeUndefined()
  expect(state.edges.find((edge: any) => edge.id === 'main-left')?.arrow).toBe('flow')
  expect(state.edges.find((edge: any) => edge.id === 'branch')?.arrow).toBe('flow')
  expect(state.mainLeft.marker?.type).toBe('path')
  expect(state.mainRight.marker?.type).toBe('none')
  expect(state.branch.source).toEqual({ x: 280, y: 0 })
  expect(state.branch.target).toEqual({ x: 280, y: 128 })
  expect(state.branch.marker?.type).toBe('path')
  expect(state.branchPath).toMatch(/^M 280 0 L 280 128$/)
  expect(state.markers.some((html: string) => html.includes('<path'))).toBe(true)
  await page.evaluate(() => window.__pid.useStore.getState().setSelection(['main-left']))
  await expect(page.locator('.props input[type="checkbox"]').first()).toBeChecked()
  await page.evaluate(() => window.__pid.useStore.getState().reverseEdgeDirection('branch'))
  await expect.poll(() => page.evaluate(() => {
    const edge = window.__pid.useStore.getState().doc.sheets[0].edges.find((candidate: any) => candidate.id === 'branch')
    return { source: edge?.source, target: edge?.target, arrow: edge?.arrow }
  })).toEqual({ source: { x: 280, y: 128, junctionId: 'arrow-junction' }, target: { x: 280, y: 0 }, arrow: 'flow' })
  void ids
})

test('nearby ports do not attract a line and moving equipment does not auto-connect', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef.paper))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    s.setSelection([])
    return { a, b }
  })
  await expect(page.locator('.joint-element')).toHaveCount(2)

  // Start exactly on A's east port, but release 12px beside B's west port.
  // This used to fall within the 24px magnetic radius and attach itself.
  await drag(page, await clientPoint(page, 160, 128), await clientPoint(page, 388, 140), 16)
  const line = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges[0])
  expect(line.source.nodeId).toBe(ids.a)
  expect(line.target.nodeId).toBeUndefined()
  expect(Math.hypot(line.target.x - 400, line.target.y - 128)).toBeGreaterThan(8)

  const before = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges.length)
  await drag(page, await clientPoint(page, 128, 124), await clientPoint(page, 368, 124), 16)
  const after = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges.length)
  expect(after).toBe(before)
})

test('loading a document rebuilds the canvas even when the first sheet id is unchanged', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef.paper))
  const oldSheetId = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    for (let i = 0; i < 8; i++) {
      s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 80 + i * 72, y: 96, rotation: 0 })
    }
    return s.doc.sheets[0].id
  })
  await expect(page.locator('.joint-element')).toHaveCount(8)

  await page.evaluate((sheetId) => {
    const s = window.__pid.useStore.getState()
    const doc = structuredClone(s.doc)
    doc.meta.name = 'Replacement drawing'
    doc.sheets = [{
      id: sheetId,
      name: 'Loaded sheet',
      drawingNumber: '',
      revision: '0',
      sheetSize: 'A3',
      nodes: [
        { id: 'loaded-a', symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 },
        { id: 'loaded-j', symbolId: 'fit.junction', kind: 'fitting', x: 240, y: 124, rotation: 0 },
      ],
      edges: [],
    }]
    s.loadIntoStore(doc)
  }, oldSheetId)

  await expect(page.locator('.joint-element')).toHaveCount(2)
  await expect(page.locator('[model-id="loaded-a"]')).toHaveCount(1)
  await expect(page.locator('[model-id="loaded-j"] [joint-selector="sym"] circle')).toHaveCount(1)
  await expect(page.locator('.joint-link')).toHaveCount(0)
  await expect(page.locator('.doc-name')).toContainText('Replacement drawing')
})

test('dragging an existing free line end onto a pipe joins it directly', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef.paper))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    const c = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 296, rotation: 0 })
    const header = s.addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    const stub = s.addEdge({ lineClass: 'process.major', source: { nodeId: c, portId: 'e' }, target: { x: 280, y: 328 } })
    s.setSelection([stub])
    return { header, stub }
  })
  const cp = (x: number, y: number) => page.evaluate(([lx, ly]) => {
    const p = window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly })
    return { x: p.x, y: p.y }
  }, [x, y])
  await expect(page.locator('[data-tool-name="target-arrowhead"]')).toBeVisible()
  const handle = page.locator('[data-tool-name="target-arrowhead"]')
  const box = (await handle.boundingBox())!
  const target = await cp(280, 128)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 16 })
  await page.mouse.up()

  const topology = await page.evaluate((ids) => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    const branch = sheet.edges.find((edge: any) => edge.id === ids.stub)
    return {
      junctions: new Set(sheet.edges.flatMap((edge: any) => [edge.source.junctionId, edge.target.junctionId]).filter(Boolean)).size,
      edges: sheet.edges.length,
      oldHeaderRemains: sheet.edges.some((edge: any) => edge.id === ids.header),
      branchTargetIsJunction: Boolean(branch?.target.junctionId),
    }
  }, ids)
  expect(topology).toEqual({ junctions: 1, edges: 3, oldHeaderRemains: false, branchTargetIsJunction: true })
})

test('moving a free line end preserves its pending device tag', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef.paper))
  const edgeId = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const edge = s.addEdge({
      lineClass: 'process.major',
      source: { nodeId: tank, portId: 'e' },
      target: { x: 280, y: 128 },
    })
    s.setSelection([edge])
    return edge
  })

  const pendingInput = page.getByRole('textbox', { name: 'Pending device tag (Target)' })
  await pendingInput.fill('V-204')
  await pendingInput.blur()

  const handle = page.locator(`[data-tool-name="target-arrowhead"][model-id="${edgeId}"]`)
  const box = (await handle.boundingBox())!
  const destination = await clientPoint(page, 320, 208)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(destination.x, destination.y, { steps: 12 })
  await page.mouse.up()

  await expect.poll(() => page.evaluate((id) =>
    window.__pid.useStore.getState().doc.sheets[0].edges.find((edge: any) => edge.id === id)?.target,
  edgeId)).toEqual({ x: 320, y: 208, pendingTag: 'V-204' })
  await expect(pendingInput).toHaveValue('V-204')
})

test('branched line segments can be reselected and their equipment ends reattached', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef.paper))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    const c = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 248, y: 296, rotation: 0 })
    const d = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 296, rotation: 0 })
    const junction = { x: 280, y: 128, junctionId: 'junction-1' }
    const left = 'branch-left'
    const right = 'branch-right'
    s.addBatch([], [
      { id: left, lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: junction },
      { id: right, lineClass: 'process.major', source: junction, target: { nodeId: b, portId: 'w' } },
      { id: 'branch-down', lineClass: 'process.major', source: junction, target: { nodeId: c, portId: 'n' } },
    ])
    s.setSelection([])
    return { a, b, c, d, left, right }
  })
  const cp = (x: number, y: number) => page.evaluate(([lx, ly]) => {
    const p = window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly })
    return { x: p.x, y: p.y }
  }, [x, y])

  // A real blank click removes focus. The same branch segment must remain
  // selectable afterwards and must restore both endpoint tools.
  const leftMid = await cp(220, 128)
  await page.mouse.click(leftMid.x, leftMid.y)
  await expect.poll(() => page.evaluate(() => window.__pid.useStore.getState().selection)).toEqual([ids.left])
  await page.mouse.click(...Object.values(await cp(700, 500)) as [number, number])
  await expect.poll(() => page.evaluate(() => window.__pid.useStore.getState().selection)).toEqual([])
  await page.mouse.click(leftMid.x, leftMid.y)
  await expect.poll(() => page.evaluate(() => window.__pid.useStore.getState().selection)).toEqual([ids.left])
  await expect(page.locator('[data-tool-name="source-arrowhead"]')).toBeVisible()
  await expect(page.locator('[data-tool-name="target-arrowhead"]')).toBeVisible()
  const editableLimbs = await page.locator('[data-tool-name="vertices"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('model-id')).filter(Boolean),
  )
  expect(new Set(editableLimbs)).toEqual(new Set([ids.left]))

  // The junction at the other end is a valid network anchor, so the equipment
  // end may be detached and moved to a free point without deleting the limb.
  const sourceHandle = page.locator('[data-tool-name="source-arrowhead"]')
  const sourceBox = (await sourceHandle.boundingBox())!
  const free = await cp(160, 48)
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(free.x, free.y, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate((id) => {
    const edge = window.__pid.useStore.getState().doc.sheets[0].edges.find((candidate: any) => candidate.id === id)
    return { source: edge?.source, edges: window.__pid.useStore.getState().doc.sheets[0].edges.length }
  }, ids.left)).toEqual({ source: { x: 160, y: 48 }, edges: 3 })

  // Each limb is a separate editable object.
  await page.mouse.click(...Object.values(await cp(700, 500)) as [number, number])
  await page.waitForFunction((id) => Boolean(
    window.__pid.canvasRef.graph.getCell(id)?.findView(window.__pid.canvasRef.paper),
  ), ids.right)
  const rightMid = await page.evaluate((id) => {
    const paper = window.__pid.canvasRef.paper
    const view = window.__pid.canvasRef.graph.getCell(id).findView(paper)
    return paper.localToClientPoint(view.getPointAtRatio(0.75))
  }, ids.right)
  await page.mouse.click(rightMid.x, rightMid.y)
  await expect.poll(() => page.evaluate(() => window.__pid.useStore.getState().selection)).toEqual([ids.right])
  await expect(page.locator(`[data-tool-name="target-arrowhead"][model-id="${ids.left}"]`)).toBeHidden()
  const targetHandle = page.locator(`[data-tool-name="target-arrowhead"][model-id="${ids.right}"]`)
  const targetBox = (await targetHandle.boundingBox())!
  const devicePort = await cp(400, 328)
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(devicePort.x, devicePort.y, { steps: 16 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate((id) =>
    window.__pid.useStore.getState().doc.sheets[0].edges.find((edge: any) => edge.id === id)?.target,
  ids.left)).not.toBeUndefined()
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
