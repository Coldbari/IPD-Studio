# Third-party licenses

IPD Studio bundles third-party software. Each component stays under its own
license; nothing in [LICENSE](LICENSE) or [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)
changes those terms, and nothing in those terms changes IPD Studio's.

**How this file was produced.** Generated from [`package-lock.json`](package-lock.json)
at IPD Studio **v0.22.0** by [`scripts/check-licenses.mjs`](scripts/check-licenses.mjs),
using the `license` field each package publishes in its own manifest, plus
copyright lines read from the `LICENSE`/`LICENCE` files in `node_modules/`.

**What "runtime" means here.** A package is listed as *runtime* when
`package-lock.json` does **not** mark it `dev`. That is deliberately a
*superset* of what actually reaches a browser: Vite tree-shakes the bundle, so
some runtime-classified packages (`yargs`, `cliui`, `@types/*`) are pulled in
as transitive dependencies and never ship. Over-listing is the safe direction
for an attribution file.

**Scope.** Every runtime package is listed individually below, because those
are the ones whose attribution can travel into a distributed build.
Development dependencies are summarised by license, with every
obligation-carrying package named. Run `npm run license:inventory` for the
complete 577-package table including all development dependencies.

> **This is an inventory, not a compliance opinion.** It records what the
> dependency metadata says. It is not legal advice and does not certify that
> any particular distribution of IPD Studio satisfies every obligation of
> every license listed. Confirm obligations with counsel before distributing
> under a commercial or OEM agreement.

## Summary

| | Packages |
|---|---|
| Runtime (may ship) | **106** |
| Development (build, test, tooling — not distributed) | **471** |
| **Total** | **577** |

**No GPL, AGPL, LGPL, SSPL, BUSL, Elastic, Commons Clause or other
commercially non-sublicensable license appears anywhere in the tree** — in
either runtime or development dependencies. `scripts/check-licenses.mjs`
enforces this on every push and pull request; see
[`.github/workflows/license-check.yml`](.github/workflows/license-check.yml).

Zero packages in the lockfile are missing a `license` field.

## Runtime licenses

| License | Packages |
|---|---|
| Apache-2.0 | 53 |
| MIT | 36 |
| BSD-3-Clause | 10 |
| ISC | 5 |
| MPL-2.0 | 1 |
| 0BSD | 1 |

## MPL-2.0 — `@joint/core` (the one weak-copyleft component that ships)

| | |
|---|---|
| Package | `@joint/core` |
| Version | 4.3.3 |
| License | Mozilla Public License 2.0 |
| Copyright | Copyright 2013 client IO — <http://client.io> |
| Project | <https://jointjs.com> · <https://github.com/clientIO/joint> |
| License text | `node_modules/@joint/core/LICENSE` (full MPL 2.0 text, preceded by the copyright line) |
| Role in IPD Studio | The canvas/diagramming engine ([`src/canvas/`](src/canvas/)) |

**`@joint/core` is the only MPL-2.0 package that can reach a distributed
build.** The twelve `lightningcss*` packages are also MPL-2.0 but are
development-only (see below).

**What MPL-2.0 requires, as the license text states.** MPL-2.0 is *file-level*
copyleft, not project-level:

- It **permits** including the covered files in a larger work distributed under
  different terms, including proprietary and commercial terms (MPL §3.3,
  "Distribution of a Larger Work").
- Files that are **Covered Software** stay under MPL-2.0. If a covered file is
  **modified**, the Source Code Form of that modified file must be made
  available to recipients (MPL §3.1, §3.2).
- Recipients must be informed of the MPL terms and given the license text
  (MPL §3.1, §3.4).

**How this affects IPD Studio today.** IPD Studio consumes `@joint/core` as an
unmodified npm dependency; no MPL-covered file is modified in this repository.
The obligation is therefore attribution and notice, not source disclosure of
IPD Studio's own code.

**How it affects a commercial or OEM agreement.** The obligation travels with
the code: any commercial licensee, OEM partner, or that partner's customers
receive the same MPL-2.0 files and the same MPL-2.0 obligations. This does not
prevent commercial distribution — MPL is specifically designed to allow it —
but it must be disclosed and carried in the notice terms of any such
agreement. See the MPL-2.0 section of [OEM-LICENSE-TEMPLATE.md](OEM-LICENSE-TEMPLATE.md),
which is a draft for legal review and not a license grant.

## Apache-2.0 — attribution and NOTICE

53 runtime packages are Apache-2.0, the largest group being the Firebase SDK
(`firebase` and the `@firebase/*` family, Copyright 2019 Google LLC) together
with gRPC and protobuf support packages.

Apache-2.0 §4 requires that recipients of a redistribution receive a copy of
the license, retain existing copyright/patent/attribution notices, and receive
the contents of any `NOTICE` file the original carries. As installed, the
`firebase` and `@firebase/*` packages do **not** ship a `NOTICE` file; their
copyright appears in source headers (`Copyright 2019 Google LLC`).

## Attribution notices — direct runtime dependencies

