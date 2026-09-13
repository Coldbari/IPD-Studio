// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C closeout D3 — the article in front of an interpolated loop type.
 *
 * Every sentence that names a loop type builds it from a template, so the
 * article cannot be written down: 'A' + 'indication only' is "A indication
 * only loop", and the same three templates feed the Loop Manager, the loop
 * diagram, the Loop List CSV's Basis column and two QA findings at once.
 *
 * These tests pin the rule rather than the four strings that happened to be
 * wrong, because the defect is reintroduced by ADDING a loop type, not by
 * editing one of them.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import {
  articleFor, evaluateLoop, newLoop,
  LOOP_TYPES, LOOP_TYPE_LABELS,
  type LoopCompleteness, type LoopMember, type LoopType,
} from '../../src/model/loop'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { planLoopAdoption } from '../../src/model/loopAdoption'
import type { PlantNode, ProjectDoc, Tag } from '../../src/model/types'

/** 'a' standing immediately in front of a vowel-initial word — the defect
 *  itself, in whatever sentence it turns up in. */
const BAD_ARTICLE = /(^|[^A-Za-z])[Aa] [aeiouAEIOU]/

const member = (key: string, letters: string, drawn = true): LoopMember => ({ key, letters, drawn })

/* ------------------------------------------------------------- the rule */

/** What English wants before each type. Written out rather than computed, so
 *  the test cannot agree with the implementation by sharing its bug. */
const EXPECTED: Record<LoopType, 'a' | 'an'> = {
  control: 'a',
  indication: 'an',
  'on-off': 'an',
  alarm: 'an',
  interlock: 'an',
  cascade: 'a',
  ratio: 'a',
  manual: 'a',
  safety: 'a',
}

