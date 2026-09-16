// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { EntityKind } from './registry'
import { DATASHEET_SECTIONS } from './datasheet'
import { HIERARCHY_FIELD_LABELS } from './hierarchy'
import { LOOP_FIELD_LABELS } from './loop'

/**
 * The free-text field that WAS the nozzle schedule, before there was one.
 *
 * Retired exactly as `LEGACY_AREA_FIELD` was: the key never moves, the value is
 * never migrated or deleted, and the column still exports — what changes is the
 * label, so it no longer competes with the structured schedule that now sits
 * beside it in the same panel. "Nozzle schedule" naming a text box next to the
 * real one is two answers to one question.
 *
 * Nothing writes it. An engineer who has typed into it keeps every word.
 */
export const LEGACY_CONNECTIONS_FIELD = 'construction.connections'

export interface FieldDef {
  key: string
  label: string
}

export interface FieldSection {
  id: string
  title: string
  fields: FieldDef[]
}

/**
 * What an engineering record is asked for, per kind of object.
 *
 * The instrument catalog IS the existing ISA-20 datasheet form — the same field
 * keys, so a migrated `node.datasheet` transfers verbatim and the datasheet
 * editor and this panel are two views of one record rather than two stores.
 *
 * This is a fixed catalog for now. From v0.17 the active company standard
 * chooses the sections and marks fields required; the shape here is what that
 * profile will supply.
 */
export const FIELD_CATALOG: Record<EntityKind, FieldSection[]> = {
  instrument: [
    { id: 'general', title: 'Identity & Service', fields: DATASHEET_SECTIONS.general },
    { id: 'process', title: 'Process Conditions', fields: DATASHEET_SECTIONS.process },
    { id: 'element', title: 'Element / Body', fields: DATASHEET_SECTIONS.element },
    { id: 'signal', title: 'Signal & Electrical', fields: DATASHEET_SECTIONS.signal },
    { id: 'alarm', title: 'Alarm Setpoints', fields: DATASHEET_SECTIONS.alarm },
  ],
  valve: [
    {
      id: 'general',
      title: 'Identity & Service',
      fields: [
        { key: 'general.service', label: 'Service' },
        { key: 'general.area', label: 'Area (legacy text)' },
        { key: 'general.line', label: 'Line' },
        { key: 'general.pid', label: 'P&ID No.' },
        { key: 'general.manufacturer', label: 'Manufacturer' },
        { key: 'general.model', label: 'Model' },
      ],
    },
    {
      id: 'element',
      title: 'Body & Trim',
      fields: [
        { key: 'element.size', label: 'Size' },
        { key: 'element.rating', label: 'Pressure class / rating' },
        { key: 'element.bodyMaterial', label: 'Body material' },
        { key: 'element.trim', label: 'Trim' },
        { key: 'element.connection', label: 'End connection' },
        { key: 'element.characteristic', label: 'Flow characteristic' },
        { key: 'element.cv', label: 'Cv / Kv' },
      ],
    },
    {
      id: 'actuation',
      title: 'Actuation',
      fields: [
        { key: 'actuation.actuator', label: 'Actuator type' },
        { key: 'actuation.failPosition', label: 'Fail position (FC/FO/FL)' },
        { key: 'actuation.signal', label: 'Command signal' },
        { key: 'actuation.positioner', label: 'Positioner' },
        { key: 'actuation.airSupply', label: 'Air supply' },
      ],
    },
  ],
  equipment: [
    {
      id: 'general',
      title: 'Identity & Service',
      fields: [
        { key: 'general.service', label: 'Service' },
        { key: 'general.area', label: 'Area (legacy text)' },
        { key: 'general.type', label: 'Equipment type' },
        { key: 'general.pid', label: 'P&ID No.' },
        { key: 'general.manufacturer', label: 'Manufacturer' },
        { key: 'general.model', label: 'Model' },
      ],
    },
    {
      id: 'duty',
      title: 'Duty & Capacity',
      fields: [
        { key: 'duty.capacity', label: 'Capacity / flow' },
        { key: 'duty.head', label: 'Head / differential' },
        { key: 'duty.power', label: 'Driver power' },
        { key: 'duty.speed', label: 'Speed' },
        { key: 'duty.designPressure', label: 'Design pressure' },
        { key: 'duty.designTemperature', label: 'Design temperature' },
      ],
    },
    {
      id: 'construction',
      title: 'Construction',
      fields: [
        { key: 'construction.material', label: 'Material' },
        { key: 'construction.volume', label: 'Volume / area' },
        { key: 'construction.insulation', label: 'Insulation' },
        { key: LEGACY_CONNECTIONS_FIELD, label: 'Connections (legacy text)' },
      ],
    },
  ],
  line: [
    {
      id: 'general',
      title: 'Identity & Service',
      fields: [
        { key: 'general.service', label: 'Service' },
        { key: 'general.fluid', label: 'Fluid' },
        { key: 'general.from', label: 'From' },
        { key: 'general.to', label: 'To' },
        { key: 'general.pid', label: 'P&ID No.' },
      ],
    },
    {
      id: 'spec',
      title: 'Pipe Specification',
      fields: [
        { key: 'spec.size', label: 'Nominal size' },
        { key: 'spec.class', label: 'Pipe class / rating' },
        { key: 'spec.material', label: 'Material' },
        { key: 'spec.schedule', label: 'Schedule / thickness' },
      ],
    },
    {
      id: 'design',
      title: 'Design Conditions',
      fields: [
        { key: 'design.pressure', label: 'Design pressure' },
        { key: 'design.temperature', label: 'Design temperature' },
        { key: 'design.operatingPressure', label: 'Operating pressure' },
        { key: 'design.operatingTemperature', label: 'Operating temperature' },
        { key: 'design.insulation', label: 'Insulation' },
        { key: 'design.tracing', label: 'Tracing' },
        { key: 'design.testPressure', label: 'Test pressure' },
        // A battery limit whose pressure MOVES during a run declares it here.
        // Absent means static, which is what a terminal is unless it says
        // otherwise — see `boundarySignal` in model/processData.ts.
        { key: 'design.boundarySignal', label: 'Boundary signal (constant/step/ramp)' },
        { key: 'design.boundarySignalTo', label: 'Boundary signal to' },
        { key: 'design.boundarySignalAt', label: 'Boundary signal at' },
        { key: 'design.boundarySignalOver', label: 'Boundary signal over' },
      ],
    },
  ],
}

/** Every field key a kind can hold, for CSV headers and completeness maths. */
export function fieldKeysFor(kind: EntityKind): string[] {
  return FIELD_CATALOG[kind].flatMap((s) => s.fields.map((f) => f.key))
}

/**
 * Field key -> label, for every catalogue field plus the reserved structured
 * ones.
 *
 * A Unit is not in `FIELD_CATALOG` because it is not a text field: it is a
 * reference, picked from the declared hierarchy and stored as a stable id. But
 * it IS nameable in a company standard's required list, and anything that can
 * be required has to be printable in the message that says it is missing — so
 * its label lives here rather than in a second lookup somewhere else.
 */
const LABELS: Record<string, string> = {
  ...Object.fromEntries(
    Object.values(FIELD_CATALOG).flatMap((sections) =>
      sections.flatMap((s) => s.fields.map((f) => [f.key, f.label] as const)),
    ),
  ),
  ...HIERARCHY_FIELD_LABELS,
  ...LOOP_FIELD_LABELS,
}

export function labelForField(key: string): string {
  return LABELS[key] ?? key
}
