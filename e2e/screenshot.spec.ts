import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import { openTemplate } from './helpers'

// Not a test — a design-verification harness. Run explicitly:
//   npx playwright test e2e/screenshot.spec.ts

/** Load any real .pnid through the dev store hook and capture its HMI:
 *  HMI_CAPTURE_DOC=/path/to/doc.pnid npx playwright test e2e/screenshot.spec.ts */
const USER_DOC = process.env.HMI_CAPTURE_DOC
test('capture a real user document', async ({ page }) => {
  test.skip(!USER_DOC, 'set HMI_CAPTURE_DOC to a .pnid path')
  const text = fs.readFileSync(USER_DOC!, 'utf8')
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate((t) => {
    const pid = (window as unknown as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid
    pid.useStore.getState().loadIntoStore(JSON.parse(t))
  }, text)
  await page.getByTestId('rail-hmi').click()
  // build a fresh screen from the sheet with the current importer
  await page.waitForSelector('[data-testid="hmi-import"], [data-testid="hmi-import-empty"]')
  const importBtn = page.getByTestId('hmi-import')
  if (await importBtn.count()) await importBtn.click()
  else await page.getByTestId('hmi-import-empty').click()
  // multi-sheet docs open the import dialog; take all sheets + overview
  const go = page.getByTestId('import-go')
  if (await go.isVisible().catch(() => false)) await go.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/hmi-user-edit.png' })
  await page.getByTestId('hmi-run-toggle').click()
  await page.getByTestId('hmi-speed').click()
  await page.waitForTimeout(9000) // ~45 sim-seconds at 5×
  await page.screenshot({ path: '/tmp/hmi-user-run.png' })
})
test('capture imported sample-plant HMI', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await openTemplate(page, 'sample')
  await page.getByTestId('rail-hmi').click()
  await page.getByTestId('hmi-import-empty').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/hmi-import-edit.png' })
  await page.getByTestId('hmi-run-toggle').click()
  await page.getByTestId('hmi-speed').click()
  await page.waitForTimeout(5000)
  await page.screenshot({ path: '/tmp/hmi-import-run.png' })
  const summary = page.getByTestId('alarm-summary-toggle')
  if (await summary.isVisible()) {
    await summary.click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: '/tmp/hmi-alarm-summary.png' })
  }
})

test('capture alarm summary and journal', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  await page.getByText('Tank', { exact: true }).dblclick()
  const canvas = page.getByTestId('hmi-canvas')
  const b = (await canvas.boundingBox())!
  await page.mouse.click(b.x + (360 / 1600) * b.width, b.y + (300 / 1000) * b.height)
  await page.getByPlaceholder('e.g. LT-101').fill('TK-1')
  await page.locator('label', { hasText: 'Start level %' }).locator('input').fill('96')
  await page.getByTestId('hmi-run-toggle').click()
  await page.waitForTimeout(1200) // HH at 95 trips on the first ticks
  await page.getByTestId('alarm-summary-toggle').click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/hmi-alarm-summary.png' })
  await page.getByRole('button', { name: '▾ Journal' }).click()
  await page.getByTestId('alarm-ack').click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/hmi-alarm-journal.png' })
})

test('capture new widgets on a hand-built screen', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const at = async (wx: number, wy: number) => {
    const b = (await canvas.boundingBox())!
    return { x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height }
  }
  const place = async (label: string, wx: number, wy: number) => {
    await page.getByText(label, { exact: true }).dblclick()
    // widgets spawn at 320,240: drag the fresh one into place
    let p = await at(340, 260)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    p = await at(wx, wy)
    await page.mouse.move(p.x, p.y, { steps: 4 })
    await page.mouse.up()
  }
  await place('Group panel', 600, 400)
  await place('Bar indicator', 200, 300)
  await place('Trend', 200, 550)
  await place('Screen link', 200, 750)
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/hmi-new-widgets.png' })
})

