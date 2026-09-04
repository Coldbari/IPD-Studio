// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectDoc } from '../model/types'
import type { SelectionBrief } from './context'

/**
 * What may leave the browser.
 *
 * The assistant never sends `doc`. It sends a projection — the selection brief
 * and tool results — and this file is the record of what that projection is
 * allowed to contain.
 *
 * The control is not this comment, it is `tests/assist/redact.test.ts`: it
 * enumerates the keys of ProjectDoc and FAILS when a new one appears
 * unclassified. That test is the entire privacy mechanism; everything else here
 * is documentation of decisions already made.
 */

export type Disposition = 'send' | 'never'

/** Every top-level key of ProjectDoc, and whether it may be transmitted. */
export const DOC_KEY_DISPOSITION: Record<string, { disposition: Disposition; why: string }> = {
  schemaVersion: { disposition: 'send', why: 'A version integer. Carries nothing about the plant.' },
  settings: { disposition: 'send', why: 'Grid size and tag separator — needed to format a tag correctly.' },
  sheets: {
    disposition: 'send',
    why: 'The drawing itself, and only ever through the brief: tags, symbols, connectivity. '
      + 'Never geometry, never sheet.underlay (see UNDERLAY below).',
  },
  registry: { disposition: 'send', why: 'Engineering field values for the objects in scope. The point of the feature.' },
  fluids: { disposition: 'send', why: 'Service names and colours. Needed to answer "what does this line carry".' },
  loops: { disposition: 'send', why: 'Derived from tags; carries nothing tags do not.' },

  meta: {
    disposition: 'never',
    why: 'Holds meta.author — a real person\'s name, with zero task value. The project NAME is sent '
      + 'separately by the brief because an engineer refers to it; the author is not.',
  },
  customSymbols: {
    disposition: 'never',
    why: 'The user\'s own SVG intellectual property, and arbitrary markup the sanitiser exists to contain.',
  },
  hmiScreens: {
    disposition: 'never',
    why: 'Only widget TAGS are ever read (to answer HMI coverage), never screen layout or bindings.',
  },
  budget: {
    disposition: 'never',
    why: 'Commercial figures. Costs are computed in-browser and only ever leave as a total the user asked for.',
  },
  qa: { disposition: 'never', why: 'Accepted-finding reasons are free text written by a named reviewer.' },
}

/**
 * Fields that are NOT top-level but are the highest-risk in the document.
 * `sheet.underlay` is a traced DXF — almost always somebody else's drawing,
 * frequently a client's. It must never be read, summarised, or transmitted.
 */
export const NEVER_NESTED = ['sheet.underlay', 'node.cost', 'meta.author', 'cloudId'] as const

/** Strip anything the brief carries that must not be transmitted. */
export function redactBrief(brief: SelectionBrief): SelectionBrief {
  return {
    ...brief,
    project: {
      // the project NAME stays: an engineer names their drawing in conversation
      name: brief.project.name,
      activeSheet: brief.project.activeSheet,
      sheetCount: brief.project.sheetCount,
    },
  }
}

/** A one-line statement of what a request will disclose, for the consent gate. */
export function disclosureFor(doc: ProjectDoc): string {
  const sheets = doc.sheets.length
  const tagged = doc.sheets.reduce((n, sh) => n + sh.nodes.filter((x) => x.tag?.loop).length, 0)
  return `Tags, symbol types and connectivity for the objects in view — ${tagged} tagged item(s) across ${sheets} sheet(s). `
    + 'Never your DXF underlays, custom symbols, costs, or author name.'
}
