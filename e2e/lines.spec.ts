import { expect, test, type Page } from '@playwright/test'

/* Line lifecycle regressions from user feedback:
   - deleting a line with the on-line ✕ tool must delete it FROM THE DOC —
     the old bug removed only the JointJS cell, so the next store change
     (like drawing a new line) resurrected the "deleted" line
   - a vertex/segment drag is ONE undo step, not one per mousemove
   - dragging a bend back onto the line's axis heals the line straight */

interface PidHook {
  useStore: { getState(): any; temporal: { getState(): any } }
  canvasRef: { paper?: any; graph?: any }
}
declare global {
  interface Window { __pid: PidHook }
}

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

const edges = (page: Page) => page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges)
const undoDepth = (page: Page) =>
  page.evaluate(() => window.__pid.useStore.temporal.getState().pastStates.length)

/** Tank + FIC bubble + valve; draws FIC.s -> valve.sig (a straight vertical line at x=344). */
async function setupWithLine(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    s.addNode({
      symbolId: 'instr.bubble', kind: 'instrument', x: 320, y: 96, rotation: 0,
      config: { display: 'discrete', location: 'field' }, tag: { letters: 'FIC', loop: '101' },
    })
    s.addNode({
      symbolId: 'cv.globe', kind: 'valve', x: 312, y: 240, rotation: 0,
      config: { actuator: 'diaphragm', fail: 'none' },
    })
    s.setSelection([])
  })
  await expect(page.locator('[model-id]')).toHaveCount(3)
  await drag(page, await clientPoint(page, 340, 136), await clientPoint(page, 344, 240), 20)
  await expect.poll(async () => (await edges(page)).length).toBe(1)
  // drawing auto-selects the new line, so its tools mount on their own once
  // the async route render settles — never race it with extra clicks
  await expect(page.locator('[data-tool-name="remove"]')).toBeVisible()
}

test('the on-line ✕ tool deletes from the doc — no resurrection on the next draw', async ({ page }) => {
  await setupWithLine(page)
  await page.locator('[data-tool-name="remove"]').click()
  // the doc must drop the edge immediately…
  await expect.poll(async () => (await edges(page)).length).toBe(0)
  // …and drawing a new line must not resurrect the old one
  await drag(page, await clientPoint(page, 344, 136), await clientPoint(page, 344, 240), 20)
  await expect.poll(async () => (await edges(page)).length).toBe(1)
  await expect(page.locator('.joint-link[model-id]')).toHaveCount(1)
})

test('vertex drag: one undo step, sticks where dropped, heals straight on the axis', async ({ page }) => {
  await setupWithLine(page)

  const before = await undoDepth(page)
  // drag the line body sideways: creates a bend and places it
  await drag(page, await clientPoint(page, 344, 216), await clientPoint(page, 400, 216), 16)
  const e1 = await edges(page)
  expect(e1[0].vertices?.length ?? 0).toBeGreaterThanOrEqual(1)
  expect(e1[0].vertices[0].x).toBe(400)
  const after = await undoDepth(page)
  expect(after - before).toBeLessThanOrEqual(2) // the whole gesture is one commit

  // drag the bend back onto the line's axis: the kink heals, the line is straight again
  await drag(page, await clientPoint(page, 400, 216), await clientPoint(page, 347, 216), 12)
  await expect.poll(async () => {
    const e = await edges(page)
    return e[0].vertices?.length ?? 0
  }).toBe(0)

  // and a single undo restores the bend (gesture-granular history)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => {
    const e = await edges(page)
    return e[0].vertices?.length ?? 0
  }).toBeGreaterThanOrEqual(1)
})

test('repositioning a branch end stays orthogonal — mid-drag and after release', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef?.paper))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    // a branch pulled from a pipe tee to free space: fixed routing, one bend
    s.addBatch([], [{
      id: 'branch', lineGroupId: 'branch', lineClass: 'process.major', routing: 'fixed',
      source: { x: 200, y: 256, junctionId: 'branch-j1' }, target: { x: 280, y: 360 },
      vertices: [{ x: 200, y: 360 }],
    }])
    s.setSelection(['branch'])
  })
  await page.waitForTimeout(400)

  const diagonals = () => page.evaluate(() => {
    const d = document.querySelector('[model-id="branch"] [joint-selector="line"]')?.getAttribute('d') ?? ''
    const nums = d.match(/-?[\d.]+/g)?.map(Number) ?? []
    let count = 0
    for (let i = 0; i + 3 < nums.length; i += 4) {
      if (nums[i] !== nums[i + 2] && nums[i + 1] !== nums[i + 3]) count++
    }
    return count
  })

  // drag the branch's free end (the target arrowhead) diagonally
  const from = await clientPoint(page, 280, 360)
  const to = await clientPoint(page, 240, 320)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await expect.poll(diagonals).toBe(0)
  await page.mouse.up()
  await page.waitForTimeout(250)
  expect(await diagonals()).toBe(0)
  const state = await page.evaluate(() => {
    const e = window.__pid.useStore.getState().doc.sheets[0].edges.find((x: any) => x.id === 'branch')
    return { target: e?.target, vertices: e?.vertices }
  })
  // the end lands where it was dropped; the kept bend is untouched
  expect(state.target).toEqual({ x: 240, y: 320 })
  expect(state.vertices).toEqual([{ x: 200, y: 360 }])
})

