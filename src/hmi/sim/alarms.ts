// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { TagDef } from './tags'
import type { Tags } from './engine'
/** Type-only, and therefore erased. K13's envelope is the ONE place the
 *  signed pump-edge flow and the trustworthiness of the solve behind it are
 *  decided; asking either question a second time here is how two modules start
 *  to disagree about whether a machine is below its minimum. */
import type { PumpEnvelope } from './envelope'
import { qualityOf } from './quality'

/** Limit levels, plus the device alarms: a valve not following its command
 *  (DEV), a drive taken out by its protection (TRIP), an instrument whose
 *  reading is not valid (BAD), and K20's machine-level minimum flow (MINF). */
export type AlarmLevel = 'LL' | 'L' | 'H' | 'HH' | 'DEV' | 'TRIP' | 'BAD' | 'MINF'
/** ISA-18.2-flavored lifecycle: pending (on-delay running, never annunciated)
 *  -> active (unacked) -> acked; return-to-normal turns active into cleared
 *  (still listed until acked) and drops acked. */
export type AlarmPhase = 'pending' | 'active' | 'acked' | 'cleared'
export type AlarmPriority = 'high' | 'medium' | 'low'
/** Why an alarm is currently not annunciating. */
export type Suppression = 'shelved' | 'oos' | 'design'

export interface AlarmRecord {
  id: string
  tag: string
  level: AlarmLevel
  phase: AlarmPhase
  since: number
  /** Resolved priority — the per-tag override is applied at eval time so the
   *  UI never needs the TagDef. */
  priority: AlarmPriority
  /** PV at the moment the alarm tripped. */
  value?: number
  /** The threshold that was crossed. Present on limit alarms only — a trip
   *  has no setpoint to have exceeded. Stored rather than looked up so the
   *  banner prints what the alarm ACTUALLY tripped against, even if an
   *  engineer edits the limit afterwards. */
  limit?: number
  /** The tag's engineering unit, so "52.4 > 50.0" can read "52.4 bar >
   *  50.0 bar". */
  unit?: string
  sup?: Suppression
}

/**
 * The operator-language line for an alarm.
 *
 * DERIVED, not stored. A `message` field would be a second copy of facts the
 * record already holds, and the copy is the one that goes stale.
 */
export function alarmMessage(a: AlarmRecord): string {
  const u = a.unit ? ` ${a.unit}` : ''
  const n = (v: number | undefined) => (v === undefined ? '—' : String(Math.round(v * 10) / 10))
  switch (a.level) {
    case 'HH':
    case 'H': return `${n(a.value)}${u} above ${n(a.limit)}${u}`
    case 'LL':
    case 'L': return `${n(a.value)}${u} below ${n(a.limit)}${u}`
    case 'DEV': return `Position ${n(a.value)} % from command — valve not following`
    case 'TRIP': return 'Tripped — drive stopped, reset required'
    case 'BAD': return 'Reading not valid — instrument fault'
    /** SIGNED, and said as such. A machine running backwards reads negative
     *  here, which is the whole reason the protection is judged on the solve's
     *  flow rather than on the transmitter's magnitude beside it. */
    case 'MINF': return `${n(a.value)}${u} below minimum flow ${n(a.limit)}${u}`
  }
}

/** Defaults: HH/LL high, H/L medium. A per-tag priority override moves the
 *  H/L pair; HH/LL always sit one step above it (never below medium). */
export function priorityOf(level: AlarmLevel, def?: Pick<TagDef, 'priority'>): AlarmPriority {
  // Device alarms are not graded by the tag's H/L priority: that override is a
  // judgement about how close to a limit matters, and it has nothing to say
  // about a drive losing its breaker.
  if (level === 'TRIP') return 'high'
  if (level === 'DEV' || level === 'BAD') return 'medium'
  /**
   * K20: MINF IS NOT GRADED HERE AND MUST NOT REACH THE LINE BELOW.
   *
   * Its priority comes from the machine's own record (`alarm.minFlowPriority`)
   * and is the thing that decides the alarm exists at all. Falling through to
   * `base` would hand it the 'medium' default and invent exactly the value
   * §12 forbids inventing — so `minFlowAlarms` seeds the priority directly and
   * never calls this. The throw is here so that a future caller who forgets
   * finds out immediately rather than shipping a fabricated priority.
   */
  if (level === 'MINF') {
    throw new Error('minimum-flow priority comes from the record, not from priorityOf')
  }
  const base = def?.priority ?? 'medium'
  if (level === 'HH' || level === 'LL') return base === 'low' ? 'medium' : 'high'
  return base
}

