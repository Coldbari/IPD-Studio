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


---

## 19. Step K5 — one process picture, and what each stream carries

Two objectives, both closed.

**Consolidation.** K4's carried-forward P2 is gone: `sim/topology.ts` is
deleted and the Overview strip, the Process flow page and the faceplate's
vessel flows all read the one `ProcessViewModel`. The tests hold it by
reference — a route's objects ARE the page's objects — so there is nothing to
fall out of step. Inspecting the Overview capture turned up a real disagreement
while this was being done: the same battery limit read SUPPLY on the strip
(decided by position in the route) and DESTINATION on the page (decided by the
sign of the flow). Both now call one `boundaryRole`.

**Fluid identity.** The P&ID has had `Fluid` and `PlantEdge.fluidId` for a long
time; what it did not have was any way for the operator layer to know about
them, because the importer resolved the id to a COLOUR and dropped it. The
identity now comes across, propagates along runs through the canonical
topology, and reaches the screen as a token from a closed six-slot palette.

Two things this phase deliberately did NOT do:

- **No mixture physics.** Where two services meet the stream is MIXED and its
  components are named. No density, no viscosity, no heat capacity is computed
  for it.
- **No physics change at all.** The solver does not know a fluid exists, and a
  test solves the same plant with and without services stated and requires
  every pressure and flow to be identical to the last bit. Wiring density into
  the hydraulics is a physics change and has to be validated as one.

### State after K5

```text
3225 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
199 Playwright specs passing · 2 known failures, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| **P1** | One boundary pressure: a passive boundary cannot supply against a pumped header (K3.2). Shown truthfully on the process view rather than patched. |
| P2 | Fluid identity is INFORMATIONAL. Density and viscosity are carried but change no pressure drop, no pump head and no temperature. |
| P2 | Mixing is explicitly unsupported — MIXED names its components and computes no properties. |
| P2 | Only water has stated properties; the other starter services carry none, because none can be stated without data the model does not hold. |


---

## 20. Step K6 — hydraulic boundary conditions

An investigation phase. The finding that shaped it: the boundary model had
exactly one pressure in it, it was a constant, and its name was wrong.

`supplyPressureBar` implied a battery-limit supply header. It is the
atmosphere, and that mis-naming was the direct source of the recurring,
reasonable-sounding, wrong expectation that a free pipe end should be able to
push. `ProcessNode.pressureBar` had been declared and documented since K2 and
written exactly once, as `undefined`.

Every fixed node now names its condition — `atmospheric`, `vessel-vapour`,
`vessel-liquid`, `internal` — and a vessel whose engineering record states an
operating pressure is closed at it. **No new metadata was invented**: the field
`design.operatingPressure` already existed beside the operating temperature the
simulator has always read, and nothing read it.

What is deliberately absent: a SOURCE or SINK kind, because direction is the
solve's to decide; a stated pressure on a boundary NODE, because a free end has
no tag to hang a record on; and any reservoir model — a boundary is a pressure,
not an inventory, and its unlimited capacity is now asserted rather than
assumed.

### State after K6

```text
3261 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
206 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| **P1** | A boundary cannot be given a stated pressure: a free pipe end has no tag and so no record. Needs a tagged terminal object the importer carries across. Scoped, not started. |
| P2 | No reservoir model — a fixed-pressure node has unlimited capacity. |
| P2 | Fluid identity remains informational; the solver reads no density (K5). |
| P2 | Mixing remains explicitly unsupported (K5). |


---

## 21. Step K7 — tagged terminals

K6's remaining P1, closed. A free pipe end has no tag and so no engineering
record, which is why every boundary in the model was the atmosphere and a
battery limit could not push.

A **Battery Limit / Terminal** is now a P&ID symbol that takes a tag like any
other piece of equipment. Its boundary pressure comes off its record's
`design.operatingPressure` — the same field, read by the same function, that K6
gave to vessels, so there is one pressure system and not two.

It is the only piece of equipment that contributes **no edge**: a pump, a valve
and a fitting all conduct, so each compiles to an edge between two port nodes;
the drawing *stops* at a terminal, so it compiles to a node. That is what makes
it a boundary rather than a vessel with no volume.

The solver was not touched. K6 already had it read `node.pressureBar`; a
terminal populates it.

**Still no SOURCE and no SINK.** A terminal states a pressure and the solve
decides direction — 3 barg to 1 barg gives +40.825 m³/h, and swapping the two
records gives −40.825 on the same unchanged drawing.

### State after K7

```text
3288 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
205 Playwright passing · 2 failing, both pre-existing on a5b9793
sample QA baseline unchanged
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | Terminal pressure is STATIC — the record defines it, and there is no operator control. Runtime-variable boundaries (a header that sags under load) would be a separate phase. |
| P2 | No reservoir model — a fixed-pressure node still has unlimited capacity. |
| P2 | Fluid identity remains informational; mixing remains explicitly unsupported (K5). |


---

## 22. Step K8 — runtime operating scenarios

K7 gave a terminal a pressure from its engineering record — a fact about the
plant. What the plant is doing *today* is a different kind of fact, and K8 gives
it somewhere to live that is not the registry.

A scenario is a set of overrides keyed by engineering tag. It cannot change the
topology by construction: the only things an override can name are a tag and a
value.

**Two channels, one of them new.** Equipment — a pump's RUN, a valve's OP, a
controller's MODE — already had a runtime channel in the operator write path, so
a scenario applies those *through* it and the journal records them like any
other command. A terminal's pressure had no channel at all, which is exactly why
a scenario could not touch it.

The solver took one optional input and one line. No equation changed: every
other runtime state already arrived that way, and the boundary pressure was the
last fixed condition without a channel.

Precedence is decided in one function and every resolved value carries its
source — `scenario`, `engineering`, `default` or `invalid` — so nothing
downstream has to guess whether a pressure is a specification or a shift.

### State after K8

```text
3314 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
206 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | No operator scenario editor — K8 established the runtime contract only. The store publishes `terminals` and `scenarioProblems`; no UI reads them. |
| P2 | `clearScenario` does not rewind equipment: overrides written through the operator path stay written, and RESET is what returns the whole plant. |
| P2 | Scenarios are not persisted. Storing one in the document would make it engineering data. |
| P2 | No reservoir model; fluid identity informational; mixing unsupported. |


