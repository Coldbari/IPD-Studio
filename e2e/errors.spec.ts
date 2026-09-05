import { expect, test, type Page } from '@playwright/test'

/* Phase 5: what the application says when an engineering action cannot be
   completed. The rule under all of it — say what happened, why when the app
   actually knows why, and what to do next — and never leave the engineer
   wondering whether the software ignored them. */

declare global {
  interface Window { __pid: any }
}

async function ready(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
}

const client = (page: Page, x: number, y: number) =>
  page.evaluate(([lx, ly]) => {
    const p = window.__pid.canvasRef.paper.localToClientPoint({ x: lx, y: ly })
    return { x: p.x, y: p.y }
  }, [x, y])

const edges = (page: Page) =>
  page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges)

// ── connections ───────────────────────────────────────────────────────────

/** An interlock (signal-only ports) beside a tank (process-only ports). */
async function seedIncompatible(page: Page) {
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addNode({ symbolId: 'ctl.interlock', kind: 'fitting', x: 200, y: 300, rotation: 0 })
    s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 420, y: 290, rotation: 0 })
    s.setSelection([])
  })
  await page.waitForTimeout(350)
}

test('a refused connection says so, and leaves nothing behind', async ({ page }) => {
  await ready(page)
  await seedIncompatible(page)

  // interlock 'e' (signal) at sheet (224,312) → tank 'w' (process) at (420,318)
  const from = await client(page, 224, 312)
  const to = await client(page, 420, 318)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  // It used to leave a free-ended line pointing AT the nozzle that rejected
  // it: silent, and at a glance indistinguishable from a real connection.
  expect(await edges(page)).toHaveLength(0)

  // and it says why, at the point on the drawing the user was looking at
  const mark = page.locator('.pid-refusal')
  await expect(mark).toBeVisible()
  await expect(mark.locator('text')).toContainText('cannot be joined')
})

test('a legal connection is unaffected', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 420, y: 96, rotation: 0 })
    s.setSelection([])
  })
  await page.waitForTimeout(350)
  // tank 'e' at (160,124) → tank 'w' at (420,124)
  const from = await client(page, 160, 124)
  const to = await client(page, 420, 124)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  expect(await edges(page)).toHaveLength(1)
  await expect(page.locator('.pid-refusal')).toHaveCount(0)
})

test('a deliberate free end is still allowed', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    s.setSelection([])
  })
  await page.waitForTimeout(350)
  // out into open paper — a vent or an off-page run, nowhere near a port
  const from = await client(page, 160, 124)
  const to = await client(page, 600, 400)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  expect(await edges(page)).toHaveLength(1)
  await expect(page.locator('.pid-refusal')).toHaveCount(0)
})

// ── files ─────────────────────────────────────────────────────────────────

/** Drop a file on the canvas the way a user would. */
async function dropFile(page: Page, name: string, body: string) {
  const box = await page.locator('.canvas-host').boundingBox()
  await page.evaluate(async ({ name, body, box }) => {
    const dt = new DataTransfer()
    dt.items.add(new File([body], name, { type: 'application/json' }))
    const host = document.querySelector('.canvas-host')!
    host.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: box!.x + 50, clientY: box!.y + 50,
    }))
  }, { name, body, box })
  await page.waitForTimeout(500)
}

