// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { WidgetView } from './shared'
import { tr } from '../../i18n'

export default function ToggleSwitch({ widget, theme, sim }: WidgetView) {
  const { w, h } = widget
  const key = typeof widget.props?.signal === 'string' ? widget.props.signal : ''
  const on = (sim[key] ?? Object.values(sim)[0] ?? 0) >= 0.5
  const text = on
    ? String(widget.props?.onLabel ?? tr('ON'))
    : String(widget.props?.offLabel ?? tr('OFF'))
  const knobX = on ? w - h / 2 - 3 : h / 2 + 3
  return (
    <g>
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={(h - 2) / 2} fill={on ? theme.running : theme.panel} stroke={theme.equipStroke} strokeWidth={1.5} />
      <circle cx={knobX} cy={h / 2} r={h / 2 - 5} fill={theme.text} />
      <text x={w / 2} y={h + 12} textAnchor="middle" fill={theme.textDim} fontSize={10}>{text}</text>
    </g>
  )
}
