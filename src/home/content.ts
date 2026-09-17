// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * EVERY CLAIM THE HOMEPAGE MAKES, AS DATA.
 *
 * A marketing page rots in one particular way: a capability is described in
 * prose while it is still being built, the prose is never revisited, and the
 * page quietly becomes a lie. The defence here is that nothing on the page
 * asserts availability in prose. Every capability, standard and roadmap item
 * is a record carrying an explicit `status`, the section components render
 * that status as a visible label, and `tests/home/content.test.ts` refuses a
 * record that claims `available` without naming the version it shipped in.
 *
 * So the honest thing and the easy thing are the same thing: to claim
 * something is available you have to be able to write down when it landed.
 */

/** Where a capability actually is. Rendered verbatim, never softened. */
export type Status = 'available' | 'developing' | 'roadmap'

export const STATUS_LABEL: Record<Status, string> = {
  available: 'Available',
  developing: 'In development',
  roadmap: 'Roadmap',
}

/**
 * The same three states, said the way they read against a STANDARD.
 *
 * A capability is "available"; a standard is not. What is true of a standard is
 * that the software implements conventions from it — which is also the strongest
 * thing that may be said here, since none of these has been formally assessed.
 */
export const STANDARD_LABEL: Record<Status, string> = {
  available: 'Implemented',
  developing: 'Developing',
  roadmap: 'Roadmap',
}

export interface Capability {
  id: string
  name: string
  /** Required for `available` — the release it shipped in. See the test. */
  since?: string
  status: Status
}

/**
 * The ledger, grouped the way the roadmap section reads it.
 *
 * `available` entries were each checked against the source tree, not against
 * the README: the editor's six workspaces (src/routes.ts), the exporters in
 * src/export/, the importers in src/import/, the rule engine in src/validate/
 * and the simulator in src/hmi/sim/.
 */
export const NOW: Capability[] = [
  { id: 'pid', name: 'P&ID drawing on an ISA-5.1 symbol library', since: '0.1.0', status: 'available' },
  { id: 'tags', name: 'Tag parsing, auto-numbering and loop derivation', since: '0.1.0', status: 'available' },
  { id: 'registry', name: 'Engineering registry — records that survive a redraw', since: '0.15.0', status: 'available' },
  { id: 'tables', name: 'Instrument index, line list, equipment and valve lists', since: '0.15.0', status: 'available' },
  { id: 'deliverables', name: 'Datasheets, loop diagrams and I/O list', since: '0.15.0', status: 'available' },
  { id: 'checks', name: 'Validation rule engine with company standard profiles', since: '0.20.0', status: 'available' },
  { id: 'hmi', name: 'HMI Studio — operator screens, ISA-101 themes, ISA-18.2 alarms', since: '0.6.0', status: 'available' },
  // 0.21.0 shipped the process model the simulation runs on: real engineering
  // units, a quadratic pump curve with the affinity laws, a pressure profile
  // and a vessel energy balance. 0.22.0 shipped the SOLVER underneath it, and
  // the two entries below it — the process view laid out from the topology,
  // and control that reaches the machine. Keeping the distinction is the point
  // of this file: nothing moves up here until it is in a release.
  { id: 'sim', name: 'Process simulation — engineering units, pump curves, pressure and temperature response', since: '0.21.0', status: 'available' },
  { id: 'hydraulic', name: 'Hydraulic network solver — valve position to resistance to pressure to flow', since: '0.22.0', status: 'available' },
  { id: 'processview', name: 'Topology-derived process view, laid out from the network rather than the drawing', since: '0.22.0', status: 'available' },
  { id: 'control', name: 'Control that reaches the machine — variable-speed drives, operating envelope, cascade', since: '0.22.0', status: 'available' },
  { id: 'exchange', name: 'DEXPI import and export, DXF export and underlay import', since: '0.1.0', status: 'available' },
  { id: 'costs', name: 'Budget and cost estimation as you draw', since: '0.10.0', status: 'available' },
  { id: 'cloud', name: 'Cloud projects and offline-capable install', since: '0.14.0', status: 'available' },
]

export const NEXT: Capability[] = [
  // Fluid IDENTITY shipped in 0.22.0 — a service belongs to a stream and
  // propagates along it. A fluid PROPERTY model, where density and viscosity
  // change what the solver computes, has not, and mixing two services is
  // reported rather than modelled. That is the distinction this entry keeps.
  { id: 'fluids', name: 'Fluid property model', status: 'developing' },
  { id: 'dexpi-conf', name: 'DEXPI conformance hardening', status: 'developing' },
  { id: 'edit-tables', name: 'Editable engineering tables', status: 'developing' },
  { id: 'staleness', name: 'Deliverable staleness tracking', status: 'developing' },
  { id: 'hmi-svg', name: 'Custom HMI widgets from imported SVG', status: 'developing' },
]

