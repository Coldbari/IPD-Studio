// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 1 — the loop foundations.
 *
 * What these pin is deliberately narrow: the entity, its identity, the
 * membership reference, the index that inverts it, and the structural
 * evaluation. NOTHING here asserts a QA finding, a store action, a diff entry
 * or a UI behaviour, because Program 1 adds none of those — and a test that
 * quietly expected one would be the first place the scope started to slip.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import {
  LOOP_TYPES,
  asLoopType,
  checkLoops,
  classifyMember,
  danglingLoopMembers,
  evaluateLoop,
  newLoop,
  rolesOf,
  suggestLoopType,
  type Loop,
  type LoopMember,
  type LoopType,
  type MemberRole,
} from '../../src/model/loop'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { loadDoc, DocError } from '../../src/model/migrate'
import { applyRename } from '../../src/model/references'
import { deriveLoops } from '../../src/store/selectors'
import { expandLetters } from '../../src/isa/tag'
import { fingerprintStandard } from '../../src/model/provenance'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { serializeDoc } from '../../src/persist/file'
import type { EngineeringRecord, Registry } from '../../src/model/registry'
import type { PlantNode, ProjectDoc, Tag } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const member = (key: string, letters: string, drawn = true): LoopMember => ({ key, letters, drawn })

let seq = 0
const node = (tag: Tag, kind: PlantNode['kind'] = 'instrument'): PlantNode => ({
  id: `n${seq++}`,
  symbolId: kind === 'valve' ? 'cv.globe' : 'instr.bubble',
  kind,
  x: 0,
  y: 0,
  rotation: 0,
  tag,
})

const rec = (key: string, over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, ...over })

/** A document with loops, tagged nodes and a registry wiring the two together. */
function docWith(opts: { loops?: Loop[]; nodes?: PlantNode[]; registry?: Registry } = {}): ProjectDoc {
  const doc = createEmptyDoc('loop-test')
  doc.sheets[0]!.nodes = opts.nodes ?? []
  return {
    ...doc,
    ...(opts.loops ? { loops: opts.loops } : {}),
    ...(opts.registry ? { registry: opts.registry } : {}),
  }
}

/* ------------------------------------------- 1. creation & stable identity */

describe('Loop creation and identity', () => {
  it('mints a ULID that is not the number and not reused', () => {
    const a = newLoop('101')
    const b = newLoop('101')
    expect(a.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a.id).not.toBe(b.id)
    // Identity is never the display number: two loops may legitimately carry
    // the same number while the project is mid-renumbering.
    expect(a.number).toBe(b.number)
  })

  it('carries only what it was given — no invented fields', () => {
    expect(newLoop('101')).toEqual({ id: expect.any(String), number: '101' })
    expect(Object.keys(newLoop('101'))).toEqual(['id', 'number'])
  })

  /* ------------------------------------- 2. number / name / type / status */

  it('keeps number, name, description, type and status as given', () => {
    const l = newLoop('F-101', {
      name: 'Feed flow',
      description: 'Reactor feed',
      type: 'control',
      status: 'in-review',
    })
    expect(l).toMatchObject({
      number: 'F-101',
      name: 'Feed flow',
      description: 'Reactor feed',
      type: 'control',
      status: 'in-review',
    })
  })

  it('an empty optional is omitted rather than stored blank', () => {
    const l = newLoop('101', { name: '', description: '' })
    expect('name' in l).toBe(false)
    expect('description' in l).toBe(false)
  })

  it('renumbering does not touch identity', () => {
    const l = newLoop('101')
    const renumbered: Loop = { ...l, number: '201' }
    expect(renumbered.id).toBe(l.id)
  })

  it('a type from a newer build reads as unstated rather than throwing', () => {
    expect(asLoopType('control')).toBe('control')
    expect(asLoopType('split-range')).toBeUndefined()
    expect(asLoopType(undefined)).toBeUndefined()
    expect(LOOP_TYPES).toHaveLength(9)
  })
})

/* ---------------------------------------------- 3. EngineeringRecord.loopId */

