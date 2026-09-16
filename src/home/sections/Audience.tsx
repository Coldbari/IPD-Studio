// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Who the tool is for, named by discipline.
 *
 * Kept as a compact row rather than a card grid: it is the fifth grouped list
 * on the page by this point, and the page has already spent its structure on
 * the spine and the showcase. The closing note is the honest limit — this is
 * not a replacement for a plant's existing engineering systems.
 */

const ROLES = [
  { title: 'Process engineers', body: 'Process topology, equipment, streams and process modelling.' },
  { title: 'Instrumentation engineers', body: 'Instruments, tags, loops, datasheets and engineering data.' },
  { title: 'Automation engineers', body: 'I/O, control systems, HMI and industrial integration.' },
  { title: 'Control engineers', body: 'Loop behaviour, alarm design and operator visualisation.' },
  { title: 'Engineering teams', body: 'Structured engineering data, validation and documentation.' },
]

export default function Audience() {
  return (
    <section id="who" className="band band-raised">
      <div className="hwrap">
        <span className="eyebrow">Who it is for</span>
        <h2>Built for engineers.</h2>

        <ul className="who">
          {ROLES.map((r) => (
            <li key={r.title}>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </li>
          ))}
        </ul>

        <p className="disclaimer">
          IPD Studio is an engineering platform for design, data and visualisation work. It is not a
          replacement for a plant&apos;s DCS, safety system or asset management platform, and the
          simulation is for engineering study and training rather than operational decisions.
        </p>
      </div>
    </section>
  )
}
