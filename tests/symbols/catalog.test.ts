import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { byCategory, getSymbol, searchSymbols, SYMBOLS } from '../../src/symbols/registry'

const PHASE2_IDS = [
  'valve.pinch', 'valve.stopcheck', 'valve.fourway', 'valve.angle', 'valve.knife',
  'psv.pilot', 'pvsv', 'vacuum-breaker', 'flame-arrestor', 'breather', 'bpcv', 'tcv.self',
  'fe.nozzle', 'fe.pitot', 'fe.avgpitot', 'fe.ultrasonic', 'fe.thermal', 'fe.pd',
  'acc.bulb', 'acc.bimetal', 'acc.seal', 'acc.floatcage', 'acc.radar', 'acc.loadcell',
  'pump.peristaltic', 'pump.plunger', 'pump.submersible', 'pump.vacuum',
  'comp.recip', 'comp.screw', 'turbine.steam', 'vfd',
  'vessel.floating-roof', 'vessel.sphere', 'vessel.bullet', 'vessel.open', 'vessel.silo',
  'vessel.column-packed', 'vessel.fixedbed', 'vessel.sep3', 'cyclone',
  'hx.kettle', 'hx.doublepipe', 'heater.electric', 'heater.fired', 'hx.condenser', 'cooling-tower',
  'strainer.basket', 'strainer.cone', 'centrifuge', 'scrubber', 'demister', 'mixer.static',
  'fit.reducer-ecc', 'fit.blind', 'fit.spade', 'fit.hose', 'fit.expansion', 'fit.sightglass',
  'fit.silencer', 'fit.quill',
  'ann.insulation', 'ann.slope', 'ann.tiein', 'ann.bl-flag', 'ann.onpage', 'ann.revtriangle', 'ann.equipstrip',
  'logic.and', 'logic.or', 'logic.not', 'ctl.dcs', 'ctl.plc', 'ctl.sis', 'ctl.jb', 'ctl.panel',
]

const PHASE3_IDS = [
  'conveyor.belt', 'conveyor.screw', 'bucket-elevator', 'feeder.rotary', 'crusher',
  'screen.vibrating', 'clarifier', 'filter.press', 'filter.rotary', 'dryer.rotary',
  'dryer.spray', 'dryer.tray', 'evaporator', 'crystallizer', 'bagfilter',
  'coalescer', 'hydrocyclone', 'mill.ball', 'extruder', 'blender.ribbon',
  'deaerator', 'chiller', 'package-unit', 'boiler', 'stack', 'flare', 'air-dryer', 'filter-sep',
  'elec.mcc', 'elec.ups', 'elec.barrier', 'elec.transformer',
  'fit.union', 'fit.coupling', 'fit.exhaust-head', 'fit.mixing-tee', 'fit.hose-station',
  'fit.rupture-pin', 'fit.trap-float', 'fit.trap-bucket', 'fit.trap-thermo', 'sample.cooler',
  'ann.matchline', 'ann.detail-flag', 'ann.holds',
]

const PHASE1_IDS = [
  'fe.orifice', 'fe.venturi', 'fe.magmeter', 'fe.coriolis', 'fe.vortex', 'fe.turbine', 'fe.rotameter', 'fe.ro',
  'acc.thermowell', 'acc.pg', 'acc.lg',
  'pump.centrifugal', 'pump.gear', 'pump.diaphragm', 'ejector', 'comp.centrifugal', 'blower', 'motor', 'agitator',
  'vessel.vertical', 'vessel.horizontal', 'vessel.tank', 'vessel.column-tray', 'vessel.cstr', 'vessel.ko-drum',
  'hx.shell-tube', 'hx.plate', 'hx.air-cooler',
  'strainer.y', 'filter.cartridge',
  'fit.reducer', 'fit.flanges', 'fit.spectacle', 'fit.steam-trap', 'fit.sample', 'fit.drain', 'fit.vent', 'fit.specbreak',
  'ctl.interlock',
  'ann.offpage', 'ann.arrow', 'ann.text', 'ann.noteflag', 'ann.cloud',
]

const PHASE4_IDS = [
  'valve.solenoid', 'valve.mov', 'valve.foot', 'valve.ballcheck', 'valve.float',
  'acc.afr', 'acc.siphon',
  'fit.pulsation-dampener', 'fit.funnel',
  'fan', 'hx.coil',
]

