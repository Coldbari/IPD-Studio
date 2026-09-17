// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

export interface DatasheetField {
  key: string
  label: string
}

/** ISA-20-style datasheet field catalog, grouped in form sections. */
export const DATASHEET_SECTIONS: Record<'general' | 'process' | 'element' | 'signal' | 'alarm', DatasheetField[]> = {
  general: [
    { key: 'general.service', label: 'Service' },
    // LEGACY, and labelled as such since v0.21. This was one free-text box
    // called "Area / Unit" — a name that admits it conflated two things. The
    // plant hierarchy is now Area -> Unit -> EngineeringRecord.unitId
    // (model/hierarchy.ts), which is structured, filterable and stable across
    // renames. The field stays, keeps every value ever typed into it, and is
    // still printed and exported; it is simply no longer the place to put new
    // information. `legacy-area-unmapped` surfaces what is still in here once
    // a project has declared an Area to map it to.
    { key: 'general.area', label: 'Area (legacy text)' },
    { key: 'general.line', label: 'Line / Equipment' },
    { key: 'general.pid', label: 'P&ID No.' },
    { key: 'general.manufacturer', label: 'Manufacturer' },
    { key: 'general.model', label: 'Model' },
  ],
  process: [
    { key: 'process.fluid', label: 'Fluid' },
    { key: 'process.phase', label: 'Phase' },
    { key: 'process.flow.min', label: 'Flow min' },
    { key: 'process.flow.norm', label: 'Flow normal' },
    { key: 'process.flow.max', label: 'Flow max' },
    { key: 'process.pressure', label: 'Operating pressure' },
    { key: 'process.temperature', label: 'Operating temperature' },
    { key: 'process.density', label: 'Density / SG' },
    { key: 'process.viscosity', label: 'Viscosity' },
  ],
  element: [
    { key: 'element.type', label: 'Element / body type' },
    { key: 'element.size', label: 'Size / rating' },
    { key: 'element.material', label: 'Material' },
    { key: 'element.connection', label: 'Process connection' },
  ],
  signal: [
    { key: 'signal.output', label: 'Output signal' },
    { key: 'signal.range', label: 'Calibrated range' },
    // The range stays ONE field. It is what a datasheet prints and what the
    // standard already requires; adding a second numeric min/max pair beside
    // it would be two answers to "what does this instrument measure", and the
    // whole point of this work is that engineering values have one owner.
    // `model/signalData.ts` reads numbers out of it for anything that needs
    // them, and says so honestly when it cannot.
    { key: 'signal.type', label: 'I/O type (AI/AO/DI/DO)' },
    { key: 'signal.units', label: 'Engineering unit' },
    { key: 'signal.setpoint', label: 'Setpoint' },
    { key: 'signal.systemTag', label: 'Control system tag' },
    /**
     * CASCADE — the loop whose SETPOINT this controller's output sets.
     *
     * On the MASTER's record, naming the slave, because that is the direction
     * the signal travels: "my output is that loop's setpoint". A cascade is a
     * DECLARED relationship and is never inferred from two loops happening to
     * share a machine.
     */
    { key: 'signal.cascadeTo', label: 'Cascade to (slave loop)' },
    { key: 'signal.power', label: 'Power supply' },
    { key: 'signal.fail', label: 'Fail action' },
    { key: 'signal.ex', label: 'Hazardous area rating' },
  ],

  /**
   * ISA-18.2 alarm setpoints.
   *
   * Engineering data, and until now it lived only in HMI widget props — which
   * meant two widgets showing one tag could disagree, and a widget with
   * nothing set still produced 5/10/90/95 from the simulator's fallbacks. Those
   * numbers were never anybody's engineering decision. They live here now.
   */
  alarm: [
    { key: 'alarm.LL', label: 'Low low (LL)' },
    { key: 'alarm.L', label: 'Low (L)' },
    { key: 'alarm.H', label: 'High (H)' },
    { key: 'alarm.HH', label: 'High high (HH)' },
    { key: 'alarm.priority', label: 'Alarm priority (high/medium/low)' },
  ],
}

/** Prune sections that make no sense for the instrument's letters. */
export function fieldsFor(letters: string): typeof DATASHEET_SECTIONS {
  const noProcess = letters.startsWith('H') // hand devices
  return {
    general: DATASHEET_SECTIONS.general,
    process: noProcess ? [] : DATASHEET_SECTIONS.process,
    element: DATASHEET_SECTIONS.element,
    signal: DATASHEET_SECTIONS.signal,
    // A hand device has no alarms to set either — the same reason process
    // conditions are pruned for it.
    alarm: noProcess ? [] : DATASHEET_SECTIONS.alarm,
  }
}