describe('the indefinite article is computed, not written', () => {
  it('covers every loop type this build has', () => {
    expect([...LOOP_TYPES].sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it('gets the article right in BOTH spellings a type is printed in', () => {
    for (const t of LOOP_TYPES) {
      // The raw key — what the adoption plan and `loop-io-conflict` print.
      expect(articleFor(t), `key ${t}`).toBe(EXPECTED[t])
      // The label — what `evaluateLoop`'s basis prints. 'on-off' vs 'on/off',
      // 'indication' vs 'indication only': different words, same answer owed.
      expect(articleFor(LOOP_TYPE_LABELS[t].toLowerCase()), `label ${t}`).toBe(EXPECTED[t])
    }
  })

  it('capitalises for the start of a sentence without changing its mind', () => {
    for (const t of LOOP_TYPES) {
      expect(articleFor(t, true), t).toBe(EXPECTED[t] === 'an' ? 'An' : 'A')
    }
  })
})

/* ------------------------------------------------- every basis it can emit */

/** Enough members to satisfy every type's required roles at once: two
 *  measurements, two controllers, a final element, a switch, an alarm
 *  function and a hand controller. */
const RICH: LoopMember[] = [
  member('FT-101', 'FT'), member('FT-102', 'FT'),
  member('FIC-101', 'FIC'), member('FIC-102', 'FIC'),
  member('FV-101', 'FV'), member('FS-101', 'FS'),
  member('FAH-101', 'FAH'), member('HIC-101', 'HIC'),
]
/** A relay and nothing else — a required role short of every type. */
const SPARSE: LoopMember[] = [member('FY-101', 'FY')]

const SHAPES: Array<[string, LoopMember[]]> = [
  ['complete', RICH],
  ['incomplete', SPARSE],
  ['empty', []],
  ['broken', [member('FT-101', 'FT'), member('FV-101', 'FV', false)]],
]

describe('no loop verdict says "a indication"', () => {
  it('sweeps every stated type against every member shape', () => {
    const seen = new Set<LoopCompleteness>()
    let checked = 0
    for (const t of LOOP_TYPES) {
      for (const [shape, members] of SHAPES) {
        const { basis, completeness } = evaluateLoop(newLoop('101', { type: t }), members)
        seen.add(completeness)
        checked += 1
        expect(basis, `${t}/${shape}: ${basis}`).not.toMatch(BAD_ARTICLE)
      }
    }
    expect(checked).toBe(LOOP_TYPES.length * SHAPES.length)
    // Not vacuous: the sweep really does reach each verdict that names a type.
    expect([...seen].sort()).toEqual(['broken', 'complete', 'incomplete', 'not-applicable'])
  })

  it('includes the unstated-type verdict, which names no type at all', () => {
    const { basis, completeness } = evaluateLoop(newLoop('101'), SPARSE)
    expect(completeness).toBe('unknown')
    expect(basis).not.toMatch(BAD_ARTICLE)
  })

  it('names the type with the article that type actually takes', () => {
    // The four that were wrong, stated exactly, so a regression is legible.
    const basisOf = (t: LoopType, m: LoopMember[]) => evaluateLoop(newLoop('101', { type: t }), m).basis
    expect(basisOf('indication', SPARSE)).toContain('An indication only loop needs')
    expect(basisOf('on-off', SPARSE)).toContain('An on/off loop needs')
    expect(basisOf('alarm', SPARSE)).toContain('An alarm loop needs')
    expect(basisOf('interlock', SPARSE)).toContain('An interlock loop needs')
    // And the ones that were already right stay right.
    expect(basisOf('control', SPARSE)).toContain('A control loop needs')
    expect(basisOf('safety', SPARSE)).toContain('A safety-related loop')
    expect(basisOf('alarm', RICH)).toContain('Every part an alarm loop needs is present')
    expect(basisOf('control', RICH)).toContain('Every part a control loop needs is present')
  })
})

/* --------------------------------------------------- the adoption sentence */

let seq = 0
const node = (tag: Tag): PlantNode => ({
  id: `n${seq++}`,
  symbolId: tag.letters.endsWith('V') ? 'cv.globe' : 'instr.bubble',
  kind: tag.letters.endsWith('V') ? 'valve' : 'instrument',
  x: 0, y: 0, rotation: 0, tag,
})

function docOf(nodes: PlantNode[]): ProjectDoc {
  const d = createEmptyDoc('Wording')
  d.sheets[0]!.nodes = nodes
  return d
}

const reasonFor = (tags: Tag[]) => planLoopAdoption(buildIndex(docOf(tags.map(node)))).rows[0]!.reason

describe('the adoption plan says what the loop looks like, in English', () => {
  it('articles a suggested indication loop', () => {
    expect(reasonFor([{ letters: 'LT', loop: '101' }, { letters: 'LI', loop: '101' }]))
      .toBe('2 members, looks like an indication loop.')
  })

  it('articles a suggested on-off loop', () => {
    expect(reasonFor([{ letters: 'LS', loop: '101' }, { letters: 'LV', loop: '101' }]))
      .toBe('2 members, looks like an on-off loop.')
  })

  it('leaves a consonant-initial suggestion alone', () => {
    expect(reasonFor([{ letters: 'LT', loop: '101' }, { letters: 'LIC', loop: '101' }, { letters: 'LV', loop: '101' }]))
      .toBe('3 members, looks like a control loop.')
  })

  it('emits no bad article for any suggestion the planner can reach', () => {
    for (const tags of [
      [{ letters: 'LT', loop: '101' }, { letters: 'LI', loop: '101' }],
      [{ letters: 'LS', loop: '101' }, { letters: 'LV', loop: '101' }],
      [{ letters: 'LT', loop: '101' }, { letters: 'LIC', loop: '101' }, { letters: 'LV', loop: '101' }],
      [{ letters: 'LIC', loop: '101' }, { letters: 'FIC', loop: '101' }, { letters: 'LT', loop: '101' }, { letters: 'LV', loop: '101' }],
      [{ letters: 'LY', loop: '101' }],
    ] as Tag[][]) {
      const reason = reasonFor(tags)
      expect(reason, reason).not.toMatch(BAD_ARTICLE)
    }
  })
})
