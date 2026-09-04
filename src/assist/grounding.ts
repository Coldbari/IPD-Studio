// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectIndex } from '../model/projectIndex'
import { formatTag, parseTag } from '../isa/tag'

export interface Violation {
  /** The tag-shaped string the model wrote. */
  text: string
  reason: string
}

/** Anything shaped like an ISA tag or a line number: FT-101, FT101, PSV-100A. */
const CANDIDATE = /\b[A-Za-z]{1,5}-?\d{1,6}[A-Za-z]?\b/g

/** Quoted spans and code spans are the user's words, not the model's claims. */
function maskQuoted(text: string): string {
  return text
    .replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))
    .replace(/"[^"]*"/g, (m) => ' '.repeat(m.length))
    .replace(/'[^']*'/g, (m) => ' '.repeat(m.length))
}

/**
 * Catch an invented tag before it reaches the screen.
 *
 * This is the single highest-value check in the feature. A plausible tag —
 * "FT-205 is downstream" when no FT-205 exists — is the most dangerous thing
 * this product can emit, because it looks exactly like an answer. Every
 * tag-shaped token in the model's prose is checked against what is actually
 * drawn, plus whatever the tools returned this turn.
 *
 * The honest limitation, stated so nobody mistakes this for more than it is:
 * it catches invented NAMES, not false RELATIONSHIPS. "FT-101 is downstream of
 * FV-101" passes here even when it is upstream. Topology claims are constrained
 * by giving the model only walk_signal/get_object results to reason from — not
 * by this function.
 */
export function validateGrounding(text: string, ix: ProjectIndex, allowed: Set<string> = new Set()): Violation[] {
  const known = new Set<string>()
  for (const k of ix.liveKeys) known.add(k.toUpperCase())
  for (const a of allowed) known.add(a.toUpperCase())
  for (const n of ix.allNodes) if (n.node.label) known.add(n.node.label.toUpperCase())

  const out: Violation[] = []
  const seen = new Set<string>()

  for (const raw of maskQuoted(text).match(CANDIDATE) ?? []) {
    const upper = raw.toUpperCase()
    if (seen.has(upper)) continue
    seen.add(upper)
    if (known.has(upper)) continue

    // Normalise FT101 -> FT-101 before deciding it is missing; only strings the
    // ISA parser accepts as a tag are held to this standard at all.
    const parsed = parseTag(raw)
    if (!parsed) continue
    const normalised = formatTag(parsed, '-').toUpperCase()
    if (known.has(normalised)) continue

    out.push({
      text: raw,
      reason: `${raw} is not on any sheet. Every tag you name must come from a tool result.`,
    })
  }
  return out
}

/** The correction handed back to the model so its retry is informed, not blind. */
export function violationFeedback(violations: Violation[], ix: ProjectIndex): string {
  const real = [...ix.liveKeys].slice(0, 25)
  return [
    `You referred to ${violations.length} object(s) that do not exist: ${violations.map((v) => v.text).join(', ')}.`,
    real.length ? `Tags actually on the drawing include: ${real.join(', ')}.` : 'This drawing has no tagged objects at all.',
    'Answer again using only objects a tool returned. If you cannot, say the drawing does not contain what was asked.',
  ].join(' ')
}