test('capture zoomed segment editing', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const world = async (wx: number, wy: number) => {
    const b = (await canvas.boundingBox())!
    return { x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height }
  }
  await page.getByText('Tank', { exact: true }).dblclick()
  await page.getByTestId('hmi-pipe-tool').click()
  for (const [wx, wy] of [[96, 600], [320, 600], [320, 368]] as const) {
    const q = await world(wx, wy)
    await page.mouse.click(q.x, q.y)
  }
  await page.keyboard.press('Enter')
  let p = await world(200, 600)
  await page.mouse.click(p.x, p.y) // select the pipe: vertices + segment diamonds
  p = await world(320, 480)
  await page.mouse.move(p.x, p.y)
  await page.mouse.wheel(0, -600)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(250)
  await page.screenshot({ path: '/tmp/hmi-zoom-segments.png' })
})

test('capture manifold flows and process events', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate(() => {
    const doc = {
      schemaVersion: 4,
      meta: { name: 'Manifold demo', author: '', created: '', modified: '' },
      settings: { gridPx: 8, tagSeparator: '-' },
      sheets: [{ id: 'sh1', name: 'S1', drawingNumber: '', revision: '0', sheetSize: 'A3', nodes: [], edges: [] }],
      hmiScreens: [{
        id: 'scr1', name: 'Header & manifold', theme: 'classic',
        widgets: [
          { id: 'p1', type: 'pump', x: 160, y: 420, w: 64, h: 64, tag: 'P-1' },
          { id: 'j1', type: 'symbol', x: 540, y: 440, w: 16, h: 16, props: { symbolId: 'fit.junction' } },
          { id: 'va', type: 'valve', x: 760, y: 240, w: 56, h: 40, tag: 'LV-A', props: { throttle: true } },
          { id: 'vb', type: 'valve', x: 760, y: 620, w: 56, h: 40, tag: 'LV-B', props: { throttle: true } },
          { id: 'ta', type: 'tank', x: 1100, y: 140, w: 120, h: 200, tag: 'TK-A', props: { level0: 30 } },
          { id: 'tb', type: 'tank', x: 1100, y: 540, w: 120, h: 200, tag: 'TK-B', props: { level0: 55 } },
          { id: 'ft', type: 'display', x: 380, y: 340, w: 112, h: 44, tag: 'FT-1', props: { bindPipe: 'e2', unit: 'm³/h', max: 12 } },
        ],
        pipes: [
          { id: 'e1', points: [{ x: 40, y: 452 }, { x: 170, y: 452 }] },
          { id: 'e2', points: [{ x: 224, y: 452 }, { x: 544, y: 452 }] },
          { id: 'e3', points: [{ x: 548, y: 444 }, { x: 548, y: 264 }, { x: 764, y: 264 }] },
          { id: 'e4', points: [{ x: 816, y: 264 }, { x: 1104, y: 264 }] },
          { id: 'e5', points: [{ x: 548, y: 456 }, { x: 548, y: 640 }, { x: 764, y: 640 }] },
          { id: 'e6', points: [{ x: 816, y: 640 }, { x: 1104, y: 640 }] },
        ],
      }],
    }
    const pid = (window as unknown as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid
    pid.useStore.getState().loadIntoStore(doc)
  })
  await page.getByTestId('rail-hmi').click()
  await page.getByTestId('hmi-run-toggle').click()
  await page.getByTestId('hmi-speed').click() // 5×
  await page.evaluate(() => {
    const pid = (window as unknown as { __pid: { useSimStore: { getState(): { writeTag(t: string, s: string, v: number): void } } } }).__pid
    const sim = pid.useSimStore.getState()
    sim.writeTag('P-1', 'RUN', 1)
    sim.writeTag('LV-A', 'OP', 50)
    sim.writeTag('LV-B', 'OP', 100)
  })
  await page.waitForTimeout(1500)
  // stick LV-A then command it further open: deviation alarm after ~5 sim-s
  await page.evaluate(() => {
    const pid = (window as unknown as { __pid: { useSimStore: { getState(): { writeTag(t: string, s: string, v: number): void } } } }).__pid
    const sim = pid.useSimStore.getState()
    sim.writeTag('LV-A', 'STUCK', 1)
    sim.writeTag('LV-A', 'OP', 90)
  })
  await page.waitForTimeout(1600)
  await page.getByTestId('hmi-events').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: '/tmp/hmi-simdepth.png' })
})

