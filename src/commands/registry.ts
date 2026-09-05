// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Sheet } from '../model/types'
import { activeSheet, useStore } from '../store/store'
import {
  applyAlignment, copySelection, dockSelected, duplicateSelection, hasClipboard,
  pasteClipboard, reverseEdge, rotateSelection, selectAll, toggleFlowArrow,
} from '../canvas/interactions'
import { showStatus } from '../feedback/notices'
import { canvasRef, fitView, zoomActual, zoomToBox } from '../canvas/paperSetup'
import { downloadInstrumentIndex, downloadLineList } from '../export/csv'
import { navigateWorkspace } from '../routes'

/**
 * What the application can be asked to do.
 *
 * The command palette, the context menu and the keyboard are three ways of
 * asking for the same things, and this is the list of things. Every `run` here
 * calls the ONE implementation that already exists — `duplicateSelection`,
 * `applyAlignment`, `deleteSelected` — rather than a palette-flavoured copy of
 * it. A second implementation of Delete is a second set of edge-cascade rules
 * to keep in step, and they would not stay in step.
 *
 * The registry exposes capability. It does not redefine it: nothing in this
 * file knows what a legal connection is, how a tag stays unique, or which
 * lines go with a deleted symbol. That all stays where it was.
 */

export type CommandGroup = 'Selection' | 'Drawing' | 'View' | 'Document'

export interface AppCommand {
  id: string
  label: string
  group: CommandGroup
  /** Shortcut registry id. The hint is rendered from there, never typed here. */
  shortcut?: string
  /** Extra words that should find this command — "dup", "turn", "erase". */
  keywords?: string[]
  run(): void
}

export interface CommandContext {
  selection: readonly string[]
  /** Selected ids that are symbols, and that are lines. */
  nodeIds: string[]
  edgeIds: string[]
  sheet: Sheet
}

export function contextNow(): CommandContext {
  const s = useStore.getState()
  const sheet = activeSheet(s)
  const nodeIds = s.selection.filter((id) => sheet.nodes.some((n) => n.id === id))
  const edgeIds = s.selection.filter((id) => sheet.edges.some((e) => e.id === id))
  return { selection: s.selection, nodeIds, edgeIds, sheet }
}

/** Frame the current selection. A view operation — it moves the viewport and
 *  never the drawing. */
export function zoomToSelection(): void {
  const { paper, graph } = canvasRef
  const s = useStore.getState()
  if (!paper || !graph || !s.selection.length) return
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const id of s.selection) {
    const cell = graph.getCell(id)
    if (!cell) continue
    try {
      const b = cell.getBBox()
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height)
    } catch { /* an unrendered cell contributes nothing */ }
  }
  if (!Number.isFinite(x0)) return
  const pad = 40
  zoomToBox(paper, { x: x0 - pad, y: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 })
}

const props = () => {
  window.dispatchEvent(new Event('pid:show-props'))
  window.dispatchEvent(new Event('pid:focus-props'))
}

const ALIGNMENTS: [Parameters<typeof applyAlignment>[0], string][] = [
  ['left', 'Align left edges'],
  ['center-v', 'Align vertical centres'],
  ['right', 'Align right edges'],
  ['top', 'Align top edges'],
  ['center-h', 'Align horizontal centres'],
  ['bottom', 'Align bottom edges'],
  ['distribute-h', 'Space evenly across'],
  ['distribute-v', 'Space evenly down'],
]

/**
 * The commands that make sense right now, most relevant first.
 *
 * Ordered by what the user is holding rather than alphabetically: with a pump
 * selected, Properties and Rotate are what they want, and Export instrument
 * index is not. Nothing is HIDDEN for being infrequent — everything valid is
 * in the list and findable by typing — but the order is an opinion about what
 * is likely, which is what makes an empty query useful.
 *
 * A command absent from this list is a command that cannot run: offering
 * "Rotate" with nothing selected is a menu item that does nothing, which is
 * the dead end this whole programme of work has been removing.
 */
