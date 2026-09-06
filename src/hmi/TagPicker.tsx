// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo, useState } from 'react'
import { pauseHistory, resumeHistory, useStore } from '../store/store'
import type { HmiRole } from './tagIndex'
import { listPlantTags, listSignalRefs } from './tagIndex'
import { useT } from '../i18n'

export interface PickOption {
  value: string
  hint?: string
  group: string
}

/** Hyphen- and case-insensitive match, same forgiveness as Ctrl+F find-tag. */
const norm = (s: string) => s.toLowerCase().replace(/-/g, '')

/**
 * Type-ahead combobox for the HMI property panel: a filtered, grouped option
 * list under a plain input. Free text stays legal — the options are offers,
 * not a whitelist. Typing live-commits like every other panel field (grouped
 * into one undo step) so a click elsewhere can never lose the entry; picking
 * an option commits it and ends the burst.
 */
export function ComboBox({ value, options, placeholder, onCommit, testid }: {
  value: string
  options: PickOption[]
  placeholder?: string
  onCommit(next: string | undefined): void
  testid?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [typing, setTyping] = useState(false) // filter only once the user typed
  const [navigated, setNavigated] = useState(false) // arrowed into the list

  const filtered = useMemo(() => {
    const q = typing ? norm(value) : ''
    if (!q) return options
    return options.filter((o) => norm(o.value).includes(q) || norm(o.hint ?? '').includes(q))
  }, [options, value, typing])

  const close = () => {
    resumeHistory()
    setOpen(false)
    setTyping(false)
    setNavigated(false)
  }

  const pick = (v: string) => {
    onCommit(v)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setNavigated(true)
      const d = e.key === 'ArrowDown' ? 1 : -1
      setHi((h) => Math.min(filtered.length - 1, Math.max(0, h + d)))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Enter picks only what the user arrowed to; plain Enter keeps the text
      if (open && navigated && filtered[hi]) pick(filtered[hi].value)
      else close()
    } else if (e.key === 'Escape') {
      close()
    }
  }

  let lastGroup = ''
  return (
    <span className="hmi-combo">
      <input
        value={value}
        placeholder={placeholder}
        data-testid={testid}
        onFocus={() => { setOpen(true); setHi(0); setTyping(false); setNavigated(false) }}
        onChange={(e) => {
          const v = e.target.value
          onCommit(v === '' ? undefined : v)
          pauseHistory()
          setOpen(true)
          setHi(0)
          setTyping(true)
          setNavigated(false)
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      {open && filtered.length > 0 && (
        <ul className="hmi-combo-list" data-testid={testid ? `${testid}-list` : undefined}>
          {filtered.slice(0, 40).map((o, i) => {
            const header = o.group !== lastGroup ? o.group : null
            lastGroup = o.group
            return (
              <li key={o.value + o.group}>
                {header && <div className="hmi-combo-group">{header}</div>}
                <div
                  className={`hmi-combo-item${i === hi ? ' hi' : ''}`}
                  // pointerdown fires before the input's blur — the pick wins
                  onPointerDown={(e) => { e.preventDefault(); pick(o.value) }}
                  onPointerEnter={() => setHi(i)}
                >
                  <span>{o.value}</span>
                  {o.hint && <span className="hint">{o.hint}</span>}
                </div>
              </li>
            )
          })}
          {filtered.length > 40 && <li className="hmi-combo-group">…{filtered.length - 40} {t('more — keep typing')}</li>}
        </ul>
      )}
    </span>
  )
}

/** Tag binding: offers every identity from the P&ID plus tags already used on
 *  HMI screens. */
export function TagPicker({ value, onCommit, testid }: {
  value: string
  onCommit(next: string | undefined): void
  testid?: string
}) {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const ROLE_GROUP: Record<HmiRole, string> = {
    measurement: t('Instruments'), controller: t('Instruments'),
    motor: t('Equipment'), equipment: t('Equipment'), valve: t('Valves'),
  }
  const GROUP_ORDER = [t('Instruments'), t('Equipment'), t('Valves'), t('On screens')]
  const options = useMemo(() => {
    const plant: PickOption[] = listPlantTags(doc).map((item) => ({
      value: item.display, hint: t(item.description), group: ROLE_GROUP[item.role],
    }))
    const have = new Set(plant.map((o) => o.value))
    for (const sc of doc.hmiScreens) {
      for (const w of sc.widgets) {
        if (w.tag && !have.has(w.tag)) {
          have.add(w.tag)
          plant.push({ value: w.tag, group: t('On screens') })
        }
      }
    }
    return plant.sort((a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      a.value.localeCompare(b.value, undefined, { numeric: true }))
  }, [doc, t])
  return <ComboBox value={value} options={options} placeholder={t('e.g. LT-101')} onCommit={onCommit} testid={testid} />
}

/** TAG.SIGNAL binding for lamps/buttons/switches. */
export function SignalPicker({ value, onCommit, testid }: {
  value: string
  onCommit(next: string | undefined): void
  testid?: string
}) {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const options = useMemo(() => listSignalRefs(doc).map((r) => ({
    value: r.ref, hint: t(r.hint), group: r.source === 'hmi' ? t('On screens') : t('From P&ID'),
  })).sort((a, b) =>
    (a.group === b.group ? 0 : a.group === t('On screens') ? -1 : 1) ||
    a.value.localeCompare(b.value, undefined, { numeric: true })), [doc, t])
  return <ComboBox value={value} options={options} placeholder="P-101.RUN" onCommit={onCommit} testid={testid} />
}
