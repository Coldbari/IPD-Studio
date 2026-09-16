// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { Bubble, ControlValve, GateValve, Label, Line, Orifice, Pump, Signal, Vessel } from './isa'

/**
 * THE ENGINEERING SCENES.
 *
 * Every scene on the page draws the SAME plant: a vessel V-101 feeding pump
 * P-101 through control valve FCV-101, with FT-101 measuring the discharge and
 * FIC-101 closing the loop. It is the product's own "Flow control loop"
 * typical, and repeating it is the argument: the reader meets one plant and
 * then watches it become a table, a finding, a solve, an operator screen and
 * an export. Six pictures of one thing, not six pictures of six things.
 */

/** Flow-direction arrowhead, shared by every process line that terminates. */
function Defs() {
  return (
    <defs>
      <marker id="hm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" className="ink-fill" />
      </marker>
    </defs>
  )
}

/**
 * The hero drawing: a complete flow control loop on a white sheet.
 *
 * NOTHING ON THE SHEET ANIMATES, and that is an engineering decision rather
 * than a restraint one. In ISA-5.1 a dashed line is an instrument signal, so
 * putting a moving dash pattern on a process line makes it read as a signal
 * line to exactly the audience this page is for. Process linework is solid
 * here, signals are dashed, and the flow animation lives only on the HMI
 * mimic — which is where the real product animates pipes too.
 */
export function FlowLoop() {
  return (
    <svg viewBox="0 0 440 232" role="img" aria-label="A flow control loop: vessel V-101 feeding pump P-101 through control valve FCV-101, with flow transmitter FT-101 measuring the discharge and controller FIC-101 closing the loop">
      <Defs />

      {/* feed into the vessel */}
      <Line d="M8 40 L52 40 L52 56" />
      <path d="M8 40 L30 40" className="ink" markerEnd="url(#hm-arrow)" />

      <Vessel x={26} y={56} w={52} h={86} />
      <Label x={86} y={102} anchor="start">V-101</Label>

      {/* suction */}
      <Line d="M52 142 L52 178 L104 178" />
      <GateValve cx={78} cy={178} />

      <Pump cx={118} cy={178} />
      <Label x={118} y={207}>P-101</Label>

      {/* discharge — the line actually carrying something */}
      <Line d="M132 178 L173 178" />
      <ControlValve cx={186} cy={178} fail="FC" />
      <Line d="M199 178 L300 178" />
      <Orifice cx={258} cy={178} />
      <Line d="M300 178 L408 178" />
      <path d="M386 178 L408 178" className="ink" markerEnd="url(#hm-arrow)" />
      <Label x={352} y={168} anchor="start">4"-P-1001</Label>

      {/* the loop: measurement up, control back down */}
      <Bubble cx={258} cy={112} letters="FT" loop="101" />
      <Signal d="M258 127 L258 170" />
      <Bubble cx={186} cy={112} letters="FIC" loop="101" />
      <Signal d="M201 112 L243 112" />
      <Signal d="M186 127 L186 152" />
    </svg>
  )
}

/** The hero composition: the editor window, quoting real chrome. */
export function EditorWindow() {
  return (
    <div className="win">
      <div className="win-bar">
        <b>IPD Studio</b>
        <span className="spacer" />
        <span>Sheet 1 / 3 · A3</span>
      </div>
      <div className="win-body">
        <ul className="win-rail" aria-hidden="true">
          <li className="on">Instruments</li>
          <li>Control valves</li>
          <li>Manual valves</li>
          <li>Vessels</li>
          <li>Pumps</li>
          <li>Lines</li>
        </ul>
        <div className="win-sheet"><FlowLoop /></div>
        <dl className="win-props" aria-hidden="true">
          <div><dt>Tag</dt><dd className="accent">FT-101</dd></div>
          <div><dt>Type</dt><dd>Flow transmitter</dd></div>
          <div><dt>Loop</dt><dd>101</dd></div>
          <div><dt>Range</dt><dd>0–100 m³/h</dd></div>
          <div><dt>Service</dt><dd>Feed</dd></div>
        </dl>
      </div>
    </div>
  )
}

/* ── Platform row visuals ─────────────────────────────────────────────── */

/** P&ID engineering: the drawing itself, on paper. */
export function PidVisual() {
  return (
    <div className="viz viz-paper">
      <FlowLoop />
    </div>
  )
}

