# HMI / simulation audit — Phase 0

Written for: the IPD Studio maintainer, as the input to a multi-phase HMI rebuild.

Audited at `perf/canvas-rasterisation` (020593c), v0.20.0. Baseline test suite:
**2317 passing, 7 skipped, 0 failing** (`npx vitest run`). No code was changed.

---

## 1. Headline

The system is **much further along than a cosmetic restyle would suggest**. There is
a real flow-network solver, a PI controller with anti-windup and bumpless transfer,
an ISA-18.2 alarm lifecycle with shelving/OOS/suppressed-by-design, a real sampled
history behind the trends, an operator journal, and a registry-owned engineering
record that the simulator already prefers over widget properties. Roughly **two
thirds of the stated acceptance criteria are already met or nearly met.**

The failures are not "it looks unprofessional". They are four specific structural
defects:

1. **The widget render path never reads the engineering registry.** The simulation
   and the alarm engine use registry ranges/limits/units; every widget and the
   faceplate use `widget.props`. This is literally the "one value in the sim,
   another on the HMI" problem, and it is demonstrable today.
2. **Pressure and temperature have no process model.** `PT`/`TT` PVs are a seeded
   random walk. A `PIC`/`TIC` therefore drives a valve against a measurement that
   cannot respond — the loop is open and the controller rails.
3. **Engineering units are decorative.** Flow is dimensionless in the solver and
   labelled `m³/h` by the importer. Tank capacity defaults to *widget pixel area ÷ 40*.
4. **No data-quality concept exists.** A frozen (forced) transmitter renders
   identically to a live one.

Everything else is gap-filling on a sound foundation. **I do not recommend a rewrite.**

---

## 2. Current architecture

### 2.1 Three stores, cleanly separated

| Layer | Owner | Persisted | Undo |
|---|---|---|---|
| Document (P&ID + HMI screens + registry) | `store/store.ts` (zustand + zundo) | yes | yes |
| Runtime process state | `hmi/simStore.ts` (zustand, module-scoped `model`) | **no** | **no** |
| UI/editor state (selection, tool, view, faceplate) | React `useState` in `HmiWorkspace` | no | no |

This is correct and already satisfies Phase 24's "separate PROCESS / UI / EDITOR
state". `simStore` is imported **only** from `src/hmi/` — verified; the P&ID canvas
renders zero live values, so there is no P&ID-vs-HMI value divergence to fix.

### 2.2 Workspaces

`routes.ts` → `draw | data | checks | standards | hmi`. HMI Studio is already a
separate route and a lazy chunk. Phase 2's "separate engineering view from operator
view" is **structurally done**; what is missing is the operator-side *hierarchy*
inside it.

### 2.3 Canonical identity

`model/registry.ts` keys `EngineeringRecord` by **tag**, not node id, with a
documented rationale (redraw survival, multi-placement, join key for every
deliverable). `model/signalData.ts` reads range/units/limits/priority/setpoint out
of it. Renames propagate through `applyRename` to HMI widget tags, trend pens and
bound props (`store.ts:525-552`, `model/references.ts:112`). Deleted tags leave a
reported `orphaned-binding` finding, one per binding.

**Phase 1 is substantially already built.** The canonical model exists and is good.

---

## 3. Current simulation architecture

`hmi/sim/` — pure, DOM-free, deterministic (seeded LCG in `noise.ts`).

- **`tags.ts`** — compiles widgets → `TagDef[]`. Resolution order is explicit and
  correct: registry → legacy widget prop → sim default.
- **`network.ts`** — `buildNetwork` walks pipes into source→sink/tank `Branch`es with
  fan-out at inline devices; `solveFlows` computes conductance = ∏(valve fractions),
  splits a shared pump's rating across competing legs. Honest about being an
  approximation, not a pressure solve.
- **`engine.ts`** — `tick()` in four ordered stages: controllers → equipment dynamics
  (pump ramp, valve stroke, deviation timer) → flows → tank integration → displays.
- **`alarms.ts`** — `evalAlarms` (LL/L/H/HH with hysteresis + on-delay),
  `deviceAlarms` (valve DEV), `ackAlarms`, `alarmEvents` journal diffing,
  three-tier suppression (shelved / OOS / suppressed-by-design).
- **`simStore.ts`** — 5 Hz `setInterval`, `dt = 0.2 × speed`.

### Value traces (as requested)

**Level — closes correctly.**
```
tank TK PV  →  LT display (bindTank, +noise)  →  LIC.PV (family+loop pairing)
            →  PI + anti-windup  →  LIC.OP  →  LV.OP  →  stroke to LV.POS
            →  solveFlows conductance  →  branch flow  →  tank integration  →  TK PV
```
This is a genuinely closed loop with correct action sign (`controllerAction` makes a
drain valve direct-acting). ✔

**Flow — closes, but dimensionless.**
```
pump RUN → RAMP → driver = PUMP_RATED × ramp → × conductance → branch flow
         → FT display (bindPipe) → FIC.PV → FIC.OP → FV → conductance
```
Physically closed. But `PUMP_RATED = 10` (`engine.ts:23`) has no unit, tank capacity
has no unit, and the importer labels the result `m³/h` (`importFromPid.ts:73`). ✘ units

**Pressure / temperature — DOES NOT CLOSE.**
```
PT.PV = random walk around props.base   (engine.ts:215)
      → PIC.PV → PI → PIC.OP → PV/control valve → flow changes
      → …nothing feeds back to PT.PV
```
The controller sees an unchanging error, integrates to saturation, and parks the
valve at 0% or 100%. **This is the most serious simulation defect.** ✘

**Pump state.** `RUN`/`RAMP`/`FAULT` numbers on the tag. Trip logic
(`engine.ts`: `FAULT ≥ 0.5 && RUN ≥ 0.5 → RUN = 0`) is real. ✔ physics, ✘ state model
(see 5.5).

**Valve state.** `OP` (command) → `POS` (stroked at 25 %/s) → `DEVT` (deviation timer)
→ DEV alarm at 5 s. Genuinely good. ✔

---

## 4. Current HMI + instrumentation architecture

- **Rendering** — one `<svg>` (`HmiCanvas.tsx`), world 1600×1000, `viewBox` zoom/pan.
  Widgets render through a `memo`'d `WidgetG` with a hand-written comparator that
  shallow-compares the value bag. Only changed widgets re-render on a tick. ✔
- **Widgets** — 15 types in `hmi/widgets/`. Tank (4 silhouettes), pump, valve
  (on/off + throttling with actuator), display (+sparkline), gauge, bar, 4-pen trend
  with a real mm:ss axis and hover cursor, lamp/button/switch, nav, panel, label,
  and `symbol`/`equip` which reuse the full P&ID symbol catalog.
- **Faceplates** — `Faceplate.tsx`, draggable, dispatches on the signals the tag
  actually serves: motor / on-off / throttle / controller / measure.
- **Alarms UI** — `AlarmBanner.tsx`: strip + sortable summary table (time, priority,
  tag, level, **value at trip**, state) + filters + per-row Shelve/OOS/Ack +
  journal with Alarms/Commands filter and copy-out.
- **Navigation** — screen tabs, `nav` widgets, ★ home screen, per-screen worst-alarm
  priority dots (`navAlarms.ts`), alarm click-through that navigates *and* pulses
  the widget.
- **Instrumentation binding** — `tagIndex.ts` lists every bindable P&ID identity with
  its ISA meaning expanded; the import auto-binds `LT`→vessel and `FT`→process run by
  a ≤2-hop graph walk, and auto-tags untagged control-valve bodies into their loop by
  tracing signal lines (`wireLoopValves`).

This is already a credible operator layer. The visual language is the weakest part:
`theme.ts` carries only ~20 tokens, and **`Faceplate.tsx` ignores the theme entirely**
— 14 hardcoded hex literals, so the faceplate stays dark-SCADA even on an ISA-101
grey screen.

---

## 5. Findings

Ranked. Every one verified against the source.

### 5.1 ✘✘ Widgets and faceplates never read the registry — three copies of one value

`engineeringFor()` is called from `sim/tags.ts` (simulation), `HmiPropertyPanel.tsx`
(editor), `validate/rules/signal.ts` and `model/ioList.ts`. It is **never** called
from any file under `hmi/widgets/` or from `Faceplate.tsx`.

Consequence, for a tag whose record says `signal.range = "0-10 bar"`, `alarm.H = 8`:

| Consumer | Range used | H limit | Unit shown |
|---|---|---|---|
| Alarm engine (`sim/tags.ts:57`) | 0–10 ✔ | 8 ✔ | bar ✔ |
| `bar.tsx:15`, `gauge.tsx:12`, `trend.tsx:29` | **0–100** | **none** | props only |
| `Faceplate.tsx:125-131` | **0–100** | **none** | props only |
| `display.tsx` | n/a | n/a | `props.unit` only |

A PV of 8 bar renders at 8 % of the bar scale instead of 80 %, with no limit ticks,
while the alarm banner correctly shouts HIGH. This is exactly the defect Phase 0
item 4 asks for.

Worse, the defaults are **duplicated a third time in UI code**:
`Faceplate.tsx:128` hardcodes `{LL:5, L:10, H:90, HH:95}` and `tank.tsx:62` hardcodes
the same four numbers as drawing fallbacks — the same physics placeholders
`sim/tags.ts` uses, copy-pasted into two renderers.

**Fix:** one resolver (`resolveTagEngineering(registry, widget) → {min,max,unit,limits,priority}`),
called once per widget per frame in `HmiCanvas`, passed down through `WidgetView`.
Delete both hardcoded limit tables.

### 5.2 ✘✘ No process model for pressure or temperature

`engine.ts:210-217`. Unbound displays random-walk around `props.base`. The importer
(`importFromPid.ts`) only binds `L`-family to a tank and `F`-family to a pipe;
`T` and `P` families get "plausible demo values with sensible units" by design.

So a `PIC`/`TIC` imported from a real P&ID wires up (`wireControllers` pairs on
family+loop) and drives a valve, but its PV is noise. The anti-windup freezes `I` at
saturation, so the valve parks fully open or fully closed. **A pressure loop in this
product does not work, and looks like it does.**

**Fix:** give the network a minimal pressure model — branch ΔP from pump curve and
conductance, tank head from level, and a `bindNode`/`bindBranch` binding for `PT`.
Temperature needs a first-order energy balance on tanks (inflow enthalpy mixing +
heater duty). Both are bounded additions to `solveFlows`/`tick`, not a rewrite.

### 5.3 ✘✘ Engineering units are not modelled

- `PUMP_RATED = 10`, `GRAVITY = 4` (`engine.ts:23,25`) — unitless.
- Tank capacity defaults to `(w.w * w.h) / 40` (`tags.ts:65`) — **resizing a tank
  widget on screen changes the process model.**
- Level integration `PV += (net / capacity) × 100 × dt` — so flow is implicitly
  "capacity-units per second", then displayed labelled `m³/h`.
- `Faceplate.tsx` prints `Flow through: 45.0` with no unit at all.

**Fix:** declare the sim's internal units (m³/h for flow, m³ for capacity, bar, °C,
% for level/position), take capacity from the registry with an explicit default and a
QA finding when absent, and never derive a process quantity from widget geometry.

### 5.4 ✘ No data quality / no forced-value indication

`Tags = Record<string, Record<string, number>>`. `FROZEN` exists as a scenario flag
that stops a display updating (`engine.ts:207`), but nothing renders it. An operator
cannot distinguish a live simulated value from a forced one from a stale one.
Phase 22 is entirely unimplemented.

**Fix:** widen the per-tag value to carry `{v, q, t}` (quality + last-update), or run
a parallel `quality: Record<string, Quality>` slab. Render as a small badge on every
value-bearing widget and in the faceplate header. `FROZEN` → `FORCED`;
OOS → `OUT OF SERVICE`; a def with no producer → `BAD`.

### 5.5 ✘ Equipment state derived from scattered booleans in three places

The motor state expression
`FAULT ? FAULT : RUN ? (RAMP<1 ? STARTING : RUNNING) : STOPPED` is written
independently in `Faceplate.tsx`, `widgets/pump.tsx` and `widgets/equip.tsx`. There is
no `STOPPING`, no distinction between `FAULT` and `TRIPPED`, and no
`MAINTENANCE/DISABLED` (OOS suppresses alarms but is not an equipment state).
This is precisely what Phase 19 forbids.

**Fix:** one `equipmentState(tag, tags): EquipState` in `sim/`, one place, consumed by
every renderer and the faceplate.

### 5.6 ✘ A tripped pump raises no alarm

`evalAlarms` only iterates defs that have `limits`; motor defs have none.
`deviceAlarms` only handles `kind === 'valve'`. So tripping a pump writes a `CMD`
journal line and stops the pump — but **no `AlarmRecord` is created**, nothing
annunciates, nothing appears in the banner. Phase 11 explicitly names `P-101 TRIP`.

**Fix:** extend `deviceAlarms` to emit `TRIP` for motors and (once 5.4 lands) `BAD`
for quality failures.

### 5.7 ✘ Alarm records are missing fields Phase 11 requires

`AlarmRecord` has id/tag/level/phase/since/priority/value/sup. Missing: **`limit`**
(the threshold crossed — the banner cannot print "52.4 bar > 50.0 bar") and
**`message`**. Also there is no `unit`, so the summary table's *Value* column is
bare numbers.

### 5.8 ✘ Trends cannot reach the required spans

`HISTORY_CAP = 1200` samples at 5 Hz = **240 s at 1×**. The trend widget offers
1/2/4 min spans only (`HmiPropertyPanel.tsx:383`). Phase 13 asks for 1/5/15/60 min.

**Fix:** decimating ring buffer — keep 1 Hz for the last 5 min, 1/10 Hz beyond, cap by
time not sample count.

### 5.9 ✘ History recording is O(tags × cap) copies per tick

`simStore.ts:115-127` spreads the whole history map and then rebuilds each series
array (`[...old, v].slice(-1200)`) **every tick, for every recorded signal**. At 500
tags that is ~600 000 element copies per second. Fine for the demo, will not hold at
Phase 24's "larger than the current demo".

**Fix:** mutable typed-array ring buffers behind a stable object identity, with a
version counter for memo invalidation.

### 5.10 ✘ Faceplate ignores the theme

14 hardcoded hex literals in `Faceplate.tsx`. On an ISA-101 grey screen the faceplate
is still dark-blue SCADA. Phase 3/23.

### 5.11 ✘ HMI screens are a one-way snapshot of the P&ID

`importSheet` is a generator; Re-import destroys hand edits. Renames propagate,
deletes are *reported* (`orphaned-binding`) but not reconciled, and **added** P&ID
equipment never appears. Phase 21 asks for detection of MISSING TAG / BROKEN
CONNECTION / MISSING INSTRUMENT / INVALID RANGE / INVALID UNIT / MISSING SIMULATION
MODEL / UNBOUND HMI OBJECT — of which only the first is implemented.

**Decision needed** (see §8): stay snapshot + add a reconcile/diff view, or make the
operator view derived-by-default with per-widget overrides.

### 5.12 Minor

- `reset()` does not rebuild `model`, so a mid-run doc change is silently ignored.
- `wireControllers` regex `/^([A-Z])[A-Z]*-?(\w+)$/` matches on the *first* letter
  only, so `LIC-101` would also pair with `LY-101`-ish tags in odd cases.
- Overview screens are generated as static widgets — they do not adapt when screens
  are added, and carry no KPI row (alarm counts, equipment running/faulted).
- No dedicated ALARMS / TRENDS / DIAGNOSTICS pages; no breadcrumbs.
- The `io` tab in DataWorkspace is the engineering I/O list (static), not a live
  instrument diagnostics view (Phase 17).

---

## 6. Acceptance-criteria scorecard

| # | Criterion | Status |
|---|---|---|
| 1 | Professional industrial look/behaviour | **partial** — ISA-101 theme exists, faceplate off-theme, token set thin |
| 2 | P&ID stays an engineering view | **met** — separate route, no live values on the P&ID |
| 3 | Equipment has real simulation states | **partial** — physics real, state model scattered (5.5) |
| 4 | Instruments have real tags + bindings | **met** — registry-keyed, rename-safe |
| 5 | Transmitters provide real PVs | **partial** — L and F real; P and T are noise (5.2) |
| 6 | Controllers get real PVs, affect outputs | **partial** — true for L/F, open loop for P/T |
| 7 | Control valves affect the process | **met** |
| 8 | Pumps affect the process | **met** |
| 9 | Tanks have material balance | **met** (but capacity from pixels — 5.3) |
| 10 | Consistent engineering units | **not met** (5.3) |
| 11 | Alarms real and stateful | **mostly met** — missing TRIP + limit/message fields (5.6, 5.7) |
| 12 | Trends use real history | **met** — spans too short (5.8) |
| 13 | AUTO/MANUAL works | **met** — including bumpless transfer |
| 14 | Faults propagate | **partial** — trip/stuck/plug/freeze all real; no alarm on trip |
| 15 | RESET resets | **met** (caveat 5.12) |
| 16 | HMI and P&ID share canonical state | **not met** — render path bypasses the registry (5.1) |
| 17 | Broken bindings detected | **partial** — 1 of 7 diagnostics (5.11) |
| 18 | No fake hardcoded demo values | **not met** — 5.1, 5.2, 5.3 |
| 19 | RUN stable and responsive | **met** at demo scale; 5.9 at scale |
| 20 | Automated tests cover process behaviour | **met** — 43 HMI test files, 3096 lines; needs extending to new work |
| 21 | Coherent design system | **partial** (5.10) |
| 22 | Usable when larger than the demo | **partial** (5.9) |

---

## 7. Recommended target architecture

Keep everything in §2–§4. Add one layer and one rule.

**The rule:** *nothing renders a process value it resolved itself.* All
engineering metadata (range, unit, limits, priority, capacity, quality) is resolved
once per tick in one place and handed to renderers.

```
ProjectDoc.registry ─┐
                     ├─► resolveTagEngineering()  ──► TagDef[]  ──► sim/engine tick()
HmiWidget.props ─────┘        (one resolver)            │              │
     (legacy fallback only)                             │              ▼
                                                        │        Tags + Quality
                                                        ▼              │
                                            ┌───────────────────────────┐
                                            │  ProcessView (per frame)  │  ← NEW
                                            │  tag → {v,q,unit,min,max, │
                                            │        limits,state,alarm}│
                                            └───────────────────────────┘
                                                 │           │        │
                                            widgets     faceplates  diagnostics
```

New modules (all under `src/hmi/`, all pure and testable):

- `sim/engineering.ts` — the single resolver; replaces the three copies in 5.1.
- `sim/quality.ts` — `Quality = GOOD|BAD|UNCERTAIN|STALE|SIMULATED|FORCED`.
- `sim/state.ts` — `equipmentState()`; the one authoritative state machine.
- `sim/units.ts` — declared internal units + explicit conversion at the boundary.
- `sim/pressure.ts` / extend `network.ts` — head + ΔP so `PT` binds to real state.
- `sim/history.ts` — decimating ring buffer replacing the per-tick array copies.
- `view/processView.ts` — the per-frame projection above.
- `diagnostics.ts` — the seven Phase-21 binding checks, surfaced in Checks *and* a
  live I/O page.

---

## 8. Open decisions — I need your call on these

1. **P&ID → HMI linkage.** Keep the snapshot model and add a *reconcile* view
   ("3 instruments added, 1 deleted — apply?"), or move to derived-by-default with
   per-widget overrides? The first is far less disruptive and preserves hand-laid
   screens; the second is what Phase 21 literally asks for.
2. **Pressure/temperature scope.** Full first-principles (pump curves, resistance
   network, energy balance) or a declared, documented simplification (linear head
   vs flow, well-mixed tank, no phase change)? The latter is honest and ships; the
   former is weeks.
3. **Sequencing.** Each step shippable and test-covered:

   | Step | Work | Fixes | State |
   |---|---|---|---|
   | A | single resolver: every renderer draws on the compiled `TagDef` | 5.1 | **done** |
   | C | quality slab + forced / stale / uncertain badges | 5.4 | **done** |
   | D | `equipmentState()` + TRIP/BAD alarms + alarm `limit`/message | 5.5, 5.6, 5.7 | **done** |
   | B+E | one physics pass: real units, pressure and temperature, PI retune | 5.2, 5.3 | **done** |
   | F | ring-buffer history + 1/5/15/60 min spans | 5.8, 5.9 | **done** |
   | G | operator navigation: Overview KPIs, Alarms, Trends, Diagnostics pages | Ph. 14-17 | **done** |
   | H | design tokens + faceplate on-theme + restrained default palette | 5.10, Ph. 23 | **done** |
   | I | the seven Phase-21 diagnostics + reconcile view | 5.11 | **done** |

**Why B moved.** Units are not a labelling job. The tank integration is
`dLevel% = (flow / capacity) × 100 × dt` with `dt` in real seconds and both flow and
capacity dimensionless. Declaring flow as m³/h and capacity as m³ needs a `/3600`
conversion, which slows every vessel by 3600× — a 100 m³ tank on a 50 m³/h pump takes
two process-hours to fill where the demo currently takes thirty seconds. That forces
rescaled defaults, retuned PI gains and rebalanced time constants across ~10 sim test
files. Step E rewrites the same equations and needs the same retune, so the two are one
pass, not two.

**Decided:** process time stays honest (seconds); defaults are realistic plant
equipment (~100 m³ vessels, ~50 m³/h pumps) read from `construction.volume` and
`duty.capacity` in the registry; the speed control extends to 1×/10×/60×/300× with an
h:mm:ss clock, which is how a DCS training simulator handles it. Nothing about the
physics is fudged to keep the demo brisk.

**Decided:** the P&ID stays the source and the HMI stays a snapshot, with a reconcile
view and the seven diagnostics (step I) rather than derived-by-default screens.

---

## Step I as built — engineering diagnostics and reconciliation

Finding 5.11 said the P&ID and the HMI could drift with nothing to say so.
This closes it without turning the HMI into a derived view. Full description
in `docs/HMI.md` (*Engineering diagnostics*, *Reconciliation*); what follows is
what was decided and what the decisions cost.

**One diagnostic model, three consumers.** `model/diagnostics.ts` computes all
seven categories. `validate/rules/diagnostics.ts` is nine thin adapters that
carry them into the existing Checks engine — no parallel validation engine, no
second severity model, no second set of acceptance keys. The HMI Diagnostics
page and the reconciliation view read the same function. A test asserts the
Checks report and the Diagnostics page contain exactly the same finding ids.

**`orphaned-binding` was not replaced.** Its detection moved into the
`missing-tag` category; the rule kept its id, its per-binding keys, its
message, its offered fix and its `warning` severity. That is what lets an
acceptance recorded before Step I keep matching, and it is why the HMI cannot
block a drawing being issued.

**The two-severity split is deliberate.** `Rule.severity` in this codebase
gates document issue (`model/conformance.ts` `issueBlockers`), so it answers
"can the drawing go out". A diagnostic's severity answers "can the plant run".
Collapsing them would have meant either a dead HMI binding blocking a P&ID
issue, or the Diagnostics page under-reporting something that stops the
operator layer working.

