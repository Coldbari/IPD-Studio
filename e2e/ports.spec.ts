// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { expect, test } from '@playwright/test'

/**
 * Pulling a line out of a connection point rings the points it could legally
 * reach. JointJS does that with `markAvailable`, which walks every cell on the
 * sheet and builds two highlighter views per magnet — 40-60 ms to press a port
 * on a large drawing. The same signal now comes from a class on the paper root
 * and the port kind on each port, so the style engine does the matching.
 *
 * That is a behaviour this app now owns, so it is pinned here: a process port
 * must ring other process ports, must NOT ring signal-only ports, and must not
 * ring its own symbol's ports — a line cannot join a symbol to itself.
 */
const ringed = (sel: string) =>
  document.querySelectorAll(sel).length > 0 &&
  [...document.querySelectorAll(sel)].every((el) => {
    const s = getComputedStyle(el)
    return s.stroke !== 'none' && s.stroke !== 'rgba(0, 0, 0, 0)' && s.stroke !== 'transparent'
  })

test('a line being drawn rings the ports it could reach, and only those', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)

  await page.evaluate(() => {
    const s = (window as never as { __pid: { useStore: { getState(): any } } }).__pid.useStore.getState()
    s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 120, y: 120, rotation: 0 })   // process ports
    s.addNode({ symbolId: 'valve.globe', kind: 'valve', x: 320, y: 120, rotation: 0 })  // process ports
    s.addNode({ symbolId: 'instr.converter', kind: 'instrument', x: 120, y: 320, rotation: 0 }) // signal only
  })
  await expect(page.locator('[model-id]')).toHaveCount(3)

  const ids = await page.evaluate(() =>
    (window as never as { __pid: { useStore: { getState(): any } } }).__pid.useStore
      .getState()
      .doc.sheets[0].nodes.map((n: { id: string; symbolId: string }) => [n.symbolId, n.id]),
  )
  const idOf = (sym: string) => (ids as [string, string][]).find(([s]) => s === sym)![1]
  const gate = idOf('valve.gate')
  const globe = idOf('valve.globe')
  const conv = idOf('instr.converter')

  // Press the gate valve's outlet — a process port.
  const box = await page.locator(`[model-id="${gate}"] [port="e"] [joint-selector="portBody"]`).boundingBox()
  if (!box) throw new Error('port halo not found')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + 20)

  // the other valve's process ports are legal targets
  expect(await page.evaluate(ringed, `[model-id="${globe}"] [joint-selector="portBody"]`)).toBe(true)
  // a signal-only converter is not
  expect(await page.evaluate(ringed, `[model-id="${conv}"] [joint-selector="portBody"]`)).toBe(false)
  // nor is the symbol the line is leaving
  expect(await page.evaluate(ringed, `[model-id="${gate}"] [joint-selector="portBody"]`)).toBe(false)

  await page.mouse.up()
  // and the rings come off again
  expect(await page.evaluate(ringed, `[model-id="${globe}"] [joint-selector="portBody"]`)).toBe(false)
})