Copyright lines as they appear in each package's own license file.

| Package | Version | License | Copyright |
|---|---|---|---|
| `@joint/core` | 4.3.3 | MPL-2.0 | Copyright 2013 client IO |
| `firebase` | 12.19.0 | Apache-2.0 | Copyright 2019 Google LLC (source headers; no NOTICE file shipped) |
| `react` | 19.3.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| `react-dom` | 19.3.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| `zustand` | 5.0.15 | MIT | Copyright (c) 2019 Paul Henschel |
| `zundo` | 2.3.0 | MIT | Copyright (c) 2021 Charles Kornoelje |
| `idb-keyval` | 6.3.0 | Apache-2.0 | Copyright 2016, Jake Archibald |
| `dxf-parser` | 1.1.2 | MIT | Copyright (c) 2015 GDS Storefront Estimating |
| `fast-xml-parser` | 5.11.1 | MIT | Copyright (c) 2017 Amit Kumar Gupta |
| `ulid` | 3.0.2 | MIT | Copyright (c) 2017 Alizain Feerasta |

## Complete runtime inventory

All 106 packages not marked `dev` in `package-lock.json`, alphabetically.

| Package | Version | License |
|---|---|---|
| `@firebase/ai` | 2.16.0 | Apache-2.0 |
| `@firebase/analytics` | 0.10.25 | Apache-2.0 |
| `@firebase/analytics-compat` | 0.2.31 | Apache-2.0 |
| `@firebase/analytics-types` | 0.8.5 | Apache-2.0 |
| `@firebase/app` | 0.16.2 | Apache-2.0 |
| `@firebase/app-check` | 0.13.1 | Apache-2.0 |
| `@firebase/app-check-compat` | 0.4.7 | Apache-2.0 |
| `@firebase/app-check-interop-types` | 0.3.5 | Apache-2.0 |
| `@firebase/app-check-types` | 0.5.5 | Apache-2.0 |
| `@firebase/app-compat` | 0.5.18 | Apache-2.0 |
| `@firebase/app-types` | 0.9.6 | Apache-2.0 |
| `@firebase/auth` | 1.13.6 | Apache-2.0 |
| `@firebase/auth-compat` | 0.6.11 | Apache-2.0 |
| `@firebase/auth-interop-types` | 0.2.6 | Apache-2.0 |
| `@firebase/auth-types` | 0.13.2 | Apache-2.0 |
| `@firebase/component` | 0.7.5 | Apache-2.0 |
| `@firebase/data-connect` | 0.7.4 | Apache-2.0 |
| `@firebase/database` | 1.1.5 | Apache-2.0 |
| `@firebase/database-compat` | 2.1.7 | Apache-2.0 |
| `@firebase/database-types` | 1.0.22 | Apache-2.0 |
| `@firebase/firestore` | 4.17.2 | Apache-2.0 |
| `@firebase/firestore-compat` | 0.4.14 | Apache-2.0 |
| `@firebase/firestore-types` | 3.0.5 | Apache-2.0 |
| `@firebase/functions` | 0.14.0 | Apache-2.0 |
| `@firebase/functions-compat` | 0.5.0 | Apache-2.0 |
| `@firebase/functions-types` | 0.6.5 | Apache-2.0 |
| `@firebase/installations` | 0.6.24 | Apache-2.0 |
| `@firebase/installations-compat` | 0.2.24 | Apache-2.0 |
| `@firebase/installations-types` | 0.5.5 | Apache-2.0 |
| `@firebase/logger` | 0.5.2 | Apache-2.0 |
| `@firebase/messaging` | 0.13.3 | Apache-2.0 |
| `@firebase/messaging-compat` | 0.2.30 | Apache-2.0 |
| `@firebase/messaging-interop-types` | 0.2.6 | Apache-2.0 |
| `@firebase/performance` | 0.7.14 | Apache-2.0 |
| `@firebase/performance-compat` | 0.2.27 | Apache-2.0 |
| `@firebase/performance-types` | 0.2.5 | Apache-2.0 |
| `@firebase/remote-config` | 0.9.2 | Apache-2.0 |
| `@firebase/remote-config-compat` | 0.2.29 | Apache-2.0 |
| `@firebase/remote-config-types` | 0.5.2 | Apache-2.0 |
| `@firebase/storage` | 0.14.5 | Apache-2.0 |
| `@firebase/storage-compat` | 0.4.5 | Apache-2.0 |
| `@firebase/storage-types` | 0.8.5 | Apache-2.0 |
| `@firebase/util` | 1.15.3 | Apache-2.0 |
| `@firebase/webchannel-wrapper` | 1.0.7 | Apache-2.0 |
| `@grpc/grpc-js` | 1.9.16 | Apache-2.0 |
| `@grpc/proto-loader` | 0.7.15 | Apache-2.0 |
| `@joint/core` | 4.3.3 | MPL-2.0 |
| `@nodable/entities` | 3.0.0 | MIT |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/utf8` | 1.1.2 | BSD-3-Clause |
| `@types/node` | 26.4.0 | MIT |
| `@types/react` | 19.3.0 | MIT |
| `ansi-regex` | 5.0.1 | MIT |
| `ansi-styles` | 4.3.0 | MIT |
| `anynum` | 1.0.1 | MIT |
| `cliui` | 8.0.1 | ISC |
| `color-convert` | 2.0.1 | MIT |
| `color-name` | 1.1.4 | MIT |
| `csstype` | 3.2.3 | MIT |
| `dxf-parser` | 1.1.2 | MIT |
| `emoji-regex` | 8.0.0 | MIT |
| `escalade` | 3.2.0 | MIT |
| `fast-xml-builder` | 1.3.1 | MIT |
| `fast-xml-parser` | 5.11.1 | MIT |
| `faye-websocket` | 0.11.4 | Apache-2.0 |
| `firebase` | 12.19.0 | Apache-2.0 |
| `get-caller-file` | 2.0.5 | ISC |
| `http-parser-js` | 0.5.10 | MIT |
| `idb` | 7.1.1 | ISC |
| `idb-keyval` | 6.3.0 | Apache-2.0 |
| `is-fullwidth-code-point` | 3.0.0 | MIT |
| `is-unsafe` | 2.0.2 | MIT |
| `lodash.camelcase` | 4.3.0 | MIT |
| `loglevel` | 1.9.2 | MIT |
| `long` | 5.3.2 | Apache-2.0 |
| `path-expression-matcher` | 1.6.2 | MIT |
| `protobufjs` | 7.6.6 | BSD-3-Clause |
| `re2js` | 2.8.6 | MIT |
| `react` | 19.3.0 | MIT |
| `react-dom` | 19.3.0 | MIT |
| `require-directory` | 2.1.1 | MIT |
| `safe-buffer` | 5.2.1 | MIT |
| `scheduler` | 0.28.0 | MIT |
| `string-width` | 4.2.3 | MIT |
| `strip-ansi` | 6.0.1 | MIT |
| `strnum` | 2.4.2 | MIT |
| `tslib` | 2.8.1 | 0BSD |
| `ulid` | 3.0.2 | MIT |
| `undici-types` | 8.3.0 | MIT |
| `web-vitals` | 4.2.4 | Apache-2.0 |
| `websocket-driver` | 0.7.5 | Apache-2.0 |
| `websocket-extensions` | 0.1.4 | Apache-2.0 |
| `wrap-ansi` | 7.0.0 | MIT |
| `xml-naming` | 0.3.0 | MIT |
| `y18n` | 5.0.8 | ISC |
| `yargs` | 17.7.3 | MIT |
| `yargs-parser` | 21.1.1 | ISC |
| `zundo` | 2.3.0 | MIT |
| `zustand` | 5.0.15 | MIT |

## Development dependencies

471 packages used to build, test and lint IPD Studio. They are **not**
distributed in a build and carry no attribution obligation in a shipped
product, but they are inventoried here because a source-code or OEM licensee
receives the repository and will install them.

| License | Packages |
|---|---|
| MIT | 387 |
| Apache-2.0 | 32 |
| ISC | 15 |
| MPL-2.0 | 12 |
| BlueOak-1.0.0 | 8 |
| BSD-2-Clause | 6 |
| BSD-3-Clause | 6 |
| MIT-0 | 2 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| (MIT OR CC0-1.0) | 1 |

### Development packages carrying obligations

Every development dependency whose license is more than plain attribution:

| Package | Version | License | Note |
|---|---|---|---|
| `lightningcss` | 1.33.0 | MPL-2.0 | CSS transformer used by the build toolchain (via Vite) |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | platform binary |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | platform binary |
| `caniuse-lite` | 1.0.30001809 | CC-BY-4.0 | browser-support dataset; attribution required if the data is redistributed |
| `mdn-data` | 2.27.1 | CC0-1.0 | public-domain dedication; no obligation |
| `type-fest` | 0.16.0 | (MIT OR CC0-1.0) | dual-licensed; usable under MIT |

These are build-time only. They do not place any obligation on a distributed
IPD Studio build, because none of them is part of it.

## Regenerating this file

```bash
npm run license:check       # gate: fails on a denied license, lists REVIEW items
npm run license:inventory   # full 577-package table, runtime and development
```

The gate runs in CI on every push and pull request. Its purpose is to protect
the commercial licensing path: a single GPL/AGPL/LGPL dependency anywhere in
the tree would make IPD Studio impossible to sublicense commercially — the same
reason the GPLv3 LibreDWG option for DWG import was closed at v0.13.0.

## What this document does not do

- It does **not** grant you any license to IPD Studio. IPD Studio's own terms
  are in [LICENSE](LICENSE) (PolyForm Noncommercial 1.0.0) and, for commercial
  use, a separate written agreement — see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
- It does **not** certify compliance. It reports license metadata.
- It does **not** cover services IPD Studio can talk to at runtime (Firebase
  projects you configure, or LLM providers you supply your own API key for).
  Those are governed by your agreements with those providers, not by this file.
