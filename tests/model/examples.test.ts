import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/symbols/lib/index'
import { loadDoc } from '../../src/model/migrate'

/**
 * The bundled examples are the Templates menu, and they span every schema
 * version this project has ever written (1 through 4). They are therefore the
 * closest thing to real user documents in the repo — if a migration breaks
 * them, it breaks people's saved drawings too. Every future schema bump has to
 * keep this passing.
 */
const dir = join(__dirname, '../../examples')
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

describe('bundled example documents', () => {
  it('there are examples to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s migrates to the current schema', (file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const doc = loadDoc(raw)

    expect(doc.schemaVersion).toBe(6)
    expect(doc.sheets.length).toBeGreaterThan(0)
    expect(typeof doc.meta.name).toBe('string')
    // migration must never drop the drawing itself
    const before = (raw.sheets ?? [{ nodes: raw.nodes ?? [] }]).reduce(
      (n: number, sh: { nodes?: unknown[] }) => n + (sh.nodes?.length ?? 0), 0)
    const after = doc.sheets.reduce((n, sh) => n + sh.nodes.length, 0)
    expect(after).toBe(before)
  })

  it.each(files)('%s survives a save/load round trip', (file) => {
    const doc = loadDoc(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    const round = loadDoc(JSON.parse(JSON.stringify(doc)))
    expect(round.sheets.length).toBe(doc.sheets.length)
    expect(round.registry ?? {}).toEqual(doc.registry ?? {})
  })
})