describe('membership lives on the engineering record', () => {
  it('a record names its loop by stable id', () => {
    const loop = newLoop('101')
    const r = rec('LT-101', { loopId: loop.id })
    expect(r.loopId).toBe(loop.id)
  })

  it('the Loop itself holds no member list', () => {
    expect(Object.keys(newLoop('101'))).not.toContain('members')
  })

  /* ------------------------------------------ 13. moving between loops */

  it('moving a record between loops is one field write', () => {
    const a = newLoop('101')
    const b = newLoop('102')
    const registry: Registry = { 'LT-101': rec('LT-101', { loopId: a.id }) }
    const doc = docWith({ loops: [a, b], nodes: [node({ letters: 'LT', loop: '101' })], registry })

    expect(buildIndex(doc).loopOfKey.get('LT-101')).toBe(a.id)

    const moved = { ...doc, registry: { 'LT-101': { ...registry['LT-101']!, loopId: b.id } } }
    const ix = buildIndex(moved)
    expect(ix.loopOfKey.get('LT-101')).toBe(b.id)
    expect(ix.loopMembers.get(a.id)).toBeUndefined()
    expect(ix.loopMembers.get(b.id)).toEqual(['LT-101'])
  })

  /* --------------------------- 14. tag rename preserves loop membership */

  it('a tag rename carries loopId with the record, and adds no new reference', () => {
    const loop = newLoop('101')
    const n = node({ letters: 'LT', loop: '101' })
    const doc = docWith({
      loops: [loop],
      nodes: [n],
      registry: { 'LT-101': rec('LT-101', { loopId: loop.id, unitId: 'u1', fields: { 'general.service': 'Feed' } }) },
    })

    // applyRename's contract: the sheet ALREADY carries the new name.
    const renamedSheets = doc.sheets.map((sh) => ({
      ...sh,
      nodes: sh.nodes.map((x) => (x.id === n.id ? { ...x, tag: { letters: 'LT', loop: '201' } } : x)),
    }))
    const result = applyRename({ ...doc, sheets: renamedSheets }, 'LT-101', 'LT-201')

    expect(result.broken).toHaveLength(0)
    expect(result.doc.registry!['LT-201']!.loopId).toBe(loop.id)
    expect(result.doc.registry!['LT-101']).toBeUndefined()
    // The loop is untouched: membership is a stable id, not a tag, so a rename
    // is not a reference this had to carry.
    expect(result.doc.loops).toEqual([loop])
    // And no new machine-written reference class appeared for it.
    expect(result.applied.every((r) => r.where !== ('loop' as never))).toBe(true)
  })
})

/* ---------------------------------- 4 & 17. ProjectDoc with and without loops */

describe('ProjectDoc compatibility', () => {
  it('a document without loops builds an index with an empty loop layer', () => {
    const ix = buildIndex(createEmptyDoc('bare'))
    expect(ix.loopsById.size).toBe(0)
    expect(ix.loopMembers.size).toBe(0)
    expect(ix.loopOfKey.size).toBe(0)
  })

  it('createEmptyDoc does not invent a loops array', () => {
    expect(createEmptyDoc('bare').loops).toBeUndefined()
  })

  it('a pre-loop document still loads, unchanged and with no loops manufactured', () => {
    const legacy = {
      schemaVersion: 6,
      meta: { name: 'legacy', author: '', created: 'x', modified: 'x' },
      settings: { gridPx: 8, tagSeparator: '-' as const },
      sheets: [{ id: 's1', name: 'Sheet 1', drawingNumber: '', revision: '0', sheetSize: 'A3' as const, nodes: [node({ letters: 'LT', loop: '101' })], edges: [] }],
      hmiScreens: [],
      registry: { 'LT-101': rec('LT-101') },
    }
    const loaded = loadDoc(JSON.parse(JSON.stringify(legacy)))
    expect(loaded.loops).toBeUndefined()
    expect(loaded.registry!['LT-101']!.loopId).toBeUndefined()
    // The derived grouping still works, and was NOT converted into entities.
    expect(deriveLoops(loaded)).toHaveLength(1)
  })

  it('loops and loopId survive a serialize / load round trip byte-for-byte', () => {
    const loop = newLoop('101', { name: 'Feed flow', type: 'control', status: 'draft' })
    const doc = docWith({
      loops: [loop],
      nodes: [node({ letters: 'LT', loop: '101' })],
      registry: { 'LT-101': rec('LT-101', { loopId: loop.id }) },
    })
    const round = loadDoc(JSON.parse(serializeDoc(doc, { pretty: false })))
    expect(round.loops).toEqual([loop])
    expect(round.registry!['LT-101']!.loopId).toBe(loop.id)
    expect(round.schemaVersion).toBe(6)
  })

  it('the schema version does not move', () => {
    expect(createEmptyDoc('x').schemaVersion).toBe(6)
    const loop = newLoop('101')
    expect(loadDoc(JSON.parse(JSON.stringify({ ...createEmptyDoc('x'), loops: [loop] }))).schemaVersion).toBe(6)
  })
})

