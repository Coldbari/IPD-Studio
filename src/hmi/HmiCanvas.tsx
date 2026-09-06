// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { memo, useEffect, useRef, useState } from 'react'
import type { ThemeTokens } from './theme'
import type { TrendData } from './widgets/shared'
import type { HmiScreen, HmiWidget, WidgetType } from './model'
import { HMI_WORLD, WIDGET_DEFAULT_SIZE } from './model'
import { THEMES } from './theme'
import { renderWidget } from './widgets/index'
import { HANDLES, handlePoint, hitPipe, hitWidget, marqueeHits, normRect, resizeRect, segmentAt, snap8, widgetRect } from './editGeometry'
import type { Handle, Rect } from './editGeometry'
import { duplicateWidgets } from './align'
import type { View } from './view'
import { effectiveK, panBy, viewBoxOf, zoomAt } from './view'
import { useStore } from '../store/store'
import { useSimStore } from './simStore'
import { HMI_DRAG_MIME } from './HmiPalette'
import { parseSignalRef } from './tagIndex'
import { tr } from '../i18n'

/** Structural subset of sim/alarms' AlarmRecord that the canvas needs. */
export interface AlarmView { tag: string; phase: 'pending' | 'active' | 'acked' | 'cleared'; sup?: string }

export interface HmiCanvasProps {
  screen: HmiScreen
  selection: string[]
  onSelect(ids: string[]): void
  mode: 'edit' | 'run'
  tool: 'select' | 'pipe'
  onToolDone(): void
  /** Armed pick-on-canvas: the next click binds a tank/pipe to this widget
   *  instead of selecting. Selection must NOT change while picking. */
  armedPick?: { kind: 'tank' | 'pipe'; widgetId: string } | null
  onPicked?(): void
  /** Zoom/pan view (null = fit). RUN stays fit-locked by the workspace. */
  view?: View | null
  onViewChange?(v: View | null): void
  /** Reports the pointer's world position (paste anchor for the workspace). */
  onCursor?(pt: { x: number; y: number }): void
  /** Runtime bindings (absent in edit mode). */
  sim?: Record<string, Record<string, number>>
  flows?: Record<string, number>
  history?: Record<string, number[]>
  historyT?: number[]
  alarms?: AlarmView[]
  /** Worst standing-alarm priority per target screen (nav button dots). */
  navAlarms?: Record<string, 'high' | 'medium' | 'low'>
  /** Briefly pulse every widget carrying this tag (alarm click-through). */
  flashTag?: string | null
  onWidgetClick?(w: HmiWidget): void
}

interface WidgetGProps {
  widget: HmiWidget
  theme: ThemeTokens
  values: Record<string, number>
  /** Only trend/sparkline widgets receive this (memo stays effective). */
  hist?: TrendData
  alarm: 'none' | 'unacked' | 'acked'
  suppressed: boolean
  flash: boolean
  selected: boolean
  editing: boolean
  ox: number
  oy: number
}

/** Edit-mode preview values so the screen reads as a design, not a void. */
const PREVIEW_TREND = Array.from({ length: 40 }, (_, i) => 50 + Math.sin(i / 4.5) * 18 + (i % 3) * 2)
const PREVIEW_T = Array.from({ length: 40 }, (_, i) => i * 3)
// stable identities per tag so memoized widgets don't re-render while editing
const previewHistCache = new Map<string, TrendData>()
function previewHist(w: HmiWidget): TrendData {
  const ref = w.tag ? `${w.tag}.PV` : 'PV'
  let hit = previewHistCache.get(ref)
  if (!hit) {
    hit = { t: PREVIEW_T, series: { [ref]: PREVIEW_TREND } }
    previewHistCache.set(ref, hit)
  }
  return hit
}
function previewSim(w: HmiWidget): Record<string, number> {
  switch (w.type) {
    case 'tank': return { PV: 42 }
    case 'valve': return { OP: 40, OPEN: 1 }
    case 'pump': return { RUN: 0 }
    case 'display': case 'gauge': case 'trend': case 'bar': {
      const min = Number(w.props?.min ?? 0), max = Number(w.props?.max ?? 100)
      return { PV: min + (max - min) * 0.45, ...(w.props?.controller === true ? { SP: (min + max) / 2 } : {}) }
    }
    default: return {}
  }
}