export function commandsFor(ctx: CommandContext): AppCommand[] {
  const s = useStore.getState()
  const out: AppCommand[] = []
  const single = ctx.selection.length === 1
  const edge = single && ctx.edgeIds.length === 1
    ? ctx.sheet.edges.find((e) => e.id === ctx.edgeIds[0])
    : undefined

  // ── what you can do to what you are holding ──────────────────────────
  if (ctx.selection.length) {
    out.push({
      id: 'sel.properties', label: edge ? 'Line properties' : 'Properties',
      group: 'Selection', shortcut: 'select.properties',
      keywords: ['edit', 'inspector', 'fields'], run: props,
    })

    if (edge) {
      out.push({
        id: 'edge.reverse', label: 'Reverse the line’s direction', group: 'Selection',
        keywords: ['flip', 'swap', 'flow'], run: () => reverseEdge(edge.id),
      })
      out.push({
        id: 'edge.arrow',
        label: edge.arrow === 'flow' ? 'Remove the flow arrow' : 'Add a flow arrow',
        group: 'Selection', keywords: ['direction', 'flow'], run: () => toggleFlowArrow(edge.id),
      })
    }

    if (ctx.nodeIds.length) {
      out.push({
        id: 'sel.rotate', label: 'Rotate 90°',
        group: 'Selection', shortcut: 'draw.rotate',
        keywords: ['turn', 'orient', 'spin'], run: rotateSelection,
      })
    }
    // Only for a single symbol: docking joins the symbol you have to whatever
    // its own points are touching, which is not a thing a group can do.
    if (ctx.nodeIds.length === 1 && ctx.selection.length === 1) {
      out.push({
        id: 'sel.dock', label: 'Connect where the points meet', group: 'Drawing',
        shortcut: 'draw.dockKey', keywords: ['connect', 'join', 'line', 'pipe', 'wire'],
        run: () => {
          const r = dockSelected()
          if (!r.ok && r.reason) showStatus(r.reason, { kind: 'warning' })
          else if (r.made) showStatus(r.made)
        },
      })
    }
    out.push({
      id: 'sel.duplicate', label: 'Duplicate', group: 'Selection', shortcut: 'edit.duplicate',
      keywords: ['copy', 'clone', 'repeat'], run: duplicateSelection,
    })
    out.push({
      id: 'sel.zoom', label: 'Zoom to the selection', group: 'View',
      keywords: ['frame', 'focus', 'find'], run: zoomToSelection,
    })
    out.push({
      id: 'sel.copy', label: 'Copy', group: 'Selection', shortcut: 'edit.copy', run: copySelection,
    })

    // Align only means anything with more than one symbol to align.
    if (ctx.nodeIds.length > 1) {
      for (const [mode, label] of ALIGNMENTS) {
        out.push({
          id: `align.${mode}`, label, group: 'Drawing',
          keywords: ['align', 'distribute', 'tidy', 'space'],
          run: () => applyAlignment(mode),
        })
      }
    }

    out.push({
      id: 'sel.delete', label: ctx.selection.length > 1 ? 'Delete the selection' : 'Delete',
      group: 'Selection', shortcut: 'edit.delete',
      keywords: ['remove', 'erase'], run: () => s.deleteSelected(),
    })
  }

  // ── the sheet ────────────────────────────────────────────────────────
  if (ctx.sheet.nodes.length || ctx.sheet.edges.length) {
    out.push({
      id: 'select.all', label: 'Select everything on this sheet', group: 'Selection',
      shortcut: 'select.all', keywords: ['all'], run: selectAll,
    })
  }
  if (hasClipboard()) {
    out.push({
      id: 'edit.paste', label: 'Paste', group: 'Selection', shortcut: 'edit.paste', run: pasteClipboard,
    })
  }

  // ── the view ─────────────────────────────────────────────────────────
  out.push({
    id: 'view.fit', label: 'Fit the sheet in the window', group: 'View', shortcut: 'view.fit',
    keywords: ['zoom', 'whole', 'all'],
    run: () => {
      const { paper, graph } = canvasRef
      if (paper && graph) fitView(paper, graph, activeSheet(useStore.getState()).sheetSize)
    },
  })
  out.push({
    id: 'view.actual', label: 'Zoom to 100%', group: 'View', shortcut: 'view.actual',
    keywords: ['actual', 'reset', 'scale'],
    run: () => { if (canvasRef.paper) zoomActual(canvasRef.paper) },
  })

  // ── the document ─────────────────────────────────────────────────────
  out.push({ id: 'sheet.add', label: 'Add a sheet', group: 'Document', keywords: ['new', 'page'], run: () => s.addSheet() })
  out.push({
    id: 'sheet.rename', label: 'Rename this sheet', group: 'Document',
    keywords: ['name', 'title', 'page', 'tab'],
    // The tab does the editing — the same edit a double-click or a
    // right-click starts, rather than a second way to write a sheet name.
    run: () => window.dispatchEvent(new Event('pid:rename-sheet')),
  })
  out.push({
    id: 'save', label: 'Save to your account', group: 'Document', shortcut: 'app.save',
    run: () => window.dispatchEvent(new Event('pid:save')),
  })
  out.push({ id: 'export.index', label: 'Export instrument index (CSV)', group: 'Document', keywords: ['report', 'csv', 'list'], run: () => downloadInstrumentIndex() })
  out.push({ id: 'export.lines', label: 'Export line list (CSV)', group: 'Document', keywords: ['report', 'csv'], run: () => downloadLineList() })
  out.push({
    id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Document', shortcut: 'app.shortcuts',
    keywords: ['keys', 'help', 'bindings'], run: () => window.dispatchEvent(new Event('pid:shortcuts')),
  })

  for (const [w, label] of [['draw', 'Draw'], ['data', 'Data'], ['checks', 'Checks'], ['hmi', 'HMI Studio']] as const) {
    out.push({
      id: `go.${w}`, label: `Go to ${label}`, group: 'Document',
      keywords: ['workspace', 'switch'], run: () => navigateWorkspace(w),
    })
  }

  return out
}
