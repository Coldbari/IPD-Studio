// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiWidget, WidgetType } from './model'
import { WIDGET_DEFAULT_SIZE } from './model'
import { THEMES } from './theme'
import { renderWidget } from './widgets/index'
import { useStore } from '../store/store'
import { tr, useT } from '../i18n'

export const HMI_DRAG_MIME = 'application/x-hmi-widget'

export interface PaletteItem { type: WidgetType; label: string; props?: HmiWidget['props'] }

export const SECTIONS: { title: string; items: PaletteItem[] }[] = [
  {
    title: 'Equipment',
    items: [
      { type: 'tank', label: 'Tank' }, { type: 'pump', label: 'Pump' },
      { type: 'valve', label: 'Valve' },
      { type: 'equip', label: 'Agitator', props: { symbolId: 'agitator' } },
      { type: 'equip', label: 'Compressor', props: { symbolId: 'comp.centrifugal' } },
      { type: 'equip', label: 'Blower', props: { symbolId: 'blower' } },
      { type: 'equip', label: 'Conveyor', props: { symbolId: 'conveyor.belt' } },
      { type: 'equip', label: 'Heater', props: { symbolId: 'heater.fired' } },
      { type: 'symbol', label: 'P&ID symbol' },
    ],
  },
  {
    title: 'Indicators',
    items: [
      { type: 'display', label: 'Value display' }, { type: 'bar', label: 'Bar indicator' },
      { type: 'gauge', label: 'Gauge' }, { type: 'trend', label: 'Trend' },
      { type: 'lamp', label: 'Lamp' },
    ],
  },
  {
    title: 'Controls',
    items: [
      { type: 'button', label: 'Button' }, { type: 'switch', label: 'Switch' },
      { type: 'nav', label: 'Screen link' },
    ],
  },
  {
    title: 'Layout',
    items: [{ type: 'label', label: 'Text' }, { type: 'panel', label: 'Group panel' }],
  },
]

const PREVIEW_SIM: Partial<Record<WidgetType, Record<string, number>>> = {
  tank: { PV: 62 }, pump: { RUN: 1 }, equip: { RUN: 1 }, valve: { OP: 60 }, display: { PV: 48.3 },
  gauge: { PV: 65 }, trend: { PV: 52 }, lamp: { on: 1 }, switch: { on: 1 },
  bar: { PV: 58, SP: 65 },
}
const TREND_PREVIEW = [30, 35, 42, 40, 48, 55, 52, 60, 58, 66, 63, 70]

function ItemPreview({ item }: { item: PaletteItem }) {
  const { type } = item
  const size = WIDGET_DEFAULT_SIZE[type]
  const widget: HmiWidget = {
    id: `pal-${type}`, type, x: 0, y: 0, ...size,
    label: type === 'label' ? tr('Text') : type === 'button' ? tr('START') : type === 'nav' ? tr('Screen') : type === 'panel' ? tr('Group') : undefined,
    props: item.props
      ?? (type === 'valve' ? { throttle: true }
      : type === 'symbol' ? { symbolId: 'vessel.column-tray' }
      : type === 'lamp' || type === 'switch' ? { signal: 'on' }
      : type === 'bar' ? { H: 80, L: 20 }
      : undefined),
  }
  const pad = 14
  return (
    <svg width={54} height={36} viewBox={`${-pad} ${-pad} ${size.w + 2 * pad} ${size.h + 2 * pad}`}
      style={{ background: THEMES.classic.bg, borderRadius: 4, flex: '0 0 auto' }} aria-hidden>
      {renderWidget({ widget, theme: THEMES.classic, sim: PREVIEW_SIM[type] ?? {}, hist: type === 'trend' ? { t: TREND_PREVIEW.map((_, i) => i * 3), series: { PV: TREND_PREVIEW } } : undefined })}
    </svg>
  )
}

export default function HmiPalette() {
  const t = useT()
  const addWidget = useStore((s) => s.addWidget)
  return (
    <div style={{ padding: 8 }}>
      {SECTIONS.map((sec) => (
        <div key={sec.title}>
          <h4 style={{ margin: '8px 0 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#667' }}>{t(sec.title)}</h4>
          {sec.items.map((it) => (
            <div
              key={`${it.type}:${it.label}`}
              className="hmi-pal-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(HMI_DRAG_MIME, JSON.stringify({ type: it.type, props: it.props }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => {
                const size = WIDGET_DEFAULT_SIZE[it.type]
                addWidget({ type: it.type, x: 320, y: 240, ...size, ...(it.props ? { props: it.props } : {}) })
              }}
              title={t('Drag onto the canvas (or double-click to place)')}
            >
              <ItemPreview item={it} />
              <span>{t(it.label)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
