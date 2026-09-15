import { describe, expect, it } from 'vitest'
import { evalAlarms, ackAlarms } from '../../src/hmi/sim/alarms'
import type { TagDef } from '../../src/hmi/sim/tags'

const defs: TagDef[] = [{ name: 'TK-1', kind: 'tank', min: 0, max: 100, limits: { LL: 5, L: 10, H: 90, HH: 95 } }]
const at = (pv: number) => ({ 'TK-1': { PV: pv } })

describe('alarm lifecycle', () => {
  it('raises H then HH as the level climbs', () => {
    let a = evalAlarms(defs, at(92), [], 1)
    // `limit` is the threshold it actually tripped against — kept on the
    // record so the banner can read "92 above 90" without re-deriving it.
    expect(a).toEqual([{ id: 'TK-1:H', tag: 'TK-1', level: 'H', phase: 'active', since: 1, priority: 'medium', value: 92, limit: 90 }])
    a = evalAlarms(defs, at(97), a, 2)
    expect(a.map((x) => x.id).sort()).toEqual(['TK-1:H', 'TK-1:HH'])
  })
  it('active -> cleared on return to normal, removed after ack', () => {
    let a = evalAlarms(defs, at(92), [], 1)
    a = evalAlarms(defs, at(50), a, 2)
    expect(a[0]!.phase).toBe('cleared')
    a = ackAlarms(a)
    expect(a).toHaveLength(0)
  })
  it('acked then normal is removed silently; cleared re-violation reactivates', () => {
    const a = ackAlarms(evalAlarms(defs, at(92), [], 1))
    expect(a[0]!.phase).toBe('acked')
    expect(evalAlarms(defs, at(50), a, 2)).toHaveLength(0)
    let b = evalAlarms(defs, at(92), [], 1)
    b = evalAlarms(defs, at(50), b, 2)
    b = evalAlarms(defs, at(93), b, 3)
    expect(b[0]!.phase).toBe('active')
  })
  it('low limits mirror high limits', () => {
    const a = evalAlarms(defs, at(3), [], 1)
    expect(a.map((x) => x.level).sort()).toEqual(['L', 'LL'])
  })
  it('ack by id only acks that alarm', () => {
    let a = evalAlarms(defs, at(97), [], 1)
    a = ackAlarms(a, 'TK-1:HH')
    expect(a.find((x) => x.id === 'TK-1:HH')!.phase).toBe('acked')
    expect(a.find((x) => x.id === 'TK-1:H')!.phase).toBe('active')
  })
})
