# Changelog

All notable changes to IPD Studio. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Minimum-flow protection.** A pump whose engineering record declares
  `duty.minFlow` is no longer only *reported* as running below it — the flow
  loop that drives it will not be **commanded** below it. The whole override is
  one line:

  ```text
  effective setpoint = max(requested setpoint, duty.minFlow)
  ```

  It is a constraint on a setpoint and not a second controller: no extra PI
  loop, no gain, no hysteresis, no deadband, no output rate limit, and **no
  automatic trip or recirculation** — neither is on any record here.

  **A demand is not a result.** Raising a setpoint asks the plant for flow; it
  does not make any. The faceplate keeps four numbers apart — what the record
  requires, what the loop was asked for, what it is controlling to, and what
  the machine is actually passing — and reports `EFFECTIVE` only when the
  machine really is passing the minimum. A stopped, tripped, dead-headed or
  reversed machine reads `UNABLE`, and the flow shown is always the solve's own
  **signed** number.

  **The operator's setpoint is never overwritten.** The override applies to the
  setpoint the algorithm uses, so what was typed stays what was typed, and a
  cascade master's request stays visible beside the value being held.

  A machine whose record states **no** minimum gets no protection and nothing
  assumed in its place — absent is not zero. A declared limit that cannot be
  applied (a machine with no drive, or a loop ranged in units this model does
  not convert) is **refused and reported**, never approximated.

- `min-flow-active`, `min-flow-unable` and `min-flow-not-configured` on the
  Diagnostics page's LIVE section, beside the other control-loop findings.

### Changed

- A cascade master no longer integrates downwards against a request the
  minimum-flow protection is holding above it. This reuses the existing
  anti-windup rather than adding one: the floor becomes another stop, the
  master's output is not clamped to it, and with no minimum declared the
  behaviour is byte-for-byte what it was.

## [0.22.0] — 2026-09-17 — real hydraulics and real control

The HMI stopped approximating. Flow used to be a pump's rating multiplied by
the valve fractions on a path, with pressure painted on afterwards; it is now
a nodal solve, so a valve position sets a resistance, the resistance sets the
pressure field, and the pressure field decides the flow. Everything below
follows from that one change — and from a rule applied to every phase of it:
where the model cannot answer, it says so instead of showing a plausible
number.

### Added

- **Variable-speed pumps.** A machine whose engineering record declares
  `duty.vsd` can be commanded to part speed, from an operator's faceplate or a
  runtime scenario, with an optional `duty.minSpeed` turndown. The affinity laws
  were already in the pump curve; what was missing was a way to ask for a speed.

  **The command and the shaft are different things**, and the faceplate shows
  both: ask for 30 % and the plant goes on running at the speed the drive has
  actually reached until it gets there. The solver reads the shaft, never the
  command.

  A machine that declares nothing is **fixed-speed and unchanged** — and a speed
  command on one does not quietly switch variable speed on, it is reported.

- `pump-speed-config` reports a minimum speed configured on a machine with no
  drive to turn down, or a turndown that is not a readable percentage.

- **Pump operating envelope.** The simulator now says when a machine is being
  run somewhere the model cannot stand behind: **dead-headed** — turning,
  making head and passing nothing; **reverse flow** — fluid coming back through
  a turning machine; or **below minimum flow**, where a record states one.

  A new `duty.minFlow` field carries that limit, and it is **never derived**. A
  machine whose record states none reads **LIMIT UNKNOWN**, which is what the
  simulator actually knows — not a percentage of a rated capacity that is
  itself a default on most drawings.

  **Detection only.** Nothing trips, stops or recirculates: a minimum-flow trip
  is real equipment with a setting and a delay, and neither is on any record
  here.

  The state is on the pump faceplate and on the Diagnostics page's live
  section, and a drive on its way to a new speed is a ramp rather than a fault.
  A pump's faceplate flow is now the machine's own **signed** flow, so one
  running backwards no longer reads as one running forwards.

- `pump-min-flow-config` reports a minimum flow that cannot be read, is
  negative, or leaves the machine no operating range.

- **Closed-loop speed control.** A pressure controller with no valve to
  throttle now commands the SPEED of the machine that makes the pressure it
  measures. The whole loop is real: setpoint, error, output, speed command,
  the drive taking time to get there, the pump curve, the hydraulic solve, the
  transmitter, and the controller reading that transmitter on the next tick.

  It reads **the transmitter an operator reads** — noise and all — never the
  solved pressure behind it, and it writes the speed **command**, never the
  shaft. A drive still takes two seconds to get where it is told.

  The controller is the existing PI. What is new is where its output goes and
  how far it may travel: a speed loop's floor is the turndown the machine's
  record states, and **none is invented** where the record states none. An
  output sitting at its limit says **AT MAXIMUM** or **AT MINIMUM** rather than
  letting an unreachable setpoint look like a satisfied one.

  Exactly one thing writes a controlled machine's speed, so the pump's own
  faceplate names the loop and stands aside. MANUAL and AUTO hand over in both
  directions without a bump.

  A machine whose record declares no drive is **not** quietly made into a final
  control element: the loop is refused, and `pump-speed-no-drive` says so.

- A driven machine now trends its speed **command** and its **actual shaft**
  as two series, so a drive taking time to get somewhere is visible.

- **Controllers come up asking for nothing.** A loop no longer starts at 50 —
  a number left over from when every tag ran 0-100, and one that asks a 0-10 bar
  loop for five times full scale. It takes the **Setpoint** its record states,
  and where the record states none it starts at its own measurement: error zero,
  output held, nothing moving until an operator asks for something.

  An explicitly configured setpoint is never replaced by the plant's state, at
  RUN or at RESET. A setpoint the plant cannot reach is still accepted, still
  saturates, and is reported rather than quietly corrected. A loop with neither
  a record nor a measurement to start from now shows **no setpoint** instead of
  a number nobody set.

- **Flow control on a drive.** A flow controller with no valve to throttle
  commands the speed of the machine whose flow it measures — the same PI, the
  same speed command, the same drive, with gains of its own because a flow loop
  on a centrifugal machine has nearly twice the gain of a pressure one.

  The machine is found by walking **that machine's own stream**, so a
  transmitter past a tee is refused rather than wired to a flow that is only
  part of what the pump is passing. Move the whole drawing and the binding is
  the same.

- Two controllers that would command one drive are **both** left unconnected
  and reported by `pump-speed-contended`, rather than taking turns overriding
  each other.

- `controller-setpoint` reports a setpoint outside the loop's range, or a loop
  with nothing to aim at.

- **Controllers know when they cannot do anything.** A loop whose machine is
  stopped or tripped, whose valve is stuck, whose final element is missing, or
  whose measurement the hydraulic solve cannot stand behind now **holds** its
  output and its integrator exactly where the plant left them — instead of
  slowly winding on measurement noise while nothing is listening.

  Thirty minutes of a stopped pump used to move a controller's output by a fifth
  of its travel. It now moves it by nothing, and when the pump starts the loop
  picks up from where it was rather than from what the noise accumulated.

  **Running out of machine and having no machine are different things**, and
  they no longer read the same: an output resting at 100 % because a pump is
  stopped is not a saturated output.

  The controller faceplate says whether the loop can reach the plant, and shows
  what it **asked** the actuator for beside what the actuator actually became.
  A stopped pump is a normal plant state and reads as information, not an alarm.

- **Cascade control.** A pressure controller can now set a flow controller's
  **setpoint**, and the flow controller commands the drive:

      PIC-1 → FIC-1 setpoint → FIC-1 → P-101 speed → pump → pressure

  The master never touches the drive. Not "is prevented from" — it has no path
  to one, because a controller whose record declares a cascade is never offered
  a drive in the first place. The slave remains the only thing that writes a
  speed.

  A cascade is **declared** on the master's record and never inferred: two
  loops that happen to reach the same machine are a contention, which is still
  refused and reported. A declaration that cannot be honoured leaves the master
  driving **nothing** — it does not quietly fall back to the drive.

  When the slave is in MANUAL, or its machine is stopped, **the master holds**
  rather than winding up a demand nobody is acting on. Putting the slave back
  in AUTO is bumpless, because the master never stopped writing the setpoint.

  Each faceplate says which end of the link it is — `MASTER → FIC-1 → P-101`,
  or `SLAVE, SP from PIC-1` — and a slave's setpoint entry belongs to its
  master while the link is in service.

