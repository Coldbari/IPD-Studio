// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { DISCLAIMER, STANDARD_LABEL, STANDARDS } from '../content'

/**
 * The standards index.
 *
 * Deliberately a table of designations and statuses, not a logo wall. A logo
 * wall implies endorsement, and no standards body endorses this software.
 * Every row states what IPD Studio DOES with the standard; none states
 * conformance, because none has been assessed. `DISCLAIMER` renders with the
 * list and is not optional — see content.ts.
 */
export default function Standards() {
  return (
    <section id="standards" className="band">
      <div className="hwrap">
        <span className="eyebrow">Engineering references</span>
        <h2>Built for the industrial engineering ecosystem.</h2>
        <p className="lede">
          Designed with these engineering standards and ecosystems in mind. Each row says what the
          software does today — not what it has been certified against.
        </p>

        <ul className="std">
          {STANDARDS.map((s) => (
            <li key={s.id}>
              <span className="code">{s.code}</span>
              <span className="note">{s.note}</span>
              <span className={`chip chip-${s.status}`}>{STANDARD_LABEL[s.status]}</span>
            </li>
          ))}
        </ul>

        <p className="disclaimer">{DISCLAIMER}</p>
      </div>
    </section>
  )
}
