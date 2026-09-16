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

**Pressure causes flow, and it is solved rather than profiled.** Every tick
the runtime builds the network's pressure field by damped Newton and reads the
flows off it:

```text
valve position → resistance → pressure field → flow → inventory
```

A pump adds head off a quadratic characteristic (scaled by the affinity laws),
a vessel's contents put static head on its bottom nozzles, and line loss goes
as `ΔP = R·Q·|Q|`. So **closing a valve raises the discharge pressure** — less
flow, so the pump rides up its curve — and lowers it downstream, which is what
makes a pressure loop controllable. The full description, equations, assumptions
and measured convergence are under [The hydraulic model](#the-hydraulic-model).

Three things follow that the previous conductance model could not express.
Flow is **not linear in valve position**. **Junctions balance**, so a tee is
one network rather than two unrelated paths. And a line **can reverse**: a
vessel that was being filled a moment ago drains back down the same pipe when
the pressures say so, and the runtime carries the sign.

**Temperature** is a well-mixed energy balance per vessel: mixing with whatever
flows in, heater duty over the held volume, and a first-order loss to ambient.
A heater is **not** a pump — dropping one into a line adds heat, not flow.

It is a deterministic simplified model for training and testing. It solves one
incompressible fluid, quasi-steady, with no phase change, no compressibility
and no elevation except a vessel's own liquid head — and it says so rather than
implying rigour it does not have. What it does guarantee is that every value an
operator sees moved for a real reason, and that where it cannot determine one
it **says so** instead of printing a plausible number.

Tanks hold a **volume**, and level is derived from it — not the other way
round. A full vessel refuses inflow and an empty one refuses outflow, as a rule
on the edges at its nozzles, so mass is never quietly destroyed by a clamp.
Equipment has **dynamics** and **one state machine**:
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
operator lines up valves and starts pumps (or a control loop acts). An
unvalved line off a vessel **does** drain it, because there is nothing in it to
stop the flow — the `dangling-end` diagnostic objects to drawing one, which is
the right place to object. Alarm limits (LL/L/H/HH) on tanks and
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

## The process view

The operator workstation carries two pictures of the plant, and they answer
different questions.

| | **Mimic** | **Process flow** |
| --- | --- | --- |
| Geometry | the P&ID's own | laid out from the topology |
| Answers | *where is this on the drawing?* | *what is the fluid doing?* |
| Built from | the HMI screen | `ProcessModel` → `sim/processView.ts` |

A P&ID is routed for drafting — long runs to keep a sheet tidy, crossings,
instrument bubbles floated out to where they fit — and none of that says
anything about the order the fluid passes through things. The **Process flow**
page derives a second presentation of the same engineering model:

```text
P&ID  ->  ProcessModel (canonical)  ->  ProcessViewModel  ->  renderer
                 ^                             ^
          the one topology              layout + bindings only
```

**It is not a second topology.** Every node and edge on it carries the id of
the `ProcessModel` node or edge it came from; nothing is invented and no
connectivity decision is taken there. Delete the file and the plant still runs.

**The graph is inverted, deliberately.** In the hydraulic model a pump or a
valve is an EDGE — a conductor between two pressure nodes — because that is
what it is to a solver. To an operator it is a thing you look at and click, and
the pipe is the line between things. So each device edge collapses into a box
that absorbs its two port nodes, each pipe edge becomes a line, and a vessel's
nozzles collapse into one vessel. The result reads

```text
SUPPLY -> P-101 -> [FT-101] -> FV-101 -> [PT-101] -> T-101 -+-> TK-A -> LV-101 -> BOUNDARY
SUPPLY -> HV-102 ------------------------------------------+-> TK-B
```

Objects are ranked by the **longest** path from anything with nothing feeding
it, so a junction sits after everything that feeds it rather than beside one of
them, and lanes are ordered by what feeds them so branches stay near the object
they came off.

### What is drawn, and where it comes from

| On screen | Read from |
| --- | --- |
| Flow direction | the **sign** of `pipeFlows[pipe]` — never the drawn direction |
| Flow animation | present only while `abs(q) > SHUT_LEAK_MAX`; speed from the magnitude; reversed when the sign is negative |
| An FT | its own tag's PV, which the engine took from **its** edge — never a branch total |
| A PT or gauge | its own tag's PV, from the solved pressure of **its** line |
| A valve | position **and** flow, side by side and never conflated |
| A pump | `STOPPED / STARTING / RUNNING / STOPPING / TRIPPED / DISABLED`, speed, and what it is actually passing |
| A vessel | level from inventory, the volume held against its stated capacity, temperature |
| A boundary | `SUPPLY` or `DESTINATION` **decided at runtime** by which way its line is running |

**An inline instrument sits in its run**, on a small plate with a stem down to
the pipe, because where a reading is taken is process information. A
transmitter floated off to one side is a number with no place. Nothing bound to
a pipe or a vessel is ever dropped for being "only a measurement"; an unbound
display is *not* placed, because it has no process location, and data quality
already reports it as having no model behind it.

### What a stream carries

Every process line has a SERVICE, and it comes from the drawing. The P&ID's
fluid assignment (`doc.fluids`, `PlantEdge.fluidId`) is carried across by the
importer and propagated through the canonical topology by `sim/fluids.ts`, using
the rule the P&ID itself uses: a service travels along a **run** — pipe carried
through two-port hardware — and a run ends where the pipe branches or enters a
vessel.

| | |
| --- | --- |
| A run the drawing gives a service | IS that service |
| An unstated run touching one service | takes it |
| An unstated run touching **two** | **MIXED**, and the junction is a mixing point |
| Anything downstream of a mixture | the mixture |
| Across a vessel | nothing — a tank's contents are its own, so the far side is UNKNOWN unless stated |

It is **static and direction-free**. A reversed water line is still water; the
derivation is never handed a flow.

**Mixing is explicitly unsupported.** A mixed stream carries what it is made of
— the component services, by name — and nothing about how it behaves. No
density, no viscosity, no heat capacity is computed for a mixture, because this
model has no mixture physics and will not pretend to.

**Only water has properties**, and that is the honest state rather than a gap.
1000 kg/m³, 1.0 mPa·s, 4.186 kJ/(kg·K) at 20 °C and 1 atm — and the thermal
model's own `LIQUID_CP_KJ_PER_M3_K` is exactly the product of the first and the
third, so there is one answer and not two. A density for Steam, Air or Gas needs
a pressure and a temperature this model does not carry; Slurry and Fuel / Oil
are whatever a project says they are.

**Fluid identity is informational.** The hydraulic solver does not know a fluid
exists, and a test solves the same plant with and without services stated and
requires every pressure and every flow to be identical. Wiring density into the
hydraulics is a physics change and would have to be validated as one.

### Colour stays separated

The only saturated colour on the page is an **alarm**. Equipment state is drawn
with fill and a word; **quality** is drawn on the outline, as a dash pattern,
plus its glyph. A **service** tints the static pipe from a closed palette of six
theme tokens with **no warm hues in either theme** — red, orange and yellow
belong to the alarm system. Cool hues alone cannot hold six services apart, so
they differ in lightness too. The moving overlay keeps the neutral flow tone, so
what a line carries never blurs with whether it is moving. The banner that reports a solve which cannot stand behind its
numbers carries the quality glyph and a dashed rule — deliberately *not* an
alarm colour, because teaching people that orange can mean "the software is
unsure" is how an alarm system stops working.

`fluidId` is a real identity as of K5 — see *What a stream carries* above.
There is still no mixing physics, and the view invents none.

### Static and dynamic are separated

`simStore.processView` holds the nodes, edges and **layout**, built once in
`enterRun` and never touched by a tick — topology and geometry change when the
drawing does; flow, pressure, level and quality change five times a second.
Measured: 0.035 ms to build on the K4 fixture, 0.11 ms on
`sample-refinery-unit`, 0.88 ms on a synthetic 500-widget plant. A tick costs
0.10 ms and the layout object's identity is unchanged across hundreds of them.

### It is read-only

The view reads flow, pressure, equipment state, measurements, quality and
alarms. It writes nothing. Clicking an object hands back the **canonical tag**,
so the faceplate it opens is the one every other surface opens — there is no
runtime identity of its own anywhere in it.

## The hydraulic model

`sim/hydraulic/` is a canonical process topology and a coupled pressure/flow
solver, and **it is what the running simulation runs on**. Every flow, every
pressure and every vessel inventory in the product comes out of it. There is no
second flow calculation anywhere: the conductance model it replaced has been
removed rather than kept alongside.

### Why it exists

The solver it replaced decided flow first and derived pressure from it:

```text
Q = pump rating × speed × ∏(valve fraction)     then     P = f(Q)
```

Three things that cannot express. Flow was **linear in valve position**, which
is not what a valve does. **Junctions never balanced**, because each
source-to-destination path was solved alone and a tee was two unrelated paths.
And **pressure could not cause anything**, because it was computed after the
thing it was meant to cause. Flows were also non-negative by construction, so a
line could never reverse.

Worse than any single one of those: there were **two sources of truth**. The
conductance model produced the branch flows the HMI drew, and the pressure
profile produced the numbers the transmitters read, and nothing constrained the
two to agree. A valve could be shut in one and passing in the other.

### What the module does

```text
valve position → resistance → pressure field → flow → inventory
```

A pressure-node / flow-edge graph, compiled once per document
(`buildProcessModel`, 0.053 ms on the bundled sample) and solved each tick
(`solveHydraulics`).

- **Explicit ports.** Every piece of equipment offers named process ports —
  `suction`/`discharge`, `inlet`/`outlet`, `bottom`/`top` — and a stream
  attaches to a port, not to a rectangle. A port fixes only *which node* a
  stream joins; **direction is an output of the solve**.

  Where the P&ID states the port (`aPort`/`bPort`, carried across by the
  importer) **that is what is used, wherever the line happens to be drawn**. A
  nozzle the drawing calls `top` stays the vapour space even if the line is
  drawn low on the shell, and `vent`/`drain` are read as `top`/`bottom` — they
  are not roles of their own, because the solver treats every opening alike and
  saying otherwise would be a claim it does not honour.

  A name is only a role **on equipment that offers it**: `suction` describes a
  machine, so a line landing on a tank carrying that word is not a statement
  about the tank, and the model declines to read it as one. Generic names ask
  the kind — `in` on a pump is its suction, on a vessel its top nozzle.

  Where the drawing states nothing this model can act on — including a compass
  id like `n`, which points at the floor on a vessel rotated 180° — the end's
  position decides, and the attachment is **recorded as inferred** rather than
  passed off as stated.
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

**Blocked elements are steep, not infinite.** A shut valve, a stopped pump and
a full vessel's inlet all carry a huge FINITE resistance (`SHUT_FRACTION`,
`GATE_LEAK`) rather than exactly nothing. An infinite resistance has a zero
derivative, and Newton cannot determine the pressure of a node whose only live
connection carries no flow and has no slope — a dead end behind a closed valve
made the whole solve singular, and a full vessel with a line just above it
trapped it a thousandth of a bar short. Twelve orders of conductance down
passes about 5e-5 m³/h at a full bar: shut as far as any observer can tell, and
still differentiable. The exponent is a conditioning choice as much as a
physical one — sixteen orders stalled the line search.

