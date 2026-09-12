// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 3 — adopting a derived loop, and everything it refuses to do.
 *
 * This is the safety-sensitive half of the program, so most of these are
 * assertions about RESTRAINT: that a plan writes nothing, that an uncertain
 * mapping stops rather than guesses, that applying twice is not applying
 * twice, and that adoption never touches a tag, a node or an HMI screen.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { planLoopAdoption } from '../../src/model/loopAdoption'
import { deriveLoops } from '../../src/store/selectors'
import { createScreen } from '../../src/hmi/model'

const st = () => useStore.getState()
const doc = () => st().doc
const loops = () => doc().loops ?? []
const rec = (key: string) => doc().registry?.[key]
const plan = () => planLoopAdoption(buildIndex(doc()))
const row = (ref: string) => plan().rows.find((r) => r.ref === ref)
const historyDepth = () => useStore.temporal.getState().pastStates.length

/** Place a tagged symbol and return its node id. */
function place(letters: string, loop: string, kind: 'instrument' | 'valve' | 'annotation' = 'instrument') {
  const id = st().addNode({
    symbolId: kind === 'valve' ? 'cv.globe' : kind === 'annotation' ? 'note.text' : 'instr.bubble',
    kind, x: 0, y: 0, rotation: 0,
  })
  st().setTag(id, { letters, loop })
  return id
}

beforeEach(() => {
  st().loadIntoStore(createEmptyDoc('adopt'))
  useStore.temporal.getState().clear()
})

/* ------------------------------------------------------------ eligibility */

describe('what is eligible', () => {
  it('adopts a derived loop of two or more members', () => {
    place('LT', '101'); place('LIC', '101'); place('LV', '101', 'valve')
    const r = row('L-101')!
    expect(r.verdict).toBe('adopt')
    expect(r.members).toEqual(['LIC-101', 'LT-101', 'LV-101'])
    expect(r.loopNumber).toBe('L-101')
  })

  it('skips a loop of one — a lone instrument is not worth declaring', () => {
    place('PT', '900')
    expect(row('P-900')).toMatchObject({ verdict: 'skip' })
    expect(row('P-900')!.reason).toMatch(/loop of one/i)
  })

  it('suggests a type only when it is safe to, and never invents one', () => {
    place('LT', '101'); place('LIC', '101'); place('LV', '101', 'valve')
    expect(row('L-101')!.suggestedType).toBe('control')

    place('FY', '300'); place('FY', '301')
    // Two relays say nothing about what kind of loop this is.
    const r = plan().rows.find((x) => x.ref === 'F-300')
    expect(r?.suggestedType).toBeUndefined()
  })

  it('numbers the persistent loop with the FULL derived ref, not the bare number', () => {
    // F-101 and P-101 are different derived loops that share a bare number.
    // Adopting both as "101" would mint a duplicate out of a migration.
    place('FT', '101'); place('FIC', '101')
    place('PT', '101'); place('PIC', '101')
    const p = plan()
    expect(p.adopt.map((r) => r.loopNumber).sort()).toEqual(['F-101', 'P-101'])
  })
})

/* -------------------------------------------------------- attention cases */

describe('what stops rather than guesses', () => {
  it('refuses a loop containing a tagged annotation — it can carry no record', () => {
    place('LT', '101'); place('LIC', '101'); place('LZ', '101', 'annotation')
    const r = row('L-101')!
    expect(r.verdict).toBe('attention')
    expect(r.excluded).toEqual(['LZ-101'])
    expect(r.reason).toMatch(/no engineering record/i)
    // Named, never silently dropped — the loop the user sees in the drawer is
    // not the loop they would get, so they are told instead.
    expect(r.reason).toContain('LZ-101')
  })

  it('refuses when the number already belongs to an unrelated loop', () => {
    place('LT', '101'); place('LIC', '101')
    st().addLoop('L-101')
    const r = row('L-101')!
    expect(r.verdict).toBe('attention')
    expect(r.reason).toMatch(/already exists/i)
  })

  it('refuses when members are already split across two loops', () => {
    place('LT', '101'); place('LIC', '101')
    const a = st().addLoop('A')
    const b = st().addLoop('B')
    st().assignLoop('LT-101', 'instrument', a.id!)
    st().assignLoop('LIC-101', 'instrument', b.id!)
    const r = row('L-101')!
    expect(r.verdict).toBe('attention')
    expect(r.reason).toMatch(/split across 2 loops/i)
    expect(r.reason).toContain('A')
    expect(r.reason).toContain('B')
  })

  it('refuses a partly-assigned loop rather than assigning the rest', () => {
    place('LT', '101'); place('LIC', '101'); place('LV', '101', 'valve')
    const a = st().addLoop('A')
    st().assignLoop('LT-101', 'instrument', a.id!)
    const r = row('L-101')!
    expect(r.verdict).toBe('attention')
    expect(r.reason).toMatch(/1 of 3 members already belong/i)
    // Some members being out may be a decision somebody made on purpose.
    expect(r.reason).toMatch(/LIC-101, LV-101/)
  })

  it('never matches on position, proximity or tag similarity', () => {
    // Two instruments at the same coordinates with near-identical tags. They
    // are DIFFERENT derived loops and adoption must keep them apart.
    place('LT', '101'); place('LIC', '101')
    place('LT', '1011'); place('LIC', '1011')
    const p = plan()
    expect(p.adopt.map((r) => r.ref).sort()).toEqual(['L-101', 'L-1011'])
    expect(p.adopt.find((r) => r.ref === 'L-101')!.members).toEqual(['LIC-101', 'LT-101'])
    expect(p.adopt.find((r) => r.ref === 'L-1011')!.members).toEqual(['LIC-1011', 'LT-1011'])
  })
})