test('capture generated plant overview', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate(() => {
    const node = (id: string, symbolId: string, kind: string, x: number, y: number, letters?: string, loop?: string) =>
      ({ id, symbolId, kind, x, y, rotation: 0, ...(letters ? { tag: { letters, loop } } : {}) })
    const sheet = (id: string, name: string, nodes: unknown[]) =>
      ({ id, name, drawingNumber: '', revision: '0', sheetSize: 'A3', nodes, edges: [] })
    const doc = {
      schemaVersion: 4,
      meta: { name: 'Refinery', author: '', created: '', modified: '' },
      settings: { gridPx: 8, tagSeparator: '-' },
      sheets: [
        sheet('sh1', 'Feed section', [
          node('n1', 'vessel.tank', 'equipment', 100, 80, 'TK', '101'),
          node('n2', 'instr.bubble', 'instrument', 320, 80, 'LIC', '101'),
          node('n3', 'pump.centrifugal', 'equipment', 100, 320, 'P', '101'),
        ]),
        sheet('sh2', 'Storage', [
          node('n4', 'vessel.tank', 'equipment', 100, 80, 'TK', '201'),
          node('n5', 'vessel.tank', 'equipment', 320, 80, 'TK', '202'),
        ]),
        sheet('sh3', 'Utilities', [
          node('n6', 'pump.centrifugal', 'equipment', 100, 80, 'P', '301'),
          node('n7', 'instr.bubble', 'instrument', 320, 80, 'FT', '301'),
        ]),
      ],
      hmiScreens: [],
    }
    const pid = (window as unknown as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid
    pid.useStore.getState().loadIntoStore(doc)
  })
  await page.getByTestId('rail-hmi').click()
  await page.getByTestId('hmi-import-empty').click()
  await page.getByTestId('import-go').click()
  await page.getByTestId('hmi-run-toggle').click()
  await page.waitForTimeout(600)
  // push a tank into alarm so the Feed tile's nav wears its dot
  await page.evaluate(() => {
    const pid = (window as unknown as { __pid: { useSimStore: { getState(): { writeTag(t: string, s: string, v: number): void } } } }).__pid
    pid.useSimStore.getState().writeTag('TK-101', 'PV', 97)
  })
  await page.waitForTimeout(700)
  await page.screenshot({ path: '/tmp/hmi-overview.png' })
})

test('capture run header, home screen, nav alarm dot', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  // Screen 1: an alarming tank
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const b = (await canvas.boundingBox())!
  const at = (wx: number, wy: number) => ({ x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height })
  await page.getByText('Tank', { exact: true }).dblclick()
  await page.mouse.click(at(360, 290).x, at(360, 290).y)
  await page.getByTestId('prop-tag').fill('TK-1')
  await page.getByLabel('Start level %').fill('96')
  // Screen 2 (home): overview with a nav to Screen 1
  await page.getByTitle('Add screen').click()
  await page.getByText('Screen link', { exact: true }).dblclick()
  await page.mouse.click(at(360, 262).x, at(360, 262).y)
  await page.locator('label:has-text("Go to") select').selectOption({ label: 'Screen 1' })
  await page.getByTestId('screen-home').click()
  // run from Screen 1 — RUN must land on the home overview
  await page.locator('.hmi-tab', { hasText: /^Screen 1$/ }).click()
  await page.getByTestId('hmi-run-toggle').click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: '/tmp/hmi-screens-chrome.png' })
})

test('capture alarm summary v2 with suppression', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const world = async (wx: number, wy: number) => {
    const b = (await canvas.boundingBox())!
    return { x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height }
  }
  // tank trips H (medium) + HH (high); a low-priority display trips L (low)
  await page.getByText('Tank', { exact: true }).dblclick()
  let p = await world(360, 290)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  p = await world(900, 300)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  await page.mouse.up()
  await page.getByTestId('prop-tag').fill('TK-1')
  await page.getByLabel('Start level %').fill('96')
  await page.getByText('Value display', { exact: true }).dblclick()
  p = await world(350, 255)
  await page.mouse.click(p.x, p.y)
  await page.getByTestId('prop-tag').fill('XI-9')
  await page.getByLabel('L', { exact: true }).fill('60')
  await page.getByTestId('prop-priority').selectOption('low')
  await page.getByTestId('hmi-run-toggle').click()
  await page.waitForTimeout(1200)
  await page.getByTestId('alarm-summary-toggle').click()
  await page.locator('.al-shelve').first().selectOption('15')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/hmi-alarm-v2.png' })
})

