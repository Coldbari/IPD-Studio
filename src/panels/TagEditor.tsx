// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import { expandLetters, formatTag, validateLetters } from '../isa/tag'
import { isDuplicateTag, suggestLoop } from '../isa/autonumber'
import { pauseHistory, resumeHistory, useStore } from '../store/store'
import { clearTagImpact, renameImpact } from '../model/references'
import type { PlantNode, Tag } from '../model/types'
import RenameImpactView, { ClearImpactView } from './RenameImpact'

const keyOf = (t: Tag): string | null => (t.letters && t.loop ? formatTag(t, '-') : null)

/**
 * Tagging an object, and renaming one.
 *
 * These are two different operations and this editor treats them differently
 * on purpose.
 *
 * FIRST TAGGING commits live, per keystroke, exactly as it always has: there is
 * nothing to carry, auto-numbering reads the document as you type, and the QA
 * report clearing the "untagged" finding as the letters land is the feedback
 * that makes the panel feel alive.
 *
 * RENAMING an object that already carries a complete tag holds a DRAFT instead.
 * A rename moves engineering records, HMI bindings, trend pens and accepted
 * findings, and committing that on every keystroke means typing 201 over 101
 * performs four renames — through 10, 1, 20 — each dragging every reference
 * with it, and the intermediate ones are meaningless. The draft is applied once
 * the engineer accepts it: Enter, or moving focus out of the tag fields.
 */
export default function TagEditor({ node }: { node: PlantNode }) {
  const setTag = useStore((s) => s.setTag)
  const doc = useStore((s) => s.doc)
  const committed: Tag = node.tag ?? { letters: '', loop: '' }
  const autoLoop = useRef<string | null>(null)
  const [clash, setClash] = useState(false)
  /** null = showing the document. Non-null = an unapplied rename in progress. */
  const [draft, setDraft] = useState<Tag | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  const tag = draft ?? committed

  // Selecting a different symbol must never show the previous one's draft.
  useEffect(() => {
    setDraft(null)
    setClash(false)
    autoLoop.current = null
  }, [node.id])

  const validation = useMemo(() => (tag.letters ? validateLetters(tag.letters) : null), [tag.letters])
  const expansion = useMemo(() => (tag.letters ? expandLetters(tag.letters) : ''), [tag.letters])
  const duplicate = useMemo(
    () => (tag.letters && tag.loop ? isDuplicateTag(doc, tag, node.id) : false),
    [doc, tag, node.id],
  )

  /** Clearing a tag on an object that HAS one: no destination, so nothing is
   *  carried and everything pointing at it is stranded. Treated separately
   *  from a rename all the way through — different preview, different
   *  confirmation, and never applied by simply looking away. */
  const clearing = Boolean(draft && keyOf(committed) && !keyOf(draft))

  /** Non-mutating, and recomputed only when the draft or the document moves. */
  const impact = useMemo(
    () => (draft && !clearing ? renameImpact(doc, keyOf(committed), keyOf(draft)) : null),
    [doc, draft, clearing, committed.letters, committed.loop, committed.suffix],
  )
  const clearImpact = useMemo(
    () => (clearing ? clearTagImpact(doc, keyOf(committed)) : null),
    [doc, clearing, committed.letters, committed.loop, committed.suffix],
  )

  const write = (next: Tag) => {
    const result =
      !next.letters && !next.loop
        ? setTag(node.id, undefined)
        : setTag(node.id, { letters: next.letters, loop: next.loop, ...(next.suffix ? { suffix: next.suffix } : {}) })
    // A refused rename changes NOTHING — not the record, not the HMI bindings,
    // and not the tag on the drawing. Say so at the moment it happens.
    setClash(result.collision)
    return result
  }

  const update = (patch: Partial<Tag>) => {
    const next = { ...tag, ...patch }
    // A complete tag already on the object means this edit is a RENAME: hold it.
    if (draft || keyOf(committed)) {
      setDraft(next)
      return
    }
    write(next)
    pauseHistory() // typing bursts undo as one step; resumes on blur/pointerup
  }

  const applyDraft = () => {
    if (!draft) return
    const changed = keyOf(draft) !== keyOf(committed) || draft.suffix !== committed.suffix
    if (changed && !write(draft).collision) setDraft(null)
    else if (!changed) setDraft(null)
    resumeHistory()
  }

  /** Moving between the three tag fields is still one edit; leaving them
   *  applies — EXCEPT a clear, which strands references and therefore needs a
   *  decision, not an absence of one. Looking away is not consent. */
  const onBlur = (e: React.FocusEvent) => {
    if (rowRef.current?.contains(e.relatedTarget as Node | null)) return
    if (clearing) return
    if (draft) applyDraft()
    else resumeHistory()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!clearing) applyDraft()
    } else if (e.key === 'Escape' && draft) {
      e.preventDefault()
      setDraft(null)
      setClash(false)
    }
  }

  return (
    <div className="prop-group">
      <div className="prop-title">ISA Tag</div>
      <div className="tag-row" ref={rowRef} onBlur={onBlur} onKeyDown={onKeyDown}>
        <input
          className="tag-letters"
          placeholder="FIC"
          value={tag.letters}
          maxLength={5}
          onChange={(e) => {
            // Numbers assign themselves in the same update: each letter
            // combination counts on its own sequence. A number the user
            // typed by hand (≠ the last auto value) is never overwritten.
            const letters = e.target.value.toUpperCase()
            const patch: Partial<Tag> = { letters }
            const untouched = !tag.loop || tag.loop === autoLoop.current
            if (letters && untouched && validateLetters(letters).ok) {
              const suggested = suggestLoop(doc, node.id, letters)
              patch.loop = suggested
              autoLoop.current = suggested
            }
            update(patch)
          }}
        />
        <span>–</span>
        <input
          className="tag-loop"
          placeholder="101"
          value={tag.loop}
          maxLength={6}
          onChange={(e) => update({ loop: e.target.value.replace(/\D/g, '') })}
        />
        <input
          className="tag-suffix"
          placeholder=""
          value={tag.suffix ?? ''}
          maxLength={1}
          onChange={(e) => update({ suffix: e.target.value.toUpperCase() || undefined })}
        />
        <button
          className="tag-auto"
          title="Next free number for these letters"
          onClick={() => update({ loop: suggestLoop(doc, node.id, tag.letters || 'X') })}
        >
          №
        </button>
      </div>
      {expansion && <div className="tag-expansion">{expansion}</div>}
      {validation && !validation.ok && <div className="tag-error">{validation.reason}</div>}
      {duplicate && <div className="tag-error">Duplicate tag in this drawing</div>}
      {clash && (
        <div className="tag-error">
          That tag already has an engineering record, so the rename was refused and nothing
          changed. Free the tag, or give this symbol a different number.
        </div>
      )}
      {impact && <RenameImpactView impact={impact} />}
      {clearImpact && <ClearImpactView impact={clearImpact} />}
      {draft && (
        <div className="tag-draft-actions">
          <button
            className={clearing ? 'tag-clear' : 'tag-apply'}
            data-testid={clearing ? 'tag-clear' : 'tag-apply'}
            onClick={applyDraft}
          >
            {clearing ? 'Clear the tag' : 'Apply rename'}
          </button>
          <button className="tag-cancel" data-testid="tag-cancel" onClick={() => { setDraft(null); setClash(false) }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
