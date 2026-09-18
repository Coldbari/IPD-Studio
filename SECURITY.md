# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.22.x (current) | ✅ Security fixes |
| ≤ 0.21.x | ❌ Not supported — please upgrade |

Only the current minor version receives security fixes. Older versions —
including every version released under the AGPL, i.e. everything before the
v0.13.0 relicense — are not patched. Their license grants are unaffected by
that: not supported is not the same as not licensed. See
[docs/PROVENANCE.md](docs/PROVENANCE.md) for the exact license boundary.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via either:

- **GitHub Security Advisories** — [report a vulnerability](https://github.com/Coldbari/IPD-Studio/security/advisories/new)
  (preferred; keeps the discussion private until a fix ships)
- **Email** — praharshchamp610@gmail.com with `SECURITY` in the subject

Please include: what you found, how to reproduce it, the affected version, and
the impact as you see it. A proof-of-concept `.pnid.json` or SVG file is ideal.

**Response:** initial acknowledgement within 72 hours, an assessment within 7
days, and a fix or a documented mitigation for confirmed issues before public
disclosure. Please allow 90 days before disclosing publicly. Reporters are
credited in the advisory and the changelog unless they prefer otherwise.

## Threat model

IPD Studio is a **local-first browser application with an optional backend**.

**Drawing needs no backend.** The editor, validation, exports and the HMI
simulation all run client-side; drawings live in the browser's IndexedDB and in
files on the user's own machine. When no Firebase project is configured
(`firebaseReady`, `src/auth/config.ts`), the sign-in screen and cloud drawings
are switched off and the app never contacts a server of ours.

**Since v0.13.0 a configured deployment can also reach two optional services:**

- **Accounts and cloud drawings** — Firebase Authentication (email/password and
  Google) plus Firestore. A signed-in user's drawings are stored under their own
  uid, and client access is governed by [`firestore.rules`](firestore.rules),
  which lives in this repository and is deployed from it. The same file defines
  a create-only feedback collection that clients cannot read, update or delete.
  The Firebase SDK is loaded lazily, only once a visitor signs in or opens
  cloud drawings.
- **The project assistant** — optional and bring-your-own-key. The browser calls
  whichever LLM provider the user configures, using the user's own API key. It
  does not send the project document: it sends a projection whose contents are
  classified key by key in `src/assist/redact.ts` and enforced by
  `tests/assist/redact.test.ts`.

A self-hosted build must supply its own Firebase project and deploy its own copy
of `firestore.rules` — see [.env.example](.env.example). The shared demo
deployment runs with these features enabled.

Most of the attack surface is still in what the app *parses*. The rules, the
authentication flows and the redaction boundary are now part of it too, and all
three are in scope below.

**In scope — the app parses untrusted files, and that's where the risk is:**

- **Imported SVG symbols** — sanitized by `src/import/svgSymbol.ts`, which
  strips scripts, event handlers, and external references. Any bypass of that
  sanitizer (XSS via a crafted symbol) is a genuine vulnerability and the
  highest-value thing to look for.
- **`.pnid.json` project files** — prototype pollution, or a crafted document
  that achieves script execution when rendered
- **DEXPI/Proteus XML import** — XXE, entity expansion, parser abuse
- **DXF underlay import** — parser crashes, memory exhaustion, injection into
  rendered output
- **Service worker / PWA caching** — cache poisoning, stale-content attacks
- Dependency vulnerabilities reachable from the shipped bundle
- **Firestore rules** — any path that lets one account read or write another's
  drawings, or read, alter or delete a filed feedback report
- **Authentication flows** — session handling, account takeover, or any route to
  cloud data without a valid session
- **Assistant redaction** — anything that causes project data classified `never`
  in `src/assist/redact.ts` to leave the browser

**Out of scope:**

- Anything requiring the attacker to already control the user's machine or
  browser profile
- Self-XSS a user must deliberately perform on themselves
- Missing hardening headers on the demo deployment with no demonstrated impact
- Denial of service via absurdly large files the user chose to open
- Reports from automated scanners with no working proof of concept
- **Licence violations** — real, but not security. Those go to
  [docs/LICENSE-ENFORCEMENT.md](docs/LICENSE-ENFORCEMENT.md).

## Safety notice

HMI Studio is a **training and demonstration simulator**. It is not certified
for, and must never be connected to, real plant control, safety instrumented
systems, or live process equipment. Drawings and calculations it produces are
engineering aids that require review by a qualified engineer — they are not
approved-for-construction deliverables.

## Researching under the licence

The licence is PolyForm Noncommercial 1.0.0, which explicitly permits use for
**research, experiment, and testing**. Security research on IPD Studio is
welcome and needs no separate permission. Please test against your own local
build rather than the shared demo deployment.
