// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * PROCESS PORTS — where a stream is allowed to attach to a piece of equipment.
 *
 * WHY THIS EXISTS. The previous network builder attached a pipe to a WIDGET:
 * it found the nearest solid rectangle within fourteen pixels of the pipe's
 * end and called that a process connection. A vessel's inlet and outlet were
 * told apart by asking whether the pipe's first point was below 55 % of the
 * widget's height. There was no such thing as a port, so nothing could say
 * "this line lands on P-101's discharge" — only "this line is near P-101".
 *
 * A port is now a first-class object with a PROCESS ROLE. What that buys:
 *
 *  - The topology can state `P-101.discharge -> stream -> FV-101.inlet`.
 *  - Diagnostics can report equipment with no usable port, and a stream that
 *    names a port its equipment does not have.
 *  - Crucially, the port fixes only WHICH NODE a stream attaches to. It does
 *    NOT decide which way material moves. Direction is an output of the
 *    hydraulic solve, so a stream can reverse when the pressures say so —
 *    which the old model could not express at all, because its flows were
 *    non-negative by construction.
 *
 * HOW A PORT IS RESOLVED, and how honest each way is:
 *
 *  1. `declared` — the P&ID said so. `importFromPid` now carries the drawing's
 *     own port id onto the HMI pipe, so a line drawn onto a pump's suction
 *     nozzle stays attached to the suction nozzle. This is engineering data.
 *  2. `anchored` — the pipe names the widget (`aId`/`bId`) but not the port,
 *     so the role is taken from where the pipe end sits on the widget. The
 *     OBJECT is certain; the port is inferred.
 *  3. `geometric` — neither, so the widget itself was found by proximity.
 *     Reported by diagnostics, because it is a guess about what is connected
 *     to what.
 *
 * Nothing here is rendered. Port geometry is used once, at compile time, to
 * assign a role; the operator screen keeps its own drawn geometry.
 */

import type { HmiWidget } from '../../model'

/**
 * What a port DOES in the process, independent of which symbol carries it.
 *
 * Deliberately small. A role this model cannot act on would be a claim it does
 * not honour — there is no `vent`, `drain` or `relief` here because the
 * hydraulic solver treats every one of them as an opening to a boundary and
 * nothing in the model distinguishes them yet.
 */
export type PortRole =
  /** Driven equipment: where the fluid comes in. */
  | 'suction'
  /** Driven equipment: where the fluid leaves, at raised pressure. */
  | 'discharge'
  /** Inline passive equipment, upstream side. */
  | 'inlet'
  /** Inline passive equipment, downstream side. */
  | 'outlet'
  /** Vessel: a bottom nozzle. Sees the static head of the contents. */
  | 'bottom'
  /** Vessel: a top nozzle. Sees vapour space, not liquid head. */
  | 'top'

/** How confident the model is that this attachment is what the engineer drew. */
export type PortResolution = 'declared' | 'anchored' | 'geometric'

export interface ProcessPort {
  /** `<widgetId>:<role>` — stable for the life of a screen. */
  id: string
  widgetId: string
  /** The equipment tag, when the widget carries one. */
  tag?: string
  role: PortRole
  resolution: PortResolution
}

/** The port roles each kind of equipment offers. One table, stated once. */
export const PORT_SCHEMA = {
  /** A centrifugal machine: fluid in one side, out the other at higher pressure. */
  pump: ['suction', 'discharge'],
  /** A throttling or on/off element: two ports, no pressure rise. */
  valve: ['inlet', 'outlet'],
  /** Driven equipment that adds heat rather than head. Same two ports. */
  heater: ['inlet', 'outlet'],
  /** A vessel: bottom nozzles see liquid head, top nozzles do not. */
  vessel: ['bottom', 'top'],
  /** An imported graphic with no process model — a fitting, a sight glass. It
   *  still passes fluid, so it has two ports and no behaviour. */
  passthrough: ['inlet', 'outlet'],
} as const satisfies Record<string, readonly PortRole[]>

export type EquipmentKind = keyof typeof PORT_SCHEMA

/** The upstream-side role for a two-port kind, and the downstream-side one. */
export const INLET_ROLE: Record<EquipmentKind, PortRole> = {
  pump: 'suction', valve: 'inlet', heater: 'inlet', vessel: 'top', passthrough: 'inlet',
}
export const OUTLET_ROLE: Record<EquipmentKind, PortRole> = {
  pump: 'discharge', valve: 'outlet', heater: 'outlet', vessel: 'bottom', passthrough: 'outlet',
}

/**
 * Port ids the SYMBOL LIBRARY uses that name a process role outright.
 *
 * The catalogue is mostly compass-based (`n`/`s`/`e`/`w`), which says where a
 * nozzle is on the icon and not what it is for; those fall through to the
 * positional rule below. A handful of symbols name the role directly, and
 * where they do it is engineering intent and outranks any geometry.
 */
const DECLARED_ROLE: Record<string, PortRole> = {
  suction: 'suction', discharge: 'discharge',
  in: 'inlet', out: 'outlet', inlet: 'inlet', outlet: 'outlet',
}

/** A role the P&ID stated outright, or undefined when the id is positional. */
export const declaredRole = (portId: string | undefined): PortRole | undefined =>
  portId === undefined ? undefined : DECLARED_ROLE[portId.toLowerCase()]

/**
 * Which role a pipe end takes on a piece of equipment, from where it lands.
 *
 * For a VESSEL the axis is vertical and the question is only bottom or top:
 * a nozzle in the lower part of the shell sees the liquid head, one in the
 * upper part does not. The 55 % split is inherited from the previous model so
 * imported screens keep the connections they had.
 *
 * For a TWO-PORT INLINE DEVICE the process axis runs across the widget, turned
 * by its rotation, and the end on the negative side of that axis is the
 * upstream port. This says which node a stream joins. It does not say which
 * way anything flows.
 */
export function roleFromGeometry(
  kind: EquipmentKind,
  widget: HmiWidget,
  point: { x: number; y: number },
): PortRole {
  if (kind === 'vessel') {
    return point.y > widget.y + widget.h * 0.55 ? 'bottom' : 'top'
  }
  const cx = widget.x + widget.w / 2
  const cy = widget.y + widget.h / 2
  // 0° and 180° run the axis left-right; 90° and 270° run it top-bottom.
  const rot = (((widget.rotation ?? 0) % 360) + 360) % 360
  const along = rot === 90 || rot === 270 ? point.y - cy : point.x - cx
  const reversed = rot === 180 || rot === 270
  const upstream = reversed ? along > 0 : along < 0
  return upstream ? INLET_ROLE[kind] : OUTLET_ROLE[kind]
}

/** Every port a kind offers, as ids, for the equipment record. */
export const portsOf = (kind: EquipmentKind): readonly PortRole[] => PORT_SCHEMA[kind]

export const portId = (widgetId: string, role: PortRole): string => `${widgetId}:${role}`
