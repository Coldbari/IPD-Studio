// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { WidgetView } from './shared'
import { tr } from '../../i18n'

/** Screen navigation button: clicking it in run mode jumps to props.screen.
 *  The property panel keeps the label in sync with the target screen's name. */
export default function NavButton({ widget, theme, sim }: WidgetView) {
  const { w, h } = widget
  const prio = sim.__navPrio ?? 0
  return (
    <g>
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={6} fill={theme.panel} stroke={theme.equipStroke} strokeWidth={1.5} />
      {prio > 0 && (
        <circle cx={w - 24} cy={9} r={4} data-nav-alarm
          fill={prio >= 3 ? '#ff4d4d' : prio >= 2 ? '#ffb020' : '#ffd94d'}
          className={prio >= 3 ? 'hmi-blink' : undefined} />
      )}
      <text x={10} y={h / 2 + 4} fill={theme.text} fontSize={12} fontWeight={600}>
        {widget.label ?? tr('Screen')}
      </text>
      <path d={`M ${w - 16} ${h / 2 - 5} L ${w - 9} ${h / 2} L ${w - 16} ${h / 2 + 5}`}
        fill="none" stroke={theme.textDim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  )
}