---

## 23. Step K9 — the operator scenario surface

K8 built the runtime scenario contract and left nothing reading it. K9 is the
surface, plus the diagnostics that go with it.

A RUN-only **Scenario** page puts the two truths side by side for every tagged
terminal — what the record says, what is in force, and which of the two — and
lets an operator hold a terminal elsewhere for this run without touching the
document. It calculates nothing: an override is a boundary condition handed to
the solver, and every number beside it is read back out of the solved state.

`scenarioProblems` surfaces as a third section on the existing Diagnostics
page, carrying the existing severity model rather than a new one.

**The K8 directional finding is now recorded as evidence.** `BL-D` is named a
product outlet and its record says 1 barg — two bar absolute, above the vessel
it connects to — so as specified it SUPPLIES the plant. Nothing was changed to
make the picture agree with the name; two tests and a screenshot record it, and
it is an engineering-data review finding rather than a software one.

One gap closed on the way: `buildProcessView` never carried a boundary node's
tag, which was correct when every boundary was an anonymous free end and wrong
from K7 onwards. A terminal now shows its identity above its observed role.

### State after K9

```text
3333 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
206 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | No scenario persistence or library — a scenario lives for the session. Storing one would make it engineering data. |
| P2 | The page edits boundary conditions only; equipment is commanded where it already was. |
| P2 | No reservoir model; fluid identity informational; mixing unsupported. |


---

## 24. Step K10 — runtime-variable boundaries

K7 gave a terminal a pressure; K8 let a scenario hold it elsewhere. Both are
still for the length of a run. A utility header that sags when the neighbouring
unit starts up is neither.

A terminal's record may now declare `constant`, `step` or `ramp`. Absent means
static, which is every terminal drawn before this. Three shapes and no more: a
boundary that moves has to move deterministically or a simulation stops being
reproducible.

The signal is compiled onto the topology once and evaluated against the engine's
own clock — a pure function of the declaration and the time, with no state and
no second timebase. Everything downstream comes out of the solve.

**Precedence contradicted itself in the brief** — the list puts the signal above
the scenario, the prose says the scenario must win. I implemented the prose,
because it is the explicit instruction and because an operator who has pinned a
boundary should not be overruled by a ramp they cannot see. The signal stays
visible while it is overridden.

**A bug in my own first cut, caught by its test:** an unreadable `at` time was
being coerced to zero, silently moving the event to a moment the record does not
state. Absent and unreadable are now different things.

### State after K10

```text
3360 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | Boundary dynamics are PRESSURE only — no flow, level or composition. |
| P2 | Three signal shapes; no repeating, no schedule, no external driver. |
| P2 | No scenario persistence or library (K9). |
| P2 | No reservoir model; fluid identity informational; mixing unsupported. |


---

## 25. Step K11 — equipment operating-state dynamics

A verification phase. The pump curve, the valve resistance law, the spin-up,
the coast-down, the stroke rate and the trip have been in the model since K3;
K11 is the evidence that the whole chain is causal, one derivation naming what
decides each command, and three findings.

**The precedence was never ambiguous, only unwritten.** A pump's shaft is
`FAULT → 0`, else the ramped shaft, else `RUN`. A valve's opening is its
POSITION rather than its command — which is exactly why a stuck valve behaves
like one, and the hydraulics have always read it that way.

**Three findings.** There is no runtime speed command: the affinity laws are in
the curve, but the shaft fraction is derived from `RUN` alone, so speed is
tested where it lives rather than invented where it does not. A stopped pump
blocks its own line, which is a stated assumption (the discharge check valve)
rather than a forcing — so the "stop is not zero" distinction is demonstrated
where it is visible, on a vessel that goes on draining by gravity with the
machine stopped. And a controller acts on the PREVIOUS tick's measurement,
which is what a real DCS does and what the loop is stable across.

### State after K11

```text
3387 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | No variable-speed drive — shaft speed is derived from RUN, with no setpoint. |
| P2 | No manufacturer equipment data: valve resistance is a calibrated constant rather than a Cv, and the pump has no NPSH curve. |
| P2 | A stopped pump blocks — the check valve is assumed, not modelled. |
| P2 | Boundary dynamics are pressure only (K10); no scenario library (K9); no reservoir model; mixing unsupported. |


---

## 26. Step K12 — variable-speed drive

K11's recommended next phase, taken. It found the affinity laws already in the
curve and the solver already taking a shaft fraction, with the runtime deriving
that fraction from `RUN` alone — so nothing could ask for part speed.

The change is one line of intent: **the shaft chases a target, and the target is
now the speed command instead of always being 1.** A machine with no declared
drive still targets 1, which is why every pre-existing test passed unchanged the
moment it landed.

Two new fields — `duty.vsd` and `duty.minSpeed` — in the `duty` group beside the
`duty.speed` already there. Two documented assumptions rather than invented
data: maximum speed is 100 % because that is where the curve is defined, and the
drive's ramp rate is used for a commanded slow-down because no record carries a
deceleration time.

Command, capability and actual shaft are three distinct things and are never
collapsed. The faceplate shows the shaft first and the command beside it.

### State after K12

```text
3410 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | No automatic speed control — no controller commands pump speed, and adding one is a new loop with its own tuning question. |
| P2 | No deceleration time on the record; the drive rate is used both ways. |
| P2 | Still no manufacturer equipment data — valve resistance is one calibrated constant for every valve. |
| P2 | No scenario library (K9); boundary dynamics are pressure only (K10); mixing unsupported (K5). |


