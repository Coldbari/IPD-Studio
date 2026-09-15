# P3 — the engineering-data programme, as built

A record of the P3 sequence: what shipped, what was deliberately refused, and
why. Written for whoever picks this up next — including a later version of the
people who wrote it.

**Baseline** `54d7a76` · **Head** `f8cf80b` · **v0.20.0**

Throughout, two numbers never moved:

```text
schemaVersion                6
DEFAULT_STANDARD fingerprint 3c935cd3e3e09cd4
```

Every capability below is **additive or derived**. No migration was written, no
`EntityKind` was added, no `RefWhere` member was added, and every `.pnid` written
before any of this still opens.

---

## 1. The commit stack

| Commit | Programme | Files | Δ |
|---|---|---|---|
| `d0b0da4` | D3–D5 cleanup | 5 | +240 / −18 |
| `609e476` | P3-1 Run Foundations | 7 | +1276 / −37 |
| `14ee489` | P3-2 Run-aware QA | 6 | +791 / −11 |
| `bbb4e27` | P3-3 Run-aware Line List | 9 | +995 / −38 |
| `a2a0306` | P3-3 audit blockers closed | 4 | +324 / −7 |
| `020593c` | P3-4A Run-aware DEXPI | 4 | +898 / −28 |
| `48819e2` | P3-4B-1 Persistent Nozzle | 11 | +1366 / −3 |
| `7ae503b` | P3-4B-2 Nozzle Schedule | 12 | +1509 / −24 |
| `24fd9f4` | P3-4B-3 Nozzle closeout | 9 | +639 / −14 |
| `bd84d05` | P3-5 Project Health | 10 | +1275 / −2 |
| `f8cf80b` | P3-6 Deliverable Staleness | 8 | +1050 / −6 |

Eleven commits, ~10,400 lines. Roughly half of it is tests.

**Five read-only audits produced no commit at all** and are listed in §4. They
were not overhead: three of them changed what got built, and one stopped a
programme from being built at all.

---

## 2. What each programme shipped

### D3–D5 — copy and classifier cleanup · `d0b0da4`

Article agreement in interpolated loop strings (`a`/`an` chosen by
`articleFor`, not baked into literals), dead `MEMBER_ROLES` removed.

A **fourth** broken type was found beyond the audit's three — `interlock` — and
fixed as the same defect. `rolesOfKeys`/`rolesOf` were left unconsolidated: the
brief said not to force it, and forcing it would have introduced coupling to
save a few lines.

### P3-1 — Run Foundations · `609e476`

`src/model/run.ts`. A **Run** is one physically connected set of process
edges — the pipe you could walk along without passing through a vessel. Derived,
never persisted, never a foreign key.

The load-bearing invariant: **a connected run is never split because its edges
carry different line numbers.** Connectivity is a fact about the drawing; a line
number is a label somebody typed, and a label cannot cut a pipe.

`passesThrough` was **moved, not copied**, out of `fluidFlow.ts`. There is one
definition of "the medium carries on through this" and both callers read it —
proved by a 552-probe corpus digest computed in a worktree at the prior commit
and matched exactly (`b2116a31927d69b1`).

Perf gate: `buildIndex` + 0.3 ms. Measured paired, minutes apart on one warm
machine: 0.984 → 1.266 ms median at 501 nodes.

### P3-2 — Run-aware QA · `14ee489`

`duplicate-line-number` asks the run, not the edge. Numbering all four segments
of one pipe used to produce three warnings; now it produces none, because they
are one pipe.

`no-final-element`'s `letters.includes('C')` was fixed. Verified across **12,506
letter combinations: 546 false positives removed, 0 added.**

While writing a test I asserted `classifyMember('ZSC') === 'controller'` from
memory. The parser said *position switch, Closed* — and the parser was right.
**The test was corrected, not the code**, and it turned out to be a second real
false positive the fix removes.

### P3-3 — Run-aware Line List · `bbb4e27` + `a2a0306`

**One physical run = one line list row.** It used to iterate `sheet.edges`, so a
real pipe printed four rows and an unnumbered segment printed none.

What the list refuses to say: it never picks one of several numbers, never
states a flow direction (`From`/`To` are two ends in a deterministic order), and
never merges two runs because their numbers match.

I added `(open end)` to dead-end names; an existing test caught it and **the test
was right** — the same evidence covers a half-drawn valve and a pump discharge.
Removed.