**A full vessel refuses inflow; an empty one refuses outflow.** Stated as a
constitutive rule on the edges at its nozzles, because a vessel with no vent
and no overflow cannot take more than it holds. Without it the inventory clamp
silently destroyed the mass that kept arriving at a full tank.

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
it names. It halves the iteration count. It does not change the answer beyond
the precision a converged solve is defined to — two converged solves of the
same network agree to within `MASS_TOL`, measured at 6e-5 m³/h — and a test
pins warm against cold.

### Convergence, measured

| Network | Nodes/edges | Iterations | Residual |
| --- | --- | --- | --- |
| `template-hmi-demo` | 10 / 8 | 5 (warm 2) | 2.7e-7 |
| `sample-plant` | 20 / 16 | 6 (warm 2) | 1.6e-8 |
| `sample-refinery-unit` | 43 / 31 | 6 (warm 2) | 1.6e-8 |

**Tolerances, measured rather than claimed.** `MASS_TOL = 1e-4 m³/h` is the
documented acceptance; the worst junction residual across every fixture and all
three samples is **2.7e-5**, and the worst edge-equation residual is
**1.6e-6** — a tenth of a millilitre an hour, parts per million of a typical
duty. The solve reaches 1e-8 on well-conditioned networks and around 1e-5 on
one with a dead end behind a shut valve, where twelve orders separate the
stiffest edge from the slackest.

