import { expect, test, type Page } from '@playwright/test'

/**
 * P2-B: issue gating, in a real browser, reached the way a user reaches it.
 *
 * The component tests mount the dialog directly. These start from the loaded
 * application, configure a policy the way an engineer would have to, and then
 * try to get past it — including by going around the UI entirely.
 */

type Store = { getState(): any }
async function app(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

/** Two symbols wearing one tag: a critical finding, drawn the normal way. */
async function seedCritical(page: Page) {
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    for (const x of [200, 320]) {
      const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x, y: 160, rotation: 0 })
      s.setTag(id, { letters: 'LT', loop: '101' })
    }
    s.setSelection([])
  })
}

/** Adopt a house policy that blocks open criticals at IFC. */
async function blockCriticalsAtIfc(page: Page) {
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    s.setStandard({
      ...(s.doc.standard ?? {}),
      id: 'house', name: 'House rules',
      tagFormat: { pattern: 'LL-NNNA', separator: '-', numberStart: 100, digits: 3 },
      lineNumber: { order: ['size', 'spec', 'service', 'seq'], separator: '-', sizeUnit: 'in' },
      required: { instrument: [], valve: [], equipment: [], line: [] },
      conventions: { valveFailPosition: 'optional', defaultSignal: '4-20 mA', defaultLocation: 'field', sheetSize: 'A3' },
      issuePolicy: { IFC: { blockSeverities: ['critical'], requireChecker: true } },
    })
  })
}

test('a blocked issue says why, refuses, and leaves the drawing untouched', async ({ page }) => {
  await app(page)
  await seedCritical(page)
  await blockCriticalsAtIfc(page)

  await page.getByTestId('open-revisions').click()
  await expect(page.getByTestId('revisions-dialog')).toBeVisible()
  await page.getByTestId('rev-start').click()
  await page.getByTestId('rev-status').selectOption('IFC')

  // The reason is on screen, in full, before anything is clicked.
  const blocked = page.getByTestId('rev-blocked')
  await expect(blocked).toBeVisible()
  await expect(blocked).toContainText('open critical')
  await expect(blocked).toContainText('checker is required')
  await expect(page.getByTestId('rev-issue')).toBeDisabled()

  // Nothing was issued, and no snapshot exists to clean up.
  const state = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const sh = useStore.getState().doc.sheets[0]
    return { issued: Boolean(sh.revisions[0].issuedAt), conformance: sh.revisions[0].conformance ?? null }
  })
  expect(state).toEqual({ issued: false, conformance: null })
})

test('the gate cannot be walked around by calling the store directly', async ({ page }) => {
  await app(page)
  await seedCritical(page)
  await blockCriticalsAtIfc(page)

  const result = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    const sheetId = s.doc.sheets[0].id
    const revId = s.addRevision(sheetId, { code: 'A', status: 'IFC', preparedBy: 'PN' })
    const before = useStore.getState().doc

    const res = useStore.getState().markIssued(sheetId, revId, {
      issuedAt: '2026-01-01T00:00:00.000Z',
      qaAtIssue: { critical: 0, warning: 0, info: 0, total: 0 },
    })
    const after = useStore.getState().doc
    return {
      ok: res.ok,
      blockers: res.blockers,
      identical: before === after,
      issued: Boolean(after.sheets[0].revisions[0].issuedAt),
    }
  })

  expect(result.ok).toBe(false)
  expect(result.blockers.join(' ')).toContain('open critical')
  expect(result.identical).toBe(true)
  expect(result.issued).toBe(false)
})

test('clearing the reasons lets the same revision issue, with a conformance chip', async ({ page }) => {
  await app(page)
  await seedCritical(page)
  await blockCriticalsAtIfc(page)

  // Fix the duplicate tag and name a checker — the two things the gate asked for.
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    s.setTag(s.doc.sheets[0].nodes[1].id, { letters: 'LT', loop: '102' })
  })

  await page.getByTestId('open-revisions').click()
  await page.getByTestId('rev-start').click()
  await page.getByTestId('rev-status').selectOption('IFC')
  await page.getByTestId('rev-checked').fill('RN')

  await expect(page.getByTestId('rev-blocked')).toHaveCount(0)
  await expect(page.getByTestId('rev-issue')).toBeEnabled()
  await page.getByTestId('rev-issue').click()

  await expect(page.locator('.rev-badge-issued')).toBeVisible()
  await expect(page.getByTestId('rev-conf-A')).toContainText('Conformant')

  const stored = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const rev = useStore.getState().doc.sheets[0].revisions[0]
    return {
      status: rev.conformance.status,
      policy: rev.conformance.policyApplied,
      rules: rev.conformance.rulesEvaluated > 0,
      print: typeof rev.standard.fingerprint,
    }
  })
  expect(stored.status).toBe('conformant')
  expect(stored.policy).toEqual({ blockSeverities: ['critical'], requireChecker: true })
  expect(stored.rules).toBe(true)
  expect(stored.print).toBe('string')
})
