// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { JSX } from 'react'
import { Bubble, Line, Orifice } from './isa'

/**
 * FT-101, SIX TIMES.
 *
 * One instrument, drawn as it appears at each stage of the workflow. The tag
 * string is the constant: it is set in the same monospace at the same size in
 * every panel, so the eye tracks it across the spine and arrives at the page's
 * actual claim — that these are six views of one engineering object, not six
 * features that happen to be adjacent.
 *
 * These stay small and quiet on purpose. At six-across they are roughly 150px
 * wide, so each carries one idea and no more; the detail lives in the showcase
 * further down the page.
 */

/** 01 — the drawing. Ink on paper, an orifice and its transmitter. */
export function StagePid() {
  return (
    <svg viewBox="0 0 140 108" role="img" aria-label="FT-101 drawn on a P&ID as an instrument bubble above an orifice plate in a process line">
      <Bubble cx={70} cy={34} letters="FT" loop="101" r={17} />
      <path d="M70 51 L70 74" className="ink-dash" />
      <Line d="M10 78 L130 78" />
      <Orifice cx={70} cy={78} h={18} />
    </svg>
  )
}

/** 02 — the record. The same object as a row in the engineering model. */
export function StageModel() {
  return (
    <div className="sv sv-table">
      <div className="sv-row sv-hd"><span>Tag</span><span>Type</span><span>Loop</span></div>
      <div className="sv-row sv-on"><span>FT-101</span><span>Flow</span><span>101</span></div>
      <div className="sv-row"><span>FIC-101</span><span>Ctrl</span><span>101</span></div>
      <div className="sv-row"><span>FCV-101</span><span>Valve</span><span>101</span></div>
    </div>
  )
}

/** 03 — a finding. Amber, because a finding is a real condition to act on. */
export function StageValidate() {
  return (
    <div className="sv sv-find">
      <div className="sv-find-hd"><span className="dot" aria-hidden="true" />Engineering check</div>
      <div className="sv-tag">FT-101</div>
      <p>Calibrated range not declared</p>
    </div>
  )
}

/** 04 — the solve. Numbers the process model produced. */
export function StageSimulate() {
  return (
    <div className="sv sv-vals">
      <div className="sv-tag">FT-101</div>
      <dl>
        <div><dt>Flow</dt><dd>45.0<i>m³/h</i></dd></div>
        <div><dt>ΔP</dt><dd>0.82<i>bar</i></dd></div>
      </dl>
    </div>
  )
}

/** 05 — the operator's view. Green is permitted: it means running. */
export function StageHmi() {
  return (
    <div className="sv sv-hmi">
      <div className="sv-hmi-hd"><span className="sv-tag">FT-101</span><span className="run">Running</span></div>
      <div className="sv-big">45.0<i>m³/h</i></div>
      <div className="sv-bar" aria-hidden="true"><span style={{ width: '45%' }} /></div>
    </div>
  )
}

/** 06 — downstream. Only formats the ledger lists as available. */
export function StageConnect() {
  return (
    <div className="sv sv-out">
      <div className="sv-tag">FT-101</div>
      <ul>
        <li>CSV</li>
        <li>DEXPI</li>
        <li>DXF</li>
        <li>PDF</li>
      </ul>
    </div>
  )
}

/** Indexed by stage id so the section can map over content.STAGES. */
export const STAGE_FIGURES: Record<string, () => JSX.Element> = {
  pid: StagePid,
  model: StageModel,
  validate: StageValidate,
  simulate: StageSimulate,
  hmi: StageHmi,
  connect: StageConnect,
}
