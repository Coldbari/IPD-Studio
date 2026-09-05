// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { expect, test, type Page } from '@playwright/test'

/**
 * Centre placement cascades; pointer placement does not.
 *
 * The audit found five clicks on one palette tile producing five symbols at
 * 776,552 — a document holding five objects and a drawing showing one, which
 * is a wrong instrument index made with no signal at all. These tests pin
 * both halves of the fix: successive centre placements step, and a drop still
 * lands exactly where the pointer let go.
 */

declare global {
  interface Window { __pid: any }
}

/** One cascade step, in sheet units. Mirrors CASCADE_STEP in dropHandling. */
const STEP = 24

async function ready(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
  await page.waitForTimeout(300)
}

const nodes = (page: Page) =>
  page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes
    .map((n: { symbolId: string; x: number; y: number; id: string }) =>
      ({ id: n.id, symbolId: n.symbolId, x: n.x, y: n.y })))

/** Click the first tile matching a search, n times. */
async function clickTile(page: Page, query: string, times: number) {
  await page.getByTestId('palette-search').fill(query)
  await page.waitForTimeout(250)
  for (let i = 0; i < times; i++) {
    await page.locator('.palette-entry').first().click()
    await page.waitForTimeout(200)
  }
}

test('five clicks on one tile place five symbols, each one step on', async ({ page }) => {
  await ready(page)
  await clickTile(page, 'gate valve', 5)

  const n = await nodes(page)
  expect(n).toHaveLength(5)
  // Not one pile.
  const spots = new Set(n.map((p) => `${p.x},${p.y}`))
  expect(spots.size).toBe(5)
  // A predictable diagonal, and still on the 8px grid.
  for (let i = 1; i < n.length; i++) {
    expect(n[i]!.x - n[0]!.x).toBe(i * STEP)
    expect(n[i]!.y - n[0]!.y).toBe(i * STEP)
    expect(n[i]!.x % 8).toBe(0)
    expect(n[i]!.y % 8).toBe(0)
  }

  // The last one placed is the one you are holding, and the keyboard is on
  // the drawing — Phase 6A's contract, unchanged.
  const state = await page.evaluate(() => ({
    selection: window.__pid.useStore.getState().selection,
    focus: document.activeElement?.className,
  }))
  expect(state.selection).toEqual([n[4]!.id])
  expect(state.focus).toContain('canvas-host')
})

test('the command palette cascades through the same mechanism', async ({ page }) => {
  await ready(page)
  for (const q of ['centrifugal pump', 'gate valve', 'storage tank']) {
    await page.locator('.canvas-host').focus()
    await page.keyboard.press('Meta+k')
    await page.waitForTimeout(200)
    await page.getByTestId('command-input').fill(q)
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
  }
  const n = await nodes(page)
  expect(n).toHaveLength(3)
  expect(new Set(n.map((p) => `${p.x},${p.y}`)).size).toBe(3)
  // Different symbols have different sizes, so their top-left corners differ
  // by more than the step — what must hold is that each is offset from where
  // it alone would have gone, i.e. no two share a spot and the run descends.
  expect(n[1]!.y).toBeGreaterThan(n[0]!.y)
  expect(n[2]!.y).toBeGreaterThan(n[1]!.y)
})

test('panning resets the cascade', async ({ page }) => {
  await ready(page)
  await clickTile(page, 'gate valve', 2)
  const before = await nodes(page)
  expect(before[1]!.x - before[0]!.x).toBe(STEP)

  // Move the view. The next placement is a fresh centre, not a third step.
  await page.evaluate(() => {
    const p = window.__pid.canvasRef.paper
    const t = p.translate()
    p.translate(t.tx - 320, t.ty - 160)
  })
  await page.waitForTimeout(300)
  await page.locator('.palette-entry').first().click()
  await page.waitForTimeout(300)

  const after = await nodes(page)
  expect(after).toHaveLength(3)
  // The third is at the new view's centre, so it is NOT two steps on from
  // the first — it is wherever the view now points.
  expect(after[2]!.x - before[0]!.x).not.toBe(2 * STEP)
  // and a fourth click steps off the third, not off the first
  await page.locator('.palette-entry').first().click()
  await page.waitForTimeout(300)
  const four = await nodes(page)
  expect(four[3]!.x - four[2]!.x).toBe(STEP)
  expect(four[3]!.y - four[2]!.y).toBe(STEP)
})

