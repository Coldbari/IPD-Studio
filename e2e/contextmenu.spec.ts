import { expect, test, type Page } from '@playwright/test'

/* Right-click was dead everywhere in the app. The menu that replaced that has
   two jobs: run the action, and teach the key that runs it. Both are asserted
   here, along with the rule that it acts on what you right-clicked. */

declare global {
  interface Window { __pid: any }
}

const menu = (page: Page) => page.getByTestId('canvas-context-menu')

async function ready(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
}

/** Three symbols, unselected, at known sheet positions. */
async function seed(page: Page) {
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 300, y: 200, rotation: 0 })
    const c = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 500, y: 320, rotation: 0 })
    s.setSelection([])
    return { a, b, c }
  })
  await expect(page.locator('[model-id]')).toHaveCount(3)
  return ids
}

async function client(page: Page, x: number, y: number) {
  return page.evaluate(([lx, ly]) => {
    const p = window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly })
    return { x: p.x, y: p.y }
  }, [x, y])
}

test('right-clicking blank paper offers what you can do to the sheet', async ({ page }) => {
  await ready(page)
  await seed(page)
  await page.locator('.canvas-host').click({ button: 'right', position: { x: 25, y: 25 } })

  await expect(menu(page)).toBeVisible()
  await expect(menu(page)).toContainText('Add a symbol')
  await expect(menu(page)).toContainText('Select all')
  // nothing has been copied yet, so Paste is offered and refused, not hidden
  await expect(menu(page).getByRole('menuitem', { name: /Paste/ })).toBeDisabled()

  await menu(page).getByRole('menuitem', { name: /Select all/ }).click()
  const sel = await page.evaluate(() => window.__pid.useStore.getState().selection.length)
  expect(sel).toBe(3)
})

test('right-clicking a symbol selects it first, then acts on it', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)

  // right-click the SECOND tank while nothing is selected
  const at = await client(page, 332, 228)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu(page)).toBeVisible()
  expect(await page.evaluate(() => window.__pid.useStore.getState().selection)).toEqual([ids.b])

  // the menu prints the key that does the same thing — this is where the
  // seven undocumented bindings get learned
  await expect(menu(page).getByRole('menuitem', { name: /Rotate 90°/ })).toContainText('R')

  await menu(page).getByRole('menuitem', { name: /Rotate 90°/ }).click()
  await expect(menu(page)).toBeHidden()
  const rot = await page.evaluate((id) => {
    const n = window.__pid.useStore.getState().doc.sheets[0].nodes.find((n: any) => n.id === id)
    return n.rotation
  }, ids.b)
  expect(rot).toBe(90)
})

test('a single symbol can be deleted from the menu, and undone', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)
  const at = await client(page, 332, 228)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await menu(page).getByRole('menuitem', { name: /^Delete\b/ }).click()

  expect(await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes.length)).toBe(2)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes.length)).toBe(3)
  expect(await page.evaluate((id) =>
    window.__pid.useStore.getState().doc.sheets[0].nodes.some((n: any) => n.id === id), ids.b)).toBe(true)
})

test('a multi-selection gets alignment, and keeps the whole selection', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)
  await page.evaluate((all) => window.__pid.useStore.getState().setSelection(all), [ids.a, ids.b, ids.c])

  // right-clicking one of several does NOT collapse the selection to it
  const at = await client(page, 332, 228)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu(page)).toBeVisible()
  expect(await page.evaluate(() => window.__pid.useStore.getState().selection.length)).toBe(3)

  await menu(page).getByRole('menuitem', { name: 'Align left edges' }).click()
  const xs = await page.evaluate(() =>
    window.__pid.useStore.getState().doc.sheets[0].nodes.map((n: any) => n.x))
  expect(new Set(xs).size).toBe(1)
})

test('right-clicking a line offers line actions', async ({ page }) => {
  await ready(page)
  const id = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 96, rotation: 0 })
    const e = s.addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    s.setSelection([])
    return e
  })
  await page.waitForTimeout(300)
  await page.evaluate((eid) => window.__pid.useStore.getState().setSelection([eid]), id)

  const mid = await page.evaluate((eid) => {
    const paper = window.__pid.canvasRef.paper
    const view = paper.findViewByModel(paper.model.getCell(eid))
    const p = view.getConnection().pointAt(0.5)
    const c = paper.localToClientPoint(p)
    return { x: c.x, y: c.y }
  }, id)
  await page.mouse.click(mid.x, mid.y, { button: 'right' })
  await expect(menu(page)).toBeVisible()
  await expect(menu(page)).toContainText('Reverse the direction')
  await expect(menu(page)).toContainText('flow arrow')

  await menu(page).getByRole('menuitem', { name: /Add a flow arrow/ }).click()
  const arrow = await page.evaluate((eid) =>
    window.__pid.useStore.getState().doc.sheets[0].edges.find((e: any) => e.id === eid).arrow, id)
  expect(arrow).toBe('flow')
})

test('Escape closes the menu without acting', async ({ page }) => {
  await ready(page)
  await seed(page)
  await page.locator('.canvas-host').click({ button: 'right', position: { x: 25, y: 25 } })
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  expect(await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes.length)).toBe(3)
})

test('the native browser menu never appears over the canvas', async ({ page }) => {
  await ready(page)
  await seed(page)
  await page.evaluate(() => {
    ;(window as any).__ctx = null
    window.addEventListener('contextmenu', (e) => { (window as any).__ctx = e.defaultPrevented }, true)
    // capture phase fires before JointJS's handler, so read it afterwards
    window.addEventListener('contextmenu', (e) => { (window as any).__ctx = e.defaultPrevented })
  })
  await page.locator('.canvas-host').click({ button: 'right', position: { x: 25, y: 25 } })
  await expect(menu(page)).toBeVisible()
  expect(await page.evaluate(() => (window as any).__ctx)).toBe(true)
})
