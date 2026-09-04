import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { DOC_KEY_DISPOSITION, disclosureFor, redactBrief } from '../../src/assist/redact'
import { selectionBrief } from '../../src/assist/context'
import { createEmptyDoc } from '../../src/model/doc'
import { useStore } from '../../src/store/store'

const st = () => useStore.getState()

/**
 * The privacy mechanism.
 *
 * A new field on ProjectDoc is the moment a leak gets introduced — somebody
 * adds `doc.notes` or `doc.client` and the projection quietly starts carrying
 * it. This test fails on that, forcing a decision to be recorded in
 * redact.ts before the field can ship.
 */
describe('the transmission allowlist', () => {
  it('classifies every top-level key of a real ProjectDoc', () => {
    st().loadIntoStore(createEmptyDoc('redact'))
    const doc = st().doc
    // exercise the optional keys so they actually exist on the object
    st().setBudget({ currency: '$', total: 1000 })
    st().addFluid('Water', '#39f')
    st().setRecordField('FT-101', 'instrument', 'signal.range', '0-100')

    const keys = new Set([...Object.keys(doc), ...Object.keys(st().doc)])
    const unclassified = [...keys].filter((k) => !(k in DOC_KEY_DISPOSITION))

    expect(
      unclassified,
      `Unclassified ProjectDoc key(s): ${unclassified.join(', ')}.\n`
      + 'Add each to DOC_KEY_DISPOSITION in src/assist/redact.ts with an explicit\n'
      + "disposition ('send' or 'never') and the reason. Do not guess — a field\n"
      + 'nobody classified is a field that leaks.',
    ).toEqual([])
  })

  it('gives every classified key a reason, not just a verdict', () => {
    for (const [key, entry] of Object.entries(DOC_KEY_DISPOSITION)) {
      expect(entry.why.length, `${key} has no stated reason`).toBeGreaterThan(20)
      expect(['send', 'never']).toContain(entry.disposition)
    }
  })

  it('never sends the author name', () => {
    st().loadIntoStore(createEmptyDoc('redact'))
    st().setMeta({ author: 'Praharsh Nagpure' })
    const b = redactBrief(selectionBrief(st().doc, st().activeSheetId, st().selection))
    expect(JSON.stringify(b)).not.toContain('Praharsh Nagpure')
  })

  it('keeps the project name, which an engineer actually refers to', () => {
    st().loadIntoStore(createEmptyDoc('Feed Water Unit'))
    const b = redactBrief(selectionBrief(st().doc, st().activeSheetId, st().selection))
    expect(b.project.name).toBe('Feed Water Unit')
  })

  it('states the disclosure in terms of what is sent, not vague reassurance', () => {
    st().loadIntoStore(createEmptyDoc('d'))
    st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    const text = disclosureFor(st().doc)
    expect(text).toMatch(/1 tagged item/)
    expect(text).toMatch(/underlay/i)
  })
})
