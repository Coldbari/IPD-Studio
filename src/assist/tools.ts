// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectIndex } from '../model/projectIndex'
import { signalReach } from '../model/projectIndex'
import { qaFor } from '../validate/engine'
import { formatTag, validateLetters } from '../isa/tag'
import { SYMBOLS, searchSymbols } from '../symbols/registry'
import { TYPICALS } from './typicals'
import type { FixSpec } from './fixes'
import type { SelectionBrief } from './context'
import { refOf } from './context'
import { redactBrief } from './redact'
import type { AssistToolDef } from './transport/types'

/**
 * What the model may do.
 *
 * Every tool is READ-ONLY except `propose_fix`, and `propose_fix` cannot invent
 * a repair — it can only surface one a RULE already computed, by key. That is
 * the grounding property in its strongest form: the model chooses among fixes
 * the engine produced, it never authors one, so it cannot propose an edit the
 * app would not have offered on its own.
 */
export const TOOL_DEFS: AssistToolDef[] = [
  {
    name: 'get_selection',
    description:
      'What the user currently has selected: the object, its tag, ports, immediate neighbours, '
      + 'loop membership and any findings against it. Call this first for any question about "this" or "here".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_objects',
    description:
      'Search the drawing. Returns id, tag/label and sheet for each hit. Use this instead of guessing a tag: '
      + 'if an object is not returned here, it does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        tagLike: { type: 'string', description: 'Substring of the tag or label, case-insensitive.' },
        kind: { type: 'string', enum: ['equipment', 'instrument', 'valve', 'fitting', 'annotation'] },
        untagged: { type: 'boolean', description: 'Only objects with no ISA tag.' },
        limit: { type: 'integer', maximum: 50, default: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_object',
    description: 'Full detail for one object, by tag (e.g. "FT-101") or id. Includes its engineering record.',
    inputSchema: {
      type: 'object',
      properties: { idOrTag: { type: 'string' } },
      required: ['idOrTag'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_loop',
    description: 'A control loop by family letter and number, with member roles (element/transmitter/controller/final).',
    inputSchema: {
      type: 'object',
      properties: { family: { type: 'string', maxLength: 1 }, loop: { type: 'string' } },
      required: ['family', 'loop'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_findings',
    description:
      'Open QA findings from the rule engine, with severity and whether a fix exists. '
      + 'This is the ONLY source of truth about what is wrong with the drawing.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['critical', 'warning', 'info', 'all'], default: 'all' },
        limit: { type: 'integer', maximum: 40, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'walk_signal',
    description: 'Follow the signal chain from an instrument, up to 3 hops. Answers "what does this control".',
    inputSchema: {
      type: 'object',
      properties: { idOrTag: { type: 'string' }, hops: { type: 'integer', maximum: 3, default: 3 } },
      required: ['idOrTag'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_symbols',
    description:
      'Search the 195-symbol catalog by name or keyword ("globe control valve", "orifice", "psv"). '
      + 'You MUST call this before place_symbol — the symbolId you pass there has to come from a result here.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer', maximum: 20, default: 8 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'place_symbol',
    description:
      'Propose adding ONE symbol to the active sheet. Does not apply anything — the user sees what it '
      + 'would do and must approve. You choose WHAT; the app chooses where it goes and its id. '
      + 'It is placed unconnected: say so, and tell the user which lines to draw.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolId: { type: 'string', description: 'Exact id from find_symbols. Anything else is rejected.' },
        letters: { type: 'string', description: 'ISA letters to tag it with, e.g. "FV". Omit to leave untagged. The loop number is assigned by the app.' },
        nearTag: { type: 'string', description: 'Tag or label of an object to place it beside.' },
      },
      required: ['symbolId'],
      additionalProperties: false,
    },
  },
  {
    name: 'place_typical',
    description:
      'Propose adding a complete, pre-wired, pre-tagged control loop. Strongly prefer this over placing '
      + 'symbols one at a time when the user wants a control loop — every member shares one loop number '
      + 'and the signal lines are drawn for you. Does not apply anything without approval.',
    inputSchema: {
      type: 'object',
      properties: {
        typicalId: { type: 'string', enum: ['flow-control', 'level-control', 'pressure-control', 'temp-control', 'onoff-valve'] },
        nearTag: { type: 'string', description: 'Tag or label of an object to place it beside.' },
      },
      required: ['typicalId'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_fix',
    description:
      'Propose applying a repair the rule engine already computed, named by its finding key from list_findings. '
      + 'This does NOT apply anything — the user is shown exactly what it would do and must approve it. '
      + 'You cannot invent a fix; only keys returned by list_findings with hasFix=true are valid.',
    inputSchema: {
      type: 'object',
      properties: { findingKey: { type: 'string' } },
      required: ['findingKey'],
      additionalProperties: false,
    },
  },
]

export interface ToolOutcome {
  content: string
  isError?: boolean
  /** Set by any proposing tool — the session turns this into a consent card
   *  and stops the turn. Nothing here is applied until a person says so. */
  proposedSpec?: FixSpec
}

const json = (v: unknown): string => JSON.stringify(v)

function resolve(ix: ProjectIndex, idOrTag: string): string | null {
  if (ix.nodes.has(idOrTag) || ix.edges.has(idOrTag)) return idOrTag
  const needle = idOrTag.trim().toUpperCase()
  for (const n of ix.allNodes) {
    if (n.key?.toUpperCase() === needle) return n.node.id
    if (n.node.label?.toUpperCase() === needle) return n.node.id
  }
  for (const e of ix.allEdges) if (e.key?.toUpperCase() === needle) return e.edge.id
  return null
}

/**
 * How an object is described TO THE MODEL.
 *
 * `_id` is named with a leading underscore and documented as internal because
 * models reliably echo whatever field looks like an identifier — the first
 * build of this answered "which tank is this?" with a ULID and a table of port
 * names, which is unreadable to an engineer. The name the drawing gives the
 * object goes first, under the plain key.
 */
const summarise = (ix: ProjectIndex, id: string) => ({
  name: refOf(ix, id),
  sheet: ix.nodes.get(id)?.sheet.name ?? ix.edges.get(id)?.sheet.name ?? null,
  _id: id,
})

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ix: ProjectIndex,
  brief: SelectionBrief,
): ToolOutcome {
  switch (name) {
    case 'get_selection':
      return { content: json(redactBrief(brief)) }

    case 'find_objects': {
      const like = String(input.tagLike ?? '').trim().toUpperCase()
      const kind = input.kind as string | undefined
      const untagged = input.untagged === true
      const limit = Math.min(Number(input.limit ?? 25) || 25, 50)
      const hits = ix.allNodes.filter((n) => {
        if (kind && n.node.kind !== kind) return false
        if (untagged && n.node.tag?.loop) return false
        if (!like) return true
        const hay = `${n.key ?? ''} ${n.node.label ?? ''}`.toUpperCase()
        return hay.includes(like)
      })
      return {
        content: json({
          total: hits.length,
          shown: Math.min(hits.length, limit),
          results: hits.slice(0, limit).map((n) => summarise(ix, n.node.id)),
        }),
      }
    }

    case 'get_object': {
      const id = resolve(ix, String(input.idOrTag ?? ''))
      if (!id) return { content: `No object on any sheet matches "${input.idOrTag}". Do not refer to it.`, isError: true }
      const n = ix.nodes.get(id)
      if (n) {
        return {
          content: json({
            ...summarise(ix, id),
            type: SYMBOLS.get(n.node.symbolId)?.name ?? n.node.symbolId,
            kind: n.node.kind,
            tag: n.node.tag ? formatTag(n.node.tag, '-') : null,
            label: n.node.label ?? null,
            hasEngineeringRecord: Boolean(n.key && ix.records[n.key]),
            record: n.key ? (ix.records[n.key]?.fields ?? null) : null,
            // Names and types only. Port ids and node handles are noise an
            // engineer cannot use, and the model echoes whatever it is given.
            connectedTo: (ix.neighbours.get(id) ?? []).map((o) => ({
              name: refOf(ix, o),
              type: SYMBOLS.get(ix.nodes.get(o)?.node.symbolId ?? '')?.name ?? null,
            })),
          }),
        }
      }
      const e = ix.edges.get(id)!
      return {
        content: json({
          ...summarise(ix, id),
          lineClass: e.edge.lineClass,
          arrow: e.edge.arrow ?? 'none',
          lineNumber: e.key,
          record: e.key ? (ix.records[e.key] ?? null) : null,
        }),
      }
    }

    case 'get_loop': {
      const family = String(input.family ?? '').toUpperCase()
      const loop = String(input.loop ?? '')
      const found = ix.loops.find((l) => l.family === family && l.loop === loop)
      if (!found) return { content: `No loop ${family}-${loop} exists. Loops present: ${ix.loops.map((l) => `${l.family}-${l.loop}`).join(', ') || 'none'}.`, isError: true }
      return {
        content: json({
          ref: `${family}-${loop}`,
          members: found.members.map((m) => ({ ...summarise(ix, m.nodeId), tag: formatTag(m.tag, '-') })),
          hint: found.hint ?? null,
        }),
      }
    }

    case 'list_findings': {
      const want = String(input.severity ?? 'all')
      const limit = Math.min(Number(input.limit ?? 20) || 20, 40)
      const report = qaFor(ix.doc)
      const rows = report.groups
        .filter((g) => want === 'all' || g.rule.severity === want)
        .flatMap((g) => g.findings.map((f) => ({
          key: f.key,
          rule: g.rule.id,
          severity: g.rule.severity,
          message: f.message,
          target: f.targetId ? summarise(ix, f.targetId) : null,
          hasFix: Boolean(f.fix),
        })))
      return { content: json({ total: rows.length, shown: Math.min(rows.length, limit), findings: rows.slice(0, limit) }) }
    }

    case 'walk_signal': {
      const id = resolve(ix, String(input.idOrTag ?? ''))
      if (!id) return { content: `No object matches "${input.idOrTag}".`, isError: true }
      const hops = Math.min(Number(input.hops ?? 3) || 3, 3)
      const reached = [...signalReach(ix, id, hops)]
      return {
        content: json({
          from: summarise(ix, id),
          hops,
          reached: reached.map((r) => ({ ...summarise(ix, r), kind: ix.nodes.get(r)?.node.kind ?? null })),
        }),
      }
    }

    case 'find_symbols': {
      const limit = Math.min(Number(input.limit ?? 8) || 8, 20)
      const hits = searchSymbols(String(input.query ?? '')).slice(0, limit)
      if (hits.length === 0) return { content: `Nothing in the catalog matches "${input.query}". Try a broader word.`, isError: true }
      return { content: json(hits.map((d) => ({ symbolId: d.id, name: d.name, category: d.category }))) }
    }

    case 'place_symbol': {
      const symbolId = String(input.symbolId ?? '')
      if (!SYMBOLS.has(symbolId)) {
        return { content: `"${symbolId}" is not in the catalog. Call find_symbols and use an id it returns.`, isError: true }
      }
      const letters = input.letters ? String(input.letters).toUpperCase() : undefined
      if (letters) {
        const check = validateLetters(letters)
        if (!check.ok) return { content: `"${letters}" is not a valid ISA letter set: ${check.reason}`, isError: true }
      }
      const near = input.nearTag ? resolve(ix, String(input.nearTag)) : null
      return {
        content: json({ proposed: true, symbol: SYMBOLS.get(symbolId)!.name, awaitingApproval: true }),
        proposedSpec: {
          kind: 'place-symbol',
          symbolId,
          sheetId: brief.project.activeSheet.id,
          ...(letters ? { letters } : {}),
          ...(near ? { nearNodeId: near } : {}),
        },
      }
    }

    case 'place_typical': {
      const typicalId = String(input.typicalId ?? '')
      if (!TYPICALS.some((t) => t.id === typicalId)) {
        return { content: `"${typicalId}" is not a known typical loop.`, isError: true }
      }
      const near = input.nearTag ? resolve(ix, String(input.nearTag)) : null
      return {
        content: json({ proposed: true, typical: typicalId, awaitingApproval: true }),
        proposedSpec: {
          kind: 'place-typical',
          typicalId,
          sheetId: brief.project.activeSheet.id,
          ...(near ? { nearNodeId: near } : {}),
        },
      }
    }

    case 'propose_fix': {
      const key = String(input.findingKey ?? '')
      const report = qaFor(ix.doc)
      const hit = report.groups.flatMap((g) => g.findings).find((f) => f.key === key)
      if (!hit) return { content: `No open finding has key "${key}". Call list_findings first.`, isError: true }
      if (!hit.fix) return { content: `Finding "${key}" has no automatic fix. Explain what the engineer should do instead.`, isError: true }
      return {
        content: json({ proposed: true, label: hit.fix.label, awaitingApproval: true }),
        proposedSpec: hit.fix.spec,
      }
    }

    default:
      return { content: `Unknown tool "${name}".`, isError: true }
  }
}
