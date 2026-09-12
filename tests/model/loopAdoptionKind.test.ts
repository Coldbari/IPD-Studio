// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C closeout D1 — the kind of a record adoption mints.
 *
 * `applyLoopAdoption` creates an `EngineeringRecord` for any member that did
 * not have one. It used to hard-code `kind: 'instrument'`, so adopting a loop
 * containing a valve filed that valve as an instrument: a wrong engineering
 * fact, written silently, by the one path in P2-C whose whole brief was never
 * to do that.
 *
 * It was invisible because every consumer resolves kind from the drawn node
 * rather than from the record — which is exactly why it needed a test of its
 * own rather than being caught by an existing one.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { planLoopAdoption } from '../../src/model/loopAdoption'
import { drawnKinds, kindOfNode } from '../../src/model/registry'
import { deriveLoops } from '../../src/store/selectors'
import type { EntityKind } from '../../src/model/registry'
import type { NodeKind } from '../../src/model/types'

const st = () => useStore.getState()
const doc = () => st().doc
const rec = (key: string) => doc().registry?.[key]
const plan = () => planLoopAdoption(buildIndex(doc()))
const adopt = () => st().applyLoopAdoption(plan().adopt)
const historyDepth = () => useStore.temporal.getState().pastStates.length

const SYMBOL: Record<NodeKind, string> = {
  instrument: 'instr.bubble',
  valve: 'cv.globe',
  equipment: 'vessel.vertical',
  fitting: 'fit.junction',
  annotation: 'note.text',
}

function place(letters: string, loop: string, kind: NodeKind = 'instrument') {
  const id = st().addNode({ symbolId: SYMBOL[kind], kind, x: 0, y: 0, rotation: 0 })
  st().setTag(id, { letters, loop })
  return id
}

beforeEach(() => {
  st().loadIntoStore(createEmptyDoc('d1'))
  useStore.temporal.getState().clear()
})

/* ------------------------------------------------------- the defect itself */

describe('a minted record carries the kind of the object that wears the tag', () => {
  it('files an instrument as an instrument', () => {
    place('LT', '101'); place('LIC', '101')
    adopt()
    expect(rec('LT-101')).toMatchObject({ key: 'LT-101', kind: 'instrument' })
    expect(rec('LIC-101')!.kind).toBe('instrument')
  })

  it('files a VALVE as a valve — the case that was wrong', () => {
    place('LT', '101'); place('LV', '101', 'valve')
    adopt()
    expect(rec('LV-101')!.kind).toBe('valve')
    expect(rec('LT-101')!.kind).toBe('instrument')
  })

  it('files equipment as equipment', () => {
    place('LT', '101'); place('LE', '101', 'equipment')
    adopt()
    expect(rec('LE-101')!.kind).toBe('equipment')
  })

  it('files a fitting as equipment, the way kindOfNode already decides', () => {
    // `NodeKind` has five members and `EntityKind` four: everything that is
    // not an instrument or a valve is equipment. Adoption must reach the same
    // answer as `kindOfNode` rather than a second opinion.
    place('LT', '101'); place('LY', '101', 'fitting')
    adopt()
    const node = doc().sheets[0]!.nodes.find((n) => n.tag?.letters === 'LY')!
    expect(rec('LY-101')!.kind).toBe(kindOfNode(node))
    expect(rec('LY-101')!.kind).toBe('equipment')
  })

  it('one adoption mints each member under its own kind', () => {
    place('LT', '101')
    place('LV', '101', 'valve')
    place('LE', '101', 'equipment')
    adopt()
    const kinds = Object.fromEntries(
      Object.values(doc().registry ?? {}).map((r) => [r.key, r.kind]),
    ) as Record<string, EntityKind>
    expect(kinds).toEqual({ 'LT-101': 'instrument', 'LV-101': 'valve', 'LE-101': 'equipment' })
  })
})

/* ------------------------------------------------- existing records untouched */

