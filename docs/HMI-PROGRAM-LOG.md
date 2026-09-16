# The HMI programme, as built

A record of the Steps A–J sequence that took IPD Studio's HMI from a demo
screen to an operator workstation with a real process model behind it: what
shipped, what was deliberately refused, and why. Written for whoever picks this
up next — including a later version of the people who wrote it.

**Baseline** `eccb50d` · **v0.21.0** · **3034 tests passing, 0 failing**

Companion documents:

- `docs/HMI-AUDIT.md` — the Phase 0 audit that started this, and the Step J
  production-readiness audit that closed it.
- `docs/HMI.md` — how the system works, for someone using it.

Throughout, three rules never moved:

```text
the P&ID is the engineering source
the HMI is a snapshot a person lays out by hand
runtime state never becomes document state
```

Every capability below is additive. `schemaVersion` stayed at **6**, one
optional field was added to `HmiScreen`, and every `.pnid` written before any
of this still opens.

---

## 1. Where it started

The Phase 0 audit (`docs/HMI-AUDIT.md`) read the whole system without changing
it and found the problem was not cosmetic. Four structural defects:

1. **The widget render path never read the engineering registry.** The
   simulation and the alarm engine used registry ranges, limits and units;
   every widget and the faceplate used `widget.props`. A tag whose record said
   `0–10 bar` alarmed correctly at 8 while its bar graph drew a 0–100 scale
   with no limit ticks at all.
2. **Pressure and temperature had no process model.** `PT`/`TT` PVs were a
   seeded random walk, so a `PIC`/`TIC` drove a valve against a measurement
   that could not respond. The loop was open and looked closed.
3. **Engineering units were decorative.** Flow was dimensionless in the solver
   and labelled `m³/h` by the importer. Tank capacity defaulted to *widget
   pixel area ÷ 40* — dragging a vessel's resize handle changed the process
   model.
4. **No data-quality concept existed.** A frozen transmitter rendered
   identically to a live one.

The scorecard read **21 criteria, 8 met**. It closed at **21 PASS, 1 PARTIAL**.

---

## 2. The sequence

| Step | Work | Closed |
|---|---|---|
| **A** | One resolver: every renderer draws on the compiled `TagDef` | 5.1 |
| **C** | Quality slab + forced / stale / uncertain / bad badges | 5.4 |
| **D** | `equipmentState()`, TRIP and BAD alarms, alarm `limit`/message | 5.5–5.7 |
| **B+E** | One physics pass: real units, pressure, temperature, PI retune | 5.2, 5.3 |
| **F** | Time-bounded ring-buffer history + a real trend engine | 5.8, 5.9 |
| **G** | Operator workstation: navigation, Overview, Alarms, Trends, Equipment, Diagnostics | Ph. 14–17 |
| **H** | Design tokens, colour philosophy, faceplate rewrite, mini-flowsheet | 5.10, Ph. 23 |
| **I** | Seven engineering diagnostics + P&ID↔HMI reconciliation | 5.11 |
| **J** | Production-readiness audit | — |

B was moved to sit with E because they are one change. The tank integration is
`dLevel% = (flow / capacity) × 100 × dt`. Declaring flow as m³/h and capacity
as m³ needs a `/3600` conversion, which slows every vessel by 3600× and forces
rescaled defaults, retuned gains and rebalanced time constants across ten sim
test files. Step E rewrites the same equations and needs the same retune.
Doing them separately would have meant doing the retune twice.

---

## 3. Step A — one resolver

`sim/tags.ts` compiles every widget into a `TagDef` and publishes the map, so
the mimic, the faceplates, the alarm engine and the simulation all draw against
one answer. The resolution order is stated once and applied to every value:

```text
1. the engineering registry   — the source of truth
2. the legacy widget prop     — compatibility only, for older drawings
3. the simulation default     — when nobody has said anything at all
```

The registry is never overridden by a widget: an operator screen must not be
able to contradict the engineering record. Step 2 exists so projects built
before the registry owned these values keep running, and it disappears for a
tag the moment its record states one.

