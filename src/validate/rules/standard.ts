// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { finding } from '../rules'
import { LINE_PART_LABELS, loopDigitsOk, missingLineParts, padLoop, suffixAllowed } from '../../model/standard'

/**
 * The checks that exist only because a company said so.
 *
 * Every other rule in the engine states something an engineer would call wrong
 * anywhere — a duplicate tag, a controller driving nothing. These two are
 * different: they are wrong only against *this project's* standard, and on a
 * project with a different profile the same drawing is correct. That is the
 * whole point, and it is why they read `ix.standard` rather than a constant.
 *
 * None of them offers a fix, deliberately. The repair for a mis-formatted tag
 * is a rename, and a rename changes an engineering identity that records,
 * datasheets, loops and the HMI all hang off. The existing `assign-tag` fix
 * would be worse than nothing here: it allocates the next FREE number, so
 * "fixing" FT-101 under a 4-digit standard would silently move the instrument
 * to a different loop. Renaming stays a decision the engineer makes by hand.
 */

export const tagFormat: Rule = {
  id: 'tag-format',
  title: 'Tags that do not match the project standard',
  severity: 'warning',
  discipline: 'tagging',
  why: 'The numbering convention is what makes tags sortable, machine-readable, and consistent with the rest of the plant.',
  run(ix) {
    const std = ix.standard
    const out = []
    for (const [key, group] of ix.nodesByKey) {
      const first = group[0]!
      const tag = first.node.tag
      if (!tag) continue

      if (!loopDigitsOk(std, tag.loop)) {
        out.push(
          finding(
            tagFormat,
            key,
            `${key} uses a ${tag.loop.length}-digit loop number; the standard is ${std.tagFormat.digits} digits `
              + `(${tag.letters}${std.tagFormat.separator}${padLoop(std, tag.loop)}${tag.suffix ?? ''})`,
            { targetId: first.node.id, sheetId: first.sheet.id },
          ),
        )
        continue
      }

      if (tag.suffix && !suffixAllowed(std)) {
        out.push(
          finding(tagFormat, key, `${key} carries a suffix, which the standard's ${std.tagFormat.pattern} format does not use`, {
            targetId: first.node.id,
            sheetId: first.sheet.id,
          }),
        )
      }
    }
    return out
  },
}

export const lineNumberIncomplete: Rule = {
  id: 'line-number-incomplete',
  title: 'Line numbers missing a component',
  severity: 'warning',
  discipline: 'tagging',
  why: 'A line list is only usable if every line carries the same components — the missing ones are what a piping engineer filters and sorts on.',
  run(ix) {
    const std = ix.standard
    const out = []
    for (const [key, group] of ix.edgesByKey) {
      const first = group[0]!
      const ln = first.edge.lineNumber
      if (!ln) continue
      const missing = missingLineParts(std, ln)
      if (!missing.length) continue
      out.push(
        finding(
          lineNumberIncomplete,
          key,
          `${key} is missing ${missing.map((m) => LINE_PART_LABELS[m].toLowerCase()).join(', ')}`,
          { targetId: first.edge.id, sheetId: first.sheet.id },
        ),
      )
    }
    return out
  },
}

export const STANDARD_RULES: Rule[] = [tagFormat, lineNumberIncomplete]
