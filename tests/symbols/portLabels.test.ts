import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { getSymbol, SYMBOLS } from '../../src/symbols/registry'
import { connectionRef, nodeRef, portLabel, portLabels, portSide } from '../../src/symbols/portLabels'
import { portDirection } from '../../src/canvas/shapes'
import type { PlantNode } from '../../src/model/types'

const node = (symbolId: string, over: Partial<PlantNode> = {}): PlantNode => ({
  id: 'n1', symbolId, kind: 'equipment', x: 0, y: 0, rotation: 0, ...over,
} as PlantNode)

describe('port identity', () => {
  it('stable ids are untouched by naming them', () => {
    // The document stores these strings and nothing else. If naming a port
    // ever renames one, every saved drawing that used it loses a connection.
    expect(getSymbol('pump.centrifugal').ports.map((p) => p.id)).toEqual(['suction', 'discharge'])
    expect(getSymbol('psv').ports.map((p) => p.id)).toEqual(['in', 'out'])
    expect(getSymbol('vessel.vertical').ports.map((p) => p.id))
      .toEqual(['n', 'n1', 'n2', 's', 's1', 'e', 'e1', 'e2', 'w', 'w1', 'w2'])
    expect(getSymbol('cv.globe').ports.map((p) => p.id)).toEqual(['w', 'e', 'sig', 'sw', 'se', 'sb'])
    expect(getSymbol('logic.and').ports.map((p) => p.id)).toEqual(['w1', 'w2', 'e'])
  })

  it('every port of every symbol resolves to a label', () => {
    for (const def of SYMBOLS.values()) {
      const labels = portLabels(def.id)
      for (const p of def.ports) {
        const l = labels.get(p.id)
        expect(l, `${def.id}:${p.id}`).toBeDefined()
        expect(l!.text.length, `${def.id}:${p.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('two ports on one symbol never read the same', () => {
    // A list of three "Top connection"s is worse than the ids it replaced.
    for (const def of SYMBOLS.values()) {
      const texts = [...portLabels(def.id).values()].map((l) => l.text)
      expect(new Set(texts).size, def.id).toBe(texts.length)
    }
  })

  it('unknown symbols and user-added pins have no label', () => {
    expect(portLabel('no.such.symbol', 'w')).toBeNull()
    // A pin the user placed is not in the catalogue: the app did not put it
    // there and has nothing to call it.
    expect(portLabel('pump.centrifugal', 'pin-1')).toBeNull()
  })
})

describe('authoritative names', () => {
  it('come from the definition, and say so', () => {
    const pump = portLabels('pump.centrifugal')
    expect(pump.get('suction')).toEqual({ text: 'Suction', authoritative: true })
    expect(pump.get('discharge')).toEqual({ text: 'Discharge', authoritative: true })
    expect(portLabels('psv').get('in')).toEqual({ text: 'Inlet', authoritative: true })
    expect(portLabels('valve.mov').get('sig')).toEqual({ text: 'Signal', authoritative: true })
    expect(portLabels('logic.or').get('e')).toEqual({ text: 'Output', authoritative: true })
  })

  it('are not invented for ports the catalogue does not decide', () => {
    // Eight of the nine pumps use w/e because nothing in their definitions
    // says which side draws and which delivers. They must stay positional.
    for (const id of ['pump.gear', 'pump.diaphragm', 'pump.peristaltic', 'pump.vacuum']) {
      const labels = portLabels(id)
      expect(labels.get('w')!.authoritative, id).toBe(false)
      expect(labels.get('e')!.text, id).toBe('Right connection')
    }
    // A shell-and-tube exchanger has four connections and the symbol does not
    // say which pair is the shell side.
    for (const l of portLabels('hx.shell-tube').values()) expect(l.authoritative).toBe(false)
    // Nor does a signal converter say which way the signal goes through it.
    for (const l of portLabels('instr.converter').values()) expect(l.authoritative).toBe(false)
  })

  it('may repeat where the catalogue only knows the group', () => {
    // All three bosses belong to the positioner; which carries supply, output
    // and feedback is the instrument's business. Position tells them apart.
    const cv = portLabels('cv.globe')
    expect(cv.get('sw')).toEqual({ text: 'Positioner connection (upper)', authoritative: true })
    expect(cv.get('se')!.text).toBe('Positioner connection (middle)')
    expect(cv.get('sb')!.text).toBe('Positioner connection (lower)')
    // Both jacket connections are jacket connections; neither is declared the
    // supply.
    const cstr = portLabels('vessel.cstr')
    expect(cstr.get('js')!.text).toBe('Jacket connection (left)')
    expect(cstr.get('jn')!.text).toBe('Jacket connection (right)')
  })
})

describe('positional labels', () => {
  it('describe where a point is and never what it is for', () => {
    expect(portLabels('valve.gate').get('w')!.text).toBe('Left connection')
    expect(portLabels('valve.gate').get('e')!.text).toBe('Right connection')
    expect(portLabels('valve.gate').get('w')!.authoritative).toBe(false)
    // No "inlet", "outlet", "process" or "service" anywhere in the fallback.
    for (const def of SYMBOLS.values()) {
      for (const [id, l] of portLabels(def.id)) {
        if (l.authoritative) continue
        expect(l.text.toLowerCase(), `${def.id}:${id}`).not.toMatch(/inlet|outlet|suction|discharge|supply|return|feed/)
      }
    }
  })

  it('tell apart several points on one face', () => {
    const v = portLabels('vessel.vertical')
    expect(v.get('n1')!.text).toBe('Top connection (left)')
    expect(v.get('n')!.text).toBe('Top connection (centre)')
    expect(v.get('n2')!.text).toBe('Top connection (right)')
    expect(v.get('e1')!.text).toBe('Right connection (upper)')
    expect(v.get('e')!.text).toBe('Right connection (middle)')
    expect(v.get('e2')!.text).toBe('Right connection (lower)')
    // Beyond three there is no honest short word, so they number down the side.
    const col = portLabels('vessel.column-tray')
    expect(col.get('w1')!.text).toBe('Left connection 1')
    expect(col.get('w3')!.text).toBe('Left connection 4')
  })

  it('say nothing about a face for a port that is on none', () => {
    // A bullet's bottom nozzles sit inside the dished end, past the tolerance
    // the router uses to commit to a direction. Describing them as "bottom"
    // would be a guess the geometry does not support.
    expect(portDirection('vessel.bullet', 's')).toBeNull()
    expect(portLabels('vessel.bullet').get('s')!.text).toMatch(/^Connection point/)
  })

  it('follow the symbol round when it is rotated', () => {
    const v = (r: 0 | 90 | 180 | 270, id: string) => portLabels('vessel.vertical', r).get(id)!.text
    expect(v(0, 'n1')).toBe('Top connection (left)')
    expect(v(90, 'n1')).toBe('Right connection (upper)')
    expect(v(180, 'n1')).toBe('Bottom connection (right)')
    expect(v(270, 'n1')).toBe('Left connection (lower)')
    // An authoritative name is a fact about the equipment, so it does not turn.
    expect(portLabels('pump.centrifugal', 90).get('suction')!.text).toBe('Suction')
  })

  it('are the same side the router uses', () => {
    // One geometry rule, not two: portDirection delegates to portSide.
    for (const def of SYMBOLS.values()) {
      for (const p of def.ports) {
        expect(portDirection(def.id, p.id), `${def.id}:${p.id}`)
          .toBe(portSide(p, def.gridSize.w * 8, def.gridSize.h * 8))
      }
    }
  })
})

describe('naming an object in a sentence', () => {
  it('prefers the tag an engineer would use', () => {
    expect(nodeRef(node('pump.centrifugal'))).toBe('Centrifugal Pump')
    expect(nodeRef(node('pump.centrifugal', { tag: { letters: 'P', loop: '101' } }))).toBe('P-101')
    expect(nodeRef(node('gone.missing'))).toBeNull()
  })

  it('joins the object and the point the way it is said out loud', () => {
    const pump = node('pump.centrifugal', { tag: { letters: 'P', loop: '101' } })
    expect(connectionRef(pump, 'discharge')).toBe('P-101 discharge')
    expect(connectionRef(node('vessel.vertical'), 'n1')).toBe('Vertical Vessel top connection (left)')
    // Nothing to say beats something invented.
    expect(connectionRef(pump, 'pin-1')).toBeNull()
  })
})
