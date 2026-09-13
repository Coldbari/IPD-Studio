// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * D8 — `no-receiver`, after the nested scan came out of it.
 *
 * The rule's MEANING did not change, so the test that matters most is not any
 * one hand-written case: it is that the new implementation and the old one
 * agree on every document thrown at them. `legacyNoReceiver` below is the
 * pre-D8 algorithm, copied verbatim, and the equivalence block runs both over
 * randomised projects and compares the findings exactly — keys, order,
 * targets and all.
 *
 * The hand-written cases are still here, because a property test tells you
 * THAT two things agree and never WHY the answer is right.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildIndex, type ProjectIndex } from '../../src/model/projectIndex'
import { runRules } from '../../src/validate/engine'
import { noReceiver } from '../../src/validate/rules/instrumentation'
import { createEmptyDoc } from '../../src/model/doc'
import { newLoop } from '../../src/model/loop'
import { formatTag } from '../../src/isa/tag'
import type { PlantNode, ProjectDoc, Tag } from '../../src/model/types'
import type { EngineeringRecord } from '../../src/model/registry'

/* ------------------------------------------------------ the old algorithm */

/**
 * `no-receiver` exactly as it stood before D8 — the nested `allNodes.some()`
 * scan. Kept in the test rather than in `src`, so the two can be compared
 * without shipping two implementations.
 */
function legacyNoReceiver(ix: ProjectIndex): { key: string; targetId: string }[] {
  const out: { key: string; targetId: string }[] = []
  for (const n of ix.allNodes) {
    const t = n.node.tag
    if (n.node.kind !== 'instrument' || !t?.letters || !t.loop) continue
    if (t.letters.length < 2 || !t.letters.endsWith('T')) continue
    const family = t.letters[0]
    const hasReceiver = ix.allNodes.some((o) => {
      const ot = o.node.tag
      if (o.node.id === n.node.id || !ot?.letters) return false
      if (ot.letters[0] !== family || ot.loop !== t.loop) return false
      return /[ICR]/.test(ot.letters.slice(1))
    })
    if (hasReceiver) continue
    out.push({ key: `no-receiver:${n.key!}`, targetId: n.node.id })
  }
  return out
}

/* ---------------------------------------------------------------- fixtures */

