import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { applyFix, describeFix } from '../../src/assist/fixes'
import { qaFor, resetQaCache } from '../../src/validate/engine'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

const st = () => useStore.getState()
const edges = () => st().doc.sheets[0]!.edges

/** Two lines between the very same pair of ports — the doubled-line case. */
function drawDoubledLine() {
  const a = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 })
  const b = st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 300, y: 0, rotation: 0 })
  const first = st().addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
  const second = st().addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
  return { first, second }
}

beforeEach(() => {
  st().loadIntoStore(createEmptyDoc('dupline'))
  resetQaCache()
})

describe('the doubled-line fix', () => {
  it('is offered by the rule that flags it', () => {
    drawDoubledLine()
    const group = qaFor(st().doc).groups.find((g) => g.rule.id === 'duplicate-parallel-line')
    expect(group?.findings).toHaveLength(1)
    expect(group?.findings[0]?.fix?.spec).toMatchObject({ kind: 'delete-duplicate-line' })
  })

  it('names its blast radius before running, and says the other line survives', () => {
    drawDoubledLine()
    const spec = qaFor(st().doc).groups
      .find((g) => g.rule.id === 'duplicate-parallel-line')!.findings[0]!.fix!.spec
    const d = describeFix(spec, st().doc)
    expect(d.title).toMatch(/doubled line/i)
    expect(d.blastRadius).toMatch(/The other stays/)
  })

  it('deletes exactly the flagged line and leaves the original', () => {
    const { first, second } = drawDoubledLine()
    expect(edges()).toHaveLength(2)

    const spec = qaFor(st().doc).groups
      .find((g) => g.rule.id === 'duplicate-parallel-line')!.findings[0]!.fix!.spec
    const result = applyFix(spec)

    expect(result.ok).toBe(true)
    expect(result.changedIds).toEqual([second])
    expect(edges().map((e) => e.id)).toEqual([first])

    // and the advice clears
    resetQaCache()
    expect(qaFor(st().doc).groups.some((g) => g.rule.id === 'duplicate-parallel-line')).toBe(false)
  })

  it('is one undo step', () => {
    drawDoubledLine()
    const before = st().doc
    const spec = qaFor(st().doc).groups
      .find((g) => g.rule.id === 'duplicate-parallel-line')!.findings[0]!.fix!.spec
    applyFix(spec)
    expect(edges()).toHaveLength(1)
    st().undo()
    expect(useStore.getState().doc).toEqual(before)
  })

  it('reports failure instead of pretending, when the line has already gone', () => {
    const { second } = drawDoubledLine()
    const sheetId = st().activeSheetId
    st().deleteIds([second])
    const r = applyFix({ kind: 'delete-duplicate-line', sheetId, edgeId: second })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/no longer/i)
  })
})
