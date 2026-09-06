import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { SYMBOLS } from '../../src/symbols/registry'
import { INSTRUMENT_PRESETS } from '../../src/panels/instrumentPresets'
import { TYPICALS } from '../../src/assist/typicals'
import { ZH, tr } from '../../src/i18n'
import { DEFAULT_PRICES } from '../../src/model/costs'

describe('catalog names are translated', () => {
  it('every symbol, instrument preset and typical has a Chinese name', () => {
    const missing = [
      ...[...SYMBOLS.values()].map((d) => d.name),
      ...INSTRUMENT_PRESETS.map((p) => p.name),
      ...TYPICALS.map((t) => t.name),
    ].filter((name) => !(name in ZH))
    expect([...new Set(missing)].sort()).toEqual([])
  })

  it('the translated names are non-empty and differ from the English', () => {
    for (const name of [...SYMBOLS.values()].map((d) => d.name)) {
      const zh = tr(name, 'zh-CN')
      expect(zh.length).toBeGreaterThan(0)
    }
  })

  it('every budgetary price basis sentence has a Chinese translation', () => {
    const untranslated = Object.values(DEFAULT_PRICES)
      .map((e) => e.basis)
      .filter((basis) => basis !== undefined && tr(basis, 'zh-CN') === basis)
    expect([...new Set(untranslated)].sort()).toEqual([])
  })
})
