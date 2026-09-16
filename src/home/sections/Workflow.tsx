// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The workflow as a sequence of six.
 *
 * Numbered markers are used here and nowhere else on the page, because this is
 * the only content that is genuinely ordered — each step consumes what the one
 * before it produced. The six map one-to-one onto the editor's own workspaces,
 * which is not a coincidence worth hiding: the product is laid out this way.
 */

const STEPS = [
  { n: '01', title: 'Design', body: 'Create the P&ID and the process topology with ISA symbols, magnetic connections and validated tags.' },
  { n: '02', title: 'Define', body: 'Attach engineering information to equipment, instruments, lines and systems — keyed to the tag, not the symbol.' },
  { n: '03', title: 'Validate', body: 'Run the rule engine against your company standard and resolve inconsistencies before they reach a deliverable.' },
  { n: '04', title: 'Simulate', body: 'Drive a process representation from the same model: pressures, flows, inventories and controller action.' },
  { n: '05', title: 'Visualise', body: 'Build operator screens on the engineering model, with alarms, faceplates and trends wired from your tags.' },
  { n: '06', title: 'Connect', body: 'Move engineering information downstream through DEXPI, DXF, CSV and the open document format.' },
]

export default function Workflow() {
  return (
    <section id="workflow" className="band band-raised gridded">
      <div className="hwrap">
        <span className="eyebrow">Engineering workflow</span>
        <h2>From concept to connected engineering.</h2>
        <p className="lede">
          These are the editor's six workspaces. The work moves forward without ever being re-entered:
          each stage reads what the one before it produced.
        </p>

        <ol className="flow">
          {STEPS.map((s) => (
            <li className="flow-step" key={s.n}>
              <span className="n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
