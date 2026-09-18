# Provenance

A factual record of who wrote IPD Studio, under which license, and how
contributions and dependencies are controlled. It exists so that anyone
evaluating the project — a commercial licensee, an OEM partner, a contributor,
or a reviewer — can check the answers rather than ask for them.

**Every claim below is verifiable from this repository or the GitHub API, and
each section says how.** Where the repository does not establish something,
this document says so and stops there. It draws no legal conclusions.

Recorded at **v0.22.0**, `main` at commit `f8de3b2`.

---

## 1. Copyright as stated in the repository

> Copyright © 2026 Praharsh Nagpure. All rights reserved.

That line is in [NOTICE](../NOTICE). The same holder is named in the
`Required Notice:` line of [LICENSE](../LICENSE), in the `@license` banner that
[`vite.config.ts`](../vite.config.ts) stamps onto every emitted JS chunk, and in
the SPDX header of every source file.

No other person, company, institution or funder is named as a copyright holder,
contributor, sponsor or rights-holder anywhere in the repository's contents.

```bash
grep -n "Copyright" NOTICE LICENSE
grep -rn "Copyright" src --include="*.ts" --include="*.tsx" | grep -v "Praharsh Nagpure"   # no results
```

## 2. Repository ownership

| | |
|---|---|
| Repository | `Coldbari/IPD-Studio` |
| Owner account | `Coldbari` — GitHub account type **User**, profile name "Praharsh Nagpure" |
| Visibility | Public |
| Is a fork | No |

**Public is not open source.** The repository is publicly readable; the license
is PolyForm Noncommercial 1.0.0, which is source-available and not an OSI
open-source license. GitHub's own license detection classifies it as `other`
rather than as a recognised open-source license.

```bash
gh api repos/Coldbari/IPD-Studio -q '.visibility, .owner.login, .owner.type, .license.key'
```

## 3. Author identities on `main`

`main` records exactly two Git author identities, both using the same author
display name:

| Git author | Commits on `main` |
|---|---|
| `PraharshNagpure <2023.praharsh.nagpure@ves.ac.in>` | 129 |
| `PraharshNagpure <praharshchamp610@gmail.com>` | 94 |
| **Total** | **223** |

GitHub maps these to two accounts — `PraharshNagpure` and `Coldbari` — and both
accounts carry the profile name "Praharsh Nagpure". The repository is owned by
`Coldbari`.

**The project owner states that both identities are their own.** That is a
statement by the owner recorded here, not something the commit data itself
proves; Git author fields are self-asserted. What the repository does show is
that both identities share one display name, that no other author appears, and
that no third party is recorded anywhere as a contributor or rights-holder.

This document draws **no conclusion** about whether any institution associated
with either email domain has, or does not have, any claim. The repository
contains no institutional copyright notice, no funding acknowledgement, no
grant reference, and no institution named anywhere in its contents. Questions
of institutional policy are outside what a repository can answer.

```bash
git shortlog -sne main
gh api repos/Coldbari/IPD-Studio/contributors -q '.[] | "\(.login) \(.contributions)"'
```

## 4. Single-author status of `main`

**No third-party code is in `main`.** All 223 commits are authored by the two
identities above. Dependabot's dependency bumps were squash-merged under the
owner's identity.

One external pull request exists and is **open, unmerged, and not an ancestor
of `main`**: PR #24 (`Excalibur-osu`), +5,044 / −1,050 across 102 files. It is
not part of the codebase. Verified three ways:

```bash
# 1. not reachable from main
git merge-base --is-ancestor <pr-commit> main   # false for all five commits

# 2. the files it introduces do not exist on main
git cat-file -e main:src/i18n.ts                # absent
git cat-file -e main:src/model/junctions.ts     # absent

# 3. the one file it shares with main predates the fork
git log --format="%h %ad %an" --date=short main -- src/canvas/vertexClean.ts
```

The third check matters: `src/canvas/vertexClean.ts` exists on both, but the
version on `main` was authored on 2026-08-24, before the fork was created on
2026-09-02. The PR modifies that file; `main` does not contain its
modifications.

## 5. License history

| Period | License |
|---|---|
| Project start (2026-08-20) to the relicense | **GNU AGPL-3.0-only** |
| Relicense onward | **PolyForm Noncommercial 1.0.0** |

**The boundary is a commit, and it is exact:**

```
978d84b   2026-09-01T13:19:19Z   feat: v0.13.0 — PolyForm licensing, accounts, and cloud drawings
```

That commit replaced the 661-line GNU AFFERO GENERAL PUBLIC LICENSE text with
PolyForm Noncommercial 1.0.0, added [NOTICE](../NOTICE), and added SPDX headers
across the source tree. Everything from `978d84b` forward is PolyForm; its
parent and everything before it is AGPL-3.0-only.

```bash
git show 978d84b^:LICENSE | head -2      # GNU AFFERO GENERAL PUBLIC LICENSE
git show 978d84b:LICENSE  | head -1      # PolyForm Noncommercial License 1.0.0
git log -1 --format="%H %aI" 978d84b
```

**The AGPL grant was not revoked and cannot be.** AGPL-3.0 §2 states that the
rights it grants "are irrevocable provided the stated conditions are met" — that
text is in this repository's own history (`git show 978d84b^:LICENSE`, line 145).
Anyone who received an AGPL-era version keeps their AGPL rights to that version,
including the right to use it commercially. [NOTICE](../NOTICE),
[README.md](../README.md), [COMMERCIAL-LICENSE.md](../COMMERCIAL-LICENSE.md) and
[CHANGELOG.md](../CHANGELOG.md) all state this, and it is not in dispute.

