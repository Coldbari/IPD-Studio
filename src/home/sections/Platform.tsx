// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { JSX } from 'react'
import { LINKS } from '../content'
import { ChecksVisual, DataVisual, ExchangeVisual, HmiVisual, PidVisual, SimVisual } from '../visuals/scenes'

/**
 * The platform, as editorial rows rather than a card grid.
 *
 * A grid of equal cards says "here are six features". Rows of this weight say
 * "here is a workflow, in order" — and the order is deliberately the same six
 * stages as the spine above, so the second pass through the story adds detail
 * without changing shape.
 *
 * Each row's claim is checked against what is actually implemented. Where a
 * capability is partial the row says so in its own copy; nothing is left to
 * the roadmap section to walk back.
 */

interface Row {
  id: string
  eyebrow: string
  title: string
  body: string
  tags: string[]
  link?: { href: string; label: string }
  visual: () => JSX.Element
}

const ROWS: Row[] = [
  {
    id: 'pid',
    eyebrow: 'P&ID engineering',
    title: 'Draw with engineering objects, not clipart',
    body:
      'Place ISA-5.1 instruments, valves, equipment and pipelines with magnetic connections and ' +
      'connection rules that refuse a pneumatic signal on a pipe nozzle. Tags are parsed against the ' +
      'letter tables as you type, loop numbers auto-assign, and control loops fall out of the tags ' +
      'themselves. Behind every symbol is a structured object, not a picture of one.',
    tags: ['ISA-5.1 symbols', 'Magnetic connections', 'Orthogonal routing', 'Control loops', 'Multi-sheet', 'Off-page connectors'],
    visual: PidVisual,
  },
  {
    id: 'data',
    eyebrow: 'Engineering data',
    title: 'Your P&ID is data — not just graphics',
    body:
      'The instrument index, line list, equipment and valve lists are generated from the model, so ' +
      'they cannot drift from the drawing. Engineering records are keyed to the tag rather than the ' +
      'symbol, which means redrawing an instrument does not destroy its datasheet. Export to CSV, ' +
      'JSON and XML, or print datasheets and loop diagrams.',
    tags: ['Instrument index', 'Line list', 'Equipment data', 'Datasheets', 'Loop diagrams', 'I/O list', 'CSV · JSON · XML'],
    visual: DataVisual,
  },
  {
    id: 'checks',
    eyebrow: 'Validation',
    title: 'Design → validate → resolve',
    body:
      'A rule engine checks the model for the things that become expensive later: duplicate and ' +
      'malformed tags, dangling lines, incompatible connections, controllers with no final element, ' +
      'vessels without relief, a pump whose suction reaches no source. Rules carry severities you ' +
      'can configure per project, and the standards page shows what switching one on would light up ' +
      'before you commit to it.',
    tags: ['Topology checks', 'Tag consistency', 'Missing engineering data', 'Company standards', 'Impact preview'],
    visual: ChecksVisual,
  },
  {
    id: 'sim',
    eyebrow: 'Process simulation',
    title: 'Move from static drawings toward executable models',
    body:
      'The engineering model drives a process simulation in real units: a quadratic pump curve with ' +
      'the affinity laws, a pressure profile along each branch, and a vessel energy balance. Every ' +
      'value carries a data quality — good, forced, stale, uncertain or bad — and a solve that cannot ' +
      'stand behind a number prints dashes instead of it. This is a representation of process ' +
      'behaviour for engineering and training, not a validated process simulator.',
    tags: ['Pressure & flow', 'Pump curves', 'Vessel inventory', 'Engineering units', 'Data quality'],
    visual: SimVisual,
  },
  {
    id: 'hmi',
    eyebrow: 'HMI & control',
    title: 'The bridge from engineering to operations',
    body:
      'One click turns the P&ID into an operator screen. PI loops wire themselves from your ISA tags, ' +
      'ISA-18.2 alarms carry priorities, deadband and shelving, trends plot against a real time axis, ' +
      'and DCS-style faceplates give an operator something to actually drive. Classic and ISA-101 ' +
      'high-performance themes ship with it.',
    tags: ['Operator screens', 'Faceplates', 'ISA-18.2 alarms', 'Trends', 'ISA-101 theme', 'Training upsets'],
    link: { href: LINKS.hmiDocs, label: 'Read the HMI documentation' },
    visual: HmiVisual,
  },
  {
    id: 'interop',
    eyebrow: 'Interoperability',
    title: 'Open standards, connected engineering',
    body:
      'The document format is versioned, human-readable JSON. DEXPI import and export are ' +
      'implemented against a documented model mapping, DXF export opens in AutoCAD, and a legacy ' +
      'drawing can be loaded as an underlay to redraw over. AutomationML and MTP are the direction of ' +
      'travel, not shipped capabilities — the roadmap below says exactly where each one stands.',
    tags: ['DEXPI import & export', 'DXF export', 'DXF underlay', 'Open JSON format', 'PDF · SVG · PNG'],
    link: { href: LINKS.dexpiMapping, label: 'Read the DEXPI model mapping' },
    visual: ExchangeVisual,
  },
]

export default function Platform() {
  return (
    <section id="platform" className="band">
      <div className="hwrap">
        <span className="eyebrow">The platform</span>
        <h2>One platform. Multiple engineering workflows.</h2>

        <div className="rows">
          {ROWS.map((row) => {
            const Visual = row.visual
            return (
              <article className="row" key={row.id} id={row.id}>
                <div className="row-copy">
                  <span className="eyebrow">{row.eyebrow}</span>
                  <h3>{row.title}</h3>
                  <p>{row.body}</p>
                  <ul className="row-list">
                    {row.tags.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                  {row.link && (
                    <a className="row-link" href={row.link.href} target="_blank" rel="noreferrer">
                      {row.link.label}
                    </a>
                  )}
                </div>
                <div className="row-viz"><Visual /></div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