The follow-up audit found two P1s, closed in `a2a0306`: a run carrying two line
records printed *neither*, and the CSV lost a guard. The rule applied:
**if two records disagree, print both — never choose.**

### P3-4A — Run-aware DEXPI · `020593c`

One `PipingNetworkSystem` per run, not per edge. A pipe drawn in four segments
used to export as four unrelated networks.

`Port.<id>.Name` is written **only when `PortLabel.authoritative`** — i.e. when
the catalogue names the point. 19 of 386 catalogue ports do. **A positional
label is never exported as a name**: a nozzle at the top of a vessel is not an
inlet because it is at the top.

No conformance claim. The repository contains no Proteus 4.2 schema, so the
honest word is *projection*.

### P3-4B-1 — Persistent Nozzle Foundation · `48819e2`

`EngineeringRecord.nozzles?: Nozzle[]`. The ownership decision, made by audit
first: the record **is** the boundary, so a nozzle carries no equipment id.

`retagRegistry`'s object spread carries the whole schedule across a rename **for
free** — proved empirically by breaking the spread and watching the rename test
fail. A `doc.nozzles[]` collection would instead have needed a new `RefWhere`
member; a new `EntityKind` would have moved the standard fingerprint.

A real defect surfaced in my own `updateNozzle`: the `.map` always allocated, so
the identity no-op guard never fired and every keystroke filled the undo stack.

### P3-4B-2 — Nozzle Schedule · `7ae503b`

One row per **persistent** nozzle, never one per port. A `vessel.vertical` has
eleven connection points; a record with one nozzle produces one row.

`ReportRow.rowId` was added because six nozzles on one vessel render under one
React key — **React's own duplicate-key error, reproduced by reverting the fix.**
`id` keeps exactly the meaning it always had.

`portsOfNode` / `portIdsOfKey` replaced three private reconstructions of
"catalogue ports ++ extraPorts".

### P3-4B-3 — Nozzle closeout · `24fd9f4`

Four defects an audit found:

1. `Nozzle.notes` was persisted, diffed and printed — and **unreachable from the
   UI**. Now authorable.
2. `nozzle-port-missing` filed acceptances under the **mutable number**, so
   renumbering N1→N9 stranded the acceptance. Now the ULID.
3. *"Discard the record"* counted only `fields`, so a vessel with eight nozzles
   and no fields read **"Deletes 0 stored field(s)"** as the user confirmed
   deleting all eight.
4. `construction.connections` was labelled *"Nozzle schedule"* directly above the
   real one. Retired like `general.area`: key unmoved, value never migrated,
   column still exporting, label now says legacy.

### P3-5 — Project Health · `bd84d05`

A sixth workspace over numbers that existed in five others and were never
aggregated. `projectHealth(ix, qa)` computes none of them.

**An absent denominator is not zero.** A project with no started equipment
record has not specified 0% of its equipment — it has not begun. Those print
`—`, and `percentText` is the one formatter so no tile can print `0%` by
forgetting to check. Only *started* records are measured, using
`required-field-empty`'s own definition.

Measured 0.155 ms at 501 nodes / 500 records.

### P3-6 — Deliverable Staleness · `f8cf80b`

*Which deterministic reports no longer match the last issued model?*

Regenerate each report from today's document and from the issued snapshot, and
compare the strings. **No hash, no stored deliverable, no schema.**

The plan proposed hashing a declared `DELIVERABLE_INPUTS` map. Writing the tests
proved why not: **I predicted the wrong reports twice** — a `signal.type` change
does not move the I/O list unless the instrument is wired, and a `general.service`
change on a vessel *does* move the instrument index, because that report selects
on tag rather than kind. A hand-maintained map would have encoded both mistakes.
The generator is the authority on its own output.

Behind a button: 14.4 ms against health's 0.155.

---

## 3. Doctrines this sequence established or upheld

**Identity.** A registry key (the tag) is engineering identity; a `nodeId` is the
identity of one *placement*. `deleteIds` never touches `doc.registry`, so
delete-and-redraw — normal drafting — never destroys engineering data.

**Derived, not stored.** Loops, runs, the line list, the nozzle schedule, project
health and deliverable staleness are all projections. A deliverable cannot drift
from the model because there is only one of it.

**Refuse to invent.** No nozzle size read off a line. No port name unless the
catalogue establishes one. No flow direction. No cross-sheet continuation. No
line number fabricated for an unnumbered run. A rule that says *"I cannot
determine this"* beats one that confidently reports a wrong engineering problem.

