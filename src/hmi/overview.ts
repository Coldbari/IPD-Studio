// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { ulid } from 'ulid'
import type { HmiScreen, HmiWidget } from './model'
import { HMI_WORLD } from './model'
import { tr } from '../i18n'

export interface KeyTag { tag: string; kind: 'controller' | 'tank' | 'flow' | 'other' }

/** The tags an overview tile should headline: control loops first, then
 *  inventories (tanks), then flows, then anything else tagged — the story an
 *  L1 display tells per unit. */
export function keyTags(screen: Pick<HmiScreen, 'widgets'>, n = 3): KeyTag[] {
  const rank: Record<KeyTag['kind'], number> = { controller: 0, tank: 1, flow: 2, other: 3 }
  const seen = new Map<string, KeyTag>()
  for (const w of screen.widgets) {
    if (!w.tag) continue
    // only tags that HAVE a displayable PV — a pump/valve tile row would
    // just read "—"
    const kind: KeyTag['kind'] | null =
      w.props?.controller === true ? 'controller'
      : w.type === 'tank' ? 'tank'
      : typeof w.props?.bindPipe === 'string' ? 'flow'
      : w.type === 'display' || w.type === 'gauge' || w.type === 'bar' || w.type === 'trend' ? 'other'
      : null
    if (!kind) continue
    const existing = seen.get(w.tag)
    if (!existing || rank[kind] < rank[existing.kind]) seen.set(w.tag, { tag: w.tag, kind })
  }
  return [...seen.values()].sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, n)
}

const MARGIN = 40
const GAP = 24
const TILE_PAD = 12

/** Auto-built L1 plant overview: one tile per screen — title, its key
 *  values, and a Screen link (which wears the alarm dot in RUN). Ordinary
 *  widgets, fully editable afterwards. */
export function buildOverview(screens: HmiScreen[]): HmiScreen {
  const cols = Math.min(3, Math.max(1, screens.length))
  const rows = Math.ceil(screens.length / cols)
  const tileW = Math.floor((HMI_WORLD.w - 2 * MARGIN - (cols - 1) * GAP) / cols)
  const tileH = Math.min(280, Math.floor((HMI_WORLD.h - 2 * MARGIN - (rows - 1) * GAP) / rows))
  const widgets: HmiWidget[] = []

  screens.forEach((sc, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = MARGIN + col * (tileW + GAP)
    const y = MARGIN + row * (tileH + GAP)
    widgets.push({ id: ulid(), type: 'panel', x, y, w: tileW, h: tileH, label: sc.name })
    const inner = x + TILE_PAD
    let cy = y + 34
    for (const kt of keyTags(sc, Math.max(1, Math.floor((tileH - 90) / 48)))) {
      widgets.push({
        id: ulid(), type: 'display', x: inner, y: cy, w: Math.min(200, tileW - 2 * TILE_PAD), h: 40,
        tag: kt.tag, props: kt.kind === 'tank' ? { unit: '%' } : undefined,
      })
      cy += 48
    }
    widgets.push({
      id: ulid(), type: 'nav', x: inner, y: y + tileH - TILE_PAD - 32, w: Math.min(180, tileW - 2 * TILE_PAD), h: 32,
      label: sc.name, props: { screen: sc.id },
    })
  })

  return { id: ulid(), name: tr('Plant overview'), theme: screens[0]?.theme ?? 'classic', widgets, pipes: [], home: true }
}