All sixteen fixture topologies converge — series, tee, merge, unequal branches,
parallel pumps, recirculation, reversal, zero-flow equilibrium, stopped pump,
closed branch — each verified on node mass balance **and** on every edge's own
constitutive equation, re-derived independently from the solved pressures.

Cost: `buildProcessModel` 0.03–0.07 ms once per document; `solveHydraulics`
0.03–0.28 ms cold, 0.004–0.022 ms warm.

### How the runtime uses it

`engine.ts` calls `solveHydraulics` once per sub-step and takes everything from
the result:

| Consumer | Reads |
| --- | --- |
| A vessel's inventory | the SIGNED flow across its own nozzle edges, integrated as `m³ = m³/h × s / 3600` |
| An `FT` bound to a line | that line's edge flow, magnitude — a flow element does not know which way round it was installed |
| A `PT` bound to a line | the mean of its edge's two node pressures |
| The operator screen | `pipeFlows`, SIGNED, so a reversed line animates the way it runs |
| The thermal model | branch magnitudes, derived from the same numbers rather than computed again |

**Warm start.** `simStore` carries the previous converged pressure field into
the next solve, and each sub-step of a fast tick starts from the one before it.
It is an optimisation and nothing more — it halves the iteration count, and the
answer it lands on agrees with a cold solve to within `MASS_TOL`, which is the
precision a converged solve is defined to. It is cleared on RUN, on RESET and
on leaving a run, because a different plant's field is not a guess.

