// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE RECONCILIATION FINGERPRINT.
 *
 * The engineering facts about a tag that an operator screen depends on,
 * reduced to one deterministic string a screen can store and be compared
 * against later. `model/reconcile.ts` explains what it is for; it lives in its
 * own file so the P&ID IMPORTER can record a baseline on the screens it builds
 * without importing the reconciler that imports the importer.
 *
 * DELIBERATELY EXCLUDES everything runtime and everything visual: no PV, no
 * history, no alarm state, no simulation clock, no widget geometry, no
 * document timestamp. Running the plant changes nothing here, and neither does
 * dragging a widget across a screen.
 */

import type { ProjectDoc, Sheet } from './types'
import { keyOfNode } from './registry'

// ── The fingerprint ─────────────────────────────────────────────────────────

/**
 * The engineering facts about a tag that an operator screen depends on.
 *
 * Each entry is `[field id, label]`. The id is what the fingerprint stores and
 * diffs on; the label is what the reconciliation view prints. Both live here
 * so a field cannot be added to one and forgotten in the other.
 */
const TRACKED: readonly (readonly [string, string])[] = [
  ['signal.range', 'Calibrated range'],
  ['signal.units', 'Unit'],
  ['signal.type', 'I/O type'],
  ['signal.systemTag', 'System tag'],
  ['signal.setpoint', 'Setpoint'],
  ['alarm.LL', 'Alarm LL'],
  ['alarm.L', 'Alarm L'],
  ['alarm.H', 'Alarm H'],
  ['alarm.HH', 'Alarm HH'],
  ['alarm.priority', 'Alarm priority'],
  ['construction.volume', 'Capacity'],
  ['duty.capacity', 'Rated flow'],
  ['duty.head', 'Rated head'],
  ['duty.power', 'Power'],
  ['general.service', 'Service'],
]

export const TRACKED_LABEL: Record<string, string> =
  Object.fromEntries(TRACKED.map(([k, l]) => [k, l]))

/** The drawn symbol, which decides what KIND of object the HMI draws. Not a
 *  registry field, so it is keyed separately and labelled for a person. */
const SYMBOL_FIELD = '__symbol'
TRACKED_LABEL[SYMBOL_FIELD] = 'Symbol'

/**
 * The engineering facts about one tag, as a flat map.
 *
 * Empty values are kept as empty strings rather than dropped, so "someone
 * cleared the range" is a change rather than a silence.
 */
export function fingerprintFields(doc: ProjectDoc, tag: string, sheet?: Sheet): Record<string, string> {
  const fields = doc.registry?.[tag]?.fields ?? {}
  const out: Record<string, string> = {}
  for (const [key] of TRACKED) out[key] = (fields[key] ?? '').trim()
  const node = sheet?.nodes.find((n) => keyOfNode(n) === tag)
  out[SYMBOL_FIELD] = node?.symbolId ?? ''
  return out
}

/**
 * The facts as ONE deterministic string, for storage in the document.
 *
 * `key=value` pairs in a fixed order, separated by a unit separator that
 * cannot occur in a field an engineer typed. Round-trips exactly, so a
 * baseline can be diffed against a fresh reading without keeping a second copy
 * of the registry in every screen.
 */
const SEP = ''

export function serialiseFingerprint(f: Record<string, string>): string {
  return Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join(SEP)
}

export function parseFingerprint(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!s) return out
  for (const part of s.split(SEP)) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1)
  }
  return out
}

export const fingerprintTag = (doc: ProjectDoc, tag: string, sheet?: Sheet): string =>
  serialiseFingerprint(fingerprintFields(doc, tag, sheet))

/** The baseline a screen should carry for the tags it represents right now. */
export function baselineFor(doc: ProjectDoc, sheet: Sheet, tags: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tag of [...tags].sort()) out[tag] = fingerprintTag(doc, tag, sheet)
  return out
}
