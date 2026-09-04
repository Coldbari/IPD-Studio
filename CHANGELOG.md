# Changelog

All notable changes to IPD Studio. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
