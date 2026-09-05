import { expect, test } from '@playwright/test'
import { openTemplate } from './helpers'

/* The dead ends the UX audit found in the Draw workspace, each of which used
   to fail silently:
     - clicking a palette symbol did nothing at all
     - the symbol library could not be reached from the keyboard
     - Ctrl+A selected nothing
     - "Issues (5)" opened onto one row, with no account of the other four
     - no surface in the app listed the keyboard shortcuts
     - an empty sheet offered a project-metadata form instead of a way in   */

declare global {
  interface Window { __pid: any }
}

const nodes = (page: any) =>
  page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes.length)

test('a palette symbol places on click, and lands selected', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
  expect(await nodes(page)).toBe(0)

  await page.locator('.palette-entry').first().click()

  expect(await nodes(page)).toBe(1)
  // placed AND selected: the inspector is already on it, so the next thing
  // the user wants to do — tag it, rotate it — needs no further aiming
  const sel = await page.evaluate(() => window.__pid.useStore.getState().selection)
  expect(sel).toHaveLength(1)
  await expect(page.locator('.status')).toContainText('1 selected')
})

test('the symbol library is reachable and operable from the keyboard', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()

  // the search field is the single tab stop into the library; ↓ walks in
  await page.getByTestId('palette-search').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.palette-entry:focus')).toBeVisible()

  // Escape from a tile hands focus back to the search box rather than
  // stranding it in the grid
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-search')).toBeFocused()

  // arrows rove the grid, Enter places what is focused
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  expect(await nodes(page)).toBe(1)

  // and the keyboard follows the symbol onto the sheet, so the next Delete or
  // R acts on the drawing instead of the search box (Phase 6A)
  await expect(page.locator('.canvas-host')).toBeFocused()
})

test('the fifty-odd tiles do not flood the tab order', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
  const stops = await page.locator('.palette-entry[tabindex="0"]').count()
  expect(stops).toBe(0)
})

test('Ctrl+A selects the symbols and the lines between them', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
  await openTemplate(page, 'sample')
  await page.waitForTimeout(500)

  const expected = await page.evaluate(() => {
    const sh = window.__pid.useStore.getState().doc.sheets[0]
    return sh.nodes.length + sh.edges.length
  })
  await page.locator('.canvas-host').click({ position: { x: 30, y: 30 } })
  await page.keyboard.press('ControlOrMeta+a')

  const sel = await page.evaluate(() => window.__pid.useStore.getState().selection.length)
  expect(sel).toBe(expected)
  expect(sel).toBeGreaterThan(1)

  // and Escape puts it back, so the gesture is cheap to get wrong
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.__pid.useStore.getState().selection.length)).toBe(0)
})

test('the Issues tab counts what the Issues panel shows', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
  await openTemplate(page, 'sample')
  await page.waitForTimeout(700)

  const tab = page.getByRole('button', { name: /^Issues/ })
  await tab.click()
  await page.waitForTimeout(400)

  const label = await tab.innerText()
  const shown = await page.locator('.advisor-row').count()
  const counted = Number(/\((\d+)\)/.exec(label)?.[1] ?? '0')
  expect(counted).toBe(shown)

  // the findings this panel does not list are still accounted for
  const info = await page.evaluate(() => {
    const { qaFor } = window.__pid as any
    return qaFor ? qaFor(window.__pid.useStore.getState().doc).counts.info : null
  })
  if (info) await expect(page.locator('.drawer-aside')).toContainText('not shown here')
})

test('? opens the shortcut sheet, and it lists the bindings nothing documented', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()

  await page.keyboard.press('Shift+Slash')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()

  // R for rotate was bound since v0.3 and written down nowhere
  await expect(sheet).toContainText('Rotate the selection 90°')
  await expect(sheet.locator('kbd', { hasText: /^R$/ })).toBeVisible()
  // pointer gestures live in the same table as the keys
  await expect(sheet).toContainText('Pan the sheet')
  await expect(sheet).toContainText('Connect by touching')
  // and Select All, which is new
  await expect(sheet).toContainText('Select everything on this sheet')

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('an empty sheet offers a way in; a drawn one does not', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()

  const start = page.locator('.prop-start')
  await expect(start).toBeVisible()
  await expect(start).toContainText('Start the drawing')

  // "Find a symbol" puts the cursor where symbols are found
  await start.getByText('Find a symbol').click()
  await expect(page.getByTestId('palette-search')).toBeFocused()

  // the guidance stands down as soon as there is something to select
  await page.locator('.palette-entry').first().click()
  await expect(start).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(start).toBeHidden()
})