## 4. Step C — data quality

`sim/quality.ts`. `Quality = good | forced | stale | uncertain | bad`, ordered
worst-first so a value that is both forced and stale reports the more alarming
of the two rather than averaging into something reassuring.

There is deliberately no `SIMULATED` member. Everything this product produces
is simulated; saying so against every value carries no information and crowds
out the qualities that do.

A **bad** reading prints dashes rather than the last number it held — the same
thing a DCS does, and for the same reason. **Forced** and **stale** keep their
number: the value is real, and it is its provenance the badge qualifies.

## 5. Step D — equipment state and alarm completeness

`sim/state.ts` `equipmentState()` is the one authoritative machine:
`stopped | starting | running | stopping | tripped | disabled`. The mimic, the
faceplate and the Equipment page all read it, so they cannot disagree about
whether a pump is running.

Alarms gained TRIP and BAD, and every alarm record gained its `limit` and a
message with enough context to act on — which is what makes the alarm list
readable without going to look something up.

## 6. Steps B+E — real units and real physics

**Units are declared once** (`sim/units.ts`) and converted at the boundary:
flow m³/h, volume m³, pressure bar, temperature °C, level %, time s.

**Physical quantities come from the engineering record** (`model/processData.ts`)
and never from geometry. Capacity is `construction.volume`; pump duty is
`duty.capacity` and `duty.head`; heater duty is `duty.power`.

**Pressure** (`sim/process.ts`): a quadratic pump curve with the affinity laws,
a static-head contribution from vessel level, and a pressure profile along each
branch so a `PT` bound to a line reads the pressure at that point. Shutting a
valve makes the pump ride up its curve — measured 1.020 bar open, 5.007 bar
shut, which is supply 1 + shutoff head 4.

**Temperature**: a well-mixed vessel energy balance with heater duty, inflow
mixing and ambient loss, bounded, with pipe temperatures propagated along
branches.

**Controllers** were retuned per quantity, and the error is normalised by the
instrument's span so a gain means the same thing on a 0–10 bar loop as on a
0–100 % one. Level and temperature are integrating and take a long integral
time; flow and pressure are fast and self-regulating.

### What this cost, honestly

Fourteen simulation tests failed on the unit change. Every one was a
time-horizon or magic-constant problem, and every one was fixed by rebalancing
the horizon to process-hours or asserting against `DEFAULTS.pumpFlowM3h`
instead of the literal `10`. **No assertion was weakened.**

Four real defects were found on the way:

- A pressure section off-by-one made the pipe *leaving* a pump its suction.
- A pressure loop settled with an offset — diagnosed as a two-tick limit cycle
  (loop gain ≈ 3.4) that a trace sampling every 100th tick could not see.
- `TIC-101` took its PV from tank `TK-101`'s **level**: both parse to ISA
  family T, loop 101. Controller pairing now also requires the partner to
  measure the same quantity.
- Bound transmitters came up at mid-range on RUN and RESET, so an operator saw
  a wrong number for one frame. They are now seeded from the calm-start state.

## 7. Step F — process history

`sim/history.ts`. Two ring buffers per signal (`Float64Array` values,
`Uint8Array` quality codes), **time-bounded, not sample-bounded**, mutated in
place with no intermediate arrays. Measured: 360 samples per signal after
eleven process-hours; `getSeries` at 0.011–0.013 ms.

Two defects found and fixed during the step:

- The tiers were slot-bounded, so at 300× speed the "5-minute" fine tier
  covered five hours. Expiry is now by time.
- A wide window fell to the coarse tier even when the fine tier held full
  detail. `tierFor` now prefers fine unless coarse genuinely reaches further
  back.

The trend widget owns the **window** it wants; history owns which stored
samples answer it and at what resolution. Nothing in the chart knows a ring
buffer exists, and **no sample is ever manufactured** by interpolation.

## 8. Step G — the operator workstation

