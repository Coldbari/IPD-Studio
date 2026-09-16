// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'
import { useEffect } from 'react'
import type { HmiScreen } from './model'
import type { SimModel } from './sim/engine'
import { buildSimModel, initTags, processFaultOf, tick } from './sim/engine'
import type { Registry } from '../model/registry'
import type { TagDef } from './sim/tags'
import { tagDefMap } from './sim/tags'
import type { AlarmRecord, JournalEntry, SuppressionSets } from './sim/alarms'
import type { Tags } from './sim/engine'
import { ackAlarms, alarmEvents, deviceAlarms, evalAlarms } from './sim/alarms'
import { pushCommand } from './sim/commands'
import type { QualityState } from './sim/quality'
import { qualityOf } from './sim/quality'
import type { SolveResult } from './sim/hydraulic/solver'

import { makeRng } from './sim/noise'
import { parseSignalRef } from './tagIndex'
import type { SimSpeed } from './sim/units'
import { History, qualityCode } from './sim/history'
import type { FlowPath } from './sim/topology'
import { projectTopology } from './sim/topology'

/**
 * What the hydraulic solve managed this tick, published for the operator.
 *
 * The numbers the solve produced are useless without this: a pressure field
 * that did not converge still has a float at every node. Everything here is
 * small and scalar-ish on purpose — the full `SolveResult` carries a pressure
 * and a flow per node and edge, and putting that in the store would re-render
 * the canvas on every tick for data nothing draws.
 */
export interface HydraulicStatus {
  /** False means no value derived from this tick is a reading. */
  converged: boolean
  /** Worst mass-balance residual at any junction, m³/h. */
  residual: number
  iterations: number
  /** Why it stopped, when it did not converge. */
  reason?: SolveResult['reason']
  /** Nodes driven below absolute zero — the model cannot represent these. */
  cavitating: string[]
  /** Nodes with no path to a boundary: pressure LEVEL undetermined. */
  undetermined: string[]
}

const NO_SOLVE: HydraulicStatus = { converged: true, residual: 0, iterations: 0, cavitating: [], undetermined: [] }

const JOURNAL_CAP = 200
const SEED = 1234
let model: SimModel | null = null
let rng = makeRng(SEED)
/**
 * The last CONVERGED pressure field, handed to the next solve as its starting
 * guess.
 *
 * Purely an optimisation. Newton lands on the same root from any starting
 * point it converges from — to the precision a converged solve is defined to,
 * which is `MASS_TOL`; `runtimeHydraulic.test.ts` pins warm against cold and
 * measures the difference at 6e-5 m³/h. It lives here
 * rather than in the store because it is not state the UI has any business
 * subscribing to, and a 300× tick would churn it sixty times a frame.
 *
 * CLEARED whenever the plant discontinuously changes: entering a run, leaving
 * one, and RESET. A field from the previous plant is not a guess, it is a
 * different network's answer. It is also never set from an unconverged solve,
 * which would hand the next tick a starting point the solver already failed
 * to improve on.
 */
let warm: Record<string, number> | undefined

/**
 * Runtime state lives OUTSIDE the doc store on purpose: sim ticks and operator
 * actions must never enter drawing undo history or autosave churn.
 */
