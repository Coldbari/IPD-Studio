# IPD Studio → DEXPI mapping

IPD Studio writes a **DEXPI-oriented projection in the Proteus 4.2 *shape***
(`Toolbar → DEXPI`). Geometry is in CSS pixels; 1 mm = 3.7795 px.

**This is not a conformance claim, and the wording is deliberate.** This
repository contains no copy of the Proteus 4.2 schema or XSD, so nothing the
exporter writes has been checked against it. Until a schema-backed conformance
pass is done, the honest description is "a DEXPI projection" — never "Proteus
4.2 compliant".

The exporter is a **projection**: it reads `ProjectIndex` and writes XML. It
creates no engineering record, derives no topology of its own, states no flow
direction and mutates nothing.

---

## 1. Written in the target shape

These use element and attribute names the Proteus shape is understood to
provide. They are unverified against the schema, but they are not invented for
this product.

| IPD Studio model | Element |
|---|---|
| Project + sheet metadata | `PlantInformation` (Application, ProjectName, DrawingNumber, Date) |
| Sheet + size | `Drawing` with `Extent` (Min/Max in px) |
| `PlantNode` kind ≠ instrument | `Equipment @ID @TagName @ComponentClass` + `Position/Location` |
| `PlantNode` kind = instrument | `ProcessInstrument`, same shape |
| **A physical Run** (`ProjectIndex.runs`) | **one `PipingNetworkSystem @ID`** |
| A drawn process edge | `PipingNetworkSegment @ID` inside its run's system |
| Edge endpoints | `Connection @FromID @FromNode @ToID @ToNode` — **always the stable port *id***, never a display name |
| Free ends and waypoints | `CenterLine/Coordinate` |
| Signal edge | `InformationFlow`, same Connection/CenterLine shape |
| Symbol class | `@ComponentClass` from `src/export/componentClass.ts`; 85 of 477 catalogue symbols are mapped, the rest default to `PlantItem` |

### One Run, one PipingNetworkSystem

Before P3-4A the exporter emitted one `PipingNetworkSystem` **per drawn edge**,
so a pipe drawn in four segments left as four unrelated networks and a consumer
could not tell they were one line. `ProjectIndex.runs` is now the authoritative
physical grouping: one run is one system, and the run's edges are that system's
segments, in `run.edgeIds` order.

Nothing in `export/dexpi.ts` re-derives connectivity. There is one run
algorithm and it lives in `src/model/run.ts`.

**System `@ID`** is `run-` + `run.id` with the colon replaced (`run.id` is
`sheetId:oldestEdgeId`). Deterministic, derived from stable identities, and
never written back into `ProjectDoc` — the document has never heard of it.

### Import and the round trip

Unchanged, and it did not need to change. `src/import/dexpi.ts` has always read
**segments**, not systems (`for sys → for seg → one edge`), so a file written
per-run imports back to exactly the same edges and `ProjectIndex` derives the
runs again from them.

The direction is always **DEXPI → edges → ProjectIndex → Runs**, never
DEXPI → runs. A run is derived, so a file never carries one.

---

## 2. Carried in private `PIDStudio` attribute sets

Everything below is real engineering information that the product holds and the
schema-shaped elements above have no verified home for. It travels in
`GenericAttributes` groups whose `Set` begins `PIDStudio`, so a consumer can
always tell this product's metadata from anything it recognises.

Names inside a group are dotted (`Config.x`, `Port.discharge.Kind`,
`Line.1.spec.material`) so that a reader which flattens every group into one
map still loses nothing.

### `Set="PIDStudio"` on a node

`SymbolId`, `Rotation`, `TagLetters`, `TagLoop`, `TagSuffix`, `Label`,
`Config.*`, and — new in P3-4A — `Area` and `Unit`, present only where an
engineer has **assigned** the object to a declared Unit. Never inferred from
geometry or from what the object is drawn next to.

### `Set="PIDStudio"` on a PipingNetworkSystem