Six pages behind one always-present bar: Overview, Process, Equipment, Alarms,
Trends, Diagnostics. Which page is open is session state — persisting it would
put an operator's navigation into the drawing's undo history.

`operator/summary.ts` holds every derivation the pages are built from, pure and
React-free, so the counts an operator acts on can be tested without mounting
anything. Nothing computes a second opinion: equipment state from `sim/state`,
priority from `sim/alarms`, quality from `sim/quality`, ranges from the
compiled `TagDef`.

## 9. Step H — the visual system

The audit measured **91 colour literals** across 16 components, **114 more in
CSS across 59 distinct values**, 11 ad-hoc font sizes and 6 border radii. The
faceplate ignored the theme entirely.

The worst finding was semantic, not cosmetic: `stopped` and `closed` were the
**same red as a critical alarm**, so a correctly shut-down plant looked like an
emergency.

`theme.ts` is now the design system — semantic tokens plus closed non-colour
scales, emitted as `--hmi-*` custom properties so SVG widgets and stylesheets
consume one source. **Zero colour literals remain in any HMI component**, and a
test fails the build if one returns.

Three principles, stated and enforced:

- **Normal operation recedes.** Saturated colour is reserved for conditions an
  operator must act on.
- **One meaning per colour.** Inactive is a quiet neutral; red means abnormal,
  everywhere.
- **Colour is never the only carrier.** Every state has a word, a glyph or a
  shape as well.

Visual validation caught four defects unit tests could not: the faceplate
covered the alarm banner; a controller section headed "Manual output" contained
the setpoint row; the quality glyph ran into the tag so `PT-101 F` read as an
identifier; and `TK-101` was described as "Temperature Control Station" —
ISA-5.1 letter expansion applied to an *equipment* tag, the same collision class
as the TIC/TK defect in the physics work.

## 10. Step I — diagnostics and reconciliation

**The project decision this implements:** P&ID → comparison → the operator
chooses → the HMI stays hand-editable. Not derived-by-default screens.

`model/diagnostics.ts` computes seven categories — missing tag, broken
connection, missing instrument, invalid range, invalid unit, missing simulation
model, unbound HMI object — from one function, consumed by the Checks
workspace, the Diagnostics page and the reconciliation view. A test asserts the
first two see **exactly the same finding ids**.

`model/reconcile.ts` compares a screen against the sheet it was built from and
reports added / removed / changed / unchanged. Changed needs a baseline
(`HmiScreen.baseline`, a deterministic fingerprint that excludes every runtime
and visual value), and a screen without one reports "not measured" rather than
inventing changes on first open.

Nothing is applied by looking at it. Apply is previewed from the same plan it
executes, is one document transaction, and is undoable. **Hand-laid work
survives**: existing widgets are never moved, resized, relabelled or
regenerated, and `remap` never guesses its destination.

Two decisions worth recording:

- **Two severity scales, deliberately.** A `Rule`'s severity gates document
  issue; a diagnostic's severity answers whether the plant can run. The same
  dead HMI binding is an ERROR on the Diagnostics page and a `warning` in
  Checks, because an operator screen must never block a drawing being issued.
- **Re-import was demoted, not removed.** It still rebuilds a screen from its
  sheet, and now says plainly that it discards the layout and points at
  Reconcile instead.

## 11. Step J — the production-readiness audit

Re-verified the whole system against the Phase 0 criteria from code and
measurement rather than from the previous reports. **One P0 was found and
fixed; nothing else was changed.**

### The P0: a NaN that silenced the alarm system

`measurementOf` summed branch flows with a non-null assertion. `initTags`
calls it with an **empty** map to seed bound transmitters at calm start, so
`0 + undefined` produced `NaN`. Every flow transmitter bound to a line came up
`NaN` at RUN and at RESET.

It did not stay in one tag. Controllers start in AUTO, copied the `NaN` into PV
on tick 0, `clamp()` carried it into the integrator, and from there it reached
the valve command, the valve position, the vessel inventory and that vessel's
level, pressure and temperature. **Two of the three bundled samples did this on
every run** — `sample-plant` had 13 non-finite signals within 60 s.

