# Design Page — UX regression checklist

Run this after any change to the Draw workspace. Most rows are covered by an
automated spec; those name it, and running the spec is enough. The rows with
**(manual)** are the ones a test cannot judge — they are about whether a person
can *find* the thing, which is exactly what the automated suite is blind to.

The order is a user's order, not the code's: it walks the journeys an engineer
actually performs, so running it top to bottom is itself a usability pass.

```
npm test && npx playwright test
```

---

## A. First drawing (Journey A)

| Check | Covered by |
|---|---|
| An empty sheet leads with a way in, not the project form | `deadends.spec.ts` |
| "Find a symbol" puts the cursor in the palette search, opening the panel if collapsed | `deadends.spec.ts` |
| Clicking a palette symbol places it, selected | `deadends.spec.ts` |
| Dragging a palette symbol places it where dropped | `autoconnect.spec.ts` |
| Guidance disappears once the sheet has a symbol on it | `deadends.spec.ts` |
| **(manual)** A first-time user can place and connect two symbols with no instruction | — |

## B. Component placement (Journey B)

| Check | Covered by |
|---|---|
| Search by shortcut (`fic`) and by full name (`level switch high`) | `palette.spec.ts` |
| Enter in the search field places the top hit, pre-tagged | `palette.spec.ts` |
| ↓ from search enters the tile grid; arrows rove; Enter places; Esc returns | `deadends.spec.ts` |
| Tiles stay out of the tab order (the search field is the one stop) | `deadends.spec.ts` |
| Instrument presets collapse to the workhorse row and expand on Show all | `palette.spec.ts` |

## C. Connections (Journey C)

| Check | Covered by |
|---|---|
| Port-to-port drag connects and picks a legal line class | `interactions.spec.ts` |
| Only legally reachable ports ring during a link drag | `portnames.spec.ts` |
| Magnetic docking connects mid-drag, at a standoff | `autoconnect.spec.ts` |
| Shake mid-drag disconnects and does not re-catch | `autoconnect.spec.ts` |
| A short accidental drag near a port leaves no ghost stub | `interactions.spec.ts` |
| A free end dropped on a pipe becomes a branch tap with a junction | `interactions.spec.ts` |
| Crossing lines hop | `jumpover.spec.ts` |

## D. Editing (Journey D)

| Check | Covered by |
|---|---|
| Move, rotate (`R`), duplicate (`⌘D`), delete — from keyboard | `interactions.spec.ts`, `contextmenu.spec.ts` |
| The same four from the context menu, running the same code | `contextmenu.spec.ts` |
| Delete is offered for one symbol as well as for many | `contextmenu.spec.ts` |
| Per-axis stretch is present behind the "Stretch one axis" disclosure | `interactions.spec.ts` |
| Every edit is one undo step, including a whole docking gesture | `interactions.spec.ts` |
| Undo restores the selection ring on the restored cell | `interactions.spec.ts` |

## E. Multi-object editing (Journey E)

| Check | Covered by |
|---|---|
| `⌘A` selects symbols **and** lines; Escape clears | `deadends.spec.ts` |
| Marquee from blank paper selects; Shift extends | `interactions.spec.ts` |
| A group drag moves rigidly, with the lines between them | `interactions.spec.ts` |
| Align and distribute from the context menu | `contextmenu.spec.ts` |
| Right-clicking one of several keeps the whole selection | `contextmenu.spec.ts` |

## F. Navigation (Journey F)

| Check | Covered by |
|---|---|
| Wheel zoom about the pointer; Space-drag and middle-drag pan | `zoom.spec.ts` |
| `Shift+F` fits; `Shift+1` returns to 100% (any keyboard layout) | `shortcuts/registry.test.ts`, `zoom.spec.ts` |
| Fit stays correct with panels open, closed, or mid-resize | `zoom.spec.ts` |
| Above 400 cells the paper virtualizes; export still emits every symbol | `virtualization.spec.ts` |
| Zooming repeatedly leaves the canvas no slower | `zoomchurn.spec.ts` |

## G. QA (Journey G)

| Check | Covered by |
|---|---|
| The Issues tab count equals the rows the panel lists | `deadends.spec.ts` |
| Findings the panel hides are still accounted for in a footer line | `deadends.spec.ts` |
| The rail badge counts criticals only | `qa.spec.ts` |
| A finding locates its object back on the sheet | `navigation.spec.ts` |
| Accepting a finding records the reason and survives reload | `qa.spec.ts` |

## H. File workflow (Journey H)

| Check | Covered by |
|---|---|
| New / Open / Download / history / templates / underlay all reachable in **File** | `menus.spec.ts`, `helpers.ts` |
| Anything replacing the document asks first when there are unsaved changes | `happy-path.spec.ts` |
| Export and the account control never scroll off the toolbar | `menus.spec.ts` |
| Export menu stays anchored while the toolbar row is scrolled | `menus.spec.ts` |
| SVG / PDF / PNG / DXF / DEXPI / the three CSVs still produce files | `happy-path.spec.ts` |