/* --------------------------------------------------- checkLoops (structural) */

describe('checkLoops refuses a malformed shape and tolerates a broken reference', () => {
  it('accepts absent, empty and well-formed arrays', () => {
    expect(checkLoops({})).toBeNull()
    expect(checkLoops({ loops: [] })).toBeNull()
    expect(checkLoops({ loops: [newLoop('101')] })).toBeNull()
  })

  it('rejects a shape that is not what it claims', () => {
    expect(checkLoops({ loops: 'nope' })).toBe('loops is malformed')
    expect(checkLoops({ loops: [null] })).toBe('loops is malformed')
    expect(checkLoops({ loops: [{ number: '101' }] })).toBe('loops is malformed')
    expect(checkLoops({ loops: [{ id: '', number: '101' }] })).toBe('loops is malformed')
    expect(checkLoops({ loops: [{ id: 'a' }] })).toBe('loops is malformed')
  })

  it('rejects a duplicate stable id, which would make membership ambiguous', () => {
    const l = newLoop('101')
    expect(checkLoops({ loops: [l, { ...l, number: '102' }] })).toContain('duplicate id')
  })

  it('tolerates an unknown type from a newer build', () => {
    expect(checkLoops({ loops: [{ id: 'x', number: '1', type: 'split-range' }] })).toBeNull()
  })

  it('the loader refuses a malformed loops array, and loads a dangling one', () => {
    const base = { ...createEmptyDoc('x'), sheets: createEmptyDoc('x').sheets }
    expect(() => loadDoc({ ...base, loops: 'nope' })).toThrow(DocError)
    // A record pointing at a loop that is gone is an engineering situation,
    // not a corrupt file: it must open so the user can repair it.
    const loaded = loadDoc(JSON.parse(JSON.stringify({ ...base, loops: [], registry: { 'LT-101': rec('LT-101', { loopId: 'ghost' }) } })))
    expect(loaded.registry!['LT-101']!.loopId).toBe('ghost')
  })
})

/* ------------------------- 5, 6. index: lookup, loopMembers, loopOfKey */

describe('ProjectIndex loop layer', () => {
  const build = () => {
    const a = newLoop('101', { type: 'control' })
    const b = newLoop('102')
    const doc = docWith({
      loops: [a, b],
      nodes: [
        node({ letters: 'LT', loop: '101' }),
        node({ letters: 'LIC', loop: '101' }),
        node({ letters: 'LV', loop: '101' }, 'valve'),
      ],
      registry: {
        'LT-101': rec('LT-101', { loopId: a.id }),
        'LIC-101': rec('LIC-101', { loopId: a.id }),
        'LV-101': rec('LV-101', { kind: 'valve', loopId: a.id }),
      },
    })
    return { a, b, ix: buildIndex(doc) }
  }

  it('looks a loop up by id', () => {
    const { a, ix } = build()
    expect(ix.loopsById.get(a.id)).toMatchObject({ number: '101', type: 'control' })
    expect(ix.loopsById.get('nope')).toBeUndefined()
  })

  it('inverts record.loopId into sorted members', () => {
    const { a, ix } = build()
    expect(ix.loopMembers.get(a.id)).toEqual(['LIC-101', 'LT-101', 'LV-101'])
  })

  it('answers which loop a key is in', () => {
    const { a, ix } = build()
    expect(ix.loopOfKey.get('LIC-101')).toBe(a.id)
    expect(ix.loopOfKey.get('PT-900')).toBeUndefined()
  })

  it('a loop with no members has no entry, by the convention the other maps use', () => {
    const { b, ix } = build()
    expect(ix.loopMembers.get(b.id)).toBeUndefined()
    expect(ix.loopMembers.get(b.id) ?? []).toEqual([])
    // It is still a real loop and still findable.
    expect(ix.loopsById.get(b.id)).toBeDefined()
  })

  /* --------------------------------- 7. missing Loop reference detection */

  it('a loopId naming no loop is left out of both maps rather than half-resolved', () => {
    const loop = newLoop('101')
    const doc = docWith({
      loops: [loop],
      nodes: [node({ letters: 'LT', loop: '101' })],
      registry: {
        'LT-101': rec('LT-101', { loopId: loop.id }),
        'PT-900': rec('PT-900', { loopId: 'ghost' }),
      },
    })
    const ix = buildIndex(doc)
    expect(ix.loopOfKey.get('PT-900')).toBeUndefined()
    expect([...ix.loopMembers.keys()]).toEqual([loop.id])
    expect(danglingLoopMembers(doc.loops, doc.registry)).toEqual([{ key: 'PT-900', loopId: 'ghost' }])
  })

  it('reports nothing when every reference resolves', () => {
    const { ix } = build()
    expect(danglingLoopMembers(ix.doc.loops, ix.doc.registry)).toEqual([])
  })
})

