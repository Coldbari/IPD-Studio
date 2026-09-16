// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { LINKS } from '../content'

/**
 * The closing call to action, set as a title block rather than a centred
 * banner — a drawing ends in a bordered field of stated facts, and so does
 * this page.
 */
export default function Closing({ onOpenEditor }: { onOpenEditor(): void }) {
  return (
    <section className="band">
      <div className="hwrap">
        <div className="cta-block">
          <div>
            <span className="eyebrow">Get started</span>
            <h2>Start building the engineering model.</h2>
            <p>
              Create your first P&amp;ID and explore a different approach to connected engineering.
              Free for personal, academic, nonprofit and government use — your drawings stay private
              to your account.
            </p>
          </div>
          <div className="cta-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={onOpenEditor}>
              Open IPD Studio
            </button>
            <a className="btn btn-ghost btn-lg" href={LINKS.docs} target="_blank" rel="noreferrer">
              View documentation
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
