import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { getSymbol } from '../../src/symbols/registry'
import { portSide } from '../../src/symbols/portLabels'
import { LINE_STROKES } from '../../src/canvas/lineStyle'

const def = () => getSymbol('ann.tiein')
const widths = (svg: string) => (svg.match(/stroke-width="([\d.]+)"/g) ?? []).map((s) => Number(s.match(/[\d.]+/)![0]))

describe('tie-in point reads as a line-weight step, not a badge', () => {
  it('draws a thin run into a heavy run, at the weights the line classes use', () => {
    const svg = def().render({})
    // existing side is drawn at pipe.existing's weight, new side at process.major's
    expect(svg).toContain(`stroke-width="${LINE_STROKES['pipe.existing'].width}"`)
    expect(svg).toContain(`stroke-width="${LINE_STROKES['process.major'].width}"`)
    // and they meet: thin H run ending where the heavy H run begins
    expect(svg).toContain('M0 16 H16')
    expect(svg).toContain('M16 16 H32')
    // the joint itself is the heaviest stroke on the symbol
    expect(Math.max(...widths(svg))).toBeGreaterThan(LINE_STROKES['process.major'].width)
  })

  it('carries no colour of its own, so it survives a mono plot or a red/black markup', () => {
    const svg = def().render({})
    expect(svg).not.toMatch(/(stroke|fill)="(?!none|currentColor)[^"]+"/)
  })

  it('sits in the run: process either side, with the legacy flag port kept', () => {
    const { ports, gridSize } = def()
    const w = gridSize.w * 8
    const h = gridSize.h * 8
    const byId = Object.fromEntries(ports.map((p) => [p.id, p]))
    expect(portSide(byId.w!, w, h)).toBe('left')
    expect(portSide(byId.e!, w, h)).toBe('right')
    expect(byId.w!.y).toBe(byId.e!.y) // one straight run through the node
    // ...and that run is the box centre line, so rotating to put the new side
    // west pivots about the pipe instead of stepping the line sideways
    expect(byId.w!.y).toBe(h / 2)
    // 's' is the port the triangle flag had; saved drawings still address it
    expect(byId.s).toBeDefined()
    expect(portSide(byId.s!, w, h)).toBe('bottom')
  })

  it('stays a distinct mark from the battery limit flag', () => {
    expect(def().render({})).toContain('>TP<')
    expect(getSymbol('ann.bl-flag').render({})).toContain('>BL<')
    expect(def().render({})).not.toContain('polygon')
  })
})
