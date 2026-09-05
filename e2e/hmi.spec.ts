import { expect, test } from '@playwright/test'
import { openTemplate, restoreIfOffered } from './helpers'

test('one click: sample P&ID becomes a running HMI', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await openTemplate(page, 'sample')
  await page.getByTestId('rail-hmi').click()
  // the doc has no screens yet -> empty-state import button
  await page.getByTestId('hmi-import-empty').click()
  const canvas = page.getByTestId('hmi-canvas')
  await expect(canvas.locator('g.hmi-widget')).not.toHaveCount(0)
  await expect(canvas.locator('polyline')).not.toHaveCount(0)
  await expect(page.getByTestId('hmi-reimport')).toBeVisible()
  await page.getByTestId('hmi-run-toggle').click()
  await page.getByTestId('hmi-speed').click()
  // something on screen changes as the sim runs (flows/levels/drifting values)
  const text = () => canvas.textContent()
  const before = await text()
  await expect.poll(text, { timeout: 20000 }).not.toBe(before)
})

test('operate a hand-built screen: start pump, watch it fill, alarm, ack', async ({ page }) => {
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
  // place tank, drag it right, then place the pump (both spawn at 320,240)
  await page.getByText('Tank', { exact: true }).dblclick()
  let p = await world(360, 280)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  p = await world(800, 300)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  await page.mouse.up()
  await page.getByText('Pump', { exact: true }).dblclick()
  // tag both via the property panel
  const setTag = async (wx: number, wy: number, tag: string) => {
    const q = await world(wx, wy)
    await page.mouse.click(q.x, q.y)
    await page.getByPlaceholder('e.g. LT-101').fill(tag)
  }
  await setTag(348, 268, 'P-1')
  await setTag(800, 320, 'TK-1')
  // pipes: source -> pump, pump -> tank
  await page.getByTestId('hmi-pipe-tool').click()
  for (const [wx, wy] of [[100, 268], [316, 268]] as const) {
    const q = await world(wx, wy)
    await page.mouse.click(q.x, q.y)
  }
  await page.keyboard.press('Enter')
  await page.getByTestId('hmi-pipe-tool').click()
  for (const [wx, wy] of [[380, 268], [790, 330]] as const) {
    const q = await world(wx, wy)
    await page.mouse.click(q.x, q.y)
  }
  await page.keyboard.press('Enter')
  // run + operate
  await page.getByTestId('hmi-run-toggle').click()
  const q = await world(348, 268)
  await page.mouse.click(q.x, q.y)
  await page.getByTestId('fp-start').click()
  const levelText = () => canvas.locator('text', { hasText: '%' }).first().textContent()
  const before = await levelText()
  await expect.poll(levelText, { timeout: 15000 }).not.toBe(before)
  await page.getByTestId('fp-close').click()
  await page.getByTestId('hmi-speed').click()
  await expect(page.getByTestId('alarm-ack')).toBeVisible({ timeout: 60000 })
  await page.getByTestId('alarm-ack-all').click()
  // the journal recorded the operator's START as a command; filter to it
  await page.getByRole('button', { name: /Journal/ }).click()
  await page.getByTestId('journal-commands').click()
  await expect(page.getByTestId('alarm-journal')).toContainText('START')
  await page.getByTestId('hmi-run-toggle').click()
})

test('marquee select, duplicate, and navigate a running plant', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  await page.getByText('Tank', { exact: true }).dblclick()
  await page.getByText('Pump', { exact: true }).dblclick()
  const canvas = page.getByTestId('hmi-canvas')
  await expect(canvas.locator('g.hmi-widget')).toHaveCount(2)
  const box = (await canvas.boundingBox())!
  const at = (wx: number, wy: number) => ({ x: box.x + (wx / 1600) * box.width, y: box.y + (wy / 1000) * box.height })
  // rubber-band from an empty corner over both widgets
  let p = at(80, 60)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  p = at(900, 700)
  await page.mouse.move(p.x, p.y, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: '2 selected' })).toBeVisible()
  // duplicate the pair from the keyboard
  await page.keyboard.press('ControlOrMeta+d')
  await expect(canvas.locator('g.hmi-widget')).toHaveCount(4)
  // second screen, then RUN plant-wide and navigate back while running
  await page.getByTitle('Add screen').click()
  await expect(page.locator('.hmi-tab.active')).toContainText('Screen 2')
  await page.getByTestId('hmi-run-toggle').click()
  await page.locator('.hmi-tab', { hasText: 'Screen 1' }).click()
  await expect(canvas.locator('g.hmi-widget')).toHaveCount(4)
  // still running: navigation did not stop the sim
  await expect(page.getByTestId('hmi-run-toggle')).toContainText('Stop')
  await expect(page.getByTestId('sim-clock')).toBeVisible()
  await page.getByTestId('hmi-run-toggle').click()
})

