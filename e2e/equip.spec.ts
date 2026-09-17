import { expect, test } from '@playwright/test'

// The equip widget: place a Compressor preset, tag it, start it from the
// motor faceplate, and trip it from the events modal.
test('compressor: place, tag, start from faceplate, trip from events', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const world = async (wx: number, wy: number) => {
    const b = (await canvas.boundingBox())!
    return { x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height }
  }

  // place from the palette (spawns at 320,240; equip is 64x64)
  await page.getByText('Compressor', { exact: true }).dblclick()
  await expect(canvas.locator('[data-hmi-equip="comp.centrifugal"]')).toHaveCount(1)

  // dblclick places but does NOT select — click the widget, then tag it
  let q = await world(352, 272)
  await page.mouse.click(q.x, q.y)
  await page.getByPlaceholder('e.g. LT-101').fill('K-101')

  // run mode: click the equipment -> motor faceplate -> Start -> badge spins
  // (recompute coords: the alarm banner reshapes the canvas in run mode)
  await page.getByTestId('hmi-run-toggle').click()
  // RUN opens the operator workstation on its OVERVIEW page — the process
  // screen is one click away on the nav. That is the operator surface the
  // K4/K9 work introduced; this test predates it and used to land straight on
  // the drawing.
  await page.getByTestId('op-nav-process').click()
  await expect(canvas).toBeVisible()
  q = await world(352, 272)
  await page.mouse.click(q.x, q.y)
  await expect(page.getByTestId('faceplate')).toContainText('K-101')
  await page.getByTestId('fp-start').click()
  await expect(page.getByTestId('faceplate')).toContainText('RUNNING')
  await expect(canvas.locator('.hmi-spin')).toHaveCount(1)
  await page.getByTestId('fp-close').click()

  // events modal trips it; the glyph goes into fault
  await page.getByTestId('hmi-events').click()
  await page.getByTestId('event-row').filter({ hasText: 'Trip K-101' }).click()
  await expect(canvas.locator('[data-fault]')).toHaveCount(1)
})
