# HMI Studio

HMI Studio is IPD Studio's operate-mode workspace: build operator mimic
screens from a widget palette — or generate one from your P&ID in one click —
and run them as a live, interactive **training/demo simulation**. It is not a
SCADA runtime and never talks to real devices.

Open it with the **HMI ⇄** button in the P&ID toolbar. Fastest tour: load the
**“HMI demo (tank level loop)”** template from the Templates menu, switch to
the HMI workspace, press **▶ RUN**, and click the pump.

## EDIT vs RUN

Like every industrial HMI package (Ignition, InTouch, WinCC, FactoryTalk),
screens have a design time and a runtime:

- **EDIT** — drag widgets from the palette (double-click also places them),
  move/resize/nudge them, draw pipes with the Pipe tool (click points, Enter
  or double-click to finish, Esc to cancel — runs stay orthogonal, hold Alt
  for a free angle), and bind everything in the property panel. Selection
  works like a drawing tool should: drag on empty canvas to rubber-band,
  Shift+click to add/remove, Ctrl+A selects all, Ctrl+D duplicates, Escape
  clears. Multi-selections get align/distribute, bring-to-front/send-to-back
  and Duplicate in the panel. **Zoom and pan** like a CAD tool: the wheel
  zooms at the cursor, Space- or middle-drag pans, ⛶ (or Ctrl+0) fits — RUN
  always shows the full page, like a real operator station. **Clipboard**:
  Ctrl+C/X/V copies widgets *and* pipes and pastes them centered at the
  cursor — including onto a different screen. A selected pipe is fully
  editable: drag the round vertex handles, **double-click a run to insert a
  bend, double-click a bend to remove it**, and drag any straight run
  sideways (the ◇ marks) — both corners follow, axis-locked.
  Screens manage like sheets: **drag the tabs to reorder**, ⧉ duplicates a
  screen (fresh ids, bindings remapped), ★ marks the **home screen**, names
  stay unique, and deletes confirm in a proper dialog (undo brings a screen
  back). Edits are undoable and autosaved with the drawing.
- **RUN** — the simulator compiles **every screen into one plant** and ticks
  5×/s, **opening on the ★ home screen** like a real operator station. The
  toolbar becomes an operator header: screen title, sim clock, alarm counts
  by priority, and a ⌂ Home button. Values move, tanks fill, pipes animate
  proportional to flow. The screen tabs (and Screen-link buttons) navigate
  between pages while the plant keeps running — and every **Screen link
  wears a priority dot when its target screen has standing alarms**, so
  trouble is visible from anywhere. Click
  anything tagged to open its **faceplate** — a draggable DCS-style plate
  (Esc closes): pumps get state + Start/Stop + live flow-through; valves a
  position scale with entry; measurements a **scale bar with the alarm
  limits drawn as ticks**, engineering units and a live sparkline;
  controllers the full PV/SP/OUT bar trio with the SP marked on the PV
  scale, ▲▼ setpoint entry clamped to range, AUTO/MAN (output entry only in
  MAN — and the transfer is **bumpless**: AUTO resumes from the operator's
  output instead of kicking), plus the tag's standing alarms with per-alarm
  Ack. Run/Pause, 1×/5× speed, and Reset live in the toolbar; the status
  bar shows the sim clock.

## The operator workstation

RUN is not one screen — it is a workstation with six pages, reachable from a
bar that is always in the same place:

- **Overview** — the landing page when no screen is starred as home. Entirely
  derived from live runtime state, never generated once and left to go stale:
  process status, active / unacknowledged / critical alarm counts, equipment
  running and faulted, one card per process area showing what needs attention,
  key values grouped by quantity, and the standing alarms. A quantity the plant
  does not measure is **absent**, never shown as a dash.
- **Process** — the mimic screens, unchanged. Screen tabs, screen-link widgets,
  faceplates and the ★ home screen all work exactly as before, with a
  breadcrumb naming the screen in view.
- **Equipment** — every drive, valve and vessel the model contains, with state
  from the one `equipmentState()` machine, live flow or position, and its
  standing alarm. Filter by running / stopped / faulted; click through to the
  faceplate.
