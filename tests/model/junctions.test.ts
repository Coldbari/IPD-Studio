import { describe, expect, it } from 'vitest'
import type { PlantEdge, Sheet } from '../../src/model/types'
import { lineGroupIds, lineGroupRepresentative, normalizeDanglingJunctions, normalizeLineJunctions } from '../../src/model/junctions'

const junction = { x: 100, y: 100, junctionId: 'j' }

const edge = (id: string, source: PlantEdge['source'], target: PlantEdge['target']): PlantEdge => ({
  id, lineClass: 'process.major', source, target, fluidId: 'water',
})

const sheet = (edges: PlantEdge[]): Sheet => ({
  id: 's', name: 's', drawingNumber: '', revision: '', sheetSize: 'A3', nodes: [], edges,
})

describe('internal junction cleanup', () => {
  it('keeps explicit line objects independent at a shared junction', () => {
    const j1 = { x: 100, y: 100, junctionId: 'j1' }
    const j2 = { x: 200, y: 100, junctionId: 'j2' }
    const original = sheet([
      edge('left', { x: 0, y: 100 }, j1),
      edge('right', j1, j2),
      edge('branch', j1, { x: 100, y: 200 }),
      edge('other', j2, { x: 300, y: 100 }),
    ])
    const explicit = sheet(original.edges.map((e) => ({ ...e, lineGroupId: e.id })))
    expect(lineGroupIds(explicit, 'branch')).toEqual(['branch'])
    expect(lineGroupIds(original, 'missing')).toEqual([])
    expect(lineGroupRepresentative(explicit, 'branch')).toBe('branch')
  })

  it('merges the two surviving halves after a branch is deleted', () => {
    const out = normalizeLineJunctions(sheet([
      edge('left', { x: 0, y: 100 }, junction),
      edge('right', junction, { x: 200, y: 100 }),
    ]))

    expect(out.edges).toHaveLength(1)
    expect(out.edges[0]).toMatchObject({
      id: 'left',
      source: { x: 0, y: 100 },
      target: { x: 200, y: 100 },
      vertices: [{ x: 100, y: 100 }],
      fluidId: 'water',
    })
  })

  it('turns a lone surviving limb into a free-ended line', () => {
    const out = normalizeLineJunctions(sheet([
      edge('left', { x: 0, y: 100 }, junction),
    ]))

    expect(out.edges[0]!.target).toEqual({ x: 100, y: 100 })
  })

  it('preserves untouched edge identity while cleaning a lone junction', () => {
    const untouched = edge('untouched', { x: 0, y: 220 }, { x: 200, y: 220 })
    const original = sheet([
      edge('lonely', { x: 0, y: 100 }, junction),
      untouched,
    ])
    const out = normalizeDanglingJunctions(original)
    expect(out.edges.find((candidate) => candidate.id === 'lonely')).not.toBe(original.edges[0])
    expect(out.edges.find((candidate) => candidate.id === 'untouched')).toBe(untouched)
  })

  it('keeps a real three-way junction intact', () => {
    const original = sheet([
      edge('left', { x: 0, y: 100 }, junction),
      edge('right', junction, { x: 200, y: 100 }),
      edge('branch', junction, { x: 100, y: 200 }),
    ])
    expect(normalizeLineJunctions(original)).toBe(original)
  })

  it('groups only collinear legacy limbs when one side retains the shared coordinate', () => {
    const original = sheet([
      edge('left', { x: 0, y: 100 }, { x: 100, y: 100, junctionId: 'j1' }),
      edge('right', { x: 100, y: 100 }, { x: 200, y: 100 }),
      edge('branch', { x: 100, y: 100, junctionId: 'other-id' }, { x: 100, y: 200 }),
    ])
    expect(lineGroupIds(original, 'left')).toEqual(['left', 'right'])
    expect(lineGroupIds(original, 'branch')).toEqual(['branch'])
  })
})
