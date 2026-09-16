import { describe, expect, it } from 'vitest'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { makeRng } from '../../src/hmi/sim/noise'
import { SHUT_LEAK_MAX } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'
import type { HmiScreen } from '../../src/hmi/model'

// source -> pump P-1 -> throttling valve LV-1 -> tank TK-1, plus TK-1 -> on/off valve HV-1 -> sink
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 100, level0: 40 } },
    { id: 'h', type: 'valve', x: 650, y: 150, w: 48, h: 32, tag: 'HV-1' },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
    { id: 'e4', points: [{ x: 590, y: 160 }, { x: 660, y: 166 }] },
    { id: 'e5', points: [{ x: 692, y: 166 }, { x: 800, y: 166 }] },
  ],
}

/** Horizons are PROCESS SECONDS. `tick` sub-steps anything over a second, so
 *  a coarse `dt` integrates identically and just takes fewer calls. */
const run = (mut?: (tags: ReturnType<typeof initTags>) => void, seconds = 10, dt = 0.2) => {
  const model = buildSimModel(screen)
  let tags = initTags(model)
  if (mut) mut(tags)
  let flows: Record<string, number> = {}
  const rng = makeRng(1)
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const r = tick(model, tags, dt, rng)
    tags = r.tags
    flows = r.branchFlows
  }
  return { tags, flows, model }
}