test('capture multi-pen trend and sparkline', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const world = async (wx: number, wy: number) => {
    const b = (await canvas.boundingBox())!
    return { x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height }
  }
  const place = async (label: string, wx: number, wy: number) => {
    await page.getByText(label, { exact: true }).dblclick()
    let q = await world(350, 260)
    await page.mouse.move(q.x, q.y)
    await page.mouse.down()
    q = await world(wx, wy)
    await page.mouse.move(q.x, q.y, { steps: 4 })
    await page.mouse.up()
  }
  // level loop: tank + controller display + big trend on the pair
  await place('Tank', 300, 300)
  await page.getByTestId('prop-tag').fill('LT-1')
  await place('Value display', 640, 180)
  await page.getByTestId('prop-tag').fill('LIC-1')
  await page.getByTestId('prop-controller').check()
  await place('Value display', 640, 260)
  await page.getByTestId('prop-tag').fill('FT-1')
  await page.getByTestId('prop-spark').check()
  await place('Trend', 760, 560)
  // widen it via the panel geometry row (aiming at the SE handle is fiddly)
  const wh = page.locator('label:has-text("W / H") input')
  await wh.nth(0).fill('440')
  await wh.nth(1).fill('240')
  await page.getByTestId('prop-tag').fill('LIC-1')
  await page.getByTestId('prop-pen-0').fill('LIC-1.SP')
  await page.getByTestId('prop-pen-1').fill('LT-1.PV')
  await page.getByTestId('hmi-run-toggle').click()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: '/tmp/hmi-trend-pens.png' })
})

test('capture faceplate v2 and command journal', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const world = async (wx: number, wy: number) => {
    const b = (await canvas.boundingBox())!
    return { x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height }
  }
  // tank near-full so its faceplate shows live alarms; a controller display
  await page.getByText('Tank', { exact: true }).dblclick()
  let p = await world(360, 290)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  p = await world(800, 300)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  await page.mouse.up()
  await page.getByTestId('prop-tag').fill('TK-1')
  await page.getByLabel('Start level %').fill('96')
  await page.getByText('Value display', { exact: true }).dblclick()
  p = await world(350, 255)
  await page.mouse.click(p.x, p.y)
  await page.getByTestId('prop-tag').fill('LIC-1')
  await page.getByTestId('prop-controller').check()
  // run: tank faceplate first (bar + limit ticks + sparkline + alarm ack)
  await page.getByTestId('hmi-run-toggle').click()
  // RUN opens on the operator OVERVIEW; the process screen is a nav click away
  await page.getByTestId('op-nav-process').click()
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(1600)
  p = await world(800, 320)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/hmi-faceplate-tank.png' })
  await page.getByTestId('fp-close').click()
  // controller faceplate + journal filtered to operator commands
  p = await world(350, 255)
  await page.mouse.click(p.x, p.y)
  await page.getByTestId('fp-sp').fill('62')
  await page.getByRole('button', { name: /Journal/ }).click()
  await page.getByTestId('journal-commands').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: '/tmp/hmi-faceplate-controller.png' })
})

test('capture the tag picker and value-source rows', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await openTemplate(page, 'sample')
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  await page.getByText('Value display', { exact: true }).dblclick()
  const b = (await canvas.boundingBox())!
  await page.mouse.click(b.x + (350 / 1600) * b.width, b.y + (255 / 1000) * b.height)
  await page.getByTestId('prop-tag').click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/hmi-tag-picker.png' })
  // armed pick-on-canvas state
  await page.keyboard.press('Escape')
  await page.getByTestId('pick-bindTank').click()
  await page.waitForTimeout(150)
  await page.screenshot({ path: '/tmp/hmi-bind-pick.png' })
})