/** Operator/state-driven suppression, evaluated OUTSIDE the record list —
 *  records get recreated on re-violation, so a flag on them would evaporate. */
export interface SuppressionSets {
  shelvedIds?: ReadonlySet<string>
  oosTags?: ReadonlySet<string>
  sbdTags?: ReadonlySet<string>
}

/** Chronological journal entry: what happened to which alarm at sim time t. */
export interface AlarmEvent { t: number; tag: string; level: AlarmLevel; what: 'ALARM' | 'RTN' | 'ACK' }

/** Operator action: a Start/Stop, setpoint change, mode switch, shelve… The
 *  raw before/after values are kept so a slider burst can coalesce into one
 *  entry without losing where it started. */
export interface CommandEvent { t: number; tag: string; what: 'CMD'; sig: string; from: number; to: number }

/** The journal holds alarm history AND operator actions, newest first. */
export type JournalEntry = AlarmEvent | CommandEvent

/** Diff two alarm lists into journal events (raise / return-to-normal / ack).
 *  Suppressed and pending records are invisible here: entering or leaving
 *  suppression must not spam RTN/ALARM (the shelve/OOS command itself is
 *  journaled separately), and a pending alarm was never annunciated. */
export function alarmEvents(prev: AlarmRecord[], next: AlarmRecord[], t: number): AlarmEvent[] {
  const before = new Map(prev.map((a) => [a.id, a]))
  const out: AlarmEvent[] = []
  for (const a of next) {
    if (a.sup) continue
    const was = before.get(a.id)
    const wasAnnunciated = was !== undefined && !was.sup && was.phase !== 'pending'
    if (a.phase === 'active' && (!wasAnnunciated || was!.phase === 'cleared')) {
      out.push({ t, tag: a.tag, level: a.level, what: 'ALARM' })
    } else if (wasAnnunciated && a.phase === 'cleared' && was!.phase === 'active') {
      out.push({ t, tag: a.tag, level: a.level, what: 'RTN' })
    } else if (wasAnnunciated && a.phase === 'acked' && was!.phase !== 'acked') {
      out.push({ t, tag: a.tag, level: a.level, what: 'ACK' })
    }
  }
  for (const was of prev) {
    // an acked alarm silently dropped on return-to-normal, or a cleared one
    // removed by ack — record what physically happened
    if (was.sup || was.phase === 'pending') continue
    if (next.some((a) => a.id === was.id)) continue
    if (was.phase === 'acked') out.push({ t, tag: was.tag, level: was.level, what: 'RTN' })
    else if (was.phase === 'cleared') out.push({ t, tag: was.tag, level: was.level, what: 'ACK' })
  }
  return out
}

const isHighSide = (level: AlarmLevel) => level === 'H' || level === 'HH'