---

## 27. Step K13 — pump operating envelope

K12's own recommended next phase, taken in the order it asked for: not the
automatic controller, but the protection layer that has to exist before one.

The inventory came first and found the thing that shaped the whole phase:
**`ratedFlow` and `head` fall back to simulator defaults**, so any minimum-flow
limit derived as a percentage of rated capacity would, on most drawings, be a
percentage of a number the simulator made up. So `duty.minFlow` is read and
never derived, and a machine with none stated reads `LIMIT UNKNOWN`.

Three concepts kept apart: the solve decides the operating point, the record
decides the envelope, and **protection does not exist yet**. A test runs a
machine dead-headed for sixty seconds and asserts it is still running.

No invented thresholds. "Nothing is moving" is `SHUT_LEAK_MAX`, the solver's
own published ceiling on a blocked element; "turning" is `shaft > 0`, the exact
test `pumpFlow` uses. Signed throughout, and the reverse-flow case is the proof
it matters: the envelope reports −29.2 m³/h while the transmitter on the same
line reads +29.2, because an FE does not know which way round it was installed.

`faultOfNodes` was split out of `processFaultOf` so a pump's nozzles and a
measurement's binding ask the same question the same way.

### State after K13

```text
3456 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P1 | The envelope now exists, so an automatic flow-or-pressure loop cascaded onto speed is the next coherent step — with its own tuning discussion. |
| P2 | Detection only: no protective action, because no engineering field defines one. No time delay on a violation, for the same reason. |
| P2 | Minimum flow is the whole envelope — no maximum continuous flow, no preferred/allowable operating region, no NPSH margin as a bound. |
| P2 | The consequence of low-flow operation (temperature rise, recirculation) is not modelled; only the condition is reported. |
| P2 | Still no manufacturer equipment data — valve resistance is one calibrated constant for every valve, and `duty.speed` is text nobody reads. |
| P2 | No scenario library (K9); boundary dynamics are pressure only (K10); mixing unsupported (K5). |


---

## 28. Step K14 — closed-loop speed control

K13's recommended next phase, taken. The envelope existed, so the loop could be
built against something.

One controller type, as the brief asked: pressure → speed. The existing PI was
reused and no second algorithm was written; what K14 added to it is an output
DESTINATION (`SPD`), an output RANGE (`[duty.minSpeed, 100]`, and `[0, 100]`
for every loop that existed before), and a tuning entry of its own. Nothing in
`TUNING` was touched.

The wiring is the interesting part. A pump does not share a loop number with
its controller, and `P-101` collides with `PIC-101` on family+loop — the exact
accidental pairing `wireControllers` already guards against. So the machine is
found the way `wireHeaters` finds a heater: by asking what produces the thing
being measured. Asked of the K7 topology rather than the branch projection,
because the branch model predates K7 and still counts a battery-limit terminal
among a path's `pumps`. The walk goes out from the measured pipe WITHOUT
CROSSING A PUMP, which is exactly the transmitter's pressure zone.

The gains were measured, not chosen: the loop was driven to instability
(kp 3.5, ti 6 — 116 % overshoot, 1.46 bar swing, never settles) and then backed
off by roughly a factor of two. The tuning target is written down in the test
file so it can be re-measured.

K11's one-tick measurement latency survives intact and is demonstrated tick by
tick. K12's command-versus-shaft distinction survives a controller. K13's
envelope is not suppressed when the controller is what caused the violation.

### State after K14

```text
3504 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P1 | One loop type only. Flow → speed is the same machinery and was deliberately left for a later phase, as was cascade. |
| P2 | A controller's default setpoint is 50, off-scale on a 0-10 bar loop until an operator sets one. Pre-existing; out of scope here. |
| P2 | No output rate limit on any loop; the drive's own ramp is what softens a step. |
| P2 | PI, not PID — there is no derivative term in this codebase. |
| P2 | Still detection only on the envelope: no protective action, no minimum-flow trip, because no field defines one. |
| P2 | Still no manufacturer equipment data — one valve constant for every valve, and `duty.speed` is text nobody reads. |
| P2 | No scenario library (K9); boundary dynamics are pressure only (K10); mixing unsupported (K5). |


---

## 29. Step K15 — controller calm-start, and flow → speed

Both of K14's P1 findings, taken in the order it listed them.

The setpoint defect turned out not to need a new field. `signal.setpoint` has
been on the instrument record and read by `engineeringFor` since the datasheet
work — it was simply never carried onto the `TagDef`, so the runtime could not
tell a configured setpoint from a defaulted one and gave everything 50. The fix
is one line of carriage plus a precedence that was already implicit: a runtime
write, else the record, else the loop's own measurement, else nothing at all.

The calm start then exposed something real. With loops no longer pinned against
a stop by a fictitious setpoint, a loop sitting ON setpoint with a noisy
transmitter and no authority over its process integrates on the noise — the
lower stop blocks the downward half and the integrator ratchets. Measured at
21 % of output after 36 minutes on a plant whose pump is stopped. Predates K15,
recorded as a K16 finding, not patched with a deadband.

The flow loop's interesting part is the binding. K14's pressure-zone walk is
the wrong question for flow: pressure is shared across a junction and flow
DIVIDES at one, so a transmitter past a tee reads a fraction of what the
machine is passing. `flowLoopCandidate` walks the machine's own stream instead
and stops at the first branch, vessel or boundary. A test moves the whole P&ID
by 4000 × 2500 and the answer is identical.

Orientation is the honest gap: a flow element in this model carries none,
because `measurementOf` takes the magnitude and no record states which way
round it was fitted. What the loop actually needs — the sign of the controlled
stream — comes out of the walk for free, and a line drawn backwards gets
`sense −1` while the plant runs identically.

