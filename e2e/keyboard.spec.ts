import { expect, test, type Page } from '@playwright/test'

/* Phase 6A: the drawing on the keyboard.
   Every test here drives the app with keys only — `page.keyboard`, never
   `page.mouse` — because a keyboard test that reaches for the pointer to set
   itself up is not testing what it claims to. */

declare global {
  interface Window { __pid: any }
}

const sel = (page: Page) => page.evaluate(() => window.__pid.useStore.getState().selection)
const nodes = (page: Page) =>
  page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes)

async function ready(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
}

/** A small plant, laid out so the reading order is unambiguous. */
async function seed(page: Page) {
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 100, y: 100, rotation: 0, label: 'TK-101' })
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 300, y: 100, rotation: 0,
      tag: { letters: 'P', loop: '101' } })
    const valve = s.addNode({ symbolId: 'cv.globe', kind: 'valve', x: 500, y: 300, rotation: 0 })
    s.setSelection([])
    return { tank, pump, valve }
  })
  await page.waitForTimeout(350)
  return ids
}

test('the canvas is one tab stop, with a name and a visible focus state', async ({ page }) => {
  await ready(page)
  const host = await page.locator('.canvas-host').evaluate((el) => ({
    tabIndex: (el as HTMLElement).tabIndex,
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label'),
    describedBy: el.getAttribute('aria-describedby'),
  }))
  expect(host.tabIndex).toBe(0)
  expect(host.role).toBe('application')
  expect(host.label).toBeTruthy()
  // the description it points at must actually exist
  expect(await page.locator(`#${host.describedBy}`).count()).toBe(1)

  await page.locator('.canvas-host').focus()
  const ring = await page.locator('.canvas-host').evaluate((el) =>
    getComputedStyle(el).outlineWidth)
  expect(ring).not.toBe('0px')
})

test('Tab walks the drawing in reading order, and Escape lets go', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)
  await page.locator('.canvas-host').focus()

  // top-left first, then across, then down — the way a P&ID is read
  await page.keyboard.press('Tab')
  expect(await sel(page)).toEqual([ids.tank])
  await page.keyboard.press('Tab')
  expect(await sel(page)).toEqual([ids.pump])
  await page.keyboard.press('Tab')
  expect(await sel(page)).toEqual([ids.valve])

  await page.keyboard.press('Shift+Tab')
  expect(await sel(page)).toEqual([ids.pump])

  // Escape clears — and then Tab is the browser's again, so this is a
  // documented way out rather than a keyboard trap
  await page.keyboard.press('Escape')
  expect(await sel(page)).toEqual([])
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.className)).not.toContain('canvas-host')
})

test('the selected object is announced, with its tag and its place in the drawing', async ({ page }) => {
  await ready(page)
  await seed(page)
  await page.locator('.canvas-host').focus()

  await page.keyboard.press('Tab')
  await expect(page.getByTestId('canvas-announcer')).toContainText('TK-101')
  await expect(page.getByTestId('canvas-announcer')).toContainText('1 of 3')

  await page.keyboard.press('Tab')
  // an engineer calls it by its tag, so the tag leads
  await expect(page.getByTestId('canvas-announcer')).toContainText('P-101')
  await expect(page.getByTestId('canvas-announcer')).toContainText('2 of 3')
})

test('one live region describes the drawing, however big it gets', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    for (let i = 0; i < 400; i++) {
      s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: (i % 20) * 80, y: Math.floor(i / 20) * 80, rotation: 0 })
    }
  })
  await page.waitForTimeout(600)
  // 400 symbols, still two accessibility nodes for the whole canvas
  expect(await page.locator('.sr-only').count()).toBe(2)
  expect(await page.locator('[aria-live]').count()).toBe(1)
})

// ── §20 Workflow 1 — operate one symbol, no mouse ────────────────────────