/* ------------------------------------------------------- plan writes nothing */

describe('planning is pure', () => {
  it('writes nothing and records no undo step', () => {
    place('LT', '101'); place('LIC', '101')
    useStore.temporal.getState().clear()
    const before = doc()
    const p = plan()
    expect(p.adopt).toHaveLength(1)
    expect(doc()).toBe(before)
    expect(historyDepth()).toBe(0)
    expect(doc().loops).toBeUndefined()
  })

  it('is deterministic — the same document plans identically twice', () => {
    place('LT', '101'); place('LIC', '101'); place('FT', '200'); place('FIC', '200')
    const a = plan().rows.map((r) => `${r.ref}:${r.verdict}:${r.members.join('+')}`)
    const b = plan().rows.map((r) => `${r.ref}:${r.verdict}:${r.members.join('+')}`)
    expect(a).toEqual(b)
    expect(a).toEqual([...a].sort())
  })
})

/* ---------------------------------------------------------------- applying */

describe('applying an adoption plan', () => {
  const seedTwo = () => {
    place('LT', '101'); place('LIC', '101'); place('LV', '101', 'valve')
    place('FT', '200'); place('FIC', '200')
    useStore.temporal.getState().clear()
  }

  it('creates the loops and assigns the members, as ONE undo step', () => {
    seedTwo()
    const result = st().applyLoopAdoption(plan().adopt)
    expect(result).toEqual({ loops: 2, assigned: 5 })
    expect(loops().map((l) => l.number).sort()).toEqual(['F-200', 'L-101'])
    expect(historyDepth()).toBe(1)

    const lId = loops().find((l) => l.number === 'L-101')!.id
    expect(rec('LT-101')!.loopId).toBe(lId)
    expect(rec('LV-101')!.loopId).toBe(lId)
  })

  it('carries the suggested type onto the loop it creates', () => {
    seedTwo()
    st().applyLoopAdoption(plan().adopt)
    expect(loops().find((l) => l.number === 'L-101')!.type).toBe('control')
  })

  it('undo removes both the loops and the memberships; redo restores them', () => {
    seedTwo()
    st().applyLoopAdoption(plan().adopt)
    st().undo()
    expect(loops()).toHaveLength(0)
    expect(rec('LT-101')?.loopId).toBeUndefined()
    st().redo()
    expect(loops()).toHaveLength(2)
    expect(rec('LT-101')?.loopId).toBeDefined()
  })

  it('is idempotent — applying the same plan twice changes nothing the second time', () => {
    seedTwo()
    const p = plan().adopt
    st().applyLoopAdoption(p)
    const after = doc()
    const second = st().applyLoopAdoption(p)
    expect(second).toEqual({ loops: 0, assigned: 0 })
    expect(loops()).toHaveLength(2)
    expect(doc()).toBe(after)
  })

  it('re-planning after adoption offers nothing and reports them as adopted', () => {
    seedTwo()
    st().applyLoopAdoption(plan().adopt)
    const p = plan()
    expect(p.adopt).toHaveLength(0)
    expect(p.skipped.map((r) => r.ref).sort()).toEqual(['F-200', 'L-101'])
    expect(p.skipped[0]!.reason).toMatch(/already adopted/i)
  })

  it('never alters tags, nodes, sheets or HMI references', () => {
    seedTwo()
    st().addImportedScreen({
      ...createScreen(1),
      widgets: [{ id: 'w1', type: 'display', x: 0, y: 0, w: 60, h: 30, tag: 'LT-101' }],
    })
    useStore.temporal.getState().clear()
    const nodesBefore = JSON.stringify(doc().sheets[0]!.nodes)
    const screensBefore = JSON.stringify(doc().hmiScreens)

    st().applyLoopAdoption(plan().adopt)

    expect(JSON.stringify(doc().sheets[0]!.nodes)).toBe(nodesBefore)
    expect(JSON.stringify(doc().hmiScreens)).toBe(screensBefore)
  })

  it('leaves the derived grouping exactly where it was', () => {
    seedTwo()
    const derivedBefore = deriveLoops(doc()).map((l) => `${l.family}-${l.loop}:${l.members.length}`)
    st().applyLoopAdoption(plan().adopt)
    expect(deriveLoops(doc()).map((l) => `${l.family}-${l.loop}:${l.members.length}`)).toEqual(derivedBefore)
  })

  it('acts only on `adopt` rows — attention and skip are never applied', () => {
    place('LT', '101'); place('LIC', '101'); place('LZ', '101', 'annotation')
    place('PT', '900')
    useStore.temporal.getState().clear()
    const p = plan()
    expect(p.adopt).toHaveLength(0)
    // Handed the WHOLE plan, not just the adoptable rows.
    expect(st().applyLoopAdoption(p.rows)).toEqual({ loops: 0, assigned: 0 })
    expect(loops()).toHaveLength(0)
    expect(historyDepth()).toBe(0)
  })

  it('re-checks against the live document, not the plan it was handed', () => {
    seedTwo()
    const p = plan().adopt
    // The user declares L-101 by hand after the plan was computed.
    st().addLoop('L-101')
    const result = st().applyLoopAdoption(p)
    // The colliding row is skipped; the other still applies.
    expect(result.loops).toBe(1)
    expect(loops().map((l) => l.number).sort()).toEqual(['F-200', 'L-101'])
    expect(rec('LT-101')?.loopId).toBeUndefined()
  })
})