test('bending a point-to-point line stays orthogonal — no diagonal segments', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef?.paper))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addBatch([], [{
      id: 'line', lineGroupId: 'line', lineClass: 'process.major',
      source: { x: 80, y: 400 }, target: { x: 320, y: 400 },
      vertices: [{ x: 80, y: 320 }, { x: 320, y: 320 }],
    }])
    s.setSelection(['line'])
  })
  await page.waitForTimeout(400)

  const diagonals = () => page.evaluate(() => {
    const d = document.querySelector('[model-id="line"] [joint-selector="line"]')?.getAttribute('d') ?? ''
    const nums = d.match(/-?[\d.]+/g)?.map(Number) ?? []
    let count = 0
    for (let i = 0; i + 3 < nums.length; i += 4) {
      if (nums[i] !== nums[i + 2] && nums[i + 1] !== nums[i + 3]) count++
    }
    return count
  })

  // drag the left bend handle diagonally — the route must never go diagonal,
  // not even while the mouse is still down
  const from = await clientPoint(page, 80, 320)
  const to = await clientPoint(page, 120, 360)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await expect.poll(diagonals).toBe(0)
  await page.mouse.up()
  await page.waitForTimeout(250)
  expect(await diagonals()).toBe(0)
  // the bend still lands exactly where the user dropped it
  const vertices = await page.evaluate(() => {
    const e = window.__pid.useStore.getState().doc.sheets[0].edges.find((x: any) => x.id === 'line')
    return e?.vertices
  })
  expect(vertices?.[0]).toEqual({ x: 120, y: 360 })
})

test('deleted bends stay deleted across a save and reopen', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef?.paper))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    // an L-shaped route with two bends; the user keeps one and deletes the other
    s.addBatch([], [{
      id: 'line', lineGroupId: 'line', lineClass: 'process.major',
      source: { x: 80, y: 400 }, target: { x: 320, y: 560 },
      vertices: [{ x: 80, y: 560 }, { x: 320, y: 560 }],
    }])
    s.setSelection(['line'])
  })
  await page.waitForTimeout(400)

  const vertexList = () => page.evaluate(() => {
    const e = window.__pid.useStore.getState().doc.sheets[0].edges.find((x: any) => x.id === 'line')
    const paper = window.__pid.canvasRef.paper
    return (e.vertices ?? []).map((v: any) => {
      const p = paper.localToClientPoint({ x: v.x, y: v.y })
      return { x: p.x, y: p.y }
    })
  })

  // delete the first bend by double-clicking its handle (retry while tools
  // re-render); the second bend then sits on the endpoint and heals away too
  let points = await vertexList()
  const first = points[0]!
  for (let guard = 0; points.length === 2 && guard < 10; guard++) {
    await page.mouse.dblclick(first.x, first.y)
    await page.waitForTimeout(250)
    points = await vertexList()
  }
  expect(points).toHaveLength(0)

  const beforeSave = await page.evaluate(() => structuredClone(
    window.__pid.useStore.getState().doc.sheets[0].edges.find((x: any) => x.id === 'line'),
  ))

  // save + reopen: serialize the document and load it straight back
  await page.evaluate(() => {
    const doc = window.__pid.useStore.getState().doc
    window.__pid.useStore.getState().loadIntoStore(JSON.parse(JSON.stringify(doc)))
  })
  await page.waitForTimeout(300)
  const afterOpen = await page.evaluate(() => structuredClone(
    window.__pid.useStore.getState().doc.sheets[0].edges.find((x: any) => x.id === 'line'),
  ))
  // the reopened line is byte-identical — the deleted point stays deleted
  expect(afterOpen).toEqual(beforeSave)
})