- `cascade-invalid` reports a declared cascade that cannot be built, and says
  that the master drives nothing until it is fixed.


### Added

- **Equipment runtime state says what is deciding it.** A derivation — not a new
  store — names whether a pump or valve is being driven by a trip, a controller,
  a scenario or the operator, from state that already exists. It also reports the
  command and the ACTUAL position separately, because an actuator takes time and
  a stuck one never arrives.

### Documented

- The precedence the engine has always implemented, now written down and tested:
  a pump's shaft is `FAULT → 0`, else the ramped shaft, else the RUN command; a
  valve's opening is its **position**, not its command — which is precisely why
  a stuck valve behaves like one.
- **Stopping a pump is not zeroing the plant.** The machine's head goes away and
  the machine itself blocks (the discharge check valve is a stated assumption),
  but whatever else can move fluid still does — a vessel above its outlet goes
  on draining, because the solver says so rather than a rule.
- There is **no variable-speed command**: the affinity laws are in the pump
  curve, but the runtime derives the shaft fraction from RUN alone.


### Added

- **A battery limit can change during a run.** A terminal's engineering record
  may declare that its pressure is `constant`, `step`s at a stated time, or
  `ramp`s over a stated duration — a utility header that trips, or sags when the
  neighbouring unit starts up. A terminal that declares nothing is static, which
  is what every drawing made before this is.

  It is **causal**: the boundary goes into the hydraulic solve and the pump's
  operating point, the transmitters, the inventory and the alarms all come back
  out of it. Nothing writes a PT, an FT or a level to represent the change.

  It is **deterministic**: a signal is a pure function of its declaration and
  the simulation clock, with no state and no second timebase, so the same run
  twice is the same run.

  An **operator override still wins** over a declared signal — and the page
  shows which signal is being overridden.

- `terminal-bad-signal` reports a declared signal that cannot be used. Unlike a
  missing pressure, this is a statement that is wrong rather than absent: the
  record describes behaviour the simulation will not produce.


### Added

- **A Scenario page for the operator.** What the plant is doing today and what
  its records say it is, side by side, for every tagged terminal: the
  engineering pressure, the one actually in force, and which of the two it is.
  An operator can hold a terminal somewhere else for this run and take it back,
  without touching the drawing or the records.

  The page calculates nothing — an override is a boundary condition handed to
  the solver, and every number beside it is read back out of the solved state.

  **Clear scenario** and **Reset plant** are separate actions and the page says
  why: clearing removes boundary overrides only, because an operator undoes a
  command with a command.

- **Terminals say what they are doing**, not what they are called — `SUPPLYING`,
  `RECEIVING` or `NO SIGNIFICANT FLOW`, from the sign of the solved flow, on
  both the Scenario page and the process view. A terminal states a pressure; the
  solver decides the direction, and the same terminal reads differently when a
  pump starts.

- **Scenario problems appear in Diagnostics**, as a third section beside Live
  runtime and Engineering, carrying the existing severity model.


### Added

- **Runtime operating scenarios.** What the plant is doing today, as against
  what it is. A scenario holds a tagged terminal at a different pressure, or
  sets a pump running, a valve part-closed, a controller in manual — keyed by
  engineering tag, and applied without touching the drawing or the registry.

  It is causal rather than cosmetic: dropping a supply header from 3 barg to
  1 barg moves the pressure field, the flows, the pump's operating point, the
  transmitters and the rate the vessel fills, because it goes into the solve and
  comes back out the same way everything else does.

  Every runtime pressure now says **where it came from** — a scenario, the
  engineering record, or the documented fallback — and a scenario that names a
  tag that is not a terminal, states a pressure nobody can read, or overrides
  one tag twice is reported as invalid with both values named. Nothing is
  coerced to zero and no value wins a tie.


### Added

- **Battery limits are engineering objects with a stated pressure.** Draw a
  *Battery Limit / Terminal*, tag it, and give its record an operating
  pressure — `3 barg`, `4 bara`, `50 psig` — and the hydraulic model holds that
  connection there. Until now every boundary in a drawing was the atmosphere,
  because a free pipe end has no tag and so nothing to state a pressure with.

  A terminal states a **pressure, never a direction**. Two terminals at 3 and
  1 barg drive flow one way; swap the two records and the same drawing runs the
  other way, because the solver decides which end supplies. It is not a vessel
  (no volume, no level) and not a pump (it holds a pressure rather than adding
  head).

- **Two checks for an unfinished terminal.** `terminal-no-pressure` when a
  tagged terminal's record states none, and `terminal-bad-pressure` when what it
  states cannot be read as a pressure. Both hold the connection at atmosphere so
  the plant still runs, and say so. A legacy free pipe end is *not* reported —
  the drawing never claimed anything about it.


### Changed

- **The boundary conditions of the hydraulic model are explicit.** Every place a
  pressure is fixed rather than solved now says which physical condition holds
  it — a free pipe end is *atmospheric*, a vessel's vapour space is vented or
  held, a bottom nozzle adds the static head above it. Before this they all
  silently took one constant, and `ProcessNode.pressureBar` existed but was
  never written to.
- **`supplyPressureBar` is now `atmosphericPressureBar`.** The old name implied
  a battery-limit supply header. It is the air, and the wrong name was the
  direct source of the recurring expectation that a free pipe end ought to be
  able to push — it cannot, any more than the atmosphere can fill a vented tank.

### Added

- **A vessel can be closed.** If its engineering record states
  `design.operatingPressure` — a field that already existed and nothing read —
  the vessel's vapour space is held at it and its bottom nozzles see that plus
  the liquid head. A vessel that states nothing is vented, exactly as before.
  Never taken from `design.pressure`, which is a rating rather than an operating
  condition. Read as gauge unless the unit says otherwise, because that is what
  a datasheet means.


### Added

- **Process streams carry an explicit service.** A fluid is now an engineering
  definition — identity, name, and where they can honestly be stated, density,
  viscosity and heat capacity at a named reference condition — propagated from
  the P&ID through the process topology to the operator screen. Water is defined
  completely; the other starter services carry no properties, because a density
  for "Steam" or "Slurry" needs data nobody has stated and inventing one would
  be worse than saying so.
- **Where two services meet, the model says MIXED and names them.** It does not
  pick one, and it does not compute a mixture's properties: mixture physics is
  not implemented and is not pretended. The junction is marked on the process
  view and the streams beyond it are drawn broken.
- Streams are distinguished on screen by a **closed palette of six**, resolved
  from a token rather than a colour, with no warm hues in either theme — red,
  orange and yellow stay reserved for alarms. A bad-quality stream is still
  visibly bad and an object in alarm is still visibly in alarm, whatever the
  line carries.

### Changed

- **One process picture, two presentations.** The Overview's summary strip used
  to walk the branch model and lay itself out while the Process flow page walked
  the hydraulic topology and laid itself out — one plant described by two
  independent algorithms. Both now project the same view model, and the vessel
  flows on a faceplate come from the same signed edge flows. A battery limit can
  no longer read SUPPLY on one screen and DESTINATION on the other.

### Fixed

- **The P&ID's fluid assignment reached the HMI as a colour and nothing else.**
  The importer resolved `fluidId` to a line colour and dropped the id, so the
  only thing the operator layer knew about a service was what shade it had been
  drawn in. The identity comes across now, and the colour comes with it.

### Removed

- `sim/topology.ts` — the branch-model projection, superseded by the process
  view. Deleted rather than left beside it: a dead derivation with live tests
  reads as coverage.


### Added

- **A process view, laid out from the topology rather than the drawing.** A new
  **Process flow** operator page shows the plant the way the fluid runs through
  it — sources on the left, then the things the fluid meets in the order it
  meets them, to the vessels and outlets. A P&ID is routed for drafting; this is
  routed for reading a process.

  It is a presentation of the same engineering model, not a second one: every
  object on it carries the id of the canonical topology object it came from, and
  the P&ID is untouched. Devices become boxes and pipes become lines — the
  inverse of the hydraulic graph, where a pump is an edge between two pressure
  nodes.

  Everything on it comes from the solve. Flow direction is the **sign** of the
  solved pipe flow, so a line that reverses reverses on screen; a line animates
  only while something is actually passing through it; an FT reads **its own**
  edge and not a branch total; a valve shows position and flow as two separate
  things, because 100 % open is not 100 % flow; a vessel's level is its
  inventory. A solve that cannot stand behind its numbers says so in words.

