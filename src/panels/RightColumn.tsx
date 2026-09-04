// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useCallback, useState } from 'react'
import PropertyPanel from './PropertyPanel'
import AssistPanel from './AssistPanel'

type Mode = 'props' | 'assist'

export const PROPS_MIN = 240
export const PROPS_MAX = 760

/**
 * The right column, shared by the inspector and the assistant.
 *
 * They share it rather than sitting side by side because the arithmetic does
 * not work otherwise: rail 60 + palette 236 + properties 288 + a fourth column
 * would leave under 400px of canvas on a 1280 laptop. Sharing costs zero new
 * pixels, and the trade is honest — while you are reading an answer you are
 * not editing a property field, and one click gets you back.
 */
export default function RightColumn({ onCollapse, onWidth }: {
  onCollapse?: () => void
  /** Reports a new column width in px while the divider is dragged. */
  onWidth?: (px: number) => void
}) {
  const [mode, setMode] = useState<Mode>('props')

  // Pointer capture rather than window listeners: the drag keeps working when
  // the pointer crosses the canvas, which owns its own pointer handlers.
  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!onWidth) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const next = Math.min(PROPS_MAX, Math.max(PROPS_MIN, window.innerWidth - ev.clientX))
      onWidth(next)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [onWidth])

  return (
    <div className="right-col">
      {onWidth && (
        <div
          className="col-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the panel"
          title="Drag to resize · double-click to reset"
          data-testid="right-grip"
          onPointerDown={startDrag}
          onDoubleClick={() => onWidth(288)}
        />
      )}
      <div className="right-tabs" role="tablist" aria-label="Right panel">
        <button
          role="tab"
          aria-selected={mode === 'props'}
          className={mode === 'props' ? 'on' : ''}
          data-testid="right-tab-props"
          onClick={() => setMode('props')}
        >
          Properties
        </button>
        <button
          role="tab"
          aria-selected={mode === 'assist'}
          className={mode === 'assist' ? 'on' : ''}
          data-testid="right-tab-assist"
          onClick={() => setMode('assist')}
          title="Ask about the drawing"
        >
          Assistant
        </button>
      </div>
      {mode === 'props' ? <PropertyPanel onCollapse={onCollapse} /> : <AssistPanel onCollapse={onCollapse} />}
    </div>
  )
}