interface SimStoreState {
  mode: 'edit' | 'run'
  playing: boolean
  /** Seconds of PROCESS time per second of wall clock. Accelerates the clock
   *  and nothing else — `tick` sub-steps so the equations integrate at the
   *  same resolution at 300× as at 1×. */
  speed: SimSpeed
  t: number
  tags: Tags
  /**
   * The compiled engineering definition of every tag in the running plant,
   * keyed by tag.
   *
   * Published so the OPERATOR SURFACES read the same ranges, units and alarm
   * limits the simulation and the alarm engine use. Anything that draws a
   * process value takes it from here rather than resolving `widget.props`
   * for itself — that divergence is what let a 0-10 bar tag alarm at 8 while
   * its faceplate drew a 0-100 scale.
   */
  defs: Record<string, TagDef>
  /**
   * Per-tag data quality, recomputed every tick.
   *
   * Stored rather than derived so the faceplate, the badges and (later) the
   * diagnostics page all read one answer. The CANVAS is handed only the
   * `q` string out of this — a fresh `QualityState` object per tick would
   * defeat the widget memoization it took a comparator to earn.
   */
  quality: Record<string, QualityState>
  /**
   * Live flow in each DRAWN PIPE, m³/h, SIGNED.
   *
   * Straight out of the hydraulic solve, which is the only place a flow is
   * computed. Positive runs the way the pipe's own edge is oriented, so a
   * line that reverses reports a negative number instead of losing the fact.
   * Consumers that want a rate rather than a direction take the magnitude;
   * `Math.abs` at the point of use is cheaper than a second map that could
   * disagree with this one.
   */
  pipeFlows: Record<string, number>
  /** Live pressure in each pipe, bar — what a PT bound to that line reads. */
  pipePressures: Record<string, number>
  /** Live flow per branch, m³/h, straight from the solver. Published so the
   *  overview flowsheet and a vessel's inlet/outlet readout can read the flows
   *  the engine already computed rather than deriving their own. */
  branchFlows: Record<string, number>
  /** The plant as readable paths. STATIC for a run: topology changes only when
   *  the drawing does, so it is projected once at compile. */
  topology: FlowPath[]
  /** Live flow through each pump/valve tag — faceplate readout. */
  equipFlows: Record<string, number>
  /** What the hydraulic solve managed this tick. Read it before trusting
   *  anything above that came out of it. */
  hydraulic: HydraulicStatus
  alarms: AlarmRecord[]
  /** Newest-first journal: alarm lifecycle AND operator commands, capped. */
  journal: JournalEntry[]
  /**
   * Process history: ring-buffered, time-bounded, mutated IN PLACE.
   *
   * Identity is stable for the life of a run, so `historyVersion` is what
   * tells React anything changed — subscribing to `history` alone would never
   * re-render. See sim/history.ts for why it is not a map of arrays any more.
   */
  history: History
  /** Bumped whenever a sample lands. The render-side change signal. */
  historyVersion: number
  /** ISA-18.2 suppression the operator controls: shelved alarm id -> the sim
   *  time it un-shelves; tags taken out of service. */
  shelved: Record<string, number>
  oos: Record<string, true>
  /** Scenario-plugged pipe ids (flow × 0.25 through them). */
  plugged: string[]
  /** Pass every screen for a plant-wide run (navigation keeps simulating). */
  /** `registry` carries the engineering signal/alarm data the run must
   *  prefer over anything a widget holds. */
  enterRun(screens: HmiScreen | HmiScreen[], registry?: Registry): void
  exitRun(): void
  playPause(): void
  setSpeed(s: SimSpeed): void
  reset(): void
  tickOnce(dt: number): void
  writeTag(tag: string, signal: string, value: number): void
  ack(id?: string): void
  shelve(id: string, minutes: number): void
  unshelve(id: string): void
  toggleOos(tag: string): void
  /** Scenario: choke the busiest line (flow × 0.25); clearPlugs undoes. */
  plugArtery(): void
  clearPlugs(): void
}

const PLUG_FACTOR = 0.25

/** Suppressed-by-design: a flow measurement whose branch has pumps that are
 *  all commanded off is EXPECTED to read nothing — its low alarms are noise. */
function sbdSet(tags: Tags): Set<string> {
  const out = new Set<string>()
  if (!model) return out
  for (const d of model.defs) {
    if (!d.bindPipe) continue
    const br = model.net.branches.find((b) => b.pipeIds.includes(d.bindPipe!))
    if (br && br.pumps.length > 0 && br.pumps.every((p) => (tags[p]?.RUN ?? 0) < 0.5)) out.add(d.name)
  }
  return out
}

/**
 * Quality for every tag the model knows about. O(defs), once per tick.
 *
 * `hyd` is what makes this honest: without it a tag whose pressure the network
 * cannot determine, or whose solve did not converge at all, still reported
 * GOOD with a confident float beside it.
 */
