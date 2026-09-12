// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import Modal from './Modal'
import { useStore } from '../store/store'
import { DEFAULT_PRICES, projectCost } from '../model/costs'
import {
  CURRENCIES, FX_DATE, bestScale, currencyOf, money, moneyShort,
  scaleUnits, toDisplay, toUsd, trimNum,
} from '../model/currency'
import { csvCell, download } from '../export/csv'

const FACTORS: [number, string][] = [
  [1, '1× — hardware only'],
  [1.5, '1.5× — hardware + freight & spares'],
  [3, '3× — typical installed cost (piping, wiring, labor)'],
  [5, '5× — full plant, Lang factor (engineering + construction)'],
]

/**
 * The toolbar's budget entry point: shows the live estimate as you draw and
 * opens the breakdown. Lives in the top bar next to Fluids — the running cost
 * is something you steer by while drawing, not a status readout.
 */
export function BudgetChip() {
  const doc = useStore((s) => s.doc)
  const [open, setOpen] = useState(false)
  const { total } = projectCost(doc)
  const cur = currencyOf(doc.budget?.currency)
  const target = doc.budget?.total
  const over = target !== undefined && total > target
  const empty = total === 0 && target === undefined
  return (
    <>
      <button
        className={`budget-chip${over ? ' budget-over' : ''}`}
        data-testid="budget-chip"
        onClick={() => setOpen(true)}
        title={
          empty ? 'Set a project budget and see the live cost estimate as you draw'
            : over ? 'Over budget — click for the breakdown'
              : 'Estimated project cost — click for the breakdown'
        }
      >
        {empty
          ? '💰 Budget…'
          : `💰 ${moneyShort(total, cur)}${target !== undefined ? ` / ${moneyShort(target, cur)}` : ''}`}
      </button>
      {open && <BudgetDialog onClose={() => setOpen(false)} />}
    </>
  )
}

/** Project budget & cost estimate: set the target, tune unit prices, see the
 *  live breakdown. Prices are budgetary USD defaults — override for your market. */
