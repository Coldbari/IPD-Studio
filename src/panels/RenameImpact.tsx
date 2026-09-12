// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ClearImpact, RenameImpact, RefWhere, TagRef } from '../model/references'

/**
 * What a rename is about to do, shown before it does it.
 *
 * The engineer is told three things and no more: what moves on its own, what
 * they have to look at themselves, and whether the whole thing is refused.
 * Anything else here would be noise at the moment of a decision.
 */

const NOUN: Record<RefWhere, [string, string]> = {
  registry: ['engineering record', 'engineering records'],
  'hmi-widget': ['HMI widget', 'HMI widgets'],
  'hmi-pen': ['trend pen', 'trend pens'],
  'hmi-signal': ['HMI signal binding', 'HMI signal bindings'],
  'hmi-bind': ['HMI tank binding', 'HMI tank bindings'],
  'qa-ignored': ['accepted finding', 'accepted findings'],
  'record-field': ['record field', 'record fields'],
}

const plural = (where: RefWhere, n: number) => `${n} ${NOUN[where][n === 1 ? 0 : 1]}`

/** "1 engineering record, 4 HMI widgets, 2 trend pens" — in a fixed order, so
 *  the same rename never reads differently twice. */
function summarise(refs: TagRef[]): string {
  const order: RefWhere[] = ['registry', 'hmi-widget', 'hmi-pen', 'hmi-signal', 'hmi-bind', 'qa-ignored', 'record-field']
  const counts = new Map<RefWhere, number>()
  for (const r of refs) counts.set(r.where, (counts.get(r.where) ?? 0) + 1)
  return order.filter((w) => counts.has(w)).map((w) => plural(w, counts.get(w)!)).join(', ')
}

export default function RenameImpactView({ impact }: { impact: RenameImpact }) {
  const { auto, review, blocked, collision } = impact
  if (!collision && !auto.length && !review.length) return null

  return (
    <div className="rename-impact" data-testid="rename-impact">
      <div className="rename-impact-head">
        {impact.oldKey} → {impact.newKey}
      </div>

      {collision && (
        <div className="rename-impact-blocked" data-testid="rename-impact-blocked">
          <strong>Blocked.</strong> {impact.newKey} already has an engineering record.
          Nothing will change — {summarise(blocked)} would be left on {impact.oldKey}.
        </div>
      )}

      {!collision && auto.length > 0 && (
        <div className="rename-impact-auto" data-testid="rename-impact-auto">
          <div className="rename-impact-label">Will follow the rename</div>
          <div className="rename-impact-summary">{summarise(auto)}</div>
          <ul>
            {auto.map((r, i) => (
              <li key={`${r.where}-${i}`}>{r.label}</li>
            ))}
          </ul>
        </div>
      )}

      {review.length > 0 && (
        <div className="rename-impact-review" data-testid="rename-impact-review">
          <div className="rename-impact-label">Needs your review — not changed</div>
          <div className="rename-impact-summary">
            {summarise(review)} {review.length === 1 ? 'mentions' : 'mention'} {impact.oldKey} in
            text someone typed.
          </div>
          <ul>
            {review.map((r, i) => (
              <li key={`review-${i}`}>{r.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * What clearing a tag will strand.
 *
 * Deliberately not the rename panel with different words: the heading names
 * the operation, there is no arrow and no destination, and the wording says
 * what will be LEFT BEHIND rather than what will follow.
 */
export function ClearImpactView({ impact }: { impact: ClearImpact }) {
  const { orphaned, review, key } = impact
  if (!orphaned.length && !review.length) return null

  return (
    <div className="rename-impact clear-impact" data-testid="clear-impact">
      <div className="rename-impact-head">Clearing {key}</div>

      <div className="rename-impact-blocked" data-testid="clear-impact-orphans">
        <strong>Nothing follows a cleared tag.</strong> {summarise(orphaned)} will be left
        pointing at {key}, which no symbol will carry.
        <ul>
          {orphaned.map((r, i) => (
            <li key={`orphan-${i}`}>{r.label}</li>
          ))}
        </ul>
      </div>

      {review.length > 0 && (
        <div className="rename-impact-review" data-testid="clear-impact-review">
          <div className="rename-impact-label">Not changed either</div>
          <div className="rename-impact-summary">
            {summarise(review)} {review.length === 1 ? 'mentions' : 'mention'} {key} in text
            someone typed. Naming which ones, because they are the ones to go and look at.
          </div>
          <ul>
            {review.map((r, i) => (
              <li key={`clear-review-${i}`}>{r.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