test('bind with the tag picker and pick-on-canvas', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  // the sample plant fills the picker with real P&ID tags
  await openTemplate(page, 'sample')
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  const canvas = page.getByTestId('hmi-canvas')
  const world = async (wx: number, wy: number) => {
    const b = (await canvas.boundingBox())!
    return { x: b.x + (wx / 1600) * b.width, y: b.y + (wy / 1000) * b.height }
  }
  // tank out of the way, tagged by typing (free text stays legal)
  await page.getByText('Tank', { exact: true }).dblclick()
  let p = await world(360, 280)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  p = await world(800, 300)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  await page.mouse.up()
  await page.getByPlaceholder('e.g. LT-101').fill('TK-9')
  await page.keyboard.press('Enter')
  // a display bound through the picker dropdown
  await page.getByText('Value display', { exact: true }).dblclick()
  p = await world(350, 255)
  await page.mouse.click(p.x, p.y)
  await page.getByTestId('prop-tag').click()
  const list = page.locator('.hmi-combo-list')
  await expect(list).toBeVisible()
  const first = list.locator('.hmi-combo-item').first()
  const picked = (await first.locator('span').first().textContent())!
  // the option commits on pointerdown (and the list closes mid-gesture), so
  // dispatch the event directly instead of a full click sequence
  await first.dispatchEvent('pointerdown')
  await expect(page.getByTestId('prop-tag')).toHaveValue(picked)
  // pick-on-canvas: arm, status hint shows, click the tank, binding lands
  await page.getByTestId('pick-bindTank').click()
  await expect(page.getByTestId('hmi-notice')).toContainText('tank')
  p = await world(800, 320)
  await page.mouse.click(p.x, p.y)
  await expect(page.getByTestId('hmi-notice')).toBeHidden()
  const bound = await page.evaluate(() => {
    const s = (window as never as { __pid: { useStore: { getState(): { doc: { hmiScreens: { widgets: { type: string; props?: Record<string, unknown> }[] }[] } } } } }).__pid
    return s.useStore.getState().doc.hmiScreens[0]!.widgets.find((w) => w.type === 'display')?.props?.bindTank
  })
  expect(bound).toBe('TK-9')
  // Esc cancels an armed pick from anywhere
  await page.getByTestId('pick-bindPipe').click()
  await expect(page.getByTestId('hmi-notice')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('hmi-notice')).toBeHidden()
})

interface PidHook {
  __pid: {
    useStore: {
      getState(): {
        doc: { hmiScreens: { widgets: { type: string; x: number; y: number; w: number; h: number; tag?: string }[]; pipes: { points: { x: number; y: number }[] }[] }[] }
      }
    }
  }
}

