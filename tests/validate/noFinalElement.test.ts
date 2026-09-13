// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3 PROGRAM 2 — the `no-final-element` correctness fix.
 *
 * The rule asked `letters.includes('C') && !letters.endsWith('V')`, which
 * cannot work: C is "User's Choice" as a FIRST letter and "Controller" as a
 * succeeding one (isa/letters.ts). So CT-101 — a user's-choice transmitter —
 * was told it "controls nothing — where is its valve?".
 *
 * The same defect was found in `classifyMember` during P2-C and fixed there
 * against the authoritative parser. This was the last place still asking the
 * raw string, and it now asks `classifyMember` too, so the rule and the loop
 * evaluator cannot disagree about what a controller is.
 *
 * The tests below do not just spot-check CT. They keep the OLD predicate
 * verbatim and compare both over every ISA letter combination, so "existing
 * behaviour otherwise unchanged" is proved rather than asserted.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules } from '../../src/validate/engine'
import { createEmptyDoc } from '../../src/model/doc'
import { classifyMember } from '../../src/model/loop'
import { FIRST_LETTERS, SUCCEEDING_LETTERS, TRAILING_MODIFIERS } from '../../src/isa/letters'
import { validateLetters } from '../../src/isa/tag'
import type { PlantEdge, PlantNode, ProjectDoc, Tag } from '../../src/model/types'

/** The predicate as it stood at 609e476, kept verbatim. */
const legacyIsController = (letters: string): boolean =>
  letters.includes('C') && !letters.endsWith('V')

const nowIsController = (letters: string): boolean => classifyMember(letters) === 'controller'