export function evalAlarms(
  defs: TagDef[],
  tags: Tags,
  prev: AlarmRecord[],
  t: number,
  sup: SuppressionSets = {},
): AlarmRecord[] {
  const byId = new Map(prev.map((a) => [a.id, a]))
  const out: AlarmRecord[] = []
  for (const d of defs) {
    if (!d.limits) continue
    const pv = tags[d.name]?.PV
    if (pv === undefined) continue
    const db = d.deadband ?? Math.abs(d.max - d.min) * 0.01
    const delay = d.alarmDelay ?? 0
    for (const level of ['LL', 'L', 'H', 'HH'] as const) {
      const limit = d.limits[level]
      if (limit === undefined) continue
      const id = `${d.name}:${level}`
      const existing = byId.get(id)
      const supKind: Suppression | undefined =
        sup.shelvedIds?.has(id) ? 'shelved'
        : sup.oosTags?.has(d.name) ? 'oos'
        : sup.sbdTags?.has(d.name) ? 'design'
        : undefined
      // hysteresis: once in alarm, the clear threshold moves out by the
      // deadband (default 1% of span) so a value sitting on the limit can't
      // chatter the annunciator
      const wasIn = existing !== undefined && existing.phase !== 'cleared'
      const isIn = wasIn
        ? (isHighSide(level) ? pv >= limit - db : pv <= limit + db)
        : (isHighSide(level) ? pv >= limit : pv <= limit)
      lifecycle(
        out, byId, id,
        () => ({
          id, tag: d.name, level, priority: priorityOf(level, d), value: pv, limit,
          ...(d.unit ? { unit: d.unit } : {}),
        }),
        isIn, t, supKind, delay, pv,
      )
    }
  }
  return out
}

/** How long commanded vs actual valve position may disagree (beyond the
 *  stroke band) before a DEV alarm annunciates. */
const DEV_DELAY = 5

/**
 * THE ONE ALARM LIFECYCLE — raise, hold, mature, clear.
 *
 * K20 extracted this from `evalAlarms` and `deviceLifecycle`, which had grown
 * two copies of the same state machine that differed only in whether an
 * on-delay was possible. There is now ONE, and limit alarms, device alarms and
 * the minimum-flow alarm all enter it. A fourth kind of alarm with a fourth
 * copy of these transitions is exactly how an ISA-18.2 implementation stops
 * being one.
 *
 * The interesting part is what does NOT happen: an alarm that is already
 * standing keeps its ORIGINAL RECORD, and therefore its timestamp and the
 * value it tripped at, rather than being recreated every tick. That is what
 * makes the journal a list of events instead of a list of samples.
 *
 *   absent/cleared + active  -> `pending` if an on-delay is configured,
 *                               else `active` immediately
 *   `pending` + delay served -> `active`, timestamped now, value refreshed
 *   `active`  + normal       -> `cleared` (still listed until acknowledged)
 *   `pending` + normal       -> dropped silently: it was never annunciated
 *   `acked`   + normal       -> dropped silently
 *
 * Suppression is applied to whatever record results, never to the transitions:
 * a shelved alarm still tracks the process, it simply does not annunciate.
 */
function lifecycle(
  out: AlarmRecord[],
  byId: Map<string, AlarmRecord>,
  id: string,
  seed: () => Omit<AlarmRecord, 'phase' | 'since'>,
  active: boolean,
  t: number,
  supKind: Suppression | undefined,
  /** ISA-18.2 on-delay, seconds. 0 — the device-alarm case — is immediate. */
  delay = 0,
  /** The reading now, written onto the record when an on-delay matures so the
   *  banner prints what the alarm ANNUNCIATED at, not what it first saw. */
  value?: number,
): void {
  const existing = byId.get(id)
  if (active) {
    let rec: AlarmRecord
    if (!existing || existing.phase === 'cleared') {
      rec = { ...seed(), phase: delay > 0 ? 'pending' : 'active', since: t }
    } else if (existing.phase === 'pending' && t - existing.since >= delay) {
      rec = { ...existing, phase: 'active', since: t, ...(value !== undefined ? { value } : {}) }
    } else {
      rec = existing
    }
    if ((rec.sup ?? undefined) !== supKind) {
      const { sup: _old, ...rest } = rec
      rec = supKind ? { ...rest, sup: supKind } : (rest as AlarmRecord)
    }
    out.push(rec)
    return
  }
  if (!existing) return
  // suppressed or never-annunciated alarms leave silently
  if (supKind || existing.phase === 'pending') return
  if (existing.phase === 'active') {
    const { sup: _s, ...rest } = existing
    out.push({ ...(rest as AlarmRecord), phase: 'cleared' })
  } else if (existing.phase === 'cleared') {
    out.push(existing)
  }
  // 'acked' + back to normal -> drop silently
}

/** Defs that measure something, and can therefore have a reading that is
 *  not valid. A valve and a motor have states, not readings. */
