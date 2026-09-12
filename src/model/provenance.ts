// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * CONTROLLED-DOCUMENT PROVENANCE.
 *
 * What an issued revision has to be able to prove, months later, on somebody
 * else's machine: which rules it was checked against, and what the check
 * actually said.
 *
 * Before this, a revision recorded four integers — `3 critical, 11 warning` —
 * and a full document snapshot that never left the computer that issued it.
 * Neither answers the question a reviewer asks. "Three criticals" is evidence
 * that something was counted, not evidence of what was checked, and a snapshot
 * on one laptop is not a controlled document.
 *
 * TWO PAYLOADS, DELIBERATELY SEPARATE:
 *
 *   1. The full editable SNAPSHOT — the whole ProjectDoc, kept in IndexedDB by
 *      `persist/revisions.ts`, used to diff revision N against N+1. Large,
 *      local, and optional: a machine that does not have it degrades to "not
 *      available here".
 *   2. This PROVENANCE — small, plain, and stored ON the revision row inside
 *      `ProjectDoc`. It therefore travels in the `.pnid` like any other part of
 *      the document, with no new persistence mechanism and no second store.
 *
 * They are not the same payload because they answer different questions.
 * "What changed?" needs the document. "What was this checked against, and what
 * did it say?" needs a few kilobytes that must never be separated from the
 * file.
 *
 * Everything here is pure, synchronous, plain-serialisable and DOM-free.
 */

import type { Severity } from '../validate/rules'
import type { QaReport } from '../validate/engine'
import type { StandardProfile } from './standard'

/* ------------------------------------------------------- the fingerprint */

/**
 * The CANONICAL form of a standard: the same content always produces the same
 * string, whatever order it was typed in or serialised in.
 *
 * Object keys are sorted, because JSON key order is an accident of how the
 * object was built. Arrays are NOT sorted by default, because in this profile
 * an array is usually a SEQUENCE whose order is the meaning — `lineNumber.order`
 * decides whether a line reads 6"-CS150-CW-001 or 6"-CW-CS150-001, and
 * `issueStatuses` is the workflow in the order a drawing moves through it.
 *
 * `required` is the exception — along with `issuePolicy[status].blockSeverities`,
 * for exactly the same reason. Those arrays are SETS. The Standards page appends as you tick boxes, so two engineers who
 * select exactly the same required fields in a different order would otherwise
 * produce two different fingerprints for one identical standard. Sorting them
 * makes the fingerprint mean "the same rules", which is what a fingerprint is
 * for.
 */
export function canonicalStandard(std: StandardProfile): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = canon((v as Record<string, unknown>)[k])
      }
      return out
    }
    return v
  }
  const required: Record<string, string[]> = {}
  for (const k of Object.keys(std.required).sort()) {
    required[k] = [...(std.required[k as keyof typeof std.required] ?? [])].sort()
  }
  // The issue policy is IN the fingerprint, deliberately. What a standard
  // permits to be issued is part of what that standard is: two profiles that
  // differ only in whether open criticals block IFC are not the same standard,
  // and a revision issued under one must not claim the other. This does mean
  // adding a policy changes the fingerprint of an otherwise untouched profile
  // — expected, and preferable to a fingerprint that quietly ignores the half
  // of the standard a reviewer most wants to check.
  const issuePolicy = std.issuePolicy
    ? Object.fromEntries(
        Object.keys(std.issuePolicy).sort().map((status) => {
          const gate = std.issuePolicy![status]!
          return [status, { ...gate, ...(gate.blockSeverities ? { blockSeverities: [...gate.blockSeverities].sort() } : {}) }]
        }),
      )
    : undefined
  // `name` and `version` are IN the fingerprint: renaming a standard is a
  // change to the document's account of what it was checked against, even
  // though no rule moved. `id` is in for the same reason.
  return JSON.stringify(canon({ ...std, required, ...(issuePolicy ? { issuePolicy } : {}) }))
}

/**
 * A deterministic 64-bit FNV-1a fingerprint of the canonical form, as 16 hex
 * characters.
 *
 * NOT a cryptographic hash and not claimed to be one: this detects change and
 * identifies configuration, it does not defend against a forger. It is
 * synchronous on purpose — `crypto.subtle` is async, and issuing a revision
 * must capture its provenance in the same tick as everything else it captures.
 *
 * Explicitly NOT a timestamp and NOT random. Two projects that adopted the
 * same company standard produce the same fingerprint on different machines in
 * different years, which is the entire point.
 */
