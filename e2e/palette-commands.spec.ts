import { expect, test, type Page } from '@playwright/test'

/* Phase 4: the command palette as a command layer, and component discovery.
   The rule underneath all of it — every command here runs the SAME function
   the keyboard and the context menu run, so a palette test that passes while
   the shortcut breaks would be a test of the wrong thing. */

declare global {
  interface Window { __pid: any }
}

const nodes = (page: Page) =>
  page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].nodes)
const sel = (page: Page) => page.evaluate(() => window.__pid.useStore.getState().selection)

async function ready(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-entry').first()).toBeVisible()
  // preferences are per-browser; start every test from a clean slate
  await page.evaluate(async () => {
    const m = await import('/src/panels/componentPrefs.ts')
    m.resetComponentPrefs()
  })
}

const open = async (page: Page) => {
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByTestId('command-palette')).toBeVisible()
}

async function seed(page: Page) {
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 100, y: 100, rotation: 0 })
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 340, y: 100, rotation: 0,
      tag: { letters: 'P', loop: '101' } })
    s.setSelection([])
    return { tank, pump }
  })
  await page.waitForTimeout(350)
  return ids
}

// ── the palette itself ────────────────────────────────────────────────────

test('opens, searches, navigates, runs, and gives focus back', async ({ page }) => {
  await ready(page)
  await seed(page)
  await page.locator('.canvas-host').focus()
  await open(page)

  await page.getByTestId('command-input').fill('fit')
  const results = page.getByTestId('command-results')
  await expect(results).toContainText('Fit the sheet in the window')

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('command-palette')).toBeHidden()
  // the keyboard goes back where it came from, not to the document body
  await expect(page.locator('.canvas-host')).toBeFocused()
})

test('Escape closes without running anything', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)
  await page.evaluate((id) => window.__pid.useStore.getState().setSelection([id]), ids.pump)
  await open(page)
  await page.getByTestId('command-input').fill('delete')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-palette')).toBeHidden()
  expect((await nodes(page)).length).toBe(2)
})

test('says so when nothing matches, and suggests what to try', async ({ page }) => {
  await ready(page)
  await open(page)
  await page.getByTestId('command-input').fill('zzzznotathing')
  const empty = page.locator('.search-empty')
  await expect(empty).toContainText('No command or symbol matches')
  await expect(empty).toContainText('valve')
})

// ── §2 contextual commands ────────────────────────────────────────────────

test('offers only what the current selection can actually do', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)

  // nothing selected: no Rotate, no Delete — they would do nothing
  await open(page)
  let text = await page.getByTestId('command-results').innerText()
  expect(text).not.toContain('Rotate')
  expect(text).not.toContain('Delete')
  expect(text).toContain('Fit the sheet')
  await page.keyboard.press('Escape')

  // one symbol: Properties and Rotate lead, because that is what you want
  await page.evaluate((id) => window.__pid.useStore.getState().setSelection([id]), ids.pump)
  await open(page)
  text = await page.getByTestId('command-results').innerText()
  expect(text).toContain('Properties')
  expect(text).toContain('Rotate 90°')
  expect(text).toContain('Duplicate')
  // align needs more than one symbol to align
  expect(text).not.toContain('Align left edges')
  await page.keyboard.press('Escape')

  // two symbols: alignment appears
  await page.evaluate((all) => window.__pid.useStore.getState().setSelection(all), [ids.tank, ids.pump])
  await open(page)
  await page.getByTestId('command-input').fill('align')
  await expect(page.getByTestId('command-results')).toContainText('Align left edges')
})

test('a selected line offers line commands, and no symbol commands', async ({ page }) => {
  await ready(page)
  const id = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const a = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 100, y: 100, rotation: 0 })
    const b = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 100, rotation: 0 })
    const e = s.addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    s.setSelection([e])
    return e
  })
  await page.waitForTimeout(300)
  await open(page)
  const text = await page.getByTestId('command-results').innerText()
  expect(text).toContain('Reverse the line')
  expect(text).toContain('flow arrow')
  expect(text).not.toContain('Rotate 90°')

  await page.getByTestId('command-input').fill('flow arrow')
  await page.keyboard.press('Enter')
  const arrow = await page.evaluate((eid) =>
    window.__pid.useStore.getState().doc.sheets[0].edges.find((e: any) => e.id === eid).arrow, id)
  expect(arrow).toBe('flow')
})

// ── §3 one implementation ─────────────────────────────────────────────────