The reason it was a blocker is not the blank number. Every comparison against
`NaN` is false, so `evalAlarms` **stopped annunciating entirely** on the
affected tags, while quality still read **GOOD**:

```text
before:  C-101 level = NaN    alarms on C-101 = 0    plant-wide alarms = 0
after:   C-101 level = 41.59                         alarms evaluate
```

Fixed at the source with `?? 0` at the three places that read a branch flow by
key — which makes the code do what `initTags`'s own comment already claimed:
*"the calm-start plant is stationary… no flow anywhere"*. No `NaN` guard was
added to the PI: the invariant is restored at the source, and a swallow there
would hide the next such bug instead of surfacing it.

`tests/hmi/finiteness.test.ts` pins the invariant. Reverting the fix fails
**5 of its 6 tests**.

### Verified by measurement

| Property | Evidence |
|---|---|
| Determinism | Two runs from identical conditions, and a RESET, give byte-identical tag state |
| Flow ← valve | 100 % → 20 % opening moves flow 50.00 → 10.00 m³/h |
| Flow ← pump duty | A 120 m³/h rated pump delivers 120.00 m³/h |
| `dt` conversion | 20 m³ vessel at 50 m³/h for 600 s: predicted +41.67 %, measured **+41.66 %** |
| Pressure ← valve | 1.020 bar open → 5.007 bar shut = supply 1 + shutoff head 4 |
| Temperature | Heater raises it, cold inflow mixes it down, heat loss returns it to ambient, TIC holds SP 45 at PV 45.83 |
| Quality | good / forced / stale / bad / uncertain all distinct and reachable |
| History | Fresh buffer on RESET; newest sample always in the window; bounded |
| Round trip | Screens, bindings, compiled `TagDef`s, calm-start seed, baseline and diagnostics identical after save/load |
| Runtime isolation | No simulation vocabulary appears in a serialised project |

### Cost, measured

```text
simStore.tickOnce (5 Hz frame)     0.073 ms    0.04 % of the 200 ms budget
diagnose (per document change)     1.172 ms    linear, ~20 µs/tag
history.getSeries (60 min)         0.013 ms
reconcileScreen                    0.430 ms    dialog-open only
qaFor @ 500 / 2000 objects   0.337 / 1.730 ms  (Phase 0: 0.9 / 5.7 ms)
```

---

## 12. What was deliberately refused

- **Derived-by-default HMI screens.** They would throw away hand-laid operator
  work on every re-import. Reconciliation makes the divergence visible instead.
- **A second validation engine.** The seven categories are adapters onto the
  existing `Rule`/`RuleFinding` engine, so acceptance keys, standard severity
  overrides and the report UI all keep working.
- **A second rename mechanism.** `model/references.ts` still carries a record
  and every machine-written reference across a rename. Reconciliation's
  `remap` moves a widget's tag only and is explicitly not a rename.
- **Diagnostics as operator alarms.** A validation finding is not a process
  condition. Turning warnings into alarms is how an alarm list becomes noise.
- **Automatic repair of ambiguous problems.** Every fix offered is exact; a
  finding is preferable to fake correctness.
- **Softening a diagnostic to make a sample pass.** `sample-plant`'s five
  label-vs-tag findings are genuine and remain.
- **First-principles thermo-hydraulics.** The model is a declared
  simplification — conductance-based flow, quadratic pump curve, well-mixed
  vessels, no phase change — and says so rather than implying rigour it does
  not have.

## 13. Known limitations, carried forward