## H2. Command palette and component discovery

| Check | Covered by |
|---|---|
| Opens on ⌘K/⌘F, searches, runs, closes, restores focus | `palette-commands.spec.ts` |
| Commands offered match what the selection can actually do | `palette-commands.spec.ts` |
| A line offers line commands and no symbol commands | `palette-commands.spec.ts` |
| The palette runs the same functions the keyboard runs | `palette-commands.spec.ts` |
| Found by abbreviation, keyword and shortcut text | `palette-commands.spec.ts` |
| A symbol can be searched by intent and placed, selected | `palette-commands.spec.ts` |
| "heat exchanger", "globe valve", "flow transmitter" all find something | `palette-commands.spec.ts` |
| No-match state names what was typed and suggests a next try | `palette-commands.spec.ts` |
| Recent is earned by placing only, capped at 8, newest first | `palette-commands.spec.ts` |
| Favourites set, persist across reload, and come off again | `palette-commands.spec.ts` |
| Neither ever changes a byte of the drawing | `palette-commands.spec.ts` |
| Similar symbol labels are distinguishable, not all "Control Valv…" | `palette-commands.spec.ts` |
| C connects where points meet; says so when nothing is in reach | `palette-commands.spec.ts` |
| Toolbar, context menu and palette placement still work | `palette-commands.spec.ts` |
| **(open)** "Connect to <tag>" — blocked on port metadata, see below | — |

## I. Discoverability and keyboard

| Check | Covered by |
|---|---|
| `?` opens the shortcut sheet from any workspace | `deadends.spec.ts` |
| The sheet lists every binding in the registry, keys and gestures alike | `deadends.spec.ts`, `shortcuts/registry.test.ts` |
| No combination is bound to two actions | `shortcuts/registry.test.ts` |
| Context-menu rows print the key that does the same thing | `contextmenu.spec.ts` |
| The command palette opens on `⌘K` and `⌘F` and runs commands | `navigation.spec.ts` |
| **(manual)** Every new control states its shortcut where one exists | — |

## J. Errors and recovery

The rule: what happened → why (only when the app actually knows) → what to do
next. And the least disruptive surface that communicates it — a mark on the
canvas before a status line, a status line before a dialog, a dialog before a
question.

| Check | Covered by |
|---|---|
| A refused connection is marked at the point, and leaves no stub line | `errors.spec.ts` |
| A legal connection is unaffected by the refusal check | `errors.spec.ts` |
| A deliberate free end (vent, off-page) is still allowed | `errors.spec.ts` |
| The refusal names the two kinds, and the rule matrix is unchanged | `feedback/errorModel.test.ts` |
| A corrupt file and a not-a-drawing file get different messages | `errors.spec.ts`, `feedback/errorModel.test.ts` |
| A failed open leaves the open drawing untouched | `errors.spec.ts` |
| An unknown cause is reported as unknown, never invented | `feedback/errorModel.test.ts` |
| A DXF failure claims no knowledge of paper space | `feedback/errorModel.test.ts` |
| A failed export says the drawing is safe and offers retry | `errors.spec.ts` |
| A failed save keeps `dirty` true and offers retry | `feedback/errorModel.test.ts` |
| Accepting a finding requires a reason and shows the finding | `errors.spec.ts` |
| Cancelling an acceptance records nothing | `errors.spec.ts` |
| A failed QA fix reports rather than failing silently | `qa.spec.ts` |
| Dialogs trap focus, close on Escape, and restore focus | `errors.spec.ts` |
| The status line never takes focus | `errors.spec.ts` |
| Dialogs survive a text selection dragged past their edge | `feedback.spec.ts` |
| Escape closes the context menu without acting | `contextmenu.spec.ts` |
| Deleting a sheet is undoable, as the status line claims | `store/sheetUndo.test.ts` |
| **(manual)** Every new failure path says what happened, why, and what to do | — |
| **(open)** The feedback dialog's own discard prompt is still `window.confirm` | — nested modal |

## K. Performance budget

Run `PERF=1 npx playwright test e2e/perf.spec.ts` and compare against the last
recorded figures. The drag must hold ~60 FPS at every size, and **store writes
during drag must stay at 3** — a number above that means a new subscription is
writing inside the gesture.

| Check | Covered by |
|---|---|
| 60 FPS dragging at 50 → 1000 objects | `perf.spec.ts` |
| Pointermove handler mean under ~0.5 ms at 1000 objects | `perf.spec.ts` |
| A long editing session leaves memory flat | `perf.spec.ts` |
| Zoom churn leaves no permanent slowdown | `zoomchurn.spec.ts` |
| No new always-mounted component subscribes to the whole document | **(manual)** — grep for `useStore((s) => s.doc)` |

## L. Accessibility

