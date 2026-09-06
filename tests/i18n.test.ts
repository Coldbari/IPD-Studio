import { describe, expect, it } from 'vitest'
import { tr } from '../src/i18n'

describe('interface translations', () => {
  it('translates common drawing controls to simplified Chinese', () => {
    expect(tr('Save', 'zh-CN')).toBe('保存')
    expect(tr('Properties', 'zh-CN')).toBe('属性')
    expect(tr('Flow arrow', 'zh-CN')).toBe('流向箭头')
  })

  it('keeps engineering text unchanged when no translation exists', () => {
    expect(tr('FT-101', 'zh-CN')).toBe('FT-101')
  })
})