- The operator's two process pages are now named for what they are: **Process
  flow** (topology-derived) and **Mimic** (the drawn P&ID geometry, live).


### Fixed

- **A P&ID nozzle name could silently disconnect a line.** A pipe end naming a
  port its equipment does not offer — `outlet` or `suction` on a vessel, `in`
  on a pump — resolved to a role no schema lists, so the edge pointed at a node
  nothing had created. The line carried **zero flow**, no issue was raised, and
  the hydraulic solve still reported `converged`. Port roles are now resolved
  against the equipment's own schema.
- **An explicit nozzle role is no longer overruled by where the line is drawn.**
  A vessel nozzle the drawing calls `top` stays the vapour space even when the
  line lands low on the shell. `vent` and `drain` are read as `top`/`bottom`.
  Generic names (`in`, `out`) ask the equipment kind. Compass ids (`n`, `s`)
  remain positional — they point at the floor on a rotated vessel — and the
  fallback is recorded as inferred rather than stated.
- **A calm start no longer moves liquid.** A controller-driven throttling valve
  was seeded 40 % open to match a placeholder in the controller's output field,
  before any controller had run — and since start-up solves the network, the
  valve was genuinely open and the vessel genuinely drained while the actuator
  stroked shut. Every throttling valve now comes up at its rest position, shut,
  and the first tick computes a real output for the actuator to stroke towards.

### Added

- **Two suction checks, on the drawing rather than at RUN time.**
  `pump-suction-unsupplied` fires when a pump's suction reaches no vessel and
  no boundary; `pump-suction-insufficient` when, at the pump's rated flow, the
  drawn suction path needs more pressure than its source has. Each names the
  machine, its duty and whether that duty was assumed, the source and its
  pressure, what the path can pass, where the nozzle would sit, and what to do.
  **Neither is an NPSH calculation** — the model has no fluid, vapour pressure,
  suction temperature or elevation — and both say so in the finding text.


### Changed

- **The simulation runs on the hydraulic solver.** `sim/engine.ts` solves the
  network's pressure field every sub-step and takes every flow, every pressure
  and every vessel inventory from the result:
  `valve position → resistance → pressure field → flow → inventory`. The
  conductance model it replaced is **removed, not retained** — there is no
  second flow calculation in the product. Flow is no longer linear in valve
  position, junctions balance, and a line can reverse: a vessel being filled
  drains back down the same pipe when the pressures say so, and `pipeFlows` is
  signed so the screen animates it the way it runs.
- **A vessel holds a volume; its level is derived from it.** Inventory in m³ is
  the state, integrated from the signed flow across the vessel's own nozzles. A
  full vessel refuses inflow and an empty one refuses outflow as a rule on those
  edges, so mass is no longer destroyed by a clamp at the top of the tank.

### Removed

- **The conductance flow model and the pressure profile.** `solveFlows` and
  `pipeFlowMap` are gone from `sim/network.ts`, and `solvePressures`,
  `pumpHeadBar` and `LOSS_K` from `sim/process.ts`. Nothing called them once
  the integration landed, and a tested-but-dead flow calculation reads as
  coverage while being a wiring mistake away from becoming a second source of
  truth again. `buildNetwork`'s branch projection stays — the thermal model,
  the flowsheet and controller action all read routes from it.

### Added

- **Data quality carries the solver's own limits.** A solve that did not
  converge reads **BAD** and its number is hidden; a node with no path to a
  pressure boundary, or one the model has driven below absolute zero, reads
  **UNCERTAIN** with the reason in words. `simStore.hydraulic` publishes
  `converged`, `residual`, `iterations`, `cavitating` and `undetermined`.
- **Warm start through the runtime.** The previous converged pressure field is
  carried into the next solve and between the sub-steps of a fast tick, and
  cleared on RUN, RESET and exit. It halves the iteration count and agrees with
  a cold solve to within `MASS_TOL` — the precision a converged solve is
  defined to.
- `tests/hmi/runtimeHydraulic.test.ts` — 26 causal integration tests on a
  branched representative plant driven through `simStore`, plus preservation
  checks on all three bundled samples.

### Fixed

- **A forced tank level sprang back.** Writing `PV` on a vessel now writes the
  inventory it is derived from, so an operator or a scenario forcing a level to
  raise an alarm works again.
- **A dead pipe no longer animates.** Blocked elements are a steep finite
  conductance, so a shut line carries a fraction of a millilitre an hour; the
  canvas gates its flow animation on `SHUT_LEAK_MAX` rather than on zero.


## [0.21.0] — 2026-09-15 — the operator workstation

The HMI stops being a screen that animates and becomes a workstation with a
process behind it. Real engineering units, pressure and temperature that
respond to what the operator does, a time-bounded history behind the trends,
six operator pages, a design system with one meaning per colour, and — because
the P&ID and the screens are allowed to diverge — seven engineering diagnostics
and a reconciliation view that makes the divergence visible instead of
silently regenerating anyone's work.

Full record in `docs/HMI-PROGRAM-LOG.md`; the audit that opened and closed it
is in `docs/HMI-AUDIT.md`.

### Added

- **Real engineering units, end to end.** Flow m³/h, volume m³, pressure bar,
  temperature °C, declared in one place and converted at the boundary. Physical
  quantities come from the engineering record — capacity from
  `construction.volume`, pump duty from `duty.capacity` and `duty.head` — and
  never from geometry. Tank capacity used to default to the widget's pixel area
  divided by 40, so dragging a vessel's resize handle changed the process model.
- **Pressure and temperature that actually respond.** A quadratic pump curve
  with the affinity laws, a pressure profile along each branch, and a
  well-mixed vessel energy balance with heater duty, inflow mixing and ambient
  loss. `PT` and `TT` PVs were a seeded random walk before this, so a `PIC` or
  `TIC` drove its valve for ever against a measurement that could not respond —
  the loop was open and looked closed. Shutting a valve now makes the pump ride
  up its curve: 1.020 bar open, 5.007 bar shut, which is supply plus shutoff
  head.
- **Data quality on every value.** `good / forced / stale / uncertain / bad`,
  worst-first, each with a badge, a glyph and a reason. A bad reading prints
  dashes rather than the last number it held, because a stale number is read as
  a live one. A frozen transmitter used to render identically to a live one.
- **One canonical equipment state machine.** The mimic, the faceplate and the
  Equipment page read `equipmentState()` and cannot disagree about whether a
  pump is running. Trips raise a TRIP alarm and need an explicit reset.
- **A real process history.** Two time-bounded ring buffers per signal, mutated
  in place, decimated on read. Spans from one minute to an hour, a value
  cursor, and no sample ever manufactured by interpolation.
- **An operator workstation.** Overview, Process, Equipment, Alarms, Trends and
  Diagnostics behind one always-present page bar, with a dynamic overview that
  includes a mini-flowsheet projected from the solver's own network — so the
  picture cannot drift from the plant.
- **Seven engineering diagnostics**, computed once and read by the Checks
  workspace, the operator's Diagnostics page and the reconciliation view:
  missing tag, broken connection, missing instrument, invalid range, invalid
  unit, missing simulation model, unbound HMI object. Deterministic, keyed, and
  navigable to the object they are about — including, for the first time, to a
  widget on an HMI screen.
- **P&ID ↔ HMI reconciliation.** Added, removed, changed and unchanged, with a
  preview that lists exactly what will happen, an apply that is one undoable
  document transaction, and a `remap` that never guesses its destination.
  Hand-laid screens survive: existing widgets are never moved, resized,
  relabelled or regenerated.

### Changed

- **One resolver for engineering metadata.** Every widget, the faceplate, the
  alarm engine and the simulation now draw on the compiled `TagDef`. Before
  this a tag whose record said `0–10 bar` alarmed correctly at 8 while its bar
  graph drew a 0–100 scale with no limit ticks at all.
