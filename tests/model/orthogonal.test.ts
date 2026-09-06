import { describe, expect, it } from 'vitest'
import { orthogonalizeVertices } from '../../src/model/orthogonal'

const diagonalSegments = (points: Array<{ x: number; y: number }>) => points.some((point, index) => {
  const next = points[index + 1]
  return Boolean(next && point.x !== next.x && point.y !== next.y)
})

describe('orthogonal routes', () => {
  it('leaves a direct connection for the router to route', () => {
    expect(orthogonalizeVertices(undefined, { x: 0, y: 0 }, { x: 160, y: 96 })).toBeUndefined()
  })

  it('preserves a user waypoint while splitting every diagonal leg', () => {
    const vertices = orthogonalizeVertices(
      [{ x: 80, y: 72 }, { x: 160, y: 160 }],
      { x: 0, y: 0 },
      { x: 240, y: 96 },
    )!
    const points = [{ x: 0, y: 0 }, ...vertices, { x: 240, y: 96 }]
    expect(diagonalSegments(points)).toBe(false)
    expect(points).toContainEqual({ x: 80, y: 72 })
    expect(points).toContainEqual({ x: 160, y: 160 })
  })
})