### What the runtime says when it cannot answer

The solve reports its own limits, and the product carries them to the operator
rather than printing the float anyway. `simStore.hydraulic` publishes
`converged`, `residual`, `iterations`, `cavitating` and `undetermined`, and
data quality degrades on all three:

| Solver flag | Quality | What the operator is told |
| --- | --- | --- |
| `converged: false` | **BAD** — the number is hidden, dashes are shown | *No hydraulic solution — mass is not balanced* |
| node in `cavitating` | **UNCERTAIN** | *Suction below absolute zero — the model cannot represent this* |
| node in `undetermined` | **UNCERTAIN** | *No path to a pressure boundary — pressure level is undetermined* |

A measurement bound to a line inherits its edge's two nodes; a level inherits
its vessel's nozzles, because its inventory was integrated across them.

### Before it runs: can the suction supply the pump?

A pump's rated flow comes from the engineering record; the path that has to
deliver it comes from the P&ID. Two Checks rules ask whether the two are
compatible, on the drawing, before anybody runs it:

| Rule | Fires when |
| --- | --- |
| `pump-suction-unsupplied` | the suction reaches no vessel and no boundary — nothing can arrive at all |
| `pump-suction-insufficient` | at the **rated flow**, the drawn suction path needs more pressure than its source has |

**This is not an NPSH calculation and never says it is.** NPSHa needs the
fluid, its vapour pressure at the pumping temperature, its density and the
static lift; NPSHr needs the machine's own NPSH curve. The model holds none of
them. What it computes is hydraulic capacity: walking the canonical topology
for the lowest-resistance route to a source and applying the model's own
`ΔP = R·Q·|Q|`, the most that path can pass is `√(P_source / R)`. A duty
**strictly greater** than that is arithmetically unachievable, and that is the
only claim made.