test('a corrupt drawing file is distinguished from one that is not a drawing', async ({ page }) => {
  await ready(page)

  await dropFile(page, 'broken.pnid', '{"schemaVersion": 5, "sheets": [')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('broken.pnid')
  await expect(dialog).toContainText('not valid JSON')
  // the raw parser complaint is evidence, not the explanation
  await expect(dialog.locator('summary', { hasText: 'Details' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await dropFile(page, 'settings.json', '{"schemaVersion": 5, "sheets": []}')
  await expect(page.getByRole('dialog')).toContainText('is not an IPD Studio drawing')
  await expect(page.getByRole('dialog')).toContainText('no sheets')
})

test('a failed open leaves the drawing that is already open alone', async ({ page }) => {
  await ready(page)
  await page.locator('.palette-entry').first().click()
  const before = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes.length)
  expect(before).toBe(1)

  await dropFile(page, 'broken.pnid', 'not json at all')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  expect(await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes.length)).toBe(before)
})

// ── QA acceptance ─────────────────────────────────────────────────────────

async function openFirstAccept(page: Page) {
  await page.getByTestId('rail-checks').click()
  await page.waitForSelector('.ws-issue-ignore')
  await page.locator('.ws-issue-ignore').first().click()
}

test('accepting a finding needs a reason, and shows what is being accepted', async ({ page }) => {
  await ready(page)
  // the sample plant has findings to accept
  await page.getByTestId('tb-file').click()
  await page.getByTestId('tpl-sample').click()
  await page.waitForTimeout(700)
  await openFirstAccept(page)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // the finding stays readable the whole time the reason is being written
  await expect(page.getByTestId('accept-finding-context')).toBeVisible()

  // an empty reason cannot be submitted — it is the acceptance the next
  // reviewer cannot evaluate
  await expect(page.getByTestId('accept-go')).toBeDisabled()
  await page.getByTestId('accept-reason').fill('   ')
  await expect(page.getByTestId('accept-go')).toBeDisabled()

  await page.getByTestId('accept-reason').fill('Relief provided by PSV-104 on the common header.')
  await expect(page.getByTestId('accept-go')).toBeEnabled()
  await page.getByTestId('accept-go').click()

  const ignored = await page.evaluate(() => window.__pid.useStore.getState().doc.qa?.ignored ?? {})
  const reasons = Object.values(ignored).map((v: any) => v.reason)
  expect(reasons.join(' ')).toContain('PSV-104')
})

test('cancelling an acceptance records nothing', async ({ page }) => {
  await ready(page)
  await page.getByTestId('tb-file').click()
  await page.getByTestId('tpl-sample').click()
  await page.waitForTimeout(700)
  await openFirstAccept(page)

  await page.getByTestId('accept-reason').fill('changed my mind')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  const ignored = await page.evaluate(() => window.__pid.useStore.getState().doc.qa?.ignored ?? {})
  expect(Object.keys(ignored)).toHaveLength(0)
})

// ── exports ───────────────────────────────────────────────────────────────

test('a failed export says the drawing is fine, and offers a retry', async ({ page }) => {
  await ready(page)
  await page.locator('.palette-entry').first().click()

  // Fail something the SVG export actually uses. createObjectURL genuinely
  // throws in sandboxed and memory-pressured contexts, so this is the shape a
  // real export failure arrives in rather than an invented one.
  await page.evaluate(() => {
    ;(window as any).__realCreateURL = URL.createObjectURL
    URL.createObjectURL = () => { throw new Error('simulated: could not allocate a blob URL') }
  })

  await page.getByTestId('tb-export').click()
  await page.getByRole('menuitem', { name: 'SVG image' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('could not be exported')
  // the fear a failing export creates is "did I just lose my drawing"
  await expect(dialog).toContainText('open and unchanged')
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()

  // and the drawing really is intact
  expect(await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes.length)).toBe(1)

  await page.evaluate(() => {
    URL.createObjectURL = (window as any).__realCreateURL
  })
})

// ── the dialog itself ─────────────────────────────────────────────────────

test('an error dialog traps focus, closes on Escape, and gives focus back', async ({ page }) => {
  await ready(page)
  const opener = page.getByTestId('tb-export')
  await opener.click()
  await page.keyboard.press('Escape')
  await opener.focus()

  await page.evaluate(() => {
    const { notify } = (window as any).__pid.notices
    notify({ kind: 'error', title: 'Something specific failed', body: 'Because of a specific reason.', hint: 'Do this next.' })
  })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Because of a specific reason.')
  await expect(dialog).toContainText('Do this next.')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})

test('the status line reports a caveat without taking the keyboard', async ({ page }) => {
  await ready(page)
  const search = page.getByTestId('palette-search')
  await search.focus()
  await page.evaluate(() => {
    ;(window as any).__pid.notices.showStatus('Underlay loaded — 2 entity types could not be drawn.', { kind: 'warning' })
  })
  await expect(page.getByTestId('status-message')).toContainText('could not be drawn')
  // level 3 of the ladder: it must not interrupt what the user is doing
  await expect(search).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
