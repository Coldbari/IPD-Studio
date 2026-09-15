// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP H — one design system, enforced.
 *
 * The audit counted ninety-one colour literals across sixteen HMI components
 * and fifty-nine more across two stylesheets, with the faceplate ignoring the
 * theme entirely. These tests keep that from coming back: a component that
 * reaches for a hex value instead of a token fails here.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PRIORITY_TOKEN, SCALE, THEMES, cssVars } from '../../src/hmi/theme'
import type { ThemeTokens } from '../../src/hmi/theme'

const HMI = 'src/hmi'
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])

const COMPONENTS = files(HMI).filter((f) => f.endsWith('.tsx'))
const STYLES = files(HMI).filter((f) => f.endsWith('.css'))
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/

describe('components consume tokens, never literals', () => {
  it('no HMI component contains a colour literal', () => {
    const offenders = COMPONENTS
      .filter((f) => !f.endsWith('theme.ts'))
      .map((f) => ({ f, hits: (readFileSync(f, 'utf8').match(new RegExp(COLOUR, 'g')) ?? []).length }))
      .filter((x) => x.hits > 0)
    expect(offenders.map((o) => `${o.f} (${o.hits})`)).toEqual([])
  })

  it('every component that draws is reachable from the theme', () => {
    // a widget takes ThemeTokens; a panel takes the CSS variables. Anything
    // that paints must do one or the other.
    for (const f of COMPONENTS) {
      const src = readFileSync(f, 'utf8')
      if (!/fill=|stroke=|background|color:/.test(src)) continue
      expect(/theme\.|var\(--hmi-|className=/.test(src), f).toBe(true)
    }
  })

  it('stylesheets use custom properties, not literals', () => {
    for (const f of STYLES) {
      const src = readFileSync(f, 'utf8')
      // the only permitted literals are neutral black/white alphas used as
      // scrims, which carry no meaning and work under both themes
      const hits = (src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [])
      expect(hits, f).toEqual([])
      expect(src.includes('var(--hmi-'), f).toBe(true)
    }
  })
})

describe('the token set is complete and coherent', () => {
  const themes = Object.entries(THEMES) as [string, ThemeTokens][]

  it('both themes define every token', () => {
    const keys = Object.keys(THEMES.classic).sort()
    for (const [name, t] of themes) {
      expect(Object.keys(t).sort(), name).toEqual(keys)
      for (const k of keys) expect((t as unknown as Record<string, unknown>)[k], `${name}.${k}`).toBeTruthy()
    }
  })

  it('covers every semantic role the workstation needs', () => {
    for (const [name, t] of themes) {
      for (const k of [
        'bg', 'appBg', 'surface', 'surfaceRaised', 'surfaceSunken', 'border', 'borderStrong',
        'text', 'textSecondary', 'textMuted',
        'processActive', 'processInactive', 'disabled',
        'alarmHigh', 'alarmMedium', 'alarmLow', 'fault',
        'forced', 'stale', 'uncertain', 'bad',
        'selection', 'accent', 'focus',
      ] as const) {
        expect(t[k], `${name}.${k}`).toMatch(/^#|^rgb/)
      }
    }
  })

  it('AT REST IS NOT AN ALARM — the defect that made a shut plant look like an emergency', () => {
    for (const [name, t] of themes) {
      expect(t.stopped, name).toBe(t.processInactive)
      expect(t.closed, name).toBe(t.processInactive)
      expect(t.stopped, name).not.toBe(t.alarmHigh)
      expect(t.closed, name).not.toBe(t.alarmHigh)
      expect(t.running, name).toBe(t.processActive)
    }
  })

  it('EDITOR SELECTION is never an alarm tone', () => {
    for (const [name, t] of themes) {
      for (const alarm of [t.alarmHigh, t.alarmMedium, t.alarmLow, t.fault]) {
        expect(t.selection, name).not.toBe(alarm)
      }
    }
  })

  it('each alarm priority has ONE token, and they are distinct', () => {
    expect(PRIORITY_TOKEN).toEqual({ high: 'alarmHigh', medium: 'alarmMedium', low: 'alarmLow' })
    for (const [name, t] of themes) {
      const set = new Set([t.alarmHigh, t.alarmMedium, t.alarmLow])
      expect(set.size, name).toBe(3)
    }
  })

  it('offers four distinguishable trend pens per theme', () => {
    for (const [name, t] of themes) {
      expect(t.pens.length, name).toBe(4)
      expect(new Set(t.pens).size, name).toBe(4)
    }
  })
})

describe('the non-colour scales are small and closed', () => {
  it('type, spacing, radius and control heights are fixed sets', () => {
    expect(Object.values(SCALE.font).every((v) => v >= 10 && v <= 30)).toBe(true)
    // every spacing step lands on a 2px grid — the audit found 8, 13 and 17
    // chosen independently across components
    expect(Object.values(SCALE.space).every((v) => v % 2 === 0)).toBe(true)
    // industrial panels group with rules, not with rounded cards
    expect(Math.max(...Object.values(SCALE.radius))).toBeLessThanOrEqual(4)
  })
})

describe('cssVars', () => {
  const vars = cssVars(THEMES.classic)

  it('emits every theme token as a custom property', () => {
    expect(vars['--hmi-surface']).toBe(THEMES.classic.surface)
    expect(vars['--hmi-alarm-high']).toBe(THEMES.classic.alarmHigh)
    expect(vars['--hmi-text-muted']).toBe(THEMES.classic.textMuted)
    expect(vars['--hmi-process-active']).toBe(THEMES.classic.processActive)
  })

  it('emits the scales too, so a stylesheet never invents a size', () => {
    expect(vars['--hmi-font-base']).toBe(`${SCALE.font.base}px`)
    expect(vars['--hmi-space-md']).toBe(`${SCALE.space.md}px`)
    expect(vars['--hmi-radius-sm']).toBe(`${SCALE.radius.sm}px`)
    expect(vars['--hmi-control-md']).toBe(`${SCALE.control.md}px`)
  })

  it('the two themes emit the same property NAMES with different values', () => {
    const a = cssVars(THEMES.classic)
    const b = cssVars(THEMES.hp)
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect(a['--hmi-bg']).not.toBe(b['--hmi-bg'])
  })

  it('every custom property the stylesheets reference actually exists', () => {
    const declared = new Set(Object.keys(cssVars(THEMES.classic)))
    for (const f of STYLES) {
      const used = readFileSync(f, 'utf8').match(/var\(--hmi-[a-z-]+/g) ?? []
      for (const u of used) {
        const name = u.slice(4)
        // `--hmi-line` is a local fallback inside one rule, not a theme token
        if (name === '--hmi-line') continue
        expect(declared.has(name), `${f} uses ${name}`).toBe(true)
      }
    }
  })
})
