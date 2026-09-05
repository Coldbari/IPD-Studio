// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { expect, test, type Page } from '@playwright/test'

/* Port semantics: the ids the document stores stay exactly as they are, and
   everything the application SAYS about a connection uses words instead.
   Each test here checks a place where the software talks about a port. */

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

const sheet = (page: Page) =>
  page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0])

// ── the inspector ─────────────────────────────────────────────────────────

test('the inspector names a symbol’s connections, behind a closed disclosure', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const id = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 200, y: 200, rotation: 0 })
    s.setSelection([id])
  })
  await page.waitForTimeout(300)

  const ports = page.getByTestId('prop-ports')
  await expect(ports).toBeVisible()
  // Closed: eleven rows in front of the tag is not what an engineer came for.
  await expect(page.locator('.prop-ports')).toHaveCount(0)

  await ports.locator('summary').click()
  const rows = page.locator('.prop-ports li')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Suction')
  await expect(rows.nth(1)).toContainText('Discharge')
  // Free until something is connected to it.
  await expect(rows.nth(0)).toContainText('free')
})

test('an unnamed nozzle is described by where it sits, and follows a rotation', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const id = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 200, y: 120, rotation: 0 })
    s.setSelection([id])
  })
  await page.waitForTimeout(300)
  await page.getByTestId('prop-ports').locator('summary').click()

  const rows = page.locator('.prop-ports li')
  await expect(rows).toHaveCount(11)
  // Rows follow the catalogue's own order, so row 0 is the nozzle the
  // definition calls `n`. The catalogue does not say what it carries, so
  // neither does this: where it is, and nothing more.
  await expect(rows.nth(0)).toContainText('Top connection (centre)')
  await expect(page.locator('.prop-ports')).not.toContainText('Inlet')
  await expect(page.locator('.prop-ports')).not.toContainText('Outlet')

  // Turn it a quarter clockwise and that same nozzle is now on the right —
  // and the nozzle that was on the left is the one at the top.
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.rotateNode(s.selection[0])
  })
  await expect(rows.nth(0)).toContainText('Right connection (middle)')
  await expect(rows.nth(8)).toContainText('Top connection (centre)')
})

// ── refusals ──────────────────────────────────────────────────────────────

test('a refused connection names both points', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addNode({ symbolId: 'ctl.interlock', kind: 'fitting', x: 200, y: 300, rotation: 0 })
    s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 420, y: 290, rotation: 0, tag: { letters: 'TK', loop: '101' } })
    s.setSelection([])
  })
  await page.waitForTimeout(350)

  const from = await client(page, 224, 312)
  const to = await client(page, 420, 318)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  // The mark on the sheet says what happened; the status line says why, and
  // now it can say WHICH two points rather than "one" and "the other".
  await expect(page.locator('.pid-refusal')).toBeVisible()
  const status = page.getByTestId('status-message')
  await expect(status).toContainText('Interlock right connection')
  await expect(status).toContainText('TK-101 left connection')
  // and still no line left behind
  expect((await sheet(page)).edges).toHaveLength(0)
})

// ── the keyboard ──────────────────────────────────────────────────────────

test('C says which two points it joined', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    // A tank whose right nozzle sits exactly where the pump's suction is.
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 100, y: 100, rotation: 0, tag: { letters: 'TK', loop: '101' } })
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 176, y: 104, rotation: 0, tag: { letters: 'P', loop: '101' } })
    s.setSelection([pump])
    return { tank, pump }
  })
  await page.waitForTimeout(350)
  await page.locator('.canvas-host').focus()
  await page.keyboard.press('c')
  await page.waitForTimeout(250)

  const status = page.getByTestId('status-message')
  await expect(status).toContainText('P-101 suction')
  await expect(status).toContainText('TK-101')
  expect((await sheet(page)).edges.length).toBeGreaterThan(0)
})

test('a selected line is announced by where it runs', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 100, y: 100, rotation: 0, tag: { letters: 'P', loop: '101' } })
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 100, rotation: 0, tag: { letters: 'TK', loop: '101' } })
    const e = s.addEdge({ lineClass: 'process.major', source: { nodeId: pump, portId: 'discharge' }, target: { nodeId: tank, portId: 'w' } })
    s.setSelection([e])
  })
  await page.waitForTimeout(350)
  const said = page.getByTestId('canvas-announcer')
  await expect(said).toContainText('from P-101 discharge')
  await expect(said).toContainText('to TK-101 left connection')
})

test('a selected symbol is not made to recite its nozzles', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const id = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 200, y: 120, rotation: 0, tag: { letters: 'V', loop: '201' } })
    s.setSelection([id])
  })
  await page.waitForTimeout(350)
  const said = page.getByTestId('canvas-announcer')
  await expect(said).toContainText('V-201')
  // Eleven nozzles read out after "V-201" would bury the answer to the
  // question that was actually asked.
  await expect(said).not.toContainText('connection')
})

// ── QA ────────────────────────────────────────────────────────────────────

test('an incompatible connection is reported by name', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const il = s.addNode({ symbolId: 'ctl.interlock', kind: 'fitting', x: 200, y: 300, rotation: 0 })
    const tk = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 420, y: 290, rotation: 0, tag: { letters: 'TK', loop: '101' } })
    // Built directly, the way a drawing imported from elsewhere can be.
    window.__pid.useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: il, portId: 'e' },
      target: { nodeId: tk, portId: 'w' },
    })
  })
  await page.getByTestId('rail-checks').click()
  const group = page.getByTestId('rule-incompatible-connection')
  await expect(group).toBeVisible()
  // It used to say "A process.major line connects incompatible ports" — true,
  // and no help at all in finding which of them.
  await expect(group).toContainText('Interlock right connection')
  await expect(group).toContainText('TK-101 left connection')
})

// ── P3: the sheet tab, and the zoom readout ───────────────────────────────

test('a sheet tab can be renamed from the right mouse button', async ({ page }) => {
  await ready(page)
  const tab = page.locator('.sheet-tab').first()
  await tab.click({ button: 'right' })
  const menu = page.getByTestId('sheet-tab-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Rename…').click()
  const input = tab.locator('input')
  await expect(input).toBeFocused()
  await input.fill('Utilities')
  await page.keyboard.press('Enter')
  await expect(tab).toContainText('Utilities')
  // and double-click still works, because people already use it
  await tab.dblclick()
  await expect(tab.locator('input')).toBeFocused()
  await page.keyboard.press('Escape')
})

test('the zoom readout tracks the paper without a permanent timer', async ({ page }) => {
  await ready(page)
  const pct = page.getByTestId('tb-zoom-pct')
  await expect(pct).not.toHaveText('')
  await page.evaluate(() => {
    const p = window.__pid.canvasRef.paper
    p.scale(2, 2)
    p.trigger('scale')
  })
  // No waiting for a poll: the paper's own event carries it.
  await expect(pct).toHaveText('200%')
})