describe('phase-4 catalog (frequent-industry additions)', () => {
  it('registers every phase-4 id', () => {
    for (const id of PHASE4_IDS) expect(() => getSymbol(id), id).not.toThrow()
  })
  it('actuated on/off valves carry a signal port', () => {
    for (const id of ['valve.solenoid', 'valve.mov']) {
      const def = getSymbol(id)
      expect(def.ports.some((p) => p.kind === 'signal'), id).toBe(true)
      expect(def.ports.filter((p) => p.kind === 'process'), id).toHaveLength(2)
      expect(def.tagRule).toBe('valve')
    }
    expect(getSymbol('valve.solenoid').render({})).toContain('>S<')
    expect(getSymbol('valve.mov').render({})).toContain('>M<')
  })
  it('foot valve hangs off a single suction port; funnel drains downward', () => {
    expect(getSymbol('valve.foot').ports).toHaveLength(1)
    expect(getSymbol('fit.funnel').ports).toHaveLength(1)
    expect(getSymbol('fit.pulsation-dampener').render({})).toContain('stroke-dasharray')
  })
  it('fan and coil are equipment', () => {
    expect(getSymbol('fan').tagRule).toBe('equipment')
    expect(getSymbol('hx.coil').tagRule).toBe('equipment')
    expect(getSymbol('hx.coil').ports).toHaveLength(2)
  })
})

describe('phase-3 catalog', () => {
  it('registers every phase-3 id', () => {
    for (const id of PHASE3_IDS) expect(() => getSymbol(id), id).not.toThrow()
  })
  it('spot checks', () => {
    expect((getSymbol('conveyor.belt').render({}).match(/r="6"/g) ?? []).length).toBe(2)
    expect(getSymbol('hydrocyclone').ports).toHaveLength(3)
    expect(getSymbol('package-unit').render({})).toContain('stroke-dasharray')
    expect(getSymbol('elec.barrier').render({})).toMatch(/l-?\d+/)
    expect(getSymbol('flare').render({})).toContain('Q')
  })
})

describe('phase-2 catalog (valves/safety)', () => {
  it('registers every phase-2 valve/safety id', () => {
    for (const id of PHASE2_IDS) expect(() => getSymbol(id), id).not.toThrow()
  })
  it('logic gates have 3 signal ports; NOT has an output dot', () => {
    for (const id of ['logic.and', 'logic.or', 'logic.not']) {
      const def = getSymbol(id)
      expect(def.ports).toHaveLength(3)
      expect(def.ports.every((p) => p.kind === 'signal')).toBe(true)
    }
    expect(getSymbol('logic.not').render({})).toContain('circle')
  })
  it('fourway has 4 ports; digital actuator renders D', () => {
    expect(getSymbol('valve.fourway').ports).toHaveLength(4)
    expect(getSymbol('cv.globe').render({ actuator: 'digital', fail: 'none' })).toContain('>D<')
    expect(getSymbol('cv.globe').render({ actuator: 'electro-hydraulic', fail: 'none' })).toContain('>EH<')
  })
  it('pinch valve has two facing arcs', () => {
    expect((getSymbol('valve.pinch').render({}).match(/Q16/g) ?? []).length).toBe(2)
  })
})

describe('phase-1 catalog', () => {
  it('keeps the topology junction registered but out of the user palette', () => {
    expect(getSymbol('fit.junction').placeable).toBe(false)
    expect(getSymbol('fit.junction').render({})).toContain('<circle')
    expect([...byCategory().values()].flat().some((def) => def.id === 'fit.junction')).toBe(false)
    expect(searchSymbols('junction').some((def) => def.id === 'fit.junction')).toBe(false)
  })
  it('registers every phase-1 id', () => {
    for (const id of PHASE1_IDS) expect(() => getSymbol(id), id).not.toThrow()
  })
  it('has at least 175 symbols', () => {
    expect(SYMBOLS.size).toBeGreaterThanOrEqual(175)
  })
  it('pump is a circle r14 with discharge duct', () => {
    const svg = getSymbol('pump.centrifugal').render({})
    expect(svg).toContain('r="14"')
    expect(svg).toContain('H44')
  })
  it('tray column has at least 3 trays', () => {
    const svg = getSymbol('vessel.column-tray').render({})
    expect((svg.match(/H36/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
  it('orifice is line plus two flange bars', () => {
    const svg = getSymbol('fe.orifice').render({})
    expect(svg).toContain('M0 8 H32')
    expect(svg).toContain('M14 0')
    expect(svg).toContain('M18 0')
  })
  it('off-page connector pentagon closes', () => {
    expect(getSymbol('ann.offpage').render({})).toMatch(/Z/)
  })
  it('interlock ports are signal-kind', () => {
    expect(getSymbol('ctl.interlock').ports.every((p) => p.kind === 'signal')).toBe(true)
  })
})
