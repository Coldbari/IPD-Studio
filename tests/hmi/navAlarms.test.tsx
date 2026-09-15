import { describe, expect, it } from 'vitest'
import { worstAlarmByScreen } from '../../src/hmi/navAlarms'
import type { HmiScreen } from '../../src/hmi/model'
import type { AlarmRecord } from '../../src/hmi/sim/alarms'

const sc = (id: string, tags: string[]): HmiScreen => ({
  id, name: id, theme: 'classic', pipes: [],
  widgets: tags.map((tag, i) => ({ id: `${id}-${i}`, type: 'display', x: 0, y: 0, w: 96, h: 40, tag })),
})
const al = (tag: string, priority: AlarmRecord['priority'], over: Partial<AlarmRecord> = {}): AlarmRecord =>
  ({ id: `${tag}:H`, tag, level: 'H', phase: 'active', since: 0, priority, ...over })

describe('worstAlarmByScreen', () => {
  it('maps each screen to its worst standing priority', () => {
    const out = worstAlarmByScreen(
      [sc('a', ['FT-1', 'TK-1']), sc('b', ['XI-9']), sc('c', ['P-1'])],
      [al('FT-1', 'low'), al('TK-1', 'high'), al('XI-9', 'medium')],
    )
    expect(out).toEqual({ a: 'high', b: 'medium' })
  })
  it('ignores suppressed and pending alarms', () => {
    const out = worstAlarmByScreen(
      [sc('a', ['FT-1', 'TK-1'])],
      [al('FT-1', 'high', { sup: 'shelved' }), al('TK-1', 'low', { phase: 'pending' })],
    )
    expect(out).toEqual({})
  })
})

describe('nav widget alarm dot', () => {
  it('wears the worst-priority dot only when told to', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { default: NavButton } = await import('../../src/hmi/widgets/nav')
    const { THEMES } = await import('../../src/hmi/theme')
    const w = { id: 'n', type: 'nav' as const, x: 0, y: 0, w: 120, h: 32, label: 'Feed' }
    const hot = renderToStaticMarkup(<svg>{<NavButton widget={w} theme={THEMES.classic} sim={{ __navPrio: 3 }} />}</svg>)
    expect(hot).toContain('data-nav-alarm')
    expect(hot).toContain(THEMES.classic.alarmHigh)
    const calm = renderToStaticMarkup(<svg>{<NavButton widget={w} theme={THEMES.classic} sim={{}} />}</svg>)
    expect(calm).not.toContain('data-nav-alarm')
  })
})