Gains measured again rather than reused: 0.71 % of span per % of output against
the pressure loop's 0.4 %, because capacity goes as speed where head goes as
speed squared. K14's 1.8 puts the loop gain at 1.28 and produces a 22 m³/h
swing that never settles. 1.0 gives the same margin K14 settled on.

And the limit of one fixed gain is PINNED rather than described: hold the
discharge boundary near the machine's shutoff head and the loop hunts, between
3.4 and 37.6 m³/h on a 50 s period. A test asserts that it hunts, and that it
hunts boundedly.

### State after K15

```text
3564 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P1 | Cascade — one loop trimming another's setpoint — is now the missing piece in three places at once: it is the answer to two loops on one drive, to a flow loop that needs a pressure master, and to minimum-flow protection. |
| P1 | A loop at setpoint with no process authority integrates on measurement noise. Output tracking, or a mode that is not AUTO on a dead plant, is the real fix. |
| P2 | One fixed gain per loop type; the flow loop's is set by the machine's capacity and the resistance in front of it, and its failure mode is pinned by a test. |
| P2 | No output rate limit on any loop; the drive's ramp is all that softens a step. |
| P2 | PI, not PID — there is no derivative term in this codebase. |
| P2 | A flow element carries no installed orientation on its record. |
| P2 | The bundled demo template states no setpoint, so its loop now calm-starts. |
| P2 | Still detection only on the envelope, still no manufacturer equipment data, no scenario library (K9), pressure-only boundary dynamics (K10), mixing unsupported (K5). |


---

## 30. Step K16 — control authority

K15's P1 finding, taken.

The defect was never really about the calm start: conditional integration
freezes an integrator at a stop only when the error pushes further into it, so
the downward half of measurement noise is blocked and the upward half is not.
It ratchets. K15's calm start simply stopped masking it by pinning every loop
tens of units away from setpoint.

The honest question — would moving this actuator change this measurement — is
not answerable from runtime state and topology, and answering it properly means
solving a hypothetical network, which is invented physics. So authority is the
narrower question the runtime does state: is there an actuator, is it in the
runtime, is a driven one energised, is a valve stuck, and can the solve stand
behind the reading. Plus one that is sound rather than inferential — the machine
the MEASUREMENT depends on, because a stopped pump blocks, which is K3.3's
check-valve assumption and not a new claim. `speedLoopCandidate` and
`flowLoopCandidate` already know which machine that is.

No authority means HOLD: output and integrator exactly where the plant left
them. Measured, the output and integrator are bit-identical across thirty
minutes of a stopped machine, and on restoration the integrator moves by one
ordinary step rather than by half an hour of accumulated noise.

`SAT` is cleared rather than set while authority is gone, because an output
resting at a limit it was never allowed to leave is not saturated — and telling
an operator the setpoint is unreachable when a pump is stopped is the wrong
answer to the wrong question.

Three existing tests asserted the defect and were corrected in place with the
reason written down. The most telling was `temperature.test.ts`: "a stopped
heater delivers nothing however hard the controller asks" asserted the output
reaching 100 %. Calling for full duty WAS the defect.

What K16 does not fix is stated too: a loop with real authority still moves its
valve with the noise through its proportional term. That is ordinary
proportional action, it self-corrects, and tuning it away would be retuning.

### State after K16

```text
3606 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P1 | Cascade — still the answer to two loops on one drive, to a flow loop wanting a pressure master, and to minimum-flow protection. |
| P2 | Authority is the actuator path and the measurement's own machine, not a general answer; a valve loop in a region with a vessel or boundary differential and no running machine reads AVAILABLE, correctly. |
| P2 | Proportional action on measurement noise is untouched by design; a high-gain level loop still dithers its valve. |
| P2 | No output rate limit, PI not PID, no protective action, no manufacturer data. |
| P2 | The bundled demo template still states no setpoint (K15); no scenario library (K9); pressure-only boundary dynamics (K10); mixing unsupported (K5). |


---

## 31. Step K17 — cascade control

The P1 finding that had been carried since K15, and by K16 it was the answer in
four places at once.

One cascade: pressure master, flow slave, VSD. No control framework. The
existing `ControllerSpec` expressed it with three fields and one new `outKind`,
and the whole architecture rests on an ordering rather than a check — the two
passes that hand out drives SKIP any controller whose record declares a
cascade, so a master has nowhere to send its output but the slave's setpoint.
That holds even when the declaration turns out to be unusable, which is the
case that matters: a refused cascade falling back to the drive would be exactly
the shortcut the phase replaces.

`wireCascade` runs last because its checks are about the slave, and the slave
has to be wired before you can ask whether it drives a variable speed drive.
Order decides when the link is made; the skip decides that the master can never
be a drive's writer.

The master's output is a per cent and the slave's setpoint is in m³/h, and the
map between them is the slave's own configured range — no invented limit, and
the gain keeps meaning what it was measured to mean because the algorithm still
works in per cent throughout.

Tuning was the interesting measurement. The received wisdom is to make a master
several times slower than its slave, and it does not bind here: the inner loop
contributes almost no lag, because the hydraulics are quasi-steady and the
drive covers its travel in two seconds. What binds is the master's PROPORTIONAL
path, which with no inner lag closes a second loop at the sample rate. Above
kp 0.8 the pair limit-cycles with a 1.4 bar swing; 0.5 keeps a margin of about
1.6 and settles a 0.7 bar step in 99 s. The resulting loop gain is 0.16, a
quarter of what K14 and K15 chose, and the table says why.

K16's HOLD does the work for the master when its slave is not following —
`ControlAuthority` gained one stated condition and nothing else. No second mode
system either: the slave being in AUTO IS the cascade being in service, and
transfer is bumpless because the master writes the setpoint whether anyone is
listening or not.