/* ------------------------------------------- 11. safe type suggestion */

describe('suggestLoopType only suggests what letters can actually carry', () => {
  const roles = (...m: LoopMember[]) => rolesOf(m)

  it('suggests cascade for two controllers', () => {
    expect(suggestLoopType(roles(member('TT-1', 'TT'), member('TIC-1', 'TIC'), member('FIC-1', 'FIC'), member('FV-1', 'FV')))).toBe('cascade')
  })

  it('suggests control for measurement + controller + final', () => {
    expect(suggestLoopType(roles(member('LT-1', 'LT'), member('LIC-1', 'LIC'), member('LV-1', 'LV')))).toBe('control')
  })

  it('suggests on-off for a switch driving a final element', () => {
    expect(suggestLoopType(roles(member('LSH-1', 'LSH'), member('XV-1', 'XV')))).toBe('on-off')
  })

  it('suggests indication for a measurement and a readout with no final element', () => {
    expect(suggestLoopType(roles(member('LT-1', 'LT'), member('LI-1', 'LI')))).toBe('indication')
  })

  it('NEVER suggests alarm, interlock, ratio, manual or safety', () => {
    const everyShape: LoopMember[][] = [
      [member('LSHH-1', 'LSHH'), member('XV-1', 'XV')],
      [member('LAH-1', 'LAH'), member('LSH-1', 'LSH')],
      [member('FT-1', 'FT'), member('FT-2', 'FT'), member('FFIC-1', 'FFIC'), member('FV-1', 'FV')],
      [member('HIC-1', 'HIC'), member('HV-1', 'HV')],
      [member('FT-1', 'FT')],
    ]
    const never: LoopType[] = ['alarm', 'interlock', 'ratio', 'manual', 'safety']
    for (const shape of everyShape) {
      const s = suggestLoopType(rolesOf(shape))
      if (s) expect(never).not.toContain(s)
    }
  })

  it('declines rather than guesses when there is nothing to go on', () => {
    expect(suggestLoopType(rolesOf([]))).toBeUndefined()
    expect(suggestLoopType(rolesOf([member('FY-1', 'FY')]))).toBeUndefined()
  })
})

/* ------------------- 9, 10, 12. structural completeness, per declared type */