let seq = 0
const node = (tag: Tag | undefined, over: Partial<PlantNode> = {}): PlantNode => ({
  id: `n${seq++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0,
  ...(tag ? { tag } : {}), ...over,
})

function docOf(nodes: PlantNode[], extra: Partial<ProjectDoc> = {}): ProjectDoc {
  const d = createEmptyDoc('nr')
  d.sheets[0]!.nodes = nodes
  return { ...d, ...extra }
}

/** Two sheets, so the cross-sheet behaviour both versions have is exercised. */
function twoSheetDoc(a: PlantNode[], b: PlantNode[]): ProjectDoc {
  const d = createEmptyDoc('nr2')
  d.sheets[0]!.nodes = a
  return {
    ...d,
    sheets: [d.sheets[0]!, { ...d.sheets[0]!, id: 'sheet-2', name: 'Sheet 2', nodes: b, edges: [] }],
  }
}

const newFindings = (doc: ProjectDoc) => {
  const g = runRules(buildIndex(doc)).groups.find((x) => x.rule.id === 'no-receiver')
  return (g?.findings ?? []).map((f) => ({ key: f.key, targetId: f.targetId! }))
}
const flagged = (doc: ProjectDoc) => newFindings(doc).map((f) => f.key.replace('no-receiver:', ''))

/* --------------------------------------------------- semantic equivalence */

describe('the new implementation agrees with the old one', () => {
  /** A deterministic PRNG, so a failure is reproducible. */
  const rng = (seed: number) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  const LETTERS = ['LT', 'FT', 'PT', 'TT', 'LIT', 'FIT', 'LIC', 'FIC', 'TIC', 'LI', 'FR', 'LV', 'FY', 'PSV', 'XV', 'T', 'LSH']
  const LOOPS = ['101', '102', '201', '']
  const KINDS: PlantNode['kind'][] = ['instrument', 'valve', 'equipment', 'annotation', 'fitting']

  it('produces identical findings over 400 randomised projects', () => {
    let compared = 0
    let withFindings = 0

    for (let t = 0; t < 400; t++) {
      const rand = rng(t + 1)
      const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
      const make = (n: number) => Array.from({ length: n }, () => {
        const letters = pick(LETTERS)
        const loop = pick(LOOPS)
        return node(
          rand() < 0.1 ? undefined : { letters, ...(loop ? { loop } : { loop: '' }) },
          { kind: pick(KINDS) },
        )
      })

      // Half single-sheet, half split across two, so a receiver on another
      // sheet is exercised — both versions look at every sheet.
      const size = 2 + Math.floor(rand() * 10)
      const doc = t % 2 === 0
        ? docOf(make(size))
        : twoSheetDoc(make(Math.ceil(size / 2)), make(Math.floor(size / 2)))

      const ix = buildIndex(doc)
      const legacy = legacyNoReceiver(ix)
      // The RULES are compared directly, not through `runRules` — the engine
      // de-duplicates per (rule, entity), so one tag drawn twice yields two raw
      // findings and one reported one. Comparing raw against reported would be
      // measuring the engine, not the change.
      const now = noReceiver.run(ix).map((f) => ({ key: f.key, targetId: f.targetId! }))

      expect(now, `case ${t}`).toEqual(legacy)
      compared += 1
      if (legacy.length) withFindings += 1
    }

    expect(compared).toBe(400)
    // Guard against a vacuous pass: the corpus must actually produce findings.
    expect(withFindings).toBeGreaterThan(50)
  })
})

/* ------------------------------------------------------ hand-written cases */

describe('what no-receiver means', () => {
  it('flags a transmitter with nobody reading it', () => {
    expect(flagged(docOf([node({ letters: 'LT', loop: '101' })]))).toEqual(['LT-101'])
  })

  it('clears once an indicator or a controller shares the loop', () => {
    for (const receiver of ['LIC', 'LI', 'LR']) {
      const doc = docOf([node({ letters: 'LT', loop: '101' }), node({ letters: receiver, loop: '101' })])
      expect(flagged(doc), receiver).toEqual([])
    }
  })

  it('a receiver in a DIFFERENT loop or family does not count', () => {
    expect(flagged(docOf([
      node({ letters: 'LT', loop: '101' }),
      node({ letters: 'LIC', loop: '102' }),
      node({ letters: 'FIC', loop: '101' }),
    ]))).toEqual(['LT-101'])
  })

  it('handles several loops independently', () => {
    expect(flagged(docOf([
      node({ letters: 'LT', loop: '101' }), node({ letters: 'LIC', loop: '101' }),
      node({ letters: 'FT', loop: '201' }),
      node({ letters: 'PT', loop: '301' }), node({ letters: 'PI', loop: '301' }),
      node({ letters: 'TT', loop: '401' }),
    ])).sort()).toEqual(['FT-201', 'TT-401'])
  })

  it('only instruments are candidates — a valve or equipment tagged …T is not', () => {
    expect(flagged(docOf([
      node({ letters: 'LT', loop: '101' }, { kind: 'valve' }),
      node({ letters: 'FT', loop: '201' }, { kind: 'equipment' }),
      node({ letters: 'PT', loop: '301' }, { kind: 'annotation' }),
    ]))).toEqual([])
  })

  it('but a receiver of ANY kind counts, which is what the old scan did', () => {
    // A valve tagged LIC-101 is odd, and it still satisfied the old rule.
    const doc = docOf([
      node({ letters: 'LT', loop: '101' }),
      node({ letters: 'LIC', loop: '101' }, { kind: 'valve' }),
    ])
    expect(flagged(doc)).toEqual([])
  })

  it('an untagged or loop-less node is neither candidate nor receiver', () => {
    expect(flagged(docOf([
      node({ letters: 'LT', loop: '101' }),
      node(undefined),
      node({ letters: 'LIC', loop: '' }),
    ]))).toEqual(['LT-101'])
  })

  it('a one-letter tag is not a candidate and not a receiver', () => {
    expect(flagged(docOf([
      node({ letters: 'T', loop: '101' }),
      node({ letters: 'LT', loop: '101' }),
    ]))).toEqual(['LT-101'])
  })

  it('a final element is not a receiver — a valve does not read anything', () => {
    expect(flagged(docOf([
      node({ letters: 'LT', loop: '101' }),
      node({ letters: 'LV', loop: '101' }, { kind: 'valve' }),
      node({ letters: 'LY', loop: '101' }),
    ]))).toEqual(['LT-101'])
  })

  it('finds a receiver on another sheet', () => {
    const doc = twoSheetDoc(
      [node({ letters: 'LT', loop: '101' })],
      [node({ letters: 'LIC', loop: '101' })],
    )
    expect(flagged(doc)).toEqual([])
  })
})

/* ------------------------------------- the self-exclusion the count preserves */

describe('a tag that is both a measurement and a receiver', () => {
  it('LIT alone is NOT received — it cannot receive itself', () => {
    // Ends in T so it is a candidate; carries an I so it is receiver-shaped.
    // The old scan excluded the candidate by NODE ID, so it was flagged.
    expect(flagged(docOf([node({ letters: 'LIT', loop: '101' })]))).toEqual(['LIT-101'])
  })

  it('two LIT-101 drawn twice DO receive each other — by node id, not by tag', () => {
    // The same engineering tag on two symbols: an off-page continuation. Two
    // distinct node ids, so each is the other's receiver. A boolean "does this
    // loop contain a receiver" would have got the single-node case wrong.
    const doc = docOf([
      node({ letters: 'LIT', loop: '101' }),
      node({ letters: 'LIT', loop: '101' }),
    ])
    expect(flagged(doc)).toEqual([])
  })

  it('LIT is cleared by a separate receiver', () => {
    expect(flagged(docOf([
      node({ letters: 'LIT', loop: '101' }),
      node({ letters: 'LIC', loop: '101' }),
    ]))).toEqual([])
  })

  it('two DIFFERENT receiver-shaped transmitters clear each other', () => {
    expect(flagged(docOf([
      node({ letters: 'LIT', loop: '101' }),
      node({ letters: 'LRT', loop: '101' }),
    ]))).toEqual([])
  })
})

/* ------------------------------------------------- suffixes and duplicates */

describe('suffixed and duplicated tags', () => {
  it('a suffix does not split the loop — LT-101A is received by LIC-101', () => {
    const doc = docOf([
      node({ letters: 'LT', loop: '101', suffix: 'A' }),
      node({ letters: 'LIC', loop: '101' }),
    ])
    expect(flagged(doc)).toEqual([])
  })

  it('two suffixed transmitters with one receiver are both cleared', () => {
    const doc = docOf([
      node({ letters: 'LT', loop: '101', suffix: 'A' }),
      node({ letters: 'LT', loop: '101', suffix: 'B' }),
      node({ letters: 'LIC', loop: '101' }),
    ])
    expect(flagged(doc)).toEqual([])
  })

  it('one tag drawn twice is reported ONCE — the engine keys on the entity', () => {
    const doc = docOf([node({ letters: 'LT', loop: '101' }), node({ letters: 'LT', loop: '101' })])
    // The rule emits one finding per NODE; `runRules` collapses them to one per
    // (rule, engineering key). Both halves of that are unchanged by D8, and
    // both are asserted so a future change to either is visible.
    expect(noReceiver.run(buildIndex(doc))).toHaveLength(2)
    expect(flagged(doc)).toEqual(['LT-101'])
  })
})

/* ---------------------------------------------- unchanged externals */

describe('nothing externally observable moved', () => {
  it('keeps its id, severity, discipline and message', () => {
    const doc = docOf([node({ letters: 'LT', loop: '101' })])
    const group = runRules(buildIndex(doc)).groups.find((g) => g.rule.id === 'no-receiver')!
    expect(group.rule).toMatchObject({ id: 'no-receiver', severity: 'warning', discipline: 'instrumentation' })
    expect(group.findings[0]!.message).toBe(
      `${formatTag({ letters: 'LT', loop: '101' }, '-')} measures but nothing receives it — add an indicator or controller?`,
    )
    expect(group.findings[0]!.key).toBe('no-receiver:LT-101')
  })

  it('is unaffected by persistent loops, which it does not read', () => {
    const loop = newLoop('101', { type: 'control' })
    const nodes = [node({ letters: 'LT', loop: '101' })]
    const bare = docOf(nodes)
    const withLoop = docOf(nodes, {
      loops: [loop],
      registry: { 'LT-101': { key: 'LT-101', kind: 'instrument', fields: {}, loopId: loop.id } as EngineeringRecord },
    })
    expect(flagged(withLoop)).toEqual(flagged(bare))
    expect(flagged(withLoop)).toEqual(['LT-101'])
  })

  it('still honours a severity override', () => {
    const doc = docOf([node({ letters: 'LT', loop: '101' })])
    const std = { ...buildIndex(doc).standard, severityOverrides: { 'no-receiver': 'off' as const } }
    const report = runRules(buildIndex({ ...doc, standard: std }))
    expect(report.groups.find((g) => g.rule.id === 'no-receiver')).toBeUndefined()
    expect(report.rulesDisabled).toContain('no-receiver')
  })
})
