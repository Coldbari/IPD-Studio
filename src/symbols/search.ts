// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Finding an engineering symbol.
 *
 * The catalogue used to be filtered by substring and then listed
 * alphabetically, which is a fine way to search a phone book and a poor way to
 * search a P&ID library. The queries an instrument engineer actually types are
 * two-letter ISA codes, and those are exactly the ones it handled worst:
 *
 *     FT  ->  FT, Crystallizer, Fan (Axial)          ("draft")
 *     PT  ->  PT, Rupture Disc, Rupture Pin Valve    ("rupture")
 *     LT  ->  LT + eleven wrong answers              ("filter", "belt", "ult")
 *     CV  ->  three regulators, THEN the control valves
 *
 * So matches are scored rather than merely found, and the score says WHY the
 * thing matched. Two rules carry most of the weight:
 *
 *   1. A match on what something IS — its id, its name — beats a match on
 *      what it happens to be described as. "Foot Valve" carries the keyword
 *      "pump"; it is not a pump, and it now ranks below every symbol whose
 *      name says Pump.
 *
 *   2. A short query only matches at a word boundary. Two or three letters
 *      inside a longer word is a coincidence, not an answer: "ft" in "draft"
 *      tells you nothing, while "ft" as a whole word or the start of one is
 *      the ISA code the engineer meant.
 *
 * Nothing here knows a single query by name. New symbols and new presets take
 * part automatically, which is the only way a catalogue that grows can stay
 * searchable.
 */

/** The tiers a match can land in, strongest first. Exported so tests can name
 *  them rather than assert on bare numbers. */
export const TIER = {
  /** The ISA shortcut itself: "FT" typed, FT offered. */
  lettersExact: 0,
  /** The catalogue id, whole: "psv", "hx.plate". */
  idExact: 1,
  /** The full name, whole: "gate valve". */
  nameExact: 2,
  /** A longer ISA shortcut that starts with what was typed: "fi" -> FIC, FIT.
   *  Above the name tiers on purpose: someone typing two letters is typing a
   *  tag, and FIC is a better answer to "FI" than Filled Bulb + Capillary. */
  lettersPrefix: 3,
  /** The name begins with it: "gate" -> Gate Valve, before AND Gate. */
  namePrefix: 4,
  /** A word of the name: "tank" in "Storage Tank", "pump" in "PD Pump". */
  nameWord: 5,
  /** The start of a word of the name: "trans" in "Transmitter". */
  nameWordPrefix: 6,
  /** A keyword, whole: "stirrer", "i/p". */
  keywordExact: 7,
  /** A word of the id: "vessel" in `vessel.tank`, "cv" in `cv.globe`. */
  idWord: 8,
  /** The start of a word of a keyword. */
  keywordPrefix: 9,
  /** Every word of the query lands somewhere — what makes "heat exchanger"
   *  find Shell & Tube, whose name says neither word in that order. */
  allWords: 10,
  /** Anywhere at all. Only for queries long enough that a coincidence is
   *  unlikely; this is the tier that used to be the whole search. */
  substring: 11,
} as const

export const NO_MATCH = Infinity

/** Below this length a query matches only at word boundaries. Two letters
 *  inside a word is the "draft" problem; three is still mostly coincidence. */
const SHORT = 3

const WORD_SPLIT = /[^a-z0-9]+/

function words(text: string): string[] {
  return text.split(WORD_SPLIT).filter(Boolean)
}

/** What a searchable thing offers. A symbol has an id and keywords; an
 *  instrument preset has ISA letters and a name. Both go through one scorer,
 *  so the palette can merge them on a single scale instead of always putting
 *  one kind in front of the other. */
export interface SearchRecord {
  id?: string
  name: string
  keywords?: readonly string[]
  letters?: string
}

/** A record with its words already split. Built once per catalogue, never per
 *  keystroke: 194 symbols re-split on every character typed is work nobody
 *  asked for. */
export interface Indexed {
  id: string
  idWords: string[]
  name: string
  nameWords: string[]
  keywords: string[]
  keywordWords: string[]
  letters: string
  allWords: string[]
  all: string
}

export function indexRecord(rec: SearchRecord): Indexed {
  const id = (rec.id ?? '').toLowerCase()
  const name = rec.name.toLowerCase()
  const keywords = (rec.keywords ?? []).map((k) => k.toLowerCase())
  const idWords = words(id)
  const nameWords = words(name)
  const keywordWords = keywords.flatMap(words)
  return {
    id,
    idWords,
    name,
    nameWords,
    keywords,
    keywordWords,
    letters: (rec.letters ?? '').toLowerCase(),
    allWords: [...nameWords, ...keywordWords, ...idWords],
    all: `${name} ${keywords.join(' ')} ${id}`,
  }
}

export interface Query {
  text: string
  words: string[]
  /** Word boundaries only — see SHORT. */
  strict: boolean
}

/** `null` for a query with nothing in it. */
export function prepareQuery(raw: string): Query | null {
  const text = raw.trim().toLowerCase()
  if (!text) return null
  return { text, words: words(text), strict: text.length <= SHORT }
}

const startsWithAny = (list: string[], q: string) => list.some((w) => w.startsWith(q))

/**
 * How well this record answers this query. Lower is better; `NO_MATCH` means
 * it does not answer it at all.
 *
 * The order of the checks IS the ranking, so it reads top to bottom as the
 * question "what is the strongest true thing I can say about this match?".
 */
export function scoreIndexed(ix: Indexed, q: Query): number {
  if (ix.letters && ix.letters === q.text) return TIER.lettersExact
  if (ix.id && ix.id === q.text) return TIER.idExact
  if (ix.name === q.text) return TIER.nameExact
  if (ix.letters && ix.letters.startsWith(q.text)) return TIER.lettersPrefix
  if (ix.name.startsWith(q.text)) return TIER.namePrefix
  if (ix.nameWords.includes(q.text)) return TIER.nameWord
  if (startsWithAny(ix.nameWords, q.text)) return TIER.nameWordPrefix
  if (ix.keywords.includes(q.text)) return TIER.keywordExact
  if (ix.idWords.includes(q.text)) return TIER.idWord
  if (startsWithAny(ix.keywordWords, q.text)) return TIER.keywordPrefix
  // Every word has to land somewhere — the Phase 4 rule that made "heat
  // exchanger" find anything at all.
  //
  // A ONE-letter word has to land on a whole word rather than the start of
  // one, for the same reason a short query does: "i/p" splits to "i" and "p",
  // and letting those prefix anything matched a third of the catalogue.
  if (q.words.length > 1 && q.words.every((w) => (
    w.length > 1 ? startsWithAny(ix.allWords, w) : ix.allWords.includes(w)
  ))) {
    return TIER.allWords
  }
  // The old whole search, now the last resort, and closed to short queries.
  if (!q.strict && ix.all.includes(q.text)) return TIER.substring
  return NO_MATCH
}

/** Rank a set of already-indexed records. Ties break on the display name, so
 *  the order is the same every time it is asked. */
export function rankIndexed<T>(
  entries: readonly { ix: Indexed; item: T }[],
  q: Query,
): { item: T; score: number }[] {
  const out: { item: T; score: number; name: string }[] = []
  for (const e of entries) {
    const score = scoreIndexed(e.ix, q)
    if (score !== NO_MATCH) out.push({ item: e.item, score, name: e.ix.name })
  }
  out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
  return out.map(({ item, score }) => ({ item, score }))
}
