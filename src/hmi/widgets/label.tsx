// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { WidgetView } from './shared'
import { tr } from '../../i18n'

export default function LabelText({ widget, theme }: WidgetView) {
  return (
    <text x={0} y={widget.h / 2 + 4} fill={theme.text} fontSize={Math.max(12, widget.h - 10)}>
      {widget.label ?? tr('Text')}
    </text>
  )
}