const MEASURES = new Set(['tank', 'display', 'controller'])

/**
 * Device alarms: the abnormal CONDITIONS of equipment, as opposed to a
 * process value crossing a limit.
 *
 *  - DEV  — command and position apart for longer than a stroke: a valve that
 *           is stuck or slipping, and cannot hide.
 *  - TRIP — a drive taken out by its protection. The audit found this missing
 *           entirely: tripping a pump stopped it and journaled the command,
 *           but annunciated nothing, so the one event an operator most needs
 *           to see never reached the banner.
 *  - BAD  — an instrument whose reading is not valid. A diagnostic alarm in
 *           the ISA-18.2 sense: it says the measurement cannot be trusted,
 *           which is different from the process being in trouble.
 *
 * Same lifecycle and suppression semantics as limit alarms throughout.
 */
export function deviceAlarms(
  defs: TagDef[],
  tags: Tags,
  prev: AlarmRecord[],
  t: number,
  sup: SuppressionSets = {},
): AlarmRecord[] {
  const byId = new Map(prev.map((a) => [a.id, a]))
  const out: AlarmRecord[] = []
  const supOf = (id: string, tag: string): Suppression | undefined =>
    sup.shelvedIds?.has(id) ? 'shelved' : sup.oosTags?.has(tag) ? 'oos' : undefined
  const raise = (d: TagDef, level: AlarmLevel, active: boolean, extra: () => { value?: number }) => {
    const id = `${d.name}:${level}`
    lifecycle(
      out, byId, id,
      () => ({ id, tag: d.name, level, priority: priorityOf(level, d), ...extra() }),
      active, t, supOf(id, d.name),
    )
  }
  for (const d of defs) {
    const tg = tags[d.name]
    if (!tg) continue
    if (d.kind === 'valve') {
      raise(d, 'DEV', (tg.DEVT ?? 0) >= DEV_DELAY, () => ({ value: Math.abs((tg.OP ?? 0) - (tg.POS ?? 0)) }))
    }
    if (d.kind === 'motor') {
      raise(d, 'TRIP', (tg.FAULT ?? 0) >= 0.5, () => ({}))
    }
    if (MEASURES.has(d.kind)) {
      raise(d, 'BAD', qualityOf(d, tg).q === 'bad', () => ({}))
    }
  }
  return out
}

/**
 * K20 — THE MINIMUM-FLOW ALARM, on the one lifecycle above.
 *
 * ── AN ALARM IS NOT A PROTECTION ──────────────────────────────────────────
 *
 * K18 raises the setpoint; this annunciates a breach. They are different
 * mechanisms answering different questions, and neither implies the other:
 *
 *   requested 12, minimum 20, effective 20, flow 22
 *       protection ACTIVE and EFFECTIVE — and NO ALARM, because the machine
 *       is passing its minimum. A protection doing its job is not an alarm.
 *
 *   requested 20, minimum 20, flow 12
 *       NO override at all — the setpoint already respected the limit — and
 *       an ALARM, because the machine is not making what it was asked for.
 *
 * So nothing here reads the override, the setpoint, the controller or its
 * mode. The condition is a fact about THE MACHINE, which is also why the alarm
 * sits on the pump's tag and exists for a pump with no controller on it at
 * all.
 *
 * ── THE CONDITION ─────────────────────────────────────────────────────────
 *
 * The machine is TURNING, the solve is one worth reading, and the SIGNED flow
 * through its own edge is below the record's minimum. That is one comparison
 * covering the three ways a running machine can be short of its limit —
 * REVERSE FLOW, DEAD-HEAD and BELOW MINIMUM FLOW — because all three are the
 * same physical hazard the limit exists to prevent, and dead-head is the worst
 * of them. K13 keeps its finer three-way classification on the diagnostics
 * page; the annunciator gets the one protective fact.
 *
 * SIGNED, with no `Math.abs` anywhere: a machine running backwards at 25 m³/h
 * is passing less than nothing forwards, and the comparison says so.
 *
 * ── WHAT IS NOT THE CONDITION ─────────────────────────────────────────────
 *
 * A STOPPED machine is not in alarm. K13 already calls it STOPPED, K16 calls
 * the loop de-energised and grades it INFORMATION, and K19 made the protection
 * say STANDING_BY — turning a switched-off pump into a standing annunciation
 * would undo all three.
 *
 * An UNTRUSTWORTHY SOLVE is not in alarm either, and this is the §15 rule: a
 * flow the network cannot determine must never be read as a LOW one. The
 * envelope's UNKNOWN state is that gate, and it is the same `faultOfNodes`
 * test any measurement bound to those nodes would get — not a second opinion
 * about quality.
 *
 * ── AND WHAT IS NOT CONFIGURED IS NOT ALARMED ─────────────────────────────
 *
 * No policy on the record, no alarm. Not a silent one, not a medium-priority
 * one, not a disabled record in the list — nothing at all. The limit still
 * exists, K13 still detects against it and K18 still protects to it; what is
 * absent is anybody's decision to annunciate.
 */
