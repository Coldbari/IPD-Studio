// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { History } from '../../src/hmi/sim/history'
import type { Quality } from '../../src/hmi/sim/quality'
import { qualityCode } from '../../src/hmi/sim/history'

/**
 * Build a real History from `{ ref: [values] }`, one sample per second.
 *
 * Deliberately the REAL recording path rather than a hand-built stand-in: a
 * fixture that faked the storage would stop testing the thing that decides
 * which samples a widget actually sees.
 */
export function historyOf(series: Record<string, number[]>, opts: { period?: number; quality?: Quality } = {}): History {
  const period = opts.period ?? 1
  const q = qualityCode(opts.quality)
  const n = Math.max(0, ...Object.values(series).map((v) => v.length))
  const h = new History()
  for (let i = 0; i < n; i++) {
    h.record(i * period, (put) => {
      for (const [ref, values] of Object.entries(series)) {
        const v = values[i]
        if (v !== undefined) put(ref, v, q)
      }
    })
  }
  return h
}