describe('structural completeness', () => {
  const evalWith = (type: LoopType | undefined, members: LoopMember[]) =>
    evaluateLoop({ id: 'L1', number: '101', ...(type ? { type } : {}) }, members)

  const CASES: { type: LoopType; complete: LoopMember[]; short: LoopMember[]; missing: RegExp }[] = [
    {
      type: 'indication',
      complete: [member('LT-1', 'LT'), member('LI-1', 'LI')],
      short: [member('LT-1', 'LT')],
      missing: /readout/i,
    },
    {
      type: 'control',
      complete: [member('LT-1', 'LT'), member('LIC-1', 'LIC'), member('LV-1', 'LV')],
      short: [member('LT-1', 'LT'), member('LIC-1', 'LIC')],
      missing: /final control element/i,
    },
    {
      type: 'on-off',
      complete: [member('LSH-1', 'LSH'), member('XV-1', 'XV')],
      short: [member('LSH-1', 'LSH')],
      missing: /final control element/i,
    },
    {
      type: 'alarm',
      complete: [member('LT-1', 'LT'), member('LAH-1', 'LAH')],
      short: [member('LT-1', 'LT')],
      missing: /alarm \(A\) function/i,
    },
    {
      type: 'interlock',
      complete: [member('LSHH-1', 'LSHH'), member('XV-1', 'XV')],
      short: [member('LSHH-1', 'LSHH')],
      missing: /final control element/i,
    },
    {
      type: 'cascade',
      complete: [member('TT-1', 'TT'), member('TIC-1', 'TIC'), member('FIC-1', 'FIC'), member('FV-1', 'FV')],
      short: [member('TT-1', 'TT'), member('TIC-1', 'TIC'), member('TV-1', 'TV')],
      missing: /second controller/i,
    },
    {
      type: 'ratio',
      complete: [member('FT-1', 'FT'), member('FT-2', 'FT'), member('FFIC-1', 'FFIC'), member('FV-1', 'FV')],
      short: [member('FT-1', 'FT'), member('FFIC-1', 'FFIC'), member('FV-1', 'FV')],
      missing: /second measurement/i,
    },
    {
      type: 'manual',
      complete: [member('HIC-1', 'HIC'), member('HV-1', 'HV')],
      short: [member('HV-1', 'HV')],
      missing: /hand controller/i,
    },
  ]

  for (const c of CASES) {
    it(`${c.type}: a complete one reads complete`, () => {
      const e = evalWith(c.type, c.complete)
      expect(e.completeness).toBe('complete')
      expect(e.typeSource).toBe('stated')
      expect(e.missing).toEqual([])
    })

    it(`${c.type}: a short one names what is missing`, () => {
      const e = evalWith(c.type, c.short)
      expect(e.completeness).toBe('incomplete')
      expect(e.missing.join(' ')).toMatch(c.missing)
      expect(e.basis).toMatch(c.missing)
    })
  }

  it('indication does NOT require a final element', () => {
    const e = evalWith('indication', [member('LT-1', 'LT'), member('LI-1', 'LI')])
    expect(e.completeness).toBe('complete')
    expect(e.roles.final).toEqual([])
  })

  it('manual does NOT require a measurement', () => {
    const e = evalWith('manual', [member('HIC-1', 'HIC'), member('HV-1', 'HV')])
    expect(e.completeness).toBe('complete')
    expect(e.roles.transmitter).toEqual([])
    expect(e.roles.element).toEqual([])
  })

  /* -------------------------------------------- 12. safety → not-applicable */

  it('safety is not judged structurally, and says why', () => {
    const e = evalWith('safety', [member('LSHH-1', 'LSHH'), member('XV-1', 'XV')])
    expect(e.completeness).toBe('not-applicable')
    expect(e.basis).toMatch(/voting|trip|proof test/i)
  })

  it('safety stays not-applicable even when structurally short', () => {
    expect(evalWith('safety', [member('LSHH-1', 'LSHH')]).completeness).toBe('not-applicable')
  })

  /* ----------------------------------------------- "complete" is structural */

  it('a complete verdict states that it checked structure only', () => {
    const e = evalWith('control', [member('LT-1', 'LT'), member('LIC-1', 'LIC'), member('LV-1', 'LV')])
    expect(e.basis).toMatch(/structure only/i)
    expect(e.basis).not.toMatch(/correct|valid|approved/i)
  })

  /* ------------------------------------------------ 10. unknown / no info */

  it('no stated type and nothing safe to suggest reads unknown, not a guess', () => {
    const e = evalWith(undefined, [member('FY-1', 'FY')])
    expect(e.completeness).toBe('unknown')
    expect(e.typeSource).toBe('none')
    expect(e.type).toBeUndefined()
    expect(e.basis).toMatch(/no loop type is stated/i)
  })

  it('a suggested type is used, and is labelled as derived', () => {
    const e = evalWith(undefined, [member('LT-1', 'LT'), member('LIC-1', 'LIC'), member('LV-1', 'LV')])
    expect(e.completeness).toBe('complete')
    expect(e.type).toBe('control')
    expect(e.typeSource).toBe('derived')
  })

  it('a stated type always beats the suggestion', () => {
    const e = evalWith('indication', [member('LT-1', 'LT'), member('LIC-1', 'LIC'), member('LV-1', 'LV')])
    expect(e.typeSource).toBe('stated')
    expect(e.type).toBe('indication')
  })

  /* --------------------------------------- 8. empty vs broken membership */

  it('an empty loop is incomplete and explicitly NOT broken', () => {
    const e = evalWith('control', [])
    expect(e.completeness).toBe('incomplete')
    expect(e.memberCount).toBe(0)
    expect(e.undrawn).toEqual([])
    expect(e.basis).toMatch(/no members yet/i)
  })

  it('a member that is not drawn makes the loop broken, not merely incomplete', () => {
    const e = evalWith('control', [member('LT-1', 'LT'), member('LIC-1', 'LIC'), member('LV-1', 'LV', false)])
    expect(e.completeness).toBe('broken')
    expect(e.undrawn).toEqual(['LV-1'])
    // And it must NOT read as "you need a final element" — different problem,
    // different fix.
    expect(e.missing).toEqual([])
    expect(e.basis).toMatch(/not in the drawing/i)
  })

  it('broken beats every other verdict, including an unknown type', () => {
    expect(evalWith(undefined, [member('FY-1', 'FY', false)]).completeness).toBe('broken')
    expect(evalWith('safety', [member('LSHH-1', 'LSHH', false)]).completeness).toBe('broken')
  })

  it('an undrawn member contributes no role it might not have', () => {
    const e = evalWith('control', [member('LV-1', 'LV', false)])
    expect(e.roles.final).toEqual([])
  })

  it('every declared type is covered by a rule', () => {
    for (const t of LOOP_TYPES) {
      expect(() => evaluateLoop({ id: 'L', number: '1', type: t }, [member('LT-1', 'LT')])).not.toThrow()
    }
  })
})