test('zooming resets the cascade', async ({ page }) => {
  await ready(page)
  await clickTile(page, 'gate valve', 2)
  const before = await nodes(page)
  expect(before[1]!.x - before[0]!.x).toBe(STEP)

  // Zoom about the centre: the sheet point under the middle of the window is
  // unchanged, so only the scale says the view moved. It has to be enough.
  await page.evaluate(() => window.__pid.canvasRef.paper.scale(1.5, 1.5))
  await page.waitForTimeout(300)
  await page.locator('.palette-entry').first().click()
  await page.waitForTimeout(300)
  await page.locator('.palette-entry').first().click()
  await page.waitForTimeout(300)

  const after = await nodes(page)
  expect(after).toHaveLength(4)
  // The third placement restarted the cascade; the fourth is one step on.
  expect(after[3]!.x - after[2]!.x).toBe(STEP)
  expect(after[2]!.x - before[1]!.x).not.toBe(STEP)
})

/** Drop a palette symbol on the canvas at a SHEET point, the way the browser
 *  does it: a real DragEvent carrying the palette's MIME payload. Same shape
 *  as autoconnect.spec.ts's helper, so both specs exercise one path. */
async function dropSymbol(page: Page, symbolId: string, at: { x: number; y: number }) {
  const client = await page.evaluate(([x, y]) => {
    const p = window.__pid.canvasRef.paper.localToClientPoint({ x, y })
    return { x: p.x, y: p.y }
  }, [at.x, at.y])
  await page.evaluate(
    ([id, cx, cy]) => {
      const dt = new DataTransfer()
      dt.setData('application/x-pid-symbol', JSON.stringify({ symbolId: id }))
      const host = document.querySelector('[data-testid="canvas"]')!
      host.dispatchEvent(new DragEvent('drop', {
        dataTransfer: dt, clientX: cx as number, clientY: cy as number, bubbles: true, cancelable: true,
      }))
    },
    [symbolId, client.x, client.y] as [string, number, number],
  )
  await page.waitForTimeout(300)
}

test('REGRESSION: a drop still lands where the pointer let go', async ({ page }) => {
  await ready(page)
  // Prime the cascade with two centre placements first. If it had leaked into
  // the pointer path, the drop would come out 48px off.
  await clickTile(page, 'gate valve', 2)
  const primed = await nodes(page)
  expect(primed[1]!.x - primed[0]!.x).toBe(STEP)

  // A gate valve is 32x16, so a drop centred on a sheet point puts its corner
  // half the symbol up and to the left, snapped to the grid — the arithmetic
  // placedNode has always done. Allowed to be one grid square out, because
  // the client/local round trip carries sub-pixel error; a cascade step would
  // be three squares and could not hide inside that.
  const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(8)

  await dropSymbol(page, 'valve.gate', { x: 600, y: 408 })
  const after = await nodes(page)
  expect(after).toHaveLength(3)
  near(after[2]!.x, 584)
  near(after[2]!.y, 400)

  // A second drop, well clear of the first, lands at ITS pointer — not one
  // cascade step on from the drop before it.
  //
  // (Dropping on top of the first valve instead would move the new one, but
  // that is magnetic docking doing its job — 32px of valve plus a 24px
  // standoff — and autoconnect.spec.ts owns that behaviour. Here the point is
  // only that centre-placement state never reaches the pointer path.)
  await dropSymbol(page, 'valve.gate', { x: 600, y: 704 })
  const twice = await nodes(page)
  expect(twice).toHaveLength(4)
  near(twice[3]!.x, 584)
  near(twice[3]!.y, 696)
  // and emphatically not offset from the drop before it
  expect(twice[3]!.x - twice[2]!.x).not.toBe(STEP)
})
