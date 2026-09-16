// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { LICENCE_FREE, LICENCE_PAID, LINKS } from '../content'

/**
 * The platform philosophy AND the licence, in one section.
 *
 * These belong together because they are the same argument from two sides:
 * open at the boundaries, commercial at the core, and honest that the core is
 * not open source. Splitting them let the page imply openness in one place
 * and charge for it three sections later.
 *
 * The free/paid split stays on the page rather than behind a footer link. It
 * is how the project funds a free tier for students and public bodies, and
 * someone at a for-profit company deserves to learn they need a licence before
 * they open the editor, not after.
 */
export default function Philosophy() {
  return (
    <section id="licence" className="band">
      <div className="hwrap">
        <span className="eyebrow">Platform philosophy</span>
        <h2>Open where it matters. Commercial where it counts.</h2>
        <p className="lede">
          IPD Studio is designed to work with open standards, documented formats and integrations,
          while remaining a focused professional engineering platform. The document format is
          versioned readable JSON, the DEXPI mapping is published, and the architecture is meant to
          let other industrial software connect to IPD Studio without everything having to live in
          one codebase.
        </p>
        <p className="lede">
          To be precise about what that does <em>not</em> mean: IPD Studio is source-available under
          PolyForm Noncommercial 1.0.0, not open source. You can read the code, learn from it and
          verify what it does. Commercial use is a paid licence — and that licence is what keeps it
          free for everyone in the first column below.
        </p>

        <div className="split">
          <div className="split-col">
            <h3>Free, no permission needed</h3>
            <ul>
              {LICENCE_FREE.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
          <div className="split-col">
            <h3>Requires a paid licence</h3>
            <ul>
              {LICENCE_PAID.map((l) => <li key={l}>{l}</li>)}
            </ul>
            <p className="split-note">
              <a href={LINKS.licence} target="_blank" rel="noreferrer">Read the commercial licence</a>
              {' '}or email <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
