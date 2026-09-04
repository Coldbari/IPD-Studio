import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { DOCK_STANDOFF, dockEdge, dockKey, dockRadius, findDock } from '../../src/canvas/autoConnect'
import { portWorld } from '../../src/canvas/alignment'
import type { PlantEdge, PlantNode } from '../../src/model/types'

let n = 0
const mk = (symbolId: string, x: number, y: number, kind: PlantNode['kind'] = 'valve'): PlantNode => ({
  id: `n${n++}`,
  symbolId,
  kind,
  x,
  y,
  rotation: 0,
})

// valve.gate is 32x16 with process ports w(0,8) and e(32,8).
// cv.globe is 64x48 with process w(0,36)/e(64,36) and signal sig(32,0).
// instr.bubble is 40x40 with n/e/s/w ports of kind 'both'.

describe('findDock', () => {
  it('docks the near port pair, standing off so a visible pipe is left between', () => {
    const fixed = mk('valve.gate', 200, 200) // e port at (232, 208), facing right
    const moving = mk('valve.gate', 240, 200) // w port at (240, 208) — 8px away
    const dock = findDock(moving, [fixed], [], 'process.major', 18)
    expect(dock).not.toBeNull()
    expect(dock!.movingPortId).toBe('w')
    expect(dock!.targetNodeId).toBe(fixed.id)
    expect(dock!.targetPortId).toBe('e')
    expect(dock!.lineClass).toBe('process.major')
    expect(dock!.at).toEqual({ x: 232, y: 208 })
    // one standoff further along the way the port faces, dead in line with it
    expect(dock!.portAt).toEqual({ x: 232 + DOCK_STANDOFF, y: 208 })
    const docked = { ...moving, x: dock!.x, y: dock!.y }
    expect(portWorld(docked, 'w')).toEqual(dock!.portAt)
  })

  it('stands off along the way the landed-on port faces', () => {
    // cv.globe's signal boss points up, so the instrument lands above it.
    const cv = mk('cv.globe', 100, 100) // sig at (132, 100), facing top
    const bubble = mk('instr.bubble', 114, 64, 'instrument') // s at (134, 104)
    const dock = findDock(bubble, [cv], [], 'process.major', 18)
    expect(dock!.portAt).toEqual({ x: 132, y: 100 - DOCK_STANDOFF })
  })

  it('refuses a pairing the caller has shaken off', () => {
    const fixed = mk('valve.gate', 200, 200)
    const moving = mk('valve.gate', 240, 200)
    const refused = new Set([`w|${fixed.id}/e`])
    expect(findDock(moving, [fixed], [], 'process.major', 18, refused)).toBeNull()
  })

  it('finds nothing when no port is within reach', () => {
    const fixed = mk('valve.gate', 200, 200)
    const moving = mk('valve.gate', 400, 400)
    expect(findDock(moving, [fixed], [], 'process.major', 18)).toBeNull()
  })

  it('prefers the closest of several candidate ports', () => {
    const near = mk('valve.gate', 200, 200) // e at (232, 208)
    const far = mk('valve.gate', 200, 216) // e at (232, 224)
    const moving = mk('valve.gate', 236, 202) // w at (236, 210)
    const dock = findDock(moving, [near, far], [], 'process.major', 24)
    expect(dock!.targetNodeId).toBe(near.id)
  })

  it('skips a pair that is already connected, so a nudge cannot stack a second line', () => {
    const fixed = mk('valve.gate', 200, 200)
    const moving = mk('valve.gate', 240, 200)
    const edge: PlantEdge = {
      id: 'e1',
      lineClass: 'process.major',
      source: { nodeId: fixed.id, portId: 'e' },
      target: { nodeId: moving.id, portId: 'w' },
    }
    expect(findDock(moving, [fixed], [edge], 'process.major', 18)).toBeNull()
  })

  it('never docks a signal-only port onto a process-only port', () => {
    const cv = mk('cv.globe', 0, 0) // sig at (32, 0), process w/e at y=36
    const gate = mk('valve.gate', 24, -8) // w at (24, 0) — 8px from sig
    expect(findDock(gate, [cv], [], 'process.major', 18)).toBeNull()
  })

  it('picks the signal family when docking onto a signal port, whatever the toolbar says', () => {
    const cv = mk('cv.globe', 100, 100) // sig at (132, 100)
    const bubble = mk('instr.bubble', 114, 64, 'instrument') // s at (134, 104)
    const dock = findDock(bubble, [cv], [], 'process.major', 18)
    expect(dock!.movingPortId).toBe('s')
    expect(dock!.targetPortId).toBe('sig')
    expect(dock!.lineClass).toBe('signal.electric')
    expect({ x: dock!.x, y: dock!.y }).toEqual({ x: 112, y: 60 - DOCK_STANDOFF })
  })

  it('honors rotation when locating the ports and when judging which way they face', () => {
    const fixed = mk('valve.gate', 200, 200) // e at (232, 208), facing right
    // Turned end for end, so this valve's e port is the one facing left.
    const moving: PlantNode = { ...mk('valve.gate', 0, 0), rotation: 180 }
    const at = portWorld(moving, 'e')!
    const shifted = { ...moving, x: moving.x + (232 - at.x) + 5, y: moving.y + (208 - at.y) + 5 }
    const dock = findDock(shifted, [fixed], [], 'process.major', 18)
    expect(dock!.movingPortId).toBe('e')
    expect(portWorld({ ...shifted, x: dock!.x, y: dock!.y }, 'e')).toEqual({ x: 232 + DOCK_STANDOFF, y: 208 })
  })

  it('only joins ports that face each other', () => {
    const fixed = mk('valve.gate', 200, 200) // e at (232, 208), facing right
    // This valve's e port also faces right, so butting it up against the
    // other one would stand it on the wrong side of the nozzle.
    const moving = mk('valve.gate', 208, 200) // e at (240, 208) — 8px away
    const dock = findDock(moving, [fixed], [], 'process.major', 18)
    expect(dock?.movingPortId).not.toBe('e')
  })

  it('has nothing to dock for a symbol without ports', () => {
    const fixed = mk('valve.gate', 200, 200)
    const note = mk('ann.text', 200, 200, 'annotation')
    expect(findDock(note, [fixed], [], 'process.major', 18)).toBeNull()
  })
})