let seq = 0
const bubble = (tag: Tag): PlantNode =>
  ({ id: `n${seq++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag })
const valveNode = (tag: Tag): PlantNode =>
  ({ id: `v${seq++}`, symbolId: 'cv.globe', kind: 'valve', x: 0, y: 0, rotation: 0, tag })

function docOf(nodes: PlantNode[], edges: PlantEdge[] = []): ProjectDoc {
  const d = createEmptyDoc('nfe')
  d.sheets[0]!.nodes = nodes
  d.sheets[0]!.edges = edges
  return d
}

const findingsFor = (doc: ProjectDoc) =>
  runRules(buildIndex(doc)).groups.find((g) => g.rule.id === 'no-final-element')?.findings ?? []

/* --------------------------------------------------------- the defect */

describe('a first-letter C is no longer mistaken for a controller', () => {
  it('CT-101 is a user’s-choice TRANSMITTER and is left alone', () => {
    expect(findingsFor(docOf([bubble({ letters: 'CT', loop: '101' })]))).toHaveLength(0)
    // And the old predicate is why it used to be reported.
    expect(legacyIsController('CT')).toBe(true)
    expect(nowIsController('CT')).toBe(false)
  })

  it('leaves every other first-letter-C tag alone too', () => {
    for (const letters of ['CI', 'CR', 'CS', 'CE', 'CW', 'CG', 'CAH', 'CT']) {
      expect(findingsFor(docOf([bubble({ letters, loop: '200' })])), letters).toHaveLength(0)
    }
  })

  it('but a user’s-choice CONTROLLER is still a controller', () => {
    // CIC: C measured, I and C succeeding. The succeeding C is a real one.
    const found = findingsFor(docOf([bubble({ letters: 'CIC', loop: '101' })]))
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('CIC-101')
  })
})

/* ------------------------------------------------- unchanged otherwise */

describe('a genuine controller is still reported', () => {
  it('flags FIC with no valve, and clears when its valve exists', () => {
    expect(findingsFor(docOf([bubble({ letters: 'FIC', loop: '100' })]))).toHaveLength(1)
    expect(findingsFor(docOf([
      bubble({ letters: 'FIC', loop: '100' }),
      valveNode({ letters: 'FV', loop: '100' }),
    ]))).toHaveLength(0)
  })

  it('flags the controllers the loop evaluator also calls controllers', () => {
    for (const letters of ['FIC', 'LIC', 'TC', 'PC', 'HIC', 'ZC', 'FCC', 'CIC']) {
      expect(classifyMember(letters), letters).toBe('controller')
      expect(findingsFor(docOf([bubble({ letters, loop: '300' })])), letters).toHaveLength(1)
    }
  })

  it('and ZSC is a position switch, CLOSED — not a controller', () => {
    // The second false positive the fix removes, and it does not start with C.
    // The parser reads ZSC as Z measured / S function / C STATE, exactly as it
    // reads the HH of LSHH. A position switch was being asked where its valve
    // was because the raw string contained the letter.
    expect(validateLetters('ZSC').parts.map((p) => `${p.letter}:${p.role}`)).toEqual(['Z:measured', 'S:function', 'C:state'])
    expect(classifyMember('ZSC')).toBe('switch')
    expect(legacyIsController('ZSC')).toBe(true)
    expect(findingsFor(docOf([bubble({ letters: 'ZSC', loop: '800' })]))).toHaveLength(0)
  })

  it('still ignores a control valve, which ends in V', () => {
    for (const letters of ['FCV', 'LCV', 'CV']) {
      expect(findingsFor(docOf([bubble({ letters, loop: '400' })])), letters).toHaveLength(0)
    }
  })

  it('still ignores an untagged instrument, a loopless tag and a valve symbol', () => {
    expect(findingsFor(docOf([{ ...bubble({ letters: 'FIC', loop: '1' }), tag: undefined }]))).toHaveLength(0)
    expect(findingsFor(docOf([bubble({ letters: 'FIC', loop: '' })]))).toHaveLength(0)
    // The candidate must be an instrument; a valve wearing controller letters
    // is not asked where its valve is.
    expect(findingsFor(docOf([valveNode({ letters: 'FIC', loop: '500' })]))).toHaveLength(0)
  })

  it('still clears on a WIRED valve within three signal hops', () => {
    const fic = bubble({ letters: 'FIC', loop: '600' })
    const fy = bubble({ letters: 'FY', loop: '601' })
    const fv = valveNode({ letters: 'PV', loop: '999' })
    const wire = (id: string, a: string, b: string): PlantEdge =>
      ({ id, lineClass: 'signal.electric', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    expect(findingsFor(docOf([fic, fy, fv], [wire('w1', fic.id, fy.id), wire('w2', fy.id, fv.id)]))).toHaveLength(0)
  })

  it('keeps its id, severity, discipline and message', () => {
    const report = runRules(buildIndex(docOf([bubble({ letters: 'FIC', loop: '700' })])))
    const group = report.groups.find((g) => g.rule.id === 'no-final-element')!
    expect(group.rule.severity).toBe('warning')
    expect(group.rule.discipline).toBe('instrumentation')
    expect(group.findings[0]!.message).toBe('FIC-700 controls nothing — where is its valve?')
    expect(group.findings[0]!.key).toBe('no-final-element:FIC-700')
  })
})

/* -------------------------------------------- the exhaustive comparison */

describe('what the fix changes, over every ISA tag there is', () => {
  /** Every 1-3 letter combination the parser could be handed. */
  function allLetters(): string[] {
    const first = Object.keys(FIRST_LETTERS)
    const succ = Object.keys(SUCCEEDING_LETTERS)
    const trail = Object.keys(TRAILING_MODIFIERS)
    const out: string[] = []
    for (const a of first) {
      out.push(a)
      for (const b of succ) {
        out.push(a + b)
        for (const c of [...succ, ...trail]) out.push(a + b + c)
      }
    }
    return out
  }

  const combos = allLetters()
  const removed = combos.filter((l) => legacyIsController(l) && !nowIsController(l))

  it('covers the whole alphabet, not a sample of it', () => {
    expect(combos).toHaveLength(12506)
  })

  /**
   * THE SAFETY PROPERTY. A QA fix that starts reporting tags nobody was being
   * asked about before would land findings on projects that have not changed.
   * This one cannot: `classifyMember` returns 'controller' only when a FUNCTION
   * letter is C, which implies the string contains C, and it rules out a
   * terminal V first — so the new predicate is a strict subset of the old.
   */
  it('NEVER reports a tag the old predicate did not — the fix only removes', () => {
    expect(combos.filter((l) => nowIsController(l) && !legacyIsController(l))).toEqual([])
  })

  it('removes 546 of 12,506, and every one of them for a reason the PARSER gives', () => {
    expect(removed).toHaveLength(546)

    /** Why `classifyMember` declines a tag the raw string accepted. Read off
     *  the parse, never guessed from letter position. */
    const reasonFor = (letters: string): string => {
      const last = letters[letters.length - 1]!
      // Read off the LAST letter before any function letter is considered: a
      // terminal Z is a final element and a terminal E or W is a primary
      // element. Neither controls anything, so neither is asked for a valve.
      if (last === 'Z' || last === 'E' || last === 'W') return 'terminal-element'
      const parsed = validateLetters(letters)
      // Not a legal ISA string at all — V may only be terminal. `invalid-letters`
      // already reports these, at critical.
      if (!parsed.ok) return 'malformed'
      const roles = parsed.parts.filter((part) => part.letter === 'C').map((part) => part.role)
      // Would mean the parser calls C a function letter and `classifyMember`
      // still declined — which would be a real disagreement, not a fix.
      if (roles.includes('function')) return 'UNEXPECTED'
      return roles.length ? `c-is-${[...new Set(roles)].sort().join('+')}` : 'c-absent'
    }

    const byReason = new Map<string, string[]>()
    for (const letters of removed) {
      const reason = reasonFor(letters)
      byReason.set(reason, [...(byReason.get(reason) ?? []), letters])
    }

    // Four buckets, all four real, nothing outside them, and nothing the
    // parser and the classifier disagree about.
    expect([...byReason.keys()].sort()).toEqual(['c-is-measured', 'c-is-state', 'malformed', 'terminal-element'])
    expect(byReason.get('terminal-element')).toHaveLength(138)

    // The defect CT-101 is: the only C is the measured variable, User's Choice.
    for (const letters of byReason.get('c-is-measured')!) {
      expect(letters[0], letters).toBe('C')
      expect(classifyMember(letters), letters).not.toBe('controller')
    }
    expect(byReason.get('c-is-measured')).toContain('CT')

    // The one nobody was looking for: a trailing C read as a STATE, which is
    // how ZSC says "position switch, closed".
    expect(byReason.get('c-is-state')).toContain('ZSC')
    for (const letters of byReason.get('c-is-state')!) {
      expect(classifyMember(letters), letters).not.toBe('controller')
    }

    expect(byReason.get('terminal-element')).toContain('ACE')
  })

  it('agrees with the old predicate on every well-formed tag whose C is a function letter', () => {
    for (const letters of combos) {
      const last = letters[letters.length - 1]!
      if (last === 'Z' || last === 'E' || last === 'W') continue
      const parsed = validateLetters(letters)
      if (!parsed.ok) continue
      const cIsFunction = parsed.parts.some((part) => part.letter === 'C' && part.role === 'function')
      if (!cIsFunction) continue
      expect(nowIsController(letters), letters).toBe(legacyIsController(letters))
    }
  })

  it('still calls 964 well-formed tags controllers, every one with a function C', () => {
    const kept = combos.filter((l) => validateLetters(l).ok && nowIsController(l))
    expect(kept).toHaveLength(964)
    for (const letters of kept) {
      expect(validateLetters(letters).parts.some((p) => p.letter === 'C' && p.role === 'function'), letters).toBe(true)
    }
  })
})