**A false positive the sample baseline caught.** The first cut of the unit
check reported *"LT-101 measures level but is scaled in %"* on the bundled HMI
demo. It was wrong: `UNITS.level` is `%`, the simulation produces per cent
full, and an ISA level transmitter is conventionally ranged 0-100 %. Per cent
is now accepted for level and reported only on a dimensioned quantity, which is
the case the brief actually names. No bundled sample gained a finding: the
recorded QA profile in `tests/validate/sampleBaseline.test.ts` is unchanged.

**A real finding on a bundled sample.** Importing `sample-plant` produces five
`orphaned-binding` findings — `TK-101 Feed Tank`, `P-101`, `C-101`, `E-101` and
an `LT-103` bound to `C-101`. These are not false positives. That sample's
equipment carries *labels* rather than tags (already reported by
`equipment-no-record`), the importer names a widget from the label when there
is no tag, and a label is not a registry key. Tagging the equipment resolves
both findings. This is pre-existing behaviour Step I made visible, not
behaviour it introduced.

**The baseline is a new document field.** `HmiScreen.baseline` — tag → a
deterministic fingerprint of the engineering facts, recorded at import and at
each apply. Optional, so every existing document loads unchanged and reports
`baselineMissing` rather than a wall of invented changes. It excludes every
runtime and visual value by construction; a test runs the plant and asserts the
findings are identical.

**Re-import was not removed, it was demoted.** It still rebuilds a screen from
its sheet, and now says plainly that it discards the layout and points at
Reconcile… instead.

### What Step I deliberately did not do

- **No second rename mechanism.** `model/references.ts` still carries a record
  and every machine-written reference across a rename. Reconciliation's
  `remap` moves a widget's tag only, from a bounded list the engineer picks
  from, and is explicitly not a rename.
- **No diagnostic alarms.** A validation finding is not a process condition and
  does not enter the alarm system.
- **No physics, history, quality, equipment-state or alarm-lifecycle change.**
  Nothing in `sim/` changed except a metadata comment; the physics tests are
  untouched.
- **No visual redesign.** Step H's system stands. The new surfaces add a
  severity word, a secondary line, a select control and the reconciliation
  rows, all from existing tokens. Two scales Step H defined but never emitted
  (`SCALE.line`, `SCALE.border`) are now emitted as CSS custom properties —
  found by the design-system test, which rejects a stylesheet referencing a
  variable that does not exist.

---

## Step J — production-readiness audit

An audit, not a phase: the whole system re-verified against the Phase 0
criteria, from the code and from measurement rather than from the previous
reports. One P0 was found and fixed; nothing else was changed.

### The P0: a NaN that silenced the alarm system

`sim/engine.ts` `measurementOf` summed branch flows with a non-null assertion:

```ts
for (const br of model.net.branches) if (br.pipeIds.includes(d.bindPipe)) f += branchFlows[br.id]!
```

`initTags` calls it with an **empty** `branchFlows` to seed bound transmitters
from the calm-start state, so `0 + undefined` produced `NaN`. Every flow
transmitter bound to a line came up NaN at RUN start and at RESET.

It did not stay in one tag. A controller starts in AUTO, copied the NaN into
its PV on the first tick, `clamp()` carried it into the integrator, and from
there it reached the valve command, the valve position, the vessel inventory,
and that vessel's level, pressure and temperature. **Two of the three bundled
samples did this on every run**: `sample-plant` had 13 non-finite signals
within 60 s.

The consequence that made it a blocker is not the blank number. Every
comparison against NaN is false, so `evalAlarms` stopped annunciating on the
affected tags entirely — a vessel could sit at any level and raise nothing —
while `sim/quality.ts` still reported **GOOD**, because NaN is not one of the
conditions it tests. Measured on `sample-plant` before the fix: vessel `C-101`
level `NaN`, alarms on it `0`, plant-wide alarms `0`, quality `good`.

Fixed at the source (`?? 0` at the three places that read a branch flow by
key), which makes the code do what `initTags`'s own comment already claimed:
"the calm-start plant is stationary… no flow anywhere". `tests/hmi/finiteness.test.ts`
pins the invariant — the seed, 120 s of steady state, every bundled sample, and
every map the runtime store publishes. Reverting the fix fails 5 of its 6 tests.

No NaN guard was added to the controller. The invariant is restored at the
source, and a swallow in the PI would hide the next such bug instead of
surfacing it.

### Verified by measurement, not by report

| Property | Evidence |
|---|---|
| Determinism | Two runs from identical conditions, and a RESET, give byte-identical tag state |
| Flow ← valve | 100 % → 20 % opening moves flow 50.00 → 10.00 m³/h |
| Flow ← pump duty | A 120 m³/h rated pump delivers 120.00 m³/h |
| `dt` conversion | 20 m³ vessel at 50 m³/h for 600 s: predicted +41.67 %, measured +41.66 % |
| Level loop | Closes on setpoint; output saturates at 0/100 without windup |
| Pressure ← valve | Discharge 1.020 bar open → 5.007 bar shut = supply 1 + shutoff head 4 |
| Temperature | Heater raises it, cold inflow mixes it down, heat loss returns it to ambient, TIC holds SP 45 at PV 45.83 |
| Quality | good / forced / stale / bad / uncertain all distinct and reachable |
| Frozen | Holds its exact last value while the process moves on |
| History | Fresh buffer on RESET; 360 samples per signal after 11 process-hours; newest sample always in the window |
| Round trip | Screens, bindings, compiled `TagDef`s, calm-start seed, baseline and diagnostics all identical after save/load on all three samples |
| Runtime isolation | No simulation vocabulary appears in a serialised project |

### Cost, measured

`simStore.tickOnce` 0.073 ms per 5 Hz frame (0.04 % of the 200 ms budget).
`diagnose` 1.17 ms per document change, **linear** in tag count (≈20 µs/tag;
800/400 ratio 1.82) and cached per project index, so the 5 Hz render path is a
cache hit. `history.getSeries` 0.011–0.013 ms. `qaFor` including the nine new
diagnostic rules is 0.337 ms at 500 objects and 1.730 ms at 2 000 — against the
Phase 0 figures of 0.9 ms and 5.7 ms for the old synchronous path.

### Known, not fixed

- **P1 — assumed pump and heater duties are not disclosed.** `DEFAULTS.pumpFlowM3h`
  (50 m³/h), `pumpHeadBar` (4 bar) and `heaterKw` (500 kW) apply when nobody has
  stated `duty.capacity`, `duty.head` or `duty.power`, and unlike
  `tank-capacity-defaulted` nothing tells the user. Every flow on the screen is
  then the software's assumption wearing engineering units. The remedy is the
  pattern that already exists: a `capacityDefaulted`-style flag on the driven
  `TagDef` and one INFO rule beside `tank-capacity-defaulted`. Deliberately not
  done in an audit phase — it would add findings to the bundled samples, and
  `tests/validate/sampleBaseline.test.ts` records those numbers as a contract.
- **P2 — faceplate header repeats the tag** when the P&ID label equals the tag
  (`Faceplate.tsx`, `widget.label ?? …`): the sample's `P-101` reads "P-101 P-101".
- **P2 — the palette previews hardcode the classic theme** (`HmiPalette.tsx`
  uses `THEMES.classic`), so the chips are dark on the ISA-101 light ground.
  Editor chrome only; hidden in RUN.
- **P2 — `sample-plant` label-vs-tag findings stand, exactly as documented.**
  `TK-101 Feed Tank`, `P-101`, `C-101`, `E-101` and `LT-103`'s `bindTank`
  produce five `orphaned-binding` errors on import. The equipment carries
  labels rather than tags (already `equipment-no-record`), the importer names a
  widget from the label, and a label is not a registry key. Tagging the
  equipment clears both. The diagnostic was not softened to make the sample
  pass.
- **P2 — the unbound-display idle wander** remains the one value-producing
  fallback: a `display` with no `bindTank`/`bindPipe` drifts around
  `base ?? (min+max)/2`. It is disclosed four ways — UNCERTAIN quality with a
  reason, `NO MODEL` in the diagnostics source column, a
  `missing-simulation-model` finding, and a dashed trend.
- **P3 — the trend time axis** prints `00:00` twice while the run is shorter
  than the selected span.


---

## K3.1 — why the four loops were off setpoint

The K3 integration was reverted with a pressure loop 0.5 bar off and a level
loop 4.8 % off. The obvious reading was "retune the controllers". It was wrong,
and no gain was changed.

### The pressure loops — the setpoint is not reachable

Sweeping PV-101 end to end and reading PT-101 at each point gives the
achievable range of the controlled variable:

| valve | Q (m³/h) | PT-101 (bar) |
| --- | --- | --- |
| 100 % | 50.00 | **3.500** |
| 60 % | 35.96 | 5.768 |
| 20 % | 5.34 | 8.146 |
| 0 % | 0.00 | **8.200** |

**Achievable range 3.50–8.20 bar. The tests ask for SP = 3.** It is below the
minimum, and the 0.5 bar "offset" is exactly `3.50 − 3.00`.

The controller is behaving correctly and provably so: it drives the valve to
100 %, the conditional integration freezes the integrator at 95.07 instead of
winding up, and the PV sits at the lowest pressure the process can deliver.
Transient: 8.18 → 4.41 → 3.66 → 3.50, monotone, valve 15 → 78 → 94 → 100.

The range moved because K3 corrected the pump semantics — `duty.head` is the
head AT the rated flow, as a datasheet states it, so shutoff is 7.2 bar rather
than 4. The old SP was chosen against the old, lower band.

**Classification B: setpoint physically unreachable.** The fix is the test's
setpoint, not the controller — and that change must land WITH the integration,
because on the current runtime SP 3 is still correct.

### The outlet-valve level loop — the edge of authority

This loop drains by gravity, so its authority is the static head of the vessel
it is emptying, which is the thing it controls. At the setpoint:

```text
inflow (FV-201 at 30 %)   11.78 m³/h
drain at FULL travel      11.18 m³/h     ← short by 5 %
drain at 60 % level       12.25 m³/h
```

The actuator is marginally short at setpoint, so the equilibrium sits a few per
cent above it, where the extra head makes up the difference. The loop is stable
and closes; it simply has almost no margin, which is why a change in the drain
characteristic moves its steady state by several per cent rather than a
fraction of one.

**A gain sweep settles it.** Closing the loop through the real solver at
kp = 6, 4, 3, 2, 1.5, 1, 0.75 and 0.5 (ti = 600) gives a final level within
0.005 % of setpoint at every gain, with valve travel spreads of 0.00–0.06 %.
**Tuning is not the cause and cannot be the cure.**

### What changed

Nothing in the controllers, nothing in the hydraulics. One new test file,
`tests/hmi/loopReachability.test.ts`, closes both loops through the real solver
and the real gains and pins what they can physically reach — including that an
unreachable setpoint saturates at the limit rather than wandering.

### What remains

The level loop's 4.8 % in the integration is consistent with the edge-of-
authority finding but is **not yet proven** to be it: reproducing that exact
number needs the integration present, and it is still gated. The remaining work
is a fixture-sizing decision (give the drain more authority, or accept an
equilibrium above setpoint), not a tuning one.

## K3.2 — landing the runtime hydraulic integration

K3 wrote the integration and reverted it. K3.1 proved the loops were not
mistuned. This step lands it: `sim/engine.ts` now solves the pressure field
every sub-step and takes every flow, pressure and inventory from the result.
**The conductance model is removed, not retained** — there is no second flow
calculation in the product.

### What the runtime now does

```text
valve position → resistance → pressure field → flow → inventory
```

`solveFlows` and `solvePressures` are gone from the tick. `simStore` publishes
`pipeFlows` **signed**, straight from `SolveResult.pipeFlow`, and a new
`hydraulic` status object carrying `converged`, `residual`, `iterations`,
`cavitating` and `undetermined`.

A vessel's **inventory in m³ is the state** and its level is derived from it,
integrated from the SIGNED flow across its own nozzle edges. `writeTag` carries
a level write into that inventory, because otherwise a forced level sprang back
on the next tick — a regression this step found and fixed.

### Quality now carries the solver's limits

| Solver flag | Quality | Shown as |
| --- | --- | --- |
| `converged: false` | **BAD** (number hidden) | *No hydraulic solution — mass is not balanced* |
| node in `cavitating` | **UNCERTAIN** | *Suction below absolute zero — the model cannot represent this* |
| node in `undetermined` | **UNCERTAIN** | *No path to a pressure boundary — pressure level is undetermined* |

`FORCED` and `FROZEN` still outrank these: the number on the screen came from
an operator's hand or a held input, so the state of the plant behind it does
not describe it either way.

### Every test expectation that changed, and why

Eleven assertions across six files. Each was judged against the new model
individually; none was mass-updated, and no tolerance was widened to hide a
disagreement.

| # | Test | Old expectation | New expectation | Physical reason |
|---|---|---|---|---|
| 1 | `pressure` › holds setpoint | SP = 3 bar | SP = **6** bar | Sweeping PV-101 end to end gives **3.50–8.20 bar** on this plant. 3 is below the floor. 6 is mid-range and where the process gain is steepest (0.09 bar/% against 0.03 near either end), so the valve has real authority. |
| 2 | `pressure` › settles still | SP = 3 bar | SP = **6** bar | Same range. At SP 3 the loop was saturated, so "no limit cycle" was vacuously true of a valve that could not move. |
| 3 | `pressure` › recovers from a disturbance | SP = 3 bar | SP = **6** bar | Same range. |
| 4 | `pressure` › rejects a setpoint change | SP 2 → 4 | SP **4.5 → 7** | 2 bar is below the 3.50 floor, so the low case was the valve pinned wide open and "a higher setpoint needs a tighter valve" held for the wrong reason. Both new setpoints are controlled states off the stops. |
| 5 | `physicsIntegration` › the whole scenario | SP = 3 bar | SP = **6** bar | A *different* plant (P-101 is 60 m³/h at 45 m, with a heater in the line) and so a different range: **4.76–8.92 bar**, measured. 3 is below its floor too. |
| 6 | `controllers` › outlet-valve level loop | FV-201 at 30 %, 4 h | FV-201 at **22 %**, 6 h | **§11, Option A — widen the drain's authority.** At 30 % the inlet puts 11.78 m³/h in against a gravity drain that passes 11.18 m³/h *wide open*: the loop correctly saturated and parked above SP. That is real behaviour and it is already covered as saturation in `loopReachability`; it is not what a test of *modulation* should assert. 22 % puts 6.45 m³/h in, held at about 61 % travel with 11.18 available — authority in both directions. A new assertion pins the valve off both stops, which the over-fed fixture could not make. |
| 7 | `units` › level never leaves 0–100 | level > 99, flows **exactly 0** | level **= 100.000000**, flows **< `SHUT_LEAK_MAX`** | The old model shut a branch at 99.5 % of capacity, so the level asymptoted short of the top while the pump went on delivering 50 m³/h into a clamp that deleted it. The vessel gate stops inflow at the nozzle instead: the tank fills to exactly 100 % and the flow collapses with it. Not exact zero, because a blocked element is a steep FINITE conductance — a hard zero has a zero derivative and traps Newton. What is left is 1.34e-4 m³/h, a seventh of a millilitre an hour. |
| 8 | `engine` › unvalved stub | the stub never drains the tank | the stub **does** drain it | The old solver special-cased this shape (`uncontrollableStub`) to keep a demo screen calm. It is an open line from a vessel's bottom nozzle to a boundary, and a vessel with head above an open line drains. `dangling-end` already reports the drawing defect, which is the right place to object. |
| 9 | `engine` › supply header | opening HV-2 fills TK-2 | **nothing moves either way**, and the two node pressures are asserted equal | Pipe `b` lands in the upper part of TK-2's shell, so it attaches to the vessel's TOP nozzle — vapour space, at boundary pressure. The header is at boundary pressure too. See *one boundary pressure* below. The test now pins the mechanism, so it fails loudly the day the boundary is split. |
| 10 | `engine`, `equip` › calm start | flows `=== 0` | flows `< SHUT_LEAK_MAX` | Same finite-conductance reason as #7. `SHUT_LEAK_MAX` is exported by the solver so a caller can say "nothing is moving" precisely — 0.4 mL/h at the highest pressure the model allows, against real flows of tens of m³/h. |
| 11 | `runtimeHydraulic` › warm vs cold | — (new) | agree to within **`MASS_TOL`** | Newton stops when the worst junction residual is under `MASS_TOL`, so two converged solves of the same network are the same answer *to that precision*. Demanding bit-identity would demand something the solver never claimed. Measured difference: 5.9e-5 m³/h. |

### The old model is deleted, not parked

`solveFlows` and `pipeFlowMap` are removed from `sim/network.ts`, and the
pressure profile — `solvePressures`, `pumpHeadBar`, `LOSS_K`, `BranchPressure`,
`HydraulicCtx` — from `sim/process.ts`. Nothing in `src/` called them after the
integration landed, and leaving a tested-but-dead flow calculation in the tree
is exactly the second source of truth this step exists to remove: it reads as
coverage and it is a wiring mistake away from being live.

What stays in those files is what is still load-bearing: `buildNetwork` and its
branch projection (the thermal model, the Overview flowsheet and controller
action all read routes from it), `tankPressureBar`, and the vessel energy
balance.

Their tests moved with them rather than being deleted:

- `network2.test.ts` — the manifold suite. It asserted a conductance RATIO;
  it now asserts **mass balance at the junction** on the same fixture, which
  is a stronger claim, plus the orderings the physics requires. Seven tests
  became six.
- `pressure.test.ts` › *the pump curve* — it checked `pumpHeadBar` with
  `duty.head` read as the SHUTOFF head, so a 4 bar / 50 m³/h machine made 4 bar
  at no flow and **nothing at its own duty point**. Rewritten against
  `pumpHead`/`shutoffFromDuty` with the datasheet semantics. This is the
  superseded assumption that moved every setpoint in that file.
- `pressure.test.ts` › *suction pressure follows the source vessel's level* —
  the claim is live; it now closes through a real screen and a real solve.

### New coverage

`tests/hmi/runtimeHydraulic.test.ts` — 26 tests on a branched representative
plant (one pump, a tee, two vessels, a pressure loop and a level loop) driven
through `simStore`, plus the three bundled samples for preservation:

- compilation preserves every pipe and every device (1–2, and 24–26 on the samples)
- causality: both legs develop flow, the tee balances to `MASS_TOL`, flow is not linear in valve position, closing the valve raises the discharge (3–7)
- inventory: level rises by exactly the volume delivered, a written level sticks, a full vessel stops taking and an empty one stops giving (8–11)
- a leg **reverses** and `pipeFlows` carries the sign (12)
- both loops close through the solve (13–14)
- the status is published; an undetermined node and a cavitating suction each degrade quality, and a healthy instrument is still GOOD (15–18)
- the store's published flows are **bit-identical** to the solver's (19)
- warm start moves the iteration count, not the answer (20)
- finite and in range over an 8-hour shift; RESET restores exactly (21–22)

### Findings this step produced

1. **A pump can be specified past what its suction line can supply.** The
   representative fixture at 50 m³/h drove `P-101`'s suction below absolute
   zero and the solve reported it. Specified at 40 m³/h / 35 m it is clean.
   This is the model working, not failing — but it means a drawing can carry a
   duty the drawn suction cannot support, with no diagnostic saying so.
   Candidate for a future NPSH check.
2. **`declaredRole` does not know `bottom` or `top`.** A pipe carrying
   `bPort: 'bottom'` onto a vessel is honoured as an *attachment* but its ROLE
   still falls through to geometry, so a stated bottom nozzle can resolve to
   the top. `DECLARED_ROLE` in `sim/hydraulic/ports.ts` has entries for the
   pump and inline roles only. Not fixed here — it changes port resolution,
   which is topology work, not integration.
3. **The calm start opens `LV-101` for one second.** `initTags` seeds a
   controller-driven valve at the controller's default output (40 %), so a
   level valve strokes shut over the first second of a run and moves 5e-5 % of
   a 200 m³ vessel on the way. Pre-existing; measured and documented in the
   test rather than tolerated blindly.

### One boundary pressure — the limitation this step did not remove

`DEFAULTS.supplyPressureBar` is one number doing two jobs: the pressure at a
battery-limit header *and* the atmosphere a vent or drain discharges to.
Consequence: **a boundary cannot fill a vented vessel.** Raising it to 3 bar
was tried and reverted — it fixes the header and puts 3 bar of backpressure on
every gravity drain in the model. The remedy is a second boundary pressure,
which is a topology change and not part of landing the integration.

### Gate

```text
3120 tests passing · 7 skipped · 0 failing
  (3095 before, +26 runtime-integration tests, −1 as the manifold suite
   was rewritten from seven conductance tests onto six on the solve)
tsc -b clean · production build clean
189 Playwright specs passing · 2 failing, BOTH PRE-EXISTING
```

The two Playwright failures (`equip.spec.ts` compressor faceplate,
`screenshot.spec.ts` faceplate v2) were verified to fail identically on the
parent commit `a5b9793`. They are not caused by this step and are not fixed by
it.

## K3.3 — closing the three findings K3.2 carried forward

A narrow closure phase. No new phase, no solver change, no controller change.
Two of the three turned out to sit on top of defects worse than the findings
themselves.

### Finding 1 — pump suction / cavitation

**Root cause.** A pump's rated flow is engineering data; the path that has to
deliver it is drawing data; nothing compared them. The only signal was
`SolveResult.cavitating` at RUN time, on a plant already drawn and issued.

**Engineering decision.** A static check, in the **existing Checks engine** —
two `Rule`s in `validate/rules/process.ts` adapting one pure derivation in
`model/suction.ts`, the same split `validate/rules/diagnostics.ts` already
uses. No new framework, no new diagnostic category, no change to the
seven-category ledger or the reconciliation view.

**It is not an NPSH calculation**, and says so in the finding text. NPSHa needs
the fluid, its vapour pressure at the pumping temperature, its density and the
static lift; NPSHr needs the machine's NPSH curve. The model holds none of
them — one incompressible fluid with no identity, no suction temperature, no
elevation beyond a vessel's own liquid head. What it computes is hydraulic
capacity: the lowest-resistance route from the suction nozzle to a pressure
source, over the canonical `ProcessModel`, priced with that model's own
`ΔP = R·Q·|Q|`. The most such a path can pass is `√(P_source / R)`.

**The threshold is the physics, and it had to be.** The measurement that
decided this:

| drawing | pump | source | `Q_max` | rated | verdict |
| --- | --- | --- | --- | --- | --- |
| `sample-plant` | P-101 | vessel TK-101 @ 40 % (1.120 bar) | 52.92 | 50 | ok, 5.8 % margin |
| `sample-refinery-unit` | P-201 | vessel TK-201 @ 40 % | 52.92 | 50 | ok, 5.8 % margin |
| `template-hmi-demo` | P-101 | boundary (1.000 bar) | **50.00** | **50** | exactly at capability |

That last row is not a coincidence:

```text
√(supplyPressureBar / PIPE_K) = √(1 / 4e-4) = 50 m³/h = DEFAULTS.pumpFlowM3h
```

exactly, in IEEE754. `PIPE_K` was calibrated against that same default machine
(see `model.ts`), so **the default pump on a single-run suction has zero
suction margin by construction**. Any margin term added to the check would
therefore fire on the demo and on every drawing like it, for a reason no
draughtsman can act on — and tuning the margin until the bundled samples went
quiet is precisely what the QA baseline contract forbids. So the check reports
only `rated > Q_max`, strictly: a path at capability is at capability, not
beyond it. Where "enough margin" begins is the question NPSH answers, and this
model cannot.

