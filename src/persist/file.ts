// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectDoc } from '../model/types'
import { loadDoc } from '../model/migrate'
import { createEmptyDoc } from '../model/doc'
import { importDexpi } from '../import/dexpi'
import { useStore } from '../store/store'
import { showStatus } from '../feedback/notices'

/**
 * `pretty` (the default) keeps the on-disk `.pnid` human-readable, which the
 * README promises. The cloud copy passes `{ pretty: false }`: indentation was
 * costing HALF the 900 kB Firestore budget — measured at 328 B/item pretty
 * against 165 B/item compact on the 3-sheet refinery sample — and nobody ever
 * reads that string by eye.
 */
export function serializeDoc(doc: ProjectDoc, opts: { pretty?: boolean } = {}): string {
  return JSON.stringify(doc, null, opts.pretty === false ? undefined : 2)
}

export function deserializeDoc(json: string): ProjectDoc {
  return loadDoc(JSON.parse(json))
}

interface FilePickerWindow extends Window {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>
}

/** IPD Studio's own drawing extension. Old .pnid.json / .json files still open. */
export const PNID_EXT = '.pnid'
export const PNID_MIME = 'application/x-pnid'

const PICKER_TYPES = [
  { description: 'IPD Studio drawing', accept: { [PNID_MIME]: [PNID_EXT] } },
  { description: 'Legacy JSON drawing', accept: { 'application/json': ['.json'] } },
  { description: 'DEXPI / Proteus XML', accept: { 'application/xml': ['.xml'] } },
]

/** True when a DEXPI import would discard HMI work. Exported so the caller can
 *  ask BEFORE the parse, rather than the parse asking mid-flight. */
export function dexpiWouldDiscardHmi(text: string, name: string): boolean {
  if (!isDexpiText(text, name)) return false
  return useStore.getState().doc.hmiScreens.some((sc) => sc.widgets.length > 0 || sc.pipes.length > 0)
}

export function isDexpiText(text: string, name: string): boolean {
  return name.endsWith('.xml') || text.trimStart().startsWith('<?xml') || text.includes('<PlantModel')
}

/**
 * Load a drawing from text. Throws on failure — the CALLER decides how to say
 * so, because a drop on the canvas, a File menu open and a PWA file handler
 * all want to phrase it differently and only the caller knows which it is.
 *
 * The HMI-discard question moved out to the callers for the same reason: a
 * confirm() buried in a parser cannot be awaited, styled, or tested.
 */
export function loadAnyText(name: string, text: string): void {
  if (isDexpiText(text, name)) {
    const { sheet, warnings } = importDexpi(text)
    const doc = createEmptyDoc(sheet.name || name.replace(/\.[^.]+$/, ''))
    doc.sheets = [sheet]
    useStore.getState().loadIntoStore(doc)
    if (warnings.length) {
      showStatus(
        `Imported with ${warnings.length} note${warnings.length === 1 ? '' : 's'} — some content was approximated.`,
        { kind: 'warning', details: warnings.join('\n') },
      )
    }
    return
  }
  useStore.getState().loadIntoStore(deserializeDoc(text))
}

export async function saveFile(): Promise<void> {
  const { doc, markSaved } = useStore.getState()
  const json = serializeDoc(doc)
  const w = window as FilePickerWindow
  const suggested = `${(doc.meta.name || 'diagram').replace(/[^\w-]+/g, '-')}${PNID_EXT}`
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: suggested, types: PICKER_TYPES })
      const writable = await (handle as unknown as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable()
      await writable.write(json)
      await writable.close()
      markSaved()
      return
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // fall through to download
    }
  }
  const blob = new Blob([json], { type: PNID_MIME })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = suggested
  a.click()
  URL.revokeObjectURL(a.href)
  markSaved()
}

export async function openFile(): Promise<void> {
  const w = window as FilePickerWindow
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: PICKER_TYPES })
      if (!handle) return
      const file = await handle.getFile()
      loadAnyText(file.name, await file.text())
      return
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      throw err
    }
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = `${PNID_EXT},.json,.xml,${PNID_MIME},application/json,application/xml`
  input.onchange = async () => {
    const file = input.files?.[0]
    if (file) loadAnyText(file.name, await file.text())
  }
  input.click()
}