- **A design system with one meaning per colour.** Semantic tokens emitted as
  CSS custom properties, consumed by both the SVG graphics and the stylesheets.
  Ninety-one colour literals across sixteen components are gone, and a test
  fails the build if one returns. `stopped` and `closed` used to be the same red
  as a critical alarm, so a correctly shut-down plant looked like an emergency;
  inactive is now a quiet neutral.
- **Faceplates adapt to what the object is** — a pump gets START/STOP and no
  setpoint, a controller gets PV/SP/OUT and AUTO|MANUAL, a transmitter gets its
  range, quality and source.
- **Re-import was demoted, not removed.** It still rebuilds a screen from its
  sheet, and now says plainly that it discards your layout and points at
  Reconcile instead.

### Fixed

- **A `NaN` that silenced the alarm system.** Flow transmitters bound to a line
  were seeded non-finite at RUN and RESET; a controller in AUTO latched it in
  its integrator, and it spread to the valve, the vessel and that vessel's
  level, pressure and temperature. Because every comparison against `NaN` is
  false, alarms on those tags stopped annunciating entirely while quality still
  read GOOD. Two of the three bundled samples did this on every run.
- A temperature controller taking its PV from a vessel's **level**: `TIC-101`
  and `TK-101` both parse to ISA family T, loop 101. Controller pairing now
  also requires the partner to measure the same quantity.
- Bound transmitters coming up at mid-range for one frame on RUN and RESET.
- A pressure section off-by-one that made the pipe *leaving* a pump its suction.

## [0.20.0] — 2026-09-07 — company standards

The QA engine stops checking every drawing against the same generic rules and
starts checking yours — with the cost of adopting a convention shown before
you adopt it, and the standard travelling inside the `.pnid` so a reviewer
checks a file against the rules its author used.

### Added

- **Company standards — the validator checks *your* rules, not generic ones.**
  A generic checker tells you a tag is malformed by ISA. This one tells you it
  is malformed by your own numbering convention, which is what actually gets a
  drawing rejected at check stage. Loop-number width, whether a suffix is
  allowed, which components a line number carries and in what order, the fields
  an object must hold before its record is usable, whether fail position
  belongs on the P&ID or only the datasheet — and, for a house that genuinely
  does not apply a check the engine ships, the severity of any rule, including
  off. The same drawing under two profiles gives two reports, which is the
  whole point.
- **A live impact preview, before anything is applied.** Every edit on the
  Standards screen recomputes the real QA report against the draft and says
  what would appear and what would go quiet — "+37 new findings, −4 silenced",
  broken down per check. Nobody switches a new convention on over a live
  project on faith; a checker that cannot answer "how much does this light up?"
  gets turned on once, floods the report, and is turned off for good. The
  number is produced by running the actual engine twice over one document, not
  by reasoning separately about what the rules would say — a preview derived
  independently from the checker is a second implementation that will
  eventually disagree with it, and a test pins previewed count to post-apply
  count so it cannot.
- **The standard lives in the document**, so a `.pnid` is self-describing: a
  reviewer opening someone else's file checks it against the same rules its
  author did, and a drawing that passed on one machine cannot quietly fail on
  another. It also exports on its own as `.ipdstd.json`, so one company file
  seeds every project and travels by email like any other engineering document.

### Changed

- Adopting a standard changes what is **reported**, never the drawing. It will
  not rename a tag: a rename changes an engineering identity that records,
  datasheets, loops and the HMI all hang off, so it stays a decision an
  engineer makes one object at a time. Existing projects are unaffected until
  they choose a standard — the built-in default reproduces the previous
  behaviour exactly, and a pre-v0.19 project only gains a profile of its own if
  it had actually chosen non-default tag settings.


## [0.19.0] — 2026-09-05 — the design page learns to talk

A UX cycle on the P&ID design page: dead ends closed, one authoritative
registry behind every shortcut and every command, failures that say what
happened and why, the drawing worked without a pointer, connection points
that have names, and — after an evidence-based audit of the result — the
three things that audit found.

### Fixed

- **Placing twice no longer stacks two symbols on one pixel.** Five clicks on
  the Gate Valve tile produced five valves at the same coordinates: a document
  holding five objects, a drawing showing one, and an instrument index that
  exported five rows with no signal anywhere that anything was wrong.
  Successive centre placements now step down and to the right, three grid
  squares at a time, and the cascade restarts whenever the view moves. A drop
  is untouched — the pointer already said where.
- **Escape out of a keyboard-opened context menu no longer drops the
  keyboard.** Shift+F10 then Escape left focus on the document body with the
  selection cleared, so the R and Delete the user reached for next went
  nowhere. Escape now closes through the same path choosing an item uses.
  Dismissing by clicking elsewhere still leaves that click alone.
- **Enter opens the inspector on the tag, not on the button that hides it.**
  The first focusable thing in the panel is "Hide the properties panel", so
  Enter landed there and the field the engineer came for was four Tab presses
  away — press Enter twice and the panel you opened closed again.

### Changed

- **Symbol search ranks by what a thing IS.** The catalogue was filtered by
  substring and listed alphabetically, which handled two-letter ISA codes —
  the queries instrument engineers actually type — worst of all: "FT" returned
  Crystallizer and Fan (Axial) on "draft", "LT" returned eleven wrong answers
  of twelve, and "CV" put three regulators above the control valves. Matches
  are now scored, a name or id beats a keyword, and a query of three
  characters or fewer only matches at a word boundary. "Foot Valve" carries
  the keyword "pump"; it is not a pump, and it no longer ranks like one.
  Search also got about twice as fast, because the word-splitting moved out of
  the keystroke and into an index built once.
- **The command palette stops denying commands it has.** With nothing
  selected, typing "rotate" answered "No command or symbol matches 'rotate'" —
  a claim about the application, and a false one. It now names the command and
  the precondition: *Rotate 90° — select a symbol first*. The rows are not
  runnable, not focusable and not reachable by Enter, and they are derived
  from the same command registry rather than written beside it, so a command
  added tomorrow is explained tomorrow for free.

### Added