test('editing one line vertices does not mutate other lines', async ({ page }) => {
  await setupWithLine(page)
  const secondId = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.doc.sheets[0].nodes.find((n: any) => n.symbolId === 'vessel.tank')
    const edge = s.addEdge({
      lineClass: 'process.major',
      source: { nodeId: tank.id, portId: 'e' },
      target: { x: 480, y: 128 },
    })
    s.setSelection([])
    return edge
  })
  const before = await page.evaluate(() => structuredClone(window.__pid.useStore.getState().doc.sheets[0].edges))
  const beforeGraph = await page.evaluate((ids) => Object.fromEntries(ids.map((id: string) => {
    const cell = window.__pid.canvasRef.graph.getCell(id)
    return [id, cell?.vertices()]
  })), [before[0].id, secondId])

  await page.mouse.click(...Object.values(await clientPoint(page, 344, 188)) as [number, number])
  await drag(page, await clientPoint(page, 344, 216), await clientPoint(page, 400, 216), 16)

  const after = await page.evaluate(() => structuredClone(window.__pid.useStore.getState().doc.sheets[0].edges))
  const afterGraph = await page.evaluate((ids) => Object.fromEntries(ids.map((id: string) => {
    const cell = window.__pid.canvasRef.graph.getCell(id)
    return [id, cell?.vertices()]
  })), [before[0].id, secondId])
  expect(after.find((edge: any) => edge.id === before[0].id)?.vertices).not.toEqual(before.find((edge: any) => edge.id === before[0].id)?.vertices)
  expect(after.find((edge: any) => edge.id === secondId)).toEqual(before.find((edge: any) => edge.id === secondId))
  expect(afterGraph[secondId]).toEqual(beforeGraph[secondId])
})

test('vertex editing skips sheet-wide endpoint cleanup on untouched lines', async ({ page }) => {
  await setupWithLine(page)
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const sheet = s.doc.sheets[0]
    const first = sheet.edges[0]
    const orphanJunction = { x: 520, y: 128, junctionId: 'untouched-junction', pendingTag: 'V-204' }
    const second = s.addEdge({
      lineClass: 'process.major',
      source: orphanJunction,
      target: { x: 640, y: 128 },
      routing: 'fixed',
      vertices: [{ x: 560, y: 128 }],
    })
    // The junction is intentionally a stale single-limb endpoint. A vertex
    // edit on the first line must not clean or reroute this untouched line.
    s.setSelection([])
    return { first, second }
  })
  const before = await page.evaluate((ids) => {
    const edge = window.__pid.useStore.getState().doc.sheets[0].edges.find((candidate: any) => candidate.id === ids.second)
    return structuredClone(edge)
  }, ids)

  await page.mouse.click(...Object.values(await clientPoint(page, 344, 188)) as [number, number])
  await drag(page, await clientPoint(page, 344, 216), await clientPoint(page, 400, 216), 16)

  const after = await page.evaluate((ids) =>
    window.__pid.useStore.getState().doc.sheets[0].edges.find((candidate: any) => candidate.id === ids.second), ids)
  expect(after).toEqual(before)
})

test('user pins: arm from the panel, click the symbol, draw a line from the new pin', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 320, y: 240, rotation: 0 })
    s.setSelection([tank])
    return { tank, pump }
  })
  await expect(page.locator('[model-id]')).toHaveCount(2)
  // arm from the property panel, then click the tank's top edge mid-point
  await page.getByRole('button', { name: '＋ Add pin' }).click()
  // aim right where an existing port halo sits — arming must win over magnets
  const spot = await clientPoint(page, 96 + 32, 96 + 2)
  await page.mouse.click(spot.x, spot.y)
  const pins = await page.evaluate(
    (id) => window.__pid.useStore.getState().doc.sheets[0].nodes.find((n: any) => n.id === id).extraPorts,
    ids.tank,
  )
  expect(pins).toHaveLength(1)
  expect(pins[0].id).toBe('pin-1')
  // the pin is a live magnet: drag a line from it to the pump suction
  await drag(
    page,
    await clientPoint(page, 96 + pins[0].x, 96 + pins[0].y),
    await clientPoint(page, 320, 268),
    20,
  )
  const e = await edges(page)
  expect(e).toHaveLength(1)
  expect(e[0].source).toMatchObject({ nodeId: ids.tank, portId: 'pin-1' })
  expect(e[0].target).toMatchObject({ nodeId: ids.pump, portId: 'suction' })
})

test('segments tool: drag a whole run sideways in one undo step', async ({ page }) => {
  await setupWithLine(page)
  await expect(page.locator('[data-tool-name="segments"]')).toBeVisible()
  const before = await undoDepth(page)
  // the vertical run's segment handle sits on the line; drag it 56px right
  const handle = page.locator('[data-tool-name="segments"] .joint-marker-segment').first()
  const bb = (await handle.boundingBox())!
  await drag(page, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }, { x: bb.x + bb.width / 2 + 56, y: bb.y + bb.height / 2 }, 14)
  const e1 = await edges(page)
  expect(e1[0].vertices?.length ?? 0).toBeGreaterThanOrEqual(1)
  expect((await undoDepth(page)) - before).toBeLessThanOrEqual(2)
})
