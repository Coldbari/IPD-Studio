import { expect, test, type Page } from '@playwright/test'

/* Magnetic docking — connect by touching, not by drawing:
   - drop a palette symbol onto an existing symbol's connection point and it
     clicks into place already connected
   - drag a symbol already on the sheet the same way: the line is drawn the
     moment the points meet, WITHOUT releasing the mouse, and keeping the drag
     going stretches the pipe
   - the symbol stands off from the point it landed on, so the pipe is visible
     instead of hidden behind two touching symbols
   - shaking the symbol mid-drag cuts the line that drag just made */

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

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 16) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

/** Waggle the pointer where it is — the "no, not there" gesture. */
async function shakePointer(page: Page, at: { x: number; y: number }) {
  for (let i = 0; i < 6; i++) await page.mouse.move(at.x + (i % 2 ? -45 : 45), at.y)
}

/** Tuple form of clientPoint, to spread straight into page.mouse.move(). */
async function point(page: Page, x: number, y: number): Promise<[number, number]> {
  const p = await clientPoint(page, x, y)
  return [p.x, p.y]
}

const sheet = (page: Page) => page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0])
const undoDepth = (page: Page) =>
  page.evaluate(() => window.__pid.useStore.temporal.getState().pastStates.length)

/** Drop a palette symbol on the canvas at a sheet point, the way the browser
 *  does it: a real DragEvent carrying the palette's MIME payload. */
async function dropSymbol(page: Page, symbolId: string, at: { x: number; y: number }) {
  const client = await clientPoint(page, at.x, at.y)
  await page.evaluate(
    ([id, cx, cy]) => {
      const dt = new DataTransfer()
      dt.setData('application/x-pid-symbol', JSON.stringify({ symbolId: id }))
      const host = document.querySelector('[data-testid="canvas"]')!
      host.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, clientX: cx as number, clientY: cy as number, bubbles: true, cancelable: true }),
      )
    },
    [symbolId, client.x, client.y] as [string, number, number],
  )
}

/** A single gate valve at (200,200): 32x16, port w at (200,208), e at (232,208). */
async function withGateValve(page: Page): Promise<string> {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))
  const id = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const id = s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 200, y: 200, rotation: 0 })
    s.setSelection([])
    return id as string
  })
  await expect(page.locator('[model-id]')).toHaveCount(1)
  return id
}

test('dropping a palette symbol on a connection point docks and connects it', async ({ page }) => {
  const gate = await withGateValve(page)

  // Aim so the dropped valve's own w port lands 8px off the fixed valve's e
  // port: centred on (254,210) it is placed at (240,200), w at (240,208).
  await dropSymbol(page, 'valve.gate', { x: 254, y: 210 })

  await expect.poll(async () => (await sheet(page)).nodes.length).toBe(2)
  const after = await sheet(page)
  const dropped = after.nodes.find((n: any) => n.id !== gate)

  // pulled into line with the nozzle and stood off by 24px, so the pipe shows
  expect({ x: dropped.x, y: dropped.y }).toEqual({ x: 256, y: 200 })
  expect(after.edges).toHaveLength(1)
  expect(after.edges[0].source).toEqual({ nodeId: dropped.id, portId: 'w' })
  expect(after.edges[0].target).toEqual({ nodeId: gate, portId: 'e' })
  expect(after.edges[0].lineClass).toBe('process.major')

  // symbol + line arrived together, so one undo takes both back
  await page.evaluate(() => window.__pid.useStore.getState().undo())
  const undone = await sheet(page)
  expect(undone.nodes).toHaveLength(1)
  expect(undone.edges).toHaveLength(0)
})

test('a symbol dropped clear of every connection point just lands there', async ({ page }) => {
  await withGateValve(page)
  await dropSymbol(page, 'valve.gate', { x: 500, y: 500 })
  await expect.poll(async () => (await sheet(page)).nodes.length).toBe(2)
  expect((await sheet(page)).edges).toHaveLength(0)
})