/** Engineering data: the same objects as an instrument index. */
export function DataVisual() {
  const rows = [
    ['FT-101', 'Flow transmitter', '101', '0–100 m³/h'],
    ['FIC-101', 'Flow controller', '101', '0–100 m³/h'],
    ['FCV-101', 'Control valve', '101', 'Fail closed'],
    ['LT-102', 'Level transmitter', '102', '0–4 m'],
    ['PT-103', 'Pressure transmitter', '103', '0–10 bar'],
  ]
  return (
    <div className="viz">
      <table className="tbl">
        <caption className="vz-cap">Instrument index — generated from the drawing</caption>
        <thead>
          <tr><th>Tag</th><th>Description</th><th>Loop</th><th>Range</th></tr>
        </thead>
        <tbody>
          {rows.map(([tag, desc, loop, range]) => (
            <tr key={tag} className={tag === 'FT-101' ? 'on' : undefined}>
              <td className="t-tag">{tag}</td>
              <td>{desc}</td>
              <td>{loop}</td>
              <td className="t-num">{range}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Validation: a real finding, in the rule engine's voice. */
export function ChecksVisual() {
  const items: { sev: 'warn' | 'alarm' | 'ok'; tag: string; text: string }[] = [
    { sev: 'alarm', tag: 'FCV-101', text: 'Controller has no final element on loop 101' },
    { sev: 'warn', tag: 'FT-101', text: 'Calibrated range not declared' },
    { sev: 'warn', tag: 'V-101', text: 'Vessel has no relief device' },
    { sev: 'ok', tag: 'P-101', text: 'Suction path reaches a source' },
  ]
  return (
    <div className="viz">
      <div className="vz-head"><span>Checks</span><span className="mono">4 findings</span></div>
      <ul className="findings">
        {items.map((f) => (
          <li key={f.tag} className={`sev-${f.sev}`}>
            <span className="dot" aria-hidden="true" />
            <span className="f-tag">{f.tag}</span>
            <span className="f-text">{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Simulation: solved values on the same loop. */
export function SimVisual() {
  const vals = [
    ['FT-101', 'Flow', '45.0', 'm³/h'],
    ['PT-103', 'Discharge', '2.40', 'bar'],
    ['TT-104', 'Temperature', '78.2', '°C'],
    ['V-101', 'Level', '62.5', '%'],
  ]
  return (
    <div className="viz">
      <div className="vz-head"><span>Process values</span><span className="mono ok">Solved</span></div>
      <ul className="vals">
        {vals.map(([tag, label, v, unit]) => (
          <li key={tag}>
            <span className="v-tag">{tag}</span>
            <span className="v-label">{label}</span>
            <span className="v-num">{v}<i>{unit}</i></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A live pipe: solid wall, with a lighter dash drifting along inside it.
 *  Animating the pipe's own stroke instead makes it read as a dashed line
 *  rather than as a pipe with something in it — the same misreading the P&ID
 *  sheet avoids by not animating at all. */
function Pipe({ d }: { d: string }) {
  return (
    <g>
      <path d={d} className="wire" />
      <path d={d} className="wire-flow flowline" />
    </g>
  )
}

/** The operator mimic alone, so the showcase can reuse it under its own
 *  heading rather than nesting a second one. */
export function HmiMimic() {
  return (
    <svg viewBox="0 0 360 150" role="img" aria-label="Operator screen showing tank V-101 at 62 percent, pump P-101 running, and flow transmitter FT-101 reading 45.0 cubic metres per hour">
        {/* tank with a liquid level */}
        <rect x="16" y="24" width="52" height="86" rx="6" fill="#141b24" stroke="#5c666f" strokeWidth="1.4" />
        <path d="M17 78 h50 v26 a6 6 0 0 1 -6 6 h-38 a6 6 0 0 1 -6 -6 z" fill="#4a7fa5" opacity="0.75" />
        <text className="wire-text" x="42" y="124" textAnchor="middle">V-101</text>
        <text className="wire-text" x="42" y="70" textAnchor="middle" fill="#e6eaed">62%</text>

        {/* discharge run */}
        <Pipe d="M68 96 L108 96" />
        <circle cx="122" cy="96" r="13" fill="#141b24" stroke="#4a9d6e" strokeWidth="1.6" />
        <path d="M108 96 L130 89 L130 103 Z" fill="none" stroke="#4a9d6e" strokeWidth="1.3" />
        <text className="wire-text" x="122" y="124" textAnchor="middle">P-101</text>
        <Pipe d="M135 96 L188 96" />

        {/* control valve, open */}
        <path d="M188 88 L202 96 L188 104 Z M216 88 L202 96 L216 104 Z" fill="#141b24" stroke="#4a9d6e" strokeWidth="1.5" />
        <text className="wire-text" x="202" y="124" textAnchor="middle">FCV-101</text>
        <Pipe d="M216 96 L246 96" />

        {/* the reading */}
        <rect x="248" y="70" width="96" height="52" rx="3" fill="#1c2228" stroke="#333c45" />
        <text className="wire-text" x="258" y="86">FT-101</text>
        <text x="258" y="108" fill="#e6eaed" style={{ font: '600 19px ui-monospace, SFMono-Regular, Menlo, monospace' }}>45.0</text>
        <text className="wire-text" x="316" y="108">m³/h</text>
    </svg>
  )
}

/** HMI: the operator's view of the same plant, on the product's navy ground. */
export function HmiVisual() {
  return (
    <div className="viz viz-hmi">
      <div className="vz-head"><span>Operator screen</span><span className="mono run">Running</span></div>
      <HmiMimic />
    </div>
  )
}

/**
 * Interoperability: what leaves the model, and what is only planned.
 *
 * The roadmap rows are rendered here rather than omitted, because a reader
 * scanning for "does it do AutomationML" should get the answer in the same
 * panel as the yes-answers rather than having to find the roadmap section.
 */
export function ExchangeVisual() {
  const out: { fmt: string; note: string; state: 'now' | 'soon' | 'later' }[] = [
    { fmt: 'DEXPI XML', note: 'Proteus 4.2-shaped, import & export', state: 'now' },
    { fmt: 'DXF', note: 'Layered R12 export, underlay import', state: 'now' },
    { fmt: 'CSV', note: 'Index, line list, I/O, costs', state: 'now' },
    { fmt: 'PDF · SVG · PNG', note: 'True sheet scale with title block', state: 'now' },
    { fmt: '.pnid.json', note: 'Versioned open document format', state: 'now' },
    { fmt: 'AutomationML', note: 'Planned', state: 'later' },
    { fmt: 'MTP', note: 'Planned', state: 'later' },
  ]
  return (
    <div className="viz">
      <div className="vz-head"><span>Exchange</span><span className="mono">Model → downstream</span></div>
      <ul className="xch">
        {out.map((o) => (
          <li key={o.fmt} className={`x-${o.state}`}>
            <span className="x-fmt">{o.fmt}</span>
            <span className="x-note">{o.note}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The showcase: four panels of one engineering environment.
 * The point of the composition is adjacency — the drawing, its record, its
 * solve and its operator screen sharing a frame, so the claim "these are views
 * of one model" is made by the layout rather than asserted in a sentence.
 */
export function Workstation() {
  return (
    <div className="stationframe">
      <div className="win-bar">
        <b>IPD Studio</b>
        <span className="spacer" />
        <span>Project: Demo unit · FT-101 selected</span>
      </div>
      <div className="station">
        <section className="st-pane st-pid">
          <h3 className="vz-head"><span>P&amp;ID</span><span className="mono">Sheet 1</span></h3>
          <div className="st-sheet"><FlowLoop /></div>
        </section>
        <section className="st-pane st-data">
          <h3 className="vz-head"><span>Engineering record</span><span className="mono accent">FT-101</span></h3>
          <dl className="rec">
            <div><dt>Tag</dt><dd>FT-101</dd></div>
            <div><dt>Type</dt><dd>Flow transmitter</dd></div>
            <div><dt>Loop</dt><dd>101</dd></div>
            <div><dt>Line</dt><dd>4"-P-1001</dd></div>
            <div><dt>Range</dt><dd>0–100 m³/h</dd></div>
            <div><dt>Signal</dt><dd>4–20 mA</dd></div>
          </dl>
        </section>
        <section className="st-pane st-sim">
          <h3 className="vz-head"><span>Process</span><span className="mono ok">Solved</span></h3>
          <ul className="st-vals">
            <li><span>45.0</span><i>m³/h</i></li>
            <li><span>2.40</span><i>bar</i></li>
            <li><span>78.2</span><i>°C</i></li>
            <li className="state"><span className="run">Running</span></li>
          </ul>
        </section>
        <section className="st-pane st-hmi">
          <h3 className="vz-head"><span>Operator screen</span><span className="mono run">Live</span></h3>
          <HmiMimic />
        </section>
      </div>
    </div>
  )
}
