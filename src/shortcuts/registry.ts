// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * One place that knows what every key does.
 *
 * Before this, a shortcut existed three times over and agreed with itself by
 * luck: the branch that ran it (canvas/interactions.ts, WorkspaceRail,
 * CommandPalette), the tooltip that mentioned it — where one did — and the
 * user's memory. Seven of the thirteen canvas bindings were written down
 * nowhere at all, `R` for rotate among them.
 *
 * So a shortcut is declared once, here, and everything else reads it:
 *   - the handlers match against it (`matches`)
 *   - tooltips and menus print it (`display`)
 *   - the shortcut sheet lists it (`byGroup`)
 *
 * The registry is deliberately NOT a dispatcher. Behaviour stays where the
 * state is — the canvas owns rotate, the rail owns workspace switching — and
 * a registry that also ran the actions would have to reach into all of it.
 * What it owns is the definition: keys, wording, grouping, platform spelling.
 */

export type ShortcutGroup = 'Navigation' | 'Selection' | 'Editing' | 'Drawing' | 'Application'

/** Groups in the order the shortcut sheet shows them: what you do to the view,
 *  then to the selection, then to the drawing, then to the document. */
export const GROUP_ORDER: ShortcutGroup[] = [
  'Navigation',
  'Selection',
  'Editing',
  'Drawing',
  'Application',
]

export interface ShortcutDef {
  id: string
  /** Canonical combos. More than one only where the action has real aliases
   *  (redo is Ctrl+Y and Ctrl+Shift+Z; delete is Delete and Backspace). */
  keys: string[]
  label: string
  group: ShortcutGroup
  /** Shown in the shortcut sheet where the key alone doesn't explain it. */
  note?: string
  /** Pointer gestures are listed but never matched — they have no key event.
   *  They belong here because "how do I pan?" is the same question as "what
   *  does Ctrl+D do?", and answering it in two places answers it in neither. */
  gesture?: boolean
  /** Overrides the rendered form where the literal combos read badly (the
   *  four arrow keys are one shortcut to a person, four to a keyboard). */
  display?: string
}

/**
 * Every binding the Draw workspace responds to.
 *
 * Nothing is listed here that the app cannot actually do — an entry in this
 * table is a promise, and the shortcut sheet reads straight off it.
 */