**A note on version numbering.** The published documents describe the AGPL era
as running "up to and including v0.12.1". The tag and release record is
narrower than that: the highest AGPL-era tag in the repository is `v0.10.0`, and
no `v0.11.x` or `v0.12.x` tag or GitHub Release exists — those versions were
deployed as hosted builds rather than tagged. The commit boundary above is
therefore the precise and reliable statement of which code is under which
license.

```bash
git tag --sort=v:refname
gh api repos/Coldbari/IPD-Studio/releases -q '.[].tag_name'
```

## 6. Current licensing boundary

- **v0.13.0 and later** (all code from `978d84b` onward, including the current
  v0.22.0): PolyForm Noncommercial 1.0.0.
- Declared in [LICENSE](../LICENSE), [NOTICE](../NOTICE),
  [`package.json`](../package.json) (`"license": "PolyForm-Noncommercial-1.0.0"`),
  and in an SPDX header on **303 of 304** source files. The one file without a
  header is `src/vite-env.d.ts`, a single-line type reference.
- The `@license` banner survives minification and carries the version, so a
  built bundle states its own terms.
- Commercial rights are **not** granted by this license and come only from a
  separate written agreement — see [COMMERCIAL-LICENSE.md](../COMMERCIAL-LICENSE.md).

```bash
echo "source files: $(find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) | wc -l)"
echo "with SPDX:    $(grep -rl 'SPDX-License-Identifier' src | wc -l)"
```

## 7. AI-assisted development (development-process disclosure)

**All 223 commits on `main` carry a `Co-Authored-By: Claude …` trailer.** IPD
Studio was developed with AI coding assistance throughout, and the commit
history records that rather than hiding it.

```bash
git rev-list main | while read c; do
  git log -1 --format="%b" "$c" | grep -qi "co-authored-by: claude" || echo "$c"
done   # prints nothing: every commit carries the trailer
```

This is stated as a **fact about the development process**. This document draws
no conclusion about the copyright status of AI-assisted output — that is a legal
question, it varies by jurisdiction, and a repository cannot settle it.

Two bounded controls are worth recording alongside it, because they address the
places where the risk would actually sit:

- [CONTRIBUTING.md](../CONTRIBUTING.md) forbids feeding standards documents into
  AI tools to generate symbols. Symbol geometry is authored from first
  principles instead (section 10 below).
- [CONTRIBUTING.md](../CONTRIBUTING.md) forbids pasting in code whose license
  has not been checked, and forbids copyleft code outright.

## 8. Contributor and CLA process

IPD Studio is dual-licensed: PolyForm Noncommercial for everyone, separate paid
commercial agreements for companies. For commercial licenses to be grantable,
one party has to hold the right to grant them.

**A code contribution cannot be merged until its author records the CLA line in
the pull request.** The exact wording is in
[CONTRIBUTING.md](../CONTRIBUTING.md#contributor-license-agreement-cla). It is a
license grant, not an assignment — contributors keep their copyright.

Nothing is required for issues, bug reports, symbol requests, convention
corrections or discussion.

**No CLA has been recorded for any contribution to date.** None was needed:
`main` contains no third-party code (section 4). The one external pull request,
PR #24, carries no CLA statement and remains unmerged.

Governance now backing this:

- [`.github/CODEOWNERS`](../.github/CODEOWNERS) routes every outside pull
  request to the maintainer for review.
- [`.github/workflows/license-check.yml`](../.github/workflows/license-check.yml)
  gates the dependency tree on every push and pull request.

## 9. Third-party dependency policy

The dependency tree is kept free of licenses that cannot be sublicensed under a
commercial agreement. As of v0.22.0, across **577 packages** (106 runtime, 471
development):

- **Zero** GPL, AGPL, LGPL, SSPL, BUSL, Elastic or Commons Clause packages.
- **Zero** packages missing a license field.
- Exactly **one** weak-copyleft package can reach a build: `@joint/core` under
  MPL-2.0, used unmodified. MPL-2.0 is file-level copyleft and permits
  distribution inside a larger work under different terms.

The full inventory, attribution notices and the MPL-2.0 obligations are in
[THIRD-PARTY-LICENSES.md](../THIRD-PARTY-LICENSES.md).
[`scripts/check-licenses.mjs`](../scripts/check-licenses.mjs) enforces the policy
in CI.

This policy has already changed a product decision: the GPLv3 LibreDWG option
for in-browser DWG import was closed at v0.13.0 precisely because GPL code
cannot be combined with a noncommercial license or sublicensed commercially
(see [CHANGELOG.md](../CHANGELOG.md), v0.13.0).

```bash
npm run license:check
```

## 10. Independent symbol authorship

All symbols are original works, authored from geometric first principles — a
gate valve is two triangles, a field instrument is a circle. As
[NOTICE](../NOTICE) states:

> No artwork was traced, copied, or vectorized from the ISA-5.1 standard
> document, vendor libraries, or other software.

[CONTRIBUTING.md](../CONTRIBUTING.md) makes this a non-negotiable rule for
contributions: symbols must be independently authored, standards documents must
never be fed into AI tools to generate them, and pull requests that cannot
establish independent authorship are closed.

The project is not affiliated with, sponsored by, or endorsed by the
International Society of Automation. "ISA" is referenced only to describe the
drawing conventions the symbols follow.

Symbols live as data in [`src/symbols/lib/`](../src/symbols/lib/), as SVG-string
renderers with port definitions — readable, and auditable against this claim.

---

## What this document is not

It is a record of verifiable repository facts. It is **not** legal advice, not a
warranty, and not a title opinion. It does not resolve questions about
AI-assisted authorship or about any institution's policies, and it does not
attempt to. Anyone relying on these facts for a transaction should verify them
with the commands given and take their own advice.
