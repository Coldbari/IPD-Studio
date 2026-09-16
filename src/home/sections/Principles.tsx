// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Four design principles, stated as what the software does rather than as
 * adjectives about it. Each one is falsifiable against the codebase, which is
 * the only reason to put principles on a marketing page at all.
 */

const PRINCIPLES = [
  {
    title: 'Engineering data over pixels',
    body:
      'The diagram is backed by structured engineering information. Deliverables are computed from ' +
      'the model at read time, so the drawing and the paperwork cannot disagree.',
  },
  {
    title: 'Topology as a first-class model',
    body:
      'Connections and process relationships carry as much weight as visual placement. The simulation ' +
      'and the process view are laid out from the topology, not from where symbols happen to sit.',
  },
  {
    title: 'Standards-aware',
    body:
      'Built around established engineering conventions — ISA symbol and tagging practice, ISA-101 ' +
      'HMI styling, ISA-18.2 alarm handling, DEXPI exchange — rather than inventing isolated ones.',
  },
  {
    title: 'One source of truth',
    body:
      'An engineering object keeps its identity through the tag. Redraw the symbol and the record ' +
      'survives; change the record and every view of it follows.',
  },
]

export default function Principles() {
  return (
    <section id="why" className="band">
      <div className="hwrap">
        <span className="eyebrow">Why IPD Studio</span>
        <h2>Engineering-first by design.</h2>

        <div className="principles">
          {PRINCIPLES.map((p) => (
            <article className="principle" key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