test('author tools: zoom, cross-screen clipboard, segment editing', async ({ page }) => {
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
  // wheel zooms at the cursor; Fit restores the whole world
  let p = await world(800, 500)
  await page.mouse.move(p.x, p.y)
  await page.mouse.wheel(0, -400)
  await expect(canvas).not.toHaveAttribute('viewBox', '0 0 1600 1000')
  await page.getByTestId('hmi-fit').click()
  await expect(canvas).toHaveAttribute('viewBox', '0 0 1600 1000')
  // tank, tagged, copied
  await page.getByText('Tank', { exact: true }).dblclick()
  p = await world(360, 290)
  await page.mouse.click(p.x, p.y)
  await page.getByTestId('prop-tag').fill('TK-7')
  p = await world(360, 290)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('ControlOrMeta+c')
  // second screen: paste lands centered at the cursor
  await page.getByTitle('Add screen').click()
  p = await world(600, 500)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.press('ControlOrMeta+v')
  const pasted = await page.evaluate(() => {
    const s = (window as unknown as PidHook).__pid.useStore.getState()
    return s.doc.hmiScreens[1]!.widgets[0]
  })
  expect(pasted).toMatchObject({ type: 'tank', tag: 'TK-7' })
  expect(Math.abs(pasted!.x + pasted!.w / 2 - 600)).toBeLessThanOrEqual(8)
  expect(Math.abs(pasted!.y + pasted!.h / 2 - 500)).toBeLessThanOrEqual(8)
  // pipe: double-click inserts a bend, segment drags sideways, dbl-click vertex removes
  // grid-aligned targets (multiples of 8) keep snap8 away from its rounding
  // boundary — the box mapping is only pixel-accurate
  await page.getByTestId('hmi-pipe-tool').click()
  for (const [wx, wy] of [[200, 696], [600, 696]] as const) {
    const q = await world(wx, wy)
    await page.mouse.click(q.x, q.y)
  }
  await page.keyboard.press('Enter')
  const points = () => page.evaluate(() => {
    const s = (window as unknown as PidHook).__pid.useStore.getState()
    return s.doc.hmiScreens[1]!.pipes[0]!.points
  })
  const y0 = (await points())[0]!.y
  expect(y0).toBe(696)
  p = await world(400, 696)
  await page.mouse.click(p.x, p.y) // select
  await page.mouse.dblclick(p.x, p.y) // insert vertex
  await expect.poll(points).toHaveLength(3)
  // drag the left run down: both its ends move together, axis-locked
  p = await world(300, 696)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  p = await world(300, 776)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  await page.mouse.up()
  let pts = await points()
  expect(pts[0]!.y).toBe(776)
  expect(pts[1]!.y).toBe(776)
  expect(pts[2]!.y).toBe(696)
  // remove the inserted vertex again
  p = await world(400, 776)
  await page.mouse.dblclick(p.x, p.y)
  await expect.poll(points).toHaveLength(2)
  pts = await points()
  expect(pts.map((q) => q.y)).toEqual([776, 696])
})

test('scenario injection: trip a pump from the Events menu', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate(() => {
    const doc = {
      schemaVersion: 4,
      meta: { name: 'Trip demo', author: '', created: '', modified: '' },
      settings: { gridPx: 8, tagSeparator: '-' },
      sheets: [{ id: 'sh1', name: 'S1', drawingNumber: '', revision: '0', sheetSize: 'A3', nodes: [], edges: [] }],
      hmiScreens: [{
        id: 'scr1', name: 'Screen 1', theme: 'classic',
        widgets: [
          { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
          { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 500, level0: 40 } },
        ],
        pipes: [
          { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
          { id: 'e2', points: [{ x: 150, y: 118 }, { x: 510, y: 100 }] },
        ],
      }],
    }
    const pid = (window as unknown as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid
    pid.useStore.getState().loadIntoStore(doc)
  })
  await page.getByTestId('rail-hmi').click()
  await page.getByTestId('hmi-run-toggle').click()
  // start the pump, let it ramp
  await page.evaluate(() => {
    const pid = (window as unknown as { __pid: { useSimStore: { getState(): { writeTag(t: string, s: string, v: number): void } } } }).__pid
    pid.useSimStore.getState().writeTag('P-1', 'RUN', 1)
  })
  const sim = () => page.evaluate(() => {
    const pid = (window as unknown as { __pid: { useSimStore: { getState(): { tags: Record<string, Record<string, number>> } } } }).__pid
    return pid.useSimStore.getState().tags
  })
  await expect.poll(async () => (await sim())['P-1']!.RAMP, { timeout: 8000 }).toBe(1)
  // trip it from the Events menu
  await page.getByTestId('hmi-events').click()
  await page.getByTestId('event-row').filter({ hasText: 'Trip P-1' }).click()
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await sim())['P-1']!.RUN, { timeout: 4000 }).toBe(0) // breaker opened
  // the faceplate shows FAULT and offers a reset
  const canvas = page.getByTestId('hmi-canvas')
  const b = (await canvas.boundingBox())!
  await page.mouse.click(b.x + (128 / 1600) * b.width, b.y + (118 / 1000) * b.height)
  await expect(page.getByTestId('faceplate')).toContainText('FAULT')
  await page.getByTestId('fp-fault-reset').click()
  await expect(page.getByTestId('faceplate')).toContainText('STOPPED')
  await page.getByTestId('fp-close').click()
  // and the journal recorded the upset
  await page.getByRole('button', { name: /Journal/ }).click()
  await expect(page.getByTestId('alarm-journal')).toContainText('TRIPPED')
  await page.getByTestId('hmi-run-toggle').click()
})