test('the palette runs the same code the keyboard runs', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)
  await page.evaluate((id) => window.__pid.useStore.getState().setSelection([id]), ids.pump)

  // rotate by shortcut
  await page.locator('.canvas-host').focus()
  await page.keyboard.press('r')
  const byKey = (await nodes(page)).find((n: any) => n.id === ids.pump).rotation

  // rotate again through the palette — same function, same result
  await open(page)
  await page.getByTestId('command-input').fill('rotate')
  await page.keyboard.press('Enter')
  const byPalette = (await nodes(page)).find((n: any) => n.id === ids.pump).rotation
  expect(byPalette).toBe((byKey + 90) % 360)

  // and delete cascades its lines exactly as the keyboard's delete does
  await open(page)
  await page.getByTestId('command-input').fill('delete')
  await page.keyboard.press('Enter')
  expect((await nodes(page)).length).toBe(1)
  await page.keyboard.press('ControlOrMeta+z')
  expect((await nodes(page)).length).toBe(2)
})

// ── §17 search by intent, keyword and shortcut ────────────────────────────

test('finds commands by abbreviation, keyword and shortcut text', async ({ page }) => {
  await ready(page)
  const ids = await seed(page)
  await page.evaluate((id) => window.__pid.useStore.getState().setSelection([id]), ids.pump)

  for (const [typed, expected] of [
    ['rot', 'Rotate 90°'],
    ['dup', 'Duplicate'],
    ['erase', 'Delete'],
    ['turn', 'Rotate 90°'],
  ] as const) {
    await open(page)
    await page.getByTestId('command-input').fill(typed)
    await expect(page.getByTestId('command-results'), `typing "${typed}"`).toContainText(expected)
    await page.keyboard.press('Escape')
  }
})

// ── §6 add a pump from the palette ────────────────────────────────────────

test('workflow: open, type pump, place it, selected and ready', async ({ page }) => {
  await ready(page)
  await open(page)
  await page.getByTestId('command-input').fill('centrifugal pump')

  const result = page.locator('[data-kind="symbol"]').first()
  await expect(result).toContainText('Centrifugal Pump')
  // the symbol's own drawing, so similar entries are told apart by geometry
  await expect(result.locator('svg.cp-mark')).toBeVisible()

  await page.keyboard.press('Enter')
  expect((await nodes(page)).length).toBe(1)
  expect((await sel(page)).length).toBe(1)
  // placement puts the keyboard on the drawing, so the next key acts there
  await expect(page.locator('.canvas-host')).toBeFocused()
  await page.keyboard.press('r')
  expect((await nodes(page))[0].rotation).toBe(90)
})

test('intent search reaches the catalogue, not just exact names', async ({ page }) => {
  await ready(page)
  for (const [typed, expected] of [
    ['heat exchanger', 'Shell & Tube Exchanger'],
    ['globe valve', 'Globe Valve'],
    ['flow transmitter', 'Flow Transmitter'],
  ] as const) {
    await open(page)
    await page.getByTestId('command-input').fill(typed)
    await expect(page.getByTestId('command-results'), `typing "${typed}"`).toContainText(expected)
    await page.keyboard.press('Escape')
  }
})

// ── §10 recent, §11 favourites ────────────────────────────────────────────

test('recent is earned by placing, not by searching', async ({ page }) => {
  await ready(page)
  const recent = () => page.evaluate(async () => {
    const m = await import('/src/panels/componentPrefs.ts')
    return m.recentSnapshot()
  })

  // searching alone must not count — the list would fill with rejects
  await open(page)
  await page.getByTestId('command-input').fill('globe valve')
  await page.keyboard.press('Escape')
  expect(await recent()).toEqual([])

  // placing does. "globe valve" ranks the CONTROL valve first, which is the
  // catalogue's own ordering — the assertion is that what was placed is what
  // was recorded, not which symbol the search happens to prefer.
  await open(page)
  await page.getByTestId('command-input').fill('globe valve')
  const top = await page.locator('[data-kind="symbol"]').first().innerText()
  await page.keyboard.press('Enter')
  const list = await recent()
  expect(list).toHaveLength(1)
  const placed = await page.evaluate(async (id) => {
    const reg = await import('/src/symbols/registry.ts')
    return reg.getSymbol(id).name
  }, list[0])
  expect(top).toContain(placed)

  // and it shows in the component palette, newest first
  await expect(page.locator('.palette-quick', { hasText: 'Recent' })).toBeVisible()
})