The threshold is the physics rather than a chosen number, and it has to be,
because of an identity worth knowing about this model:

```text
√(supplyPressureBar / PIPE_K) = √(1 / 4e-4) = 50 m³/h = DEFAULTS.pumpFlowM3h
```

`PIPE_K` was calibrated against that same default machine, so **the default
pump on a single-run suction sits exactly at capability** — zero margin, by
construction. Any margin added to the check would therefore fire on it and on
every drawing like it, for a reason no draughtsman can fix. Where "enough
margin" begins is precisely the question NPSH answers and this model cannot, so
it declines to guess and reports only the unachievable case.

`SolveResult.cavitating` is the live counterpart, at whatever the plant is
doing now; it feeds data quality as above.

### Where the pressures are fixed

Every hydraulic network needs somewhere its pressures are given rather than
solved. This model has three, and each says which physical condition holds it:

| `BoundaryKind` | Where it comes from | Pressure |
| --- | --- | --- |
| `atmospheric` | a **free pipe end**, or a terminal whose record says nothing | one atmosphere |
| `fixed-pressure` | a **tagged terminal** — a battery limit | the operating pressure on its record |
| `vessel-vapour` | a vessel's top/vent nozzle | the vessel's operating pressure if its record states one; **atmospheric** if not |
| `vessel-liquid` | a vessel's bottom/drain nozzle | that, plus the static head of the liquid above it |
| `internal` | everything else | solved |

Which nozzle a line lands on is the **stated** role wherever the drawing states
one — never re-decided from where the line was drawn.

A vessel whose engineering record gives `design.operatingPressure` is **closed**
at that pressure; one that states nothing is **vented**. Silence means vented,
not unknown. It is never taken from `design.pressure`, which is a rating — what
the vessel withstands, not what it runs at. An operating pressure is read as
**gauge** unless the unit says otherwise (`3 bar` and `3 barg` both mean 4 bar
absolute; `3 bara` means 3), because that is what a datasheet means by it.

**There is no SOURCE and no SINK.** Which end of a line supplies and which
receives is an outcome of the solve — the sign of the flow — and a passive
boundary reading `DESTINATION` when a pump overpowers it is that working, not a
defect to paper over.

**A fixed-pressure node has unlimited capacity.** The air absorbs whatever
arrives and is still one atmosphere however hard it is pushed. There is no
reservoir model; a boundary is a pressure, not an inventory.

### Terminals — where the drawing stops at a known condition

A **free pipe end is atmospheric** and can be nothing else: it has no tag, so no
engineering record, so nothing to state a pressure with. An unterminated line
cannot push, and a boundary cannot fill a vented vessel.

Draw a **Battery Limit / Terminal** instead and it can. It is a tagged piece of
equipment with one process connection, and the hydraulic model holds that
connection at the `design.operatingPressure` on its record:

```text
BL-101   Battery Limit — Feed   3 barg   →   held at 4 bar absolute
```

`3 barg`, `3 bar` and `3` all mean gauge — that is what a datasheet means by an
operating pressure — and `4 bara` means absolute. It is never taken from
`design.pressure`, which is a rating.

A terminal states a **pressure**, never a direction. Two terminals at 3 and
1 barg drive flow one way; swap the two records and the same drawing runs the
other way, because the solver decides. A terminal held below the plant is a
destination and one held above it is a supply, and which is which is the sign of
the flow.

It is **not a vessel** — no volume, no level, no inventory — and **not a pump**:
it holds a pressure rather than adding head.

A terminal that is tagged but whose record states no pressure, or an unreadable
one, is held at atmosphere so the plant still runs and is **reported** by the
`terminal-no-pressure` and `terminal-bad-pressure` checks. A free end is not
reported: the drawing never claimed anything about it.

Terminal pressure is **static** — the engineering record defines it, and there
is no operator control for it.
