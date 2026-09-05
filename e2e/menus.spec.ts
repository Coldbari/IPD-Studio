import { expect, test } from '@playwright/test'

// Regression: the toolbar scrolls horizontally, and a scroll container clips
// absolutely-positioned descendants — which made the Export and account menus
// open into nothing. Note that toBeVisible() does NOT catch this on its own: a
// clipped element still reports a bounding box. The hit-test below is the part
// that actually fails when the menu is clipped.
test('the Export menu opens where you can actually click it', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)

  await page.getByRole('button', { name: /Export/ }).click()
  const pop = page.getByTestId('export-pop')
  await expect(pop).toBeVisible()

  const box = await pop.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThan(80)

  // the real check: is the menu the thing under its own centre point?
  const onTop = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="export-pop"]') as HTMLElement
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(24, r.height / 2))
    return el.contains(hit)
  })
  expect(onTop, 'the Export menu is clipped by an ancestor').toBe(true)

  await expect(pop.getByRole('menuitem', { name: /SVG image/ })).toBeVisible()

  // and it dismisses again
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
})

test('the Export menu survives the toolbar being scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)

  await page.waitForSelector('.toolbar')
  await page.evaluate(() => { document.querySelector('.tb-scroll')!.scrollLeft = 200 })
  await page.getByRole('button', { name: /Export/ }).click()
  const pop = page.getByTestId('export-pop')
  await expect(pop).toBeVisible()

  // stays pinned to its trigger rather than drifting off with the scroll
  const aligned = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="tb-export"]') as HTMLElement
    const el = document.querySelector('[data-testid="export-pop"]') as HTMLElement
    return Math.abs(btn.getBoundingClientRect().right - el.getBoundingClientRect().right) < 2
  })
  expect(aligned, 'the menu drifted away from its button').toBe(true)
})

test('the drawing screen carries the version and update note', async ({ page }) => {
  await page.goto('/app')
  await page.waitForSelector('.status')
  const chip = page.getByTestId('version-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/v\d+\.\d+\.\d+/)
  await expect(chip).toHaveAttribute('title', /active development/i)
})

test('the HMI screen carries it too', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.waitForSelector('.hmi-status')
  const chip = page.locator('.hmi-status [data-testid="version-chip"]')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/v\d+\.\d+\.\d+/)
})
