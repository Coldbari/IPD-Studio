// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useRef, useState } from 'react'
import { ulid } from 'ulid'
import { sanitizeSvg, SvgImportError } from '../import/svgSymbol'
import type { CustomSymbolDef } from '../model/types'
import type { PortKind } from '../symbols/types'
import { useStore } from '../store/store'
import { useT } from '../i18n'

const snap4 = (v: number) => Math.round(v / 4) * 4

export default function SymbolImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const addCustomSymbol = useStore((s) => s.addCustomSymbol)
  const [svg, setSvg] = useState<string | null>(null)
  const [gridSize, setGridSize] = useState({ w: 4, h: 4 })
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [tagRule, setTagRule] = useState<CustomSymbolDef['tagRule']>('equipment')
  const [portKind, setPortKind] = useState<PortKind>('process')
  const [ports, setPorts] = useState<CustomSymbolDef['ports']>([])
  const svgHostRef = useRef<SVGSVGElement>(null)

  const ingest = (raw: string) => {
    try {
      const result = sanitizeSvg(raw)
      setSvg(result.svg)
      setGridSize(result.gridSize)
      setWarnings(result.warnings)
      setPorts([])
      setError('')
    } catch (err) {
      setError(err instanceof SvgImportError ? err.message : t('Could not read that SVG'))
    }
  }

  const onFile = async (file: File | undefined) => {
    if (file) ingest(await file.text())
  }

  const onPreviewClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const host = svgHostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * gridSize.w * 8
    const py = ((e.clientY - rect.top) / rect.height) * gridSize.h * 8
    setPorts((prev) => [...prev, { id: `p${prev.length + 1}`, x: snap4(px), y: snap4(py), kind: portKind }])
  }

  const save = () => {
    if (!svg || !name.trim()) return
    addCustomSymbol({
      id: `custom.${ulid().toLowerCase()}`,
      name: name.trim(),
      svg,
      gridSize,
      ports,
      tagRule,
      keywords: ['custom', ...name.trim().toLowerCase().split(/\s+/)],
    })
    onClose()
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="datasheet-box" onClick={(e) => e.stopPropagation()}>
        <div className="datasheet-head">
          <b>{t('Import custom symbol')}</b>
          <button onClick={onClose}>{t('Close')}</button>
        </div>
        <div className="datasheet-body">
          <p className="import-note">
            {t('Import only artwork you created or may redistribute. Do not trace standards documents or vendor symbol libraries.')}
          </p>
          {!svg && (
            <>
              <input type="file" accept=".svg,image/svg+xml" onChange={(e) => void onFile(e.target.files?.[0])} />
              <textarea
                className="import-paste"
                placeholder={t('…or paste SVG markup here')}
                onBlur={(e) => e.target.value.trim() && ingest(e.target.value)}
              />
            </>
          )}
          {error && <div className="tag-error">{error}</div>}
          {svg && (
            <>
              {warnings.map((w) => <div key={w} className="import-warn">⚠ {w}</div>)}
              <div className="prop-title">{t('Click the preview to place ports')}</div>
              <div className="prop-row">
                <label className="tb-line">{t('Port type')}:
                  <select value={portKind} onChange={(e) => setPortKind(e.target.value as PortKind)}>
                    <option value="process">{t('process')}</option>
                    <option value="signal">{t('signal')}</option>
                    <option value="both">{t('both')}</option>
                  </select>
                </label>
                <button onClick={() => setPorts([])}>{t('Clear ports')} ({ports.length})</button>
              </div>
              <svg
                ref={svgHostRef}
                className="import-preview"
                viewBox={`-2 -2 ${gridSize.w * 8 + 4} ${gridSize.h * 8 + 4}`}
                onClick={onPreviewClick}
              >
                <g dangerouslySetInnerHTML={{ __html: svg }} color="#111" />
                {ports.map((p) => (
                  <circle key={p.id} cx={p.x} cy={p.y} r="3.5" fill={p.kind === 'process' ? '#2b6cb0' : '#b7791f'} />
                ))}
              </svg>
              <label className="prop-field">{t('Name')}
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('My Special Filter')} />
              </label>
              <label className="prop-field">{t('Tag rule')}
                <select value={tagRule} onChange={(e) => setTagRule(e.target.value as CustomSymbolDef['tagRule'])}>
                  <option value="equipment">{t('equipment')}</option>
                  <option value="isa-instrument">{t('isa-instrument')}</option>
                  <option value="valve">{t('valve')}</option>
                  <option value="none">{t('none')}</option>
                </select>
              </label>
              <button className="import-save" disabled={!name.trim()} onClick={save}>
                {t('Add to palette')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
