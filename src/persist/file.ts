// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectDoc } from '../model/types'
import { loadDoc } from '../model/migrate'
import { createEmptyDoc } from '../model/doc'
import { importDexpi } from '../import/dexpi'
import { useStore } from '../store/store'
import { tr } from '../i18n'

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

let currentFileHandle: FileSystemFileHandle | null = null
let currentDocumentEpoch = useStore.getState().documentEpoch

// A document load starts a new local-file session. This also covers New,
// templates, cloud opens, autosave restore, and files dropped on the canvas.
useStore.subscribe((state) => {
  if (state.documentEpoch === currentDocumentEpoch) return
  currentDocumentEpoch = state.documentEpoch
  currentFileHandle = null
})

/** Remove characters Windows rejects while preserving project names such as Chinese text. */
export function fileNameForDoc(name: string): string {
  const stem = name
    .trim()
    .replace(/\.pnid$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
  return `${stem || 'Untitled P&ID'}${PNID_EXT}`
}

/** A new document or an imported text file no longer belongs to the old file. */
export function clearCurrentFileHandle(): void {
  currentFileHandle = null
}

const PICKER_TYPES = [
  { description: 'IPD Studio drawing', accept: { [PNID_MIME]: [PNID_EXT] } },
  { description: tr('Legacy JSON drawing'), accept: { 'application/json': ['.json'] } },
  { description: 'DEXPI / Proteus XML', accept: { 'application/xml': ['.xml'] } },
]

export function loadAnyText(name: string, text: string): void {
  clearCurrentFileHandle()
  if (name.endsWith('.xml') || text.trimStart().startsWith('<?xml') || text.includes('<PlantModel')) {
    // a DEXPI import starts a fresh doc — flag the silent HMI wipe the audit found
    const cur = useStore.getState().doc
    const hasHmi = cur.hmiScreens.some((sc) => sc.widgets.length > 0 || sc.pipes.length > 0)
    if (hasHmi && !window.confirm(tr('Importing this DEXPI file starts a NEW document — your current HMI screens are discarded. Continue?'))) return
    const { sheet, warnings } = importDexpi(text)
    const doc = createEmptyDoc(sheet.name || name.replace(/\.[^.]+$/, ''))
    doc.sheets = [sheet]
    useStore.getState().loadIntoStore(doc)
    if (warnings.length) window.alert(`${tr('DEXPI import finished with warnings:')}\n${warnings.join('\n')}`)
    return
  }
  useStore.getState().loadIntoStore(deserializeDoc(text))
}

export async function saveFile(options: { saveAs?: boolean; rememberHandle?: boolean } = {}): Promise<void> {
  const { doc, markSaved } = useStore.getState()
  const json = serializeDoc(doc)
  const w = window as FilePickerWindow
  const suggested = fileNameForDoc(doc.meta.name)

  if (!options.saveAs && currentFileHandle) {
    try {
      const writable = await (currentFileHandle as unknown as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable()
      await writable.write(json)
      await writable.close()
      markSaved()
      return
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // The original handle may have been moved or revoked. Ask for a new
      // destination below rather than silently downloading a second copy.
      currentFileHandle = null
    }
  }

  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: suggested, types: PICKER_TYPES })
      const writable = await (handle as unknown as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable()
      await writable.write(json)
      await writable.close()
      if (options.rememberHandle !== false) currentFileHandle = handle
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
      currentFileHandle = handle
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