| Attribute | Meaning |
|---|---|
| `RunId` | the internal derived run id. Traceability only — **not an engineering line number** |
| `SegmentCount` | how many drawn edges make up the run |
| `LineNumberState` | `single` \| `unnumbered` \| `multiple` |
| `LineNumbers` | present only when `multiple`: every number observed, `; `-joined |

### `Set="PIDStudio.Lines"` on a PipingNetworkSystem

One numbered group of attributes per line record behind the run —
`Line.1.*`, `Line.2.*`, indexed over `run.numbers`, which is sorted.

`Line.N.Number`, then that line's own registry fields under their catalogue
keys (`Line.1.spec.material`, `Line.1.design.pressure`, …) from
`fieldKeysFor('line')`, then `Line.N.Area` and `Line.N.Unit`.

**The three numbering states are stated, never chosen:**

- **single** — one number, and its record travels with it.
- **unnumbered** — the system still exists and is identified only by its derived
  export id. **No line number is fabricated.**
- **multiple** — every number is carried, each with its *own* record group. No
  single number is written, because picking one would be the exporter deciding
  which of an engineer's answers is right. Two lines that disagree about
  material appear as two groups, never as one composite value.

### `Set="PIDStudio.ConnectionPoints"` on a node

A derived projection of the connection points a drawn line **actually uses**.
This is *not* the nozzle model: nothing here is persisted, and no engineering
fact is attached to a node id. Persistent nozzles live on the equipment's
`EngineeringRecord` and are not exported at all — see §3.

Only used ports are projected. A catalogue symbol carries every port it could
ever have — a vertical vessel has eleven — and the drawing offers no evidence
that an unused one is a real nozzle.

| Attribute | Source |
|---|---|
| `Port.<id>.Kind` | `PortKind` — `process` \| `signal` \| `both`. Authoritative |
| `Port.<id>.Name` | **only** when `PortLabel.authoritative` — i.e. the catalogue names the point (a pump's Suction/Discharge, a PSV's In/Out) |
| `Port.<id>.NameAuthoritative` | `true`/`false`, always written |
| `Port.<id>.Edge` | the connected edge (smallest id where a port carries several) |
| `Port.<id>.Run` | the export id of that edge's run |
| `Port.<id>.EdgeCount` | only when a port carries more than one line |

**A positional label is never exported as a name.** A nozzle at the top of a
vessel is not an inlet because it is at the top. Where the catalogue does not
name a point, `NameAuthoritative` is `false` and no `Name` is written at all —
so a consumer can see which kind of label it is holding rather than having to
trust it. A user-added extra port gets a `Kind` and no name: the app did not
put it there and has nothing to say about it.

---

## 3. Not currently representable

- **Nozzles as engineering objects.** The model now HAS them —
  `EngineeringRecord.nozzles` holds a persistent `Nozzle` with a number, size,
  rating, facing, service and an optional `portId` (P3-4B-1) — and the exporter
  does not yet project them. Mapping a nozzle onto the Proteus shape needs the
  actual 4.2 schema, which this repository does not contain, and P3-4A's
  decision stands: nothing is invented from memory. Until then a nozzle appears
  in the product's own Nozzle schedule (`Export → Nozzle schedule`) and in no
  XML element here.
- **Inlet / outlet role** for ~95% of ports — 19 of 386 catalogue ports carry
  an authoritative name.
- **Process flow direction.** P3 Program 1 established that the model does not
  state it. `PlantEdge.arrow` is per edge, not per run, and is deliberately not
  used to orient anything.
- **`ShapeCatalogue` / `Presentation` geometry.**
- **Loops, I/O classification, revision and standard provenance** — held by the
  product, not yet projected.
- **Multi-sheet export.** One call, one sheet. Runs are sheet-local, so a line
  continued through an off-page connector is two systems on two files.

---

## 4. Determinism

For one document the export is byte-identical apart from the `Date` attribute
in `PlantInformation`, which is export provenance and predates this work.

Ordering is fixed at every level: nodes in document order, runs from
`ProjectIndex.runs` (sheet order, then run id), segments in `run.edgeIds` order
(sorted), ports sorted by id, line groups indexed over the sorted
`run.numbers`. No identity is random, and none depends on map iteration order.
