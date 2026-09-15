// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE equipment state machine.
 *
 * One authoritative answer to "what is this drive doing", derived once from
 * the runtime signals. Before this module the same expression —
 * `FAULT ? … : RUN ? (RAMP < 1 ? STARTING : RUNNING) : STOPPED` — was written
 * out independently in the faceplate, the pump widget and the equipment
 * widget. Three copies of a state machine is three chances for the mimic and
 * the plate to disagree about whether a pump is running.
 *
 * WHAT IS NOT HERE. There is no separate `fault` distinct from `tripped`,
 * because this model has exactly one fault and it opens the breaker: the
 * drive stops and stays stopped until an operator resets it, which is a trip.
 * A device that reports a fault while still turning would be a second signal
 * nothing in the simulation produces, and a state nothing can reach is not a
 * state — it is dead code in a union. Add it when something can raise it.
 */
export type EquipState = 'stopped' | 'starting' | 'running' | 'stopping' | 'tripped' | 'disabled'

export const EQUIP_LABEL: Record<EquipState, string> = {
  stopped: 'STOPPED', starting: 'STARTING', running: 'RUNNING',
  stopping: 'STOPPING', tripped: 'TRIPPED', disabled: 'DISABLED',
}

/**
 * The drive's state from its runtime signals.
 *
 *  - `RUN`   — the operator's command, not the machine's condition.
 *  - `RAMP`  — 0..1 of rated speed. Rising on start, falling on coast-down,
 *              which is what distinguishes STARTING from RUNNING and STOPPING
 *              from STOPPED.
 *  - `FAULT` — the protective trip. It forces `RUN` to 0 in the engine, so a
 *              trip is never a running pump with a warning light.
 *
 * `disabled` outranks everything: an operator who has taken a drive out of
 * service has said that is its state, and the mimic should say so rather than
 * report the motion underneath it. The faceplate still shows both.
 */
export function equipmentState(
  v: Record<string, number> | undefined,
  opts: { oos?: boolean } = {},
): EquipState {
  if (!v) return 'stopped'
  if (opts.oos) return 'disabled'
  if ((v.FAULT ?? 0) >= 0.5) return 'tripped'
  if ((v.RUN ?? 0) >= 0.5) return (v.RAMP ?? 1) >= 1 ? 'running' : 'starting'
  return (v.RAMP ?? 0) > 0 ? 'stopping' : 'stopped'
}

/** Is the drive turning at all? Drives the spin animation — a coasting pump
 *  is still turning, and showing it stopped would be a lie the operator can
 *  see through. */
export const isTurning = (s: EquipState): boolean =>
  s === 'starting' || s === 'running' || s === 'stopping'

/** Is this an abnormal state that should read as such on a calm screen? */
export const isAbnormal = (s: EquipState): boolean => s === 'tripped'
