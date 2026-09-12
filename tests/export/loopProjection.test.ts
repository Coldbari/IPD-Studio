// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 4 — the loop diagram as a PROJECTION.
 *
 * Two paths, one renderer. The derived path is what every project without
 * declared loops has always had and must keep; the persistent path draws a
 * declared Loop from its engineering records.
 *
 * Neither is a wiring diagram, and the sheet says so.
 */

import { describe, expect, it } from 'vitest'
import { XMLValidator } from 'fast-xml-parser'
import '../../src/symbols/lib/index'
import { loopDiagramSvg, persistentLoopDiagramSvg } from '../../src/export/loopDiagram'
import { createEmptyDoc } from '../../src/model/doc'
import { newLoop, type Loop } from '../../src/model/loop'
import { applyRename } from '../../src/model/references'
import type { EngineeringRecord, Registry } from '../../src/model/registry'
import type { PlantNode, ProjectDoc, Tag } from '../../src/model/types'

let seq = 0
const node = (tag: Tag, over: Partial<PlantNode> = {}): PlantNode => ({
  id: `n${seq++}`,
  symbolId: tag.letters.endsWith('V') ? 'cv.globe' : 'instr.bubble',
  kind: tag.letters.endsWith('V') ? 'valve' : 'instrument',
  x: 0, y: 0, rotation: 0, tag, ...over,
})
const rec = (key: string, loopId: string): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, loopId })

function docOf(loops: Loop[], nodes: PlantNode[], registry: Registry = {}): ProjectDoc {
  const d = createEmptyDoc('Loop Test')
  d.sheets[0]!.nodes = nodes
  return { ...d, loops, registry }
}

/** A declared control loop with all three members drawn. */
function declared(over: Partial<Loop> = {}) {
  const loop = { ...newLoop('101', { type: 'control' }), ...over }
  const nodes = [
    node({ letters: 'LT', loop: '101' }),
    node({ letters: 'LIC', loop: '101' }),
    node({ letters: 'LV', loop: '101' }),
  ]
  return {
    loop,
    doc: docOf([loop], nodes, {
      'LT-101': rec('LT-101', loop.id),
      'LIC-101': rec('LIC-101', loop.id),
      'LV-101': rec('LV-101', loop.id),
    }),
  }
}

/* --------------------------------------------------------- persistent path */