Five of my own tests were wrong first, and each was wrong in an instructive
way. The best of them asserted that a flow disturbance makes the slave open up
and stay open; what actually happens is that the slave defends its setpoint
within three seconds and then the MASTER asks for less flow, because closing a
valve raises the pressure it is controlling. The test now says that, which is a
better description of what a cascade is for.

### State after K17

```text
3653 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
207 Playwright passing · 2 failing, both pre-existing on a5b9793
```

### Carried forward

| Priority | Item |
|---|---|
| P1 | Minimum-flow protection now has everything it needs: an envelope (K13), an authority model (K16) and a cascade (K17). It is the last of the four things cascade was the answer to. |
| P2 | One cascade topology only — no three-level, no split range, no feedforward, no override selectors. |
| P2 | The master's gains are this plant's, and this plant's inner loop has no lag; a slow inner loop would want the opposite treatment. |
| P2 | No SP high/low limits narrower than a slave's range; no output rate limit; PI not PID. |
| P2 | Carried: no protective action, no manufacturer data, demo template states no setpoint (K15), no scenario library (K9), pressure-only boundary dynamics (K10), mixing unsupported (K5). |

---

## 32. Step K18 — minimum-flow protection

The P1 that had been carried since K13, and by K17 it had everything it needed:
an envelope to detect with, an authority model to be honest about, and a
cascade to put an override inside.

The whole override is `effective = max(requested, duty.minFlow)`, applied to
the setpoint the algorithm uses and never written back to `SP`. It is a
CONSTRAINT, not a controller — no second PI loop, no gain, no hysteresis, no
deadband, no rate limit, no trip, no recirculation. Writing it as a `max`
rather than as a switch between two control laws is what makes it continuous,
stateless and measurement-free, which in turn is why no hysteresis width had to
be chosen for it.

The loop that carries it must both drive the machine and measure flow. The
first because the driving loop owns the only setpoint in the path; the second
because the limit is a flow, and a pressure master on the same drive has a
setpoint in bar. `wireMinFlow` runs after `resolveContention`, because two loops
fighting over one drive are both unwired and an unwired loop protects nothing.

The master needed one change and it was not a new mechanism. Conditional
integration already asks "is the output against a stop the error is pushing it
further into?", and K18 only changes WHICH stop: `lo` becomes
`max(lo, minFlowFloorPct)`, where the floor is the slave's own range run
backwards. The output is deliberately NOT clamped to it, so the master's
request stays readable beside the value being held. Measured: the integrator
comes to rest on the floor at OP 33.0 instead of winding to 23.5, and the
master is useful again on the next tick instead of after 38 seconds.

MANUAL was not a choice to make. The protection acts on the setpoint, and in
MANUAL this runtime does not use the setpoint, so there is nothing to act on.
The one line that still needs the effective value is the bumpless transfer
tracking, which has to track the setpoint AUTO will resume on — otherwise the
transfer kicks by 13.3 %.

The interesting measurement was a nuisance, not a physics result. A loop held
exactly on its minimum crosses it with every noisy sample: mean 19.998, range
19.66–20.38, 140 state crossings in 200 seconds — and K13's envelope crosses in
exact lockstep, because it is the same signed flow against the same limit. So
this is a property K18 made REACHABLE rather than one it introduced. No
hysteresis was invented for it. The warning is gated on `SAT` instead, which
already distinguishes a loop that has run out of machine from one that is
simply controlling: dead-headed +1, asked for the impossible +1, on the limit 0
throughout.

Two existing tests were corrected — both of them K15's assertions that this
feature did not exist, which was true when they were written. Three of my own
were wrong, and the best of them proved nothing: it asserted the master's
integrator was held, and it was, but by K14's existing output stop rather than
by the new floor. A test that passes with the feature removed is not a test of
the feature.

### State after K18

