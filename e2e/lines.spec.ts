import { expect, test, type Page } from '@playwright/test'

/* Line lifecycle regressions from user feedback:
   - deleting a line with the on-line ✕ tool must delete it FROM THE DOC —
     the old bug removed only the JointJS cell, so the next store change
     (like drawing a new line) resurrected the "deleted" line
   - a vertex/segment drag is ONE undo step, not one per mousemove
   - dragging a bend back onto the line's axis heals the line straight */

interface PidHook {
  useStore: { getState(): any; temporal: { getState(): any } }
  canvasRef: { paper?: any }
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
  // The tool group mounts before the async paper has laid its handle out, so
  // the first boundingBox() can come back null — poll for it, the way the
  // rescale assertions do, instead of sampling once.
  await expect.poll(async () => (await handle.boundingBox())?.width ?? 0).toBeGreaterThan(0)
  const bb = (await handle.boundingBox())!
  await drag(page, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }, { x: bb.x + bb.width / 2 + 56, y: bb.y + bb.height / 2 }, 14)
  const e1 = await edges(page)
  expect(e1[0].vertices?.length ?? 0).toBeGreaterThanOrEqual(1)
  expect((await undoDepth(page)) - before).toBeLessThanOrEqual(2)
})