**States.** `unsupplied` (no source at all — a broken drawing) and
`insufficient` (a source, but the path cannot pass the rated flow) are the two
static ones; `cavitating` remains the live one, already carried into data
quality by K3.2. Each finding names the machine, its duty and whether that duty
was assumed, the source and its pressure, what the path can pass, where the
nozzle would sit, and what to do about it.

**Remaining limitation.** Only drawings that carry HMI screens are judged, because
the process model is compiled from them — four of the five bundled files have
none. And a pump reached only *through another machine* is not priced: a pump
is a source of head, not a resistance, so the walk stops at it.

### Finding 2 — declared nozzle roles

**Root cause, and a worse one underneath it.** `declaredRole` answered from a
flat table that did not know what kind of equipment the line had landed on.
Two consequences, the second not previously known:

1. `aPort: 'top'` on a tank was **ignored** whenever the line was drawn low on
   the shell. The geometry won silently and a vent became a drain.
2. `aPort: 'outlet'` on a tank returned a role the vessel schema does not list,
   so the builder attached the edge to a node id (`…:t:outlet`) **that nothing
   ever created**. Measured: the line carried **0.0000 m³/h** instead of
   12.25, **no issue was raised**, and the solve still reported `converged`
   with an empty `undetermined`. An ordinary P&ID label silently disconnected a
   branch, and every surface in the product said the plant was fine. The same
   held for `inlet`, `suction` and `discharge` on a vessel — and for `in`/`out`
   on a **pump**, which has no `inlet` either.

**Engineering decision.** `declaredRole(portId, kind)`. A role is only a role if
the kind's `PORT_SCHEMA` offers it; otherwise it is refused, the existing
`stream-to-missing-port` issue is raised, and the documented positional
fallback answers. Names are read in two groups:

- **generic** (`in`/`inlet`, `out`/`outlet`) ask the kind, through the
  `INLET_ROLE`/`OUTLET_ROLE` tables that already existed — so a vessel's
  `inlet` is its top nozzle and its `outlet` its bottom one;
- **literal** (`suction`, `discharge`, `top`, `bottom`, `vent`, `drain`) name
  one port and mean nothing elsewhere. `vent`→`top` and `drain`→`bottom`
  because hydraulically that is what they are; they are **not** added to
  `PortRole`, since the solver cannot distinguish a vent from any other opening
  and a role it could not honour would be a false claim.

**Compass ids stay positional, deliberately.** `n` on a vessel rotated 180°
points at the floor, so a compass id cannot be read as a process role. That is
a decision, and the fallback is recorded as `anchored` rather than passed off
as `declared`.

**Backward compatibility.** Nothing in the five bundled drawings changes: none
carries a vessel-attached `aPort`/`bPort`, and no dangling endpoint exists in
any of them before or after. Drawings that state nothing keep the documented
positional fallback exactly as before.

### Finding 3 — LV-101's calm-start movement

**Classification: C, an actuator default problem** (with a B component — the
valve was seeded from a controller output that did not exist yet).

**Root cause, traced end to end.**

```text
initTags: controller seeded  OP = 40   ← a placeholder; no controller has run
   -> driven throttling valve seeded OP = POS = 40 to match it
   -> initTags SOLVES the network, so the valve is genuinely 40 % open
   -> the solve gives that line flow
   -> the vessel's inventory integrates it
   -> tick 1: the controller finally executes, computes its real output (0),
      and the actuator strokes shut over ~1.6 s at 25 %/s, passing flow all
      the way down
   -> 5e-5 % of a 200 m³ vessel, and LT-101 reads it
```

The 40 was never an output. It was a default sitting in a field that the first
tick overwrites — but `initTags` solves the network, so between seeding and
that first tick the number was load-bearing.

**Engineering decision.** A final element has **no command until its controller
has run**, so it holds its rest position — and for every throttling valve in
this model that is shut. `initTags` now seeds every throttling valve at 0 %,
driven or not, and a controller's output at 0. The first tick computes the real
output and the actuator strokes towards it at its real rate, which is what an
actuator does. Nothing is frozen, nothing is hidden from the solver, no history
is suppressed.

**One test changed, and it is worth naming.** `faceplateVisual` ›
*reports deviation when the position is not following the command* wrote
straight to a controller-driven valve's `OP` — which the loop overwrites each
tick — and passed only because the valve was seeded 40 % open while the
controller drove its output away from that. **The deviation came from the seed,
not from the stuck valve.** The fixture now puts PIC-101 in MANUAL so the
operator's output is genuinely the command, and asserts the position really did
not move.

### Gate

```text
3147 tests passing · 7 skipped · 0 failing      (3120 before, +27)
tsc -b clean · production build clean
189 Playwright specs passing · 2 failing, the same two as on a5b9793 and ac1a668
sample QA baseline UNCHANGED — both new rules are silent on all five bundled files
```

## K4 — a process view derived from the topology

K3.2/K3.3 made the runtime correct. The remaining problem was presentational:
the operator's PROCESS page was the P&ID's own geometry with live values
painted on it, which is the right picture for an engineer and the wrong one for
an operator.

### Architecture

```text
P&ID (engineering source of truth)
  └─ buildSimModel
       ├─ ProcessModel          canonical topology — ONE of these
       │    ├─ solveHydraulics  → signed pipe flows, node pressures
       │    └─ buildProcessView → ProcessViewModel   (nodes, edges, LAYOUT)
       └─ TagDef[] / ControllerSpec[]
                                  ↓                         ↓
                        simStore: STATIC             simStore: DYNAMIC
                        processView                  pipeFlows, pipePressures,
                        (built in enterRun,          tags, quality, alarms,
                         never on a tick)            hydraulic status
                                  └──────────┬──────────────┘
                                             ↓
                                    ProcessView.tsx (read-only)
```

The view **inverts** the hydraulic graph: there a pump is an EDGE between two
pressure nodes, because that is what it is to a solver; here it is a BOX, and
the pipe is the line between boxes. Device edges collapse into nodes that
absorb their two port nodes, a vessel's nozzles collapse into one vessel, and
pipe edges become lines.

### Topology evidence — before and after

`tests/hmi/processView.test.ts` recomputes a full census of the engineering
model on both sides of building the view and requires them equal, on the K4
fixture and all three bundled samples: widget count, tag count, pipe count,
port count, node count, edge count, branch count, `edgeOfPipe` size, vessel
count, equipment count, every `bindPipe` and `bindTank` binding, every
controller pairing, and the issue count.

On the K4 fixture the derivation produces:

| | |
| --- | --- |
| drawn pipes | 9 → 9 view edges, each pipe appearing exactly once |
| `ProcessModel` nodes | 17, every one claimed by exactly one box, none twice |
| devices | 5 (P-101, FV-101, HV-102, T-101, LV-101) → 5 boxes |
| vessels | 2, each ONE box however many nozzles |
| inputs | 2, kept separate — `a1` and `b1` reach different boundary objects |
| inline instruments | FT-101 on `a2`, PT-101 + PG-101 on `a3`, PG-102 on `a1` |
| vessel instruments | LT-101 on TK-A, LT-102 on TK-B |
| controllers | LIC-101 placed on LV-101, its final element |

Asserted as invariants rather than counts: **every** node claimed exactly once
and all of them claimed; every view edge is a real `ProcessModel` edge with the
identical `pipeIds`; no two boxes overlap; every line starts on the box it
leaves and ends on the box it enters; every object is downstream in x of what
feeds it; and **none** of the laid-out coordinates equals the P&ID coordinate
it came from.

### Runtime evidence

| Scenario | What the solve did | What the view showed |
| --- | --- | --- |
| **A** normal | `a2` 14.4 m³/h forward, `a3` 1.4 bar | every line with `abs(q) > SHUT_LEAK_MAX` animated forward and no other; FT-101 drew its own tag's PV, within the instrument's 0.8 % noise of `pipeFlows.a2` and over 1 m³/h away from the two-leg total; PT-101 likewise against `pipePressures.a3`, and 0.5 bar away from the pressure before the valve; TK-A's liquid height = level/100 to 2 dp |
| **B** valve closure | 100 % → 25 % → 0 %, flow falling to below the leak ceiling | FT-101 fell at each step; the line went `data-flowing=0` and its arrow disappeared; FV-101 showed `POS 100 %` **and** a separate m³/h |
| **C** pump trip | `a2` below `SHUT_LEAK_MAX` | `data-state=tripped`, the word TRIPPED, `a1`/`a2` still. The remaining motion was gravity redistributing what the pump had already delivered, so the assertion is the invariant — **every** edge animated iff its solved flow exceeds the ceiling |
| **D** branches | `a3` and `b2` both live and different; `a4` ≠ `a5` | four separate lines, four separate flows; signed mass balance at the tee < 0.01 m³/h |
| **E** reversal | `a4` positive, then **negative** after the pump stopped over a high TK-A | `data-direction` went `forward` → `reverse`, the overlay's `animationDirection` became `reverse`, the diagram did **not** relay out, and both vessels moved the way the sign said |
| **F** invalid | `cavitating` non-empty at 400 m³/h on a suction that cannot supply it | the banner appeared in words; PG-102's quality became `uncertain` and carried its glyph. Separately: an instrument forced BAD printed `- - -` while its LINE went on animating, because a failed instrument is not a failed process |

### HMI evidence

Seven captures in `e2e/processView.spec.ts`, inspected:

- **Continuity** — the plant reads left to right as one section: `SUPPLY → P-101 → FV-101 → T-101 → {TK-A, TK-B} → LV-101 → BOUNDARY`, with the second input joining at the tee. No gaps, no floating pipes, no crossings.
- **Inline instruments** — each on a small plate with a stem down to its pipe. The first cut wrote tag and value end to end on one line and overhung the boxes either side; two stacked lines on an opaque plate fixed it. A tee's tag overflowed its 28 px box, so a fitting is now a circle with its tag beneath.
- **Branch clarity** — the two destinations leave the tee on separate lines to separately-labelled vessels.
- **Flow direction** — arrowheads plus dash travel. In capture 1 the second (gravity) source reads `DESTINATION` with its arrow pointing outward, because the pump holds the header above the 1 bar boundary and the passive source receives. That is the **one-boundary limitation** showing honestly rather than being papered over, and it is exactly the behaviour signed flow exists to represent.
- **Alarm/quality separation** — capture 3 has the only saturated colour on any of them: P-101's alarm outline on a trip. Quality is a dash pattern and a glyph; state is fill and a word. The solve banner was moved OFF the alarm palette onto the quality channel during inspection, for that reason.
- **Light/dark** — the ISA-101 light theme carries the same layout at ISA-101 contrast; the classic theme is the dark one. Every value is a theme token, so the page follows the workspace rather than holding a palette.

### Performance

| Plant | Nodes/edges | `buildProcessView` |
| --- | --- | --- |
| K4 fixture | 17 / 14 | **0.035 ms** |
| `sample-plant` | 20 / 16 | 0.046 ms |
| `sample-refinery-unit` | 43 / 31 | 0.107 ms |
| synthetic, 500 widgets | 501 / 500 | 0.879 ms |

Once per run. `tickOnce` costs 0.101 ms with the view published, and the layout
object's identity is unchanged across 550 ticks — asserted, not just measured.

### Gate

```text
3189 tests passing · 7 skipped · 0 failing      (3147 before, +42)
tsc -b clean · production build clean
196 Playwright specs passing (+8 new) · 2 failing, the same two as on a5b9793
sample QA baseline unchanged
```

## K5 — one process picture, and what each stream carries

Two objectives: fold the duplicate presentation derivation into one, and turn
`fluidId` from a reserved token into an explicit engineering concept.

### 1. Process-view consolidation

K4 left a P2: the Overview's summary strip walked the BRANCH model and laid
itself out, while the Process flow page walked the hydraulic topology and laid
ITSELF out. One plant, two algorithms, free to drift — and a drawing change had
to be understood twice.

```text
BEFORE                              AFTER
ProcessModel ─┬─ ProcessViewModel   ProcessModel ─ ProcessViewModel ─┬─ ProcessView
              │      └─ ProcessView                     │            └─ processRoutes ─ Overview
FlowNetwork ──┴─ projectTopology                        └─ vesselFlows ─ Faceplate
                     └─ Overview
```

`sim/topology.ts` is **deleted**, not left beside the new one. Three consumers
moved onto the shared derivation:

| Consumer | Was | Now |
| --- | --- | --- |
| Overview strip | `projectTopology(net)` + its own layout | `processRoutes(processView)` |
| Faceplate vessel flows | summed whole BRANCHES, unsigned | `vesselFlows(...)`, from the **signed** edge flows, so a line that reverses moves from inlet to outlet instead of staying where the drawing put it |
| Boundary SUPPLY/DESTINATION | strip decided by POSITION in the route, page by the sign of the flow | one shared `boundaryRole`, from the sign, on both |

That last one was a real disagreement found while inspecting the Overview
capture: with the second source being overpowered by the pump, the same battery
limit read `SUPPLY` on the strip and `DESTINATION` on the page.

The tests hold consolidation *by reference*: a route's nodes and edges **are**
the objects the page draws (`expect(view.nodes).toContain(n)`), so there is no
copy to fall out of step. Held under a branch added, a branch removed, a second
input, a reversal, and a shut plant.

### 2. The fluid model

The P&ID already had `Fluid { id, name, color }` and `PlantEdge.fluidId`. What
it did not have was a way for the operator layer to know any of it: **the
importer resolved `fluidId` to a COLOUR and dropped the id**, so the only thing
the HMI knew about a service was what shade it had been drawn in. Anything
built on that would have been inferring process identity from a palette.

```ts
interface Fluid {
  id: string                      // THE IDENTITY
  name: string
  color: string                   // draws the P&ID line — a drafting convention
  displayToken?: StreamToken      // the HMI's controlled categorical slot
  densityKgM3?: number
  viscosityMPaS?: number
  heatCapacityKJkgK?: number
  referenceCondition?: string     // required whenever any property is present
}
type StreamToken = 'stream-a' | ... | 'stream-f'   // six, closed
```

**Only water carries properties**, and that is the honest state rather than an
omission: 1000 kg/m³, 1.0 mPa·s, 4.186 kJ/(kg·K) at 20 °C, 1 atm. A density for
Steam, Air or Gas needs a pressure and temperature this model does not carry;
Slurry and Fuel / Oil are whatever a project says they are. Filling those in
would be inventing engineering data.

Water's definition is not a second truth either: `LIQUID_CP_KJ_PER_M3_K = 4186`
in `sim/units.ts` is exactly `densityKgM3 × heatCapacityKJkgK`, and a test fails
if they ever part company.

### 3. Propagation

```text
PlantEdge.fluidId  →  HmiPipe.fluidId  →  ProcessEdge.fluidIds  →  deriveFluids
     (P&ID)            (importer, K5)         (carried, unused)      (sim/fluids.ts)
                                                                          ↓
                                                            ViewEdge.fluid → renderer
```

The rule is **the one the P&ID already uses**: a service travels along a RUN —
pipe carried through two-port hardware — and a run ends where the pipe branches
or enters a vessel. Stated wins; an unstated run takes the service of the runs
it touches at a junction; touching two makes it MIXED; MIXED spreads; nothing
crosses a vessel.

**An earlier attempt propagated edge to edge and got the central case wrong:**
the leg *feeding* a junction took the service of the other leg back across the
junction, so two clean inputs both read as mixed and the mixture had swallowed
its own causes. A junction is where services meet; it is not somewhere a service
travels through. Runs fix it because a run stops at the branch.

It is **direction-free and static** — a reversed water line is still water, and
the derivation is never handed a flow.

### 4. Multiple inputs

On the K5 fixture (`fl-water` on one inlet, `fl-oil` on the other, meeting at a
tee):

| stream | service |
| --- | --- |
| `a1`, `a2` — the water leg through HV-A | **Water**, `stream-a` |
| `b1`, `b2` — the oil leg through HV-B | **Fuel / Oil**, `stream-e` |
| `c1` — past the junction | **MIXED (Fuel / Oil + Water)** |

Neither collapses into the other, and neither wins. Where both inlets state the
SAME service, the downstream stream is that service and there is no mixing
point — the model only reports a mixture when there is one.

### 5. Mixing: EXPLICITLY UNSUPPORTED

Option 2 of the brief, and stated as such. A mixed stream carries **what it is
made of** — component ids and names — and **nothing about how it behaves**. No
density, no viscosity, no heat capacity is computed for a mixture, because this
model has no mixture physics. Pinned by a test that asserts those fields are
absent.

### PART E — fluid identity changes no physics, and that is pinned

The solver does not know a fluid exists. `tests/hmi/fluids.test.ts` solves the
same plant with and without services stated and requires every pressure and
every flow to be **identical to the last bit**. A half-applied viscosity
correction would be worse than none, because the numbers would still look right.

### HMI evidence

| Capture | Shows |
| --- | --- |
| `pv-9-fluids.png` | two services, visibly distinct; the mixed streams past the tee drawn broken; `MIXING` on T-101 |
| `pv-10-fluid-reversed.png` | the same stream reversed and its pump tripped — the service is unchanged |
| `pv-11-fluid-quality.png` | TK-A in alarm (red outline), FT-101 BAD (`- - - ✕`), **both stream colours intact** |
| `pv-12-overview.png` | the strip showing the same objects as the page |

The palette is six theme tokens with **no warm hues in either theme** — red,
orange and yellow belong to the alarm system. Cool hues alone cannot hold six
services apart, so they are separated by LIGHTNESS as well: `streamA` and
`streamE` are both blue and were indistinguishable at pipe width until the
inspection caught it. Applied to the STATIC pipe only, never the moving overlay,
so what a line carries never blurs with whether it is moving.

### Preservation

The census in `processView.test.ts` now includes fluid assignments (per pipe and
per compiled edge) alongside widgets, tags, pipes, ports, nodes, edges,
branches, every binding and every controller pairing — recomputed on both sides
and required equal, on the fixture and all three bundled samples. Separately:
the topology built with services stated is **node-for-node and edge-for-edge
identical** to the one built without them.

### PART M — the one-boundary limitation is not hidden

Unchanged and still shown truthfully. On the K5 captures the gravity-fed second
source reads `DESTINATION` with its arrow pointing outward, because the pump
holds the header above the 1 bar boundary and a passive source cannot supply
against it. Nothing was reversed to make the diagram look intuitive. No evidence
emerged that this is a modelling defect rather than the documented
single-boundary consequence.

### Gate

```text
3225 tests passing · 7 skipped · 0 failing      (3189 before, +36)
tsc -b clean · production build clean
199 Playwright specs passing (+1)
```

**A THIRD Playwright failure appeared and it is not ours.** `e2e/home.spec.ts`
passes at the parent `739b773` and fails in the working tree, because a
CONCURRENT session is mid-redesign of the homepage in the same checkout —
`src/home/`, `index.html`, `src/EditorRoot.tsx` and `.gitignore` are modified by
work that is not part of K5. None of those files is in this commit. The two
known failures (`equip.spec`, `screenshot.spec`) are unchanged;
`controlledExport` flakes under parallel load and passes in isolation, as in K2
onwards.

## K6 — hydraulic boundary conditions, made explicit

An investigation phase that turned into a small, contained change. The finding
that shaped it: **the boundary model had exactly one pressure in it, it was a
constant, and its name was wrong.**

### The boundary model as K6 found it

Every hydraulic network needs somewhere its pressures are fixed rather than
solved. This model has three, and all three silently took the same constant:

| Fixed node | Created from | Pressure it took |
| --- | --- | --- |
| boundary | a **free pipe end** — no widget found at it | `DEFAULTS.supplyPressureBar` (1 bar) |
| vessel, top nozzle | a vessel's `top`/`vent` port | `supplyPressureBar` |
| vessel, bottom nozzle | a vessel's `bottom`/`drain` port | `supplyPressureBar + vesselHeadBar(level)` |
| undetermined | a fragment with no path to any of the above | frozen at `supplyPressureBar`, reported |

A pump is **not** a boundary and never was: it is an EDGE carrying a curve
between two internal nodes, which is correct and unchanged.

Three things were wrong with that, in ascending order of seriousness:

1. **`ProcessNode.pressureBar` was vestigial.** The field existed, was
   documented as "the pressure held at this boundary", and was written exactly
   once — as `undefined`. Every boundary took the constant from inside the
   solver.
2. **The semantics were implicit.** One number stood for three different
   physical situations and the reader had to know which.
3. **The name was wrong, and the name was the bug.** `supplyPressureBar`
   implied a battery-limit supply header. It is not one — it is the
   atmosphere — and that mis-naming is the direct source of the recurring,
   reasonable-sounding, wrong expectation that a free pipe end should be able
   to PUSH. It cannot, any more than the air can fill a vented tank.

### What the engineering model can honestly state

Searched before changing anything:

| Candidate carrier | Verdict |
| --- | --- |
| `PlantEdge.fluidId` / `LineNumber.spec` | a service and a piping class. No pressure. |
| `design.pressure` | a **RATING** — what a vessel withstands. Using it as an operating condition would sit a vapour space at its relief setting. |
| **`design.operatingPressure`** | **already in the field table** (`model/fields.ts`, beside the `design.operatingTemperature` that the simulator has always read) — and nothing read it. |
| `ann.offpage` off-page connector | present on three bundled drawings, but the importer never brings it to the HMI. Those lines already become free-end boundaries. |

So **no new metadata was invented and none was needed**: the operating pressure
field already existed, unused.

### The change

```ts
type BoundaryKind =
  | 'atmospheric'    // a free pipe end — the deterministic fallback
  | 'vessel-vapour'  // a vessel's vapour space: vented, or held if stated
  | 'vessel-liquid'  // that pressure PLUS the static head above the nozzle
  | 'internal'       // not a boundary; the solver determines it
```

- `ProcessNode.boundary` names the condition; `pressureBar` is **populated**.
- `SolveInputs.vesselPressure?(tag)` — optional, defaulting to atmospheric — so
  a vessel whose record states an operating pressure is **closed** at it.
- `TagDef.vesselPressureBarA` reads `design.operatingPressure`, never
  `design.pressure`.
- `supplyPressureBar` → **`atmosphericPressureBar`**, 25 references.

