// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * WHAT A PROJECT FILE HAS TO CARRY — and what it must never carry.
 *
 * `file.test.ts` round-trips the drawing. This is the HMI half of the same
 * promise, added by the Step J audit after it found that nothing pinned it:
 * the operator screens, the bindings they hold, the engineering values those
 * bindings resolve to, and the reconciliation baseline are all DOCUMENT state
 * and must survive a save and a load exactly.
 *
 * The last test is the other half, and the more important one. The simulation
 * clock, the tag values, the alarm list, the journal, the history and the
 * operator's shelving are RUNTIME state. They live in `hmi/simStore.ts`,
 * outside the document, precisely so a project file can never come back
 * carrying a plant that was running when someone saved it. Asserting the
 * absence is what keeps that true.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/symbols/lib/index'
import { loadDoc } from '../../src/model/migrate'
import { serializeDoc } from '../../src/persist/file'
import { importSheet } from '../../src/hmi/importFromPid'
import { buildSimModel, initTags } from '../../src/hmi/sim/engine'
import { tagDefMap } from '../../src/hmi/sim/tags'
import { reconcileScreen } from '../../src/model/reconcile'
import type { ProjectDoc } from '../../src/model/types'

const SAMPLES = ['sample-plant.pnid.json', 'sample-refinery-unit.pnid.json', 'template-hmi-demo.pnid.json']

/** A sample, with HMI screens — imported when the file ships without any. */
function withScreens(file: string): ProjectDoc {
  const doc = loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples', file), 'utf8')))
  return doc.hmiScreens.length > 0 ? doc : { ...doc, hmiScreens: doc.sheets.map((sh) => importSheet(doc, sh.id)) }
}

const reload = (d: ProjectDoc): ProjectDoc => loadDoc(JSON.parse(serializeDoc(d)))

describe('HMI screens survive a save and a load', () => {
  for (const file of SAMPLES) {
    it(`${file}: every screen, widget, pipe and binding is identical`, () => {
      const before = withScreens(file)
      expect(reload(before).hmiScreens).toEqual(before.hmiScreens)
    })

    it(`${file}: the compiled engineering model is identical`, () => {
      const before = withScreens(file)
      const after = reload(before)
      const defs = (d: ProjectDoc) => tagDefMap(buildSimModel(d.hmiScreens, d.registry).defs)
      // Ranges, units, limits, priorities, capacities and duties — everything
      // the runtime resolves — must come back the same, or a saved project
      // would simulate differently from the one that was saved.
      expect(defs(after)).toEqual(defs(before))
      // and the calm-start state it seeds from
      expect(initTags(buildSimModel(after.hmiScreens, after.registry)))
        .toEqual(initTags(buildSimModel(before.hmiScreens, before.registry)))
    })

    it(`${file}: the reconciliation baseline survives, and reports no change`, () => {
      const before = withScreens(file)
      const after = reload(before)
      for (const screen of after.hmiScreens) {
        expect(screen.baseline).toEqual(before.hmiScreens.find((s) => s.id === screen.id)?.baseline)
        expect(reconcileScreen(after, screen.id)?.counts)
          .toEqual(reconcileScreen(before, screen.id)?.counts)
      }
    })
  }
})

describe('runtime state never reaches a project file', () => {
  it('none of the simulation vocabulary is serialised', () => {
    const text = serializeDoc(withScreens('template-hmi-demo.pnid.json'))
    const parsed = JSON.parse(text) as Record<string, unknown>
    for (const key of [
      'tags', 'alarms', 'journal', 'history', 'historyVersion', 'quality',
      'pipeFlows', 'pipePressures', 'branchFlows', 'equipFlows',
      'shelved', 'oos', 'plugged', 't', 'mode', 'playing', 'speed',
    ]) {
      expect(Object.keys(parsed), key).not.toContain(key)
    }
    // the scenario/override signals an operator can set, by name
    for (const sig of ['"FROZEN"', '"FORCED"', '"BAD"', '"FAULT"', '"RAMP"']) {
      expect(text, sig).not.toContain(sig)
    }
  })
})