export function fingerprintStandard(std: StandardProfile): string {
  const text = canonicalStandard(std)
  // Two 32-bit FNV-1a lanes with different offset bases, concatenated.
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/**
 * Who the drawing was checked against, frozen onto the revision.
 *
 * A COPY, never a pointer at `doc.standard`. Editing the active standard
 * tomorrow must not retroactively change what Revision B claims — that is the
 * difference between a record and a variable.
 */
export interface StandardProvenance {
  id: string
  name: string
  /** The human-readable version an engineer typed, when they typed one. */
  version?: string
  /** Deterministic, content-derived. The value that actually identifies it. */
  fingerprint: string
}

export function standardProvenance(std: StandardProfile): StandardProvenance {
  return {
    id: std.id,
    name: std.name,
    ...(std.version ? { version: std.version } : {}),
    fingerprint: fingerprintStandard(std),
  }
}

/** Short form for a title block: `Acme v2.1 · a1b2c3d4`. */
export function provenanceLabel(p: StandardProvenance): string {
  return `${p.name}${p.version ? ` v${p.version}` : ''} · ${p.fingerprint.slice(0, 8)}`
}

/* ------------------------------------------------------------ QA evidence */

/** One finding, as it stood at issue. Plain data — no live reference. */
export interface QaFindingRecord {
  ruleId: string
  /** The finding's stable key (`ruleId:entityKey`, or a rule's own variant). */
  key: string
  entityKey: string
  severity: Severity
  /** The rule's title, copied so the record reads without the rule catalogue —
   *  which may not contain that rule at all in a later build. */
  ruleTitle: string
  message: string
  /** Present when the finding had been explicitly accepted at issue. */
  ignored?: { reason: string; by?: string; at: string }
}

/**
 * The QA report as it stood at one issue.
 *
 * `findings` may be CAPPED. A drawing can legitimately produce thousands of
 * info findings, and a `.pnid` that grows by a megabyte per issue is one
 * nobody can email or sync. So the evidence keeps the severe findings first
 * and records honestly how many it left out — `findings.length + omitted`
 * always equals the total. A truncated record that says so is an engineering
 * document; a truncated record that does not is a lie.
 */
export interface QaEvidence {
  findings: QaFindingRecord[]
  /** Findings not stored, by the cap below. 0 when the evidence is complete. */
  omitted: number
  /** ISO timestamp of the capture — metadata about the record, not the check. */
  capturedAt: string
}

/**
 * How much one revision's evidence may carry.
 *
 * MEASURED, not guessed. On a synthetic 300-instrument project producing 901
 * findings, a flat 400-finding cap came to 89.6 kB against a 145 kB document —
 * ten issues would have filled the ~900 kB cloud ceiling (`MAX_DOC_BYTES`) on
 * their own. A project must be able to carry a long history, so the budget is
 * in BYTES, which is what the ceiling is actually measured in; a count cap
 * alone cannot bound a payload whose entries vary in size.
 *
 * The count remains as a backstop for the opposite case — thousands of very
 * short findings — so neither dimension can run away.
 *
 * WHAT GETS DROPPED IS THE LEAST SEVERE, because the list is sorted before it
 * is filled. Criticals and warnings on a real drawing number in the tens and
 * are never reached; this only ever bites info-level noise, which is exactly
 * what should go first. Whatever is dropped is counted in `omitted`, so the
 * record always accounts for every finding even when it cannot store them all.
 */
export const MAX_EVIDENCE_BYTES = 48_000
export const MAX_EVIDENCE_FINDINGS = 400

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/**
 * Freeze a live QA report into evidence.
 *
 * Everything is copied out by value. Nothing here holds a reference into the
 * report, the rules or the document, so what is stored cannot change when any
 * of them does.
 *
 * Ordering is severity, then rule, then entity — deterministic, so issuing the
 * same state twice produces byte-identical evidence and a diff of two `.pnid`
 * files does not show phantom churn.
 */
export function captureQaEvidence(report: QaReport, at: string = new Date().toISOString()): QaEvidence {
  const all: QaFindingRecord[] = []

  for (const group of report.groups) {
    for (const f of group.findings) {
      all.push({
        ruleId: f.ruleId,
        key: f.key,
        entityKey: f.entityKey,
        severity: group.rule.severity,
        ruleTitle: group.rule.title,
        message: f.message,
      })
    }
  }
  // Accepted findings are evidence too — arguably the most important kind,
  // because they are the ones a reviewer asks about. They carry the reason.
  for (const { finding, rule, entry } of report.ignored) {
    all.push({
      ruleId: finding.ruleId,
      key: finding.key,
      entityKey: finding.entityKey,
      severity: rule.severity,
      ruleTitle: rule.title,
      message: finding.message,
      ignored: { reason: entry.reason, ...(entry.by ? { by: entry.by } : {}), at: entry.at },
    })
  }

  all.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.entityKey.localeCompare(b.entityKey) ||
    a.key.localeCompare(b.key))

  // Fill in severity order until either budget is spent. `+ 1` for the comma
  // each entry costs in the serialised array.
  const findings: QaFindingRecord[] = []
  let bytes = 0
  for (const f of all) {
    if (findings.length >= MAX_EVIDENCE_FINDINGS) break
    const size = JSON.stringify(f).length + 1
    if (bytes + size > MAX_EVIDENCE_BYTES && findings.length > 0) break
    findings.push(f)
    bytes += size
  }
  return { findings, omitted: all.length - findings.length, capturedAt: at }
}

/** Counts recomputed FROM the evidence, for the consistency check that the
 *  frozen list and the frozen counts describe one report. */
export function countsOfEvidence(evidence: QaEvidence): { critical: number; warning: number; info: number; total: number } {
  const counts = { critical: 0, warning: 0, info: 0, total: evidence.findings.length + evidence.omitted }
  for (const f of evidence.findings) counts[f.severity] += 1
  return counts
}
