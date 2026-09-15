// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-5 — the Project workspace on screen.
 *
 * Three things that matter more than the layout:
 *
 *  1. `—` reaches the screen where there is nothing to measure, and `0%` does
 *     not. The whole value of the number is that it can be believed.
 *  2. There is NO deliverables tile. Nothing tracks issued deliverables, so any
 *     figure there would be invented.
 *  3. Every tile opens the workspace that owns its numbers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaLive } from '../../src/validate/live'
import { WORKSPACES, currentWorkspace, navigateWorkspace } from '../../src/routes'
import { qaFor } from '../../src/validate/engine'
import ProjectWorkspace from '../../src/workspaces/ProjectWorkspace'
import type { PlantNode, ProjectDoc } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)
const text = (host: HTMLElement, id: string) => q(host, id)?.textContent ?? ''

async function mount(): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<ProjectWorkspace />))
  return host
}
const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}

const vessel = (id: string, loop: string): PlantNode =>
  ({ id, symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0, tag: { letters: 'TK', loop } })

/** A project with two vessels; the first has its one required field filled. */
function seed(started = true): ProjectDoc {
  const doc = createEmptyDoc('Feed water unit')
  doc.sheets[0]!.nodes = [vessel('a', '101'), vessel('b', '102')]
  doc.registry = started
    ? { 'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'general.service': 'Feed' } } }
    : {}
  st().loadIntoStore(doc)
  return doc
}

beforeEach(() => {
  resetQaLive()
  st().loadIntoStore(createEmptyDoc('Project health'))
  navigateWorkspace('draw')
})

describe('the Project workspace renders', () => {
  it('shows the project name and the counts of what is drawn', async () => {
    seed()
    const host = await mount()
    expect(text(host, 'ph-name')).toBe('Feed water unit')
    expect(text(host, 'ph-count-equipment')).toBe('2')
    expect(text(host, 'ph-count-lines')).toBe('0')
  })

  it('shows critical, warning and information counts', async () => {
    seed()
    const host = await mount()
    for (const id of ['ph-qa-critical', 'ph-qa-warning', 'ph-qa-info']) {
      expect(text(host, id)).toMatch(/^\d+$/)
    }
  })

  it('agrees with the QA engine about the critical count', async () => {
    seed()
    const host = await mount()
    expect(text(host, 'ph-qa-critical')).toBe(String(qaFor(st().doc).counts.critical))
  })

  it('says how many checks ran, so clean can be told from nobody looked', async () => {
    seed()
    const host = await mount()
    expect(text(host, 'ph-qa-note')).toMatch(/checks? ran/)
  })

  it('renders without duplicate React keys', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const doc = seed()
    doc.sheets.push({ ...doc.sheets[0]!, id: 's2', nodes: [], edges: [] })
    st().loadIntoStore(doc)
    await mount()
    expect(warn.mock.calls.flat().join(' ')).not.toContain('same key')
    warn.mockRestore()
  })
})

describe('an absent denominator prints —, never 0%', () => {
  it('shows — for every kind when no record has been started', async () => {
    seed(false)
    const host = await mount()
    expect(text(host, 'ph-overall')).toBe('—')
    for (const kind of ['equipment', 'line', 'instrument', 'valve']) {
      expect(text(host, `ph-complete-${kind}`)).toBe('—')
    }
    expect(text(host, 'ph-completeness-note')).toContain('not the same as 0%')
  })

  it('shows a real percentage once a record is started', async () => {
    seed()
    const host = await mount()
    expect(text(host, 'ph-complete-equipment')).toBe('100%')
    expect(text(host, 'ph-overall')).toBe('100%')
  })

  it('never prints NaN or Infinity anywhere on the screen', async () => {
    seed(false)
    const host = await mount()
    expect(host.textContent).not.toContain('NaN')
    expect(host.textContent).not.toContain('Infinity')
  })

  it('offers to set a budget rather than claiming 0% of one is used', async () => {
    seed()
    const host = await mount()
    expect(q(host, 'ph-budget-fraction')).toBeNull()
    expect(text(host, 'ph-budget-note')).toContain('No budget target set')
  })

  it('shows the fraction once a target exists', async () => {
    const doc = seed()
    st().loadIntoStore({ ...doc, budget: { currency: 'USD', total: 1_000_000 } })
    const host = await mount()
    expect(text(host, 'ph-budget-fraction')).toMatch(/^\d+%$/)
  })
})

describe('there is no fabricated deliverables metric', () => {
  // P3-6 added a deliverable STALENESS section, which compares regenerated
  // reports. The claim this protects is unchanged: nothing on this screen
  // counts deliverables the product cannot see.
  it('shows no deliverable count, and claims nothing before it has compared', async () => {
    seed()
    const host = await mount()
    // The plan's old mock read "Datasheets 342 / 386". Nothing tracks that.
    expect(host.textContent).not.toMatch(/\d+\s*\/\s*\d+/)
    // Not computed until asked — the button is what starts it.
    expect(q(host, 'ph-deliverables-run')).not.toBeNull()
    expect(q(host, 'ph-deliverables-jump')).toBeNull()
  })

  it('never uses a word for a state it cannot observe', async () => {
    seed()
    const host = await mount()
    for (const word of [/generated/i, /downloaded/i, /approved/i]) {
      expect(host.textContent).not.toMatch(word)
    }
  })
})

describe('every tile opens the workspace that owns its numbers', () => {
  it('counts and completeness go to Data', async () => {
    seed()
    const host = await mount()
    await click(q(host, 'ph-counts-jump'))
    expect(currentWorkspace()).toBe('data')

    navigateWorkspace('draw')
    await click(q(host, 'ph-completeness-jump'))
    expect(currentWorkspace()).toBe('data')
  })

  it('quality goes to Checks', async () => {
    seed()
    const host = await mount()
    await click(q(host, 'ph-qa-jump'))
    expect(currentWorkspace()).toBe('checks')
  })

  it('the estimate and the revision table go to the drawing, where both live', async () => {
    seed()
    const host = await mount()
    await click(q(host, 'ph-budget-jump'))
    expect(currentWorkspace()).toBe('draw')

    navigateWorkspace('data')
    await click(q(host, 'ph-revisions-jump'))
    expect(currentWorkspace()).toBe('draw')
  })
})

describe('the existing workspaces are untouched', () => {
  it('keeps every workspace that was there, in the order it was there', () => {
    // `project` is APPENDED, so Ctrl+1…Ctrl+5 still open what they always did.
    expect([...WORKSPACES]).toEqual(['draw', 'data', 'checks', 'standards', 'hmi', 'project'])
  })

  it('routes /app/project to the new workspace and leaves the rest alone', () => {
    for (const w of WORKSPACES) {
      navigateWorkspace(w)
      expect(currentWorkspace()).toBe(w)
    }
  })
})