describe('dockEdge', () => {
  it('draws the line from the moved symbol to the one it landed on', () => {
    const fixed = mk('valve.gate', 200, 200)
    const moving = mk('valve.gate', 240, 200)
    const dock = findDock(moving, [fixed], [], 'process.major', 18)!
    expect(dockEdge(moving.id, dock)).toEqual({
      lineClass: 'process.major',
      source: { nodeId: moving.id, portId: 'w' },
      target: { nodeId: fixed.id, portId: 'e' },
    })
  })
})

describe('dockKey', () => {
  it('names a pairing so a shaken-off one can be refused for the rest of the drag', () => {
    const fixed = mk('valve.gate', 200, 200)
    const moving = mk('valve.gate', 240, 200)
    const dock = findDock(moving, [fixed], [], 'process.major', 18)!
    expect(dockKey(dock)).toBe(`w|${fixed.id}/e`)
  })
})

describe('dockRadius', () => {
  it('keeps the reach constant on screen, clamped at extreme zoom', () => {
    expect(dockRadius(1)).toBe(18)
    expect(dockRadius(2)).toBe(9)
    expect(dockRadius(4)).toBe(6) // clamped: never smaller than 6 sheet px
    expect(dockRadius(0.05)).toBe(48) // clamped: never grabbier than 48
  })
})

/* Regressions from real use on 2026-09-02 (screenshots): a bubble dropped
   beside another would not catch, and a symbol that HAD caught could not be
   dragged away again. */
describe('findDock — pairings real drawings need', () => {
  it('joins a vertical symbol to a horizontal one (perpendicular ports)', () => {
    const flat = mk('valve.gate', 200, 200) // e at (232, 208), facing right
    // Quarter-turned: this valve's e port faces DOWN, and sits at (232, 200).
    const upright: PlantNode = { ...mk('valve.gate', 216, 176), rotation: 90 }
    expect(portWorld(upright, 'e')).toEqual({ x: 232, y: 200 })
    const dock = findDock(upright, [flat], [], 'process.major', 18)
    expect(dock).not.toBeNull()
    expect(dock!.movingPortId).toBe('e')
    expect(dock!.targetPortId).toBe('e')
  })

  it('still refuses two ports pointing the same way', () => {
    const fixed = mk('valve.gate', 200, 200) // e at (232, 208), facing right
    const moving = mk('valve.gate', 208, 200) // e at (240, 208), also facing right
    expect(findDock(moving, [fixed], [], 'process.major', 18)?.movingPortId).not.toBe('e')
  })

  it('never re-docks two symbols that already have a line between them', () => {
    // An instrument bubble has four ports, so a pair joined on one of them
    // still has fifteen other pairings — every one of which used to grab the
    // symbol back as the user tried to drag it away.
    const a = mk('instr.bubble', 100, 100, 'instrument') // n(120,100) e(140,120)
    const b = mk('instr.bubble', 100, 68, 'instrument') // s at (120, 108)
    const joined: PlantEdge = {
      id: 'e1',
      lineClass: 'signal.electric',
      source: { nodeId: a.id, portId: 'e' },
      target: { nodeId: b.id, portId: 'w' },
    }
    expect(findDock(b, [a], [joined], 'process.major', 18)).toBeNull()
  })
})
