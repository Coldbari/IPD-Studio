import { describe, expect, it } from 'vitest'
import type { PlantEdge, PlantNode, SheetContent } from '../../src/model/types'
import { propagateFluid } from '../../src/model/fluidFlow'
import '../../src/symbols/lib/index'

const node = (id: string, kind: PlantNode['kind'], symbolId: string): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0 }) as PlantNode
const edge = (id: string, a: string, b: string, lineClass = 'process.major'): PlantEdge =>
  ({
    id,
    lineClass: lineClass as PlantEdge['lineClass'],
    source: { nodeId: a, portId: 'e' },
    target: { nodeId: b, portId: 'w' },
  })

const content = (nodes: PlantNode[], edges: PlantEdge[]): SheetContent => ({ nodes, edges })

describe('propagateFluid', () => {
  it('flows through valves, pumps, and junctions; stops at vessels', () => {
    // TK1 -e1- valve -e2- pump -e3- junction -e4- TK2, junction -e5- fitting -e6- HX
    const sc = content(
      [
        node('tk1', 'equipment', 'vessel.tank'),
        node('v1', 'valve', 'valve.gate'),
        node('p1', 'equipment', 'pump.centrifugal'),
        node('j1', 'fitting', 'fit.junction'),
        node('tk2', 'equipment', 'vessel.vertical'),
        node('f1', 'fitting', 'fit.reducer'),
        node('hx', 'equipment', 'hx.shell-tube'),
      ],
      [
        edge('e1', 'tk1', 'v1'),
        edge('e2', 'v1', 'p1'),
        edge('e3', 'p1', 'j1'),
        edge('e4', 'j1', 'tk2'),
        edge('e5', 'j1', 'f1'),
        edge('e6', 'f1', 'hx'),
      ],
    )
    // start mid-run: the whole connected run gets it, both directions
    expect(propagateFluid(sc, 'e2').sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
    // tanks and HX are terminals: nothing beyond them (e4/e6 still included as arriving edges)
  })

  it('does not cross a vessel onto its other nozzles', () => {
    // e1 into TK, e2 out of TK: assigning e1 must NOT color e2
    const sc = content(
      [node('a', 'fitting', 'fit.junction'), node('tk', 'equipment', 'vessel.tank'), node('b', 'fitting', 'fit.junction')],
      [edge('e1', 'a', 'tk'), edge('e2', 'tk', 'b')],
    )
    expect(propagateFluid(sc, 'e1')).toEqual(['e1'])
  })

  it('ignores signal lines and free ends', () => {
    const sc = content(
      [node('v1', 'valve', 'valve.gate'), node('i1', 'instrument', 'instr.bubble')],
      [
        { id: 'e1', lineClass: 'process.major', source: { x: 0, y: 0 }, target: { nodeId: 'v1', portId: 'w' } },
        edge('e2', 'v1', 'i1', 'signal.electric'),
      ],
    )
    expect(propagateFluid(sc, 'e1')).toEqual(['e1'])
  })
})

/* ------------------------------------------------------------------------ */

/**
 * P3 PROGRAM 1 CHARACTERIZATION.
 *
 * `propagateFluid`'s walk and its `passesThrough` rule moved into
 * `model/run.ts` so `deriveRuns` reads the same two definitions. The move had
 * to be behaviour-preserving to the letter — a fluid assignment that coloured
 * one edge more or fewer than before would be a visible regression, and the
 * whole point of sharing is that the colour and the line list agree.
 *
 * The digest below was computed by running this exact corpus against the
 * implementation at d0b0da4, BEFORE the extraction. It is the pre-refactor
 * answer, not this build's answer, so it cannot drift into agreeing with a
 * change. The full 552-result comparison was made at the time and matched
 * key-for-key and ORDER-for-order; the digest is what keeps it matched.
 *
 * If this fails, `connectedRun` or `passesThrough` changed what piping is
 * connected. That may be intended — but it changes fluid colouring too, and
 * the pull request has to say so.
 */
const PRE_REFACTOR_DIGEST = 'b2116a31927d69b1'

/** Two 32-bit FNV-1a lanes, as `fingerprintStandard` uses. Detects change; it
 *  is not asked to do anything else. */
function digest(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** A deterministic spread of drawings: every node kind that decides
 *  pass-through, both line families, free ends, self-loops and dead ports. */
function corpus(): SheetContent[] {
  let s = 987654321
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const SYMBOLS: [string, PlantNode['kind']][] = [
    ['valve.gate', 'valve'], ['cv.globe', 'valve'], ['fit.junction', 'fitting'],
    ['fit.reducer', 'fitting'], ['pump.centrifugal', 'equipment'], ['vessel.tank', 'equipment'],
    ['vessel.vertical', 'equipment'], ['hx.shell-tube', 'equipment'], ['instr.bubble', 'instrument'],
    ['fe.orifice', 'instrument'], ['ann.text', 'annotation'], ['psv', 'valve'],
    ['nope.unknown', 'equipment'], ['ctl.dcs', 'equipment'],
  ]
  const CLASSES = ['process.major', 'process.minor', 'pipe.jacketed', 'process.impulse',
    'signal.electric', 'signal.pneumatic'] as const

  const out: SheetContent[] = []
  for (let c = 0; c < 60; c++) {
    const nodes: PlantNode[] = []
    const n = 2 + Math.floor(rnd() * 10)
    for (let i = 0; i < n; i++) {
      const [symbolId, kind] = SYMBOLS[Math.floor(rnd() * SYMBOLS.length)]!
      nodes.push({ id: `n${i}`, symbolId, kind, x: 0, y: 0, rotation: 0 })
    }
    const edges: PlantEdge[] = []
    const m = 1 + Math.floor(rnd() * 14)
    for (let j = 0; j < m; j++) {
      const lineClass = CLASSES[Math.floor(rnd() * CLASSES.length)]!
      const a = Math.floor(rnd() * (n + 1))
      const b = Math.floor(rnd() * (n + 1))
      edges.push({
        id: `e${j}`,
        lineClass,
        source: a < n ? { nodeId: `n${a}`, portId: 'e' } : { x: j, y: 0 },
        target: b < n ? { nodeId: `n${b}`, portId: 'w' } : { x: j, y: 9 },
      })
    }
    out.push({ nodes, edges })
  }
  return out
}

function corpusResults(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  corpus().forEach((sc, i) => {
    for (const e of sc.edges) out[`${i}/${e.id}`] = propagateFluid(sc, e.id)
    out[`${i}/missing`] = propagateFluid(sc, 'nope')
  })
  return out
}

describe('propagateFluid is unchanged by the move into model/run.ts', () => {
  it('answers 552 probes exactly as the implementation at d0b0da4 did', () => {
    const results = corpusResults()
    expect(Object.keys(results)).toHaveLength(552)
    // Not vacuous: most probes find something, and half of those find a run of
    // more than one edge.
    expect(Object.values(results).filter((v) => v.length > 0)).toHaveLength(492)
    expect(Object.values(results).filter((v) => v.length > 1)).toHaveLength(255)
    expect(digest(JSON.stringify(results))).toBe(PRE_REFACTOR_DIGEST)
  })

  it('still returns the start edge first, and returns nothing for an unknown id', () => {
    for (const [probe, ids] of Object.entries(corpusResults())) {
      const startId = probe.slice(probe.indexOf('/') + 1)
      if (startId === 'missing') expect(ids).toEqual([])
      else expect(ids[0], probe).toBe(startId)
    }
  })

  it('is symmetric: any process edge in a run sees the same run', () => {
    // The defining property of a connected component, and the one a broken
    // traversal loses first.
    for (const sc of corpus()) {
      const process = new Set(sc.edges.filter((e) => e.lineClass.startsWith('process') || e.lineClass.startsWith('pipe')).map((e) => e.id))
      for (const id of process) {
        const mine = propagateFluid(sc, id)
        for (const other of mine) {
          if (!process.has(other)) continue
          expect([...propagateFluid(sc, other)].sort(), `${id} vs ${other}`).toEqual([...mine].sort())
        }
      }
    }
  })
})
