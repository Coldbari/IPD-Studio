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
import { download } from '../export/csv'
import { useT } from '../i18n'

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
  const t = useT()
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
          empty ? t('Set a project budget and see the live cost estimate as you draw')
            : over ? t('Over budget — click for the breakdown')
              : t('Estimated project cost — click for the breakdown')
        }
      >
        {empty
          ? `💰 ${t('Budget…')}`
          : `💰 ${moneyShort(total, cur)}${target !== undefined ? ` / ${moneyShort(target, cur)}` : ''}`}
      </button>
      {open && <BudgetDialog onClose={() => setOpen(false)} />}
    </>
  )
}

/** Project budget & cost estimate: set the target, tune unit prices, see the
 *  live breakdown. Prices are budgetary USD defaults — override for your market. */
export default function BudgetDialog({ onClose }: { onClose(): void }) {
  const t = useT()
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
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)
    const rows = [
      [t('Item'), t('Qty'), t('Unit') + ' (' + cur.code + ')', t('Subtotal') + ' (' + cur.code + ')', t('Unit') + ' (USD)', t('Basis'), t('Evidence')],
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
      [t('Hardware subtotal'), '', '', String(Math.round(toDisplay(report.hardware, cur)))],
      [t('Install factor'), '', '', String(factor)],
      [t('Estimated total'), '', '', String(Math.round(toDisplay(report.total, cur)))],
      ...(target !== undefined ? [[t('Budget'), '', '', String(Math.round(toDisplay(target, cur)))]] : []),
      [],
      [t('Currency') + ' ' + cur.code + ' ' + t('at') + ' ' + cur.rate + ' ' + t('per USD') + ', ' + t('indicative rate of') + ' ' + FX_DATE],
    ]
    download(
      `${doc.meta.name || 'diagram'}-cost-estimate.csv`,
      rows.map((r) => r.map(esc).join(',')).join('\n'),
      'text/csv',
    )
  }

  return (
    <Modal title={t('Budget & cost estimate')} onClose={onClose} width={720}>
      <div className="bd">
        {/* ---- summary: the number you came for, first ---- */}
        <div className="bd-summary">
          <div className="bd-figure">
            <span className="bd-k">{t('Estimated total')}</span>
            <strong className="bd-total" data-testid="budget-est">{money(report.total, cur)}</strong>
            <span className="bd-sub">
              {money(report.hardware, cur)} {t('hardware only')}{factor !== 1 ? ' × ' + factor + ' ' + t('installed') : ''}
            </span>
          </div>
          {remaining !== undefined && (
            <div className="bd-figure">
              <span className="bd-k">{remaining < 0 ? t('Over budget') : t('Remaining')}</span>
              <strong className={`bd-total ${remaining < 0 ? 'bd-bad' : 'bd-good'}`}>
                {money(Math.abs(remaining), cur)}
              </strong>
              <span className="bd-sub">{t('of')} {money(target!, cur)} {t('Budget')}</span>
            </div>
          )}
        </div>

        {pct !== undefined && (
          <div className="bd-bar" role="img"
            aria-label={`${Math.round((report.total / target!) * 100)}% ${t('of budget used')}`}>
            <div className={`bd-bar-fill${remaining! < 0 ? ' bd-bar-over' : ''}`}
              style={{ width: `${Math.min(pct, 1) * 100}%` }} />
          </div>
        )}

        {/* ---- controls ---- */}
        <div className="bd-controls">
          <label>
            <span className="bd-k">{t('Budget target')}</span>
            <span className="bd-target">
              <input
                data-testid="budget-total" type="number" min={0} step="any" placeholder={t('not set')}
                value={target === undefined ? '' : trimNum(shownTarget / unit.mult)}
                onChange={(e) => setBudget({
                  total: e.target.value === '' ? undefined : toUsd(Number(e.target.value) * unit.mult, cur),
                })}
              />
              <select
                data-testid="budget-scale" value={unit.label}
                onChange={(e) => setUnitLabel(e.target.value)}
                title={`${t('Scale — type 7.05 and pick a unit instead of counting zeros')} (${units[units.length - 1]!.label})`}
              >
                {units.map((u) => <option key={u.label} value={u.label} title={u.title}>{u.label}</option>)}
              </select>
              {target !== undefined && unit.mult > 1 && (
                <span className="bd-hint">= {money(target, cur)}</span>
              )}
            </span>
          </label>
          <label>
            <span className="bd-k">{t('Currency')}</span>
            <select
              data-testid="budget-currency"
              value={cur.code}
              onChange={(e) => setBudget({ currency: e.target.value })}
              title={`${t('Indicative rates. Prices are stored in USD and converted for display.')} (${FX_DATE})`}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {t(c.name)}</option>
              ))}
            </select>
          </label>
          <label className="bd-grow">
            <span className="bd-k">{t('Estimate covers')}</span>
            <select data-testid="budget-factor" value={factor}
              onChange={(e) => setBudget({ installFactor: Number(e.target.value) })}>
              {FACTORS.map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}
            </select>
          </label>
        </div>

        {/* ---- breakdown ---- */}
        <div className="bd-table-wrap">
          <table className="bd-table">
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th className="r">{t('Qty')}</th>
                <th className="r">{t('Unit price')}</th>
                <th className="r">{t('Subtotal')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => {
                const overridden = budget?.overrides?.[l.key] !== undefined
                const entry = DEFAULT_PRICES[l.key]
                const range = entry?.low !== undefined && entry.high !== undefined
                  ? t('Typical range') + ' ' + money(entry.low, cur) + ' – ' + money(entry.high, cur)
                  : ''
                const tip = [entry?.basis ? t(entry.basis) : undefined, range,
                  entry?.ev === 'est' ? t('No published price found — correlation or build-up estimate.') : '']
                  .filter(Boolean).join('\n\n')
                return (
                  <tr key={l.key}>
                    <td>
                      <span className="bd-item" title={tip || undefined}>{t(l.label)}</span>
                      {entry?.ev === 'est' && (
                        <span className="bd-est" title={t('No published price found — this default is a cost-correlation or build-up estimate.')}>est</span>
                      )}
                      {entry?.basis && <span className="bd-basis">{t(entry.basis)}</span>}
                    </td>
                    <td className="r bd-num">{l.count}</td>
                    <td className="r">
                      <input
                        className={`bd-unit${overridden ? ' bd-overridden' : ''}`}
                        type="number" min={0}
                        value={Math.round(toDisplay(l.unit, cur))}
                        title={overridden ? t('Overridden for this project — ↺ resets it') : t('Budgetary default — edit for your market')}
                        onChange={(e) => setPriceOverride(
                          l.key,
                          e.target.value === '' ? undefined : toUsd(Number(e.target.value), cur),
                        )}
                      />
                    </td>
                    <td className="r bd-num">{money(l.subtotal, cur)}</td>
                    <td>
                      {overridden && (
                        <button className="bd-reset" title={t('Reset to the default price')}
                          onClick={() => setPriceOverride(l.key, undefined)}>↺</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {report.lines.length === 0 && (
                <tr><td colSpan={5} className="bd-empty">
                  {t('Place components on the drawing and they appear here with prices.')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {report.unpriced > 0 && (
          <p className="bd-warn">
            ⚠ {report.unpriced} {t(report.unpriced > 1
              ? 'components have no price — set one in the table above or on the component itself.'
              : 'component has no price — set one in the table above or on the component itself.')}
          </p>
        )}

        {/* ---- footer ---- */}
        <div className="bd-foot">
          <p className="bd-fine">
            {t('Budgetary hardware prices in USD, researched Aug 2026 — FOB, excluding installation, freight and tax. Real quotes vary several-fold with size, material and rating; hover an item for the size the price assumes. Bold = overridden. For an exact price on one component, select it and use its Cost field.')}
            {cur.code !== 'USD' && ` ${t('Shown in')} ${cur.code} ${t('at')} ${cur.rate} ${t('per USD')} (${FX_DATE}).`}
          </p>
          <button className="bd-csv" onClick={exportCsv}>{t('Cost estimate CSV')}</button>
        </div>
      </div>
    </Modal>
  )
}
