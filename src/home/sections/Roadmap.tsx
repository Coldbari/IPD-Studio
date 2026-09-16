// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { FUTURE, NEXT, NOW, STATUS_LABEL } from '../content'

/**
 * The roadmap, and the most important section on the page for credibility.
 *
 * The rule the whole file exists to enforce: nothing from NEXT or FUTURE may
 * appear under Now. The three columns are rendered from three separate arrays
 * in content.ts precisely so that moving an item between them is an explicit
 * edit to a typed record, and `tests/home/content.test.ts` requires an
 * available item to name the release it shipped in.
 *
 * Shipped items carry their version. It is the cheapest possible proof that
 * "available" is a fact rather than a hope.
 */
export default function Roadmap() {
  return (
    <section id="roadmap" className="band band-raised">
      <div className="hwrap">
        <span className="eyebrow">Development status</span>
        <h2>What exists today, and what is being built.</h2>
        <p className="lede">
          IPD Studio ships often and is openly in development. This is where each capability actually
          stands — shipped features carry the release they landed in.
        </p>

        <div className="roadmap">
          <div className="rm-col rm-now">
            <div className="rm-head">
              <h3>Now</h3>
              <span className="chip chip-available">{STATUS_LABEL.available}</span>
            </div>
            <ul>
              {NOW.map((c) => (
                <li key={c.id}>{c.name}<span className="ver">v{c.since}</span></li>
              ))}
            </ul>
          </div>

          <div className="rm-col">
            <div className="rm-head">
              <h3>Next</h3>
              <span className="chip chip-developing">{STATUS_LABEL.developing}</span>
            </div>
            <ul>
              {NEXT.map((c) => <li key={c.id}>{c.name}</li>)}
            </ul>
          </div>

          <div className="rm-col">
            <div className="rm-head">
              <h3>Future</h3>
              <span className="chip chip-roadmap">{STATUS_LABEL.roadmap}</span>
            </div>
            <ul>
              {FUTURE.map((c) => <li key={c.id}>{c.name}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