const shallowEq = (a: Record<string, number>, b: Record<string, number>) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

/** Memoized widget group: a 5 Hz tick only re-renders widgets whose values,
 *  history, alarm state, or geometry actually changed. */
const WidgetG = memo(
  function WidgetG({ widget, theme, values, hist, alarm, suppressed, flash, selected, editing, ox, oy }: WidgetGProps) {
    return (
      <g data-wid={widget.id} className="hmi-widget" transform={`translate(${widget.x + ox}, ${widget.y + oy})`}>
        {renderWidget({ widget, theme, sim: values, hist, alarm })}
        {alarm !== 'none' && (
          <rect x={-4} y={-4} width={widget.w + 8} height={widget.h + 8} fill="none"
            stroke={alarm === 'unacked' ? theme.alarm : theme.alarmAck} strokeWidth={3}
            className={alarm === 'unacked' ? 'hmi-blink' : undefined} />
        )}
        {suppressed && (
          <text x={widget.w - 2} y={-4} textAnchor="end" fontSize={11} fill={theme.textDim}
            data-suppressed aria-label={tr('alarms suppressed')}>⊘</text>
        )}
        {flash && (
          <rect x={-8} y={-8} width={widget.w + 16} height={widget.h + 16} fill="none"
            stroke="#2b6cb0" strokeWidth={4} rx={4} className="hmi-pulse" pointerEvents="none" />
        )}
        {editing && selected && (
          <rect x={-2} y={-2} width={widget.w + 4} height={widget.h + 4} fill="none" stroke="#2b6cb0" strokeDasharray="4 3" strokeWidth={1.5} />
        )}
      </g>
    )
  },
  (prev, next) =>
    prev.widget === next.widget &&
    prev.theme === next.theme &&
    prev.alarm === next.alarm &&
    prev.selected === next.selected &&
    prev.editing === next.editing &&
    prev.ox === next.ox &&
    prev.oy === next.oy &&
    // identity only: the hist slab is rebuilt each tick, so trends re-render
    // every tick (correct — samples scroll); other widgets pass undefined
    prev.hist === next.hist &&
    prev.suppressed === next.suppressed &&
    prev.flash === next.flash &&
    shallowEq(prev.values, next.values),
)

type DragState =
  | { kind: 'move'; start: { x: number; y: number }; downId: string; wasSelected: boolean }
  | { kind: 'resize'; handle: Handle; start: { x: number; y: number }; orig: Rect; id: string; live?: Rect }
  | { kind: 'marquee'; start: { x: number; y: number }; cur: { x: number; y: number }; base: string[] }
  | { kind: 'vertex'; pipeId: string; index: number; live?: { x: number; y: number } }
  | { kind: 'segment'; pipeId: string; index: number; axis: 'h' | 'v'; live?: number }
  | { kind: 'pan'; startClient: { x: number; y: number }; orig: View | null }
  | null

/** Apply an in-flight segment drag to a pipe's points (preview + commit). */
function segmentPoints(points: { x: number; y: number }[], index: number, axis: 'h' | 'v', v: number) {
  return points.map((q, i) =>
    i === index || i === index + 1 ? (axis === 'h' ? { x: q.x, y: v } : { x: v, y: q.y }) : q,
  )
}