describe('a declared loop projects onto the diagram', () => {
  it('renders valid SVG titled with the loop NUMBER, never the id', () => {
    const { doc, loop } = declared()
    const svg = persistentLoopDiagramSvg(doc, loop.id)
    expect(XMLValidator.validate(svg)).toBe(true)
    expect(svg).toContain('LOOP 101')
    expect(svg).not.toContain(loop.id)
  })

  it('draws its persistent membership, from the records', () => {
    const { doc, loop } = declared()
    const svg = persistentLoopDiagramSvg(doc, loop.id)
    for (const tag of ['LT-101', 'LIC-101', 'LV-101']) expect(svg).toContain(tag)
  })

  it('renumbering changes what is printed and not which loop it is', () => {
    const { doc, loop } = declared()
    const renumbered = { ...doc, loops: [{ ...loop, number: '201' }] }
    const svg = persistentLoopDiagramSvg(renumbered, loop.id)
    expect(svg).toContain('LOOP 201')
    expect(svg).not.toContain('LOOP 101')
  })

  it('a renamed member tag is reflected through the registry, with no diagram state', () => {
    const { doc, loop } = declared()
    const renamedSheets = doc.sheets.map((sh) => ({
      ...sh,
      nodes: sh.nodes.map((n) => (n.tag?.letters === 'LT' ? { ...n, tag: { letters: 'LT', loop: '201' } } : n)),
    }))
    const after = applyRename({ ...doc, sheets: renamedSheets }, 'LT-101', 'LT-201').doc

    const svg = persistentLoopDiagramSvg(after, loop.id)
    expect(svg).toContain('LT-201')
    expect(svg).not.toContain('LT-101')
    // The loop itself never learned that a rename happened.
    expect(after.loops).toEqual(doc.loops)
  })

  it('states the declared type and the structural verdict', () => {
    const { doc, loop } = declared()
    const svg = persistentLoopDiagramSvg(doc, loop.id)
    expect(svg).toContain('Control')
    expect(svg).toContain('Structurally complete')
  })

  it('marks a suggested type as suggested', () => {
    const loop = newLoop('101')
    const nodes = [node({ letters: 'LT', loop: '101' }), node({ letters: 'LI', loop: '101' })]
    const doc = docOf([loop], nodes, {
      'LT-101': rec('LT-101', loop.id), 'LI-101': rec('LI-101', loop.id),
    })
    const svg = persistentLoopDiagramSvg(doc, loop.id)
    expect(svg).toContain('suggested')
    expect(svg).toContain('Indication only')
  })

  it('says structurally incomplete, and never claims correctness', () => {
    const loop = newLoop('101', { type: 'control' })
    const nodes = [node({ letters: 'LT', loop: '101' }), node({ letters: 'LIC', loop: '101' })]
    const doc = docOf([loop], nodes, {
      'LT-101': rec('LT-101', loop.id), 'LIC-101': rec('LIC-101', loop.id),
    })
    const svg = persistentLoopDiagramSvg(doc, loop.id)
    expect(svg).toContain('Structurally incomplete')
    expect(svg).not.toMatch(/valid loop|engineering correct|approved/i)
  })

  it('draws a member that is not on any sheet, and says the loop is broken', () => {
    const loop = newLoop('101', { type: 'control' })
    // LT-101 has a record and a membership; nothing on the sheet wears it.
    const doc = docOf([loop], [node({ letters: 'LIC', loop: '101' })], {
      'LT-101': rec('LT-101', loop.id), 'LIC-101': rec('LIC-101', loop.id),
    })
    const svg = persistentLoopDiagramSvg(doc, loop.id)
    expect(svg).toContain('LT-101')
    expect(svg).toContain('Broken membership')
  })

  it('refuses a loop that is not in the project rather than drawing an empty sheet', () => {
    const { doc } = declared()
    expect(() => persistentLoopDiagramSvg(doc, 'ghost')).toThrow()
  })

  it('producing the diagram persists nothing', () => {
    const { doc, loop } = declared()
    const before = JSON.stringify(doc)
    persistentLoopDiagramSvg(doc, loop.id)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

/* ------------------------------------------------------------ derived path */

describe('the derived path is unchanged', () => {
  const derivedDoc = () =>
    docOf([], [
      node({ letters: 'FT', loop: '101' }),
      node({ letters: 'FIC', loop: '101' }),
      node({ letters: 'FV', loop: '101' }),
    ])

  it('still renders for a project that has declared no loops', () => {
    const doc = derivedDoc()
    expect(doc.loops).toEqual([])
    const svg = loopDiagramSvg(doc, 'F', '101')
    expect(XMLValidator.validate(svg)).toBe(true)
    expect(svg).toContain('LOOP F-101')
    expect(svg).toContain('FT-101')
  })

  it('keeps its column layout and its numbered terminals', () => {
    const svg = loopDiagramSvg(derivedDoc(), 'F', '101')
    const ftX = Number(/data-member="FT-101" data-x="(\d+)"/.exec(svg)?.[1])
    const ficX = Number(/data-member="FIC-101" data-x="(\d+)"/.exec(svg)?.[1])
    expect(ftX).toBeLessThan(400)
    expect(ficX).toBeGreaterThan(600)
    expect(svg).toContain('>1<')
    expect(svg).toContain('>2<')
  })

  it('carries no loop type or structural verdict — it has neither', () => {
    const svg = loopDiagramSvg(derivedDoc(), 'F', '101')
    expect(svg).not.toContain('Structurally')
    expect(svg).not.toContain('suggested')
  })

  it('is unaffected by a declared loop existing elsewhere in the project', () => {
    const bare = derivedDoc()
    const other = newLoop('999', { type: 'cascade' })
    const withLoop = { ...bare, loops: [other] }
    expect(loopDiagramSvg(withLoop, 'F', '101')).toBe(loopDiagramSvg(bare, 'F', '101'))
  })
})

/* ------------------------------------------------------------ the disclaimer */

describe('both sheets say what they are', () => {
  it('names itself a projection rather than a verified wiring diagram', () => {
    const { doc, loop } = declared()
    for (const svg of [persistentLoopDiagramSvg(doc, loop.id), loopDiagramSvg(docOf([], [
      node({ letters: 'FT', loop: '101' }), node({ letters: 'FIC', loop: '101' }),
    ]), 'F', '101')]) {
      expect(svg).toContain('Loop projection')
      expect(svg).toMatch(/not a verified wiring diagram/i)
    }
  })
})