/* ---------------------------- 15, 16. nothing existing moved underneath */

describe('the existing derived-loop behaviour is untouched', () => {
  it('deriveLoops still groups on first letter + loop number', () => {
    const doc = docWith({
      nodes: [
        node({ letters: 'FT', loop: '101' }),
        node({ letters: 'FIC', loop: '101' }),
        node({ letters: 'FV', loop: '101' }, 'valve'),
        node({ letters: 'PT', loop: '101' }),
      ],
    })
    const loops = deriveLoops(doc)
    expect(loops).toHaveLength(2)
    expect(loops.find((l) => l.family === 'F')!.members).toHaveLength(3)
  })

  it('derived loops ignore persistent loops entirely — adoption, not replacement', () => {
    const loop = newLoop('999', { type: 'cascade' })
    const nodes = [node({ letters: 'FT', loop: '101' }), node({ letters: 'FIC', loop: '101' })]
    const bare = docWith({ nodes })
    const withLoops = docWith({ loops: [loop], nodes, registry: { 'FT-101': rec('FT-101', { loopId: loop.id }) } })
    expect(deriveLoops(withLoops)).toEqual(deriveLoops(bare))
    // Both layers are present on the index, and they do not interfere.
    const ix = buildIndex(withLoops)
    expect(ix.loops).toHaveLength(1)
    expect(ix.loopsById.size).toBe(1)
  })

  it('classifyMember behaves exactly as it did in the export module', () => {
    // The move must be a move. These are the assignments the loop diagram and
    // the assistant have always depended on.
    expect(classifyMember('FE')).toBe('element')
    expect(classifyMember('FT')).toBe('transmitter')
    expect(classifyMember('FIC')).toBe('controller')
    expect(classifyMember('FV')).toBe('final')
    expect(classifyMember('FZ')).toBe('final')
    expect(classifyMember('FW')).toBe('element')
    expect(classifyMember('LSH')).toBe('switch')
    expect(classifyMember('FY')).toBe('relay')
    expect(classifyMember('FQI')).toBe('indicator')
    expect(classifyMember('FR')).toBe('indicator')
    expect(classifyMember('XX')).toBe('other')
  })

  /**
   * THE T/C REGRESSION SET.
   *
   * `classifyMember` used to ask the raw string — `letters.includes('C')`, then
   * `letters.includes('T')`. That cannot work, because isa/letters.ts lists C
   * and T in BOTH tables: C is "User's Choice" as a first letter and
   * "Controller" as a succeeding one; T is "Temperature" and "Transmitter". So
   * a tag whose MEASURED VARIABLE was C or T was read as though that letter
   * were its function.
   *
   * It now asks `validateLetters`, which is the authority on which letters are
   * functions. 513 of the 9,955 valid letter combinations change, every one of
   * them a tag whose first letter is T or C — plus ZSC, where the trailing
   * STATE letter C (Closed) was being read as Controller.
   *
   * Each expectation below is checked against `expandLetters`, the parser's
   * own plain-English reading of the same tag, so the test and the model
   * cannot drift apart about what a tag means.
   */
  it('reads the FUNCTION letters, not the measured variable', () => {
    // The cases that were wrong. expandLetters() names each one.
    expect(classifyMember('TI')).toBe('indicator') //  Temperature Indicator
    expect(classifyMember('TR')).toBe('indicator') //  Temperature Recorder
    expect(classifyMember('TSH')).toBe('switch') //    Temperature Switch High
    expect(classifyMember('TY')).toBe('relay') //      Temperature Relay
    expect(classifyMember('CT')).toBe('transmitter') //  User's Choice Transmitter
    expect(classifyMember('CIT')).toBe('transmitter') // User's Choice Indicating Transmitter
    expect(classifyMember('ZSC')).toBe('switch') //    Position Switch Closed (C is a STATE)
  })

  it('and every classification that was already right is unchanged', () => {
    // The other families were never affected — their first letter is not a
    // succeeding letter, so the old string match could not misfire.
    expect(classifyMember('LI')).toBe('indicator')
    expect(classifyMember('FI')).toBe('indicator')
    expect(classifyMember('PI')).toBe('indicator')
    expect(classifyMember('FT')).toBe('transmitter')
    expect(classifyMember('TT')).toBe('transmitter')
    expect(classifyMember('FIC')).toBe('controller')
    expect(classifyMember('TIC')).toBe('controller')
    // and the shapes that resolve before the function letters are consulted
    expect(classifyMember('PSV')).toBe('final')
    expect(classifyMember('PSE')).toBe('element')
    expect(classifyMember('TE')).toBe('element')
    expect(classifyMember('TW')).toBe('element')
    expect(classifyMember('ZSO')).toBe('switch')
    expect(classifyMember('FFIC')).toBe('controller')
    expect(classifyMember('PDT')).toBe('transmitter')
    expect(classifyMember('HIC')).toBe('controller')
    expect(classifyMember('FQI')).toBe('indicator')
    expect(classifyMember('LAH')).toBe('other')
  })

  it('the classification agrees with the parser own reading of the tag', () => {
    // A tag that expands to "... Indicator" must not classify as a
    // transmitter. This is the invariant the old code broke.
    const cases: [string, MemberRole][] = [
      ['TI', 'indicator'], ['TR', 'indicator'], ['TT', 'transmitter'],
      ['TSH', 'switch'], ['TIC', 'controller'], ['TE', 'element'], ['TV', 'final'],
    ]
    for (const [letters, role] of cases) {
      expect(classifyMember(letters), `${letters} = "${expandLetters(letters)}"`).toBe(role)
    }
  })

  it('rolesOf buckets by the same classifier the assistant uses', () => {
    const roles = rolesOf([member('LT-1', 'LT'), member('LIC-1', 'LIC'), member('LV-1', 'LV')])
    expect(roles.transmitter).toEqual(['LT-1'])
    expect(roles.controller).toEqual(['LIC-1'])
    expect(roles.final).toEqual(['LV-1'])
  })
})

/* ------------------------------------ 18. THE PROVENANCE GUARD (P2-A/P2-B) */

describe('P2-C must not disturb the standard fingerprint', () => {
  /**
   * The single most consequential thing this program could have broken.
   *
   * The 2026 platform plan proposed `EntityKind = … | 'loop'`. Taking it would
   * have widened `StandardProfile.required`, changed `canonicalStandard()`, and
   * therefore changed the fingerprint recorded on every revision ever issued
   * under the default standard — fabricating a provenance change out of a type
   * edit. Loops are their own entity precisely so this number cannot move.
   */
  it('DEFAULT_STANDARD still fingerprints to exactly 3c935cd3e3e09cd4', () => {
    expect(fingerprintStandard(DEFAULT_STANDARD)).toBe('3c935cd3e3e09cd4')
  })

  it('and loop is still not an EntityKind, nor a required-field bucket', () => {
    expect(Object.keys(DEFAULT_STANDARD.required).sort()).toEqual(['equipment', 'instrument', 'line', 'valve'])
    expect(DEFAULT_STANDARD.required).not.toHaveProperty('loop')
  })
})