**Both answers, never one.** Where two records disagree, print both.

**Absence is not zero, and silence is not agreement.** `—` for no denominator.
`NOT AVAILABLE HERE` for a missing snapshot — never `unchanged`.

**Never claim what cannot be observed.** The product cannot see that a file was
generated, downloaded or approved, so no screen says those words as a verdict.

**Compile-time ledgers.** `DOC_FIELD_COVERAGE` and `RECORD_FIELD_COVERAGE` are
typed over `keyof`, so a new field will not compile until someone rules on
whether a revision comparison reports it. This caught `nozzles` exactly as
designed.

**Tests are proved load-bearing.** Every programme temporarily reverted its own
fix and recorded the failure count. A test that passes either way is not
evidence.

---

## 4. The audits that produced no code

| Audit | Outcome |
|---|---|
| P3 Next-Capability | Chose the piping run over easier options |
| P3-3 Final | Found 2 P1s → `a2a0306` |
| P3-4 Phase 0/1 | **Stopped** and reported 2 blockers rather than guessing |
| P3-4B Architecture | Decided `EngineeringRecord.nozzles` and rejected three alternatives |
| P3-4B-3 Readiness | Found the 4 defects closed in `24fd9f4` |
| P3-NEXT | Found no P3 master plan in the repo; chose Project Health |
| P3-6 Architecture | **NO-GO on §5.1 as written**; reshaped it into what shipped |

The P3-6 audit is the one that earned its keep. §5.1's `IssuedDeliverable`
design assumed two facts the product cannot observe — that a file was generated,
and a project-level revision that does not exist (revisions are per **sheet**).
Building it literally would have meant persisting fiction.

---

## 5. Verification at `f8cf80b`

| Gate | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `npx vitest run` | **2850 passed, 7 skipped, 0 failed** |
| `npx vite build` | succeeds |
| `npx playwright test` | 186 passed, 16 skipped, 2 failed |
| schemaVersion | 6 → 6 |
| Fingerprint | `3c935cd3e3e09cd4` unchanged |
| Bundled samples | untouched throughout |

**The 2 e2e failures are pre-existing and not from this sequence.** Both are
faceplate tests (`equip.spec.ts:5`, `screenshot.spec.ts:357`) belonging to
concurrent HMI/process-simulation work that was uncommitted in the tree. Proved
by reverting this sequence's source files and watching both fail identically.

`controlledExport.spec.ts:96` is a separate known load-dependent flake: it fails
at most once per full parallel run, passes in isolation, and contains no
reference to anything this sequence touched.

---

## 6. Known gaps, carried forward

Recorded rather than fixed, because each belongs to its own programme.

**A real QA gap, found during P3-5 and deliberately not fixed:**
`required-field-empty` iterates `ix.nodesByKey` — **nodes only** — so `line`
records are never checked against `standard.required.line` (`spec.size`,
`spec.material`). Project Health *does* measure line completeness, so it can
show a percentage the Checks workspace never comments on.

**Carried technical debt** (from the P3-3 audit): a false `runEndName` comment,
`"1 ends"` pluralisation, three `buildIndex` calls per Data-workspace render,
`edgeFieldValue` key recomputation, and an unguarded `getSymbol` in
`InspectorWhereUsed`.

**Documentation:** `CHANGELOG.md` stops at 0.20.0 while source comments cite
v0.21.0. None of this sequence is in it.

**Still deferred, still blocked:** schema-backed DEXPI. There is no Proteus 4.2
XSD in this repository, and none of it may be invented from memory.

**Unbuilt plan items:** §5.3 review comment threads (needs an 8th `RefWhere`),
§5.4 I/O rack/slot/channel/card (needs a card-configuration model).

---

## 7. Release

| | |
|---|---|
| Branch | `perf/canvas-rasterisation` → pushed to `origin` |
| `main` | fast-forwarded `659ff7d` → `f8cf80b` (29 commits, no rewrite) |
| Built from | a clean worktree at `f8cf80b`, **not** the working tree |
| Deployed | `firebase deploy --only hosting` → <https://pid-studio-praharsh.web.app> |
| Not touched | Firestore rules, indexes, auth config |

The clean-worktree build was deliberate: the working tree held another session's
uncommitted HMI work, and a deploy from it would have published someone else's
half-finished changes to the live site.