```text
3696 tests passing · 7 skipped · 0 failing
tsc -b clean · production build clean
209 Playwright passing · 16 skipped · 0 failing
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | The protection STATE chatters when a loop controls exactly at its minimum, and so does K13's envelope. The WARNING does not. A non-chattering state needs ISA-18.2 deadband or an on-delay, and choosing the width is a control-design decision nobody has made. |
| P2 | One limit, one direction: `duty.minFlow` only. No maximum flow, no separate thermal minimum, no time-at-low-flow accumulation. |
| P2 | No recirculation and no trip — neither is on any engineering record here. A machine whose only real protection would be spillback reads UNABLE, correctly. |
| P2 | Flow loops in m³/h only; there is no unit conversion for controller ranges, and a loop ranged otherwise is refused explicitly. |
| P2 | Carried: one cascade topology (K17), PI not PID, no output rate limit, no manufacturer data, demo template states no setpoint (K15), no scenario library (K9), pressure-only boundary dynamics (K10), mixing unsupported (K5). |

---

## 33. Step K19 — minimum-flow protection state and alarm semantics

No physics. The same solver, the same curve, the same
`effective = max(requested, duty.minFlow)`, the same signed pump-edge flow.
K19 is the phase that makes the WORDS beside those numbers correct.

### What the measurement actually said

K18's report was right about the chatter and incomplete about it. Instrumenting
the K15 fixture at a declared minimum of 20 m³/h, sampling every candidate
signal for 200 s after the loop had settled:

| Signal | Crossings / 200 s | Values seen |
|---|---|---|
| `overriding` | **0** | `true` throughout |
| effective setpoint | **0** | `20` throughout |
| `SAT` | **0** | `0` throughout |
| K18's diagnostic rows | **0** | none, throughout |
| loop authority | **0** | `available` throughout |
| protection STATE | 154 | EFFECTIVE ↔ UNABLE |
| K13 envelope STATE | 154 | NORMAL ↔ BELOW MINIMUM FLOW |
| K13's `pump-below-min-flow` ROW | **154** | present ↔ absent |

Flow mean 19.99, range 19.57–20.46. So the override itself is PROVEN not to
chatter, and K18's own warning is proven not to either — both gated correctly.
What K18 did not report is the last line: the one operator-visible row in the
product that flaps is K13's, 154 times in 200 seconds, because K18 gated its
row on `SAT` and K13's cannot borrow that gate. `SAT` belongs to a LOOP; the
envelope belongs to a MACHINE, and a machine may have no loop on it at all.

### The defect that was not the chatter

Walking the full lifecycle turned up something worse than a flapping row. Six
of thirteen points — simulation start with the pump never started, the whole of
a commanded shutdown, the coast-down, the trip — reported the protection state
as **UNABLE, in the warning colour**, for a machine that was simply switched
off. K16 had already decided this question the other way round: de-energised is
INFORMATION, because a stopped pump is a normal plant state.

UNABLE had collapsed two different facts: *the plant was asked and refused* and
*there was nobody there to ask*. `STANDING_BY` is the second of them, and it is
a subtraction from UNABLE rather than a widening of the vocabulary. It covers a
de-energised machine and a loop in MANUAL, and it is NOT a finding — K16
already publishes the lost authority and K13 already publishes STOPPED, so a
third row would be the duplicate the brief forbids.

`inForce` is the other half. In MANUAL this runtime does not use the setpoint,
so the override has no path — K18 implemented exactly that and then published
`overriding: true` next to it, telling an operator in hand control that their
setpoint was being held at 20 while their own output drove the machine. The
engine is unchanged; the field reports the branch it was already taking.

### The hysteresis that exists, and does not apply

The repository DOES contain an ISA-18.2 hysteresis and on-delay — `TagDef.deadband`
and `TagDef.alarmDelay`, per measurement tag, used by `evalAlarms`. They were
found, considered, and refused, for three reasons: they are the hysteresis on a
TAG's own configured LL/L/H/HH thresholds and `duty.minFlow` is a field on the
MACHINE's record; the comparison here is against the SIGNED solve flow and not
the tag's PV, which reads a magnitude; and absent a stated value they fall back
to 1 % of span and 0 s, so reaching for them would be inventing a number and
calling it reuse. A test sets both knobs to values far wider than the noise and
measures that the crossing does not move.

So the instantaneous, physically meaningful state is preserved and the gap is
reported. No deadband, no on-delay, no filter, no debounce, no smoothing.

### State after K19

```text
3746 tests passing · 7 skipped · 0 failing  (+50)
tsc -b clean · production build clean
209 Playwright passing · 16 skipped · 0 failing
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | **The STATE still chatters, by design.** EFFECTIVE ↔ UNABLE and NORMAL ↔ BELOW MINIMUM FLOW cross 154× / 200 s when a loop controls exactly at its minimum. Needs a deadband width or an on-delay from a control-design decision nobody has made. |
| P2 | **K13's `pump-below-min-flow` row flaps with it** and cannot be gated on `SAT` — that is loop-scoped and the row is machine-scoped. Same missing engineering value. |
| P2 | **A normal pump start raises a transient `min-flow-unable` warning.** The plant genuinely is not making the minimum while the shaft ramps and the loop is at maximum, so the statement is true; real plants suppress it with a start-up bypass timer, whose duration is an engineering value not on any record here. |
| P2 | No alarm-priority policy for minimum flow exists, so none was invented. The condition lives on the DIAGNOSTIC path — instantaneous, unlatched, unacknowledged — and not on the ISA-18.2 alarm path with its phases and journal. Moving it there needs a priority and a latching decision. |
| P2 | Carried from K18: one limit and one direction (`duty.minFlow` only); no recirculation and no trip; flow loops in m³/h only. |
| P2 | Carried: one cascade topology (K17), PI not PID, no output rate limit, no manufacturer data, demo template states no setpoint (K15), no scenario library (K9), pressure-only boundary dynamics (K10), mixing unsupported (K5). |

---

## 34. Step K20 — minimum-flow alarm policy

K19 closed on an architectural gap rather than a defect: minimum-flow
protection lived entirely on the instantaneous diagnostic path, while this
product's ISA-18.2 alarm system — pending, active, acked, cleared, shelved,
journalled — sat beside it unused. The reason turned out to be structural.
**Equipment records had no alarm section at all.** Only instrument datasheets
did (`alarm.LL/L/H/HH/priority`), so there was nowhere for an engineer to ask
for a minimum-flow alarm, and nothing to read if they had.

### A limit is not an alarm

`duty.minFlow` is a manufacturer's figure about a machine: below this flow the
impeller overheats, whether or not anybody is watching. Whether a breach calls
an operator, how seriously, with what hysteresis and after how long, is an
operating-philosophy decision made by different people and routinely absent.
So K20 adds a "Minimum-flow alarm" section to the EQUIPMENT catalogue, three
fields, all optional:

| Field | Unit | Absent means |
|---|---|---|
| `alarm.minFlowPriority` | high/medium/low | **No alarm at all** |
| `alarm.minFlowDeadband` | m³/h | No hysteresis applied |
| `alarm.minFlowDelay` | s | Annunciates immediately |

**Priority is the enable.** There is no separate on/off flag, because an enable
beside a priority creates a fourth state — enabled, priority unstated — that
nothing could answer without inventing the value §12 forbids inventing. A
record stating a deadband and a delay but no priority configures nothing.

Nothing is defaulted. `priorityOf` now *throws* if anybody asks it to grade a
MINF alarm, so a future caller who forgets finds out immediately rather than
shipping a fabricated 'medium'.

### One lifecycle, entered rather than reimplemented

`evalAlarms` and `deviceLifecycle` had grown two copies of the same state
machine, differing only in whether an on-delay was possible. K20 extracted one
`lifecycle()` and put limit alarms, device alarms and the minimum-flow alarm
through it. A fourth kind of alarm with a fourth copy of those transitions is
how an ISA-18.2 implementation stops being one.