export const SHORTCUTS: ShortcutDef[] = [
  // ── Navigation ─────────────────────────────────────────────────────────
  { id: 'view.fit', keys: ['Shift+F'], label: 'Fit the sheet in the window', group: 'Navigation' },
  { id: 'view.actual', keys: ['Shift+1'], label: 'Zoom to 100%', group: 'Navigation' },
  { id: 'view.pan', keys: ['Space+Drag'], label: 'Pan the sheet', group: 'Navigation', gesture: true,
    note: 'Middle-mouse drag does the same thing.' },
  { id: 'view.zoom', keys: ['Scroll'], label: 'Zoom about the pointer', group: 'Navigation', gesture: true },
  { id: 'go.workspace', keys: ['Mod+1', 'Mod+2', 'Mod+3', 'Mod+4'], display: 'Mod+1 … Mod+4',
    label: 'Draw · Data · Checks · HMI', group: 'Navigation' },

  // ── Selection ──────────────────────────────────────────────────────────
  { id: 'select.all', keys: ['Mod+A'], label: 'Select everything on this sheet', group: 'Selection',
    note: 'Symbols and the lines between them.' },
  { id: 'select.clear', keys: ['Escape'], label: 'Clear the selection', group: 'Selection' },
  { id: 'select.extend', keys: ['Shift+Click'], label: 'Add to / remove from the selection', group: 'Selection', gesture: true },
  { id: 'select.marquee', keys: ['Drag'], label: 'Marquee-select from blank paper', group: 'Selection', gesture: true },
  { id: 'select.context', keys: ['Right-click'], label: 'Actions for what you clicked', group: 'Selection', gesture: true,
    note: 'Blank paper, a symbol, several symbols and a line each offer their own.' },

  // ── on the drawing itself ────────────────────────────────────────────
  // Scoped to the canvas, not global: these would take Tab and Enter away
  // from every other control on the page. See canvas/keyboardNav.ts.
  { id: 'select.next', keys: ['Tab'], label: 'Next object on the sheet', group: 'Drawing',
    note: 'While the drawing has focus. Reads top to bottom, then left to right.' },
  { id: 'select.prev', keys: ['Shift+Tab'], label: 'Previous object', group: 'Drawing' },
  { id: 'select.properties', keys: ['Enter'], label: 'Open the selection’s properties', group: 'Drawing' },
  { id: 'select.menu', keys: ['Shift+F10', 'ContextMenu'], display: 'Shift+F10',
    label: 'Actions for the selection', group: 'Drawing',
    note: 'The same menu the right mouse button opens.' },
  { id: 'select.release', keys: ['Escape'], label: 'Let go of the drawing', group: 'Drawing', gesture: true,
    note: 'Escape clears the selection; Tab then moves on to the panels as usual.' },

  // ── Editing ────────────────────────────────────────────────────────────
  { id: 'edit.undo', keys: ['Mod+Z'], label: 'Undo', group: 'Editing' },
  { id: 'edit.redo', keys: ['Mod+Shift+Z', 'Mod+Y'], label: 'Redo', group: 'Editing' },
  { id: 'edit.copy', keys: ['Mod+C'], label: 'Copy', group: 'Editing' },
  { id: 'edit.paste', keys: ['Mod+V'], label: 'Paste', group: 'Editing' },
  { id: 'edit.duplicate', keys: ['Mod+D'], label: 'Duplicate', group: 'Editing',
    note: 'The copy arrives untagged — two symbols cannot share a tag.' },
  { id: 'edit.delete', keys: ['Delete', 'Backspace'], label: 'Delete the selection', group: 'Editing',
    note: 'Lines attached to a deleted symbol go with it. One undo brings it all back.' },

  // ── Drawing ────────────────────────────────────────────────────────────
  { id: 'draw.rotate', keys: ['R'], label: 'Rotate the selection 90°', group: 'Drawing' },
  { id: 'draw.dockKey', keys: ['C'], label: 'Connect where the points meet', group: 'Drawing',
    note: 'The keyboard’s way to draw a line: nudge a symbol until its connection point meets another, then press C.' },
  { id: 'draw.nudge', keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], display: '↑ ↓ ← →',
    label: 'Nudge one grid square (8 px)', group: 'Drawing' },
  // Deliberately the other way round from Illustrator and Figma, where the
  // plain arrow is the fine one. On a P&ID the grid is load-bearing: symbols
  // that sit on it produce straight runs, and symbols that do not produce a
  // one-square jog in every line they touch. So the unmodified key does the
  // safe thing and the modifier is what leaves the grid.
  { id: 'draw.nudgeFine', keys: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight'],
    display: 'Shift + ↑ ↓ ← →', label: 'Nudge 1 px, off the grid', group: 'Drawing',
    note: 'The plain arrow keys keep a symbol on the 8 px grid, which is what makes lines come out straight. Hold Shift only when something has to sit between squares.' },
  { id: 'draw.connect', keys: ['Drag a connection point'], label: 'Draw a line', group: 'Drawing', gesture: true,
    note: 'Hover a symbol to see its connection points. Drop a free end on an existing line to branch off it.' },
  { id: 'draw.dock', keys: ['Drag a symbol'], label: 'Connect by touching', group: 'Drawing', gesture: true,
    note: 'Bring a symbol’s connection point near another and the line is drawn for you, mid-drag.' },
  { id: 'draw.shake', keys: ['Shake while dragging'], label: 'Disconnect', group: 'Drawing', gesture: true,
    note: 'Waggle a symbol mid-drag to cut the lines it has. It stays in your hand.' },

  // ── Application ────────────────────────────────────────────────────────
  { id: 'app.save', keys: ['Mod+S'], label: 'Save', group: 'Application' },
  { id: 'app.palette', keys: ['Mod+K', 'Mod+F'], label: 'Find a tag, or run a command', group: 'Application' },
  { id: 'app.shortcuts', keys: ['?'], label: 'This list', group: 'Application' },
]

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]))

