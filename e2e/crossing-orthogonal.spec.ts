import { expect, test } from '@playwright/test'

interface PidHook {
  useStore: { getState(): any }
  canvasRef: { paper?: any; graph?: any }
}
declare global {
  interface Window { __pid: PidHook }
}

test('crossing process lines jump over each other and diagonal routes are normalized', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid?.canvasRef?.paper))
  await page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    s.addBatch([], [
      {
        id: 'cross-horizontal', lineClass: 'process.major', routing: 'fixed',
        source: { x: 80, y: 200 }, target: { x: 400, y: 200 },
      },
      {
        id: 'cross-vertical', lineClass: 'process.major', routing: 'fixed',
        source: { x: 240, y: 80 }, target: { x: 240, y: 320 },
      },
      {
        id: 'legacy-diagonal', lineClass: 'process.major', routing: 'fixed',
        source: { x: 480, y: 80 }, target: { x: 640, y: 240 },
        vertices: [{ x: 560, y: 140 }],
      },
    ])
    s.setSelection([])
  })
  await page.waitForTimeout(250)

  const state = await page.evaluate(() => {
    const sheet = window.__pid.useStore.getState().doc.sheets[0]
    const points = (edge: any) => [edge.source, ...(edge.vertices ?? []), edge.target]
    const diagonal = (edge: any) => points(edge).some((point: any, index: number, all: any[]) => {
      const next = all[index + 1]
      return Boolean(next && point.x !== next.x && point.y !== next.y)
    })
    const path = (id: string) => document.querySelector(`[model-id="${id}"] [joint-selector="line"]`)?.getAttribute('d') ?? ''
    return {
      edges: sheet.edges,
      diagonal: sheet.edges.filter(diagonal).map((edge: any) => edge.id),
      horizontalPath: path('cross-horizontal'),
      verticalPath: path('cross-vertical'),
    }
  })

  expect(state.diagonal).toEqual([])
  expect(`${state.horizontalPath} ${state.verticalPath}`).toMatch(/[CQ]/)
})

