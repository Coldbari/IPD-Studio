// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { SHORTCUTS, display, displayAll, hint, matches, shortcut } from '../../src/shortcuts/registry'

/** A key event as the registry reads it. `code` defaults to the physical key
 *  a US layout would produce, which is what a digit shortcut matches on. */
function key(
  k: string,
  mods: { mod?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
): KeyboardEvent {
  return {
    key: k,
    code: mods.code ?? (/^[0-9]$/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`),
    ctrlKey: Boolean(mods.mod),
    metaKey: false,
    shiftKey: Boolean(mods.shift),
    altKey: Boolean(mods.alt),
  } as KeyboardEvent
}

describe('shortcut matching', () => {
  it('separates undo from redo on the shift key', () => {
    expect(matches(key('z', { mod: true }), 'edit.undo')).toBe(true)
    expect(matches(key('z', { mod: true }), 'edit.redo')).toBe(false)
    // the browser reports the upper case when shift is down
    expect(matches(key('Z', { mod: true, shift: true }), 'edit.redo')).toBe(true)
    expect(matches(key('Z', { mod: true, shift: true }), 'edit.undo')).toBe(false)
  })

  it('accepts both redo aliases', () => {
    expect(matches(key('y', { mod: true }), 'edit.redo')).toBe(true)
    expect(matches(key('Z', { mod: true, shift: true }), 'edit.redo')).toBe(true)
  })

  it('accepts both delete keys and neither with a modifier', () => {
    expect(matches(key('Delete'), 'edit.delete')).toBe(true)
    expect(matches(key('Backspace'), 'edit.delete')).toBe(true)
    expect(matches(key('Delete', { mod: true }), 'edit.delete')).toBe(false)
  })

  it('matches Shift+1 by physical key, not by the character a US layout makes', () => {
    // The old hand-written branch tested `e.key === '!'`, which is one
    // layout's opinion: a German keyboard produces '!' from Shift+1 too, but
    // a French one produces '1' from the unshifted key and '&' from Shift.
    expect(matches(key('!', { shift: true, code: 'Digit1' }), 'view.actual')).toBe(true)
    expect(matches(key('1', { shift: true, code: 'Digit1' }), 'view.actual')).toBe(true)
    expect(matches(key('&', { shift: true, code: 'Digit1' }), 'view.actual')).toBe(true)
    // and not the unshifted key, which belongs to the workspace rail
    expect(matches(key('1', { code: 'Digit1' }), 'view.actual')).toBe(false)
  })

  it('matches punctuation on the character, ignoring how it was shifted', () => {
    expect(matches(key('?', { shift: true, code: 'Slash' }), 'app.shortcuts')).toBe(true)
    // some layouts put ? on an unshifted key
    expect(matches(key('?', { code: 'Comma' }), 'app.shortcuts')).toBe(true)
    expect(matches(key('/', { code: 'Slash' }), 'app.shortcuts')).toBe(false)
  })

  it('requires the modifier state to match exactly', () => {
    expect(matches(key('a', { mod: true }), 'select.all')).toBe(true)
    expect(matches(key('a'), 'select.all')).toBe(false)
    expect(matches(key('a', { mod: true, alt: true }), 'select.all')).toBe(false)
    expect(matches(key('a', { mod: true, shift: true }), 'select.all')).toBe(false)
  })

  it('never fires a pointer gesture from a key', () => {
    for (const s of SHORTCUTS.filter((d) => d.gesture)) {
      expect(matches(key(' '), s.id)).toBe(false)
      expect(matches(key('Enter'), s.id)).toBe(false)
    }
  })

  it('returns false for an id that does not exist', () => {
    expect(matches(key('a', { mod: true }), 'nope.missing')).toBe(false)
  })
})

describe('the registry as a table', () => {
  it('has unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('binds no combination to two different actions', () => {
    // The one invariant a shortcut system has to hold: pressing a key must do
    // one thing. Adding a colliding binding fails here rather than in the app,
    // where it would present as "sometimes it rotates, sometimes it doesn't".
    const seen = new Map<string, string>()
    for (const s of SHORTCUTS) {
      if (s.gesture) continue
      for (const combo of s.keys) {
        const clash = seen.get(combo)
        expect(clash, `${combo} is bound to both ${clash} and ${s.id}`).toBeUndefined()
        seen.set(combo, s.id)
      }
    }
  })

  it('scopes Tab and Enter to the drawing, and nowhere else', () => {
    // Tab and Enter belong to the browser everywhere except on the canvas,
    // which owns them only while it has focus (canvas/keyboardNav.ts checks
    // document.activeElement before matching). If either ever appears on a
    // GLOBAL shortcut, every button and field on the page loses it.
    const scoped = new Set(['select.next', 'select.prev', 'select.properties', 'select.menu'])
    for (const s of SHORTCUTS) {
      if (scoped.has(s.id) || s.gesture) continue
      for (const combo of s.keys) {
        expect(combo, `${s.id} must not claim ${combo} globally`).not.toMatch(/(^|\+)(Tab|Enter)$/)
      }
    }
  })

  it('gives every entry a label and a group', () => {
    for (const s of SHORTCUTS) {
      expect(s.label.length, s.id).toBeGreaterThan(0)
      expect(s.keys.length, s.id).toBeGreaterThan(0)
    }
  })

  it('renders every entry without leaking undefined into the UI', () => {
    for (const s of SHORTCUTS) {
      expect(display(s.id), s.id).not.toMatch(/undefined/)
      expect(display(s.id).length, s.id).toBeGreaterThan(0)
      expect(displayAll(s.id).length, s.id).toBeGreaterThan(0)
    }
  })

  it('degrades a tooltip to plain text for an unknown id', () => {
    expect(hint('Undo', 'nope.missing')).toBe('Undo')
    expect(hint('Undo', 'edit.undo')).toMatch(/Undo · /)
  })

  it('exposes the definitions the shortcut sheet reads', () => {
    expect(shortcut('draw.rotate')?.label).toMatch(/Rotate/)
    // R was the binding written down nowhere; it must stay in the table
    expect(shortcut('draw.rotate')?.keys).toEqual(['R'])
  })
})