`allAlarms()` does the same for the call sites: the tick and the three
suppression actions were three copies of the same spread and would have become
four — a banner that disagreed with itself depending on whether anybody had
touched a shelf button.

### The condition

The machine is TURNING, the solve is worth reading, and the SIGNED flow through
its own edge is below the record's minimum. One comparison covering all three
ways a running machine can be short — REVERSE FLOW, DEAD-HEAD and BELOW MINIMUM
FLOW — because they are the same physical hazard and dead-head is the worst of
them. K13 keeps its finer three-way classification on the diagnostics page.

Not in alarm: a STOPPED or tripped machine (K13 says STOPPED, K16 says
de-energised/info, K19 says STANDING_BY — a fourth surface calling it an alarm
would undo all three), and an untrustworthy solve, which must never be read as
a low flow.

Nothing reads the override, the setpoint, the controller or its mode. Measured
both ways: protection ACTIVE and EFFECTIVE with the machine above its minimum
raises nothing, and a machine short of its minimum with no override running at
all raises an alarm.

### What was not invented

- **Off-delay** — the framework has none at all; return-to-normal goes straight
  to `cleared`. Adding one changes every alarm in the product. Reported.
- **Start-up bypass** — a timer with a duration, and no record states one. A
  normal pump start therefore annunciates, which is physically true. The
  configurable on-delay is the mechanism that covers it; there is no second,
  hidden one beside it.
- **Deadband width and on-delay** — fields, not values.

### The chatter, finally answerable

K19 measured ~154 crossings in 200 s and could do nothing about it. Measured
now on the same fixture, counting annunciator transitions:

```text
no deadband stated       > 10 transitions / 200 s
2 m³/h stated on record  <=  2 transitions / 200 s
```

The instantaneous condition still crosses — §19 says it may — and the override
still does not. What changed is that an engineer can now stop the annunciator
flapping by stating a width, instead of the product choosing one.

### State after K20

```text
3798 tests passing · 7 skipped · 0 failing  (+52)
tsc -b clean · production build clean
209 Playwright passing · 16 skipped · 0 failing
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | **No off-delay anywhere in the alarm framework.** Return-to-normal is immediate for every alarm in the product, not just this one. Adding one is a change all of them share. |
| P2 | **No start-up bypass.** A normal pump start annunciates unless an on-delay is stated. Suppressing it properly needs a duration nobody has recorded. |
| P2 | **No latching.** The framework is unlatched by design and minimum flow inherits that; nothing was made sticky for the UI's convenience. |
| P2 | **The instantaneous state still crosses** at the exact boundary. The alarm can now be steadied from the record; K13's envelope and the diagnostics still follow the condition. |
| P2 | The policy is per machine, one limit and one direction. No maximum-flow alarm, no time-at-low-flow accumulation, no alarm on the protection STATE itself. |
| P2 | Carried: no recirculation, no trip, flow loops in m³/h only, one cascade topology (K17), PI not PID, no output rate limit, no manufacturer data, no scenario library (K9), pressure-only boundary dynamics (K10), mixing unsupported (K5). |

---

## 35. Step K21 — controller output rate limiting

A CONTROL-layer constraint, added beside the actuator dynamics K12 already had
rather than in place of them.

### The chain, made explicit

```text
algorithm ──► requested OP ──► RATE LIMIT ──► commanded OP
                 (t.OP)                          (t.OPC)
                                                    │
                                     SPD ──► physical ramp ──► shaft
```

`OP` is now what was ASKED FOR and `OPC` what was COMMANDED. `OPC` is written
only where a limit is configured, so a plant whose records state none is
byte-for-byte what K14–K20 shipped — no second tag signal, nothing new in
history, nothing published on the loop.

### The engineering source

Searched first. **Nothing in the model layer represented a controller output
rate.** The only rate-like values are `RAMP_S`, `COAST_S` and `STROKE_RATE` —
code constants for physical actuator dynamics, which §3 explicitly forbids
deriving from. So one field was added, on the INSTRUMENT record beside
`signal.cascadeTo`, which is where the other controller-behaviour field
already lives:

| Field | Unit | Absent means |
|---|---|---|
| `signal.outputRateLimit` | %/s | **no limit; the output moves as the algorithm asks** |

The unit is explicit and parsed, not guessed: `10 %/s`, `10 % / s`,
`600 %/min` and `36000 %/h` all resolve to 10. A bare `10` is %/s by declared
rule, because the output has exactly one unit. Zero, negative, and a rate of
something that is not the output (`2 m³/h/s`) are refused rather than
approximated — a zero rate limit is a trip, not a rate limit.

### The anti-windup was already there

§15 was the clause most likely to be a hard stop, and it is not one. The
existing conditional integration asks *"is the output against a stop the error
is pushing it further into?"*, and K18 had already established that the answer
to a new constraint is to change WHICH STOP rather than add a mechanism. K21
does that a third time: the stops become the rate window intersected with the
configured travel.

```text
reachHi = min(hi,   prevCmd + rate·dt)
reachLo = max(stop, prevCmd - rate·dt)
```

With no limit `rate·dt` is Infinity, `reachHi` IS `hi`, `reachLo` IS `stop`,
and the predicate is character-for-character K18's. **`kp`, `ti` and `ki` are
untouched.**

### MANUAL, decided from the architecture rather than from preference

The repository answered it. `lo` and `hi` — this controller's *other*
configured output constraints — have always clamped a hand command, so a
constraint on the OUTPUT PATH binds in MANUAL. The minimum-flow override does
not, because it acts on the SETPOINT and MANUAL does not use one. Two
different answers, each following from what the constraint acts upon. The
operator's entry survives in `OP`; the plate shows it against the value
actually being commanded.

### What the tests found

A speed loop does not start from zero: K15's calm start seeds `OP` and `I` at
the machine's rest speed (100 % for a VSD). Six of my own tests assumed a loop
ramping up from nothing and were wrong — the limiter correctly does nothing at
startup, which is exactly what §7 demands. Corrected to settle the loop first
and then step it.

Which lag you SEE depends on the numbers, and both always exist. K12's drive
covers full travel in `RAMP_S` = 2 s, so 50 points of speed per second. A limit
tighter than that and the control layer binds while the drive keeps up; looser
and the drive binds exactly as before K21. Measured both ways.

### State after K21

```text
3851 tests passing · 7 skipped · 0 failing  (+53)
tsc -b clean · production build clean
209 Playwright passing · 16 skipped · 0 failing
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | **No output rate limit on a valve loop is any different from one on a drive.** The field is per controller and in per cent of output; a valve's `STROKE_RATE` still applies underneath, and the two have not been reconciled into one story. |
| P2 | **No rate limit on the setpoint itself.** A master's limit constrains its output, which IS its slave's setpoint; a loop's own SP moves as fast as an operator types it. |
| P2 | **No separate up/down rates.** One symmetric limit, because one number is what a record states. |
| P2 | Rate limiting produces no diagnostic and no alarm, deliberately: a loop moving at its configured rate is the system working. It is a published loop state and a faceplate row. |
| P2 | Carried: no off-delay in the alarm framework, no start-up bypass, no latching (K20); no recirculation, no trip, flow loops in m³/h only (K18); one cascade topology (K17), PI not PID, no manufacturer data, no scenario library (K9), pressure-only boundary dynamics (K10), mixing unsupported (K5). |

