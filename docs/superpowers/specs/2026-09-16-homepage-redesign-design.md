# Homepage redesign — design record

**Date:** 2026-09-16
**Scope:** `/` only. The editor at `/app`, routing, and the document model are untouched.
**Status:** implemented.

---

## 1. The problem

The previous homepage argued that a P&ID is a database. That was true when it was
written and is now too small a claim: since v0.14 the editor has grown six
workspaces (Draw, Data, Checks, Standards, HMI, Project), a rule engine, an
engineering registry, a process simulation and DEXPI exchange. The page still
described a drawing tool, and its screenshot predated the workspace rail
entirely — a visitor was being shown a version of the product that no longer
exists.

## 2. What the page has to say

One story, in the order the work actually happens:

```
P&ID → engineering model → validation → simulation → HMI → automation
```

This is not a marketing narrative imposed on the product. It is the editor's own
navigation order, which is why the workflow section can name the six workspaces
without inventing anything.

## 3. Decisions

### 3.1 Dark ground, light sheets

The brief asked for a dark technical theme. The editor is a light, white-paper
application; only HMI Studio is dark. A fully dark page would misrepresent the
drawing surface and make the click into `/app` a jarring theme break.

**Resolved:** the page chrome is graphite, and the P&ID renders as a white sheet
on it — paper on a lit drafting table. HMI visuals stay navy, because that is
what the product actually looks like.

The palette is not invented. It is lifted from `src/hmi/theme.ts`, the product's
shipped ISA-101 high-performance HMI design system, down to the hex values,
along with that file's stated rule: **normal operation recedes; saturated colour
is reserved for a condition that must be acted on.** Green, red and amber appear
only inside visuals, denoting a real running state, a real alarm or a real
finding.

| Role | Value | Source |
|---|---|---|
| Page ground | `#101418` | HMI `appBg` |
| Raised band | `#161b20` | HMI `bg` |
| Panel | `#1c2228` | HMI `surface` |
| Hairline | `#333c45` | HMI `border` |
| Text | `#e6eaed` | HMI `text` |
| Accent | `#2fb3ad` | the editor's teal, lifted for contrast |
| Sheet | `#fcfcfb` on `#14181d` | the real drawing surface |

### 3.2 The spine — one identity, six views

The page's single strongest idea, and its only unprompted motion: `FT-101`
appears six times — as a symbol on paper, a row in the index, a validation
finding, a solved value, an operator reading and an export — and is the same
object each time.

This is a true statement about the codebase, not a metaphor: the engineering
registry keys records to the tag, so a redraw does not destroy a datasheet
(`docs/ENGINEERING-PLATFORM-PLAN.md` §2.1). The best marketing visual available
was the actual architecture.

### 3.3 Hand-built SVG for concepts, real screenshots for UI

Splitting on this line is what keeps the page honest. An SVG panel that depicts
UI is a mockup of UI, which is the "fake dashboard" the brief rules out. So:

- **SVG** for the engineering scenes (the plant, the spine stages, the
  workstation composition). These draw real ISA-5.1 geometry — `src/home/visuals/isa.tsx`
  reproduces the conventions in `src/symbols/lib/` rather than importing it,
  which would pull the whole catalogue into the marketing chunk.
- **Screenshots** for anything claiming to be the application, recaptured from
  the running v0.21.0 build so they show the current workspace rail.

### 3.4 Process lines do not animate

The first implementation applied a moving dash to the P&ID's process lines. In
ISA-5.1 **a dashed line is an instrument signal** — to this audience the flow
animation was changing the meaning of the drawing.

**Resolved:** nothing on the white sheet animates. Process linework is solid,
signals are dashed. The flow animation lives only on the HMI mimic, drawn as a
lighter dash drifting *inside* a solid pipe wall, which is what the real HMI
does.

### 3.5 Licence folded into the philosophy section

Open-at-the-boundaries and commercial-at-the-core are the same argument from two
sides; separating them let the page imply openness in one place and charge for it
three sections later. The free-vs-paid split stays on the page rather than behind
a footer link — it funds the free tier, and a commercial visitor should learn
they need a licence before opening the editor, not after.