| Priority | Item |
|---|---|
| **P1** | Assumed pump and heater duties (`50 m³/h`, `4 bar`, `500 kW`) are not disclosed in the UI, unlike vessel capacity. Remedy is a `capacityDefaulted`-style flag plus one INFO rule; it would add findings to the bundled samples, whose QA profile is a recorded contract. |
| P2 | Faceplate header repeats the tag when the P&ID label equals it (`Faceplate.tsx`). |
| P2 | Palette previews hardcode the classic theme (`HmiPalette.tsx`), so chips are dark on the ISA-101 light ground. Editor chrome only. |
| P2 | `sample-plant`'s label-vs-tag findings — genuine data quality in the sample, not a software defect. |
| P2 | The unbound-display idle wander, the one remaining value-producing fallback. Disclosed four ways. |
| P3 | Trend axis prints `00:00` twice while the run is shorter than the span. |
| **P1** | One boundary pressure: `supplyPressureBar` is both the battery-limit header and the atmosphere, so a boundary cannot fill a vented vessel (K3.2). |
| P2 | Suction capacity is checked (K3.3) but **NPSH is not** — the model has no fluid, vapour pressure, suction temperature or elevation, so it reports only the arithmetically unachievable case and says so. |
| P2 | The suction check judges only drawings that carry HMI screens, because the process model is compiled from them (K3.3). |
| P2 | A pump reached only through another machine is not priced by the suction check: a pump is a source of head, not a resistance, so the walk stops at it (K3.3). |

## 14. What this is, and is not

IPD Studio is an **engineering desktop application with a training-grade
process simulator**. The UI says so on every screen: *Training / demo
simulation — not for operations.*

It is not a safety-certified control system. Nothing here claims SIL rating,
functional-safety compliance, or fitness to control a plant. The process model
is a documented approximation, and the value of the simulation is that it
behaves *consistently* — which the tests prove — not that it is a plant
replica.

## 15. Final state

```text
3034 tests passing · 7 skipped (all PERF-gated) · 0 failing
tsc -b clean · production build clean
46 Playwright specs passing
21 of 22 original acceptance criteria PASS, 1 PARTIAL, 0 FAIL
```

**Stop development here. The system has reached the planned acceptance
boundary.**

---

## 16. Steps K – K3.2 — the process model

Written after §15's "stop development here". The programme did stop at the
planned acceptance boundary; what follows is a separate, explicitly-scoped
engineering phase against the one thing §12 recorded as a declared
simplification: **the flow model**.

| Step | Scope | Outcome |
|---|---|---|
| K | A topology-driven process model: ports, a pressure-node/flow-edge graph, a coupled solve | **PARTIAL** — solver built and proven; the runtime integration was written and reverted |
| K2 | Make the branched solve converge | **DONE** — the clamped Newton iterate was the root cause; replaced with a backtracking line search |
| K3 | Wire it into the runtime | **PARTIAL** — written, exercised, reverted with two loops off setpoint |
| K3.1 | Find out whether those loops were mistuned | **DONE** — they were not. The setpoints were outside the reachable range |
| K3.2 | Land the integration as one atomic step | **DONE** — this section |

### What changed in K3.2

`sim/engine.ts` solves the pressure field every sub-step. The conductance model
is **removed rather than kept alongside**, which was the point: the defect was
never a wrong number, it was two sources of truth that nothing constrained to
agree. A vessel's inventory in m³ is now the state and its level is derived.
`simStore` publishes signed pipe flows and a hydraulic status object, and data
quality degrades on the solver's own `converged`, `cavitating` and
`undetermined` flags rather than presenting a float regardless.

Eleven test expectations changed. Every one is recorded individually in
`docs/HMI-AUDIT.md` § *K3.2* with its old value, its new value and the physical
reason — including the two that are **corrections of previously-faked
behaviour**: an unvalved stub off a vessel drains it (the old solver
special-cased that shape to keep a demo screen calm), and a full vessel stops
the flow at its nozzle instead of letting a clamp delete the mass that kept
arriving.

### What it does not do

- **One boundary pressure.** `supplyPressureBar` is both the battery-limit
  header and the atmosphere, so a boundary cannot fill a vented vessel. Raising
  it was tried and reverted; it backpressures every gravity drain. Pinned as a
  test so the day it is split, the test fails.