| Check | Covered by |
|---|---|
| The canvas is one tab stop, named, with a visible focus ring | `keyboard.spec.ts` |
| Tab walks the drawing in reading order; Shift+Tab reverses | `keyboard.spec.ts`, `canvas/keyboardNav.test.ts` |
| Escape clears, then Tab leaves — no keyboard trap (WCAG 2.1.2) | `keyboard.spec.ts` |
| Enter opens properties and puts focus in them; Escape returns | `keyboard.spec.ts` |
| Shift+F10 opens the context menu, focused; closing returns focus | `keyboard.spec.ts` |
| Placing a symbol moves focus to the drawing, not the search box | `keyboard.spec.ts`, `deadends.spec.ts` |
| Escape in the palette search returns to the drawing | `keyboard.spec.ts` |
| Keyboard and pointer share one selection | `keyboard.spec.ts` |
| The whole canvas is two accessibility nodes, at any drawing size | `keyboard.spec.ts` |
| The selection is announced with its tag and position | `keyboard.spec.ts`, `canvas/keyboardNav.test.ts` |
| Focus is visible on every control that can take it | **(manual)** |
| Dialogs trap Tab and restore focus to whatever opened them | `feedback.spec.ts` |
| Reduced motion stops the docking animations | **(manual)** — CSS `prefers-reduced-motion` block |
| Body and caption text clears 4.5:1 on its own surface | **(manual)** — see `--c-ink-3` |
| Arrow nudge still nudges; arrows with nothing selected step in instead | `keyboard.spec.ts` |
| **(open)** Multi-selection by keyboard is Select All only — no Tab-extend | — |
| `C` connects the selected symbol where its points meet, and says which two | `palette-commands.spec.ts`, `portnames.spec.ts` |
| **(open)** "Connect to <tag>" — see below |  — |

### Why there is no "Connect to PV-101"

Magnetic docking chooses its port pair by proximity — nearest compatible
points that face each other. That rule is only meaningful because the *user*
put the symbol there. Asked to join two symbols anywhere on the sheet, the
same rule becomes the application picking a nozzle on the engineer's behalf,
and on a real vessel the top nozzle and the bottom nozzle are not
interchangeable.

Offering the choice instead needed data that did not exist: the catalogue's
ports are `n`, `n1`, `w2`, `e`. **That half is now done** — every port resolves
to words (see H3), so a target list is possible. What remains is a UX question
rather than a data one: how the engineer picks the far symbol, and what the
picker does with a vessel that offers eleven nozzles none of which the
catalogue can call an inlet.

## H3. Port names

| Check | Covered by |
|---|---|
| Port IDs are unchanged — documents still address `n1`, `w2`, `suction` | `symbols/portCompat.test.ts` |
| A drawing saved before names loads, and every connection still resolves | `symbols/portCompat.test.ts` |
| A saved file contains no port name | `symbols/portCompat.test.ts` |
| DEXPI export/import carries the ID, never the name | `symbols/portCompat.test.ts` |
| Which connections are legal is byte-for-byte what it was | `symbols/portCompat.test.ts` |
| Every port of every symbol resolves to a label | `symbols/portLabels.test.ts` |
| Two ports on one symbol never read the same | `symbols/portLabels.test.ts` |
| Names are authoritative only where the definition establishes them | `symbols/portLabels.test.ts` |
| Positional labels never say inlet / outlet / suction / discharge | `symbols/portLabels.test.ts` |
| Positional labels follow a rotated symbol; authoritative names do not | `symbols/portLabels.test.ts`, `portnames.spec.ts` |
| The label's side is the same side the router uses — one geometry rule | `symbols/portLabels.test.ts` |
| A user-added pin has no label rather than a made-up one | `symbols/portLabels.test.ts` |
| The inspector's Connections list is closed by default and free of subscriptions | `portnames.spec.ts` |
| A refused connection names both points, in the status line | `portnames.spec.ts` |
| A selected line is announced by where it runs | `portnames.spec.ts` |
| A selected symbol is NOT made to recite its nozzles | `portnames.spec.ts` |
| The incompatible-connection finding names both points | `portnames.spec.ts` |
| Sheet rename: right-click menu, double-click, and the palette | `portnames.spec.ts` |
| The zoom readout tracks the paper with no permanent timer | `portnames.spec.ts` |

### What a port name may and may not say

A port carries a `name` only where the symbol's own definition establishes the
meaning: `pump.centrifugal`'s `suction` and `discharge` (the ids are the
words), a PSV's `in` and `out` (the render comment names the two triangles), a
control valve's `sig` and its three positioner bosses, a logic gate's inputs
and output, a jacketed reactor's two jacket connections, an orifice plate's
tap. That is 34 of 491 ports.

Everything else is described by where it sits — "Top connection", "Left
connection (upper)" — which is true of every symbol and says nothing about
what the connection is for. A nozzle at the top of a vessel is **not** an inlet
because it is at the top. Eight of the nine pumps in the catalogue use `w`/`e`
and stay positional for exactly that reason.

Six ports get neither: the bottom nozzles of `vessel.bullet`, `vessel.sep3`
and `hx.kettle` sit more than 10 px inside the frame, which is past the
tolerance the router uses to commit to a direction. They read "Connection
point". Moving them onto the frame is a catalogue geometry change, not a
metadata one.