---

## 36. Step K22 — constraint ownership and precedence

Not a feature phase. By K21 this runtime had eight independent things that can
stop a controller getting what it asked for, added one at a time since K12.
Each was correct alone; nobody had written down the ORDER, the OWNERSHIP, or
which of them the anti-windup can see.

### The inventory

`src/hmi/sim/constraints.ts` is the audit's result, and
`tests/hmi/constraints.test.ts` is what stops it being prose: every row's claim
is driven against a running plant, every engineering `source` is checked to
still exist in the field catalogue, and the precedence is walked by pushing one
loop into each limit in turn.

| # | Constraint | Layer | Source | Absent |
|---|---|---|---|---|
| 1 | min-flow override | setpoint | `duty.minFlow` | no protection |
| 2 | sp-domain | setpoint | **none** | there are no SP limits |
| 3 | op-travel | controller output | `duty.minSpeed` (floor) | floor 0 |
| 4 | output-rate | controller output | `signal.outputRateLimit` | unconstrained |
| 5 | vsd-turndown | actuator | `duty.minSpeed` | none imposed |
| 6 | vsd-ceiling | actuator | **none** — the curve's domain | n/a |
| 7 | valve-travel | actuator | **none** — what a position means | n/a |
| 8 | vsd-ramp | physical | **none** — modelling assumption | n/a |
| 9 | valve-stroke | physical | **none** — modelling assumption | n/a |

### The three findings

**There are NO engineering setpoint limits**, and K22 declined to invent any.
The audit found three things that are not them: the calibrated range bounds the
faceplate's *entry field*; the same range is what K17 *maps* a master's output
onto; and `signal.setpoint` is a configured *starting value*. The engine
enforces none of them — measured, `SP = 200` on a 0–60 loop is honoured, the
output runs to 100 % and reports `SAT +1`. That is the better behaviour: the
operator is told the setpoint is unreachable instead of having their entry
silently rewritten to a number that looks achievable.

**A valve's travel had no owner** on the direct-write path. `OP = 150` read
back a POSITION of 150 %, and `OP = -50` drove it negative. The hydraulics were
never wrong — `frac` clamps at the solver boundary — but the *published*
actuator state was physically impossible and reached the faceplate,
`LoopState.actual` and the DEV alarm's own comparison. `travelTarget` now owns
it, exactly as `speedTarget` has owned the drive's turndown since K12, and the
deviation is judged against the achievable command so a valve held at its stop
is FOLLOWING rather than faulted.

**Physical lag is not windup**, and this is the load-bearing conclusion. A
drive takes `RAMP_S` and a valve strokes at `STROKE_RATE`; neither is a stop
the controller's OUTPUT rests against — the command was accepted in full and
the hardware is on its way. That lag belongs to the process the loop is
controlling. Feeding it into the anti-windup would freeze the integrator during
every ordinary move and turn a tuned loop into a proportional-only one.

### The one deliberate double-enforcement

`duty.minSpeed` is enforced twice: by `speedTarget` at the actuator, so a
direct write to `SPD` is still refused, and as the controller's `op-travel`
floor, so the algorithm can SEE the stop it is winding against. K22 records
that as intentional rather than removing one of them. Everything else has
exactly one owner, and the tests prove a direct write cannot slip past it.

### State after K22

```text
3905 tests passing · 7 skipped · 0 failing  (+54)
tsc -b clean · production build clean
209 Playwright passing · 16 skipped · 0 failing
```

### Carried forward

| Priority | Item |
|---|---|
| P2 | **The setpoint bound is honoured on two paths and ignored on a third.** The faceplate clamps entry to the calibrated range and K17 maps onto it; the engine does not. Deliberate — there is no SP-limit field — but an operator and a scenario can reach different setpoints on the same loop. |
| P2 | **No engineering field for the physical rates.** `RAMP_S`, `COAST_S` and `STROKE_RATE` are code constants; no record carries a ramp, deceleration or stroke time. |
| P2 | **No `duty.maxSpeed`.** The 100 % ceiling is the pump curve's domain, not a declared maximum, and must never be reported as one. |
| P2 | Carried: no setpoint rate limiting (K21/§3 — a separate engineering function); no off-delay, start-up bypass or latching (K20); no recirculation or trip (K18); one cascade topology (K17), PI not PID, no manufacturer data, no scenario library (K9), pressure-only boundary dynamics (K10), mixing unsupported (K5). |
