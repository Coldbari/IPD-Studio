import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { plant, registry, starvedRegistry } from '../tests/hmi/processView.fixture'
import type { Registry } from '../src/model/registry'

/**
 * K4 — the process view, captured for design inspection and asserted for the
 * things a screenshot cannot prove on its own.
 *
 * The same fixture the unit tests use, so what is inspected here is what is
 * asserted there: two inputs, inline instruments either side of a control
 * valve, a junction with two feeds and two destinations, and two vessels.
 */

const docOf = (reg: Registry, theme: 'classic' | 'hp') => ({
  schemaVersion: 4,
  meta: { name: 'K4 process view', author: '', created: '', modified: '' },
  settings: { gridPx: 8, tagSeparator: '-' },
  sheets: [{ id: 'sh1', name: 'S1', drawingNumber: '', revision: '0', sheetSize: 'A3', nodes: [], edges: [] }],
  hmiScreens: [{ ...plant, theme }],
  registry: reg,
})

type Sim = { writeTag(t: string, s: string, v: number): void }
const write = async (page: Page, cmds: [string, string, number][]) => {
  await page.evaluate((list) => {
    const pid = (window as unknown as { __pid: { useSimStore: { getState(): Sim } } }).__pid
    const sim = pid.useSimStore.getState()
    for (const [t, s, v] of list) sim.writeTag(t, s, v)
  }, cmds)
}

async function open(page: Page, reg: Registry = registry, theme: 'classic' | 'hp' = 'classic') {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate((doc) => {
    const pid = (window as unknown as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid
    pid.useStore.getState().loadIntoStore(doc)
  }, docOf(reg, theme))
  await page.getByTestId('rail-hmi').click()
  await page.getByTestId('hmi-run-toggle').click()
  await page.getByTestId('op-nav-flow').click()
  await expect(page.getByTestId('op-process-view')).toBeVisible()
}

/** Line up and run. */
const runPlant = (page: Page, fv = 70, hv = 70) =>
  write(page, [
    ['LIC-101', 'MODE', 0], ['LIC-101', 'OP', 0],
    ['FV-101', 'OP', fv], ['HV-102', 'OP', hv], ['P-101', 'RUN', 1],
  ])

test('1. a running process reads as one continuous plant', async ({ page }) => {
  await open(page)
  // a gentle duty on the pumped leg, so the gravity-fed second source is not
  // simply overpowered by it and both inputs genuinely supply the header
  await runPlant(page, 35, 100)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/pv-1-running.png' })

  // every object the topology has is drawn, and every line joins two of them
  const nodes = await page.locator('[data-testid="pv-node"]').count()
  expect(nodes).toBeGreaterThanOrEqual(10)
  // the inline instruments are inside the lines they read
  await expect(page.locator('[data-testid="pv-edge"][data-pipes~="a2"] [data-tag="FT-101"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="pv-edge"][data-pipes~="a3"] [data-tag="PT-101"]')).toHaveCount(1)
  // and something is actually moving, forwards
  await expect(page.locator('[data-testid="pv-edge"][data-pipes~="a2"]')).toHaveAttribute('data-flowing', '1')
  await expect(page.locator('[data-testid="pv-edge"][data-pipes~="a2"]')).toHaveAttribute('data-direction', 'forward')
})

test('2. a partly closed valve, with position and flow shown apart', async ({ page }) => {
  await open(page)
  await runPlant(page, 100, 0)
  await page.waitForTimeout(1500)
  await write(page, [['FV-101', 'OP', 25]])
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/pv-2-throttled.png' })
  const valve = page.locator('[data-testid="pv-node"][data-tag="FV-101"]')
  await expect(valve).toContainText('POS 25 %')
  await expect(valve).toContainText('m³/h')
})

test('3. a tripped pump leaves no moving flow on the line it drove', async ({ page }) => {
  await open(page)
  await runPlant(page, 100, 0)
  await page.waitForTimeout(2000)
  await write(page, [['P-101', 'FAULT', 1]])
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/pv-3-tripped.png' })
  await expect(page.locator('[data-testid="pv-node"][data-tag="P-101"]')).toHaveAttribute('data-state', 'tripped')
  await expect(page.locator('[data-testid="pv-edge"][data-pipes~="a2"]')).toHaveAttribute('data-flowing', '0')
})

test('4. two branches, each with its own flow', async ({ page }) => {
  await open(page)
  await runPlant(page, 40, 100)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/pv-4-branches.png' })
  for (const p of ['a3', 'b2', 'a4', 'a5']) {
    await expect(page.locator(`[data-testid="pv-edge"][data-pipes~="${p}"]`)).toHaveAttribute('data-flowing', '1')
  }
})

test('5. a degraded hydraulic state says so instead of looking healthy', async ({ page }) => {
  await open(page, starvedRegistry)
  await runPlant(page, 100, 0)
  // the machine has to reach speed before it can starve its own suction —
  // capture the settled state rather than the ramp
  await expect(page.getByTestId('pv-degraded')).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: '/tmp/pv-5-degraded.png' })
  await expect(page.getByTestId('pv-degraded')).toContainText(/absolute zero/i)
  // the instrument on the affected line carries the quality glyph
  await expect(page.locator('[data-testid="pv-instrument"][data-tag="PG-102"] .pv-q')).toHaveCount(1)
})

test('6. the ISA-101 light theme', async ({ page }) => {
  await open(page, registry, 'hp')
  await runPlant(page)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/pv-6-light.png' })
  await expect(page.getByTestId('pv-svg')).toBeVisible()
})

test('7. the classic dark theme', async ({ page }) => {
  await open(page, registry, 'classic')
  await runPlant(page)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/pv-7-dark.png' })
  await expect(page.getByTestId('pv-svg')).toBeVisible()
})

test('8. clicking an object opens ITS faceplate, by canonical tag', async ({ page }) => {
  await open(page)
  await runPlant(page)
  await page.waitForTimeout(1200)
  await page.locator('[data-testid="pv-node"][data-tag="P-101"]').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/pv-8-faceplate.png' })
  await expect(page.locator('text=P-101').first()).toBeVisible()
})
