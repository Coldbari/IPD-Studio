import { test, expect } from '@playwright/test'

test('zoom control keeps fixed button widths on a narrow toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 720 })
  await page.goto('/app')
  const zoom = page.locator('.tb-zoom')
  const fit = page.getByTestId('tb-fit')
  const box = await zoom.boundingBox()
  const fitBox = await fit.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(132)
  expect(fitBox?.width ?? 0).toBeGreaterThanOrEqual(50)
  await expect(fit).toBeVisible()
})