export const FUTURE: Capability[] = [
  { id: 'aml', name: 'AutomationML exchange', status: 'roadmap' },
  { id: 'mtp', name: 'MTP / modular automation', status: 'roadmap' },
  { id: 'api', name: 'APIs and plugins', status: 'roadmap' },
  { id: 'collab', name: 'Real-time collaboration and review workflow', status: 'roadmap' },
  { id: 'sis', name: 'SIS and cause & effect matrices', status: 'roadmap' },
  { id: 'moc', name: 'Management of change', status: 'roadmap' },
  { id: 'dwg', name: 'In-app DWG import', status: 'roadmap' },
]

export interface StandardRef {
  id: string
  /** The designation as it is actually written, e.g. "ISA-5.1". */
  code: string
  /** What IPD Studio does with it — never what it is certified against. */
  note: string
  status: Status
}

/**
 * The engineering references.
 *
 * WORDING RULE, and it is a legal one as much as an editorial one: none of
 * these say "compliant" or "certified", because IPD Studio has not been
 * formally assessed against any of them. They say what the software does.
 * `DISCLAIMER` below is not optional decoration — it is carried over from the
 * README and must render wherever this list renders.
 */
export const STANDARDS: StandardRef[] = [
  { id: 'isa51', code: 'ISA-5.1', note: 'Symbol conventions and instrument tag letter tables', status: 'available' },
  { id: 'isa54', code: 'ISA-5.4', note: 'Loop diagram layout', status: 'available' },
  { id: 'isa20', code: 'ISA-20', note: 'Instrument datasheet structure', status: 'available' },
  { id: 'isa101', code: 'ISA-101', note: 'High-performance HMI theme and widget styling', status: 'available' },
  { id: 'isa182', code: 'ISA-18.2', note: 'Alarm priority, deadband, shelving and out-of-service', status: 'available' },
  { id: 'iec62682', code: 'IEC 62682', note: 'The IEC counterpart to ISA-18.2 — aligned concepts, not assessed', status: 'available' },
  { id: 'dexpi', code: 'DEXPI', note: 'Proteus 4.2-shaped import and export; conformance work in progress', status: 'developing' },
  { id: 'aml', code: 'AutomationML', note: 'Planned engineering data exchange', status: 'roadmap' },
  { id: 'mtp', code: 'MTP', note: 'Planned modular automation interface', status: 'roadmap' },
]

export const DISCLAIMER =
  'Designed with these engineering standards and ecosystems in mind. IPD Studio has not been ' +
  'formally assessed or certified against any of them. Symbols are authored independently as ' +
  'original SVG from public-domain geometric conventions; this project is not affiliated with ' +
  'or endorsed by the International Society of Automation.'

/** Every outbound destination, in one place, so none of them can go stale
 *  quietly and no button can be wired to nothing. */
export const LINKS = {
  repo: 'https://github.com/Coldbari/IPD-Studio',
  docs: 'https://github.com/Coldbari/IPD-Studio/tree/main/docs',
  licence: 'https://github.com/Coldbari/IPD-Studio/blob/main/COMMERCIAL-LICENSE.md',
  dexpiMapping: 'https://github.com/Coldbari/IPD-Studio/blob/main/docs/DEXPI-MAPPING.md',
  hmiDocs: 'https://github.com/Coldbari/IPD-Studio/blob/main/docs/HMI.md',
  email: 'praharshchamp610@gmail.com',
} as const

/** The six stages of the spine. One tag, six representations — the page's
 *  whole argument, and the reason the visual is worth the space it takes. */
export interface Stage {
  id: string
  step: string
  title: string
  kicker: string
}

export const STAGES: Stage[] = [
  { id: 'pid', step: '01', title: 'P&ID', kicker: 'Process & instrumentation' },
  { id: 'model', step: '02', title: 'Engineering model', kicker: 'Structured data' },
  { id: 'validate', step: '03', title: 'Validation', kicker: 'Engineering checks' },
  { id: 'simulate', step: '04', title: 'Simulation', kicker: 'Pressure and flow' },
  { id: 'hmi', step: '05', title: 'HMI', kicker: 'Operator visualisation' },
  { id: 'connect', step: '06', title: 'Export', kicker: 'Downstream workflows' },
]

/** The licence split. Commercially load-bearing: it is how the project funds
 *  the free tier, so it stays on the page rather than in a footer link. */
export const LICENCE_FREE = [
  'Personal use, study and hobby projects',
  'Students and coursework',
  'Universities, schools and labs',
  'Charities and public research bodies',
  'Government institutions',
]

export const LICENCE_PAID = [
  'Use by or for a for-profit company, including internally',
  'P&IDs drawn for paid client or consulting work',
  'Paid operator training delivered with HMI Studio',
  'Embedding, hosting or reselling IPD Studio',
]
