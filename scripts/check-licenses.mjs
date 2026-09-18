// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Dependency licence gate.
 *
 * IPD Studio is licensed under PolyForm Noncommercial 1.0.0 and sells separate
 * commercial licences (COMMERCIAL-LICENSE.md). Both of those depend on the
 * dependency tree staying free of copyleft that cannot be sublicensed
 * commercially — a single GPL/AGPL/LGPL package anywhere in the shipped bundle
 * would close that door, exactly as it already closed the LibreDWG path for
 * DWG import. This script is the gate that keeps it shut.
 *
 * It reads package-lock.json only: no network, no install, no dependencies.
 *
 *   node scripts/check-licenses.mjs             gate — exits 1 on a DENIED licence
 *   node scripts/check-licenses.mjs --inventory markdown tables for THIRD-PARTY-LICENSES.md
 *
 * DENIED fails the build. REVIEW never fails it: MPL-2.0, EPL, CDDL and the
 * CC family carry real obligations but all of them are compatible with
 * shipping a commercial product, so they are reported for a human to read
 * rather than blocked. UNKNOWN is also reported, not blocked — an unparsed
 * SPDX string is a documentation problem, not a licence violation.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Copyleft that cannot be relicensed commercially, plus source-available terms. */
const DENIED = [
  /\bA?GPL(-[\d.]+)?(-only|-or-later)?\b/i, // GPL, AGPL, LGPL are all caught here
  /\bLGPL\b/i,
  /\bSSPL\b/i,
  /\bBUSL\b/i,
  /\bBusiness Source\b/i,
  /\bElastic-2\.0\b/i,
  /\bCommons[- ]Clause\b/i,
  /\bCC-BY-NC/i,
  /\bCC-BY-SA/i,
  /\bOSL-/i,
  /\bEUPL\b/i,
  /\bProprietary\b/i,
  /\bUNLICENSED\b/,
]

/** Permitted, but the obligations need a human to have read them once. */
const REVIEW = [
  /\bMPL-[\d.]+\b/i,
  /\bEPL-[\d.]+\b/i,
  /\bCDDL\b/i,
  /\bCC-BY-[\d.]+\b/i,
  /\bCC0-[\d.]+\b/i,
  /\bMS-PL\b/i,
]

/** Permissive: attribution only. */
const ALLOWED = [
  /\bMIT(-0)?\b/i,
  /\bApache-2\.0\b/i,
  /\bBSD-[23]-Clause\b/i,
  /\bBSD\b/i,
  /\bISC\b/i,
  /\b0BSD\b/i,
  /\bBlueOak-[\d.]+\b/i,
  /\bUnlicense\b/i,
  /\bWTFPL\b/i,
  /\bZlib\b/i,
  /\bPython-2\.0\b/i,
]

/** Split "(MIT OR CC0-1.0)" into its SPDX tokens. */
function tokens(expr) {
  return expr
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((t) => t.trim())
    .filter(Boolean)
}

function classify(expr) {
  if (!expr) return 'UNKNOWN'
  const parts = tokens(expr)
  // A dual licence is only denied when EVERY option is denied — "(GPL OR MIT)"
  // can be taken under MIT.
  if (parts.every((p) => DENIED.some((re) => re.test(p)))) return 'DENIED'
  const usable = parts.filter((p) => !DENIED.some((re) => re.test(p)))
  if (usable.some((p) => ALLOWED.some((re) => re.test(p)))) return 'ALLOWED'
  if (usable.some((p) => REVIEW.some((re) => re.test(p)))) return 'REVIEW'
  return 'UNKNOWN'
}

function readTree() {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
  const out = []
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path) continue // the root project itself
    out.push({
      name: path.replace(/^node_modules\//, '').replace(/.*\/node_modules\//, ''),
      version: meta.version ?? '',
      license: meta.license ?? (meta.licenses ? JSON.stringify(meta.licenses) : ''),
      dev: Boolean(meta.dev),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function tally(pkgs) {
  const counts = new Map()
  for (const p of pkgs) counts.set(p.license || '(none)', (counts.get(p.license || '(none)') ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

const pkgs = readTree()
const runtime = pkgs.filter((p) => !p.dev)
const dev = pkgs.filter((p) => p.dev)

if (process.argv.includes('--inventory')) {
  const rows = (list) => list.map((p) => `| \`${p.name}\` | ${p.version} | ${p.license || '—'} |`).join('\n')
  const counts = (list) => tally(list).map(([lic, n]) => `| ${lic} | ${n} |`).join('\n')
  console.log('<!-- RUNTIME-TALLY -->')
  console.log('| License | Packages |\n|---|---|')
  console.log(counts(runtime))
  console.log('<!-- DEV-TALLY -->')
  console.log('| License | Packages |\n|---|---|')
  console.log(counts(dev))
  console.log('<!-- RUNTIME-TABLE -->')
  console.log('| Package | Version | License |\n|---|---|---|')
  console.log(rows(runtime))
  console.log('<!-- DEV-TABLE -->')
  console.log('| Package | Version | License |\n|---|---|---|')
  console.log(rows(dev))
  process.exit(0)
}

const denied = pkgs.filter((p) => classify(p.license) === 'DENIED')
const review = pkgs.filter((p) => classify(p.license) === 'REVIEW')
const unknown = pkgs.filter((p) => classify(p.license) === 'UNKNOWN')

console.log(`Dependency licence gate — ${pkgs.length} packages (${runtime.length} runtime, ${dev.length} dev)\n`)
console.log('Runtime licences:')
for (const [lic, n] of tally(runtime)) console.log(`  ${String(n).padStart(4)}  ${lic}`)
console.log('\nDevelopment licences:')
for (const [lic, n] of tally(dev)) console.log(`  ${String(n).padStart(4)}  ${lic}`)

if (review.length) {
  console.log('\nREVIEW — permitted, obligations documented in THIRD-PARTY-LICENSES.md:')
  for (const p of review) console.log(`  ${p.name}@${p.version}  ${p.license}${p.dev ? '  (dev)' : '  (RUNTIME)'}`)
}

if (unknown.length) {
  console.log('\nUNKNOWN — licence string not recognised, read it before shipping:')
  for (const p of unknown) console.log(`  ${p.name}@${p.version}  ${p.license || '(no license field)'}${p.dev ? '  (dev)' : '  (RUNTIME)'}`)
}

if (denied.length) {
  console.error('\nDENIED — these licences cannot be sublicensed under a commercial agreement:')
  for (const p of denied) console.error(`  ${p.name}@${p.version}  ${p.license}${p.dev ? '  (dev)' : '  (RUNTIME)'}`)
  console.error('\nSee COMMERCIAL-LICENSE.md and CONTRIBUTING.md. Remove the dependency or find a permissive equivalent.')
  process.exit(1)
}

console.log('\nOK — no denied licences.')
