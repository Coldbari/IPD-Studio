// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Attribution switch for the drawing sheet drawn behind the symbols.
 *
 * The sheet is three things stacked — a soft shadow, a dot-grid pattern fill
 * and a white page — and each is a candidate for the zoom-dependent raster
 * cost. Running the same gesture with one of them missing is what told us
 * which one it was. `oldfilter` restores the pre-fix `feDropShadow` in the
 * running page, so before and after can be measured in one binary instead of
 * across two checkouts.
 *
 * Self-contained by design: this is handed to page.evaluate, so it may not
 * close over anything in module scope.
 */
export type SheetMode = 'full' | 'noshadow' | 'nogrid' | 'none' | 'oldfilter'

export function applySheetMode(mode: string): void {
  if (mode === 'full') return
  const g = document.querySelector('.pid-sheet')
  if (!g) return
  if (mode === 'none') {
    g.remove()
    return
  }
  const rects = [...g.querySelectorAll('rect')]
  const fill = (r: Element) => r.getAttribute('fill') ?? ''
  const shadowRects = rects.filter((r) => fill(r).startsWith('url(#pid-sh-'))
  const gridRect = rects.find((r) => fill(r) === 'url(#pid-grid)')
  const pageRect = rects.find((r) => fill(r) === '#ffffff')
  if (mode === 'noshadow') for (const r of shadowRects) r.remove()
  if (mode === 'nogrid') gridRect?.remove()
  if (mode === 'oldfilter') {
    for (const r of shadowRects) r.remove()
    const defs = document.querySelector('#pid-sheet-defs')
    if (defs && !defs.querySelector('#pid-sheet-shadow')) {
      defs.insertAdjacentHTML(
        'beforeend',
        `<filter id="pid-sheet-shadow" x="-4%" y="-4%" width="108%" height="108%">` +
          `<feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="#0d1b2a" flood-opacity="0.24"/>` +
          `</filter>`,
      )
    }
    pageRect?.setAttribute('filter', 'url(#pid-sheet-shadow)')
  }
}