## 4. The honesty mechanism

The failure mode of a marketing page is not a crash. It is describing something
that does not exist yet, and never revisiting the sentence.

So no claim is made in prose. Every capability, standard and roadmap item is a
typed record in `src/home/content.ts` carrying an explicit
`status: 'available' | 'developing' | 'roadmap'`, rendered as a visible label.
**An `available` record must name the release it shipped in**, and
`tests/home/content.test.ts` fails the build otherwise. Anything still being
built has no version to name, so it cannot pass, so it stays where it belongs.

Corrections made while building the ledger, by reading `CHANGELOG.md` rather
than the README:

- The **hydraulic network solver** is in `[Unreleased]`, not shipped. Moved to
  *Next*; *Now* claims only what v0.21.0 actually landed (engineering units,
  pump curves, pressure and temperature response).
- **HMI Studio** dates to v0.6.0, not v0.8.0.
- **AutomationML**, **MTP** and **IEC 62682** have zero occurrences in the source
  tree. AutomationML and MTP are Roadmap. IEC 62682 appears only paired with
  ISA-18.2 as its IEC counterpart, worded "aligned concepts, not assessed".

The standards section is an index, not a logo wall — a logo wall implies
endorsement, and no standards body endorses this software. Every row says what
IPD Studio *does*; none says conformance. The README's affiliation disclaimer
renders with the list and is asserted by test.

## 5. Structure

```
src/home/
  Home.tsx            composition: nav, 11 sections, footer
  content.ts          every claim, as typed data
  home.css            the design system, scoped under .home
  sections/           Hero Spine Platform Workflow Showcase Principles
                      Standards Roadmap Philosophy Audience Closing Footer
  visuals/
    isa.tsx           ISA-5.1 symbol primitives
    scenes.tsx        the plant, in each of its representations
    stages.tsx        the six spine figures
```

Three visual peaks — hero, spine, showcase. Everything else is set quietly so
those three carry the page. Principles and audiences are compact text rows
rather than card grids, because by that point the page has already spent its
structure and eleven competing tile grids would read as a feature catalogue.

## 6. SEO

Firebase rewrites every path to `index.html`, and the crawlers that build link
previews do not execute JavaScript. Metadata is therefore **static in
`index.html`**, not injected by React: title, description, canonical, Open
Graph, Twitter card, and a `SoftwareApplication` JSON-LD block carrying only
substantiable fields — no `aggregateRating`, which would be fabricated.

The editor sets `document.title` on boot so the marketing title does not sit in
the application's tab. That one line is the only change outside `src/home/`,
`index.html` and the two test files.

`public/media/og.png` is a composed 1200×630 card built from the same tokens,
not a cropped screenshot.

## 7. Gotcha worth recording

`.shell` was already a global class in `src/app.css` — the editor's workspace
rail grid. The homepage container inherited `display: grid` from it and the
first render collapsed the spine's heading into a 60px column. The container is
now `.hwrap`. A sweep of every other homepage class against `app.css` found only
compound selectors (`.sheet-tab.active`, `.ws-tally.ok`), which cannot leak.

**Rule for anything added here later:** the homepage is scoped under `.home`, but
scoping only protects properties you actually declare. A bare class name that
also exists in `app.css` will still inherit whatever the homepage does not set.

## 8. Verification

- `npx tsc -b` clean
- 3237 unit tests pass, including 12 new ledger tests
- 10 homepage e2e tests pass, covering dead links, anchor targets, the
  shipped-vs-planned split, the no-certification rule, SEO metadata, and a
  390px viewport with zero horizontal overflow
- Build: homepage chunk 42.6 kB (11.2 kB gzip) and its CSS 23.8 kB, both
  code-split from the 447 kB editor chunk. `editor.webp` 70 kB, `hmi.webp` 20 kB
  against 480 kB and 100 kB PNG fallbacks. The PWA still excludes `**/media/**`
  from precaching.

## 9. Not done

- **Not deployed.** The build is verified locally; publishing to
  `pid-studio-praharsh.web.app` is the author's call.
- `public/media/fluids.png` (170 kB) is now unreferenced and could be removed
  from the deploy.