- **No NPSH check.** The solve reports a suction below absolute zero, but
  nothing warns that a drawing carries a pump duty its drawn suction cannot
  supply. Found while building the K3.2 fixture.
- **`declaredRole` has no `bottom`/`top`.** A P&ID that states a vessel nozzle
  is honoured as an attachment but its role still falls through to geometry.

### State after K3.2

```text
3120 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
189 Playwright specs passing · 2 failing, both pre-existing on a5b9793
```


---

## 17. Step K3.3 — the three K3.2 findings, closed

| Finding | Outcome |
|---|---|
| Pump suction / cavitation | **CLOSED** — two rules in the existing Checks engine over one pure derivation, `model/suction.ts`. Explicitly *not* an NPSH calculation. |
| `declaredRole` nozzle semantics | **CLOSED** — and a worse defect underneath it fixed: a vessel port name the schema did not offer produced an edge pointing at a node that was never created, so the line carried zero flow with nothing reported. |
| LV-101 calm-start movement | **CLOSED** — classification C. A final element has no command until its controller has run, so every throttling valve now comes up shut. |

Full reasoning, measurements and the one changed test in `docs/HMI-AUDIT.md`
§ *K3.3*.

**The result that most deserves carrying forward** is an identity of the
model's own constants, found while deciding where the suction check's threshold
belongs:

```text
√(supplyPressureBar / PIPE_K) = √(1 / 4e-4) = 50 m³/h = DEFAULTS.pumpFlowM3h
```

exactly. `PIPE_K` was calibrated against the default machine, so the default
pump on a single-run suction has **zero suction margin by construction**. Any
margin term in a suction check would fire on every such drawing for a reason no
draughtsman can fix, which is why the check reports only the strictly
unachievable case.

### State after K3.3

```text
3147 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
189 Playwright specs passing · 2 failing, both pre-existing on a5b9793
sample QA baseline unchanged
```


---

## 18. Step K4 — a process view derived from the topology

K3.2/K3.3 made the runtime correct. What was left was that the operator's
process page was still the P&ID's own geometry with live values painted on it.

`sim/processView.ts` derives a second PRESENTATION of the same engineering
model — nodes, edges and a layout, every one carrying the id of the
`ProcessModel` object it came from. It is not a second topology, and the P&ID
is untouched: a full census of the engineering model is recomputed on both
sides of building the view and required equal, on the K4 fixture and all three
bundled samples.

The graph is inverted on purpose. To a solver a pump is an edge between two
pressure nodes; to an operator it is a thing you look at, and the pipe is the
line between things. So devices become boxes, pipes become lines, and a
vessel's nozzles collapse into one vessel.

Everything on it is read from the solve: direction is the **sign** of the pipe
flow, animation exists only while something is actually passing, an FT reads
its own edge rather than a branch total, a valve shows position and flow as two
separate things, and a vessel's level is its inventory. A solve that cannot
stand behind its numbers says so, in words, on the quality channel rather than
the alarm palette.

**Static and dynamic are separated**, which §23 asked for and which the
measurements bear out: the layout is built once per run (0.035–0.88 ms) and its
object identity is unchanged across hundreds of ticks.

The two operator pages are now named for what they are: **Process flow** (the
topology-derived view) and **Mimic** (the drawn P&ID geometry, live). Neither
replaced the other, and the engineering canvas is untouched.

### State after K4

```text
3189 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
196 Playwright specs passing · 2 failing, both pre-existing on a5b9793
sample QA baseline unchanged
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | The Overview page keeps its own linear flowsheet strip over the BRANCH projection. Both are presentations of the same compiled model, but there are now two presentation derivations; folding the strip onto `processView` would leave one. |
| P2 | Fluid identity is a reserved token only. There is no fluid, no colour coding and no mixing physics, by design for this phase. |
| P2 | A passive boundary cannot supply against a pumped header — the one-boundary limitation from K3.2, now visible on the process view as a second source reading `DESTINATION`. |