export default function HmiCanvas({ screen, selection, onSelect, mode, tool, onToolDone, armedPick, onPicked, view = null, onViewChange, onCursor, sim, flows, history, historyT, alarms, navAlarms, flashTag, onWidgetClick }: HmiCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState>(null)
  const [ghost, setGhost] = useState<{ dx: number; dy: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([])
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  const theme = THEMES[screen.theme]
  const st = useStore.getState

  const vb = viewBoxOf(view)
  /** Zoom factor: overlay geometry (handles, strokes) divides by this so it
   *  keeps a constant on-screen size. */
  const hk = effectiveK(view)

  /** Client -> world coordinates through the (possibly zoomed) viewBox. */
  const toWorld = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!
    const r = svg.getBoundingClientRect()
    return {
      x: vb.x + ((e.clientX - r.left) / r.width) * vb.w,
      y: vb.y + ((e.clientY - r.top) / r.height) * vb.h,
    }
  }

  // wheel zoom needs a NON-passive listener (the scrollable wrap would pan
  // the page otherwise); refs keep the handler stable across renders
  const wheelCtx = useRef({ mode, view, onViewChange })
  wheelCtx.current = { mode, view, onViewChange }
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const c = wheelCtx.current
      if (c.mode !== 'edit' || !c.onViewChange) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const b = viewBoxOf(c.view ?? null)
      const anchor = {
        x: b.x + ((e.clientX - r.left) / r.width) * b.w,
        y: b.y + ((e.clientY - r.top) / r.height) * b.h,
      }
      c.onViewChange(zoomAt(c.view ?? null, anchor, e.deltaY < 0 ? 1.15 : 1 / 1.15))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** Pipe drawing stays orthogonal: an oblique click gets an elbow
   *  (horizontal-first, like the importer) so the run stays right-angled while
   *  the clicked endpoint is honored exactly. Alt draws free angles. */
  const withElbow = (pts: { x: number; y: number }[], next: { x: number; y: number }, free: boolean) => {
    const last = pts[pts.length - 1]
    if (!last || free) return [...pts, next]
    if (Math.abs(next.x - last.x) > 6 && Math.abs(next.y - last.y) > 6) {
      return [...pts, { x: next.x, y: last.y }, next]
    }
    return [...pts, next]
  }

  const commitDraft = (points: { x: number; y: number }[]) => {
    if (points.length >= 2) st().addHmiPipe({ points })
    setDraft([])
    setHover(null)
    onToolDone()
  }

  const duplicateSel = () => {
    const picked = screen.widgets.filter((w) => selection.includes(w.id))
    if (picked.length === 0) return
    onSelect(st().addWidgets(duplicateWidgets(picked)))
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = toWorld(e)
    if (mode === 'edit' && armedPick) {
      // binding pick: consume the click entirely — a miss keeps the arm so the
      // user can try again (Esc or the panel button cancels)
      const target = screen.widgets.find((x) => x.id === armedPick.widgetId)
      if (!target) { onPicked?.(); return }
      if (armedPick.kind === 'tank') {
        const t = hitWidget(screen, pt)
        if (t && t.type === 'tank' && t.tag) {
          st().updateWidget(target.id, { props: { ...target.props, bindTank: t.tag } })
          onPicked?.()
        }
      } else {
        const p = hitPipe(screen, pt)
        if (p) {
          st().updateWidget(target.id, { props: { ...target.props, bindPipe: p.id } })
          onPicked?.()
        }
      }
      return
    }
    if (mode === 'run') {
      const w = hitWidget(screen, pt, { operate: true })
      if (!w) return
      const sig = typeof w.props?.signal === 'string' ? w.props.signal : ''
      if (w.type === 'nav') {
        const target = typeof w.props?.screen === 'string' ? w.props.screen : ''
        if (target) st().setActiveScreen(target)
        return
      }
      if (w.type === 'button') {
        if (sig) useSimStore.getState().writeTag(sig, '', Number(w.props?.writeValue ?? 1))
        return
      }
      if (w.type === 'switch') {
        const ref = parseSignalRef(sig)
        if (ref) {
          const cur = useSimStore.getState().tags[ref.tag]?.[ref.signal] ?? 0
          useSimStore.getState().writeTag(sig, '', cur >= 0.5 ? 0 : 1)
        }
        return
      }
      if (!w.tag) return
      if (onWidgetClick) onWidgetClick(w)
      return
    }
    // pan: middle button anywhere, or space-held drag (edit mode only)
    if (mode === 'edit' && (e.button === 1 || spaceDown)) {
      e.preventDefault()
      setDrag({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, orig: view })
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'pipe') {
      const next = withElbow(draft, { x: snap8(pt.x), y: snap8(pt.y) }, e.altKey)
      if (e.detail === 2) commitDraft(next)
      else setDraft(next)
      return
    }
    const target = e.target as Element
    const handle = (target.getAttribute?.('data-handle') ?? null) as Handle | null
    if (handle && selection.length === 1) {
      const w = screen.widgets.find((x) => x.id === selection[0])
      if (w) {
        setDrag({ kind: 'resize', handle, start: pt, orig: widgetRect(w), id: w.id })
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }
    const vertexAttr = target.getAttribute?.('data-vertex')
    const vertexPipe = target.getAttribute?.('data-vertex-pipe')
    if (vertexAttr !== null && vertexAttr !== undefined && vertexPipe) {
      setDrag({ kind: 'vertex', pipeId: vertexPipe, index: Number(vertexAttr) })
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const w = hitWidget(screen, pt)
    if (w) {
      if (e.shiftKey) {
        // shift-click toggles membership; removing never starts a drag
        if (selection.includes(w.id)) { onSelect(selection.filter((id) => id !== w.id)); return }
        onSelect([...selection, w.id])
        setDrag({ kind: 'move', start: pt, downId: w.id, wasSelected: false })
      } else {
        const wasSelected = selection.includes(w.id)
        if (!wasSelected) onSelect([w.id])
        setDrag({ kind: 'move', start: pt, downId: w.id, wasSelected })
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const p = hitPipe(screen, pt)
    if (p) {
      if (e.shiftKey) {
        onSelect(selection.includes(p.id) ? selection.filter((id) => id !== p.id) : [...selection, p.id])
      } else if (selection.includes(p.id)) {
        const seg = selection.length === 1 ? segmentAt(p, pt) : null
        if (seg?.axis) {
          // axis-aligned segments drag sideways (both bends move together)
          setDrag({ kind: 'segment', pipeId: p.id, index: seg.index, axis: seg.axis })
          e.currentTarget.setPointerCapture(e.pointerId)
          return
        }
        setDrag({ kind: 'move', start: pt, downId: p.id, wasSelected: true })
        e.currentTarget.setPointerCapture(e.pointerId)
      } else {
        onSelect([p.id])
      }
      return
    }
    // empty canvas: rubber-band select (shift keeps what's already selected)
    setDrag({ kind: 'marquee', start: pt, cur: pt, base: e.shiftKey ? selection : [] })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.kind === 'pan') {
      const svg = svgRef.current!
      const r = svg.getBoundingClientRect()
      const b = viewBoxOf(drag.orig)
      onViewChange?.(panBy(
        drag.orig,
        -((e.clientX - drag.startClient.x) / r.width) * b.w,
        -((e.clientY - drag.startClient.y) / r.height) * b.h,
      ))
      return
    }
    lastPt.current = toWorld(e)
    onCursor?.(lastPt.current)
    if (mode === 'edit' && tool === 'pipe') {
      const pt = lastPt.current
      setHover({ x: snap8(pt.x), y: snap8(pt.y) })
      return
    }
    if (!drag) return
    const pt = lastPt.current
    if (drag.kind === 'move') {
      setGhost({ dx: snap8(pt.x - drag.start.x), dy: snap8(pt.y - drag.start.y) })
    } else if (drag.kind === 'marquee') {
      setDrag({ ...drag, cur: pt })
    } else if (drag.kind === 'vertex') {
      setDrag({ ...drag, live: { x: snap8(pt.x), y: snap8(pt.y) } })
    } else if (drag.kind === 'segment') {
      setDrag({ ...drag, live: snap8(drag.axis === 'h' ? pt.y : pt.x) })
    } else {
      // live-preview only; the store commit happens once on pointerup so a
      // resize gesture is ONE undo step, not hundreds
      const live = resizeRect(drag.orig, drag.handle, snap8(pt.x - drag.start.x), snap8(pt.y - drag.start.y))
      setDrag({ ...drag, live })
    }
  }

  const onPointerUp = () => {
    if (drag?.kind === 'move') {
      if (ghost && (ghost.dx !== 0 || ghost.dy !== 0)) {
        st().moveWidgets(selection.filter((id) => screen.widgets.some((w) => w.id === id) || screen.pipes.some((p) => p.id === id)), ghost.dx, ghost.dy)
      } else if (drag.wasSelected && selection.length > 1) {
        // plain click (no movement) on part of a group: collapse to just it
        onSelect([drag.downId])
      }
    }
    if (drag?.kind === 'resize' && drag.live) {
      st().updateWidget(drag.id, drag.live)
    }
    if (drag?.kind === 'marquee') {
      const r = normRect(drag.start, drag.cur)
      if (r.w < 4 && r.h < 4) onSelect(drag.base)
      else onSelect([...new Set([...drag.base, ...marqueeHits(screen, r)])])
    }
    if (drag?.kind === 'vertex' && drag.live) {
      const p = screen.pipes.find((x) => x.id === drag.pipeId)
      const orig = p?.points[drag.index]
      if (p && orig && (orig.x !== drag.live.x || orig.y !== drag.live.y)) {
        st().updateHmiPipe(p.id, { points: p.points.map((q, i) => (i === drag.index ? drag.live! : q)) })
      }
    }
    if (drag?.kind === 'segment' && drag.live !== undefined) {
      const p = screen.pipes.find((x) => x.id === drag.pipeId)
      const orig = p?.points[drag.index]
      if (p && orig && drag.live !== (drag.axis === 'h' ? orig.y : orig.x)) {
        st().updateHmiPipe(p.id, { points: segmentPoints(p.points, drag.index, drag.axis, drag.live) })
      }
    }
    setDrag(null)
    setGhost(null)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (mode === 'run') return
    if (e.key === ' ' && !e.repeat) { e.preventDefault(); setSpaceDown(true); return }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); onViewChange?.(null); return }
    if (tool === 'pipe') {
      if (e.key === 'Enter') commitDraft(draft)
      if (e.key === 'Escape') { setDraft([]); setHover(null); onToolDone() }
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onSelect([...screen.widgets.map((w) => w.id), ...screen.pipes.map((p) => p.id)])
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      duplicateSel()
      return
    }
    if (e.key === 'Escape') { onSelect([]); return }
    if (selection.length === 0) return
    if (e.key === 'Delete' || e.key === 'Backspace') { st().deleteHmiIds(selection); onSelect([]) }
    const step = e.shiftKey ? 1 : 8
    if (e.key === 'ArrowLeft') st().moveWidgets(selection, -step, 0)
    if (e.key === 'ArrowRight') st().moveWidgets(selection, step, 0)
    if (e.key === 'ArrowUp') st().moveWidgets(selection, 0, -step)
    if (e.key === 'ArrowDown') st().moveWidgets(selection, 0, step)
  }

  /** Double-click edits pipe geometry on the sole selected pipe: near a
   *  vertex = remove the bend, on a run = insert one right there. Hit-tested
   *  by coordinates, not event target — the drag's pointer capture retargets
   *  the derived dblclick to the svg itself. */
  const onDblClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'edit' || tool !== 'select' || armedPick) return
    if (selection.length !== 1) return
    const p = screen.pipes.find((x) => x.id === selection[0])
    if (!p) return
    const pt = toWorld(e)
    const vi = p.points.findIndex((q) => Math.hypot(q.x - pt.x, q.y - pt.y) <= 8 / hk)
    if (vi >= 0) {
      if (p.points.length > 2) st().updateHmiPipe(p.id, { points: p.points.filter((_, i) => i !== vi) })
      return
    }
    const seg = segmentAt(p, pt)
    if (seg) {
      const points = [...p.points]
      points.splice(seg.index + 1, 0, { x: snap8(pt.x), y: snap8(pt.y) })
      st().updateHmiPipe(p.id, { points })
    }
  }

  const onDrop = (e: React.DragEvent<SVGSVGElement>) => {
    const raw = e.dataTransfer.getData(HMI_DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    const { type, props } = JSON.parse(raw) as { type: WidgetType; props?: HmiWidget['props'] }
    const pt = toWorld(e)
    const size = WIDGET_DEFAULT_SIZE[type]
    const id = st().addWidget({ type, x: snap8(pt.x - size.w / 2), y: snap8(pt.y - size.h / 2), ...size, ...(props ? { props } : {}) })
    onSelect([id])
  }

  const offset = (id: string) => (ghost && selection.includes(id) ? ghost : { dx: 0, dy: 0 })
  const marqueeRect = drag?.kind === 'marquee' ? normRect(drag.start, drag.cur) : null
  const selectedPipe =
    mode === 'edit' && tool === 'select' && selection.length === 1
      ? screen.pipes.find((p) => p.id === selection[0])
      : undefined

  return (
    <svg
      ref={svgRef}
      data-testid="hmi-canvas"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={{
        background: theme.bg, touchAction: 'none',
        cursor: drag?.kind === 'pan' ? 'grabbing'
          : mode === 'edit' && spaceDown ? 'grab'
          : mode === 'edit' && (tool === 'pipe' || armedPick) ? 'crosshair' : undefined,
      }}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDblClick}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => { if (e.key === ' ') setSpaceDown(false) }}
      onBlur={() => setSpaceDown(false)}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(HMI_DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="hmi-grid-dots" width={32} height={32} patternUnits="userSpaceOnUse">
          <circle cx={1.5} cy={1.5} r={1.2} fill={theme.grid} />
        </pattern>
      </defs>
      {mode === 'edit' && <rect width={HMI_WORLD.w} height={HMI_WORLD.h} fill="url(#hmi-grid-dots)" />}
      {screen.pipes.map((raw) => {
        const p = drag?.kind === 'vertex' && drag.pipeId === raw.id && drag.live
          ? { ...raw, points: raw.points.map((q, i) => (i === drag.index ? drag.live! : q)) }
          : drag?.kind === 'segment' && drag.pipeId === raw.id && drag.live !== undefined
            ? { ...raw, points: segmentPoints(raw.points, drag.index, drag.axis, drag.live) }
            : raw
        const o = offset(p.id)
        const pts = p.points.map((q) => `${q.x + o.dx},${q.y + o.dy}`).join(' ')
        const flow = flows?.[p.id] ?? 0
        const wpx = p.width ?? 4
        return (
          <g key={p.id}>
            <polyline points={pts} fill="none" stroke={p.color ?? theme.pipe} strokeWidth={wpx} strokeLinejoin="round" />
            {flow > 0 && (
              <polyline points={pts} fill="none" stroke={theme.pipeFlow} strokeWidth={wpx} strokeLinejoin="round"
                className="hmi-flow" strokeDasharray="10 14"
                style={{ animationDuration: `${Math.max(0.35, Math.min(3, 8 / flow))}s` }} />
            )}
            {mode === 'edit' && selection.includes(p.id) && (
              <polyline points={pts} fill="none" stroke="#2b6cb0" strokeWidth={wpx + 4} opacity={0.35} />
            )}
          </g>
        )
      })}
      {screen.widgets.map((raw) => {
        const w = drag?.kind === 'resize' && drag.id === raw.id && drag.live ? { ...raw, ...drag.live } : raw
        const o = offset(w.id)
        const values: Record<string, number> = sim ? { ...(sim[w.tag ?? ''] ?? {}) } : previewSim(w)
        const signal = typeof w.props?.signal === 'string' ? w.props.signal : ''
        const sigRef = sim ? parseSignalRef(signal) : null
        if (sim && sigRef) {
          values[signal] = sim[sigRef.tag]?.[sigRef.signal] ?? 0
        }
        if (w.type === 'nav' && navAlarms) {
          const target = typeof w.props?.screen === 'string' ? w.props.screen : ''
          const p = navAlarms[target]
          if (p) values.__navPrio = p === 'high' ? 3 : p === 'medium' ? 2 : 1
        }
        const recs = (alarms ?? []).filter((a) => a.tag === w.tag)
        const live = recs.filter((a) => !a.sup && a.phase !== 'pending')
        const alarm = live.some((a) => a.phase === 'active' || a.phase === 'cleared') ? 'unacked' as const : live.length > 0 ? 'acked' as const : 'none' as const
        const suppressed = recs.some((a) => a.sup)
        const needsHist = w.type === 'trend' || (w.type === 'display' && w.props?.spark === true)
        const hist = !needsHist ? undefined
          : sim && history && historyT ? { t: historyT, series: history }
          : previewHist(w)
        return (
          <WidgetG key={w.id} widget={w} theme={theme} values={values} hist={hist}
            alarm={alarm} suppressed={suppressed} flash={flashTag != null && w.tag === flashTag}
            selected={selection.includes(w.id)} editing={mode === 'edit'} ox={o.dx} oy={o.dy} />
        )
      })}
      {draft.length > 0 && (
        <g pointerEvents="none">
          <polyline
            points={(hover ? withElbow(draft, hover, false) : draft).map((q) => `${q.x},${q.y}`).join(' ')}
            fill="none" stroke={theme.pipeFlow} strokeDasharray="6 4" strokeWidth={3} />
          {draft.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill={theme.pipeFlow} />)}
        </g>
      )}
      {selectedPipe && (() => {
        const pts = drag?.kind === 'vertex' && drag.pipeId === selectedPipe.id && drag.live
          ? selectedPipe.points.map((q, i) => (i === drag.index ? drag.live! : q))
          : drag?.kind === 'segment' && drag.pipeId === selectedPipe.id && drag.live !== undefined
            ? segmentPoints(selectedPipe.points, drag.index, drag.axis, drag.live)
            : selectedPipe.points
        return (
          <g>
            {pts.slice(0, -1).map((q, i) => {
              const b = pts[i + 1]!
              const axis = q.y === b.y ? 'h' : q.x === b.x ? 'v' : null
              if (!axis || Math.hypot(b.x - q.x, b.y - q.y) <= 24) return null
              const m = { x: (q.x + b.x) / 2, y: (q.y + b.y) / 2 }
              // diamond = "this run drags sideways"; purely an affordance, the
              // whole segment is grabbable
              return <rect key={`s${i}`} x={m.x - 3 / hk} y={m.y - 3 / hk} width={6 / hk} height={6 / hk}
                fill="#fff" stroke="#2b6cb0" strokeWidth={1.5 / hk} pointerEvents="none"
                transform={`rotate(45 ${m.x} ${m.y})`} />
            })}
            {pts.map((q, i) => (
              <circle key={i} data-vertex={i} data-vertex-pipe={selectedPipe.id} cx={q.x} cy={q.y} r={5 / hk}
                fill="#fff" stroke="#2b6cb0" strokeWidth={2 / hk} style={{ cursor: 'move' }} />
            ))}
          </g>
        )
      })()}
      {marqueeRect && (marqueeRect.w >= 4 || marqueeRect.h >= 4) && (
        <rect x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.w} height={marqueeRect.h}
          fill="#2b6cb022" stroke="#2b6cb0" strokeDasharray="6 4" strokeWidth={1.5 / hk} pointerEvents="none" />
      )}
      {mode === 'edit' && tool === 'select' && selection.length === 1 && (() => {
        const found = screen.widgets.find((x) => x.id === selection[0])
        if (!found) return null
        const w = drag?.kind === 'resize' && drag.id === found.id && drag.live ? { ...found, ...drag.live } : found
        const o = offset(w.id)
        return HANDLES.map((h) => {
          const p = handlePoint({ x: w.x + o.dx, y: w.y + o.dy, w: w.w, h: w.h }, h)
          return <rect key={h} data-handle={h} x={p.x - 4 / hk} y={p.y - 4 / hk} width={8 / hk} height={8 / hk}
            fill="#2b6cb0" stroke="#fff" strokeWidth={1 / hk} style={{ cursor: `${h}-resize` }} />
        })
      })()}
    </svg>
  )
}
