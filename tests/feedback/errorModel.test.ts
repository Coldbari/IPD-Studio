// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearStatus, confirmAction, confirmSnapshot, dismissNotice, noticeSnapshot,
  notify, resetNotices, showStatus, statusSnapshot, subscribeNotices,
} from '../../src/feedback/notices'
import { explainConnection } from '../../src/canvas/connectionRules'
import { classifyOpenError, openFailureNotice, underlayEmptyNotice, underlayFailureNotice } from '../../src/persist/openErrors'
import { DocError } from '../../src/model/migrate'
import { DexpiImportError } from '../../src/import/dexpi'
import { cloudErrorMessage } from '../../src/cloud/autosave'

afterEach(() => resetNotices())

describe('why a connection was refused', () => {
  it('allows every pairing the rule allows', () => {
    expect(explainConnection('process', 'process', false)).toBeNull()
    expect(explainConnection('signal', 'signal', false)).toBeNull()
    expect(explainConnection('both', 'process', false)).toBeNull()
    expect(explainConnection('both', 'signal', false)).toBeNull()
    expect(explainConnection('both', 'both', false)).toBeNull()
  })

  it('refuses process-to-signal and says which is which', () => {
    const r = explainConnection('signal', 'process', false)
    expect(r?.code).toBe('kind-mismatch')
    expect(r?.body).toContain('instrument signal')
    expect(r?.body).toContain('process material')
    expect(r?.hint).toBeTruthy()
  })

  it('refuses a symbol joined to itself, and says so specifically', () => {
    const r = explainConnection('process', 'process', true)
    expect(r?.code).toBe('same-symbol')
    // not the kind message — these are different problems with different fixes
    expect(r?.body).not.toContain('process material')
  })

  it('reports the same verdict the paper enforces', () => {
    // the rule itself must not have moved: every pairing, both directions
    const kinds = ['process', 'signal', 'both'] as const
    for (const a of kinds) {
      for (const b of kinds) {
        const refused = explainConnection(a, b, false) !== null
        const expected = !((a !== 'signal' && b !== 'signal') || (a !== 'process' && b !== 'process'))
        expect(refused, `${a} → ${b}`).toBe(expected)
      }
    }
  })
})

describe('classifying a file that would not open', () => {
  it('separates the four things that can go wrong', () => {
    expect(classifyOpenError(new SyntaxError('Unexpected token'))).toBe('unreadable')
    expect(classifyOpenError(new DocError('Document has no sheets'))).toBe('not-a-drawing')
    expect(classifyOpenError(new DexpiImportError('No <PlantModel> root'))).toBe('dexpi')
    expect(classifyOpenError(new Error('boom'))).toBe('unknown')
  })

  it('explains a corrupt file without blaming the drawing', () => {
    const n = openFailureNotice('plant.pnid', new SyntaxError('Unexpected end of JSON input'))
    expect(n.title).toContain('plant.pnid')
    expect(n.body).toContain('not valid JSON')
    expect(n.details).toContain('Unexpected end of JSON input')
  })

  it('uses the validator’s own words for a file that is not a drawing', () => {
    const n = openFailureNotice('notes.json', new DocError('Document has no sheets'))
    expect(n.body).toContain('document has no sheets')
  })

  it('says nothing about the cause when it does not know one', () => {
    // The rule that matters most: a plausible invented reason is worse than
    // no reason, because it sends the engineer looking for the wrong thing.
    const n = openFailureNotice('x.pnid', new Error('EPERM'))
    expect(n.body).toBeUndefined()
    expect(n.title).toContain('could not be opened')
    expect(n.details).toBe('EPERM')
  })

  it('offers "open a different file" only when there is somewhere to go', () => {
    expect(openFailureNotice('a.pnid', new SyntaxError('x')).actions).toBeUndefined()
    const withAction = openFailureNotice('a.pnid', new SyntaxError('x'), () => {})
    expect(withAction.actions?.[0]?.label).toMatch(/different file/)
  })
})

describe('underlay failures', () => {
  it('does not claim to know where the geometry went', () => {
    // The parser knows it could not parse. It does NOT know about paper space,
    // blocks or frozen layers, so the failure message must not say it does.
    const n = underlayFailureNotice('site.dxf', new Error('Could not parse DXF'))
    expect(n.body).toBeUndefined()
    expect(JSON.stringify(n)).not.toMatch(/paper space/i)
    expect(n.hint).toMatch(/untouched/)
  })

  it('treats "parsed but nothing drawable" as its own case', () => {
    const n = underlayEmptyNotice('site.dxf')
    expect(n.kind).toBe('warning')
    expect(n.body).toContain('lines, polylines, circles and arcs')
    // here the advice IS framed as advice about what to try, not a diagnosis
    expect(n.hint).toMatch(/usually/)
  })
})

describe('save failures', () => {
  it('turns the three that actually happen into sentences', () => {
    expect(cloudErrorMessage(new Error('Failed to fetch'))).toMatch(/connection/i)
    expect(cloudErrorMessage(new Error('Missing or insufficient permissions.'))).toMatch(/not allowed/i)
    expect(cloudErrorMessage(new Error('resource-exhausted'))).toMatch(/too large/i)
  })

  it('admits ignorance rather than inventing a cause', () => {
    expect(cloudErrorMessage(new Error('kaboom'))).toMatch(/did not say why/)
  })
})

describe('the notice model', () => {
  it('notifies subscribers and hands back what was raised', () => {
    const seen = vi.fn()
    const off = subscribeNotices(seen)
    const id = notify({ kind: 'error', title: 'Nope' })
    expect(seen).toHaveBeenCalled()
    expect(noticeSnapshot()).toHaveLength(1)
    expect(noticeSnapshot()[0]!.title).toBe('Nope')
    dismissNotice(id)
    expect(noticeSnapshot()).toHaveLength(0)
    off()
  })

  it('keeps one status line, not a stack', () => {
    vi.useFakeTimers()
    showStatus('first')
    showStatus('second')
    expect(statusSnapshot()?.text).toBe('second')
    vi.advanceTimersByTime(6100)
    expect(statusSnapshot()).toBeNull()
    vi.useRealTimers()
  })

  it('clears a status line on demand without waiting for the timer', () => {
    showStatus('hello')
    clearStatus()
    expect(statusSnapshot()).toBeNull()
  })

  it('resolves a confirmation with the answer', async () => {
    const p = confirmAction({ title: 'Sure?', body: 'b', confirmLabel: 'Do it' })
    expect(confirmSnapshot()?.confirmLabel).toBe('Do it')
    confirmSnapshot()!.resolve(true)
    expect(await p).toBe(true)
    expect(confirmSnapshot()).toBeNull()
  })

  it('refuses a second confirmation rather than stacking two questions', async () => {
    const first = confirmAction({ title: 'A', body: 'a', confirmLabel: 'A' })
    const second = confirmAction({ title: 'B', body: 'b', confirmLabel: 'B' })
    expect(await second).toBe(false)
    expect(confirmSnapshot()?.title).toBe('A')
    confirmSnapshot()!.resolve(false)
    expect(await first).toBe(false)
  })
})