describe('an existing record is assigned, never reclassified', () => {
  it('keeps the kind, the fields and the unit it already had', () => {
    place('LT', '101'); place('LV', '101', 'valve')
    // A record filed by hand BEFORE adoption, with a deliberately unusual kind
    // for its key, so a reclassification would be visible.
    st().setRecordField('LV-101', 'valve', 'element.size', '4"')
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LV-101', 'valve', unitId)
    useStore.temporal.getState().clear()

    adopt()

    expect(rec('LV-101')).toMatchObject({
      kind: 'valve', unitId, fields: { 'element.size': '4"' },
    })
  })

  it('does not rewrite a kind that disagrees with the drawing', () => {
    place('LT', '101'); place('LV', '101', 'valve')
    // Someone (an older build, an import) filed LV-101 as equipment. Adoption
    // assigns a loop; deciding the object is really a valve is not its job.
    st().setRecordField('LV-101', 'equipment', 'general.service', 'Legacy')
    expect(rec('LV-101')!.kind).toBe('equipment')
    adopt()
    expect(rec('LV-101')!.kind).toBe('equipment')
  })
})

/* --------------------------------------------------------------- lines */

describe('lines', () => {
  it('can never be adoption members — the derived grouping walks nodes only', () => {
    const a = place('LT', '101')
    const b = place('LIC', '101')
    const e = st().addEdge({
      lineClass: 'process.major',
      source: { nodeId: a, portId: 'e' },
      target: { nodeId: b, portId: 'w' },
    })
    st().setEdge(e, { lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '101' } })

    // The line IS drawn and DOES have an engineering key…
    expect(buildIndex(doc()).edgesByKey.has('6"-CS150-CW-101')).toBe(true)
    // …and it is still not a member of anything, because `deriveLoops` reads
    // `sheet.nodes`. Adoption therefore never mints a `line` record.
    expect(deriveLoops(doc())[0]!.members.map((m) => m.tag.letters)).toEqual(['LT', 'LIC'])
    expect(plan().rows[0]!.members).toEqual(['LIC-101', 'LT-101'])
    adopt()
    expect(rec('6"-CS150-CW-101')).toBeUndefined()
  })

  it('but `drawnKinds` still answers for one, so the map cannot drift from liveKeys', () => {
    const a = place('LT', '101')
    const b = place('LIC', '101')
    const e = st().addEdge({
      lineClass: 'process.major',
      source: { nodeId: a, portId: 'e' },
      target: { nodeId: b, portId: 'w' },
    })
    st().setEdge(e, { lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '101' } })

    const kinds = drawnKinds(doc().sheets)
    expect(kinds.get('6"-CS150-CW-101')).toBe('line')
    expect(kinds.get('LT-101')).toBe('instrument')
  })

  it('drawnKinds covers exactly the keys liveKeys does', async () => {
    place('LT', '101'); place('LV', '101', 'valve'); place('LZ', '101', 'annotation')
    const { liveKeys } = await import('../../src/model/registry')
    expect([...drawnKinds(doc().sheets).keys()].sort()).toEqual([...liveKeys(doc().sheets)].sort())
  })
})

/* ------------------------------------- the P2-C guarantees still hold */

describe('the adoption contract is unchanged', () => {
  const seed = () => {
    place('LT', '101'); place('LIC', '101'); place('LV', '101', 'valve')
    place('FT', '200'); place('FIC', '200')
    useStore.temporal.getState().clear()
  }

  it('is still one atomic undo step, and redo restores it', () => {
    seed()
    expect(adopt()).toEqual({ loops: 2, assigned: 5 })
    expect(historyDepth()).toBe(1)
    st().undo()
    expect(doc().loops ?? []).toHaveLength(0)
    expect(rec('LV-101')).toBeUndefined()
    st().redo()
    expect(doc().loops).toHaveLength(2)
    expect(rec('LV-101')!.kind).toBe('valve')
  })

  it('is still idempotent', () => {
    seed()
    const p = plan().adopt
    st().applyLoopAdoption(p)
    const after = doc()
    expect(st().applyLoopAdoption(p)).toEqual({ loops: 0, assigned: 0 })
    expect(doc()).toBe(after)
  })

  it('is still deterministic', () => {
    seed()
    const a = plan().rows.map((r) => `${r.ref}:${r.verdict}:${r.members.join('+')}`)
    const b = plan().rows.map((r) => `${r.ref}:${r.verdict}:${r.members.join('+')}`)
    expect(a).toEqual(b)
  })

  it('still touches no tag and no node', () => {
    seed()
    const before = JSON.stringify(doc().sheets[0]!.nodes)
    adopt()
    expect(JSON.stringify(doc().sheets[0]!.nodes)).toBe(before)
  })

  it('still assigns membership by stable id', () => {
    seed()
    adopt()
    const lId = doc().loops!.find((l) => l.number === 'L-101')!.id
    expect(rec('LV-101')!.loopId).toBe(lId)
  })
})