function qualityMap(
  m: SimModel, tags: Tags, oos: Record<string, true>, hyd?: SolveResult,
): Record<string, QualityState> {
  const out: Record<string, QualityState> = {}
  for (const d of m.defs) {
    const process = hyd ? processFaultOf(m, hyd, d) : undefined
    out[d.name] = qualityOf(d, tags[d.name], { oos: d.name in oos, ...(process ? { process } : {}) })
  }
  return out
}

function supSets(shelved: Record<string, number>, oos: Record<string, true>, tags: Tags): SuppressionSets {
  return { shelvedIds: new Set(Object.keys(shelved)), oosTags: new Set(Object.keys(oos)), sbdTags: sbdSet(tags) }
}

export const useSimStore = create<SimStoreState>()((set, get) => ({
  mode: 'edit', playing: false, speed: 1, t: 0,
  tags: {}, defs: {}, quality: {}, pipeFlows: {}, pipePressures: {}, branchFlows: {}, topology: [], equipFlows: {}, hydraulic: NO_SOLVE, alarms: [], journal: [], history: new History(), historyVersion: 0, shelved: {}, oos: {}, plugged: [],

  enterRun: (screens, registry) => {
    model = buildSimModel(screens, registry)
    rng = makeRng(SEED)
    warm = undefined // a different plant's pressure field is not a guess
    const tags0 = initTags(model)
    // a fresh History per run: a new identity is how React learns the old
    // trend data is gone, and nothing from the previous run can leak forward
    set({ mode: 'run', playing: true, t: 0, tags: tags0, defs: tagDefMap(model.defs), quality: qualityMap(model, tags0, {}), pipeFlows: {}, pipePressures: {}, branchFlows: {}, topology: projectTopology(model.net), equipFlows: {}, hydraulic: NO_SOLVE, alarms: [], journal: [], history: new History(), historyVersion: 0, shelved: {}, oos: {}, plugged: [] })
  },
  exitRun: () => {
    model = null
    warm = undefined
    set({ mode: 'edit', playing: false, t: 0, tags: {}, defs: {}, quality: {}, pipeFlows: {}, pipePressures: {}, branchFlows: {}, topology: [], equipFlows: {}, hydraulic: NO_SOLVE, alarms: [], journal: [], history: new History(), historyVersion: 0, shelved: {}, oos: {}, plugged: [] })
  },
  playPause: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed }),
  reset: () => {
    if (!model) return
    rng = makeRng(SEED)
    warm = undefined // RESET puts the plant back to its start: solve it afresh
    const fresh = initTags(model)
    set({ t: 0, tags: fresh, quality: qualityMap(model, fresh, {}), pipeFlows: {}, pipePressures: {}, branchFlows: {}, equipFlows: {}, hydraulic: NO_SOLVE, alarms: [], journal: [], history: new History(), historyVersion: 0, shelved: {}, oos: {}, plugged: [], playing: true })
  },
  tickOnce: (dt) => {
    // local binding: the history callback below is deferred, so the module
    // narrowing on `m` does not survive into it
    const m = model
    if (!m) return
    const s = get()
    const { tags, branchFlows, pipePressures, hydraulic: hyd } = tick(m, s.tags, dt, rng, {
      ...(s.plugged.length > 0 ? { pipeFactor: (id: string) => (s.plugged.includes(id) ? PLUG_FACTOR : 1) } : {}),
      ...(warm ? { warmStart: warm } : {}),
    })
    // carried forward only from a solve that actually landed
    warm = hyd.converged ? hyd.pressure : undefined
    const t = s.t + dt
    const quality = qualityMap(m, tags, s.oos, hyd)
    // The history decides whether this instant is a sample at all, and writes
    // straight into its rings — no intermediate array, no copy of what is
    // already stored. A tick between sample periods costs one comparison.
    s.history.record(t, (put) => {
      for (const d of m.defs) {
        const tg = tags[d.name]
        if (!tg) continue
        const q = qualityCode(quality[d.name]?.q)
        if (tg.PV !== undefined) put(`${d.name}.PV`, tg.PV, q)
        if (d.kind === 'controller') {
          // an operator's setpoint and the controller's output are intent, not
          // measurement: they carry no quality of their own
          if (tg.SP !== undefined) put(`${d.name}.SP`, tg.SP)
          if (tg.OP !== undefined) put(`${d.name}.OP`, tg.OP)
        }
      }
    })
    // shelf expiry: shelved alarms come back on their own — that's the point
    let shelved = s.shelved
    let journal0 = s.journal
    for (const [id, until] of Object.entries(s.shelved)) {
      if (t < until) continue
      if (shelved === s.shelved) shelved = { ...s.shelved }
      delete shelved[id]
      journal0 = pushCommand(journal0, { t, tag: id.split(':')[0]!, what: 'CMD', sig: 'SHELVE', from: 1, to: 0 }, JOURNAL_CAP)
    }
    const sup = supSets(shelved, s.oos, tags)
    const alarms = [
      ...evalAlarms(m.defs, tags, s.alarms, t, sup),
      ...deviceAlarms(m.defs, tags, s.alarms, t, sup),
    ]
    const journal = [...alarmEvents(s.alarms, alarms, t).reverse(), ...journal0].slice(0, JOURNAL_CAP)
    const equipFlows: Record<string, number> = {}
    for (const b of m.net.branches) {
      // `?? 0` for the reason `sim/engine.ts` records: `Math.max(0, undefined)`
      // is NaN, and a NaN flow on a faceplate is a value nobody can question.
      const f = branchFlows[b.id] ?? 0
      for (const p of b.pumps) equipFlows[p] = Math.max(equipFlows[p] ?? 0, f)
      for (const v of b.valves) equipFlows[v] = Math.max(equipFlows[v] ?? 0, f)
    }
    const hydraulic: HydraulicStatus = {
      converged: hyd.converged, residual: hyd.residual, iterations: hyd.iterations,
      ...(hyd.reason ? { reason: hyd.reason } : {}),
      cavitating: hyd.cavitating, undetermined: hyd.undetermined,
    }
    set({ t, tags, quality, pipeFlows: hyd.pipeFlow, pipePressures, branchFlows, equipFlows, hydraulic, alarms, journal, historyVersion: s.history.version, shelved })
  },
  writeTag: (tag, signal, value) => {
    let tg = tag, sig = signal
    if (sig === '') {
      const ref = parseSignalRef(tag)
      if (!ref) return
      tg = ref.tag
      sig = ref.signal
    }
    set((s) => {
      const from = s.tags[tg]?.[sig] ?? 0
      /**
       * A VESSEL'S LEVEL IS NOT THE STATE — its inventory is.
       *
       * `PV` on a tank is derived from `V` every tick, so writing the level
       * alone would be overwritten by the next integration step and a forced
       * level would silently spring back. An operator or a scenario setting a
       * level is stating how much the vessel HOLDS, so the write is carried
       * into the inventory it is derived from. Without this, forcing a level
       * to raise an alarm stopped working the moment inventory became the
       * state.
       */
      const capacity = sig === 'PV' ? s.defs[tg]?.capacity : undefined
      const alsoInventory: Record<string, number> = capacity !== undefined && s.defs[tg]?.kind === 'tank'
        ? { V: (Math.max(0, Math.min(100, value)) / 100) * capacity }
        : {}
      // every operator action lands in the journal (a repeated no-op doesn't)
      const journal = from === value ? s.journal
        : pushCommand(s.journal, { t: s.t, tag: tg, what: 'CMD', sig, from, to: value }, JOURNAL_CAP)
      const tags = { ...s.tags, [tg]: { ...s.tags[tg], [sig]: value, ...alsoInventory } }
      return { tags, quality: model ? qualityMap(model, tags, s.oos) : s.quality, journal }
    })
  },
  ack: (id) =>
    set((s) => {
      const alarms = ackAlarms(s.alarms, id)
      return { alarms, journal: [...alarmEvents(s.alarms, alarms, s.t).reverse(), ...s.journal].slice(0, JOURNAL_CAP) }
    }),
  // suppression actions re-stamp the records immediately so the banner and
  // summary react even while the sim is paused
  shelve: (id, minutes) =>
    set((s) => {
      const shelved = { ...s.shelved, [id]: s.t + minutes * 60 }
      const sup = supSets(shelved, s.oos, s.tags)
      const alarms = model ? [...evalAlarms(model.defs, s.tags, s.alarms, s.t, sup), ...deviceAlarms(model.defs, s.tags, s.alarms, s.t, sup)] : s.alarms
      return {
        shelved, alarms,
        journal: pushCommand(s.journal, { t: s.t, tag: id.split(':')[0]!, what: 'CMD', sig: 'SHELVE', from: 0, to: minutes }, JOURNAL_CAP),
      }
    }),
  unshelve: (id) =>
    set((s) => {
      if (!(id in s.shelved)) return s
      const shelved = { ...s.shelved }
      delete shelved[id]
      const sup = supSets(shelved, s.oos, s.tags)
      const alarms = model ? [...evalAlarms(model.defs, s.tags, s.alarms, s.t, sup), ...deviceAlarms(model.defs, s.tags, s.alarms, s.t, sup)] : s.alarms
      return {
        shelved, alarms,
        journal: pushCommand(s.journal, { t: s.t, tag: id.split(':')[0]!, what: 'CMD', sig: 'SHELVE', from: 1, to: 0 }, JOURNAL_CAP),
      }
    }),
  plugArtery: () =>
    set((s) => {
      // the busiest un-plugged pipe: the artery an operator would notice
      // by MAGNITUDE: `pipeFlows` is signed now, and the busiest line in a
      // network with a reversed leg would otherwise sort to the bottom
      const candidates = Object.entries(s.pipeFlows)
        .map(([id, f]) => [id, Math.abs(f)] as const)
        .filter(([id]) => !s.plugged.includes(id))
        .sort((a, b) => b[1] - a[1])
      const pick = candidates[0]
      if (!pick || pick[1] <= 0) return s
      return {
        plugged: [...s.plugged, pick[0]],
        journal: pushCommand(s.journal, { t: s.t, tag: 'LINE', what: 'CMD', sig: 'PLUG', from: 0, to: 1 }, JOURNAL_CAP),
      }
    }),
  clearPlugs: () =>
    set((s) => (s.plugged.length === 0 ? s : {
      plugged: [],
      journal: pushCommand(s.journal, { t: s.t, tag: 'LINE', what: 'CMD', sig: 'PLUG', from: 1, to: 0 }, JOURNAL_CAP),
    })),
  toggleOos: (tag) =>
    set((s) => {
      const oos = { ...s.oos }
      const on = !(tag in oos)
      if (on) oos[tag] = true
      else delete oos[tag]
      const sup = supSets(s.shelved, oos, s.tags)
      const alarms = model ? [...evalAlarms(model.defs, s.tags, s.alarms, s.t, sup), ...deviceAlarms(model.defs, s.tags, s.alarms, s.t, sup)] : s.alarms
      return {
        oos, alarms,
        quality: model ? qualityMap(model, s.tags, oos) : s.quality,
        journal: pushCommand(s.journal, { t: s.t, tag, what: 'CMD', sig: 'OOS', from: on ? 0 : 1, to: on ? 1 : 0 }, JOURNAL_CAP),
      }
    }),
}))

/** Drives the sim while mounted: 5 Hz wall clock. `dt` is PROCESS seconds —
 *  0.2 s of them per frame at 1×, 60 s at 300×, sub-stepped inside `tick` so
 *  the physics never notices which one it is. */
export function useSimEngine(): void {
  const mode = useSimStore((s) => s.mode)
  const playing = useSimStore((s) => s.playing)
  const speed = useSimStore((s) => s.speed)
  useEffect(() => {
    if (mode !== 'run' || !playing) return
    const h = setInterval(() => useSimStore.getState().tickOnce(0.2 * speed), 200)
    return () => clearInterval(h)
  }, [mode, playing, speed])
}
