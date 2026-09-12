import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import {
  HEADROOM_THRESHOLDS,
  headroomAdvice,
  headroomLabel,
  headroomState,
  measureDoc,
} from '../../src/cloud/headroom'
import { MAX_DOC_BYTES } from '../../src/cloud/sync'
import { buildPayload } from '../../src/cloud/sync'
import { createEmptyDoc } from '../../src/model/doc'
import type { PlantNode, ProjectDoc } from '../../src/model/types'

function withNodes(n: number): ProjectDoc {
  const doc = createEmptyDoc('Sized')
  const nodes: PlantNode[] = []
  for (let i = 0; i < n; i++) {
    nodes.push({
      id: `n${i}`, symbolId: 'instr.bubble', kind: 'instrument',
      x: i * 8, y: i * 8, rotation: 0, tag: { letters: 'FT', loop: String(100 + i) },
    })
  }
  doc.sheets[0]!.nodes = nodes
  return doc
}

describe('measureDoc', () => {
  // The number has to be the number the server will judge, or the warning is
  // decoration. buildPayload is what actually goes to Firestore.
  it('measures exactly what the cloud would store', () => {
    const doc = withNodes(40)
    expect(measureDoc(doc).bytes).toBe(buildPayload(doc, doc.meta.name).sizeBytes)
  })

  it('counts bytes, not characters, so non-ASCII tag text does not under-measure', () => {
    const ascii = createEmptyDoc('aaaa')
    const wide = createEmptyDoc('αααα')
    expect(measureDoc(wide).bytes).toBeGreaterThan(measureDoc(ascii).bytes)
  })

  it('reports remaining headroom against the cap', () => {
    const h = measureDoc(createEmptyDoc('Empty'))
    expect(h.remaining).toBe(MAX_DOC_BYTES - h.bytes)
    expect(h.fraction).toBeCloseTo(h.bytes / MAX_DOC_BYTES, 10)
  })

  it('grows with the drawing', () => {
    expect(measureDoc(withNodes(400)).bytes).toBeGreaterThan(measureDoc(withNodes(40)).bytes)
  })

  it('calls an empty document healthy', () => {
    expect(measureDoc(createEmptyDoc('New')).state).toBe('healthy')
  })

  // Never negative: an over-size document is a real state and the UI has to
  // render it rather than divide by a clamped number.
  it('clamps remaining at zero but lets the fraction exceed 1', () => {
    const doc = createEmptyDoc('Huge')
    doc.sheets[0]!.underlay = {
      name: 'big.dxf',
      polylines: [Array.from({ length: 60_000 }, (_, i) => ({ x: i, y: i }))],
    }
    const h = measureDoc(doc)
    expect(h.bytes).toBeGreaterThan(MAX_DOC_BYTES)
    expect(h.remaining).toBe(0)
    expect(h.fraction).toBeGreaterThan(1)
    expect(h.state).toBe('critical')
  })
})

describe('headroomState thresholds', () => {
  it('names each band at its boundary', () => {
    expect(headroomState(0)).toBe('healthy')
    expect(headroomState(0.59)).toBe('healthy')
    expect(headroomState(HEADROOM_THRESHOLDS['getting-large'])).toBe('getting-large')
    expect(headroomState(0.79)).toBe('getting-large')
    expect(headroomState(HEADROOM_THRESHOLDS['near-limit'])).toBe('near-limit')
    expect(headroomState(0.94)).toBe('near-limit')
    expect(headroomState(HEADROOM_THRESHOLDS.critical)).toBe('critical')
    expect(headroomState(1.5)).toBe('critical')
  })

  it('orders the thresholds', () => {
    expect(HEADROOM_THRESHOLDS['getting-large']).toBeLessThan(HEADROOM_THRESHOLDS['near-limit'])
    expect(HEADROOM_THRESHOLDS['near-limit']).toBeLessThan(HEADROOM_THRESHOLDS.critical)
    expect(HEADROOM_THRESHOLDS.critical).toBeLessThan(1)
  })

  it('warns before the ceiling, not at it', () => {
    // the whole point: 'critical' has to arrive with room still left to act in
    expect(HEADROOM_THRESHOLDS.critical * MAX_DOC_BYTES).toBeLessThan(MAX_DOC_BYTES)
  })

  it('labels every state', () => {
    expect(headroomLabel('healthy')).toBe('Healthy')
    expect(headroomLabel('getting-large')).toBe('Getting large')
    expect(headroomLabel('near-limit')).toBe('Near limit')
    expect(headroomLabel('critical')).toBe('Critical')
  })
})

describe('headroomAdvice', () => {
  it('says something actionable in every state, and never just a percentage', () => {
    for (const fraction of [0.1, 0.65, 0.85, 0.99]) {
      const bytes = Math.round(fraction * MAX_DOC_BYTES)
      const advice = headroomAdvice({
        bytes, fraction, remaining: MAX_DOC_BYTES - bytes, state: headroomState(fraction),
      })
      expect(advice.length).toBeGreaterThan(20)
      expect(advice).toMatch(/\d/)
    }
  })

  it('names the usual culprit once the drawing is near the limit', () => {
    const bytes = Math.round(0.85 * MAX_DOC_BYTES)
    const advice = headroomAdvice({ bytes, fraction: 0.85, remaining: MAX_DOC_BYTES - bytes, state: 'near-limit' })
    expect(advice).toContain('DXF')
  })

  it('tells a critical document what will actually go wrong', () => {
    const bytes = Math.round(0.98 * MAX_DOC_BYTES)
    const advice = headroomAdvice({ bytes, fraction: 0.98, remaining: MAX_DOC_BYTES - bytes, state: 'critical' })
    expect(advice).toMatch(/fail/i)
    expect(advice).toContain('.pnid')
  })
})