test('workflow: select a pump, rotate it, move it, edit a field, come back', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)
  await page.locator('.canvas-host').focus()

  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  expect(await sel(page)).toEqual([ids.pump])

  await page.keyboard.press('r')
  expect((await nodes(page)).find((n: any) => n.id === ids.pump).rotation).toBe(90)

  const before = (await nodes(page)).find((n: any) => n.id === ids.pump)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  const after = (await nodes(page)).find((n: any) => n.id === ids.pump)
  expect(after.x).toBe(before.x + 8)
  expect(after.y).toBe(before.y + 8)

  // Enter opens properties and puts the keyboard IN them
  await page.keyboard.press('Enter')
  await expect(page.locator('.props :focus')).toBeVisible()

  // change something for real
  await page.locator('.props input').first().fill('P-101 Feed Pump')
  await page.keyboard.press('Escape')

  // Escape hands the keyboard back to the drawing, selection intact
  await expect(page.locator('.canvas-host')).toBeFocused()
  expect(await sel(page)).toEqual([ids.pump])
})

// ── §20 Workflow 2 — multi-object, no mouse ──────────────────────────────

test('workflow: select all, align, duplicate, delete, undo — no mouse', async ({ page }) => {
  await ready(page)
  await seed(page)
  await page.locator('.canvas-host').focus()

  await page.keyboard.press('ControlOrMeta+a')
  expect((await sel(page)).length).toBe(3)

  // the context menu is reachable from the keyboard, and takes focus
  await page.keyboard.press('Shift+F10')
  const menu = page.getByTestId('canvas-context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.locator(':focus')).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Align left edges' }).press('Enter')
  const xs = (await nodes(page)).map((n: any) => n.x)
  expect(new Set(xs).size).toBe(1)

  // and closing it puts the keyboard back on the drawing
  await expect(page.locator('.canvas-host')).toBeFocused()

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+d')
  expect((await nodes(page)).length).toBe(6)

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  expect((await nodes(page)).length).toBe(0)

  await page.keyboard.press('ControlOrMeta+z')
  expect((await nodes(page)).length).toBe(6)
})

// ── §20 Workflow 3 — find, place, operate ────────────────────────────────

test('workflow: search a symbol, place it, and keep the keyboard on the drawing', async ({ page }) => {
  await ready(page)
  await page.getByTestId('palette-search').focus()
  await page.keyboard.type('gate valve')
  await page.keyboard.press('Enter')

  // placed, selected, AND the keyboard followed it onto the sheet — otherwise
  // the very next Delete or R would go to the search box
  expect((await nodes(page)).length).toBe(1)
  expect((await sel(page)).length).toBe(1)
  await expect(page.locator('.canvas-host')).toBeFocused()

  // so the shortcuts land on the drawing straight away
  await page.keyboard.press('r')
  expect((await nodes(page))[0].rotation).toBe(90)
})

test('Escape in the palette search returns to the drawing', async ({ page }) => {
  await ready(page)
  await page.locator('.canvas-host').focus()
  await page.getByTestId('palette-search').focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.canvas-host')).toBeFocused()
})

// ── §20 Workflow 4 — a refusal is still reachable ────────────────────────

test('a Phase 5 failure still reports, and hands focus back', async ({ page }) => {
  await ready(page)
  await seed(page)
  await page.locator('.canvas-host').focus()

  await page.evaluate(() => {
    window.__pid.notices.notify({
      kind: 'error', title: 'Something failed', body: 'For a stated reason.', hint: 'Do this.',
    })
  })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('For a stated reason.')
  await page.keyboard.press('Escape')
  // Modal restores focus to whatever had it — the drawing
  await expect(page.locator('.canvas-host')).toBeFocused()
})

// ── the pointer must be untouched ────────────────────────────────────────

test('pointer selection and keyboard selection are the same selection', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)

  // click one with the mouse
  const box = await page.locator(`[model-id="${ids.valve}"]`).boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  expect(await sel(page)).toEqual([ids.valve])

  // then continue with the keyboard from exactly there — one selection model,
  // not two that have to be kept in step
  await page.locator('.canvas-host').focus()
  await page.keyboard.press('Shift+Tab')
  expect(await sel(page)).toEqual([ids.pump])
})