**Gauge versus absolute was the one place a real bug was available.** The shared
`PRESSURE` table treats `bar`, `barg` and `bara` alike — harmless for a rating,
a whole atmosphere of error for an operating condition. `operatingPressure()`
reads the unit itself: `barg`/`psig`/**bare** are gauge and get atmospheric
added, because a datasheet saying "operating pressure: 3 bar" means 3 barg;
`bara`/`atm`/`kpa`/`mpa`/`pa` are taken as stated.

### What is deliberately NOT here

- **No SOURCE and no SINK.** Which end supplies and which receives is an
  outcome of the solve — the sign of the flow. Making it a property of the
  topology would let a drawing dictate a direction the pressures contradict,
  which is the one thing this model has refused since K2. A test asserts the
  kinds are exactly `internal | vessel-liquid | vessel-vapour` and that no
  `source` or `sink` exists.
- **No stated pressure on a BOUNDARY node.** A free pipe end has no tag, so no
  record. Giving one a stated pressure needs a tagged terminal object that the
  importer carries across — importer work, and a separate phase.
- **No reservoir model.** A fixed-pressure node has **unlimited capacity**: the
  air absorbs whatever arrives and is still one atmosphere however hard it is
  pushed. Previously an unstated assumption; now asserted by a test so it is on
  the record.
- **No NPSH.** The K3.3 hydraulic-capacity diagnostic is untouched.

### Test evidence

| Scenario | Result |
| --- | --- |
| **A** equal pressures | two vented vessels at the same level: \|Q\| < `MASS_TOL`. Vented vapour space against the air: both nodes at exactly 1.000 bar, \|Q\| < `SHUT_LEAK_MAX` |
| **B** higher upstream | vessel at 1 barg → air: Q > 1 m³/h outward, and monotone in the stated pressure (0 < 1 < 2 barg) |
| **C** reversed | pressurise the FAR vessel and the same line runs backwards — same magnitude to 6 dp, opposite sign. Nothing clamps it |
| **D** pumped header | the machine pushes out through the passive end; mass balances across it to `MASS_TOL`. The pump's own nodes are `internal`, and it RAISES the pressure it is given (>1 bar running, <0.2 bar stopped) rather than replacing it |
| **E** vented vessel | vapour space and air both exactly `atmosphericPressureBar`; no flow — a stated boundary condition, not two numbers coinciding |
| **F** vessel drain | bottom nozzle drains, top does not; monotone in level (90 % > 50 % > 10 %) |
| **G** pump suction | vented: suction = atmosphere + head, to 3 dp. Held at 2 barg: suction is exactly 2 bar higher, and the VESSEL'S RECORD decided it |
| **H** insufficient suction | 400 m³/h duty still cavitates; the pressure is still the negative number the equations produced, reported and not clamped |

Plus: legacy drawings solve **bit-identically** with the fallback and with
vented stated explicitly; the topology is unchanged; and the process view reads
`DESTINATION` / `BOUNDARY` from the sign through the shared `boundaryRole`.

### Gate

```text
3261 tests passing · 7 skipped · 0 failing      (+24 K6, rest from concurrent work)
tsc -b clean · production build clean
206 Playwright passing · 2 failing — the SAME two as on a5b9793
```

`home.spec.ts` now passes: the concurrent session fixed its own regression.

## K7 — tagged terminals: a boundary that can state its pressure

K6 closed with one P1: a free pipe end has no tag, so no engineering record, so
no way for a drawing to say *this connection terminates at 3 barg*. Every
boundary was therefore the atmosphere, and a battery limit could not push.

This adds the object that can say it.

### The engineering model

A **battery limit** is now a P&ID symbol like any other piece of equipment:

```ts
eq('bl.terminal', 'Battery Limit / Terminal', …,
   ports: [{ id: 'w', kind: 'process' }],      // exactly ONE connection
   tagRule: 'equipment')                        // so it takes a tag
```

It is tagged, it takes a registry record, and its boundary pressure comes off
that record's `design.operatingPressure` — the same field, read by the same
`operatingPressure()`, that K6 gave to vessels. There is one pressure system in
the product, not two.

| | |
| --- | --- |
| identity | a tagged widget, `type: 'equip'` + `symbolId: 'bl.terminal'` |
| connection | one explicit port, role `process` |
| condition | `design.operatingPressure` on its registry record |
| units | `barg` / `bara` / `psig` / bare, via the canonical reader |
| description | the registry's own fields, as for any tag |

### Topology

```text
P&ID terminal (tagged)                     ProcessModel
  └─ port `process` ──── pipe ────────────► boundary node
                                             kind:     'boundary'
                                             boundary: 'fixed-pressure'
                                             tag:      'BL-101'
                                             pressureBar: 4       (3 barg)
```

A terminal is the one piece of equipment that **contributes no edge**. A pump,
a valve and a fitting all conduct, so each compiles to an edge between two port
nodes; the drawing *stops* at a terminal, so it compiles to a node and nothing
else. That is what makes it a boundary rather than a vessel with no volume.

`buildProcessModel(screens, registry?)` now takes the registry, because the
boundary condition is engineering data and the topology is where it belongs.
The solver was **not changed**: K6 already had it read `node.pressureBar`, and
a terminal simply populates it.

### Pressure semantics

| Stated | Absolute | Why |
| --- | --- | --- |
| `3 barg` | 4 bar | gauge plus one atmosphere |
| `4 bara` | 4 bar | absolute, as written |
| `3` / `3 bar` | 4 bar | **bare is gauge** — a datasheet saying "operating pressure: 3 bar" means barg |
| `20 barg` on `design.pressure` | *ignored* | a RATING, not an operating condition |
| nothing | 1 bar | atmosphere, **and a diagnostic** |

**On the atmospheric reference.** The brief's worked example uses 1.013 bar.
This project's canonical value is exactly **1 bar** — a round figure chosen for
a training model, and the one `PIPE_K` is calibrated against. The instruction
was to use the project's existing value rather than introduce a second
constant, so `3 barg` is `4 bara` here. Changing the reference would move every
calibration in the hydraulic model and is not a K7 change.

### Flow direction — unchanged, and deliberately so

There is still **no SOURCE and no SINK**. A terminal states a pressure; the
solver decides which way anything moves. Measured on one drawing, changing only
the two records:

| BL-A | BL-B | `pipeFlow.t1` (drawn A→B) |
| --- | --- | --- |
| 3 barg | 1 barg | **+40.825** m³/h |
| 1 barg | 3 barg | **−40.825** m³/h |
| 3 barg | 3 barg | < `MASS_TOL` |

Same drawing, same pipe, same orientation. The two magnitudes agree to within
`MASS_TOL`, which is the precision a converged solve is defined to.

### Multiple terminals

`BL-S` at 2 barg and `BL-D` at 5 barg on one model hold **3 bar** and **6 bar**
independently — no global pressure, and the solve reproduces both exactly. With
a pump between them, stiffening the discharge terminal from 1 to 3 barg pushes
the machine back up its curve and reduces the flow, while the pump goes on
*adding* head rather than becoming a boundary.

### Diagnostics

Two rules in the existing Checks engine, following the K3.3 suction precedent:

| Rule | Severity | Fires when |
| --- | --- | --- |
| `terminal-no-pressure` | warning | a tagged terminal whose record states no operating pressure |
| `terminal-bad-pressure` | critical | a stated pressure that cannot be read as one — `NaN`, `lots`, `3 furlongs` |

**A legacy free end produces no finding.** Silence at an untagged end is not an
incomplete specification: the drawing never claimed anything about it. A
terminal is different — somebody drew a battery limit and tagged it, asserting
that the connection ends at a known condition, and an assertion left unfinished
is worth saying out loud.

In both failure cases the model still **solves at atmosphere** so the plant
runs, and the value on the node is a real finite number — never zero, never
`NaN`, never a coerced string. The finding is what carries the problem.

### Preservation

Replacing two free ends with two terminals leaves the same pipes, the same
edges, the same edge kinds, the same `edgeOfPipe`, and the same node count —
two anonymous boundary nodes became two tagged ones and nothing else moved. A
registry record for a tag that is not on the drawing changes nothing. An
**untagged** terminal falls back to atmosphere, because it has nothing to state
a pressure with.

An instrument on a terminal's pipe still reads **its own edge**: a PT on the
line from a 4 bar terminal reads the mean of that line's two ends, which is
below 4 — the tapping is on the pipe, not at the battery limit.

### Gate

```text
3288 tests passing · 7 skipped · 0 failing      (+27)
tsc -b clean · production build clean
205 Playwright passing · 2 failing — the SAME two as on a5b9793
sample QA baseline unchanged — no bundled drawing has a terminal
```

### Future work

Terminal pressure is **static**: the engineering record defines it and there is
no operator control for it, which is the right default — a battery limit is a
fact about the plant, not a knob. Runtime-variable boundary conditions (a
header that sags under load, a scenario that trips a supply) would be a
separate phase with its own operator semantics.

## K8 — runtime operating scenarios

K7 gave a terminal a pressure from its engineering record. That is a fact about
the plant. **What the plant is doing today is a different kind of fact**, and it
must not go anywhere near the registry.

### The model

`sim/scenario.ts`, and it is small on purpose:

```ts
type Override =
  | { kind: 'terminal-pressure'; tag: string; pressure: string }  // '2 barg'
  | { kind: 'signal'; tag: string; signal: string; value: number }

interface Scenario { id: string; name: string; overrides: Override[] }
```

Everything is keyed by **engineering tag** — never a widget id, an index or a
position. A scenario cannot change the topology *by construction*: there is no
override that adds, removes or reconnects anything, because the only things one
can name are a tag and a value.

**Two channels, and only one of them is new.**

| | Channel | Why |
| --- | --- | --- |
| pump RUN, valve OP, heater, controller MODE, FAULT | the **existing** operator write path | it already exists; a second one would be a second answer to "is P-101 running". A scenario's equipment overrides go through `writeTag`, so the journal records them like any other command |
| a terminal's pressure | **new** | it had no runtime channel at all — K7 compiled it into the topology from the record, and there was no way to say "not today" |

### Precedence, resolved in one place

```text
scenario override  →  engineering record  →  atmospheric fallback
```

`resolveTerminal` is the only function that decides this, and every value it
returns carries **where it came from**:

```ts
{ source: 'scenario' | 'engineering' | 'default' | 'invalid', barA, reason? }
```

so nothing downstream has to guess whether a pressure is a specification or a
shift. Published as `simStore.terminals`.

### The solver

One optional input, `SolveInputs.boundaryPressure?(tag)`, and one line in the
boundary branch. **No equation changed.** This completes a pattern rather than
altering one: every other runtime state the solver depends on already arrives
this way — a valve's opening, a pump's speed, a vessel's level and its vapour
pressure. The boundary pressure was the last fixed condition with no runtime
channel, which is precisely why a scenario could not touch it.

### The data flow

```text
Scenario (tag → value)
   ├─ signal overrides ──► writeTag ──► tags ──► journal, quality
   └─ terminal pressure ─► resolveTerminal ─► simStore.terminals
                                                    │
                                           TickOptions.boundaryPressure
                                                    ↓
              engine.tick ─► solveHydraulics ─► pressure field, SIGNED flows
                                                    ↓
              inventory · thermal · transmitters · controllers · alarms · history
```

No value is ever injected into a measurement. A transmitter reads the solved
state, the same as it did before there were scenarios.

### Evidence

**Causal, not cosmetic.** Dropping `BL-S` from 3 barg to 1 barg moves, in one
step: the suction line (down >1 bar), the pump's discharge, the feed flow, PT-1,
FT-1, and the rate the vessel fills — and PT-1 still equals its own line's
solved pressure to 1 dp rather than the scenario's number.

**Direction is still the solver's.** `BL-D` as specified is 1 barg — two bar
absolute, already *above* the vessel's bottom nozzle at ~1.12 bar — so as drawn
it FEEDS the plant. Put it at 0 barg and the same line drains; put it at 4 barg
and it feeds harder. Nothing was told to reverse.

**Invalid input fails loudly.**

| Case | Result |
| --- | --- |
| tag is not a terminal (`BL-NOPE`, or `P-1`) | `invalid`, named; real terminals untouched; plant still converges |
| unreadable pressure (`NaN`, `Infinity`, `lots`, `3 furlongs`, `''`) | `invalid`; falls back to the **engineering** value, never zero, never NaN |
| **duplicate** override for one tag | `invalid`, and **neither value wins** — both are named in the reason |
| non-finite signal value | reported, and **not written** |

**Deterministic.** The same start, the same scenario and the same steps give
bit-identical flows, pressures, tags and clock. An intervening run with a
different scenario changes nothing about the next one.

**Backward compatible.** A drawing with no terminals resolves to `{}` and every
free end is atmospheric as before. Applying a scenario and clearing it leaves
the plant exactly where an unscenarioed run of the same length would be —
compared run-for-run, because the inventory integrates and a plant that has run
for six minutes is not the plant at two.

### Gate

```text
3314 tests passing · 7 skipped · 0 failing      (+26)
tsc -b clean · production build clean
206 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### What this is not, yet

- **No operator scenario editor.** §6 asked for the runtime state contract
  only, and that is what this is. The store has `applyScenario` / `clearScenario`
  and publishes `terminals` and `scenarioProblems`; no UI reads them yet.
- **`clearScenario` does not rewind equipment.** Overrides that went through
  `writeTag` stay written, because an operator undoes a command with a command.
  RESET returns the whole plant, scenario included.
- **No scenario persistence.** A scenario lives for the session. Storing one in
  the document would make it engineering data, which is the distinction this
  phase exists to draw.

## K9 — the operator scenario surface

K8 built the runtime scenario contract and left it with nothing reading it. This
is the surface, and the diagnostics that go with it.

### The page

A RUN-only **Scenario** page, showing the two truths side by side:

```text
TAG    SERVICE         ENGINEERING   ACTIVE    SOURCE        OBSERVED
BL-S   Feed header       3.0 barg   1.0 barg   Scenario      SUPPLYING    [override]
BL-D   Product outlet    1.0 barg   1.0 barg   Engineering   SUPPLYING    [override]
```

`ENGINEERING` is what the record says; `ACTIVE` is what is in force; `SOURCE`
says which. The gauge representation is `formatBarg`, the inverse of the K6/K7
reader against the one `ATMOSPHERIC_BAR` in the product — not a second
conversion system.

**It calculates nothing.** An override is a boundary condition handed to the
solver; every number beside it is read back out of the solved state. A test
drives an override through the rendered input and asserts the flow, the line
pressure AND the transmitters moved, and that PT-1 reads its own line rather
than the number typed into the page.

**It changes no document.** A test compares the registry JSON and the view's
node count before and after.

### Clear scenario is not Reset, and the page says so

K8 chose deliberately that clearing a scenario does not rewind an equipment
command. The page keeps that and makes it legible: two separate buttons and a
note — *"Clear scenario removes runtime boundary overrides only. Equipment
commands stay where they were put — an operator undoes a command with a
command. Reset plant returns the whole simulation to its starting state."* A
test asserts the wording and that `P-1.RUN` survives a clear.

### One tag, one value

The page **replaces** a tag's override rather than appending, so the
duplicate-override state K8 reports is unreachable from the UI. Overriding
BL-S twice leaves one override and no problems. The duplicate case remains
reachable from a programmatic scenario and remains reported.

### Diagnostics

`scenarioProblems` surfaces as a third **section** on the existing Diagnostics
page, beside Live runtime and Engineering — a third subject on one page, not a
third engine. Findings carry the existing `DiagnosticSeverity` and render with
the existing conventions.

Every scenario problem is an `error`, and uniformly so for a stated reason:
each one means *an override the operator asked for is not in effect*, so the
plant is not in the state they believe it is in. That is what `error` already
means on this scale. No new severity was introduced.

### §6 — observed role, not declared role

`SUPPLYING` / `RECEIVING` / `NO SIGNIFICANT FLOW`, derived from the **same**
`boundaryRole` the process view uses — one rule, two vocabularies, no second
piece of direction logic. K7 §18's instruction to preserve `boundaryRole` rather
than replace it with a `terminalRole` is kept literally.

A test watches one terminal read `NO SIGNIFICANT FLOW` → `SUPPLYING` → not
`SUPPLYING` as the pump starts and stops, with the terminal itself unchanged
throughout. Another asserts the page contains **no** occurrence of `SOURCE` or
`SINK`.

### §7 — the directional finding, recorded rather than fixed

`BL-D` is named and positioned as a **product outlet** and its record says
1 barg. That is **2 bar absolute**, and the vessel it connects to sits at
roughly **1.12 bar** at its bottom nozzle. So as specified this "outlet" is
above the plant and **supplies** it.

Nothing was changed to make the picture agree with the name. The capture
`pv-15-terminals-flow.png` shows both terminals reading `SUPPLY` with BL-D's
arrow pointing inward, and two tests record it:

| | |
| --- | --- |
| stated pressure | 2 bar absolute (`1 barg`) |
| connected process pressure | ~1.12 bar at the vessel's bottom nozzle |
| solved signed flow on its line | **negative** — into the plant |
| observed | `SUPPLYING` |

Override it to `0 barg` — one bar absolute, now below the plant — and the same
line drains, reading `RECEIVING`. **This is an engineering-data review finding:
the stated pressure and the intended direction disagree, and the pressure wins,
because it is the only one of the two that is a physical quantity.**

### One gap this exposed, and closed

`buildProcessView` never carried a boundary node's **tag**. Correct in K4, when
every boundary was an anonymous free end; wrong from K7, when a terminal could
be tagged. A terminal was therefore anonymous on the process view. One field,
and the boundary box now shows its identity above its observed role — which is
what K7 §17 asked for and could not have without it.

### Gate

```text
3333 tests passing · 7 skipped · 0 failing      (+19)
tsc -b clean · production build clean
206 Playwright passing (+1) · 2 failing — the SAME two as on a5b9793
```

### Remaining

- **No scenario persistence.** A scenario lives for the session; storing one in
  the document would make it engineering data.
- **Terminal pressure only.** The page edits boundary conditions; equipment
  overrides are shown when a programmatic scenario carries them, but are
  commanded from the equipment surfaces where they already were.
- **No scenario library.** There is no save/load/name-a-scenario; the page
  builds an ad-hoc "Operator scenario" as overrides are applied.

## K10 — a boundary that moves during a run

K7 gave a terminal a pressure from its record; K8 let a scenario hold it
somewhere else. Both are **still** for the length of a run. A utility header
that sags when the neighbouring unit starts up is neither.

### The model

Declared on the engineering record, **never inferred from a tag name**:

| Field | Meaning |
| --- | --- |
| `design.boundarySignal` | `constant` \| `step` \| `ramp` — absent means STATIC |
| `design.boundarySignalTo` | the pressure it ends at |
| `design.boundarySignalAt` | when a step happens, or a ramp begins |
| `design.boundarySignalOver` | how long a ramp takes |

It starts from `design.operatingPressure` — the same field K7 reads, through the
same `operatingPressure()`, so there is still one pressure system. Times are
read by a new `seconds()` against a `TIME` table, and a bare number is seconds.

Three shapes and no more. A boundary that moves must move **deterministically**
or a simulation stops being reproducible, and these cover the training cases — a
utility that sits still, one that trips, one that sags — without implying a
utility-network model the product does not have. Explicitly **not** implemented:
flow-controlled boundaries, reservoir levels, consumption models, compressor
networks, NPSH, mixing.

### Precedence — and a contradiction in the brief, resolved

```text
scenario override  →  runtime signal  →  engineering record  →  atmospheric
```

§3 lists the signal **above** the scenario and then states plainly that *"if a
scenario explicitly overrides a runtime-variable terminal, the scenario value
must win"*. The list and the sentence disagree. **I implemented the sentence**,
for two reasons: it is the explicit instruction, and it is the safer rule — an
operator who has deliberately pinned a boundary should not be quietly overruled
by a ramp they cannot see. The declared signal stays **visible** while it is
overridden, so they can see what they are overriding.

All four cases are tested: static±scenario, runtime-variable±scenario.

### Runtime data flow

```text
record → boundarySignal()  ── compiled ONCE onto ProcessNode.signal
                                        │
simStore.tickOnce:  t + dt ─► terminalPressures(model, scenario, t)
                                        │  (one pass over TERMINALS, never widgets)
                            TickOptions.boundaryPressure
                                        ↓
              solveHydraulics ─► node pressures · SIGNED flows
                                        ↓
     pump operating point · transmitters · inventory · thermal · alarms · history
```

**No second clock.** A signal is a pure function of its declaration and the
engine's own `t`; it holds no state between ticks. The published `terminals` map
is re-set only when a value actually moves, so a static plant does not re-render
the scenario page five times a second.

### Evidence

**Step** — `BL-S` 3 barg → 1 barg at t=120 s. Before: suction, feed flow, PT-1
and FT-1 at one solution. After: every one of them lower, PT-1 still equal to
its own line's solved pressure to 1 dp and **not** to the boundary's number, and
the vessel demonstrably filling more slowly.

**Ramp** — 3 barg → 1 barg over 60 s from t=60. The boundary reads 4.000, 3.000,
2.000 bar absolute at t = 60, 90, 120. The **plant's** response falls throughout
and is measurably *not* linear, which is the point: the input is a straight line
and the resistance law is not.

**Determinism** — a 240 s ramping run is bit-identical on repeat, and a step
lands at the same tick every time.

**Two independent** — `BL-S` stepping at 60 s and `BL-D` at 120 s move on their
own schedules; at t≈90 only one has changed. No global plant pressure.

**Direction** — a boundary ramping *above* the plant reverses its own line, from
the sign of the solved flow. No SOURCE/SINK kind was introduced; a test asserts
neither exists.

### A bug this found in my own code

The first implementation read the signal's `at` time with `seconds(raw) ?? 0`.
An **unreadable** time therefore became zero — silently moving the event to a
moment the record does not state. That is precisely the coercion §8 forbids, and
a test caught it. Absent and unreadable are now different things: absent means
"from the start", unreadable is a finding.

### Diagnostics

`terminal-bad-signal`, `critical`, in the existing Checks engine. Unlike a
missing pressure, a malformed signal is a statement that is **wrong** rather
than absent: the record describes behaviour the simulation will not produce.
Nine malformed shapes are covered — unknown kind, missing target, unreadable
target, missing duration, negative duration, NaN, Infinity, bad pressure unit,
bad time unit — plus a runtime-variable terminal with no operating pressure to
start from. In every case the plant still solves at the stated pressure, nothing
becomes NaN, and a scenario override still wins.

### Gate

```text
3360 tests passing · 7 skipped · 0 failing      (+27)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### Remaining

- **Pressure only.** A boundary's flow, level and composition are not runtime
  quantities, by design for this phase.
- **Three shapes.** No repeating, no schedule, no external driver.
- **No persistence of the active value** — it is recomputed from the declaration
  and the clock, and is never written back to `design.operatingPressure`.

## K11 — equipment operating-state dynamics

A verification phase. Almost nothing here is new: the pump curve, the valve
resistance law, the spin-up, the coast-down, the stroke rate and the trip have
been in the model since K3. What K11 adds is the **evidence that the whole chain
is causal**, one **derivation** naming what is deciding each command, and three
documented findings.

### §15 — what the engineering model actually contains

| Pump | Where it comes from |
| --- | --- |
| rated flow | `duty.capacity` (registry) → `TagDef.ratedFlow` |
| head at rated | `duty.head` (registry) → `TagDef.head` |
| curve | `H = H₀·r²·(1 − (Q/(1.5·Q_r·r))²)`, `H₀ = duty.head/(1−1/1.5²)` |
| affinity laws | **already in the curve** — head as `r²`, capacity as `r` |
| runtime | `RUN` (command), `RAMP` (shaft fraction), `FAULT` (trip) |
| dynamics | spin-up `RAMP_S = 2 s`, coast-down `COAST_S = 3 s` |

| Valve | |
| --- | --- |
| characteristic | `R = VALVE_K / max(SHUT_FRACTION, f)⁴`, so `Q ∝ f²` at fixed ΔP |
| resistance | calibrated (`VALVE_K = 4e-4`), **not** manufacturer Cv |
| runtime | `OP` (command), `POS` (position), `OPEN`, `STUCK`, `DEVT` |
| dynamics | `STROKE_RATE = 25 %/s`; `DEV_LIMIT = 10 %` |

**No manufacturer data was invented.** There is no Cv, no pump NPSH curve, no
valve characteristic table; the two calibrated constants are documented as
calibrations and are what the tests assert against.

### §7 — the precedence that already exists, documented

It was never ambiguous, only unwritten:

```text
PUMP shaft    FAULT → 0        (a trip opens the breaker and clears RUN too)
              else RAMP        (the shaft: lags the command both ways)
              else RUN ? 1 : 0

VALVE opening POS              (the ACTUAL position — what a stuck valve proves)
              else OP          (the command)
              else OPEN ? 1 : 0
```

The hydraulics read **`POS`, not `OP`** — the position, not the command. That is
the whole reason a stuck valve behaves like one.

`resolveEquipment` is added as a **derivation, not a store**: it names which of
`tripped` / `controller` / `scenario` / `operator` is deciding a command, from
state that already exists. A second place to keep equipment state would be the
competing store §2 forbids.

### Runtime data flow

```text
controller (AUTO)  ─┐
operator (MANUAL)  ─┼─► element.OP ─► actuator (25 %/s, STUCK) ─► POS
scenario signal    ─┘                                              │
                                                    valveResistance(POS/100)
RUN ─► shaft dynamics ─► RAMP ──────────────► pumpHead(duty, RAMP, Q)
                                                              ↓
                                                     solveHydraulics
                                                              ↓
              node pressures · SIGNED flows → inventory · instruments
                                                              ↓
                                           controller's PV on the NEXT tick
```

### Three findings

**1. There is no runtime speed command.** The affinity laws are in the curve and
the solver takes a shaft fraction, but the runtime *derives* that fraction from
`RUN` alone — ramping to 1 while commanded, coasting to 0 when not. Writing
`RAMP` is overwritten by the equipment dynamics on the next tick. §4 says to
test speed where it is already represented and not to invent it where it is not,
so it is tested **in the curve, through the solver's own input**, and monotone
across 1.0 → 0.2 → 0. A variable-speed setpoint would be new engineering data.

**2. A stopped pump BLOCKS its own line**, and that is a stated assumption
rather than a forcing: `docs/HMI.md` records it under *Assumptions, stated* —
the model assumes the discharge check valve a pumped system carries. With BL-S
at 3 barg on the far side, a stopped machine still isolates it.

So the distinction §3 demands is demonstrated where it is actually visible:
**stopping the pump does not zero the plant.** TK-1 stands above BL-D and goes
on draining by gravity with the machine stopped, and the inventory keeps falling
— the solver's answer, not a rule.

**3. A controller acts on the previous tick's measurement.** `LIC-1.PV` is the
transmitter's last reported value, not the vessel's instantaneous level. A real
DCS is the same, the loop is stable across it, and the test asserts the two
agree within the instrument's own band rather than exactly.

### Evidence

| | |
| --- | --- |
| **A** RUN | head develops, discharge above suction, `RAMP → 1` |
| **B** STOP | head gone; the machine blocks; **the rest of the plant carries on draining** |
| **C** speed | monotone in the curve across 1.0/0.8/0.6/0.4/0.2 and zero at 0 |
| **D-G** valve | 100 → 50 → 25 → 0 falls each step; shut is below `SHUT_LEAK_MAX`; **not linear** (½ opening ≠ ½ flow), and `R(0.5)/R(1) = 16` exactly |
| **H** reopen | 0 → 25 → 100 returns to the original flow; nothing latches |
| **I** trip | `RUN` cleared, shaft 0, flow redistributes, instruments follow |
| **J** loop | controller off both stops, element follows, drain passes what the solve says, level within 8 % of SP |
| **K/L** | FT and PT within the instrument's 0.8 % band of *their own* solved quantity across five equipment states; a 63 % command never appears as a reading |
| **M** reversal | stopping the pump and dropping BL-S below the vessel reverses the feed line |
| **N** degenerate | a two-valve ring with no free end is `undetermined`; a shut line is `converged` with zero flow — **different states, both explicit** |
| **O** determinism | the same commands twice give a bit-identical run |
| **P** legacy | a drawing with no terminals is untouched |

**§12** — a stopped pump raises nothing, a shut valve raises nothing, a **trip**
raises an alarm through the existing device logic, and every command lands in
the journal.

### Gate

```text
3387 tests passing · 7 skipped · 0 failing      (+27)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### Limitations

- **No variable-speed drive.** Shaft speed is derived from `RUN`; there is no
  setpoint for it.
- **No manufacturer data.** Valve resistance is a calibrated constant, not a Cv
  or a characteristic curve; the pump has no NPSH curve.
- **A stopped pump blocks** — the check valve is assumed, not modelled.
- No stiction, no hysteresis, no mechanical dynamics. All out of scope and none
  faked.

## K12 — variable-speed drive

K11 found the affinity laws already in the pump curve and the solver already
taking a shaft fraction — but the runtime **derived** that fraction from `RUN`
alone, so nothing could ask for part speed. K12 closes that, and the change is
one line of intent: **the shaft chases a target, and the target is now the speed
command instead of always being 1.**

### Engineering fields

| Field | Meaning |
| --- | --- |
| `duty.vsd` | **Variable speed drive** — yes/no. Absent means fixed-speed |
| `duty.minSpeed` | the turndown below which the drive will not run, % |

Both in the existing `duty` group, beside the `duty.speed` that was already
there. `yes/y/true/1/vsd/vfd/variable` and `no/n/false/0/fixed/none` are read;
anything else is `undefined`, so **"not said" and "said no" stay different
things**.

**Two documented assumptions, neither presented as manufacturer data:**

- **Maximum speed is 100 %** — not an invented limit but where the curve is
  defined: `H₀` is the shutoff head *at rated speed*, so `r > 1` would be
  extrapolating a curve the record does not describe. No field for it.
- **Default speed is 100 %** — because that is what a pump told to run has
  always done here, and a VSD machine with no command must behave like one.

With **no** turndown stated, no limit is imposed: a test asks for 5 % on a drive
with no `duty.minSpeed` and gets 5 %.

### Runtime state — three distinct things

```text
duty.vsd          capability   engineering record, static
SPD               command      %, runtime, operator or scenario
RAMP              actual       shaft fraction 0..1, what the CURVE reads
```

Command and actual are never collapsed. The faceplate shows **Actual speed**
first and **Speed command** beside it, never one in place of the other.

### The pump curve is untouched

`H = H₀·r²·(1 − (Q/(1.5·Q_r·r))²)` is the same equation it has been since K2.
Measured: halving the speed leaves the head at **under 45 %** of its full-speed
value — the `r²` doing it, not a linear derating.

### Command precedence — the existing model, extended by one target

```text
FAULT            → shaft 0                       (unchanged, and still wins)
RUN off          → coast to 0 at COAST_S         (unchanged)
RUN on, no VSD   → target 1                      (unchanged: every legacy pump)
RUN on, VSD      → target clamp(SPD/100, min, 1) (the only new branch)
```

**Two rates, and the distinction is physical rather than convenient.** `RAMP_S`
is the *drive* changing the shaft, so it governs any commanded change while
energised — up or down. `COAST_S` is *nothing* driving it: a de-energised shaft
freewheeling. Using the drive rate for a commanded slow-down is a **stated
assumption**; no record in this model carries a deceleration time.

There is **no PID speed loop**. §7 says not to create one to demonstrate the
feature, and no existing controller commands pump speed. Operator and scenario
are the command sources.

### Actual versus command

Ask a running machine for 30 % and one second later the shaft is still above
0.3 and the plant is still running at the shaft — the head at that instant is
strictly between the full-speed and final values. The solver reads `RAMP`; it
has never read `SPD` and does not now.

### Causal chain

```text
operator / scenario ─► SPD ─► speedTarget(clamped to turndown)
                                  ↓
                       existing shaft dynamics (RAMP_S / COAST_S)
                                  ↓
                        RAMP  ─► pumpHead(duty, RAMP, Q)   ← unchanged curve
                                  ↓
                            solveHydraulics
                                  ↓
          pressures · SIGNED flows · FT · PT · inventory · alarms · history
```

FT and PT track *their own* solved quantities within the instrument's 0.8 %
band at 100, 70, 40 and 20 %, and a 63 % command never appears as a reading.

### Invalid commands

| | |
| --- | --- |
| `NaN` / `Infinity` | ignored — the machine stays at rated, **not** at zero, and nothing downstream becomes non-finite |
| below turndown | **held** at the limit; the command still reads what was asked, so the clamp is visible rather than silent |
| speed on a **fixed-speed** machine | refused by name — *"has no variable speed drive on its record"* — and behaviour does **not** switch on |
| outside the stated range | reported, held at the nearest end |
| `duty.minSpeed` without `duty.vsd` | `pump-speed-config`, `warning` — a turndown with no drive to turn down |
| unreadable or out-of-range turndown | same rule |

### Gate

```text
3410 tests passing · 7 skipped · 0 failing      (+23)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

Every pre-existing test passed unchanged the moment the shaft-target change
landed, which is the backward-compatibility claim in its strongest form: no
fixed-speed machine anywhere moved.

### Limitations

- **No automatic speed control.** No controller commands speed; that would be a
  new loop and a new tuning question.
- **No deceleration time on the record** — the drive's ramp rate is used for
  both directions, stated as an assumption.
- **No speed above rated.** The curve is not defined there.
- **No motor data** — no efficiency, no power draw, no minimum-flow protection.

## K13 — pump operating envelope

K12 made the shaft commandable and closed with the obvious next question: a
VSD with no protection layer is half a feature. So before anything commands
speed automatically, the simulator has to be able to say **when a machine is
being run somewhere the model cannot stand behind**.

### What the engineering model already held — the inventory, first

| Concept | Where it lives | Status before K13 |
| --- | --- | --- |
| rated flow | `duty.capacity` → `ratedFlowM3h` | present, **defaults to 50 m³/h** |
| rated head | `duty.head` → `headBar` | present, **defaults to 4 bar** |
| shutoff head | *derived*, `shutoffFromDuty(headAtRated)` | not a field, and should not be |
| runout / maximum flow | *derived*, `RUNOUT_FACTOR × rated × r` | not a field, and should not be |
| driver power | `duty.power` → `powerKw` | present |
| rated speed | `duty.speed` | present as **text**; nothing reads it |
| variable speed | `duty.vsd`, `duty.minSpeed` | K12 |
| **minimum flow** | — | **absent. Nothing in the model held one.** |
| pump status | `RUN`, `RAMP`, `FAULT` runtime tags | K11/K12 |
| protection fields | — | **absent, and still absent after K13** |

Two of those are load-bearing for everything below.

**`ratedFlow` and `head` FALL BACK to simulator defaults.** An unspecified pump
still turns, at 50 m³/h and 4 bar, so that a demo screen moves. That is fine
for a demo and fatal for a limit: a minimum flow computed as a percentage of
rated capacity would, on most drawings, be a percentage of a number the
simulator made up. It would look like engineering data and be nothing of the
kind.

**Maximum flow was deliberately NOT added as a field.** Runout is already
defined by the curve at `1.5 × rated × r`. A separate maximum-flow field would
be a second statement of the same physical fact, free to contradict the first.

### Three concepts, kept apart

```text
A  HYDRAULIC OPERATING POINT   Q, the pressures either side, the head
                               the curve makes at the shaft speed reached
                                    ↑ the solve decides all of it
B  ENGINEERING ENVELOPE        the region the RECORD says it may be run in
                                    ↑ one number: duty.minFlow
C  PROTECTIVE ACTION           what the plant does about a violation
                                    ↑ K13 does NONE of this
```

`sim/envelope.ts` reads A, compares against B, and performs no C. Nothing in it
writes a tag, stops a machine or changes a flow — and a test runs a machine
dead-headed for sixty seconds and asserts it is still running, still commanded
and still un-tripped. **A minimum-flow trip is a real piece of plant equipment
with a setting and a time delay.** Inventing one because real plants usually
have one is exactly the fabrication this programme exists to remove.

### The one new engineering field

| Field | Meaning |
| --- | --- |
| `duty.minFlow` | Minimum continuous flow, below which the machine should not be run |

Read through the existing `FLOW` table, so `5 m³/h`, `1.4 l/s` and `22 gpm` all
work. **Never defaulted.** `ratedFlow` above falls back so a demo pump turns;
this falls back to nothing, because a limit nobody stated is not a limit.

### No invented thresholds either

| Question | Answer | Where it comes from |
| --- | --- | --- |
| "is it turning?" | `shaft > 0` | the exact test `pumpFlow` itself uses |
| "is anything moving?" | `|Q| ≤ SHUT_LEAK_MAX` | the solver's own published ceiling on what a BLOCKED element passes — a constant that exists so a caller can say "nothing is moving" precisely |
| "is it making head?" | `P_discharge − P_suction > 0` | the solved pressure field |

Not one number in this phase was chosen for convenience.

### The states, in precedence order

```text
UNKNOWN              the solve cannot stand behind the numbers
STOPPED              the shaft is at rest
REVERSE FLOW         fluid coming BACK through a turning machine
DEAD-HEAD            turning, making head, passing nothing
BELOW MINIMUM FLOW   below the minimum the RECORD states
LIMIT UNKNOWN        running forward, and no minimum is stated
NORMAL               running forward, at or above the stated minimum
```

`UNKNOWN` is the same question a measurement gets, asked of the pump's own two
nozzles: `faultOfNodes` was split out of `processFaultOf` so the two bindings
share one rule rather than growing a second opinion about when a number can be
trusted.

### Signed, throughout

The pump edge runs suction → discharge, so **positive is the machine doing its
job and negative is fluid coming back through it.** No `Math.abs` stands
between the solve and the verdict.

Measured, with the discharge boundary held at 10 barg: the envelope reports
**−29.2 m³/h and REVERSE FLOW**, while the flow transmitter on the same line
reads **+29.2 m³/h** — because a flow element does not know which way round it
was installed, and this is exactly why §11 requires the diagnostic to read the
solved quantity rather than the instrument.

The faceplate's pump flow now comes from the machine's own signed edge rather
than the branch magnitude it used before, for the same reason.

### Causal chain

```text
operator / scenario ─► SPD ─► speedTarget ─► shaft dynamics ─► RAMP
boundary signal / scenario ─► terminal pressure
valve command ─► POS ─► resistance
                              ↓
                       solveHydraulics          ← unchanged
                              ↓
        SIGNED pump-edge flow · node pressures · convergence flags
                              ↓
                  pumpEnvelopes(model, defs, tags, solve)
                              ↓                   ↑
                              ↓            duty.minFlow, duty.minSpeed
                              ↓             (engineering record, read-only)
                     envelopeFindings ─► faceplate line · Diagnostics LIVE block
```

### What the boundary sweep measures

Holding BL-D progressively higher against a 40 m³/h, 35 m machine at full
speed:

| BL-D | Q, m³/h | head, bar | state |
| --- | --- | --- | --- |
| 1 barg | 43.2 | 2.98 | NORMAL |
| 3 barg | 35.5 | 4.02 | NORMAL |
| 5 barg | 25.6 | 5.05 | NORMAL |
| 6.5 barg | 14.3 | 5.83 | NORMAL |
| 7 barg | 7.3 | 6.09 | BELOW MINIMUM FLOW |
| 8 barg | −15.7 | 6.60 | REVERSE FLOW |
| 10 barg | −29.2 | 7.64 | REVERSE FLOW |

The machine is pushed back along its own curve by the plant in front of it.
**The test asserts the ORDER of the states and the monotonicity, never the
pressure at which each appears** — that is the solve's business, and writing it
down would be a second model of the same thing.

### Diagnostics

| Finding | Severity | Fires when |
| --- | --- | --- |
| `pump-deadhead` | `error` | turning, making head, passing nothing |
| `pump-reverse-flow` | `error` | flow negative through a turning machine |
| `pump-below-min-flow` | `warning` | below the **stated** minimum |
| `pump-speed-out-of-envelope` | `warning` | speed COMMAND outside the declared drive range while the shaft is held at the nearest end |
| `pump-min-flow-unknown` | `info` | running forward, no minimum on the record |
| `pump-min-flow-config` | `warning` (Checks) | a stated minimum that is unreadable, negative, or at/above the machine's own **stated** capacity |

Severity is the existing `DiagnosticSeverity`; no new hierarchy. Each message
carries TAG, condition, actual, limit-if-known and source, e.g.

```text
P-1  is below minimum flow. Actual 0.3 m³/h, minimum 10.0 m³/h.
     Source: engineering record.

P-1  minimum-flow limit unavailable. The simulator cannot determine whether
     0.1 m³/h is below the manufacturer's minimum; no "Minimum flow" is
     stated on its record.
```

`pump-min-flow-config` checks against a **stated** `duty.capacity` only —
reporting a drawing against a simulator default would be reporting it for
something it never said.

### One finding that was NOT implemented

`pump-speed-out-of-envelope` as a *hydraulic* condition. A VSD's steady shaft
can never sit below its declared turndown: K12 clamps the target to the floor,
so the only way below it is a ramp, and a ramp is not a violation. The
finding exists only for the **command**, which genuinely can be asked for
something the drive will not do. Nothing else in §6's candidate list is
supported by data this model holds.

### Operator presentation

No new page. One line on the pump faceplate —

```text
Actual speed        42 %
Speed command       40 %
Flow              1.1 m³/h
Operating envelope  BELOW MINIMUM FLOW
Minimum flow      10.0 m³/h
```

— and one block at the top of the Diagnostics page's **LIVE** section, in the
vocabulary that page already uses. It is on Live rather than Engineering
deliberately: the record is not wrong, the machine is being operated somewhere
the record cannot vouch for, and mixing the two would make a configuration list
blink as the plant ran.

**A colour is a severity.** NORMAL, STOPPED, LIMIT UNKNOWN and a drive mid-ramp
all read in the ordinary text tone; the alarm palette is reserved for the two
conditions that earn it. A test asserts a machine one second into a speed
change reads NORMAL with no severity at all.

### Gate

```text
3456 tests passing · 7 skipped · 0 failing      (+46)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### Limitations

- **Detection only.** Nothing trips, stops or recirculates. No protective
  action exists because no engineering field defines one.
- **Minimum flow is the whole envelope.** No maximum continuous flow, no
  preferred operating region, no allowable operating region, no NPSH margin as
  an envelope bound — the data for none of them is in the model.
- **No time delay.** A violation is reported the instant the solve shows it. A
  real minimum-flow trip has a delay, and a delay is a setting nobody stated.
- **Most records state no minimum flow**, so most machines report `LIMIT
  UNKNOWN`. That is the honest reading of an empty field, not a gap in the
  detection.
- **No temperature-rise or recirculation model.** The consequence of running
  below minimum flow is not simulated; only the condition is reported.
- **`duty.speed` is still text nobody reads.** Speed is a fraction of rated
  throughout; there is no rpm anywhere in the runtime.

## K14 — closed-loop speed control

K12 made the shaft commandable. K13 made the envelope visible. K14 closes the
loop: **a pressure controller that reads the transmitter an operator reads and
commands the speed of the machine making that pressure.**

### The existing controller was reused. No second algorithm exists.

`step()` has carried a PI with conditional-integration anti-windup and bumpless
transfer since before this programme began. K14 adds three things to it and
changes none of its behaviour for any loop that existed before:

| Added | Why |
| --- | --- |
| `outKind: 'pump'` | an output destination — `SPD`, never `RAMP` |
| `outMin` / `outMax` | an output RANGE. Defaults 0 and 100, which is every pre-K14 loop |
| `SPEED_TUNING` | a tuning entry of its own. **Nothing in `TUNING` was touched** |

```text
Kp        1.8   (dimensionless: % output per % of PV SPAN)
Ki        Kp/Ti = 0.15 %/s per % of error
Kd        none. The algorithm is PI and remains PI
sample    the simulation timestep. No second clock, no second rate
limits    [duty.minSpeed, 100] on a speed loop; [0, 100] on everything else
windup    conditional integration — I is frozen while the output is
          saturated in the error's direction. Unchanged, now against the
          loop's OWN limits rather than a hard-coded 0-100
```

### Wiring: the topology, not the tag

A pump does not share a loop number with its controller the way `PIC-101` and
`PV-101` do — and `P-101` collides with `PIC-101` on family+loop, which is the
accidental pairing `wireControllers` already guards against. So the machine is
found the way `wireHeaters` finds a heater: **by asking what produces the thing
being measured.**

Asked of the **K7 hydraulic topology**, not the branch projection — the branch
model predates K7 and still counts a battery-limit terminal among a path's
`pumps`, which is exactly the wrong answer. `speedLoopCandidate` walks out from
the measured pipe **without crossing a pump**, which gives precisely the
pressure zone the transmitter sits in, and then asks whose discharge is in it.
Discharge side → `action +1`; suction side → `action −1`, because a faster
machine pulls its suction down.

**A valve in the loop still wins.** A plant that drew `PIC-101` with `PV-101`
is controlling pressure by throttling, and K14 does not take that away.

**Capability is still declared.** The topology finds the machine; `duty.vsd`
decides whether it may be driven. A fixed-speed pump is left alone and
`pump-speed-no-drive` (`warning`) says so — the check calls the same
`speedLoopCandidate` the wiring does, so it cannot disagree with what it checks.

### The loop, and the one-tick latency

```text
SP ─► error (normalised by the PV's SPAN) ─► PI ─► OP
                                                   ↓
                                                  SPD          ← command
                                                   ↓
                                   shaft dynamics (RAMP_S 2 s)
                                                   ↓
                                                  RAMP         ← actual
                                                   ↓
                                      pumpHead(duty, RAMP, Q)  ← unchanged
                                                   ↓
                                            solveHydraulics    ← unchanged
                                                   ↓
                                       node pressure ─► PT-1 PV
                                                   ↓
                                        (NEXT TICK) controller
```

**K11's one-tick measurement latency is preserved and is load-bearing.** The
controller reads `tags[pvTag].PV` at the top of the step, before the solve that
produces this tick's reading. Measured, on a step disturbance:

```text
before      PT 2.998    PIC.PV 2.998    OP 72.77
tick N      PT 3.453    PIC.PV 2.998    OP 73.18   ← still the OLD reading
tick N+1    PT 3.926    PIC.PV 3.453    OP 64.31   ← consumes tick N's, reacts
```

The controller's input is the **transmitter**, noise and all — not the clean
solved node it was derived from, not the pump's head, not the boundary.

### One writer of SPD

In AUTO **and** in MANUAL the controller is the only thing that writes `SPD`,
and the pump's faceplate disables its speed control while a loop owns the
machine, naming the loop. An operator write straight at a controlled machine
does not survive a tick, and the screen no longer offers one.

| Mode | Who decides `SPD` |
| --- | --- |
| AUTO | the PI, from SP and the measured PV |
| MANUAL | the operator, through the controller's own OP |

**Bumpless both ways, and both measured:**
- AUTO → MANUAL holds the output *exactly* (72.77277289 → 72.77277289).
- MANUAL → AUTO resumes from the speed the plant is at — 40.0 → 41.3 %, the
  proportional term and nothing else, because the integrator tracks
  `I = OP − Kp·e` throughout MANUAL.
- **At RESET and at RUN**, a speed loop is seeded from the machine's own rest
  command (100 %), not from `OP: 0`. A drive's rest state is rated speed, not
  stopped; seeding at zero would hand the first MANUAL frame a command to stop
  a machine nobody asked to slow down.

### Tuning: measured, not chosen

Tuned against the fixture in `tests/hmi/speedControl.test.ts` by finding where
the loop goes unstable and backing off.

**Process gain, measured:** 15 % of output moved the transmitter 0.62 bar on a
10 bar span — about 0.4 % of span per % of output.

| Kp | Ti | step 2.6→3.2 bar | step 2.3→3.6 bar | |
| --- | --- | --- | --- | --- |
| 1.2 | 25 | 188 s, no overshoot | 234 s, no overshoot | sluggish |
| **1.8** | **12** | **64 s, 9 % overshoot** | **102 s, 5 % overshoot** | **chosen** |
| 2.5 | 8 | 42 s, 17 % overshoot | 209 s, 12 % overshoot | degrading |
| 3.5 | 6 | never settles, 116 % overshoot, 1.46 bar swing | | **UNSTABLE** |

3.5 is the sample-rate limit cycle the `TUNING.pressure` comment warns about,
**reached here rather than assumed**. 1.8 sits at roughly half that gain — an
ordinary gain margin — and the settled spread it leaves, 0.11 bar, is the
transmitter's own 0.8 %-of-span noise rather than the loop hunting. `Ti` is an
order above the drive's 2 s lag on purpose: an integrator faster than the
actuator chases a shaft that has not arrived.

Checked at dt = 0.2 s as well as dt = 1 s (64 s and 63 s to settle), so the
numbers are not an artefact of the step the tests integrate at.

**The tuning TARGET is written down in the test file** — stable, overshoot at
most a fifth of the step, no sustained oscillation, settled inside 150 s and
inside the measurement noise — so it can be re-measured rather than taken on
trust. These are a starting point for a training simulation and **not a claim
about any real plant**: loop gain here depends on the duty point, the valve
resistance and the boundary pressures, all of which differ per plant.

### Disturbance rejection — the proof the loop is genuinely closed

Settled at SP 3 bar, then K10 moves the battery limit the machine discharges
into from 1 barg to 2.5 barg. Nothing tells the controller; it can only find out
through its transmitter.

```text
settled          PV 3.01    OP 91.7 %
+1 tick          PV 4.20    ← disturbed, and the loop has not seen it yet
+300 s           PV 3.00    OP 62.3 %   ← slowed the machine, pressure back
```

A valve disturbance is rejected the same way.

### Saturation, exposed rather than implied

`SAT` is +1 at the top of the loop's travel, −1 at the bottom, 0 between, and
the controller faceplate says **AT MAXIMUM** / **AT MINIMUM**. An output resting
at 100 % is either a satisfied loop or one that has run out of machine, and only
the second means the setpoint is unreachable.

| Condition | Result |
| --- | --- |
| SP 9 bar (above what the plant can make) | OP 100 %, `SAT +1`, `I` clamped at 100 and **stops there** |
| SP 0.5 bar (below what the drive will run at) | OP 20 % — the record's own turndown — `SAT −1`, `I` held at 38 rather than unwinding to −100 |
| ten minutes hard against the stop, then SP 2.6 | back on setpoint within 150 s |
| **no `duty.minSpeed` stated** | floor is **0**. No turndown is invented |

### Operating envelope — K13 is not suppressed

K13 detects; K14 controls. A controller that drives its machine below the
stated minimum flow is **not excused**: the envelope reports `BELOW MINIMUM
FLOW` exactly as it would if an operator had done it, and K14 does **not** trip,
throttle or otherwise act on it. With no `duty.minFlow` stated the state stays
`LIMIT UNKNOWN` — a controller manufactures no constraint the record does not
carry.

### History

A driven machine now trends **both** speeds: `P-1.SPD` (the command, whoever
asked) and `P-1.RAMP` (the shaft, scaled to per cent so they share an axis),
beside the controller's existing `SP`, `PV` and `OP`. Trending only the command
would make a drive look instantaneous; trending only the shaft would hide who
asked for what. The command does not replace the actual.

### Gate

```text
3504 tests passing · 7 skipped · 0 failing      (+48)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### Limitations

- **One loop type.** Pressure → speed only. Flow → speed is the same machinery
  and was deliberately not built in the same phase.
- **One machine per loop.** No parallel-pump staging, no lead/lag, no cascade.
- **PI, not PID.** There is no derivative term in this codebase and K14 did not
  add one.
- **The gains are this fixture's.** A different duty point or boundary pressure
  needs different numbers, and nothing here discovers them.
- **A controller's default setpoint is still 50**, which is off-scale on a
  0–10 bar loop until an operator sets one. Pre-existing, and left alone
  because retuning or reseeding existing controllers is out of scope here.
- **No output rate limit.** The controller may step its command as far as it
  likes in one tick; the drive's own ramp is what softens it.
- **No protective action**, still. K13's envelope is reported and K14 does not
  act on it.

## K15 — controller calm-start, and flow → speed

K14 closed by naming the defect it had just made dangerous, and K15 fixes it
before adding anything. Then it adds one more loop type on the same machinery.

### Part 1 — the setpoint nobody set

**Where 50 came from.** `initTags` seeded every controller with `SP: 50` — the
middle of the 0-100 span every tag inherited before ranges became engineering
data. It survived the ranges. On a 0-10 bar loop it asks for five times full
scale, and a K14 speed loop obeys it: machine to 100 %, saturated, and a plant
moving because of a number nobody chose.

**What was already there and was being dropped.** `signal.setpoint` is a real
field on an instrument record, and `engineeringFor` has read it into
`SignalEngineering.setpoint` since the datasheet work. It was **never carried
onto the `TagDef`**, so the runtime could not tell a *configured* setpoint from
a *defaulted* one. That is the whole defect: the distinction existed in the
engineering model and did not survive the crossing into the simulation.

**Precedence, and it is the existing architecture's:**

```text
1  a RUNTIME WRITE      operator, or a scenario — K8 routes both through the
                        same write path on purpose. Last write wins, as a DCS
                        does. Nothing at RUN can reach it.
2  signal.setpoint      the RECORD. Never replaced by the plant's state, at
                        RUN or at RESET. A stated 0 is a setpoint, not an
                        absence.
3  CALM START           the loop's own measurement. Error zero, output held,
                        nothing asked to move.
4  NOTHING              a PV bound to nothing the simulation produces has no
                        reading and no record. SP is UNAVAILABLE, the
                        algorithm does not run, and the plate shows no number.
```

Step 3 reads the PV **after** `initTags` seeds the bound transmitters, so it is
the solved value rather than the span midpoint the tag was created with. The
controller's own `PV` is seeded the same way, so a loop no longer shows 0 until
its first tick.

**Step 4 is why `?? 50` is gone from `step()` as well.** A loop with no setpoint
holds its output rather than acting on a number that was never a setpoint, and
the faceplate shows an empty field with `title="…nothing to aim at"` — still
enterable, because the operator's first act is to give it one.

**An impossible setpoint is still accepted.** A record stating 50 bar on a 0-10
bar loop is used as stated, saturates at 100 %, exposes `SAT +1`, keeps
anti-windup, and manufactures no pressure. `controller-setpoint` (`warning`)
reports it; **nothing clamps it.**

#### What the calm start exposed, and what was not hidden

With loops no longer pinned against a stop by a fictitious setpoint, a loop
sitting **on** setpoint with a noisy transmitter and no process authority — a
pressure loop on a plant whose pump is stopped — **integrates on noise**. The
lower output stop blocks the downward half of the noise and the integrator
ratchets up: measured on the `runtimeHydraulic` fixture, 0.3 % of output at
20 s and 21 % at 36 minutes.

That is what a PI does in AUTO on a plant it cannot affect, it predates K15,
and it is recorded as a K16 finding rather than patched with a deadband.
`runtimeHydraulic.test.ts`'s calm-start assertion moved from 6 to 5 decimal
places for it — with the OLD/NEW/PHYSICAL REASON written into the test — while
its actual subject, *no pipe above `SHUT_LEAK_MAX`*, is untouched.

**Four existing tests now state the setpoint they always meant** (`SP = 50`),
rather than inheriting it. Each one's own name said so already — "holds level
at **SP**", "PV stuck below **SP**".

### Part 2 — flow → VSD speed

#### The binding, and why K14's rule could not be reused

`speedLoopCandidate` walks a **pressure zone**: everywhere reachable without
crossing a pump. Right for pressure, which is shared across a junction. **Wrong
for flow, which divides at one** — a transmitter past a tee reads a fraction of
the machine's output, and a loop built on it controls something it cannot see
the whole of.

`flowLoopCandidate` walks **the machine's own stream** instead: out from its
discharge and back from its suction, node by node, stopping at the first thing
that makes the flow no longer the pump's — a branch, a vessel, a battery limit,
another machine. If the transmitter's edge is on that walk, it carries every
cubic metre the machine passes and nothing else.

Asked of the **K7 hydraulic topology**. No coordinate, no drawing order, no
nearest-anything: a test moves the whole P&ID by 4000 × 2500 units and the
binding is identical.

| Case | Result |
| --- | --- |
| FT on the discharge line | bound to `P-1` |
| FT on the suction line | bound to `P-1` — it is one stream |
| FT past a tee | **no candidate.** The loop is not wired |
| FT between two machines in series | `ambiguous`, reported, not wired |
| machine with no `duty.vsd` | refused, `pump-speed-no-drive` |

#### Orientation — the gap, stated

**The instrument's installed orientation is not in this engineering model.**
`measurementOf` takes the magnitude and documents why: a flow element does not
know which way round it was fitted, and no record here states it. That gap is
real and is not filled with a guess.

What the loop needs is not the instrument's orientation but **the sign of the
controlled stream**, and the walk produces it for free — each step knows whether
it left a node by the edge's `from` end or its `to` end. So `sense` is a
topological fact:

- a line drawn with the flow → `sense +1`
- **the same line drawn backwards** → `sense −1`, and the loop behaves
  identically, because the transmitter reads a magnitude and the stream is the
  same stream.

Where the solved sign contradicts `sense`, K13 already says so on the machine
itself — `pump-reverse-flow`. No second mechanism was built for it.

#### Action, measured rather than inherited

Open loop, in MANUAL, output walked across its range:

| output | 20 % | 40 % | 60 % | 80 % | 100 % |
| --- | --- | --- | --- | --- | --- |
| FT | 8.82 | 17.31 | 26.00 | 34.39 | 43.05 m³/h |

More speed is more flow, monotonically, from either side of the machine. So
`action = +1` — and it is asserted from that table, not assumed because K14's
was +1.

#### Tuning — a third entry, and the reason it had to be

**0.71 % of span per % of output**, nearly twice the pressure loop's 0.4 %, and
very nearly a straight line because **capacity goes as speed where head goes as
speed squared.** Reusing K14's `kp = 1.8` puts the loop gain at 1.28 and it does
exactly what that means:

| Kp | Ti | step 20→30 m³/h | step 15→38 m³/h | |
| --- | --- | --- | --- | --- |
| 1.8 | 12 | never settles, 112 % overshoot, 22 m³/h swing | | **UNSTABLE** |
| 1.3 | 12 | 299 s, 17 % overshoot | 299 s, 6 % | degrading |
| **1.0** | **12** | **102 s, 5 % overshoot** | **112 s, 2 %** | **chosen** |
| 0.8 | 12 | 102 s, 3 % | 112 s, 1 % | fine, slower |
| 0.7 | 16 | 131 s, 3 % | 188 s, 1 % | sluggish |

1.0 puts the loop gain at 0.71 — the same margin K14 settled on, 1.8× below
where this fixture goes unstable. Checked at dt = 0.2 s as well as 1 s.
`ti` is shared with `SPEED_TUNING` because the dominant lag is the **drive's**
2 s ramp, not the process: the hydraulics are quasi-steady.

**`TUNING` was not touched.** Its entries are indexed by what a loop MEASURES;
these two are indexed by what a loop DRIVES, which is a different question.

#### Where one fixed gain stops working — pinned, not hidden

Hold the discharge boundary at 2.5 barg and the machine faces 1.5 bar of
adverse head. It makes `6.18·r²` bar of shutoff head, so below about half speed
it delivers nothing and just above it the flow rises almost vertically. The
process gain there is several times what the loop was tuned for, and the result
is a **limit cycle** — measured between 3.4 and 37.6 m³/h on a ~50 s period.

A test asserts exactly that: it hunts, and it hunts **boundedly** — every value
finite, inside the instrument span, output inside its limits, integrator inside
its clamp, solve still converged. This is not a defect in the loop, the solver
or the drive. It is what a single fixed gain means on a centrifugal machine,
and the honest thing is to record where it stops working rather than tune the
fixture until the boundary never moves.

#### Step response and disturbance rejection

Steps of 20→30, 30→20 and 15→38 m³/h all settle inside 150 s with under 20 %
overshoot and a settled spread at the transmitter's noise floor. A test walks
the whole chain — output, `SPD`, `RAMP`, pump head, solved flow, FT — and
checks each moved, with command and shaft still tens of per cent apart one
second into a ramp.

Disturbances, neither of which the controller is told about:

| Disturbance | Kicked to | Recovered |
| --- | --- | --- |
| HV-9 100 % → 70 % | below setpoint | back to 25.00, output up 10 points |
| BL-D 1 barg → 1.8 barg | below setpoint | back to 25.00, shaft faster |

#### Saturation

| Condition | Result |
| --- | --- |
| SP 55 m³/h (unreachable) | OP 100 %, `SAT +1`, `I` clamped at 100 and held |
| SP 3 m³/h (below turndown) | OP 20 %, `SAT −1`, `I` held at 28 rather than unwinding |
| no `duty.minSpeed` stated | floor is **0**. None invented |
| fifteen minutes on a stop, then SP 25 | back on setpoint inside 200 s |

#### One controller per drive

Two loops writing one machine's `SPD` is a race decided by iteration order.
K15 **unwires both** rather than picking a winner — there is no defensible rule
for which loop owns a machine — and `pump-speed-contended` (`critical`) names
both loops and the machine. Both keep tracking their own measurements; the
machine sits where K12 puts a running drive. **Cascade is the real answer and
is deliberately not this phase.**

### Diagnostics added

| Finding | Severity | Fires when |
| --- | --- | --- |
| `pump-speed-contended` | `critical` | two loops would command one drive |
| `controller-setpoint` | `warning` | a stated setpoint outside the loop's range, or a wired loop with neither a record nor a bound PV to start one from |
| `pump-speed-no-drive` | `warning` | extended: now covers a FLOW loop on a fixed-speed machine, and an ambiguous stream |

Each check calls **the same function the wiring uses**. A check that
re-derives a binding is a check that drifts away from what it is checking.

### History

A flow loop trends `SP`, `PV`, `OP` beside the machine's `SPD` and `RAMP`,
exactly as a pressure loop does. Nothing about the pressure loop's history
changed.

### Gate

```text
3564 tests passing · 7 skipped · 0 failing      (+60)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### Limitations

- **Two loop types, one machine each.** Pressure → speed and flow → speed. No
  cascade, no parallel-pump staging, no lead/lag — and a machine claimed by two
  loops is refused rather than arbitrated.
- **One fixed gain per loop type**, and the flow loop's is more
  plant-dependent than the pressure loop's: it is set by the machine's rated
  capacity and by the resistance in front of it. A 400 m³/h machine on the same
  instrument span would need a tenth of it. The failure mode is pinned by a
  test rather than described.
- **A flow element carries no installed orientation** in this engineering
  model. The controlled stream's sense is derived from the topology instead.
- **PI, not PID.** Still no derivative term anywhere.
- **No output rate limit.** The drive's own ramp is the only thing softening a
  step.
- **A loop at setpoint with no process authority integrates on measurement
  noise** — reported, not patched.
- **The bundled demo template carries no `signal.setpoint`**, so its level loop
  now calm-starts and holds the level it finds until an operator asks for one.

## K16 — control authority

K15 closed by naming what its own calm start had exposed. K16 fixes it, and
fixes nothing else.

### The defect

A PI loop with a noisy transmitter and nothing it can do about the process
**integrates the noise.** Conditional integration freezes the integrator at a
stop only when the error pushes *further* into it, so at the lower stop the
downward half of the noise is blocked and the upward half is not. It ratchets.

Measured on the `runtimeHydraulic` fixture with its pump stopped throughout:

```text
t = 20 s      output 0.3 %
t = 36 min    output 21 %      ← a calm screen opening its own valves
```

### What is derivable, and what is not

The honest question — *"would moving this actuator change this measurement?"* —
**cannot be answered from runtime state and topology.** Answering it properly
means solving a hypothetical network, and a hypothetical network is invented
physics. So K16 answers the narrower question the runtime actually states:

| # | Condition | Source |
| --- | --- | --- |
| 1 | no final element is bound | `ControllerSpec.outTag` |
| 2 | the element's tag is not in the runtime | `tags` |
| 3 | a DRIVEN actuator — pump, heater — is not energised | `RUN`, `FAULT` |
| 4 | an actuated valve is stuck | `STUCK` |
| 5 | the solve behind the measurement cannot be trusted | `processFaultOf` |
| 6 | **the machine the MEASUREMENT depends on is de-energised** | `RUN`, `FAULT` |

**(6) is the one that is sound rather than inferential.** A pressure or flow
transmitter on a machine's own stream reads what that machine is making, and
**a stopped pump BLOCKS** — that is K3.3's check-valve assumption, already in
the model and already written down, not a new claim. So with that machine
de-energised, nothing on its stream can move and no output can change what the
transmitter reads. The machine is the one `speedLoopCandidate` and
`flowLoopCandidate` already identify; `ControllerSpec.pvDriver` carries their
answer rather than asking a second time.

(5) is judged against the **previous** solve — the one that produced the
reading being acted on. `TickOptions.prevSolve` exists for that and for nothing
else; judging this tick's would break K11's one-tick latency.

### What happens when there is none

**HOLD.** The output and the integrator stay exactly where the plant left them.
Not reset, not zeroed, not decayed — so when authority returns the loop resumes
from the state it had rather than from a number manufactured while it was
blind.

Everything else is untouched: the PV still updates, the one-tick latency is
unchanged, the output limits still apply, no gain moved, and **there is no
deadband anywhere.** A deadband would also stop the loop responding to a real
error of the same size, which is a separate control-design decision.

```text
regulating        AUTH 1  available     OP 73.441  I 73.327  SPD 73.4
STOP        +1 s  AUTH 0  de-energised  OP 73.441  I 73.327  RAMP 0.401
           +30 m  AUTH 0  de-energised  OP 73.441  I 73.327  RAMP 0.000
RUN         +1 s  AUTH 1  available     OP 93.263  I 74.860  RAMP 0.500
          +300 s  AUTH 1  available     OP 72.946  I 73.350  PV 3.022
```

Held **to the bit** for thirty minutes. On restoration the integrator moves by
one ordinary step — 73.327 → 74.860 — not by half an hour of accumulated noise,
and the output's jump to 93 % is the PROPORTIONAL term answering a real 1 bar
error. **36 minutes of no authority now move the output by exactly 0.**

### Authority is not saturation

| | |
| --- | --- |
| **saturated** | the loop is WORKING and has run out of range. The setpoint is not reachable. |
| **no authority** | the loop is not working at all. Nothing is trying. |

`SAT` is **cleared** while authority is unavailable, deliberately: an output
resting at a limit it was never allowed to leave is not a saturated output, and
conflating the two tells an operator the setpoint is unreachable when the truth
is that a pump is stopped. A test drives a loop to `SAT +1`, stops the machine,
and asserts the output still reads 100 % while `SAT` reads 0.

The existing anti-windup is untouched and still measured at both stops.

### Output tracking

`requested` is what the controller asked for; `actual` is what the actuator
became — a valve's stroked `POS`, a drive's shaft as a percentage. **Never the
command.** The snapshot is built at the END of the tick, after the actuators
have moved, so `actual` is where the actuator finished rather than where the
controller found it.

`tracking` is true while they differ by more than `DEV_LIMIT` — **the same
10 % a stuck valve's DEV alarm already uses. No new threshold was introduced.**

```text
steady          requested 97.4   actual 97.4    tracking false
+0.2 s of ramp  requested 56.5   actual 87.4    tracking true
+0.6 s          requested 67.8   actual 67.8    tracking false
stopped machine requested 73.4   actual  0.0    tracking true
```

A ramp is not a fault and carries no alarm; the state is shown, and that is all.

### Diagnostics

| Authority | Severity | Why |
| --- | --- | --- |
| `available` | — | a working loop is not a finding |
| `de-energised` | `info` | **a stopped pump is a NORMAL plant state.** Colouring it as a fault teaches operators to ignore the colour |
| `stuck` | `warning` | somebody has to do something |
| `unsolved` | `warning` | the reading is not worth acting on |
| `no-actuator` | `warning` | a configuration error |

MANUAL produces nothing — an operator holding an output is not a fault.
`tracking` produces nothing — a drive on its way somewhere is a ramp.

The message names the machine, not the actuator: a loop may drive a perfectly
healthy valve and still have no authority because the machine its *measurement*
depends on is stopped, and naming the valve would send an operator to the wrong
equipment.

```text
INFO  PIC-1 cannot reach the process: P-1 is stopped or tripped, and a stopped
      machine blocks its own line. Its output and integrator are held where the
      plant left them.
```

On the Diagnostics page's **LIVE** section beside K13's envelope block, for the
same reason: nothing about the records is wrong. One line on the controller's
own faceplate, in the muted tone for a stopped machine and the warning tone for
the two conditions that earn it.

### The unsolved path, measured

```text
C1 C1 C1 C1 X1 C0u C1 X1 C0u C1 X1 C0u …
            ^^  ^^^
            |   the NEXT tick reports `unsolved` and holds
            this tick's solve failed
```

`X` is a failed solve, `C0u` is authority 0 with reason `unsolved`. It always
appears exactly one tick after the failure — the one-tick latency, unchanged
and visible.

### Three existing tests corrected

Each asserted the defect, and each is documented in place with OLD / NEW /
PHYSICAL REASON:

- `temperature.test.ts` — *"a stopped heater delivers nothing however hard the
  controller asks"* asserted `OP ≈ 100`. **Calling for full duty was the
  defect, not the feature.** The heater still delivers nothing, which is what
  the test is about; the controller now holds and says it cannot reach the
  process.
- `calmStart.test.ts` — asserted `OP < 100`; the output is now HELD at its
  seed, which is the point.
- `pressure.test.ts` — a `toEqual` on the exact `ControllerSpec` shape, which
  gained `pvDriver`. Now `toMatchObject` plus an explicit `pvDriver` assertion:
  a wiring test should pin the wiring.

### What K16 does NOT fix, stated

A loop with **real** authority still moves its actuator with the noise, through
its own **proportional** term. `LIC-101` on the `runtimeHydraulic` fixture has
a gain of 6, so 0.4 % of span of measurement noise becomes ±2.4 % of valve
travel. That is ordinary proportional action on a noisy level, it **self-
corrects** — opening the drain lowers the level, which closes the drain — and
it is bounded. It is not the ratchet, and tuning it away would be retuning a
loop this phase was told not to touch.

### Gate

```text
3606 tests passing · 7 skipped · 0 failing      (+42)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### Limitations

- **Authority is the ACTUATOR PATH and the measurement's own machine**, not a
  general answer to "would this output change this reading". A valve loop whose
  region has no running machine but does have a vessel or a boundary
  differential still reads AVAILABLE, and correctly so — the network could
  carry flow. Deciding otherwise needs a hypothetical solve.
- **Proportional action on noise is untouched**, by design.
- **No mode change.** A loop with no authority stays in AUTO; K16 does not
  invent a third mode, and output tracking to the actuator's actual state —
  which would also address this — would change bumpless behaviour K14 measured.
- **Nothing trips.** Still.
- Carried: PI not PID, no output rate limit, no cascade, no protective action,
  no manufacturer data.

## K17 — cascade control

```text
PIC-1 (pressure) ─► FIC-1.SP ─► FIC-1 (flow) ─► P-101.SPD ─► shaft
  ─► pump curve ─► hydraulic solve ─► PT/FT ─► next tick
```

One cascade, on the runtime K12–K16 built. No control framework was written.

### The one rule, and how it is enforced

**The master does not touch the drive. Ever.** And `PIC-1 → P-101.SPD` is not
prevented by a check — it is **impossible by construction**:

```text
wireControllers  →  wireHeaters  →  wirePumps  →  wireFlowPumps  →  wireCascade
                                        │              │                  │
                          both SKIP any controller whose         connects the
                          record declares `signal.cascadeTo`     master to its
                                                                 SLAVE's setpoint
```

A declared master is never offered the drive by the two passes that hand out
drives, so its output has nowhere to go but the slave's setpoint — including
when the declaration turns out to be **unusable**, because a refused cascade
falling back to the drive would be exactly the shortcut this phase replaces,
and would put two writers on one machine.

`wireCascade` runs **last** because the checks it makes are about the slave —
*does it have a measurement, does it drive something, is that a variable speed
drive* — and those are only answerable once the slave is wired. Order decides
when the link is made; the skip decides that the master can never write a drive.

### Declared, never inferred

`signal.cascadeTo` on the **master's** record, naming the slave: *"my output is
that loop's setpoint."* Nothing else. Two loops that happen to measure the same
plant and reach the same machine are a **contention** — which K15 already
refuses and reports — not a hierarchy to guess at.

The K17 fixture proves it: it is exactly two such loops. **With** the
declaration it is a cascade; **without** it, K15 unwires both.

### Master OP ≡ Slave SP

The master's output is a per cent, as every controller's is. The slave's
setpoint is in the slave's own engineering units. The map between them is the
**slave's own configured range and nothing else**:

```text
slaveSP = slaveMin + (masterOP / 100) × (slaveMax − slaveMin)
```

**No limit is invented**, and the master's gain keeps meaning what it is
measured to mean because the algorithm still works in per cent throughout.
`drive()` is the one and only place a master's output goes, and for a cascade
it writes `SP`.

`outKind: 'cascade'` is what carries this. `ControllerSpec` needed three
fields — `cascadeTo`, `cascadeFrom`, `cascadeProblem` — and no new type.

### Execution order — one pass, one clock

`inCascadeOrder` sorts **masters before slaves**, once, at model-build time: a
master's output *is* the slave's setpoint, so the master must execute first or
the slave spends a tick chasing yesterday's demand. It is a sort of one list,
not a scheduler. There is still exactly one pass over the controllers, inside
the one step, on the one clock — and the whole runtime order is untouched:

```text
controllers → equipment/actuators → hydraulics → inventory → thermal
  → instruments → (store) quality → alarms → history
```

A slave's **PV** is still the previous tick's transmitter; only its **SP** is
this tick's. That is what a cascade is.

### The eight validations (§4)

| Check | Message when it fails |
| --- | --- |
| self-reference | *names itself as its own slave* |
| slave not a loop | *is not a control loop, so it has no setpoint to cascade onto* |
| slave not on the plant | *is not on this plant* |
| a cycle | *the cascade A → B → A is a loop* |
| slave has no PV | *has no measurement to control* |
| slave drives nothing | *drives nothing, so a setpoint sent to it would go nowhere* |
| slave's element is not a VSD | *drives X, which is not a variable speed drive* |
| slave has no usable SP range | *no usable setpoint range for a master output to be scaled onto* |

Exactly-one-writer is the eighth, and it is structural: `resolveContention`
still runs last and still unwires everyone claiming one drive.

### Modes

| Master | Slave | Behaviour |
| --- | --- | --- |
| AUTO | AUTO | the cascade. Master PI → slave SP → slave PI → drive |
| MANUAL | AUTO | the operator's master output becomes the slave's setpoint |
| AUTO | MANUAL | **the master HOLDS.** The slave's operator output drives |
| MANUAL | MANUAL | each operator number goes exactly where it should |

**The chosen master behaviour when the slave is not following is HOLD** — §9's
preferred architecture, and it is K16's mechanism with nothing added but a new
stated condition. `ControlAuthority` gained `'downstream'`: the slave is in
MANUAL, or has lost its own authority, so the master is talking to nobody. The
integrator and output are held exactly where the plant left them. **Not reset.
No deadband. No automatic mode change.**

Measured: master OP and `I` bit-identical across thirty minutes of a stopped
machine, and on restoration `I` moves by one ordinary step.

**No second mode system.** The slave being in AUTO *is* the cascade being in
service, which is the existing architecture and is why transfer is bumpless by
construction: the master writes the slave's setpoint on every tick whether the
slave is following or not, so a slave returning to AUTO comes back to a demand
it has been tracking rather than a stale one.

### Tuning — a fourth entry, and the reason it had to be

`TUNING` is indexed by what a loop MEASURES; `SPEED_TUNING` and
`FLOW_SPEED_TUNING` by what it DRIVES. A cascade master drives **another
controller**. Nothing above describes that, and **nothing above was touched**.

**Process gain, measured open-loop** — master in MANUAL, its output walked, the
slave holding each setpoint it was given:

| master OP | 20 % | 35 % | 50 % | 65 % | 80 % | 100 % |
| --- | --- | --- | --- | --- | --- | --- |
| slave SP | 12.0 | 21.0 | 30.0 | 39.0 | 48.0 | 60.0 m³/h |
| FT | 12.0 | 21.2 | 29.9 | 39.0 | 43.3 | 43.4 m³/h |
| PT | 2.144 | 2.435 | 2.901 | 3.523 | 3.856 | 3.864 bar |

0.31 % of the pressure span per % of master output, **and the slave tracks its
setpoint exactly** — which is the cascade working. Above ~72 % the machine runs
out and the **slave** reports `SAT`; nothing is invented to hide that ceiling.

**What actually constrains this loop is not the usual cascade rule.** The
received wisdom — *make the master several times slower than the slave* — does
not bind here, because the inner loop contributes almost no lag: the hydraulics
are quasi-steady and the drive covers its whole travel in two seconds. What
binds is the **master's proportional path**, which with no inner lag between it
and the plant closes a second loop at the sample rate:

| Kp | Ti | step 2.5→3.2 bar | step 2.3→3.5 bar | |
| --- | --- | --- | --- | --- |
| 1.2 | 10 | never settles, 100 % overshoot, 1.39 bar swing | | **UNSTABLE** |
| 0.8 | 10 | never settles, 100 % overshoot, 1.37 bar swing | | **UNSTABLE** |
| 0.5 | 5 | 53 s, 12 % overshoot | 60 s, 9 % | fast |
| **0.5** | **10** | **99 s, 12 % overshoot** | **123 s, 8 %** | **chosen** |
| 0.5 | 20 | 214 s, 12 % | 266 s, 7 % | slower |
| 0.3 | 10 | 166 s, 11 % | 214 s, 7 % | slower |

`Ti` moves the speed and barely touches stability; `Kp` decides it, and the
boundary is between 0.5 and 0.8. **0.5 keeps a gain margin of about 1.6 against
a limit cycle that was reached rather than assumed.** Settled spread 0.09–0.13
bar — the transmitter's own noise. Checked at dt = 0.2 s as well as 1 s.

The resulting loop gain is **0.16**, far below the 0.7 K14 and K15 chose, and
the table is why: those two had an actuator's lag between them and their plant.
This one has none.

### Setpoint limits (§7)

The master's output is scaled onto the slave's **configured** range, so
"limited" means it is sitting at an end of that range — which is `SAT`, already
computed, said in cascade terms as `cascade-setpoint-limited` (`info`). A
`cascade-invalid` finding covers the slave whose range is unusable. **Nothing
invents a minimum flow, a maximum flow, a pump limit or a safety limit.**

### Tracking (§10)

| | requested | actual |
| --- | --- | --- |
| slave | its controller output | the drive's **shaft**, `RAMP × 100` |
| master | `commandedSp`, in the slave's units | `effectiveSp`, the setpoint the slave carries |

Never called equivalent, and the snapshot is built at the END of the tick, so
the actuator's number is where it finished.

### Diagnostics

| Finding | Where | Severity | What it means |
| --- | --- | --- | --- |
| `cascade-invalid` | Checks | `critical` | **configuration**: the declaration cannot be built, and the master drives nothing |
| `downstream` authority | live | `info` | **runtime**: the slave is in MANUAL or cannot reach its process. A normal plant state |
| `cascade-setpoint-limited` | live | `info` | **limiting**: the master is at an end of the slave's configured range |

The three are exactly §11's required distinction, and a runtime unavailability
is never reported as a bad engineering record — a test asserts that a stopped
pump produces a live finding and **no** Checks finding at all.

### Causality, proved

A pressure setpoint step of 2.5 → 3.2 bar is asserted to move, in order:
master output → slave setpoint → slave output → speed command → shaft → pump
head → solved flow → FT → PT — and then to settle at 3.2 within the
transmitter's noise. Separately: the master's output can only reach `SPD`
through the slave (an operator writing the master's OP in MANUAL changes the
slave's SP, and the drive takes the slave's own number), and the slave is
reading its own transmitter one tick behind.

**Disturbances show what a cascade is for.** Throttle HV-9 from 100 % to 45 %:

```text
+1 s    FT 31.5 → 28.4    the slave sees it first
+3 s    slave OP 73 → 83  the inner loop defends its setpoint
+30 s   master OP 53 → 14 the outer loop asks for LESS flow — a closing valve
                          RAISES pressure, and pressure is what it controls
+400 s  PT back at 3.0
```

### Gate

```text
3653 tests passing · 7 skipped · 0 failing      (+47)
tsc -b clean · production build clean
207 Playwright passing · 2 failing — the SAME two as on a5b9793
```

### Limitations

- **One cascade topology**: pressure master → flow slave → VSD. No three-level
  cascade, no split range, no feedforward, no override selectors.
- **The master's gains are this plant's**, and this plant has an inner loop
  with essentially no lag — which is what forced a loop gain of 0.16. A plant
  with a genuinely slow inner loop would want the opposite treatment. The
  instability boundary is measured and written down rather than described.
- **No runtime cascade enable/disable of its own.** The slave's mode *is* the
  switch, deliberately, because a second mode system is what §5 forbids.
- **`cascade-setpoint-limited` is the slave's configured range and nothing
  else.** A narrower SP high/low limit would be a new invented field.
- **The master learns of its slave's state one tick late**, because masters run
  first — the same one-tick relationship every other controller input has.
- Carried: PI not PID, no output rate limit, no protective action, no
  minimum-flow protection, no manufacturer data.

---

## K18 — minimum-flow protection

```text
PIC-1 ─► requested FIC SP ─► MIN-FLOW OVERRIDE ─► effective FIC SP
  ─► FIC-1 ─► P-101.SPD ─► shaft ─► pump curve ─► solve ─► FT ─► next tick
```

The protective action K13 wrote down and refused. K13 kept three things apart —
the hydraulic operating point (the solve's), the engineering envelope (the
record's) and what the plant DOES about a violation — and shipped the first two.
K18 is the third, and only the part of it the record can support.

### The whole algorithm

```text
effective = max(requested, duty.minFlow)
```

One line, in the controller stage, applied to the setpoint the ALGORITHM uses
and never written back to `SP`. There is no second PI loop, no integrator, no
gain, no hysteresis, no deadband, no rate limit, no trip and no recirculation.
A constraint on a setpoint needs none of them, and each one would have been a
number this phase invented.

Three consequences follow from writing it as a `max` rather than as a switch
between two control laws:

- **It cannot chatter.** `max` of two continuous quantities is continuous, so at
  the crossing the effective setpoint is already equal to the limit. Nothing
  jumps, so nothing needs a hysteresis width chosen for it.
- **It has no state.** Two identical ticks give two identical answers, from any
  history. There is no second clock and nothing to initialise.
- **It reads no measurement.** The override is decided from the requested
  setpoint and the engineering record alone, so it cannot look ahead and cannot
  be confused by a bad reading.

### Which loop carries it

The one that **measures flow** and **drives the machine**. Both halves are
load-bearing:

| | |
|---|---|
| drives the machine | the protection's job is to stop *that* machine being commanded below its minimum, and the driving loop owns the only setpoint in the path |
| measures flow | the limit is a flow. A pressure loop on the same drive has a setpoint in bar, and `max(3.2 bar, 20 m³/h)` is not arithmetic |

Nothing is inferred. The machine is the one `wireFlowPumps` already linked in
K15 from the topology; the limit is that machine's own `duty.minFlow`. Both are
static, so `wireMinFlow` decides them once at build time — **after**
`resolveContention`, because two loops fighting over one drive are both unwired
and an unwired loop protects nothing.

### Engineering data, and the refusals

`duty.minFlow` is read and never derived. `TagDef.minFlowM3h` is the one field
in this model that falls back to *nothing* rather than to a default, and that
has not changed: **absent is not zero**, and with none declared the protection
does not exist for that loop.

Two declarations are refused rather than approximated:

- **A machine with no drive.** K15 will not wire it, so there is no setpoint
  path to protect. `NOT_CONFIGURED`.
- **A loop ranged in other units.** A flow tag nobody has given units inherits
  `UNITS.flow`, which *is* m³/h — so this guards a record that states something
  else. There is no unit conversion for controller ranges anywhere in this
  product, and applying a number in m³/h to a setpoint in L/s is exactly the
  invented engineering the programme exists to avoid. The loop runs unprotected
  and `min-flow-not-configured` says so, as INFO.

### Five states, and why a demand is not a result

```text
NOT_CONFIGURED  no minimum on the record, or one this loop cannot be held to
INACTIVE        a minimum exists and the setpoint already respects it
ACTIVE          the setpoint is raised, and the solve cannot say what came of it
EFFECTIVE       the setpoint is raised, and the machine IS passing the minimum
UNABLE          the setpoint is raised, and the machine is NOT
```

Raising a setpoint asks the plant for flow. It does not make any. A stopped
machine, a tripped one, a dead-headed one and one running backwards are all
`UNABLE`, and none may ever read `EFFECTIVE` because the setpoint was raised.
The faceplate keeps the four numbers apart for the same reason:

```text
Min flow             20.0 m³/h     what the record requires
Requested SP         12.0 m³/h     what the loop was asked for
Effective SP         20.0 m³/h     what it is controlling to
Actual flow           7.3 m³/h     what the machine is passing
Min-flow protection  UNABLE
```

### Signed, and read from one place

"What is this machine passing?" is answered by K13's `PumpEnvelope.flowM3h` —
the signed flow through the pump's own edge — and is not asked a second time.
Two modules deriving one fact are two modules that can disagree about it. So no
`Math.abs` stands between the solve and the verdict, and reverse flow cannot
satisfy a positive minimum because the number is negative. The FT beside it
reads a **magnitude** — an orifice plate does not know which way round it was
installed — which is precisely why the protection is not judged on it.

### The master, and the stop it must not integrate through

A cascade master whose request is being overridden has stopped reaching the
process *in the downward direction*: it can ask for less and less, and the
plant will keep making the minimum. Left alone it winds to its bottom stop and
then needs the whole of that travel back before anything responds.

**No new anti-windup mechanism was written.** The existing conditional
integration already asks the right question — *is the output against a stop
that the error is pushing it further into?* — and the only thing K18 changes is
WHICH stop:

```text
before   if (!((op >= hi && e > 0) || (op <= lo   && e < 0))) integrate
after    if (!((op >= hi && e > 0) || (op <= stop && e < 0))) integrate
         stop = max(lo, minFlowFloorPct)      and with no floor, stop === lo
```

`minFlowFloorPct` is the slave's configured range run backwards — the inverse
of the map `drive()` applies — so nothing is invented for it. The output itself
is **not** clamped to the floor: `op` stays the master's genuine request, which
is what keeps `commandedSp` and `effectiveSp` two different readable numbers.

Measured on the K18 fixture (slave 0–60 m³/h, minimum 20, floor therefore
33.3 %), wound up at SP 2.8 bar and then asked for 2.2:

| | with the floor | K17 baseline, no minimum |
|---|---|---|
| where the integrator came to rest | **I 34.0, OP 33.0** | I 23.5, OP 23.5 |
| what the master was asking for | **19.8 m³/h** | 14.1 m³/h |
| ticks to become useful again on a step up | **0** | 38 |

Both plants end at the same flow. The floor changes the transient, not the
destination.

### MANUAL — the policy, and why it was not a choice

**The protection acts on the setpoint. In MANUAL this runtime does not use the
setpoint** — the operator's `OP` goes to the element and the algorithm does not
run — so a setpoint override has nothing to act on and does not act. It is not
"bypassed by policy"; it has no path. Making it act in MANUAL would mean
overriding the operator's *output* instead, which is a different mechanism, is
not what a setpoint override is, and would silently reinterpret a hand command.

One line still uses the effective setpoint in MANUAL, and must: the bumpless
transfer tracking, `I = OP − kp·e`, has to track against the setpoint AUTO will
resume on. Tracking the requested value and then controlling to the protected
one would kick the output by `kp·(20−12)/60·100 = 13.3 %` on transfer — which
is the one thing that line exists to prevent. Measured, the transfer moves less
than 2 %, and that residue is one tick of transmitter noise.

Throughout MANUAL, K13's `pump-below-min-flow` goes on reporting the physical
condition from the machine's end.

### Timing

| | |
|---|---|
| the OVERRIDE evaluates | the requested setpoint and the declared limit, in the controller stage, before the solve — no measurement at all |
| the STATE evaluates | the signed solved flow of the tick that has just finished, the same instant `loops` and `pumpEnvelopes` describe |

The state is a report and never an input: there is no path by which it reaches
a controller. No stage was added to `step()`, and no clock.

### The chatter that is real, and what was NOT invented for it

A loop held exactly *on* its minimum sits on it, which means half the time it
is a hair under. Measured on the K15 fixture at a declared minimum of 20 m³/h:

```text
mean 19.998    range 19.66 – 20.38    state crosses 140 times in 200 s
K13's envelope crosses in exact lockstep — same signed flow, same limit,
same test — so this is a property K18 made REACHABLE, not one it introduced
```

No hysteresis was chosen, and the override needs none — it does not chatter at
all. What the **warning** is gated on instead is a fact the runtime already
publishes: `SAT`. A loop that has asked for everything and still cannot get
there is saturated at its top stop; a loop oscillating on setpoint is not
saturated at all. Measured on the same fixture: dead-headed `SAT = +1`; asked
for more than the plant can make `SAT = +1`; controlling at the limit `SAT = 0`
throughout. That is a reuse of K14's published saturation, not a threshold.

A STATE that does not chatter would need a deadband or an on-delay. **Choosing
its width is a control-design decision this phase deliberately does not make**
— see the limitations below.

### Diagnostics

| finding | severity | when |
|---|---|---|
| `min-flow-not-configured` | info | a declared limit this loop cannot be held to |
| `min-flow-active` | info | the demand stands, the solve cannot report the outcome |
| `min-flow-effective` | — | no diagnostic: a protection doing its job is not a finding |
| `min-flow-unable` | warning | demanding the minimum, and the loop has run out of machine |

`NOT_CONFIGURED` emits nothing where K13 already emits `pump-min-flow-unknown`:
a second row for one gap is how two lists that must agree start to drift. A
machine at rest emits nothing either — K16 clears `SAT` when a loop has no
authority, so a stopped pump cannot raise this warning, which is the right
answer twice over.

`UNABLE` is a warning and not an alarm. No engineering alarm policy in this
product says a machine below its minimum flow is critical, and K13's
`pump-below-min-flow` — the same physical fact seen from the machine — is a
warning too.

### Two existing tests corrected

`tests/hmi/flowControl.test.ts` asserted the ABSENCE of exactly this feature,
and was right to: K13 §1 says protection is not that phase, and K15 must not
have quietly added it.

```text
OLD  FIC-1 asked for 12 m³/h against a stated minimum of 20, delivered 12,
     and K13 reported BELOW MINIMUM FLOW
NEW  the same loop is held at 20, and K13 reports NORMAL
PHYSICAL REASON  nothing about the hydraulics, the pump curve or the envelope
     changed. The envelope is reporting a DIFFERENT OPERATING POINT, because
     the machine is genuinely being run at 20 m³/h instead of 12
```

Both still guarantee what mattered about them: nothing trips, nothing
throttles, no recirculation is invented, the mode is not touched, the
operator's own setpoint is not overwritten — and the third test in that block,
unchanged and still passing, says a machine with no stated minimum gets no
constraint manufactured for it.

### Three of my own tests were wrong

The instructive one was the master's anti-windup. It drove the master hard down
and asserted the integrator was held. It **was** held — at zero — but the floor
had nothing to do with it: the master was slammed onto its own output stop and
K14's existing `op <= lo && e < 0` had already frozen it. *A test that passes
with the feature removed is not a test of the feature.* The floor only bites in
the band the output stop cannot reach, and getting there needs the master wound
up first and then asked for less.

### Gate

```text
3696 tests passing · 7 skipped · 0 failing      (+43)
tsc -b clean · production build clean
209 Playwright passing · 16 skipped · 0 failing
```

### Limitations

- **The STATE chatters when a loop controls exactly at its minimum**, and K13's
  envelope chatters with it. Measured and written down above. The WARNING does
  not. Giving the state ISA-18.2 deadband or an on-delay is a real control
  design decision with a width attached, and no width was invented here.
- **One limit, one direction.** `duty.minFlow` only. No maximum flow, no
  minimum continuous stable flow separate from thermal minimum, no time-at-low-
  flow accumulation.
- **No recirculation.** Nothing in the engineering record describes a
  controllable spillback path, so none was invented — which means a machine
  whose only real protection would be recirculation reads `UNABLE`, correctly.
- **No trip.** A minimum-flow trip is real equipment with a setting and a time
  delay, and neither is on any record here. Unchanged from K13.
- **Flow loops in m³/h only**, because there is no unit conversion for
  controller ranges. Refused explicitly rather than approximated.
- **The protection is not a mode.** There is no runtime enable/disable, because
  a declared minimum is a property of the machine and not of the shift.
- Carried: PI not PID, no output rate limit, one cascade topology (K17), no
  manufacturer data, no scenario library (K9), pressure-only boundary dynamics
  (K10), mixing unsupported (K5).

---

## K19 — minimum-flow protection state and alarm semantics

K18 shipped the override and five words to describe it. K19 changes no physics
at all — the same solver, the same curve, the same
`effective = max(requested, duty.minFlow)`, the same signed pump-edge flow —
and makes the words correct.

### Three questions, three answers, never one

The brief's §4 refuses to let these collapse, and the audit of K18 found two
places where they had:

| | Question | Answered by | Reads |
|---|---|---|---|
| A | PROTECTION DEMAND | `overriding` | the setpoint and the record. No measurement. |
| B | PROTECTION ACHIEVEMENT | `MinFlowState` | K13's signed flow, the solve's trustworthiness, K16's authority. |
| C | PUMP ENVELOPE | K13's `EnvelopeState` | the solved operating point against the record. |

C is not replaced, not wrapped and not re-derived. A is deliberately
independent of B: a demand exists whether or not the plant answers it, which is
the whole reason `Effective SP 20` and `Actual flow 7` sit side by side on the
plate.

### What was measured

Instrumenting the K15 fixture at a declared minimum of 20 m³/h, 200 s after the
loop settled: `overriding` 0 crossings, effective setpoint 0, `SAT` 0, K18's
diagnostic rows 0, authority 0 — and the protection STATE 154, K13's envelope
STATE 154 in exact lockstep, and **K13's `pump-below-min-flow` ROW 154**.

The override is therefore proven not to chatter, and so is K18's warning. The
one operator-visible row that flaps is K13's. It cannot borrow K18's `SAT` gate
because `SAT` is loop-scoped and the envelope is machine-scoped — a pump with
no controller on it still has an operating envelope and still needs the row.

### `STANDING_BY` — a subtraction from `UNABLE`

Walking the lifecycle found six of thirteen points where a machine that was
simply switched off — simulation start, commanded shutdown, coast-down, trip —
reported `UNABLE` **in the warning colour**. `UNABLE` had collapsed *asked and
refused* together with *nobody there to ask*.

`STANDING_BY` is the second of those. It covers a de-energised machine and a
loop in MANUAL, and it is **not a finding**: K16 already publishes the lost
authority as INFO and K13 already publishes `STOPPED`, so a third row would be
a duplicate. The word appears on the faceplate in the plain tone, because that
is where an operator asks what the protection is doing rather than what is
wrong.

The transition table, worst evidence first:

```text
limitM3h === undefined        -> NOT_CONFIGURED
!overriding                   -> INACTIVE
!inForce                      -> STANDING_BY   (MANUAL: no setpoint path)
solve unreadable              -> ACTIVE        (demand in force, outcome unknown)
authority !== 'available'     -> STANDING_BY   (no actuator path)
flowM3h >= limitM3h           -> EFFECTIVE
otherwise                     -> UNABLE
```

`!overriding` is tested before anything about the plant, so a stopped machine
whose setpoint already respects the limit reads `INACTIVE` and not
`STANDING_BY`: there was never a demand to stand by.

### `inForce` — a branch the engine already had

In MANUAL this runtime does not use the setpoint; the operator's `OP` goes to
the element and the algorithm does not run. K18 implemented exactly that and
then published `overriding: true` beside it, so the plate told an operator in
hand control that the protection was holding their setpoint at 20 while their
own output drove the machine. Nothing about the engine changed; the field
reports the branch it was already taking. The bumpless-transfer tracking still
uses the effective setpoint, because it must track what AUTO will resume on.

### The hysteresis that exists, and does not apply

`TagDef.deadband` and `TagDef.alarmDelay` are a real ISA-18.2 hysteresis and
on-delay in this product, used by `evalAlarms`. They are **not applicable** to
this limit:

1. **A different limit.** They are the hysteresis on a TAG's own configured
   LL/L/H/HH thresholds. `duty.minFlow` is a field on the MACHINE's record.
2. **A different signal.** The comparison is against the SIGNED pump-edge flow
   from the solve. The FT beside it reads a magnitude — which is precisely why
   the protection is not judged on it.
3. **A code default, not an engineering value.** Absent a stated value they
   fall back to 1 % of span and 0 s. Reaching for a number nobody chose for
   this purpose is invention dressed as reuse.

A test writes a 6 m³/h deadband and a 10 s on-delay onto the flow tag — both
far wider than the ±0.5 m³/h the loop rides — and measures that the crossing
count does not move.

### Alarm versus diagnostic

This product has two lifecycles and they are not the same thing:

- the **ALARM** path (`sim/alarms.ts`) is ISA-18.2 — `pending → active → acked`,
  `cleared` on return-to-normal, with an on-delay, a priority, shelving,
  out-of-service and a journal;
- the **DIAGNOSTIC** path (`ScenarioFinding`) is instantaneous, unlatched,
  unacknowledged and recomputed from the snapshot every render.

Minimum-flow protection lives entirely on the second. That is deliberate and it
is a gap, not a design: no engineering record here states an alarm priority for
minimum flow, and none was invented. Moving the condition onto the alarm path
would require a priority and a latching decision from somebody who can make it.

### Limitations carried

- **The STATE still chatters**, by design. 154 crossings / 200 s when a loop
  controls exactly at its minimum. A non-chattering state needs a deadband
  width or an on-delay, and choosing one is a control-design decision.
- **K13's `pump-below-min-flow` row flaps with it**, and cannot be gated the
  way K18's is. Same missing value.
- **A normal pump start raises a transient `min-flow-unable` warning.** The
  statement is true — the shaft is ramping, the loop is at maximum and the
  plant genuinely is not making the minimum — and real plants suppress it with
  a start-up bypass timer whose duration is not on any record here.
- **No alarm priority, no latching, no acknowledgement** for this condition.
- Carried from K18: one limit and one direction, no recirculation, no trip,
  flow loops in m³/h only, and the protection is not a mode.
- Carried: PI not PID, no output rate limit, one cascade topology (K17), no
  manufacturer data, no scenario library (K9), pressure-only boundary dynamics
  (K10), mixing unsupported (K5).

---

## K20 — minimum-flow alarm policy and lifecycle

K19 ended with a gap that was structural rather than a defect: minimum-flow
protection lived on the instantaneous diagnostic path, and the ISA-18.2 alarm
system sat beside it unused because **equipment records had no alarm section**.
Only the instrument datasheet did.

### The policy model

A new "Minimum-flow alarm" section on the EQUIPMENT record, deliberately not
inside Duty — a limit is a manufacturer's figure, an alarm philosophy is not.

| Field | Unit | Meaning | Absent |
|---|---|---|---|
| `alarm.minFlowPriority` | high/medium/low | grades the alarm, and its presence CREATES it | **no alarm at all** |
| `alarm.minFlowDeadband` | m³/h (`FLOW`, so l/s converts) | how far above the limit the flow must return before clearing | no hysteresis |
| `alarm.minFlowDelay` | s (`TIME`, so min converts) | how long the condition stands before annunciating | immediate |

Parsed by `minFlowAlarmPolicy` into `ProcessEngineering.minFlowAlarm`, carried
onto `TagDef.minFlowAlarm`, consumed only by `minFlowAlarms`. Negative or
non-finite widths and delays are treated as unstated: a deadband below zero
widens the alarm into the healthy region, and a negative delay is not a delay.

**Priority is the enable, and nothing is defaulted.** `priorityOf` throws on
`MINF` so no caller can ever obtain a fabricated priority for it.

### The condition

```text
shaft turning  AND  solve trustworthy  AND  signed edge flow < duty.minFlow
```

Signed throughout, no `Math.abs`: a machine running backwards at 25 m³/h is
passing less than nothing forwards. One comparison covers REVERSE FLOW,
DEAD-HEAD and BELOW MINIMUM FLOW, because all three are the hazard the limit
exists to prevent and dead-head is the worst of them. K13 keeps its finer
classification on the diagnostics page; the annunciator gets one protective
fact.

A STOPPED or tripped machine is not in alarm — K13 already says STOPPED, K16
says de-energised and grades it INFORMATION, K19 says STANDING_BY. An
untrustworthy solve is not in alarm either, and that is the §15 rule: a flow
the network cannot determine must never be read as a LOW one. The envelope's
UNKNOWN state is that gate, which is the same `faultOfNodes` test any
measurement bound to those nodes would get.

### Protection and alarm are different mechanisms

Nothing in the alarm reads the override, the setpoint, the controller or its
mode. Both halves are pinned by test:

```text
requested 2, minimum 5, effective 5, flow > 5
    protection ACTIVE and EFFECTIVE  ->  NO ALARM

requested 20, minimum 20, no override at all, flow 12
    protection INACTIVE              ->  ALARM
```

The alarm sits on the PUMP's tag, because it is a fact about the machine — and
it exists for a machine with no controller on it at all.

### One lifecycle

`evalAlarms` and `deviceLifecycle` held two copies of the same state machine.
K20 extracted one `lifecycle()`; limit alarms, device alarms and minimum flow
all enter it, and all feed the one journal. `allAlarms()` does the same for the
four call sites (the tick and three suppression actions).

Phases, suppression, acknowledgement, shelving, out-of-service and the journal
are the existing ones, unchanged. A standing alarm keeps its original record
and therefore its timestamp and trip value, so 400 ticks of an unrelenting
condition write ONE journal event, not 400.

### What was not invented

- **Off-delay.** The framework has none: return-to-normal goes straight to
  `cleared`, for every alarm in the product. Adding one is a change they all
  share, and K20's scope excludes it. No field, no value, no mechanism.
- **Start-up bypass.** A duration, and no record states one. A normal pump
  start annunciates, which is the physically true statement — the machine
  genuinely is below its minimum while the shaft accelerates. The configurable
  on-delay is the mechanism an engineer uses to cover it.
- **Latching.** The framework is unlatched; minimum flow inherits that rather
  than being made sticky for the UI.
- **Priority, deadband width, on-delay.** Fields, not values.

### The chatter

K19 measured ~154 crossings / 200 s of the instantaneous condition and could do
nothing about it. Measured now, counting ANNUNCIATOR transitions on the record
(not journal entries — the journal caps at 200, which would make a flapping
alarm and a quiet one report the same number):

```text
no deadband stated        > 10 transitions / 200 s
2 m³/h stated on record  <=  2 transitions / 200 s
```

The condition still crosses and the override still does not. What changed is
that the cure is now an engineering value on a record instead of a number this
product chose.

### Operator surface

No new page. The alarm appears in the faceplate's existing Alarms section with
its priority glyph, its level (`MINF`), its message and its ACK button, and in
the banner and journal with every other alarm. One line was added to the pump's
plate: **Min-flow alarm**, showing the configured priority (and the width and
delay if stated), or **NOT CONFIGURED** in the muted tone. Without it a blank
policy looks like a decision rather than a gap, and an operator cannot tell a
plant that will call them from one that will not.

### Limitations carried

- No off-delay in the framework, for any alarm.
- No start-up bypass; a start annunciates unless an on-delay is stated.
- No latching, by inheritance.
- The instantaneous protection state and K13's envelope still cross at the
  exact boundary — §19 permits it, and only the ALARM can be steadied.
- One limit, one direction, per machine. No maximum-flow alarm, no
  time-at-low-flow accumulation, no alarm on the protection STATE itself.
- Carried: no recirculation, no trip, flow loops in m³/h only, one cascade
  topology (K17), PI not PID, no output rate limit, no manufacturer data, no
  scenario library (K9), pressure-only boundary dynamics (K10), mixing
  unsupported (K5).

---

## K21 — controller output rate limiting

A CONTROL-layer constraint on how fast a controller's COMMAND may change,
added beside the actuator dynamics K12 already had rather than in place of
them. Both apply at once.

### The signal path, no longer collapsed

```text
algorithm ──► requested OP ──► RATE LIMIT ──► commanded OP
                 (t.OP)                          (t.OPC)
                                                    │
                                     SPD ──► physical ramp ──► shaft
```

Before K21 the first two were one variable. `OP` is the REQUEST — the
algorithm's output in AUTO, the operator's slider in MANUAL — and `OPC` is the
COMMAND that reaches the element. `OPC` is written only where a limit is
configured, so an unconfigured plant has no second signal on the tag, nothing
new in history, and nothing published on the loop.

`LoopState` carries three of the four: `requestedOp` (the raw request, present
only with a limit configured), `requested` (the command — and therefore the
correct right-hand side of the `tracking` comparison) and `actual` (the shaft).

### The engineering source

Searched before adding. **Nothing represented a controller output rate.**
`RAMP_S`, `COAST_S` and `STROKE_RATE` are code constants for physical actuator
dynamics, and §3 forbids deriving a control-layer limit from them. One field,
on the INSTRUMENT record beside `signal.cascadeTo`:

| Field | Unit | Absent |
|---|---|---|
| `signal.outputRateLimit` | %/s | no limit at all |

Parsed explicitly. `10 %/s`, `10 % / s`, `600 %/min`, `36000 %/h` → 10. A bare
number is %/s by declared rule, because the controller output has exactly one
unit — the same convention `duty.minSpeed` already uses for a bare percentage.
Refused rather than approximated: zero (that is a trip), negative, a
denominator this model has no seconds for, and a numerator that is not per cent
(`2 m³/h/s`) — there is no conversion between a flow and an output position.

### The equation

```text
maxDelta   = rate · dt
commanded  = clamp(requested, prevCmd - maxDelta, prevCmd + maxDelta)
```

`dt` is the simulation timestep. No wall clock, no elapsed browser time, no
timer, no accumulator. Every path out of the controller stage — AUTO, MANUAL,
the no-setpoint hold and K16's no-authority hold — goes through one `send()`,
because a constraint on the output path that some paths bypass is not a
constraint on the output path.

### Anti-windup: reused, not invented

The clause most likely to have been a hard stop, and it was not one. The
existing conditional integration already asks *"is the output against a stop
the error is pushing it further into?"*, and K18 established that a new
constraint changes WHICH STOP rather than adding a mechanism. K21 does it a
third time, with stops that are dynamic:

```text
reachHi = min(hi,   prevCmd + rate·dt)
reachLo = max(stop, prevCmd - rate·dt)
```

With no limit, `reachHi` IS `hi` and `reachLo` IS `stop`, and the predicate is
character-for-character K18's. **`kp`, `ti`, `ki` and the integrator clamp are
untouched.**

### Three states that are not each other

`SAT` is still judged against `hi`/`lo`, the CONFIGURED travel, and
deliberately not against the rate window. A loop crawling to 90 % at its
configured rate is not saturated — it has plenty of machine and simply is not
allowed there yet. Reusing `SAT` would tell an operator the setpoint is
unreachable when it is merely not reachable this second, which is the exact
conflation K16 fought once already for authority.

```text
RATE LIMITED   the command is being held back by the record's rate
SATURATED      the output is against its configured travel stop
NO AUTHORITY   the output does not reach the process at all
```

Any combination is possible, and a rate-limited loop still HAS authority.

### MANUAL

Decided from the architecture, not from preference. `lo` and `hi` — this
controller's other configured output constraints — have always clamped a hand
command, so a constraint on the OUTPUT PATH binds in MANUAL. The minimum-flow
override does not, because it acts on the SETPOINT and MANUAL does not use one.
Two different answers, each following from what the constraint acts upon.

The operator's entry survives in `OP`; the plate shows it beside the commanded
value. The bumpless transfer tracks the COMMAND, because that is where the
plant actually is.

### Startup

K15's calm start seeds a speed loop's `OP` and `I` at the machine's rest speed
— 100 % for a VSD. `OPC` is undefined until the first `send`, and `prevCmd`
falls back to `OP`, so the first command equals the first request and the
limiter does nothing. **No jump was introduced by the limiter existing**, which
is §7's requirement. Six of the K21 tests were written assuming a loop ramping
up from zero and were corrected, not the code.

### Both lags exist; which one binds depends on the numbers

K12's drive covers its full travel in `RAMP_S` = 2 s — 50 points of speed per
second.

```text
limit TIGHTER than 50 %/s  — the control layer binds, the drive keeps up
limit LOOSER  than 50 %/s  — the drive binds, exactly as before K21
no limit                   — the drive binds, exactly as before K21
```

Measured all three ways. K21 added a layer; it did not replace one, and neither
is derived from the other.

### Cascade

Each controller's configured limit applies to that controller's OWN output. A
master's output is its slave's setpoint, so a master's limit rate-limits that;
a slave's limit rate-limits the speed command. Two limits exist only where two
records state two. A merely rate-limited slave is NOT `downstream`
unavailability — K17's authority is for a slave in MANUAL or one that cannot
reach its process, not one taking the time its record permits — so the master
keeps integrating through ordinary transients.

### Minimum flow

Untouched and in order: the override remains a SETPOINT constraint applied
before the algorithm, the rate limit an OUTPUT constraint applied after it.
Measured: with a 1 %/s limit the effective setpoint is at the minimum on the
very first tick, however slowly the output is allowed to chase it.

### Diagnostics, history and the operator surface

**No diagnostic row and no alarm.** A loop moving at exactly the rate its
record permits is the system working as designed — the same judgement K19 made
for EFFECTIVE — and it is transient by nature, so a row would flicker on every
setpoint change. It is a published loop state and a faceplate row.

**No journal events.** 200 ticks of rate limiting write nothing; history keeps
its existing controller-output semantics.

The controller plate gains three rows, shown only when a limit is configured:
Commanded, Actual, and the rate itself with `RATE LIMITED` while it binds — in
the ordinary text tone, never the alarm palette, and never the saturation row.

### Limitations carried

- The field is per controller in per cent of output. A valve's `STROKE_RATE`
  still applies underneath and the two have not been reconciled into one story.
- No rate limit on a setpoint as such: a master's limit constrains its output
  (which is its slave's setpoint), but a loop's own SP moves as fast as an
  operator types it.
- No separate up/down rates — one symmetric limit, because one number is what
  a record states.
- Carried: no off-delay, no start-up bypass, no latching (K20); no
  recirculation, no trip, flow loops in m³/h only (K18); one cascade topology
  (K17), PI not PID, no manufacturer data, no scenario library (K9),
  pressure-only boundary dynamics (K10), mixing unsupported (K5).

---

## K22 — constraint ownership, precedence and units

A constraint-architecture phase, not a feature one. Eight independent limits
had accumulated since K12, each correct alone; the ORDER, the OWNERSHIP and the
anti-windup visibility of each had never been written down.

### The chain

```text
operator / master ──► SP ──► [min-flow override] ──► effective SP
                                                          │
                                                     PI algorithm
                                                          │
                       requested OP ──► [OP travel] ──► [output rate]
                                                          │
                                                    commanded OP
                                                          │
                              ┌───────────────────────────┴────────┐
                         VSD: SPD                             valve: OP
                         [turndown]                          [travel]
                              │                                   │
                         [RAMP_S]                          [STROKE_RATE]
                              │                                   │
                           shaft                                 POS
                              └───────────────┬───────────────────┘
                                       hydraulic solve
```

`src/hmi/sim/constraints.ts` holds the inventory as typed data;
`tests/hmi/constraints.test.ts` drives every row against a running plant so it
cannot silently drift from the code it indexes.

### Ownership, and the one exception

**A constraint is enforced by the layer that owns it, and nowhere else** — with
one deliberate exception. `duty.minSpeed` is enforced twice: by `speedTarget`
at the actuator, so a direct write to `SPD` is still refused, and as the
controller's `op-travel` floor, so the algorithm can see the stop it is winding
against. Both are recorded as intentional. Everything else has one owner, and
the tests prove a direct write cannot bypass it.

### No engineering setpoint limits exist

The audit looked and found three things that are **not** SP limits:

1. the **calibrated range** (`signal.range`) bounds the faceplate's setpoint
   entry field — input hygiene on a widget, not enforced by the engine;
2. the **same range** is what K17 scales a master's output onto, because a
   slave's setpoint must be in the slave's own units — that is a MAP;
3. `signal.setpoint` is a **configured starting value** (K15).

A transmitter's range is a statement about an instrument. Treating it as a
controller's permitted setpoint span would be the same category error as
treating `duty.minFlow` as a VSD minimum speed.

Measured: `SP = 200` on a 0–60 loop is honoured, the output runs to 100 % and
reports `SAT +1`. The operator is told the setpoint is unreachable rather than
having their entry rewritten to a number that looks achievable.

### The defect: a valve's travel had no owner

```text
before:  writeTag('HV-9','OP',150)  ->  POS = 150
         writeTag('HV-9','OP',-50)  ->  POS negative
after:   OP reads 150 (the request, left visible)
         POS reads 100 (the position, physical)
```

The hydraulics were never wrong: `frac` takes `clamp(POS/100, 0, 1)` at the
solver boundary. But the PUBLISHED state was physically impossible and reached
the faceplate, `LoopState.actual` and the DEV alarm's `|cmd − POS|`.
`travelTarget` now owns it, shaped exactly like `speedTarget`. The deviation is
judged against the **achievable** command, so a valve held at its stop is
FOLLOWING rather than reported as not following. `STROKE_RATE`, `STUCK` and
`DEVT` are untouched.

The command is left reading what was asked, exactly as K12 leaves `SPD` reading
a speed the drive is refusing — the clamp stays visible rather than silent.

### Physical lag is not windup

The load-bearing conclusion. `RAMP_S`, `COAST_S` and `STROKE_RATE` are marked
`outside` the anti-windup predicate **by design**: the command was accepted in
full and the hardware is on its way, so the controller's output is not against
a stop. That lag belongs to the process the loop is controlling, and a PI
controller handles it through the measurement. Feeding it into the predicate
would freeze the integrator during every ordinary move.

The contrast is `output-rate`, where the command itself is REFUSED — which is
why K21 added it to the predicate.

Constraints the predicate observes: `op-travel`, `output-rate`,
`vsd-turndown`, `vsd-ceiling`, and `min-flow-override` (on a master, as
`minFlowFloorPct`). No new anti-windup algorithm was needed and no gains were
touched.

### `SAT` means the controller's travel

Stated once, in `SATURATION_IS_CONTROLLER_TRAVEL`, so it cannot drift into
"something limited me". It excludes the rate limit (`rateLimited`, K21), lost
authority (which CLEARS it, K16), the physical lags, and the min-flow override.
On a speed loop the bottom of travel IS the declared turndown, so `SAT −1`
there means "at the turndown" — the controller's own configured floor, not the
actuator limit leaking in.

### Model-domain bounds, kept apart from engineering limits

Five bounds carry `source: null`, meaning they belong to the MODEL rather than
to a record: `sp-domain`, `vsd-ceiling` (the pump curve's domain — `H₀` is the
shutoff head at rated speed), `valve-travel` (what a position means),
`vsd-ramp` and `valve-stroke`. **There is no `duty.maxSpeed` field in this
product** and the 100 % ceiling must never be reported as one.

### What K22 did not do

No setpoint limits invented, no setpoint RATE limiting added (§3 — an output
rate limit and a setpoint rate limit are different engineering functions), no
defaults created, no gains touched, no new operator state added, no new
diagnostic and no new alarm. The three existing states — SATURATED, RATE
LIMITED, NO AUTHORITY — already describe every constraint an operator needs,
and both rows can show at once so neither claims sole responsibility.

### Limitations carried

- The setpoint bound is honoured on two paths (faceplate entry, cascade map)
  and ignored on a third (the engine), so an operator and a scenario can reach
  different setpoints on the same loop. Deliberate — there is no SP-limit field.
- No engineering field for any physical rate: `RAMP_S`, `COAST_S` and
  `STROKE_RATE` are code constants.
- One symmetric output rate per controller, no separate up/down rates (K21).
- Carried: no off-delay, start-up bypass or latching (K20); no recirculation or
  trip (K18); one cascade topology (K17), PI not PID, no manufacturer data, no
  scenario library (K9), pressure-only boundary dynamics (K10), mixing
  unsupported (K5).