export function shortcut(id: string): ShortcutDef | undefined {
  return BY_ID.get(id)
}

export function byGroup(group: ShortcutGroup): ShortcutDef[] {
  return SHORTCUTS.filter((s) => s.group === group)
}

// ── matching ─────────────────────────────────────────────────────────────

interface Combo {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

const NAMED = new Set([
  'Delete', 'Backspace', 'Escape', 'Enter', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

function parse(combo: string): Combo {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]!
  return {
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key,
  }
}

/**
 * Whether a key event is this combo.
 *
 * Three key shapes, matched three ways on purpose:
 *
 *  - **Digits go through `e.code`.** `Shift+1` used to be matched as
 *    `e.key === '!'`, which is the US layout's opinion about that key and
 *    nobody else's — on a German or French keyboard it silently did nothing.
 *  - **Punctuation ignores Shift.** `?` IS Shift+/ on most layouts and
 *    something else on others; `e.key` already reports the resolved
 *    character, so demanding a shift state on top of it would double-count.
 *  - **Letters compare case-insensitively**, because a modifier changes the
 *    case the browser reports.
 */
function matchCombo(e: KeyboardEvent, c: Combo): boolean {
  if (c.mod !== (e.metaKey || e.ctrlKey)) return false
  if (c.alt !== e.altKey) return false

  if (/^[0-9]$/.test(c.key)) {
    return c.shift === e.shiftKey && e.code === `Digit${c.key}`
  }
  if (NAMED.has(c.key)) {
    return c.shift === e.shiftKey && e.key === c.key
  }
  if (/^[a-z]$/i.test(c.key)) {
    return c.shift === e.shiftKey && e.key.toLowerCase() === c.key.toLowerCase()
  }
  // punctuation: the character already carries the shift
  return e.key === c.key
}

/** Does this key event trigger the named shortcut? Gestures never match. */
export function matches(e: KeyboardEvent, id: string): boolean {
  const def = BY_ID.get(id)
  if (!def || def.gesture) return false
  return def.keys.some((k) => matchCombo(e, parse(k)))
}

// ── display ──────────────────────────────────────────────────────────────

/** Apple keyboards spell modifiers with glyphs and no separator; everything
 *  else spells them out. Read once — the platform does not change mid-session. */
const MAC = (() => {
  if (typeof navigator === 'undefined') return false
  const n = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /Mac|iPhone|iPad/i.test(n.userAgentData?.platform || n.platform || n.userAgent || '')
})()

/** How this platform spells the primary modifier, ready to prefix a key:
 *  "⌘" on Apple keyboards, "Ctrl+" everywhere else. */
export const MOD = MAC ? '⌘' : 'Ctrl+'

const GLYPH: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Delete: 'Del', Backspace: '⌫', Escape: 'Esc',
}

function renderCombo(combo: string): string {
  const c = parse(combo)
  const key = GLYPH[c.key] ?? (/^[a-z]$/i.test(c.key) ? c.key.toUpperCase() : c.key)
  if (MAC) {
    return `${c.mod ? '⌘' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${key}`
  }
  const mods = [c.mod && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift'].filter(Boolean)
  return [...mods, key].join('+')
}

/** The shortcut as a user should read it: platform-correct, first alias only.
 *  Empty string for an unknown id, so a tooltip degrades to no hint rather
 *  than to the word "undefined". */
export function display(id: string): string {
  const def = BY_ID.get(id)
  if (!def) return ''
  if (def.display) return def.display.replace(/Mod\+/g, MAC ? '⌘' : 'Ctrl+')
  return renderCombo(def.keys[0]!)
}

/** Every alias, for the shortcut sheet. */
export function displayAll(id: string): string[] {
  const def = BY_ID.get(id)
  if (!def) return []
  if (def.display) return [display(id)]
  return def.keys.map(renderCombo)
}

/** `title` text with the shortcut appended, for tooltips: "Undo · ⌘Z". */
export function hint(text: string, id: string): string {
  const k = display(id)
  return k ? `${text} · ${k}` : text
}
