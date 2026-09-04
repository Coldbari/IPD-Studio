// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { sheetPx } from '../model/doc'
import { exportSvg } from './svg'
import { activeSheet, useStore } from '../store/store'

/**
 * Rasterize the active sheet and hand back the PNG, rather than downloading it.
 *
 * Split out of `exportPng` so the feedback dialog can attach the drawing on a
 * browser with no screen-capture API (`feedback/screenshot.ts`). Note what this
 * renders: `exportSvg` draws the sheet and none of the surrounding chrome, so
 * it answers "the line routes wrongly" and cannot answer "the panel covers the
 * dialog" — which is why the two are labelled differently in the UI.
 */
export function renderSheetPng(scale = 2): Promise<{ blob: Blob; width: number; height: number }> {
  const state = useStore.getState()
  const sheet = activeSheet(state)
  const svg = exportSvg(state.doc, sheet)
  const { w, h } = sheetPx(sheet.sheetSize)
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The drawing could not be rasterized.'))
    }
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('The drawing could not be rasterized.'))
        return
      }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        canvas.width = canvas.height = 0
        if (blob) resolve({ blob, width, height })
        else reject(new Error('The drawing could not be rasterized.'))
      }, 'image/png')
    }
    img.src = url
  })
}

/** Rasterize the active sheet to a PNG download at the given scale. */
export function exportPng(scale = 2): void {
  const state = useStore.getState()
  const sheet = activeSheet(state)
  void renderSheetPng(scale).then(({ blob }) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${state.doc.meta.name || 'diagram'}-${sheet.name.replace(/\s+/g, '')}.png`
    a.click()
    URL.revokeObjectURL(a.href)
  })
}