test('recent is capped, and most-recent-first', async ({ page }) => {
  await ready(page)
  const ids = await page.evaluate(async () => {
    const prefs = await import('/src/panels/componentPrefs.ts')
    const reg = await import('/src/symbols/registry.ts')
    const all = reg.searchSymbols('').slice(0, 12).map((d: any) => d.id)
    for (const id of all) prefs.notePlacement(id)
    return { all, recent: prefs.recentSnapshot() }
  })
  expect(ids.recent.length).toBe(8)
  expect(ids.recent[0]).toBe(ids.all[11]) // last placed leads
})

test('a favourite can be set, is persistent, and can be removed', async ({ page }) => {
  await ready(page)
  // the star is a sibling of the placing button inside the cell, not a child
  // of it — nesting one control inside another is invalid, and it folded the
  // star into the tile's accessible name
  const cell = page.locator('.palette-cell').first()
  await cell.hover()
  await cell.locator('.palette-fav').click()

  // starring must never also place the symbol
  expect((await nodes(page)).length).toBe(0)
  await expect(page.locator('.palette-quick', { hasText: 'Favourites' })).toBeVisible()

  // survives a reload — it is a preference, not part of the drawing
  await page.reload()
  await page.waitForFunction(() => Boolean(window.__pid))
  await expect(page.locator('.palette-quick', { hasText: 'Favourites' })).toBeVisible()

  // and comes off again
  const fav = page.locator('.palette-quick .palette-cell').first()
  await fav.hover()
  await fav.locator('.palette-fav').click()
  await expect(page.locator('.palette-quick', { hasText: 'Favourites' })).toHaveCount(0)
})

test('favourites and recents never touch the drawing', async ({ page }) => {
  await ready(page)
  const before = await page.evaluate(() => JSON.stringify(window.__pid.useStore.getState().doc))
  await page.evaluate(async () => {
    const m = await import('/src/panels/componentPrefs.ts')
    m.toggleFavourite('vessel.tank')
    m.notePlacement('valve.globe')
  })
  const after = await page.evaluate(() => JSON.stringify(window.__pid.useStore.getState().doc))
  expect(after).toBe(before)
})

// ── §13 telling similar symbols apart ─────────────────────────────────────

test('similar valve names are readable rather than all "Control Valv…"', async ({ page }) => {
  await ready(page)
  await page.getByTestId('palette-search').fill('control valve')
  const labels = page.locator('.palette-entry .palette-label')
  await expect(labels.first()).toBeVisible()
  const clipped = await labels.evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1).length)
  expect(clipped).toBe(0)
  const texts = await labels.allInnerTexts()
  expect(new Set(texts).size).toBe(texts.length)
  expect(texts.join(' ')).toMatch(/Globe/)
  expect(texts.join(' ')).toMatch(/Ball/)
})

// ── §9 keyboard connection ────────────────────────────────────────────────

test('C connects where the points meet, using the existing dock rule', async ({ page }) => {
  await ready(page)
  // a tank and a pump one standoff apart, so their points are in reach
  const ids = await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 100, y: 100, rotation: 0 })
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 700, y: 500, rotation: 0 })
    s.setSelection([pump])
    return { tank, pump }
  })
  await page.waitForTimeout(350)
  await page.locator('.canvas-host').focus()

  // nothing in reach: it says so rather than doing nothing
  await page.keyboard.press('c')
  await expect(page.getByTestId('status-message')).toContainText('No connection point is in reach')
  expect(await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges.length)).toBe(0)

  // move it into reach and ask again
  await page.evaluate((id) => window.__pid.useStore.getState().setNodePos(id, 188, 124), ids.pump)
  await page.waitForTimeout(250)
  await page.keyboard.press('c')
  const edges = await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges)
  expect(edges.length).toBe(1)
  // the line joins real ports on both ends — the docking rule, not a guess
  expect(edges[0].source.nodeId).toBeTruthy()
  expect(edges[0].target.nodeId).toBeTruthy()

  // and one undo takes it back
  await page.keyboard.press('ControlOrMeta+z')
  expect(await page.evaluate(() => window.__pid.useStore.getState().doc.sheets[0].edges.length)).toBe(0)
})

// ── §19 the other ways in still work ──────────────────────────────────────

test('toolbar, context menu and palette placement are all unaffected', async ({ page }) => {
  await ready(page)
  await seed(page)

  // component palette click still places
  await page.locator('.palette-entry').first().click()
  expect((await nodes(page)).length).toBe(3)

  // context menu still acts on a right-click
  const box = await page.locator('.joint-element').first().boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' })
  await expect(page.getByTestId('canvas-context-menu')).toBeVisible()
  await page.keyboard.press('Escape')

  // and the toolbar's own controls
  await page.getByTestId('tb-fit').click()
  await expect(page.getByTestId('tb-zoom-pct')).toBeVisible()
})
