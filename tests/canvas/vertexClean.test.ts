import { describe, expect, it } from 'vitest'
import { cleanVertices, straightenDanglingRoute } from '../../src/canvas/vertexClean'

const SRC = { x: 336, y: 136 }
const TGT = { x: 336, y: 240 }

describe('cleanVertices', () => {
  it('keeps a real bend, snapped to the grid', () => {
    expect(cleanVertices([{ x: 391, y: 214 }], SRC, TGT)).toEqual([{ x: 392, y: 216 }])
  })
  it('a vertex dragged back near the axis adopts it and disappears (the kink heals)', () => {
    expect(cleanVertices([{ x: 339, y: 214 }], SRC, TGT)).toEqual([])
  })
  it('adopts OFF-grid anchor axes: no permanent 1-4px jog against off-grid ports', () => {
    const src = { x: 335, y: 136 } // off-grid port
    const tgt = { x: 335, y: 240 }
    // snap8 would put the vertex at 336 — 1px kink forever; adoption heals it
    expect(cleanVertices([{ x: 338, y: 190 }], src, tgt)).toEqual([])
  })
  it('an elbow at the corner of two runs survives exactly', () => {
    const src = { x: 0, y: 0 }
    const tgt = { x: 100, y: 80 }
    expect(cleanVertices([{ x: 98, y: 2 }], src, tgt)).toEqual([{ x: 100, y: 0 }])
  })
  it('chained vertices adopt through each other (two passes)', () => {
    const src = { x: 0, y: 0 }
    const tgt = { x: 200, y: 100 }
    // intended: out to x=104, down, over — slightly scattered by the drag
    const out = cleanVertices([{ x: 104, y: 2 }, { x: 101, y: 98 }], src, tgt)
    expect(out).toEqual([{ x: 104, y: 0 }, { x: 104, y: 100 }])
  })
  it('drops duplicates and anchor-riding vertices', () => {
    expect(cleanVertices([{ x: 336, y: 136 }], SRC, TGT)).toEqual([])
    expect(
      cleanVertices([{ x: 392, y: 216 }, { x: 393, y: 217 }], SRC, TGT),
    ).toEqual([{ x: 392, y: 216 }])
  })
  it('free ends (null anchors) still snap and simplify', () => {
    expect(cleanVertices([{ x: 41, y: 39 }], null, null)).toEqual([{ x: 40, y: 40 }])
  })
  it('moves a near-axis dangling end so a two-elbow hook heals straight', () => {
    expect(straightenDanglingRoute(
      [{ x: 152, y: 112 }, { x: 128, y: 112 }],
      { x: 152, y: 40 },
      { x: 128, y: 160 },
      'target',
    )).toEqual({ source: { x: 152, y: 40 }, target: { x: 152, y: 160 }, vertices: [] })
  })
  it('keeps a deliberate, widely offset dangling route', () => {
    expect(straightenDanglingRoute(
      [{ x: 152, y: 112 }, { x: 80, y: 112 }],
      { x: 152, y: 40 },
      { x: 80, y: 160 },
      'target',
    ).target).toEqual({ x: 80, y: 160 })
  })
})