- **Alarms** — the full list with time, priority, tag, type, message, value,
  limit, unit, state and acknowledgement. Filter by state, priority or tag;
  acknowledge, shelve or take a tag out of service. It is a **view** of the one
  alarm engine: filtering changes nothing, and acknowledgement goes through the
  same command path the banner uses, so it lands in the journal either way.
- **Trends** — pick up to four signals from the compiled model (measurements
  under PROCESS, PV/SP/OP under CONTROL), over 1 / 5 / 15 / 60 minutes of the
  Step F history. Each pen is drawn against **its own engineering range**, so
  bar, %, m³/h and °C never share one misleading axis, and the page says so.
- **Diagnostics** — what every instrument is *doing*: live PV, unit, range,
  quality, what is producing it and when it last updated. A measurement with no
  process model behind it is listed as such rather than quietly reading a
  number.

The alarm banner stays above all of it as the compact always-available summary
— and renders nothing at all on a quiet plant. Clicking a tag anywhere (banner,
alarm list, overview, equipment, diagnostics) does the same thing: land on the
process screen that shows it, pulse the widget, and open its faceplate where
that is what was asked for.

## Widgets

Tank (animated level with LL/L/H/HH markers) · Pump (running state + spin) ·
Valve (on/off or throttling %, actuator stem) · Value display (with an
optional **sparkline** — ISA-101's "which way is it heading" mark) · **Bar
indicator** — the ISA-101 analog: a vertical scale with the PV as
pointer+fill, alarm limits as colored ticks and the SP as a caret · Gauge
(with warn/alarm zone arcs) · **Trend** — up to **4 pens** (the widget's tag
plus any `TAG.SIGNAL`, controller SP/OP included), a real process-time axis
that stays truthful at every training speed, **1 / 5 / 15 / 60 minute spans**,
each pen labelled in its own engineering unit, limit and SP lines, a period of
forced or bad history drawn **dashed** so it cannot read as ordinary data, and
a **hover cursor** that freezes the window and reads out every pen at that
instant · Lamp · Button · Switch · **Screen link**
(jumps to another screen in RUN) · Text · **Group panel** (titled frame for
sectioning the screen — grab it by its title or border) · **P&ID symbol** —
any of the catalog symbols as a graphic, so imported drawings never lose
equipment.

## Data quality

Every live value says where it came from. A number with nothing beside it is a
live simulated reading; anything else wears a badge — **glyph first**, never
colour alone — and the faceplate spells out why:

- **F FORCED** — an operator put this value here; it is not the process.
- **⧖ STALE** — the input is frozen and the value is not updating.
- **? UNCERTAIN** — the tag is out of service, or the measurement has **no
  process model behind it** (an unbound display wanders near its idle value,
  and now says so rather than presenting a confident number).
- **✕ BAD** — the reading is not valid. It shows **no number and no
  indicator** — no fill, no needle, no level — because a leftover value reads
  as a live one, and it raises a **BAD** diagnostic alarm.

## Tags and signals

Every widget binds to a **tag** (e.g. `TK-101`); the simulator derives its
signals: `.PV` (value), `.RUN` (motor), `.OP` (valve/controller output %),
`.OPEN` (on/off valve), `.SP`, `.MODE` (AUTO/MAN). Lamps, buttons and
switches bind to a fully-qualified signal like `P-101.RUN`.

**You never have to type a tag.** The Tag field is a picker: it lists every
identity in your P&ID — instruments with their ISA meaning spelled out
("FIC-101 · Flow Indicating Controller"), equipment, valves — plus tags
already used on other screens, filtered as you type (hyphens optional). The
Signal field offers every `TAG.SIGNAL` the runtime can actually serve. Free
text still works for tags that exist nowhere else.

**Ranges, units and alarm limits belong to the engineering record.** Where
`doc.registry` states a tag's `signal.range`, `signal.units` or its LL/L/H/HH,
that is what the simulation compares against **and** what every gauge, bar,
trend, tank and faceplate draws with — one resolver, one answer. The property
panel shows those fields read-only and points at the record. Where the record
says nothing, the widget's own values are still editable and still work
exactly as before.

Value displays, gauges, bars and trends also expose their **value source** in
the panel: tick **Controller** to make the widget a faceplate-capable
controller, or bind the value to the live plant with **Bind tank** / **Bind
pipe** — press **⊙ pick**, then click the tank or pipe right on the canvas
(Esc cancels). Unbound displays wander gently around their **Idle value**.

## The process model

**Everything is in real engineering units**, and they are stated once in
`sim/units.ts`: flow **m³/h**, volume **m³**, pressure **bar**, temperature
**°C**, level and valve position **%**, and time in **seconds of process
time**. A tank's level is genuinely volume over capacity —
`m³ = m³/h × s / 3600` — and its **capacity comes from the engineering record**
(`Volume` on the vessel's datasheet), never from how large the widget is
drawn. A pump's rated flow and head come from its `Capacity / flow` and `Head`
fields, a heater's duty from `Power`. Where a record says nothing the simulator
uses a stated default **and the Checks page says so**, so a vessel running on
an assumed 100 m³ is visible rather than silent.

Because the units are real, so are the timescales: a 100 m³ vessel on a
50 m³/h pump fills in two hours, not thirty seconds. The **speed control runs
1× / 10× / 60× / 300×** and the clock reads **h:mm:ss** — the multiplier
accelerates process time and nothing else, because every step longer than a
second is sub-divided internally, so the physics at 300× is the physics at 1×.

**Pressure** is a profile over the flows the network already solves: a pump
adds head off a quadratic characteristic (falling from shutoff to nothing at
rated flow, scaled by the affinity laws), a vessel's contents put static head
on its outlet, and line loss goes as flow². So **closing a valve raises the
discharge pressure** — less flow, so the pump rides up its curve — and lowers
it downstream, which is what makes a pressure loop controllable.
**Temperature** is a well-mixed energy balance per vessel: mixing with whatever
flows in, heater duty over the held volume, and a first-order loss to ambient.
A heater is **not** a pump — dropping one into a line adds heat, not flow.

It is a deterministic simplified model for training and testing, not a
hydraulic or thermodynamic solver: it does not iterate to a consistent
pressure field, does not conserve energy across a branch, and knows one fluid.
What it does guarantee is that every value an operator sees moved for a real
reason.

The rest is deliberately simple and honest about it: pumps deliver rated
flow through open valves, tanks integrate level, sources feed by pressure. **Headers and manifolds work**: a line
that fans out splits the pump's flow across its open legs by conductance
(closing one leg sends everything down the other — a proportional split,
not a pressure solve, and documented as such). Equipment has **dynamics** and **one state machine**:
`STOPPED → STARTING → RUNNING → STOPPING → STOPPED`, plus `TRIPPED` and
`DISABLED`. Pumps spin up over ~2 s and **coast down over ~3 s** (a coasting
pump is still moving liquid; a tripped one is not, because its breaker is
open). Throttling valves stroke toward their command at 25%/s — and if command
and position disagree too long, a **DEV deviation alarm** annunciates (a stuck
valve can't hide). Every drive prints its state **as a word as well as a
colour**, so state survives colour-blindness. The **⚡ Events** menu injects
training upsets — trip a pump (breaker opens, `TRIPPED` and a **high-priority
TRIP alarm** until reset from the faceplate), stick a valve, freeze a
transmitter, force a reading off scale, fail an instrument outright, plug the
busiest line — every one journaled, all undone by Reset. RUN starts **calm**, the way a real plant
hands over: pumps stopped, every hand valve in a flow path closed, undriven
throttling valves at 0% — nothing moves and nothing alarms until the
operator lines up valves and starts pumps (or a control loop acts). Lines
that dead-end without any valve can never drain a tank. Alarm limits (LL/L/H/HH) on tanks and
displays — **read from the engineering record whenever it states them** —
drive a blinking, acknowledgeable alarm banner with an
ISA-18.2-style lifecycle (active → acked / cleared) and **three priorities**
— high ■ red, medium ▲ orange, low ● yellow (shape *and* color, so priority
survives color-blindness; HH/LL ride one step above the H/L pair, and each
tag can override its priority). Alarms don't chatter: every limit has a
**hysteresis deadband** (default 1% of range, tunable) and an optional
**on-delay** so a value brushing its limit doesn't annunciate until it
means it. And they can be **suppressed the ISA-18.2 way**: **shelve** an
alarm for 5/15/30 minutes (it returns by itself), take a tag **out of
service**, and flow alarms on a line whose pumps are commanded off
suppress themselves (**suppressed by design**) — each with its own section
in the summary, a ⊘ badge on the widget itself, and journal entries for
every shelve/restore. The banner expands into a full **alarm
summary** — a real table (time, priority, tag, level, **value at trip**,
state, and the condition **in words**: "52.4 bar above 50 bar") with sortable
columns, priority filters and per-row Shelve / OOS / Ack — and a **journal** of every raise / return-to-normal / ack with its
sim time. Clicking an alarm's tag navigates to the screen that shows it
**and pulses the widget** so you see exactly which one it was.
The journal also records **every operator action** — `START`, `CLOSE`,
`SP 50 → 62`, `MAN` — the way a real DCS audit trail does (slider bursts
coalesce into one entry); filter it to Alarms or Commands and copy the
visible lines out with one click.

## Build from P&ID

**From P&ID…** converts sheets into HMI screens — pick any set of sheets in
one go, and optionally **generate a plant overview**: an auto-built L1
screen with one tile per sheet (its control loops, tank levels and flows as
live values, plus a Screen link that wears the alarm dot), starred as the
home screen so RUN opens on it. That completes the ISA-101 ladder: L1
overview → L2 unit screens → L3 faceplates → L4 trends. Per sheet, the
import works like this: vessels become tanks
(stretched vessels keep their stretched footprint, rotated pumps stay
rotated), pumps become pumps, control valves become throttling valves,
measurements become value displays bound to what their ISA family actually
measures — an `LT` finds its vessel through its impulse line, an `FT`/`FI`
finds its process run, while `TT`/`PI` (no bulk model) keep plausible demo
values with sensible units (`%`, `°C`, `bar`, `m³/h`). Controllers become
faceplate displays, process lines become pipes with the drawing's routing,
and signal lines are dropped — exactly what a real HMI shows. The import is
a **snapshot**: rearrange it freely. **Reconcile…** then shows what has
changed on the sheet since and lets you choose what to bring across, one
object at a time, keeping everything you have laid out. **Re-import** is
still there for when you genuinely want the screen rebuilt from scratch, and
it says plainly that it discards your layout.

Because tags are validated ISA tags, control loops wire themselves by family
and loop number **and by what each tag measures**: `LIC-101` finds `LT-101`
(PV) and `LV-101` (output) and actually holds the level at its setpoint in RUN
— switch it to MAN in the faceplate and stroke the valve yourself. The same
works for **pressure** (`PIC`/`PT`/`PV`) and **flow** (`FIC`/`FT`/`FV`), and a
**`TIC` with no valve in its loop finds the heater** that warms the vessel it
measures and modulates its duty. Each loop is tuned for the quantity it
controls — level and temperature are integrating processes and take a long
integral time, flow and pressure are fast and self-regulating — and the error
is normalised by the instrument's range, so a gain means the same thing on a
0-10 bar loop as on a 0-100 % one.

The ISA first letter is also what decides which process variable a transmitter
reads: `LT` takes a vessel's level, `PT` a line's pressure, `TT` a vessel's
temperature, `FT` a line's flow. **Measurement noise is only measurement
noise** — a small jitter added to a value the process actually produced, never
the reason a value changes.

## Process history

Trends are backed by a real, time-bounded history of what the plant did
(`sim/history.ts`). Two ring buffers per signal:

- **1 Hz for the last 5 minutes** — full detail for a 1- or 5-minute trend
- **0.1 Hz for the last hour** — an hour-long chart costs 360 stored points
  rather than the 18 000 a flat 1 Hz buffer would need

Capacity is measured in **time**, not samples, so the window a trend covers
does not change when the operator runs at 300×. Memory is fixed by
construction — about 11 KB per signal, 5.4 MiB for a 500-tag plant — and stops
growing once the buffers are full, whether the run lasts an hour or a day.

Nothing is averaged, interpolated or invented: every point on a chart is a
value the simulation actually produced, at the simulation time it produced it.
A 60-minute chart is thinned to about one point per pixel by **dropping**
samples, never by resampling them. Each sample also carries its **data
quality**, so a stretch when a transmitter was forced, stale or bad stays
visible in the trend. History is runtime state — it is never written into the
project document and never enters undo.

Timestamps are simulation time throughout: pausing records nothing and
resumes with no artificial gap, and **Reset** starts a fresh timeline with
nothing of the previous run left behind.

## The visual system

One set of semantic design tokens (`theme.ts`) drives everything: the SVG
process graphics take them directly, and every panel, table, control and
faceplate takes the same values as CSS custom properties. There are no colour
literals in any HMI component.

**Normal operation recedes.** Equipment at rest, lines carrying nothing and
values inside their limits are drawn in the surface and text tones. Saturated
colour is reserved for what an operator must act on, so when something does go
colourful it means something.

**One meaning per colour.** A stopped pump and a shut valve are a quiet
neutral — they used to be painted the same red as a critical alarm, so a
correctly shut-down plant looked like an emergency. Red now means abnormal,
in every component. Editor selection is deliberately far from every alarm tone
so a selected widget can never be mistaken for a faulted one.

**Colour is never the only carrier.** Every state that has a colour also has a
word, a glyph or a shape: pumps print `RUNNING` / `TRIPPED` / `DISABLED` under
the tag, alarm priority is a shape as well as a tone, out-of-service equipment
is hatched, and a degraded trend is dashed.

**Motion means the process is doing something** — a turning machine, flow at
the rate it is flowing, an unacknowledged alarm. Nothing else moves, and it all
stops under `prefers-reduced-motion`.

Per-screen theme toggle in the toolbar, and the whole workstation follows it:

- **Classic** — a restrained dark engineering ground for long shifts.
- **ISA-101** — light neutral grey with equipment in outline and colour used
  only for abnormal conditions, the arrangement that makes an alarm the only
  coloured thing on the screen.

## Assumed engineering values

Where nobody has stated a value, the simulation uses a documented default
rather than refusing to run. The defaults live in one place
(`sim/units.ts` `DEFAULTS`) and are never written back to the engineering
record.

| Quantity | Field | Default | Disclosed in the UI |
| --- | --- | --- | --- |
| Vessel capacity | `construction.volume` | 100 m³ | **Yes** — `tank-capacity-defaulted` |
| Pump rated flow | `duty.capacity` | 50 m³/h | No — see `docs/HMI-AUDIT.md` P1 |
| Pump shutoff head | `duty.head` | 4 bar | No |
| Heater duty | `duty.power` | 500 kW | No |
| Supply header pressure | — | 1 bar | Model boundary, documented here |
| Gravity / battery-limit flow | — | 20 m³/h | Model boundary, documented here |
| Ambient and supply temperature | `design.operatingTemperature` | 20 °C | Model boundary, documented here |

A measurement with no process model behind it is the one remaining fallback
that produces a *value*: it drifts around the middle of its range. It is
reported as UNCERTAIN with a reason, as `NO MODEL` on the Diagnostics page, as
a `missing-simulation-model` finding, and its trend is drawn dashed.

## Engineering diagnostics

The P&ID is the engineering source. The HMI is a snapshot of it that a person
then lays out by hand. Those two facts together mean the drawing and the
screens are *allowed* to diverge — so the job is not to prevent divergence but
to make it visible, explainable and repairable.

Seven categories, computed in one place (`model/diagnostics.ts`) and read by
three surfaces that therefore cannot disagree: the **Checks** workspace, the
operator station's **Diagnostics → Engineering** section, and the
**reconciliation** view.

| Category | What it means |
| --- | --- |
| **Missing tag** | An HMI object reads a tag nothing on any sheet carries. It still draws, reads nothing for ever, and says so nowhere. |
| **Broken connection** | A reference in the process model points at an endpoint that is not there — a measurement bound to a deleted line, a line anchored to deleted equipment, a P&ID line naming a symbol the sheet does not have. |
| **Missing instrument** | A bindable object on a sheet an HMI screen was *built from* that the screen does not show. |
| **Invalid range** | A calibrated range that does not ascend, or a physical quantity (capacity, rated flow, power) stated as zero or less. |
| **Invalid unit** | A unit that names a different quantity from the one the ISA letter says the tag measures. |
| **Missing simulation model** | The object is configured and the runtime can produce nothing for it: a measurement with no vessel or line behind it, or a device on no flow path. |
| **Unbound HMI object** | A widget that presents itself as a process object and is wired to nothing canonical. |

**Two severities, deliberately.** A diagnostic's own severity (ERROR /
WARNING / INFO) answers *can the operator layer work*. The Checks rule that
carries it declares a severity answering *does this stop the drawing being
issued* — and a house standard can gate issue on `critical`. They are
different questions, so the same dead HMI binding is an ERROR on the
Diagnostics page and a `warning` in Checks: an operator screen must never
block a drawing. That is why a category whose findings differ on the second
axis maps onto more than one rule; the mapping is data
(`DIAGNOSTIC_RULE_CATEGORY`) and a test fails if it drifts.

**Nothing is duplicated.** Where a rule already covered ground, this does not
speak: alarm limits out of order (`alarm-order`), a limit outside the range
(`alarm-outside-range`), an unreadable range (`range-unreadable`), a record
with nothing drawn (`orphan-record`), a line with a free end (`dangling-end`),
a vessel on an assumed capacity (`tank-capacity-defaulted`). `orphaned-binding`
kept its id, its keys and its severity and now delegates its detection here,
so an acceptance recorded before this existed still matches.

**Findings are deterministic.** Sorted by severity, then category, then tag,
then object id. No object iteration order, no render order, no random ids, no
runtime values, no clock — so the same project always produces the same
findings in the same order.

**Live and engineering are never mixed.** The Diagnostics page opens on the
live runtime table — what each instrument is reading, whether it can be
trusted, what is producing it — and the engineering section sits beside it,
reachable in one click, with a per-tag verdict in the live table's last
column. A transmitter can be reading perfectly and still have a unit that
names the wrong quantity; a single merged status column would hide both.
Specifically, **BAD QUALITY and MISSING SIMULATION MODEL are different
things**: a forced transmitter has a model an operator has overridden, one
with nothing behind it has no model at all, and both can be true at once.

**No diagnostic becomes an operator alarm.** The alarm system annunciates
process conditions. An engineering finding is not one, and turning validation
warnings into alarms is how an alarm list becomes noise.

**Cost.** Engineering diagnostics are recomputed when the *document* changes,
never on the simulation tick, and never at 5 Hz. They ride the existing idle
scheduler in `validate/live.ts` — the report lands a moment after an edit
rather than in front of it — and are cached per project index, so the ten rule
adapters and the Diagnostics page share one compile of the plant.

## Reconciliation

**P&ID → comparison → the operator chooses → the HMI stays hand-editable.**

`Reconcile…` in the HMI toolbar compares the current screen with the sheet it
was built from and reports four things: **added**, **removed**, **changed**,
**unchanged**. Nothing is applied by looking at it.

Three states, stated plainly:

- **Current engineering state** — the sheet, plus the registry records of the
  tags on it. Read live.
- **Current HMI snapshot state** — the widgets on the screen and the tags they
  are bound to. Read live.
- **Last reconciled state** — `screen.baseline`, a per-tag fingerprint of the
  engineering facts as they stood at the last import or apply.

Added and removed need only the first two, so they work on every screen.
**Changed** needs the third: a screen with no baseline reports no changes and
*says so*, rather than inventing a wall of differences the first time a project
is opened. A screen built before this existed gains a baseline the first time
anything is applied to it — nothing was reportable before, so recording the
present state accepts nothing.

The fingerprint covers range, unit, I/O type, system tag, setpoint, the four
alarm limits, priority, capacity, rated flow, head, power, service and the
drawn symbol. It deliberately excludes **everything runtime and everything
visual**: no PV, no history, no alarm state, no simulation clock, no widget
geometry, no document timestamp. Running the plant changes nothing in it, and
neither does dragging a widget across a screen.

**What can be applied, and what cannot:**

- **Add** — creates the HMI object the *importer* would have created (same
  widget type, same measurement binding, resolved through the pipes this
  screen already has), placed on a documented deterministic grid in a clear
  band below everything already on the screen. Nothing existing is moved to
  make room; you drag it where it belongs.
- **Remove** — deletes that widget, and only after it is explicitly chosen.
- **Remap** — points an existing widget at one of the tags this sheet *gained*,
  chosen from a list by the engineer. There is no default and no guess. It
  moves the widget's tag only: it is not a rename, the engineering record stays
  where it is, and `model/references.ts` remains the one mechanism that carries
  a record and every reference across a renaming.
- **Update** — records the current engineering data as the baseline. Choosing
  **Ignore** leaves it reportable next time, so an ignore never silently
  becomes an accept.
- **Ignore** — always offered, always the default.

A preview lists exactly what will happen, built from the same plan the apply
executes. Applying is **one document transaction**, so it is one undo step and
an undo restores the previous document exactly — widgets, baseline and all.
The simulation, the process history and the alarm list live outside the
document entirely, so reconciling a running plant cannot disturb it.

**Hand-laid work survives.** Existing widgets are never moved, resized,
relabelled or regenerated, and widgets you added yourself that are on no sheet
are never touched. A deleted P&ID tag produces a visible finding and the
decision — remove, remap or ignore — stays yours.

### Known limitations

- Reconciliation compares a screen with the **one sheet it was built from**. A
  hand-built screen and a generated overview have no engineering source and
  say so rather than comparing.
- A tag that moved to a different sheet is reported as removed from this one,
  with a message naming where it went.
- **Remap** offers only tags the same sheet gained. Rebinding a widget to
  anything else is the property panel's tag picker, with the whole plant to
  choose from.
- An added object arrives with the binding the importer would have given it
  where the screen has the pipe to resolve it against, and **unbound otherwise**
  — which the diagnostics then report, rather than the import inventing a
  binding.
- Reconciliation is an **edit-mode** action. An operator station does not
  reshape its own screens.

## The hydraulic model (new, not yet driving the runtime)

`sim/hydraulic/` is a canonical process topology and a coupled pressure/flow
solver, built and proven as a standalone module. It converges on every fixture
topology and on all three bundled samples. **It does not yet drive the running
simulation** — `sim/engine.ts` still uses the branch/conductance model
below it. What follows describes the new module and states exactly where it
stops; `docs/HMI-AUDIT.md` records why.

### Why it exists

The running solver decides flow first and derives pressure from it:

```text
Q = pump rating × speed × ∏(valve fraction)     then     P = f(Q)
```

Three things that cannot express. Flow is **linear in valve position**, which
is not what a valve does. **Junctions never balance**, because each
source-to-destination path is solved alone and a tee is two unrelated paths.
And **pressure cannot cause anything**, because it is computed after the thing
it is meant to cause. Flows are also non-negative by construction, so a line
can never reverse.

### What the new module does

```text
valve position → resistance → pressure field → flow → inventory
```

A pressure-node / flow-edge graph, compiled once per document
(`buildProcessModel`, 0.053 ms on the bundled sample) and solved each tick
(`solveHydraulics`).

- **Explicit ports.** Every piece of equipment offers named process ports —
  `suction`/`discharge`, `inlet`/`outlet`, `bottom`/`top` — and a stream
  attaches to a port, not to a rectangle. Where the P&ID states the port
  (`aPort`/`bPort`, carried across by the importer) that is used; otherwise the
  role comes from the end's position on the widget and is recorded as a
  lower-confidence attachment. A port fixes only *which node* a stream joins;
  **direction is an output of the solve**.
- **Two lines that merely cross do not connect.** Only an explicit attachment
  joins anything.

### The equations

| | |
| --- | --- |
| Resistive edge | `ΔP = R·Q·|Q|` ⇒ `Q = sign(ΔP)·√(|ΔP|/R)` |
| Valve | `R = K/f⁴`, so at fixed ΔP flow goes as `f²`; `f = 0` ⇒ `R = ∞` |
| Pump | `H = H₀·r²·(1 − (Q/(1.5·Qr·r))²)`, affinity laws: head as speed², capacity as speed |
| Shutoff | `H₀ = duty.head / (1 − 1/1.5²)` — `duty.head` is the head **at the rated flow**, as a datasheet states it |
| Vessel node | `P = P_supply + (level/100)·tankFullHeadBar` |
| Boundary | `P = P_supply` |
| Junction | `Σ Q_in − Σ Q_out = 0`, solved by damped Newton on nodal pressures |

Calibration: `PIPE_K = VALVE_K = 4e-4 bar/(m³/h)²`, sized so a 50 m³/h / 4 bar
machine through a three-run path with one open control valve settles at
**exactly 50.00 m³/h** — its duty point. It falls to 48.95 as the receiving
vessel fills, 28.47 at a half-open valve, 5.34 at 20 %.

### Assumptions, stated

One incompressible fluid at one density. No vapour, no phase change, no
compressibility. No elevation except a vessel's own liquid head. Quasi-steady:
re-solved each tick against current inventories and positions, with no
transient acoustics. **A stopped pump blocks** — the model assumes the
discharge check valve a pumped system carries, rather than modelling one. A
free pipe end is a boundary at supply pressure: it can supply and it can
receive. Pipe resistance is a calibrated constant, not a calculation from
diameter and length, because an HMI pipe carries neither.

Two numerical compromises, both because `√` has infinite slope at zero:
resistive flow is linear below `LINEAR_DP = 1e-4 bar`, and the pump curve is
linear within `PUMP_EPS = 1e-4` of shutoff — which is exactly where a machine
sits when the path in front of it is shut. Flows below `ZERO_FLOW = 1e-9 m³/h`
report as exactly zero, so a dead line is dead.

### Numerical method

Damped Newton on nodal pressures with a **backtracking line search**: the full
Newton step first, halved until the residual norm actually falls (Armijo, slack
`1e-4`, floor `λ = 1/1024`). A step is never accepted for merely being finite.
The Jacobian is numerical, perturbation `1e-6 bar`, which sits well inside
every linearised region so a derivative is never taken across a kink.

**The iterate is never clamped.** Clamping it into `[0, 64] bar` was what made
branched networks unsolvable: two legs of a tee draw more than one supply line
delivers, so the true suction is *below* the boundary, and the clamp pinned the
iterate at zero where no step could improve the residual. A sub-atmospheric
suction is a real operating condition — it is what NPSH is about. Nodes the
solve puts below absolute zero are reported in `cavitating` and must be
presented as INVALID rather than as a reading.

A free node with no path to any fixed node has no pressure *level*, so its
Jacobian block is singular. Those are frozen at supply pressure and named in
`undetermined`, rather than one disconnected fragment making the whole plant
unsolvable — which is what happened to the refinery sample (12 such nodes).

**Warm start** reuses a previous converged pressure field, and only for nodes
it names. It halves the iteration count and cannot change the answer; a test
pins warm against cold.

### Convergence, measured

| Network | Nodes/edges | Iterations | Residual |
| --- | --- | --- | --- |
| `template-hmi-demo` | 10 / 8 | 6 (warm 3) | 1.4e-13 |
| `sample-plant` | 20 / 16 | 6 (warm 3) | 1.6e-8 |
| `sample-refinery-unit` | 43 / 31 | 6 (warm 3) | 1.6e-8 |

All sixteen fixture topologies converge — series, tee, merge, unequal branches,
parallel pumps, recirculation, reversal, zero-flow equilibrium, stopped pump,
closed branch — each verified on node mass balance **and** on every edge's own
constitutive equation, re-derived independently from the solved pressures.

Cost: `buildProcessModel` 0.05–0.09 ms once per document; `solveHydraulics`
0.04–0.22 ms cold, 0.005–0.022 ms warm.

### Where it stops

The solver is trustworthy; it is **not yet wired into the runtime**, and that
is the next phase's work. `engine.ts` still runs the branch/conductance model.
