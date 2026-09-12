// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantNode, ProjectDoc } from '../model/types'
import { expandLetters, formatTag } from '../isa/tag'
import { getSymbol } from '../symbols/registry'
import type { TagKind } from './sim/tags'
import { buildTagDefs } from './sim/tags'

/** What a P&ID identity can offer the HMI runtime. */
export type HmiRole = 'measurement' | 'controller' | 'motor' | 'valve' | 'equipment'

export interface PlantTag {
  /** Formatted tag ('FT-101') or, for untagged equipment, the label. */
  display: string
  letters: string
  loop: string
  role: HmiRole
  /** Plain-English hint for pickers ('Flow Indicating Controller', 'Vessel'). */
  description: string
  sheetId: string
  sheetName: string
  nodeId: string
}

const numericCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

function categoryOf(node: PlantNode): string {
  try { return getSymbol(node.symbolId).category } catch { return 'custom' }
}

/** Same doctrine as the importer: instruments classify by tag letters, never
 *  by symbol category; …Y hardware and malformed letters aren't bindable. */
function roleFor(node: PlantNode, category: string): HmiRole | null {
  if (node.kind === 'annotation') return null
  if (node.kind === 'instrument') {
    const letters = node.tag?.letters ?? ''
    if (!/^[A-Z]{1,4}$/.test(letters) || letters.endsWith('Y')) return null
    if (letters.endsWith('V')) return 'valve'
    if (letters.includes('C')) return 'controller'
    return 'measurement'
  }
  if (node.kind === 'valve') return 'valve'
  if (category === 'rotating') return 'motor'
  return 'equipment'
}

const ROLE_WORD: Record<HmiRole, string> = {
  measurement: 'Measurement', controller: 'Controller', motor: 'Pump / motor',
  valve: 'Valve', equipment: 'Equipment',
}

/** Every bindable identity in the drawing, deduped by display text, sorted. */
export function listPlantTags(doc: ProjectDoc): PlantTag[] {
  const out = new Map<string, PlantTag>()
  for (const sheet of doc.sheets) {
    for (const node of sheet.nodes) {
      const category = categoryOf(node)
      const role = roleFor(node, category)
      if (!role) continue
      const display = node.tag ? formatTag(node.tag, doc.settings.tagSeparator) : (node.label?.trim() ?? '')
      if (!display || out.has(display)) continue
      const letters = node.tag?.letters ?? ''
      out.set(display, {
        display, letters, loop: node.tag?.loop ?? '', role,
        description: letters ? expandLetters(letters) : category === 'vessels' ? 'Vessel' : ROLE_WORD[role],
        sheetId: sheet.id, sheetName: sheet.name, nodeId: node.id,
      })
    }
  }
  return [...out.values()].sort((a, b) => numericCompare(a.display, b.display))
}

/** Signals the runtime serves for each role (mirrors sim/engine's initTags). */
export function signalsFor(role: HmiRole): string[] {
  switch (role) {
    case 'controller': return ['PV', 'SP', 'OP', 'MODE']
    case 'motor': return ['RUN']
    case 'valve': return ['OP', 'OPEN']
    default: return ['PV']
  }
}

/** Split 'TAG.SIGNAL' at the LAST dot — the one shared parser for every
 *  signal-binding consumer (canvas, sim writes, pickers). */
// Moved to hmi/model.ts so model/references.ts can parse a widget reference
// without importing sim/tags. Re-exported here: this is where callers look.
export { parseSignalRef } from './model'

const KIND_SIGNALS: Record<TagKind, string[]> = {
  tank: ['PV'], motor: ['RUN'], valve: ['OP'], valveOnOff: ['OPEN'],
  display: ['PV'], controller: ['PV', 'SP', 'OP', 'MODE'],
}

export interface SignalRef {
  ref: string
  hint: string
  /** 'hmi' = derived from a widget (authoritative for the sim); 'pid' = a
   *  drawing tag not yet placed on any screen. */
  source: 'hmi' | 'pid'
}

/** Every 'TAG.SIGNAL' the runtime can serve: widgets define the sim's tag
 *  universe so they come first; plant tags fill in what isn't placed yet. */
export function listSignalRefs(doc: ProjectDoc): SignalRef[] {
  const out = new Map<string, SignalRef>()
  for (const def of buildTagDefs(doc.hmiScreens, doc.registry)) {
    for (const sig of KIND_SIGNALS[def.kind]) {
      const ref = `${def.name}.${sig}`
      out.set(ref, { ref, hint: def.kind, source: 'hmi' })
    }
  }
  for (const t of listPlantTags(doc)) {
    for (const sig of signalsFor(t.role)) {
      const ref = `${t.display}.${sig}`
      if (!out.has(ref)) out.set(ref, { ref, hint: t.description, source: 'pid' })
    }
  }
  return [...out.values()].sort((a, b) => numericCompare(a.ref, b.ref))
}