- **Connection points have names.** The drawing model addresses ports by short
  stable ids — `n`, `n1`, `w2`, `sig` — and it still does: those strings are in
  every saved document and every DEXPI export, and none of them changed. What
  changed is that the software no longer has to *say* them. A port now resolves
  to words from two sources: the catalogue's own name where the definition
  establishes it (a centrifugal pump's Suction and Discharge, a PSV's Inlet and
  Outlet, a control valve's Signal and its three positioner connections), and
  otherwise where the point sits — "Top connection", "Left connection (upper)".
  The second kind is deliberately mute about function: a nozzle at the top of a
  vessel is not an inlet because it is at the top, and eight of the nine pumps
  in the catalogue keep `w`/`e` because nothing in their definitions says which
  side draws and which delivers. 34 of 491 ports are named; the rest are
  described; six say only "Connection point", which is the honest answer for a
  nozzle that sits inside the frame.
- **A refused connection now names both points.** "One carries process material
  and the other an instrument signal" became "IL-1 right connection carries an
  instrument signal; TK-101 left connection carries process material." The
  explanation was being computed and thrown away — the mark on the sheet showed
  only the headline — so it now goes to the status line where the rest of the
  app puts exactly this.
- **The inspector lists a symbol's connections**, behind a closed disclosure,
  with each one marked free or connected. Eleven rows in front of a vessel's
  tag is not what an engineer opened the panel for, so it stays shut until
  asked — and while it is shut it puts no subscription on the drawing.
- **`C` says which two points it joined.** The green flash confirms a docking
  to anyone who can see it; the status line now names the pair.
- **A selected line is announced by where it runs** — "Process line, from P-101
  discharge to TK-101 left connection". A line is its two ends, and "process
  line" alone left a screen-reader user no way to tell it from the eleven
  others. A selected *symbol* is still not made to recite its nozzles.
- **Right-click a sheet tab to rename it.** Renaming was double-click and only
  double-click, with nothing in the tab to suggest the name was editable.
  Double-click still works, and "Rename this sheet" is in the command palette —
  three ways in, one rename.

### Changed

- The QA report's incompatible-connection finding names the two points instead
  of saying that a line "connects incompatible ports". Same rule, same
  severity — it can just say which.
- The toolbar's zoom readout no longer polls once a second for the life of the
  session. The canvas publishes its paper on mount and withdraws it on
  teardown, so the readout is told rather than looking.
- Shift+arrow is documented as the *finer* nudge, which is the opposite of
  Illustrator and Figma and stays that way on purpose: on a P&ID the 8 px grid
  is what makes runs come out straight, so the unmodified key does the safe
  thing and the modifier is what leaves the grid.

### Added

- **The command palette became a command layer.** It was nine fixed entries —
  four workspace jumps, add a sheet, fit, two CSV exports and save — none of
  which touched the drawing. It could not rotate, delete, duplicate, align or
  add a symbol, which is most of what anyone does here. It now answers three
  kinds of question in the order they are usually asked: a tag to jump to, a
  command that applies to *what is selected right now*, and a symbol to place.
  Commands that cannot run are absent rather than greyed — offering "Rotate"
  with nothing selected is a menu item that does nothing.
- **Symbols can be placed from the command palette.** ⌘K, type "centrifugal
  pump", Enter — placed, selected, with the keyboard already on the drawing.
  Results carry the symbol's own drawing, so "Globe" and "Ball" are told apart
  by the geometry that actually differs rather than by two words of small text.
- **`C` connects the selected symbol where its points meet.** The keyboard had
  no way to draw a line at all. This is the same `findDock` the mouse uses,
  with the same rule, the same undo grouping and the same green flash — nudge
  a symbol into place with the arrow keys, then ask. When nothing is in reach
  it says so instead of doing nothing.
- **Favourites and Recent.** A star on each palette tile, and the eight symbols
  you last *placed* — placed, not searched or hovered, or the list fills with
  things you looked at and rejected. Both live in `localStorage` beside the
  panel widths: which symbols someone reaches for is not part of an
  engineering deliverable and must not change the bytes of a `.pnid`. They
  appear above the categories only when they have something in them.
- **`src/commands/registry.ts`** — one list of what the application can be
  asked to do. Every entry delegates to the implementation that already
  exists, so Delete has one set of edge-cascade rules and not four.

### Changed

- **Search reads the catalogue by word, not by phrase.** "heat exchanger"
  found *nothing*: no symbol is named that and no keyword contains the space,
  even though "heat" and "exchanger" are both in the metadata. Every word now
  has to land somewhere, which fixes "centrifugal pump", "globe valve",
  "control valve" and "flow transmitter" too — without inventing a single
  synonym.
- **Symbol labels wrap instead of truncating.** "Control Valve (Globe)",
  "(Butterfly)" and "(Ball)" all rendered as "Control Valv…" — three adjacent
  tiles, identical, with the one distinguishing word clipped off the end. Two
  lines of 9.5px costs 11px of tile height and no canvas at all.
- **Reverse and flow-arrow moved out of the context menu** into shared
  functions, so the menu and the palette cannot drift on what "reverse" does
  to a line's waypoints.


### Added

- **The drawing can be worked without a pointer.** The canvas was outside the
  keyboard model entirely: `.canvas-host` was a plain `<div>` with `tabIndex
  -1`, no role and no name, and the tab order ran rail → toolbar → palette and
  stopped there. Every shortcut the app has — delete, nudge, rotate, duplicate
  — needed a selection, and a selection needed a mouse. The shortcuts were
  reachable; the objects they act on were not.

  It is **one** tab stop, not one per symbol. A symbol renders 69 DOM nodes and
  the paper virtualizes above 400 cells for exactly that reason; a thousand tab
  stops would have been a keyboard trap with a progress bar. While the drawing
  has focus it owns a small key model of its own:

  | Key | |
  |---|---|
  | `Tab` / `Shift+Tab` | step through the symbols and lines, in reading order |
  | `Enter` | open the selection's properties, with focus in them |
  | `Shift+F10` | the same context menu the right mouse button opens |
  | `Escape` | clear the selection — and then `Tab` leaves as usual |
  | arrows | nudge, unchanged; with nothing selected they step in instead |

  `Escape` then `Tab` is the documented way past a surface that captures Tab
  (WCAG 2.1.2), and it is remembered until the drawing is entered again — the
  first version looped, clearing and re-selecting forever.

- **The drawing describes itself to a screen reader in two DOM nodes,** whatever
  is on it. Not an accessible node per symbol: mirroring a virtualized canvas
  into an accessibility tree would have undone the rendering work and handed
  someone a thousand-item list to walk. Instead the selection is treated as the
  cursor and announced as it moves — "FIC-101, Instrument Bubble, 4 of 17" —
  leading with the tag, because that is what an engineer calls the thing, and
  mentioning rotation, which is invisible to someone who cannot see it.

### Changed

- **Focus follows the work.** Placing a symbol from the palette moves the
  keyboard onto the drawing, so the next `Delete` or `R` acts on the new symbol
  instead of going to the search box. `Escape` in the palette search returns to
  the drawing, closing the loop. The context menu takes focus when it opens and
  gives it back when it closes, rather than dropping the keyboard on the
  document body — which is where `Shift+F10` would otherwise have stranded it.
- **The context menu answers the arrow keys,** as a `role="menu"` is expected
  to, and no longer tries to focus itself while it is still measuring — a
  `visibility: hidden` element cannot take focus, so the call succeeded and
  nothing moved.

### Fixed

- **The reading order was quadratic.** `navOrder` resolved each object's
  position inside the sort comparator, which is a linear scan per comparison —
  O(n² log n), or millions of array walks for a single `Tab` press on a
  thousand-object drawing. Positions are resolved once now, and the order is
  cached on the node and edge array identities, the same way the drag loop's
  dock and snap indexes are.
- **The announcer subscribed to the whole document,** so it re-described the
  drawing on every keystroke of a tag edit. It watches the selection only.


### Added

- **A refused connection now says so, on the drawing.** Dragging a signal line
  onto a process nozzle did nothing visible — and worse than nothing to the
  document: the drag ended as a free-ended line pointing *at* the point that
  had just rejected it, which reads at a glance like a connection. The line is
  no longer created, and a red mark appears at the point with the reason on it:
  *"These two connection points cannot be joined."* The reason comes out of the
  check itself (`explainConnection`), which used to return a bare `false` — a
  bare `false` cannot be explained to anybody. A deliberate free end, out in
  open paper, is untouched: the mark appears only where a connection point was
  actually in reach.
- **One error model, replacing nineteen browser dialogs.** Four surfaces,
  chosen by how much they interrupt: a mark on the canvas, a line in the status
  bar that fades, a dialog with a reason and an action, and a question for the
  few things Undo cannot take back. All on the existing `Modal`, so the focus
  trap, focus restore and Escape behaviour are the ones the app already had.
- **Failures say what to do next, and admit what they do not know.** A message
  states its cause only when the code actually produced one — an invented cause
  reads exactly like a real one and sends an engineer looking for a problem
  that is not there. A save that fails reports the server's refusal in plain
  words and keeps the raw text behind *Details*; one that fails for an
  unrecognised reason says the server did not say why.

### Changed

- **Accepting a QA finding is a form, not a `window.prompt`.** A browser prompt
  was collecting a permanent engineering record: the finding was crammed into
  the prompt's title, an empty string was indistinguishable from Cancel, and
  nothing validated. The finding now stays on screen the whole time the reason
  is being written, an empty reason cannot be submitted, and the dialog states
  that the record travels with the drawing and does not hide the finding.
- **File failures are four different messages, not one.** "Could not read X as
  an IPD Studio drawing" covered a corrupt file, a valid file that is not a
  drawing, an unsupported format and an unknown error — four situations with
  four different fixes. Each is now distinguished from evidence the importers
  already produce, and the raw parser complaint moved behind *Details*.
- **A DXF that will not load does not guess why.** The parser knows whether it
  could parse and which entity types it skipped; it does not know about paper
  space, blocks or frozen layers, so the message does not claim to. A DXF that
  parses with nothing drawable is its own case, and says which four entity
  types an underlay reads.
- **An export that fails leads with the fact that the drawing is fine.** There
  was no error handling on any of the nine exports: a throw left the menu
  closing and nothing happening, indistinguishable from a blocked download.
- **A save that fails offers to retry, or to download a .pnid instead.** The
  status bar was already honest — `markSaved()` is not called on failure, so
  nothing ever claimed the drawing was stored when it was not — but an explicit
  Ctrl+S that failed said so only in small grey text.
- **Deleting a sheet no longer asks; it tells you how to undo it.** It is
  undoable, and a test now guards that claim. Confirmation is reserved for the
  handful of actions that genuinely replace the document — opening a file over
  unsaved work, starting a new drawing, restoring a snapshot — where the
  affirmative button says what it does rather than "OK".

### Fixed

- **A QA fix that no longer applies says so from the Issues drawer too.** The
  drawer dropped the result entirely, so the Fix button appeared to do nothing;
  the Checks workspace had reported it all along.
- **A double-clicked `.pnid` that will not open explains itself.** The
  installed-PWA file handler had no error path at all, so a bad file launched
  the application to an empty canvas with no message.
- **The notice model no longer depends on `window`,** so the persistence and
  cloud layers that import it can still be unit-tested outside a browser.


### Added

- **Clicking a symbol in the palette places it.** It only ever responded to a
  drag, and a click did nothing at all — no symbol, no message, no cursor
  change — while the Typical Loops entries eight pixels above it *were*
  click-to-place buttons. A click drops the symbol in the middle of the view,
  selected, with the inspector already on it; a drag still places it where you
  aim and still docks. One line under the search box now says so out loud.
- **The symbol library can be reached from the keyboard.** The tiles were
  `<div>`s with no tab stop, so the `.palette-entry:focus-visible` rule in the
  stylesheet had never once matched. They are buttons now, kept out of the tab
  order — fifty tiles between the search field and the canvas is a keyboard
  trap, not keyboard access — and reached with ↓ from the search box, roved
  with the arrow keys, placed with Enter, left with Escape.
- **A shortcut sheet, on `?`.** Seven of the thirteen canvas bindings were
  written down nowhere: `R` for rotate, `Shift+1` for 100%, Delete, Escape,
  the arrow nudges, Space-drag to pan and Shift-click to extend a selection.
  The sheet lists keys and pointer gestures in one table, because "how do I
  pan?" and "what does ⌘D do?" are the same question.
- **One authoritative shortcut registry** (`src/shortcuts/registry.ts`). Every
  binding is declared once; the canvas matches against it, tooltips and the
  context menu print it, and the sheet lists it. A test asserts no combination
  is bound to two actions. `Shift+1` is matched by physical key rather than by
  the `!` a US layout happens to produce, so it works on any keyboard.
- **Right-click, everywhere on the drawing.** There was no context menu in the
  application at all. It offers what suits blank paper, one symbol, several
  symbols or a line, and every row prints the key that does the same thing —
  which makes it the app's main shortcut-teaching surface as well as its fast
  path. The rows call the same exported functions the keyboard calls.
- **Select all** (`Ctrl/⌘+A`) — symbols and the lines between them. Selecting a
  whole sheet previously meant a marquee drag across the full extent of the
  drawing, at a zoom where the drawing fit.
- **An empty sheet says how to begin.** It was a blank page with no guidance,
  while the most valuable column on screen filled with project metadata —
  name, author, tag numbering, drawing number, revision, sheet size — for a
  person who had not yet drawn anything. Three ways in now lead, the project
  fields follow, and the guidance is gone the moment the first symbol lands.
- **`docs/UX-REGRESSION-CHECKLIST.md`** — the Draw workspace's journeys, each
  row naming the spec that covers it.

### Changed

- **The toolbar keeps Export and the account control on screen.** Twenty
  controls sat in one non-wrapping row that scrolled horizontally; at 1152px it
  was 42px wider than its container, and macOS draws no scrollbar until you
  scroll, so the row simply ended — taking Export, which is how a drawing
  leaves the application, with it. New, Open, Download, version history,
  templates and the DXF underlay are behind a **File** menu now (you start a
  drawing once and save it constantly), and Export and the account control sit
  outside the scrolling region entirely. Templates became real menu items
  rather than a `<select>` you had to operate to find out what it offered.
- **The drawing gets more of the window as the window gets smaller.** The
  three side panels were fixed widths that never yielded, so the canvas took
  54% of a 1280px laptop and 70% of a 1920px monitor — all the variance landed
  on the drawing, in the wrong direction. Panels now pick their default from
  the window at mount (a stored preference still wins), and the Issues drawer
  floats over the canvas instead of taking a row of the column. Measured at
  1152×720: the canvas went from 568×~595 to 826×626 and the default fit from
  32% to 49%.
- **Per-axis stretch moved behind a disclosure.** Size, Width and Height each
  had a permanent row of −/value/+ — nine controls in front of every symbol's
  real properties, for something that matters on a horizontal vessel and
  almost nothing else. Size leads; the disclosure opens itself on a symbol
  that is already stretched.
- **Delete is in the inspector for one symbol, not only for many.** Whether an
  object could be deleted from the panel depended on how many friends it had.
- **The command palette stops listening while it is closed.** It is mounted for
  the whole session and read the entire document unconditionally, so every
  edit — including the writes a docking drag makes mid-gesture — re-rendered it
  and rebuilt its item list. It also gained "Zoom to 100%" and "Keyboard
  shortcuts", and takes its key hints from the registry rather than from the
  string "Ctrl+1", which is what it told Mac users.

### Fixed

- **"Issues (5)" no longer opens onto one finding.** The drawer tab counted
  every finding while the panel below it hid the informational ones, and the
  line accounting for them only appeared when the visible list was *completely*
  empty. The tab counts what the panel shows, and the observations get a line
  of their own whenever there are any.
- **Quiet text meets contrast.** `--c-ink-3` was 2.8:1 on the chrome it sits
  on — below AA at every size it is used at, and it is used for panel headings,
  status chips and every caption. It is 4.6:1 now, and the four hard-coded
  greys doing the same job at 2.2–3.5:1 use the token.


### Added

- **The project assistant** — a panel beside the inspector that answers
  questions about *this* drawing. It is retrieval over the engineering model,
  not a chatbot: the common questions ("is this loop complete", "what controls
  this", "which instruments have no datasheet", "what is downstream") are
  matched by keyword and answered by a query against the document with **no
  model call at all** — instant, free, and incapable of inventing anything.
  Anything else goes to a model that has ten read-only tools and must build
  every claim out of what they return.
- **An answer is a list of real objects, not prose.** The only sentence the
  app writes is a headline composed from counts and values read out of the
  document. Everything the user acts on is a row carrying the id of something
  actually on a sheet, so "Show on drawing" always lands and an answer
  structurally cannot name an object that does not exist.
- **Invented tags are caught before they reach the screen.** Every tag-shaped
  token in the model's prose is checked against what is drawn plus whatever the
  tools returned that turn; a failure regenerates once and then falls back to
  showing the raw findings. Stated honestly in the source: this catches
  invented *names*, not false *relationships* — topology claims are constrained
  by only ever giving the model `walk_signal`/`get_object` results to reason
  from.
- **The drawing never leaves the browser.** What is sent is a projection — a
  selection brief and tool results — governed by an explicit per-key allowlist.
  `meta` is never sent because it carries the author's name; underlays are
  never sent. The control is not the comment, it is `tests/assist/redact.test.ts`,
  which enumerates the keys of `ProjectDoc` and fails when a new one appears
  unclassified.
- **Proposals, never silent edits.** The assistant can propose a repair, a
  symbol, or a whole pre-wired pre-tagged typical loop — nothing is applied
  until Allow is pressed. It cannot route lines, move, or delete, and it is
  instructed to say so plainly and then say what to do by hand instead.
- **Bring your own key.** OpenRouter, Groq, or Anthropic, detected from the
  key's own prefix and held in local storage — no backend, no proxy, no
  running cost, and the models offered are the ones the account can actually
  use rather than a hardcoded guess. With no key set, the keyword path still
  answers.
- **A resizable right column.** The inspector and the assistant share it, and
  the width is remembered.

## [0.18.0] — 2026-09-03 — the feedback loop

Two kinds of feedback landed together: the drawing telling you what it just
did, and you telling us what it got wrong.

### Added

- **A Feedback button in the status bar** — one popup for both halves of
  "tell me about this": a bug that needs fixing and a feature that does not
  exist yet. They share a form rather than getting a button each, because the
  difference is a single toggle and two buttons make people stop and classify
  before they can start typing, which is exactly when they give up and say
  nothing. Title, description, and an optional screenshot you can choose,
  drop, paste, or capture from inside the app. A collapsed panel shows
  precisely what is sent with it — version, workspace, counts, browser — and
  says out loud that no part of your drawing travels.
- **Screenshot attachments are re-encoded before they are sent.** The file is
  identified by its magic bytes rather than its name (`File.type` is only the
  extension in disguise, and `accept=` is a picker default with no effect on
  drag or paste), its dimensions are read from the header *before* anything
  decodes it — a 6 kB PNG can legally declare 202 GB of pixels — and then it
  is decoded and re-encoded through a canvas. What leaves your machine is an
  image the browser itself wrote, which drops EXIF and location and destroys
  anything appended after the pixels. SVG and GIF are refused outright: no
  screenshot tool produces either, and one of them is a scriptable document.

### Fixed

- **A half-written dialog no longer vanishes on a stray click.** Every modal
  closed on a backdrop *click*, so selecting text and releasing outside the
  card threw the form away. They close on a press that *started* on the
  backdrop now, and they trap Tab, restore focus to whatever opened them, and
  go inert while a request is in flight.

- **A vertical symbol now docks to a horizontal one.** The magnet demanded
  two ports face *exactly opposite* ways, which silently refused every
  square-on pairing — including most of an instrument bubble's, whose four
  ports face four different ways. It looked as though docking just didn't
  work. Only two ports pointing the SAME way are refused now, which is the
  one case that stands a symbol on the wrong side of the nozzle.
- **A docked symbol can be dragged away again.** Docking was refused per pair
  of *ports*, so two bubbles joined on one of their sixteen pairings still had
  fifteen left, and every one of them grabbed the symbol back as the user
  tried to pull it clear. It is refused per pair of *symbols* now.
- **You can see the moment it connects** — a green ring flashes at the point
  a line lands, on a palette drop as well as a drag. A symbol dropped *near*
  a nozzle and one dropped *onto* it looked identical once the drag ended.

### Changed

- **Shake frees a symbol that was already wired up.** Shaking used to cut
  only a line the current drag had made; on a symbol that arrived connected
  it did nothing. It now takes off every line the symbol has — the only way
  to unpick a connection without hunting down the line and pressing Delete.
  One undo puts them all back.

- **Docking happens mid-drag, not on release.** The line is drawn the moment
  the two connection points meet, with the mouse button still down — keep
  dragging and the pipe stretches behind you. Before, you had to let go,
  then pick the symbol back up to pull it into place.
- **Symbols stand off 24px from the point they dock onto**, in line with the
  way that port faces, so a real length of pipe is visible. Landing the
  points on top of each other read as nothing having happened: the two
  symbols butted together and hid the line behind themselves.
- **A magnet only joins ports that face each other.** Two ports pointing the
  same way would stand a symbol on the wrong side of the nozzle it just
  connected to, with its inlet pointing away.

### Added

- **Shake to disconnect** — waggle the symbol while still dragging and the
  line that drag just made is cut, with a red flash where it used to land.
  The symbol stays in hand, and it won't snap back onto the point just
  rejected, so you can take it somewhere else without letting go.

## [0.17.0] — 2026-09-02 — the QA engine

Third step of the engineering-platform plan
(engineering-platform plan, §4.2).
Validation becomes a rule engine an engineer can actually work through.

### Added

- **21 rules with real severities** — critical, warning and information, grouped
  by discipline (tagging, topology, process, instrumentation, data). Severity
  used to be encoded as the *absence* of a field, which could not express the
  middle.
- **Accept a finding, with a reason.** Not every finding is a mistake. Accepting
  one records why, keeps it visible in its own section rather than hiding it,
  and — because findings are keyed by rule + engineering identity, never by node
  id — the acceptance survives deleting and redrawing the symbol.
- **Fixes are data, not callbacks.** A rule returns a `FixSpec`, so a repair can
  be named, previewed with its blast radius, and replayed in a test before it is
  applied. `applyFix` now reports whether it actually landed instead of failing
  silently, and `describeFix` gives one shared description of what a fix would do.
- **One index per document.** Every rule reads a single prepared walk of the
  drawing rather than rebuilding its own maps — `runChecks` alone used to build
  four, and the advisor rebuilt a neighbour list per node per rule.
- **The Checks workspace** groups by severity, filters by discipline, states why
  each rule matters, and keeps accepted findings visible with their reasons.

### Fixed

- **Equipment tags are no longer reported as ISA errors.** `invalid-letters` was
  applying the ISA-5.1 *instrument* letter tables to equipment, so `P-101` on a
  pump — a completely standard tag — was flagged as invalid. This was found by
  running the new rule set over the project's own bundled templates, and the
  false positive existed in the old engine too.
- **One finding per rule and entity.** Rules that walk nodes emitted the same
  finding twice when two symbols wore one tag, which also meant accepting one of
  them silently accepted both.

### Changed

- `no-relief` and `no-fail-position` are **warnings, not blockers**, by default.
  Both are real concerns and both are legitimately unstated on plenty of
  drawings — three of the five bundled samples trip `no-relief`. A company
  standard promotes them (v0.18); crying wolf until then teaches people to
  ignore the report.
- `required-field-empty` only fires on a record someone has **started**. Firing
  on every tagged object of a pre-registry drawing buried the report under
  11–13 identical warnings.
- The drawer's Issues tab shows criticals and warnings; observations live in the
  Checks workspace. The rail badge counts criticals only.
- Retired `validate/checks.ts`, `validate/suggest.ts`, `validate/issues.ts` and
  the two panels that read them; their coverage moved to the rule tests.
- Removed the dead `Finding` type.

## [0.16.0] — 2026-09-01 — magnetic docking

### Added

- **Magnetic docking** — connect by touching instead of by drawing. Drag a
  symbol (in from the palette, or one already on the sheet) so one of its
  connection points comes within ~18 screen px of another symbol's, and a
  ring marks the point it has caught while every connection point on the
  sheet lights up. Let go and the symbol clicks into place — the two points
  land on exactly the same spot — with the line already drawn between them.
  Because lines store ports and not coordinates, pulling the pair apart
  afterwards stretches the pipe instead of breaking it.
  - The line class is chosen from the two port kinds, so a controller docking
    onto a valve's signal boss gets `signal.electric` even with a process
    class selected in the toolbar; incompatible pairings never dock.
  - The symbol and the line it docked onto are ONE undo step, whether they
    arrived from the palette (`addBatch`) or from a drag (`dockNode`).
  - A pair that is already joined won't dock again, so nudging a docked
    symbol can't stack a second line on top of the first.

## [0.15.0] — 2026-09-01 — the engineering registry

Second step of the engineering-platform plan
(engineering-platform plan, §4.1).
Engineering data finally has a home of its own.

### ⚠️ Document format: schemaVersion 4 → 5

Documents saved by this version **cannot be opened by v0.14.0 or earlier**
(older builds reject an unknown schema version rather than silently misreading
it). Opening an older document is unaffected — v1 through v4 all migrate in.

### Added

- **Engineering records** (`doc.registry`) — every tagged object gets a record
  holding what it *is*, separate from where it is drawn. Records are keyed by
  **tag**, not node id, so they survive deleting and redrawing a symbol, and
  follow it through a rename.
- **Inspector "Engineering" tab** — the record for the selected object, with a
  field catalog per kind: instruments get calibrated range and signal, valves
  get trim, Cv and fail position, equipment gets duty and construction, lines
  get pipe class, design conditions, insulation and tracing. A fill meter shows
  how complete the record is.
- **Record status** — draft / in review / approved / issued, ready for the
  review workflow.
- **Orphan records are surfaced, not silently kept** — deleting a symbol leaves
  its record behind on purpose (deleting a symbol and discarding an approved
  datasheet are different intentions). The advisor reports the orphan and offers
  to purge it.

### Changed

- **The datasheet form and the Engineering tab are two views of one record**,
  not two stores. The printed datasheet and the datasheet-matrix CSV read the
  same values.
- **`node.datasheet` is deprecated but still read.** Values migrate into the
  registry on load, and every reader falls back to the old field for one
  release, so nothing is lost and a half-migrated document still shows its data.
  A datasheet on an untagged symbol is parked rather than dropped.
- Removed `PlantNode.attrs` — declared since v1, never read or written.

### Store invariants (each covered by a test)

- A rename **moves** the record; if another symbol still wears the old tag it
  **copies** instead.
- A rename onto a tag that already has a record **refuses to merge** and leaves
  both intact — merging two engineering records is unrecoverable.
- Deleting a symbol **never** deletes its record.
- A pasted symbol arrives untagged and gets **no** copied record.

## [0.14.0] — 2026-09-01 — the navigation shell

First step of the engineering-platform plan
(engineering-platform plan, §4.0).
No new document data: this release makes room for the five features that follow
and improves navigation on its own merits.

### Added

- **Workspace rail** — top-level navigation down the left edge: Draw, Data,
  Checks, HMI. The toolbar was full (~18 controls already scrolling), with
  nowhere to hang a second screen. `Ctrl+1..4` switches; the Checks entry
  carries a badge when there are findings.
- **Workspaces are real routes** — `/app/draw`, `/app/data`, `/app/checks`,
  `/app/hmi`. Linkable, back-button-able, and each a lazy chunk, so Draw does
  not pay for the report tables or the HMI simulator. Bare `/app` and any older
  deep link still open the drawing.
- **Command palette (`Ctrl+K`)** — jump to any tag from any workspace, or type
  `>` for commands. `Ctrl+F` still opens it, so the find-a-tag habit is intact.
  Replaces the search overlay.
- **Data workspace** — the instrument index and line list on screen instead of
  only in a downloaded CSV, built from the *same* rows the CSV writers emit, so
  the screen and the report cannot disagree. Every row locates its object back
  on the sheet.
- **Checks workspace** — every finding and suggestion, full screen and grouped,
  instead of a 190 px drawer. Fixes can be applied from here.
- **Inspector "Where used" tab** — for a selected object: its sheet, the rest of
  its loop, its connected lines, and the HMI screens showing it. All derived;
  every row is a jump.

### Changed

- **Cloud saves are ~50% smaller.** `serializeDoc()` pretty-printed with
  `JSON.stringify(doc, null, 2)` and the cloud payload used that verbatim, so
  half the 900 kB Firestore budget was indentation — measured at 328 B/item
  pretty against 165 B/item compact on the 3-sheet refinery sample. The `.pnid`
  file stays pretty; only the cloud copy is compact.
- **Validation runs once per edit, not three times.** The status bar, the drawer
  and the validation panel each held their own `useMemo(doc)`, so every keystroke
  ran the checks 3× and the suggestions 2×, each walking every sheet. They now
  share one pass (`src/validate/issues.ts`), which also makes it impossible for
  two panels to disagree about what is wrong.
- **Drawer: Validation + Advisor merged into one Issues tab.** They were always
  one engine split by an implicit severity flag; the full report lives in Checks.
- The HMI button left the toolbar for the rail.

## [0.13.0] — 2026-08-31

### ⚠️ Licence change — BREAKING for commercial users

IPD Studio moved from **AGPL-3.0-only** to
**[PolyForm Noncommercial 1.0.0](LICENSE)**. The project is now
*source-available*, not open source.

- **Free, no permission needed** — personal use, study, research, hobby
  projects, students, educational institutions, charities, public research
  bodies, public health and safety organizations, environmental organizations,
  and government institutions.
- **Now requires a paid licence** — any use by or on behalf of a for-profit
  company, including internal use, paid client work, paid operator training,
  and embedding or hosting IPD Studio in anything you sell.
  See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
- **Not retroactive.** Versions **up to and including v0.12.1 remain available
  under AGPL-3.0-only** to everyone who received them. That grant is perpetual
  and is not revoked. If you depend on AGPL terms, v0.12.1 is unaffected.
- Your drawings are unaffected either way — the licence covers the software,
  not the documents you produce with it.

### Added

- `NOTICE` — copyright, licence summary, licence history, and third-party
  component attributions
- `SECURITY.md` — private vulnerability reporting, threat model for a
  local-first client-side app, and the HMI "not for real operations" notice
- `CHANGELOG.md` — this file
- SPDX headers on all 137 source files
- `@license` build banner preserved through minification, so the terms travel
  with any copy of the bundle
- Contributor Licence Agreement in [CONTRIBUTING.md](CONTRIBUTING.md), needed
  for code contributions so commercial licences can be granted

### Changed

- README, project site, in-app strings, and the PWA manifest no longer
  describe the project as open source or free for commercial use
- [docs/LICENSE-ENFORCEMENT.md](docs/LICENSE-ENFORCEMENT.md) rewritten for the
  new licence, including the PolyForm 32-day cure clock and a warning to
  establish a copy's version before alleging any violation
- DWG import spike — the GPLv3 LibreDWG
  option is now closed; GPL code cannot be combined with a noncommercial
  licence. ODA/Teigha becomes the only viable path.

### Fixed

- Stale clone URL in CONTRIBUTING (`pid-studio` → `IPD-Studio`)
- CONTRIBUTING no longer claims the project is "CI-less"; CI has existed since
  v0.9.19

## [0.12.0] — 2026-08-27

- The canvas is a real viewport: Fit fits your screen, plus a workspace design
  pass
- Moving a group of symbols now carries their lines with them

## [0.11.0] — 2026-08-26

- Researched component prices; budget moves to the toolbar; real currency
  conversion
- **0.11.1** — enter budgets in lakh/crore (or K/M/B) instead of counting zeros
- **0.11.2** — the component panel shows its budgetary price, basis and range,
  and says when you override it

## [0.10.0] — 2026-08-26

- Budget & cost estimator: budgetary price table, live total vs budget,
  per-project and per-component overrides, cost CSV export

## [0.9.0] – [0.9.20] — 2026-08-21 → 2026-08-26

Rebranded to **IPD Studio** (0.9.15) and built out HMI Studio:

- HMI tag picker — bind by picking, never typing (0.9.0)
- DCS-style operation: faceplate v2, bumpless transfer, command journal (0.9.2)
- Trends with a real time axis: multi-pen, mm:ss, hover cursor, sparklines (0.9.3)
- ISA-18.2 alarms: deadband, 3 priorities, shelve/OOS/SBD (0.9.4)
- Screens & chrome: home screen, drag-reorder, Modal, run header (0.9.5)
- Import v2: multi-sheet dialog + generated L1 plant overview (0.9.6)
- Simulation depth: fan-out flow, equipment dynamics, process events (0.9.7)
- Import fidelity: routed pipes, vessel shapes, orientation (0.9.8–0.9.9)
- Equipment pack: compressor/blower/agitator/conveyor/heater with motor
  dynamics (0.9.10)
- Full ISA instrumentation palette with shortcut and full-name search (0.9.11)
- Frequent-industry symbol pack — 11 symbols across 5 sections (0.9.12)
- Fluid services: define media, assign to a line, colour flows through the
  whole run; HMI pipes inherit (0.9.13–0.9.14)
- Sponsorship, welcome overlay, update toast, Dependabot + CodeQL (0.9.16–0.9.20)

## [0.8.0] – [0.8.8] — 2026-08-21

- User-added connection pins and the ISA valve positioner (0.8.3)
- Control valve geometry reworked to 64×48 with clear stubs and no overlaps
  (0.8.4–0.8.8)
- Line lifecycle: no resurrection, gesture-granular bends, segment dragging
  (0.8.2)
- Imported real plants now come up calm rather than alarming (0.8.1)

## [0.6.0] – [0.7.x] — 2026-08-20

- HMI Studio first release with memoized widget rendering (0.6.0)
- Polish round from user feedback (0.6.1)

## [0.1.0] – [0.5.x] — 2026-08-20

Initial development: the P&ID editor core — ISA-5.1 symbol library, tag
parsing and validation, orthogonal routing with ports and connection rules,
multi-sheet projects, DEXPI/DXF import and export, generated loop diagrams
and datasheets, and the `.pnid.json` document format.

[0.13.0]: https://github.com/Coldbari/IPD-Studio/releases/tag/v0.13.0
[0.12.0]: https://github.com/Coldbari/IPD-Studio/releases/tag/v0.12.0
[0.11.0]: https://github.com/Coldbari/IPD-Studio/releases/tag/v0.11.0
[0.10.0]: https://github.com/Coldbari/IPD-Studio/releases/tag/v0.10.0