export function minFlowAlarms(
  defs: readonly TagDef[],
  envelopes: Record<string, PumpEnvelope>,
  prev: AlarmRecord[],
  t: number,
  sup: SuppressionSets = {},
): AlarmRecord[] {
  const byId = new Map(prev.map((a) => [a.id, a]))
  const out: AlarmRecord[] = []
  for (const d of defs) {
    const policy = d.minFlowAlarm
    const limit = d.minFlowM3h
    // PRIORITY IS THE ENABLE, and a policy without a limit has nothing to
    // alarm against — neither is an error, both are simply not an alarm.
    if (policy === undefined || limit === undefined) continue
    const env = envelopes[d.name]
    if (env === undefined) continue

    const id = `${d.name}:MINF`
    const existing = byId.get(id)
    const supKind: Suppression | undefined =
      sup.shelvedIds?.has(id) ? 'shelved'
      : sup.oosTags?.has(d.name) ? 'oos'
      : undefined

    /**
     * Is this machine in a state where "below minimum" MEANS anything? A shaft
     * at rest and a solve nobody can trust are both "no", and for different
     * reasons — see the note above.
     */
    const judgeable = env.state !== 'STOPPED' && env.state !== 'UNKNOWN'
      && env.flowM3h !== undefined
    /**
     * HYSTERESIS, ONLY IF THE RECORD STATES A WIDTH. Once in alarm the clear
     * threshold moves UP by the deadband, so a flow sitting exactly on the
     * limit cannot chatter the annunciator. With none stated the two tests are
     * identical and the alarm follows the instantaneous condition — which K19
     * measured crossing ~154 times in 200 s, and which is reported rather than
     * papered over. NOTHING here picks a width.
     */
    const db = policy.deadbandM3h ?? 0
    const wasIn = existing !== undefined && existing.phase !== 'cleared'
    const flow = env.flowM3h ?? 0
    const isIn = judgeable && (wasIn ? flow < limit + db : flow < limit)

    lifecycle(
      out, byId, id,
      () => ({
        id, tag: d.name, level: 'MINF' as const,
        // FROM THE RECORD, never from `priorityOf` — see the throw there.
        priority: policy.priority,
        value: flow, limit, unit: FLOW_UNIT,
      }),
      isIn, t, supKind, policy.onDelayS ?? 0, flow,
    )
  }
  return out
}

/** The unit `duty.minFlow` is converted into, and the one K13, the faceplate
 *  and the trend all say a flow in. Stated once so the banner cannot print a
 *  number in a unit the limit was not measured in. */
const FLOW_UNIT = 'm³/h'

/** Ack one alarm (by id) or all: active -> acked, cleared -> removed.
 *  Suppressed alarms don't ack — they aren't annunciating. */
export function ackAlarms(alarms: AlarmRecord[], id?: string): AlarmRecord[] {
  return alarms.flatMap((a) => {
    if (id !== undefined && a.id !== id) return [a]
    if (a.sup) return [a]
    if (a.phase === 'active') return [{ ...a, phase: 'acked' as const }]
    if (a.phase === 'cleared') return []
    return [a]
  })
}