test('a drag connects the moment the points meet, and goes on stretching the pipe', async ({ page }) => {
  const gate = await withGateValve(page)
  const moving = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const id = s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 400, y: 300, rotation: 0 })
    s.setSelection([])
    return id as string
  })
  await expect(page.locator('[model-id]')).toHaveCount(2)
  const before = await undoDepth(page)

  // Grab the moving valve by its centre and bring its w port up to the fixed
  // valve's e port at (232,208) — WITHOUT releasing the button.
  await page.mouse.move(...(await point(page, 416, 308)))
  await page.mouse.down()
  await page.mouse.move(...(await point(page, 254, 208)), { steps: 16 })

  // connected already, mid-drag, with the button still down
  await expect.poll(async () => (await sheet(page)).edges.length).toBe(1)
  const caught = await sheet(page)
  expect(caught.edges[0].source).toEqual({ nodeId: moving, portId: 'w' })
  expect(caught.edges[0].target).toEqual({ nodeId: gate, portId: 'e' })
  // stood off, so there is a visible pipe rather than two symbols touching
  expect(caught.nodes.find((n: any) => n.id === moving)).toMatchObject({ x: 256, y: 200 })

  const edgeId = caught.edges[0].id
  const length = () =>
    page.evaluate((id) => {
      const paper = window.__pid.canvasRef.paper!
      const view = paper.model.getCell(id).findView(paper)
      return view.getConnectionLength() as number
    }, edgeId)
  // a real, visible run of pipe — not two symbols touching with nothing drawn
  await expect.poll(length).toBeGreaterThan(10)
  await expect.poll(length).toBeLessThan(32)

  // keep dragging — still no mouse-up — and the pipe stretches to follow
  await page.mouse.move(...(await point(page, 654, 208)), { steps: 16 })
  await expect.poll(length).toBeGreaterThan(300)
  await page.mouse.up()

  const moved = await sheet(page)
  expect(moved.edges).toHaveLength(1)
  expect(moved.edges[0].source).toEqual({ nodeId: moving, portId: 'w' })
  expect(moved.nodes.find((n: any) => n.id === moving).x).toBeGreaterThan(600)
  // catch and carry are one gesture, so they are one undo step
  expect(await undoDepth(page)).toBe(before + 1)
  await page.evaluate(() => window.__pid.useStore.getState().undo())
  const undone = await sheet(page)
  expect(undone.edges).toHaveLength(0)
  expect(undone.nodes.find((n: any) => n.id === moving)).toMatchObject({ x: 400, y: 300 })
})

test('re-clicking a reserved line end keeps its pending device tag', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const v = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 400, y: 300, rotation: 0 })
    s.setTag(v, { letters: 'V', loop: '01' })
    s.addEdge({ lineClass: 'process.major', source: { nodeId: v, portId: 'w1' }, target: { x: 260, y: 308, pendingTag: 'X07' } })
    s.setSelection([])
  })
  // vessel + its reserved line, both rendered
  await expect(page.locator('[model-id]')).toHaveCount(2)

  // Click the free end — the gesture that re-selects the line. The endpoint
  // re-attach used to rewrite the end as a bare point and drop the tag.
  await page.mouse.click(...(await point(page, 260, 308)))

  const target = (await sheet(page)).edges[0].target as { nodeId?: string; pendingTag?: string }
  expect(target.nodeId).toBeUndefined()
  expect(target.pendingTag).toBe('X07')
})

test('shaking the symbol mid-drag cuts the line that drag just made', async ({ page }) => {
  await withGateValve(page)
  const moving = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const id = s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 400, y: 300, rotation: 0 })
    s.setSelection([])
    return id as string
  })
  await expect(page.locator('[model-id]')).toHaveCount(2)

  await page.mouse.move(...(await point(page, 416, 308)))
  await page.mouse.down()
  await page.mouse.move(...(await point(page, 254, 208)), { steps: 16 })
  await expect.poll(async () => (await sheet(page)).edges.length).toBe(1)

  // wrong point — waggle it off without ever letting go
  const here = await clientPoint(page, 254, 208)
  await shakePointer(page, here)
  await expect.poll(async () => (await sheet(page)).edges.length).toBe(0)

  // and it does not snap straight back onto the point just rejected, nor
  // does letting go sneak the connection back on
  await page.mouse.move(...(await point(page, 254, 208)), { steps: 6 })
  expect((await sheet(page)).edges).toHaveLength(0)
  await page.mouse.up()
  expect((await sheet(page)).edges).toHaveLength(0)

  // one undo still takes the whole gesture back
  await page.evaluate(() => window.__pid.useStore.getState().undo())
  expect((await sheet(page)).nodes.find((n: any) => n.id === moving)).toMatchObject({ x: 400, y: 300 })
})