test('multi-sheet import generates a plant overview', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate(() => {
    const node = (id: string, symbolId: string, kind: string, x: number, y: number, letters?: string, loop?: string) =>
      ({ id, symbolId, kind, x, y, rotation: 0, ...(letters ? { tag: { letters, loop } } : {}) })
    const sheet = (id: string, name: string, nodes: unknown[]) =>
      ({ id, name, drawingNumber: '', revision: '0', sheetSize: 'A3', nodes, edges: [] })
    const doc = {
      schemaVersion: 4,
      meta: { name: 'Multi', author: '', created: '', modified: '' },
      settings: { gridPx: 8, tagSeparator: '-' },
      sheets: [
        sheet('sh1', 'Feed', [node('n1', 'vessel.tank', 'equipment', 100, 100, 'TK', '1'), node('n2', 'instr.bubble', 'instrument', 300, 100, 'LIC', '1')]),
        sheet('sh2', 'Storage', [node('n3', 'vessel.tank', 'equipment', 100, 100, 'TK', '9')]),
      ],
      hmiScreens: [],
    }
    const pid = (window as unknown as { __pid: { useStore: { getState(): { loadIntoStore(d: unknown): void } } } }).__pid
    pid.useStore.getState().loadIntoStore(doc)
  })
  await page.getByTestId('rail-hmi').click()
  await page.getByTestId('hmi-import-empty').click()
  // the dialog offers both sheets (checked) and the overview option
  await expect(page.getByTestId('pick-sheet')).toHaveCount(2)
  await expect(page.getByTestId('import-overview')).toBeChecked()
  await page.getByTestId('import-go').click()
  // overview + one screen per sheet; overview is active and home-starred
  await expect(page.locator('.hmi-tab')).toHaveCount(4) // 3 screens + the ＋ button
  await expect(page.locator('.hmi-tab.active')).toContainText('Plant overview')
  await expect(page.locator('.hmi-tab.active')).toContainText('★')
  const canvas = page.getByTestId('hmi-canvas')
  await expect(canvas.locator('g.hmi-widget')).not.toHaveCount(0)
  // RUN opens on the overview (it is home) with the operator header
  await page.getByTestId('hmi-run-toggle').click()
  await expect(page.getByTestId('run-title')).toContainText('Plant overview')
  await page.getByTestId('hmi-run-toggle').click()
})

test('screens: duplicate, home start, delete modal', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  await page.getByText('Tank', { exact: true }).dblclick()
  // duplicate the active screen: copy becomes active with a unique name
  await page.getByTestId('screen-dup').click()
  await expect(page.locator('.hmi-tab.active')).toContainText('Screen 1 copy')
  await expect(page.getByTestId('hmi-canvas').locator('g.hmi-widget')).toHaveCount(1)
  // make the copy the home screen, then run from Screen 1: RUN lands on home
  await page.getByTestId('screen-home').click()
  await page.locator('.hmi-tab', { hasText: /^Screen 1$/ }).click()
  await page.getByTestId('hmi-run-toggle').click()
  await expect(page.getByTestId('run-title')).toContainText('Screen 1 copy')
  await expect(page.getByTestId('run-home')).toBeDisabled()
  await page.getByTestId('hmi-run-toggle').click()
  // delete via the modal (no native confirm anymore)
  await page.locator('.hmi-tab', { hasText: 'Screen 1 copy' }).click()
  await page.locator('.hmi-tab.active .sheet-close', { hasText: '×' }).click()
  await expect(page.getByRole('dialog')).toContainText('Delete')
  await page.getByTestId('screen-delete-confirm').click()
  await expect(page.locator('.hmi-tab', { hasText: 'Screen 1 copy' })).toHaveCount(0)
})

