// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { searchPalette } from '../../src/panels/instrumentPresets'
import { resetSymbolIndex, searchSymbols, SYMBOLS } from '../../src/symbols/registry'

/** Labels of the palette's answer, in order. */
const hits = (q: string) => searchPalette(q).map((h) => h.label)

describe('ISA shortcuts beat coincidences', () => {
  // The whole point: two letters inside a longer word is not an answer.
  it('a two-letter code returns the instrument, not the word that contains it', () => {
    expect(hits('FT')[0]).toBe('FT')          // was: FT, Crystallizer, Fan (Axial)
    expect(hits('FT')).not.toContain('Crystallizer')
    expect(hits('FT')).not.toContain('Fan (Axial)')

    expect(hits('PT')[0]).toBe('PT')          // was: PT, Rupture Disc, Rupture Pin Valve
    expect(hits('PT')).not.toContain('Rupture Disc')

    expect(hits('LT')[0]).toBe('LT')          // was: LT + eleven wrong answers
    expect(hits('LT')).not.toContain('Belt Conveyor')
    expect(hits('LT')).not.toContain('Ultrasonic Flowmeter')

    expect(hits('TT')[0]).toBe('TT')          // was: TT + every "transmitter"
    expect(hits('TT')).not.toContain('FIT')
  })

  it('a longer shortcut that starts with the query follows the exact one', () => {
    const fi = hits('FI')
    expect(fi[0]).toBe('FI')
    expect(fi.slice(1, 3)).toEqual(['FIC', 'FIT'])
    // and a name that merely begins with the same letters comes after them
    expect(fi.indexOf('Filled Bulb + Capillary')).toBeGreaterThan(fi.indexOf('FIT'))
  })

  it('a code with no preset finds the symbols whose id says it', () => {
    // "CV" used to put three regulators above the control valves, because
    // "cv" sits inside "pcv", "tcv" and "bpcv".
    expect(hits('CV')).toEqual([
      'Control Valve (Ball)', 'Control Valve (Butterfly)', 'Control Valve (Globe)',
    ])
    expect(hits('PSV')[0]).toBe('Pressure Safety Valve')  // exact id before psv.pilot
  })
})

describe('what a thing IS beats what it is described as', () => {
  it('pumps rank above a valve that carries the keyword "pump"', () => {
    const r = hits('pump')
    expect(r[0]).toBe('Centrifugal Pump')
    expect(r.indexOf('Foot Valve')).toBeGreaterThan(r.indexOf('Vacuum Pump'))
    expect(r.indexOf('Foot Valve')).toBeGreaterThan(0)
  })

  it('a name that IS the query beats one that merely contains it', () => {
    expect(hits('globe valve')[0]).toBe('Globe Valve')
    expect(hits('gate valve')[0]).toBe('Gate Valve')
    expect(hits('gate')[0]).toBe('Gate Valve')          // before AND Gate
    expect(hits('tank').slice(0, 3)).toEqual([
      'Floating-Roof Tank', 'Open Tank / Pit', 'Storage Tank',
    ])
  })

  it('a name match beats an id match', () => {
    const v = hits('vessel')
    expect(v.slice(0, 2)).toEqual(['Horizontal Vessel', 'Vertical Vessel'])
    expect(v).toContain('Bullet')  // reached through `vessel.bullet`
  })
})

describe('natural language still works', () => {
  it('multi-word searches find what Phase 4 taught them to find', () => {
    expect(hits('heat exchanger')).toContain('Shell & Tube Exchanger')
    expect(hits('control valve')).toEqual([
      'Control Valve (Ball)', 'Control Valve (Butterfly)', 'Control Valve (Globe)',
    ])
    expect(hits('centrifugal pump')[0]).toBe('Centrifugal Pump')
    expect(hits('pressure transmitter')[0]).toBe('PT')
    expect(hits('level transmitter')[0]).toBe('LT')
    expect(hits('flow transmitter')[0]).toBe('FT')
  })

  it('a one-letter word in a query has to land on a whole word', () => {
    // "i/p" splits to "i" and "p"; letting those prefix anything matched a
    // third of the catalogue.
    expect(searchPalette('i/p').map((h) => h.symbolId)).toEqual(['instr.converter'])
  })

  it('the searches users actually type still reach the converter', () => {
    for (const q of ['i/p', 'I/P', 'e/p', 'converter', 'transducer', 'fy']) {
      expect(searchSymbols(q).map((d) => d.id), q).toContain('instr.converter')
    }
  })
})

describe('the ranking is a property of the catalogue, not of a query list', () => {
  it('a symbol added after the fact is ranked by the same rules', () => {
    // The proof that nothing is special-cased: a symbol the scorer has never
    // seen takes part immediately, and lands in the tier its fields earn.
    const def = {
      id: 'zz.widget', name: 'Sample Widget', category: 'inline',
      gridSize: { w: 2, h: 2 }, render: () => '', ports: [],
      tagRule: 'none', keywords: ['gubbins'],
    } as unknown as Parameters<typeof SYMBOLS.set>[1]
    SYMBOLS.set('zz.widget', def)
    resetSymbolIndex()
    try {
      // exact id, exact name, name word, keyword — each reachable, in order
      expect(searchPalette('zz.widget')[0]!.symbolId).toBe('zz.widget')
      expect(searchPalette('sample widget')[0]!.symbolId).toBe('zz.widget')
      expect(searchPalette('widget')[0]!.symbolId).toBe('zz.widget')
      expect(searchPalette('gubbins')[0]!.symbolId).toBe('zz.widget')
      // and a two-letter coincidence inside its name still does not reach it
      expect(searchPalette('mp').map((h) => h.symbolId)).not.toContain('zz.widget')
    } finally {
      SYMBOLS.delete('zz.widget')
      resetSymbolIndex()
    }
  })

  it('every symbol in the catalogue is reachable by its own name', () => {
    for (const def of SYMBOLS.values()) {
      expect(searchSymbols(def.name).map((d) => d.id), def.name).toContain(def.id)
    }
  })

  it('an empty query is the whole catalogue, in catalogue order', () => {
    expect(searchSymbols('')).toHaveLength(SYMBOLS.size)
    expect(searchPalette('')).toEqual([])
  })
})