export default function BudgetDialog({ onClose }: { onClose(): void }) {
  const doc = useStore((s) => s.doc)
  const setBudget = useStore((s) => s.setBudget)
  const setPriceOverride = useStore((s) => s.setPriceOverride)
  const budget = doc.budget
  const cur = currencyOf(budget?.currency)
  const report = projectCost(doc)
  const target = budget?.total
  const remaining = target !== undefined ? target - report.total : undefined
  const factor = budget?.installFactor ?? 1
  const pct = target !== undefined && target > 0 ? Math.min(report.total / target, 1.35) : undefined

  // Budget entry scale, so nobody types 70500000: pick "Cr" and type 7.05.
  // Auto-picked from the stored value, then left alone once chosen; re-picked
  // when the currency changes because lakh/crore only apply to rupees.
  const units = scaleUnits(cur)
  const shownTarget = target === undefined ? 0 : toDisplay(target, cur)
  const [unitLabel, setUnitLabel] = useState(() => bestScale(shownTarget, units).label)
  useEffect(() => {
    setUnitLabel(bestScale(target === undefined ? 0 : toDisplay(target, cur), units).label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.code])
  const unit = units.find((u) => u.label === unitLabel) ?? units[0]!

  const exportCsv = () => {
    // The product's one CSV escaper — quoting AND formula neutralisation.
    // A cost estimate carries user-named custom symbols like every other export.
    const esc = csvCell
    const rows = [
      ['Item', 'Qty', `Unit (${cur.code})`, `Subtotal (${cur.code})`, 'Unit (USD)', 'Basis', 'Evidence'],
      ...report.lines.map((l) => {
        const e = DEFAULT_PRICES[l.key]
        return [
          l.label, String(l.count),
          String(Math.round(toDisplay(l.unit, cur))),
          String(Math.round(toDisplay(l.subtotal, cur))),
          String(l.unit), e?.basis ?? '', e?.ev ?? '',
        ]
      }),
      [],
      ['Hardware subtotal', '', '', String(Math.round(toDisplay(report.hardware, cur)))],
      ['Install factor', '', '', String(factor)],
      ['Estimated total', '', '', String(Math.round(toDisplay(report.total, cur)))],
      ...(target !== undefined ? [['Budget', '', '', String(Math.round(toDisplay(target, cur)))]] : []),
      [],
      [`Currency ${cur.code} at ${cur.rate} per USD, indicative rate of ${FX_DATE}`],
    ]
    download(
      `${doc.meta.name || 'diagram'}-cost-estimate.csv`,
      rows.map((r) => r.map(esc).join(',')).join('\n'),
      'text/csv',
    )
  }

  return (
    <Modal title="Budget & cost estimate" onClose={onClose} width={720}>
      <div className="bd">
        {/* ---- summary: the number you came for, first ---- */}
        <div className="bd-summary">
          <div className="bd-figure">
            <span className="bd-k">Estimated total</span>
            <strong className="bd-total" data-testid="budget-est">{money(report.total, cur)}</strong>
            <span className="bd-sub">
              {money(report.hardware, cur)} hardware{factor !== 1 ? ` × ${factor} installed` : ''}
            </span>
          </div>
          {remaining !== undefined && (
            <div className="bd-figure">
              <span className="bd-k">{remaining < 0 ? 'Over budget' : 'Remaining'}</span>
              <strong className={`bd-total ${remaining < 0 ? 'bd-bad' : 'bd-good'}`}>
                {money(Math.abs(remaining), cur)}
              </strong>
              <span className="bd-sub">of {money(target!, cur)} budget</span>
            </div>
          )}
        </div>

        {pct !== undefined && (
          <div className="bd-bar" role="img"
            aria-label={`${Math.round((report.total / target!) * 100)}% of budget used`}>
            <div className={`bd-bar-fill${remaining! < 0 ? ' bd-bar-over' : ''}`}
              style={{ width: `${Math.min(pct, 1) * 100}%` }} />
          </div>
        )}

        {/* ---- controls ---- */}
        <div className="bd-controls">
          <label>
            <span className="bd-k">Budget target</span>
            <span className="bd-target">
              <input
                data-testid="budget-total" type="number" min={0} step="any" placeholder="not set"
                value={target === undefined ? '' : trimNum(shownTarget / unit.mult)}
                onChange={(e) => setBudget({
                  total: e.target.value === '' ? undefined : toUsd(Number(e.target.value) * unit.mult, cur),
                })}
              />
              <select
                data-testid="budget-scale" value={unit.label}
                onChange={(e) => setUnitLabel(e.target.value)}
                title={`Scale — type 7.05 and pick ${units[units.length - 1]!.label} instead of counting zeros`}
              >
                {units.map((u) => <option key={u.label} value={u.label} title={u.title}>{u.label}</option>)}
              </select>
            </span>
            {target !== undefined && unit.mult > 1 && (
              <span className="bd-hint">= {money(target, cur)}</span>
            )}
          </label>
          <label>
            <span className="bd-k">Currency</span>
            <select
              data-testid="budget-currency"
              value={cur.code}
              onChange={(e) => setBudget({ currency: e.target.value })}
              title={`Indicative rates of ${FX_DATE}. Prices are stored in USD and converted for display.`}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </label>
          <label className="bd-grow">
            <span className="bd-k">Estimate covers</span>
            <select data-testid="budget-factor" value={factor}
              onChange={(e) => setBudget({ installFactor: Number(e.target.value) })}>
              {FACTORS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
        </div>

        {/* ---- breakdown ---- */}
        <div className="bd-table-wrap">
          <table className="bd-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="r">Qty</th>
                <th className="r">Unit price</th>
                <th className="r">Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => {
                const overridden = budget?.overrides?.[l.key] !== undefined
                const entry = DEFAULT_PRICES[l.key]
                const range = entry?.low !== undefined && entry.high !== undefined
                  ? `Typical range ${money(entry.low, cur)} – ${money(entry.high, cur)}`
                  : ''
                const tip = [entry?.basis, range,
                  entry?.ev === 'est' ? 'No published price found — correlation or build-up estimate.' : '']
                  .filter(Boolean).join('\n\n')
                return (
                  <tr key={l.key}>
                    <td>
                      <span className="bd-item" title={tip || undefined}>{l.label}</span>
                      {entry?.ev === 'est' && (
                        <span className="bd-est" title="No published price found — this default is a cost-correlation or build-up estimate.">est</span>
                      )}
                      {entry?.basis && <span className="bd-basis">{entry.basis}</span>}
                    </td>
                    <td className="r bd-num">{l.count}</td>
                    <td className="r">
                      <input
                        className={`bd-unit${overridden ? ' bd-overridden' : ''}`}
                        type="number" min={0}
                        value={Math.round(toDisplay(l.unit, cur))}
                        title={overridden ? 'Overridden for this project — ↺ resets it' : 'Budgetary default — edit for your market'}
                        onChange={(e) => setPriceOverride(
                          l.key,
                          e.target.value === '' ? undefined : toUsd(Number(e.target.value), cur),
                        )}
                      />
                    </td>
                    <td className="r bd-num">{money(l.subtotal, cur)}</td>
                    <td>
                      {overridden && (
                        <button className="bd-reset" title="Reset to the default price"
                          onClick={() => setPriceOverride(l.key, undefined)}>↺</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {report.lines.length === 0 && (
                <tr><td colSpan={5} className="bd-empty">
                  Place components on the drawing and they appear here with prices.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {report.unpriced > 0 && (
          <p className="bd-warn">
            ⚠ {report.unpriced} component{report.unpriced > 1 ? 's have' : ' has'} no price — set one
            in the table above or on the component itself.
          </p>
        )}

        {/* ---- footer ---- */}
        <div className="bd-foot">
          <p className="bd-fine">
            Budgetary hardware prices in USD, researched Aug 2026 — FOB, excluding installation,
            freight and tax. Real quotes vary several-fold with size, material and rating; hover an
            item for the size the price assumes. Bold = overridden. For an exact price on one
            component, select it and use its Cost field.
            {cur.code !== 'USD' && ` Shown in ${cur.code} at ${cur.rate} per USD (indicative, ${FX_DATE}).`}
          </p>
          <button className="bd-csv" onClick={exportCsv}>Cost estimate CSV</button>
        </div>
      </div>
    </Modal>
  )
}
