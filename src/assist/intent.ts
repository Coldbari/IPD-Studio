// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectIndex } from '../model/projectIndex'
import type { SelectionBrief } from './context'
import type { Answer } from './answer'
import {
  downstreamOf, hasRelief, hmiCoverage, loopComplete, loopCost, loopsMissingController,
  onThisLine, tagLegal, unanswerable, whatControls, whyFinding, withoutDatasheet,
} from './queries'

export type QuestionId =
  | 'loop-complete' | 'what-controls' | 'downstream' | 'on-this-line'
  | 'loops-missing-controller' | 'why-finding' | 'tag-legal' | 'has-relief'
  | 'without-datasheet' | 'loop-cost' | 'hmi-coverage'
  | 'psv-sizing' | 'revision' | 'interlock' | 'hazard'

interface Pattern {
  id: QuestionId
  /** Every term must appear for the pattern to match. */
  all?: string[]
  /** Any one of these is enough. */
  any?: string[]
}

/**
 * Question → query, by keyword and nothing else.
 *
 * Deliberately not a model call. A classifier would cost exactly the round trip
 * this whole layer exists to avoid, and a misclassification would route a
 * question the document can answer exactly into a path that guesses. When
 * nothing matches we say so, which is a better failure than a confident
 * answer to a question nobody asked.
 *
 * Order matters: the refusals sit first so "is this PSV sized right" cannot be
 * captured by the looser relief pattern below it.
 */
const PATTERNS: Pattern[] = [
  // the four the document genuinely cannot answer
  { id: 'psv-sizing', all: ['siz'], any: ['psv', 'relief valve', 'safety valve', 'pressure relief'] },
  { id: 'revision', any: ['revision', 'what changed', 'since rev', 'last rev'] },
  { id: 'interlock', any: ['interlock', 'trip', 'cause and effect', 'sis'] },
  { id: 'hazard', any: ['hazard', 'hazop', 'risk assessment', 'what could go wrong'] },

  // the eleven it can. hmi-coverage outranks loop-complete because "is this
  // loop on the HMI screen" contains "is this loop" — the more specific
  // signal has to be tested first or the looser pattern swallows it.
  { id: 'hmi-coverage', any: ['hmi', 'operator screen', 'faceplate'] },
  { id: 'loop-complete', any: ['loop complete', 'complete loop', 'loop still need', 'missing from this loop', 'is this loop'] },
  { id: 'loops-missing-controller', any: ['loops are missing', 'loops missing', 'loops without a controller', 'loops have no controller', 'which loops'] },
  { id: 'loop-cost', all: ['cost'], any: ['loop', 'this'] },
  { id: 'without-datasheet', any: ['no datasheet', 'without datasheet', 'missing datasheet', 'no engineering data', 'not specified'] },
  { id: 'on-this-line', any: ['on this line', 'on the line', 'instruments on this', 'what is on this run'] },
  { id: 'downstream', any: ['downstream', 'upstream', 'connected to', 'what does this feed', 'where does this go'] },
  // 'control' alone is far too broad — it matches "control philosophy",
  // "control room", "controlled variable". Require an interrogative with it,
  // and let anything vaguer fall through to the model rather than be
  // mis-answered by a query that was never about that question.
  { id: 'what-controls', all: ['control'], any: ['what does', 'what is', 'which'] },
  { id: 'what-controls', any: ['final element', 'what does it operate', 'what does it drive'] },
  { id: 'tag-legal', any: ['tag legal', 'valid tag', 'isa legal', 'tag valid', 'is this tag'] },
  { id: 'has-relief', any: ['relief', 'psv', 'safety valve'] },
  // likewise 'why' on its own captures half of English
  { id: 'why-finding', all: ['why'], any: ['flag', 'finding', 'wrong', 'error', 'issue', 'complain'] },
  { id: 'why-finding', any: ['what is wrong', 'what is flagged', 'explain the finding'] },
]

export function matchIntent(question: string): QuestionId | null {
  const q = question.trim().toLowerCase()
  if (!q) return null
  for (const p of PATTERNS) {
    if (p.all && !p.all.every((t) => q.includes(t))) continue
    if (p.any && !p.any.some((t) => q.includes(t))) continue
    if (!p.all && !p.any) continue
    return p.id
  }
  return null
}

export function runQuery(id: QuestionId, ix: ProjectIndex, brief: SelectionBrief): Answer {
  switch (id) {
    case 'loop-complete': return loopComplete(ix, brief)
    case 'what-controls': return whatControls(ix, brief)
    case 'downstream': return downstreamOf(ix, brief)
    case 'on-this-line': return onThisLine(ix, brief)
    case 'loops-missing-controller': return loopsMissingController(ix)
    case 'why-finding': return whyFinding(ix, brief)
    case 'tag-legal': return tagLegal(ix, brief)
    case 'has-relief': return hasRelief(ix, brief)
    case 'without-datasheet': return withoutDatasheet(ix)
    case 'loop-cost': return loopCost(ix, brief)
    case 'hmi-coverage': return hmiCoverage(ix, brief)
    case 'psv-sizing':
    case 'revision':
    case 'interlock':
    case 'hazard':
      return unanswerable(id)
  }
}

export interface Suggestion {
  id: QuestionId
  label: string
}

const ALWAYS: Suggestion[] = [
  { id: 'loops-missing-controller', label: 'Which loops are missing a controller?' },
  { id: 'without-datasheet', label: 'What has no engineering data?' },
]

/**
 * The panel's empty state, and the only documentation this feature needs: the
 * questions that make sense for what is actually selected right now.
 */
export function suggestionsFor(brief: SelectionBrief): Suggestion[] {
  const out: Suggestion[] = []
  const f = brief.focus

  if (brief.loop) {
    out.push({ id: 'loop-complete', label: `Is loop ${brief.loop.ref} complete?` })
    out.push({ id: 'loop-cost', label: `What does loop ${brief.loop.ref} cost?` })
    out.push({ id: 'hmi-coverage', label: 'Is this loop on an HMI screen?' })
  }
  if (f?.objectType === 'node') {
    out.push({ id: 'downstream', label: `What is ${f.ref} connected to?` })
    if (f.tag) out.push({ id: 'tag-legal', label: `Is ${f.ref} a legal ISA tag?` })
    if (f.kind === 'instrument') out.push({ id: 'what-controls', label: `What does ${f.ref} control?` })
    if (f.symbol.category === 'vessels') out.push({ id: 'has-relief', label: `Does ${f.ref} have relief?` })
  }
  if (f?.objectType === 'edge') {
    out.push({ id: 'on-this-line', label: 'What is on this line?' })
    out.push({ id: 'downstream', label: 'What does this line connect?' })
  }
  if (brief.findings.length > 0) {
    out.push({ id: 'why-finding', label: `Why is this flagged? (${brief.findings.length})` })
  }

  return [...out, ...ALWAYS]
}
