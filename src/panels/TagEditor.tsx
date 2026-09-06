// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useRef } from 'react'
import { expandLetters, validateLetters } from '../isa/tag'
import { isDuplicateTag, suggestLoop } from '../isa/autonumber'
import { pauseHistory, resumeHistory, useStore } from '../store/store'
import type { PlantNode } from '../model/types'
import { useT } from '../i18n'

export default function TagEditor({ node }: { node: PlantNode }) {
  const t = useT()
  const setTag = useStore((s) => s.setTag)
  const doc = useStore((s) => s.doc)
  const tag = node.tag ?? { letters: '', loop: '' }
  const autoLoop = useRef<string | null>(null)

  const validation = useMemo(() => (tag.letters ? validateLetters(tag.letters) : null), [tag.letters])
  const expansion = useMemo(() => (tag.letters ? expandLetters(tag.letters) : ''), [tag.letters])
  const duplicate = useMemo(
    () => (tag.letters && tag.loop ? isDuplicateTag(doc, tag, node.id) : false),
    [doc, tag, node.id],
  )

  const update = (patch: Partial<typeof tag>) => {
    const next = { ...tag, ...patch }
    if (!next.letters && !next.loop) setTag(node.id, undefined)
    else setTag(node.id, { letters: next.letters, loop: next.loop, ...(next.suffix ? { suffix: next.suffix } : {}) })
    pauseHistory() // typing bursts undo as one step; resumes on blur/pointerup
  }

  return (
    <div className="prop-group">
      <div className="prop-title">{t('ISA Tag')}</div>
      <div className="tag-row">
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
            const patch: Partial<typeof tag> = { letters }
            const untouched = !tag.loop || tag.loop === autoLoop.current
            if (letters && untouched && validateLetters(letters).ok) {
              const suggested = suggestLoop(doc, node.id, letters)
              patch.loop = suggested
              autoLoop.current = suggested
            }
            update(patch)
          }}
          onBlur={resumeHistory}
        />
        <span>–</span>
        <input
          className="tag-loop"
          placeholder="101"
          value={tag.loop}
          maxLength={6}
          onChange={(e) => update({ loop: e.target.value.replace(/\D/g, '') })}
          onBlur={resumeHistory}
        />
        <input
          className="tag-suffix"
          placeholder=""
          value={tag.suffix ?? ''}
          maxLength={1}
          onChange={(e) => update({ suffix: e.target.value.toUpperCase() || undefined })}
          onBlur={resumeHistory}
        />
        <button
          className="tag-auto"
          title={t('Next free number for these letters')}
          onClick={() => update({ loop: suggestLoop(doc, node.id, tag.letters || 'X') })}
        >
          №
        </button>
      </div>
      {expansion && <div className="tag-expansion">{expansion}</div>}
      {validation && !validation.ok && <div className="tag-error">{validation.reason}</div>}
      {duplicate && <div className="tag-error">{t('Duplicate tag in this drawing')}</div>}
    </div>
  )
}