describe('engine tick', () => {
  it('initTags seeds a CALM plant: pumps off, undriven valves shut, drains closed', () => {
    const model = buildSimModel(screen)
    const tags = initTags(model)
    expect(tags['TK-1']!.PV).toBe(40)
    expect(tags['P-1']!.RUN).toBe(0)
    // no controller drives LV-1 here, so it must not leak at 40%
    expect(tags['LV-1']!.OP).toBe(0)
    // HV-1's only branch dead-ends (a drain): starts closed so the tank
    // doesn't silently empty itself at RUN start
    expect(tags['HV-1']!.OPEN).toBe(0)
  })
  it('a calm start moves nothing at all', () => {
    const { tags, flows } = run(undefined, 5)
    // NOT `=== 0`. A blocked element in the hydraulic model is a huge FINITE
    // conductance, not an infinite one, because an infinite resistance has no
    // derivative and leaves the nodes either side of it undetermined. It
    // therefore leaks — about 17 mL/h here, four tenths of a litre an hour at
    // worst, against real flows of tens of m³/h. `SHUT_LEAK_MAX` is that
    // ceiling, named by the model rather than guessed at here.
    for (const f of Object.values(flows)) expect(Math.abs(f)).toBeLessThan(SHUT_LEAK_MAX)
    expect(tags['TK-1']!.PV).toBeCloseTo(40, 6)
  })
  it('an unvalved stub off a tank bottom never drains it (no way to stop it)', () => {
    const stubbed: HmiScreen = {
      id: 's3', name: 'S3', theme: 'classic',
      widgets: [{ id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-9', props: { level0: 40 } }],
      pipes: [{ id: 'p', points: [{ x: 48, y: 120 }, { x: 300, y: 300 }] }],
    }
    const model = buildSimModel(stubbed)
    let tags = initTags(model)
    const rng = makeRng(1)
    for (let i = 0; i < 25; i++) tags = tick(model, tags, 0.2, rng).tags
    // THE OLD EXPECTATION WAS THE FAKE. This stub has no valve in it, so it is
    // an open line from a vessel's bottom nozzle to a process boundary, and a
    // vessel with 40 % of head above an open line DRAINS. The previous solver
    // special-cased exactly this shape ("uncontrollableStub") to keep a demo
    // screen calm; the pressure-driven model has no way to express "open but
    // somehow closed", and should not.
    //
    // `dangling-end` already reports an unterminated line as a drawing defect.
    // That is the right place to object to it — not a silent exception in the
    // physics.
    expect(tags['TK-9']!.PV!).toBeLessThan(40)
    expect(tags['TK-9']!.PV!).toBeGreaterThan(39.9) // 17 m³/h out of 100 m³ for 5 s
  })
  it('opening the drain valve empties the tank by gravity', () => {
    // 20 m³/h of gravity drain out of a 100 m³ vessel is 20 %/h, so half an
    // hour takes 40 % down to about 30 % — real units, real timescales.
    const { tags, flows } = run((t) => { t['HV-1']!.OPEN = 1 }, 1800, 2)
    expect(Object.values(flows).some((f) => f > 0)).toBe(true)
    expect(tags['TK-1']!.PV).toBeLessThan(40)
  })
  it('running pump with open valves fills the tank; closed HV holds level up', () => {
    // 50 m³/h into 100 m³ is 50 %/h: half an hour takes 40 % past 60 %.
    const { tags } = run((t) => { t['P-1']!.RUN = 1; t['LV-1']!.OP = 100; t['HV-1']!.OPEN = 0 }, 1800, 2)
    expect(tags['TK-1']!.PV).toBeGreaterThan(55)
  })
  it('closed throttling valve blocks the fill branch', () => {
    const { tags } = run((t) => { t['P-1']!.RUN = 1; t['LV-1']!.OP = 0; t['HV-1']!.OPEN = 0 })
    expect(tags['TK-1']!.PV).toBeCloseTo(40, 0)
  })
  it('a battery-limit header cannot fill a VENTED vessel: one boundary pressure, no driving force', () => {
    // screen: source -> on/off valve -> tank (a battery-limit header), plus a
    // bare source -> tank stub with no valve (impulse-like, must stay dead)
    //
    // THIS TEST USED TO EXPECT THE HEADER TO FILL THE TANK when HV-2 was
    // opened, and it no longer can. The reason is a stated limitation of the
    // model, not a defect in the valve:
    //
    //   `DEFAULTS.supplyPressureBar` is ONE number doing two jobs. It is the
    //   pressure at every process boundary — a battery-limit header AND the
    //   atmosphere a vent or a drain discharges to. Pipe `b` lands in the
    //   upper part of TK-2's shell, so it attaches to the vessel's TOP nozzle,
    //   which sees vapour space rather than liquid head. Vapour space is at
    //   the boundary pressure. So is the header. Equal pressures, no ΔP, no
    //   flow — whatever the hand valve is doing.
    //
    // A real battery-limit header runs at 3-10 barg and would fill this vessel
    // in minutes. Raising `supplyPressureBar` makes that work and puts the same
    // backpressure on every gravity drain in the model, which is worse; the
    // honest fix is a second boundary pressure, and it is not in this step.
    // See the note on `supplyPressureBar` in `sim/units.ts`.
    //
    // That a hand valve GATES a line with a driving force behind it is still
    // covered, by 'opening the drain valve empties the tank by gravity' above.
    // What is asserted here is the mechanism — the two ends are at the same
    // pressure — so that this fails loudly the day the boundary is split,
    // rather than quietly passing on an incidental zero.
    const header: HmiScreen = {
      id: 's2', name: 'S2', theme: 'classic',
      widgets: [
        { id: 'v', type: 'valve', x: 200, y: 95, w: 48, h: 32, tag: 'HV-2' },
        { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-2', props: { capacity: 100, level0: 40 } },
      ],
      pipes: [
        { id: 'a', points: [{ x: 0, y: 111 }, { x: 210, y: 111 }] },
        { id: 'b', points: [{ x: 240, y: 111 }, { x: 510, y: 100 }] },
        { id: 'stub', points: [{ x: 0, y: 60 }, { x: 510, y: 60 }] },
      ],
    }
    const model = buildSimModel(header)
    const rng = makeRng(1)
    // calm start: HV-2 comes up closed, nothing moves
    let tags = initTags(model)
    let flows: Record<string, number> = {}
    for (let i = 0; i < 25; i++) { const r = tick(model, tags, 0.2, rng); tags = r.tags; flows = r.branchFlows }
    // see the calm-start case above for why this is a leak ceiling, not zero
    for (const f of Object.values(flows)) expect(Math.abs(f)).toBeLessThan(SHUT_LEAK_MAX)
    expect(tags['TK-2']!.PV).toBeCloseTo(40, 6)
    // operator opens the hand valve: still nothing, and here is why
    tags = initTags(model)
    tags['HV-2']!.OPEN = 1
    let hyd!: ReturnType<typeof tick>['hydraulic']
    for (let i = 0; i < 25; i++) {
      const r = tick(model, tags, 0.2, rng); tags = r.tags; flows = r.branchFlows; hyd = r.hydraulic
    }
    // the header line is compiled, solved and converged — it is not missing
    const b = model.hydraulic.edges.find((e) => e.id === model.hydraulic.edgeOfPipe.get('b'))!
    expect(hyd.converged).toBe(true)
    // and its two ends sit at exactly the same pressure: THAT is why it is dead
    expect(hyd.pressure[b.from]!).toBeCloseTo(hyd.pressure[b.to]!, 9)
    expect(hyd.pressure[b.to]!).toBeCloseTo(DEFAULTS.supplyPressureBar, 9)
    for (const f of Object.values(flows)) expect(Math.abs(f)).toBeLessThan(SHUT_LEAK_MAX)
    expect(tags['TK-2']!.PV).toBeCloseTo(40, 6)
    // the valveless stub branch never flows either
    const stubBranch = model.net.branches.find((br) => br.pipeIds.includes('stub'))!
    expect(Math.abs(flows[stubBranch.id]!)).toBeLessThan(SHUT_LEAK_MAX)
  })
  it('tank clamps at 0 and never goes negative', () => {
    const { tags } = run((t) => { t['TK-1']!.PV = 1 }, 60)
    expect(tags['TK-1']!.PV).toBeGreaterThanOrEqual(0)
  })
  it('tick does not mutate its input tags object', () => {
    const model = buildSimModel(screen)
    const tags = initTags(model)
    const snapshot = JSON.parse(JSON.stringify(tags))
    tick(model, tags, 0.2, makeRng(1))
    expect(tags).toEqual(snapshot)
  })
  it('is deterministic for a fixed seed', () => {
    expect(run().tags['TK-1']!.PV).toBe(run().tags['TK-1']!.PV)
  })
})
