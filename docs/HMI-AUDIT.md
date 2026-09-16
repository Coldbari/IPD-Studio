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