test('alarm summary v2: shelve and out-of-service', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  await page.getByText('Tank', { exact: true }).dblclick()
  const canvas = page.getByTestId('hmi-canvas')
  const b = (await canvas.boundingBox())!
  await page.mouse.click(b.x + (360 / 1600) * b.width, b.y + (290 / 1000) * b.height)
  await page.getByTestId('prop-tag').fill('TK-1')
  await page.getByLabel('Start level %').fill('96')
  await page.getByTestId('hmi-run-toggle').click()
  await expect(page.getByTestId('alarm-ack')).toBeVisible({ timeout: 15000 })
  await page.getByTestId('alarm-summary-toggle').click()
  const summary = page.getByTestId('alarm-summary')
  await expect(summary).toContainText('HH')
  // shelve the first standing alarm: it moves into the Shelved section
  await summary.locator('.al-shelve').first().selectOption('5')
  await expect(page.getByTestId('shelved-row')).toBeVisible()
  await expect(page.getByTestId('shelved-row')).toContainText('back in')
  // take the tag out of service: remaining alarms suppress into their section
  await summary.getByRole('button', { name: 'OOS' }).first().click()
  await expect(page.getByTestId('oos-row')).toBeVisible()
  await summary.getByRole('button', { name: 'Back in service' }).click()
  await expect(page.getByTestId('oos-row')).toHaveCount(0)
  await page.getByTestId('hmi-run-toggle').click()
})

test('multi-pen trend with a time axis', async ({ page }) => {
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
  // a controller so SP gets recorded as its own series
  await page.getByText('Value display', { exact: true }).dblclick()
  let p = await world(350, 255)
  await page.mouse.click(p.x, p.y)
  await page.getByTestId('prop-tag').fill('LIC-1')
  await page.getByTestId('prop-controller').check()
  // trend on LIC-1 with the SP as pen 2
  await page.getByText('Trend', { exact: true }).dblclick()
  p = await world(370, 270)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  p = await world(700, 500)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  await page.mouse.up()
  await page.getByTestId('prop-tag').fill('LIC-1')
  await page.getByTestId('prop-pen-0').fill('LIC-1.SP')
  await page.getByTestId('hmi-run-toggle').click()
  await page.waitForTimeout(1500)
  // legend shows both pens; the time axis renders mm:ss
  await expect(canvas).toContainText('LIC-1.SP')
  await expect(canvas).toContainText('00:0')
  await page.getByTestId('hmi-run-toggle').click()
})

test('build an HMI screen by hand and keep it across reload', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('rail-hmi').click()
  await page.getByRole('button', { name: 'New screen' }).click()
  // place a tank and a pump via palette double-click
  await page.getByText('Tank', { exact: true }).dblclick()
  await page.getByText('Pump', { exact: true }).dblclick()
  const canvas = page.getByTestId('hmi-canvas')
  await expect(canvas.locator('g.hmi-widget')).toHaveCount(2)
  // draw a pipe
  await page.getByTestId('hmi-pipe-tool').click()
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.8)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8)
  await page.keyboard.press('Enter')
  await expect(canvas.locator('polyline')).not.toHaveCount(0)
  // autosave (500ms debounce) then reload; the restore question is the app's
  // own dialog now, not a browser confirm
  await page.waitForTimeout(1200)
  await page.reload()
  await restoreIfOffered(page)
  await expect(page.getByTestId('hmi-canvas')).toBeVisible()
  await expect(page.getByTestId('hmi-canvas').locator('g.hmi-widget')).toHaveCount(2)
})
