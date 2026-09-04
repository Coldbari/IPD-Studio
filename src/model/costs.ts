// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { BudgetSettings, PlantNode, ProjectDoc } from './types'
import { getSymbol } from '../symbols/registry'

/**
 * Budgetary (order-of-magnitude) hardware prices in USD, researched Aug 2026
 * against distributor and manufacturer listings, published cost correlations
 * (Towler & Sinnott / Matches, CEPCI-escalated) and tender awards. Prices are
 * FOB/ex-works, HARDWARE ONLY — no installation, freight, tax or engineering.
 *
 * Every value is an EDITABLE DEFAULT: the Budget dialog overrides per project,
 * and each placed component can carry its own exact price. `installFactor`
 * (Lang-style) scales hardware to installed cost.
 *
 * `low`/`high` bracket the realistic spread for the component class across
 * size, material and rating — often 5-10x for equipment. `basis` states the
 * size/rating the `price` is for; a different size needs a different number.
 * `ev` is how the figure was established: 'sourced' means at least one
 * published price was observed, 'est' means no vendor publishes one (typically
 * quote-only kit — flares, fired heaters, MCCs, DCS) and the value comes from a
 * cost correlation or a component build-up.
 */
export interface PriceEntry {
  price: number
  label: string
  /** Realistic spread for the class, USD. */
  low?: number
  high?: number
  /** Size / rating / material the `price` is for. */
  basis?: string
  /** 'sourced' = a published price was observed; 'est' = correlation or build-up. */
  ev?: 'sourced' | 'est'
}

export const DEFAULT_PRICES: Record<string, PriceEntry> = {

  // --- instrument bubbles, classified from ISA tag letters ---
  'instr.analyzer': { price: 4000, label: 'Analyzer (AT/AIT/AIC…)', low: 1000, high: 120000, basis: 'Complete single-parameter liquid analyser loop: 4-wire field/panel analyser-transmitter with 4-20 mA +…', ev: 'sourced' },
  'instr.transmitter': { price: 3800, label: 'Transmitter (FT/PT/LT/TT…)', low: 600, high: 14500, basis: '2-wire 4-20 mA HART DP/gauge pressure transmitter as the reference: Rosemount 3051C coplanar class,…', ev: 'sourced' },
  'instr.recorder': { price: 3200, label: 'Recorder (FR/TR…)', low: 790, high: 10200, basis: 'Panel-mount paperless (videographic) recorder, 5.7-7 in colour touchscreen, 6-12 universal analog…', ev: 'sourced' },
  'instr.generic': { price: 2100, label: 'Instrument (other)', low: 200, high: 12000, basis: 'Population-weighted average of the eight buckets above at their stated bases, using a typical…', ev: 'sourced' },
  'instr.controller': { price: 2000, label: 'Controller / DCS loop share (FIC…)', low: 850, high: 6500, basis: 'TWO bases, both given. (a) Standalone: 1/4 DIN panel-mount universal single-loop indicating PID…', ev: 'sourced' },
  'instr.switch': { price: 700, label: 'Process switch (LSH/PSL…)', low: 130, high: 3200, basis: 'Field-mounted process switch, single SPDT snap-action output, NEMA 4X or Ex d enclosure, 316SS wetted…', ev: 'sourced' },
  'instr.converter': { price: 500, label: 'Converter / relay (FY/I-P…)', low: 180, high: 1500, basis: 'Field-mounted current-to-pressure (I/P) transducer, 4-20 mA in, 3-15 psig out, general-purpose or NEMA…', ev: 'sourced' },
  'instr.element': { price: 475, label: 'Primary element (TE/FE/LE…)', low: 120, high: 2200, basis: 'Complete industrial temperature element assembly as the reference case: Pt100 3-wire or Type K element,…', ev: 'sourced' },
  'instr.indicator': { price: 225, label: 'Local indicator (PI/TI/FI…)', low: 55, high: 1800, basis: '4.5 in dial process pressure gauge, phenolic or SS case, 316SS bourdon tube, 1/2 in NPT lower…', ev: 'sourced' },

  // --- control & actuated valves ---
  'cv.globe': { price: 8500, label: 'Control valve, globe', low: 4500, high: 20000, basis: '2 in (DN50), ASME Class 150 RF flanged, CS (WCC) body / 316SS trim, equal-percentage cage trim,…', ev: 'sourced' },
  'cv.ball': { price: 7200, label: 'Control valve, ball', low: 3500, high: 17000, basis: '2 in (DN50), Class 150 RF flanged segmented (V-notch) ball rotary control valve, CS (WCC) body / 316SS…', ev: 'sourced' },
  'valve.mov': { price: 6000, label: 'Motor-operated valve', low: 2500, high: 18000, basis: '2 in (DN50), Class 150 RF flanged CS (WCB) gate valve + electric MULTI-TURN actuator with integral…', ev: 'sourced' },
  'cv.butterfly': { price: 5800, label: 'Control valve, butterfly', low: 2800, high: 14000, basis: '2 in (DN50), Class 150 lugged high-performance double-offset butterfly, CS body / 316SS disc / RTFE…', ev: 'sourced' },
  'valve.solenoid': { price: 340, label: 'Solenoid valve (XV)', low: 150, high: 1400, basis: '1/4 in NPT, 3-way 2-position, brass body, direct-acting, Ex d / NEMA 7-9 encapsulated coil, 120 V AC or…', ev: 'sourced' },

  // --- manual valves ---
  'valve.fourway': { price: 2200, label: '4-way valve', low: 350, high: 5000, basis: '2 in (DN50), ASME Class 150 flanged, 4-way (four-port) manual ball or plug valve, 316SS or CS body,…', ev: 'sourced' },
  'valve.threeway': { price: 1400, label: '3-way valve', low: 220, high: 3000, basis: '2 in (DN50), ASME Class 150 flanged, 3-way L-port (diverting) or T-port (mixing) ball valve, 316SS…', ev: 'sourced' },
  'valve.pinch': { price: 1100, label: 'Pinch valve', low: 240, high: 2500, basis: '2 in (DN50), flanged, manual handwheel, open-frame or enclosed body (aluminum/cast iron),…', ev: 'sourced' },
  'valve.diaphragm': { price: 900, label: 'Diaphragm valve', low: 210, high: 2200, basis: '2 in (DN50), Class 150 flanged, weir type, manual handwheel — ductile iron/cast iron body with…', ev: 'sourced' },
  'valve.ball': { price: 700, label: 'Ball valve', low: 300, high: 1600, basis: '2 in (DN50), ASME Class 150 RF flanged, carbon steel body, full port, RTFE/TFM seats, 316SS ball &…', ev: 'sourced' },
  'valve.stopcheck': { price: 550, label: 'Stop-check valve', low: 300, high: 1500, basis: '2 in (DN50), ASME Class 150 RF flanged, cast carbon steel WCB, globe-pattern non-return with stem (Y-…', ev: 'sourced' },
  'valve.plug': { price: 520, label: 'Plug valve', low: 250, high: 1500, basis: '2 in (DN50), Class 125/150 flanged, cast iron body, lubricated (Nordstrom-type) or sleeved, regular…', ev: 'sourced' },
  'valve.globe': { price: 500, label: 'Globe valve', low: 230, high: 1800, basis: '2 in (DN50), ASME Class 150 RF flanged, cast carbon steel A216 WCB, bolted bonnet, OS&Y, API 600, 13Cr…', ev: 'sourced' },
  'valve.angle': { price: 500, label: 'Angle valve', low: 200, high: 1400, basis: '2 in (DN50), angle-pattern globe valve, Class 125/150, bronze body with PTFE or bronze disc, FNPT ends…', ev: 'sourced' },
  'valve.gate': { price: 450, label: 'Gate valve', low: 250, high: 1400, basis: '2 in (DN50), ASME Class 150 RF flanged, cast carbon steel A216 WCB body, bolted bonnet, OS&Y, API 600,…', ev: 'sourced' },
  'valve.knife': { price: 450, label: 'Knife gate valve', low: 200, high: 1200, basis: '2 in (DN50), wafer body between ASME Class 150 flanges, 304/316SS or cast iron body with SS gate,…', ev: 'sourced' },
  'valve.check': { price: 320, label: 'Check valve', low: 150, high: 900, basis: '2 in (DN50), ASME Class 150 RF flanged, cast carbon steel A216 WCB, bolted cover, swing disc, 13Cr…', ev: 'sourced' },
  'valve.ballcheck': { price: 300, label: 'Ball check valve', low: 110, high: 800, basis: '2 in (DN50), Class 125/150 flanged, cast/ductile iron body, epoxy coated, elastomer-coated or nitrile…', ev: 'sourced' },
  'valve.float': { price: 250, label: 'Float valve', low: 150, high: 3100, basis: '2 in (DN50), pipe-mount float valve (lever-arm ball float), FNPT threaded, bronze/lead-free brass body…', ev: 'sourced' },
  'valve.butterfly': { price: 220, label: 'Butterfly valve', low: 80, high: 600, basis: '2 in (DN50), lug style (ASME Class 150 bolt pattern), 200 psi, epoxy-coated ductile iron body, 316SS…', ev: 'sourced' },
  'valve.needle': { price: 180, label: 'Needle valve', low: 60, high: 450, basis: 'BASIS DEVIATION — priced as instrumentation needle valve: 1/2 in FNPT, 316SS bar-stock body, 6000 psi…', ev: 'sourced' },
  'valve.foot': { price: 55, label: 'Foot valve', low: 35, high: 700, basis: '2 in (DN50), FNPT threaded, cast iron body with integral strainer and non-return disc, water suction…', ev: 'sourced' },

  // --- safety & relief ---
  'psv.pilot': { price: 14000, label: 'Pilot-operated PSV', low: 6000, high: 45000, basis: '2 in x 3 in (2J3-equivalent), Class 150 RF flanged, CS body with 316SS trim, modulating or pop-action…', ev: 'sourced' },
  psv: { price: 6500, label: 'Pressure safety valve', low: 1800, high: 33000, basis: '2 in x 3 in (2J3), J orifice (1.287 in2), Class 150 RF x Class 150 RF, conventional (closed screwed…', ev: 'sourced' },
  pvsv: { price: 4800, label: 'P/V conservation vent', low: 400, high: 9500, basis: '3 in (DN80) inlet weight/spring-loaded pressure-and-vacuum relief valve, pipe-away style, cast…', ev: 'sourced' },
  'tcv.self': { price: 4500, label: 'Self-acting TCV', low: 1200, high: 9000, basis: 'Complete 2 in (DN50) self-acting temperature control set: 2-port control valve (cast iron / bronze / SG…', ev: 'sourced' },
  bpcv: { price: 3400, label: 'Back-pressure valve', low: 700, high: 9000, basis: '2 in (DN50) self-contained back-pressure (upstream-sensing) regulator, CS or ductile iron body, 316SS…', ev: 'sourced' },
  'pcv.self': { price: 3200, label: 'Self-acting PCV', low: 550, high: 7500, basis: '2 in (DN50) self-operated spring-loaded pressure reducing regulator, cast steel (WCC) or ductile iron…', ev: 'sourced' },
  'flame-arrestor': { price: 1900, label: 'Flame arrestor', low: 600, high: 20000, basis: '2 in (DN50) IN-LINE deflagration flame arrestor, cast aluminium housing with removable crimped-ribbon…', ev: 'sourced' },
  pse: { price: 420, label: 'Rupture disc', low: 60, high: 1200, basis: '2 in (DN50) reverse-acting scored 316SS rupture disc, ~10 barg (150 psig) burst @ 72 F, ASME UD…', ev: 'sourced' },
  'vacuum-breaker': { price: 290, label: 'Vacuum breaker', low: 100, high: 1400, basis: '1/2 in (DN15) NPT vacuum breaker, brass or bronze body with 316SS internals and elastomer seal,…', ev: 'sourced' },
  breather: { price: 120, label: 'Breather valve', low: 35, high: 900, basis: '2 in (DN50) open/free vent — gooseneck or mushroom cap with insect screen, aluminium or brass, threaded…', ev: 'sourced' },

  // --- flow elements ---
  'fe.coriolis': { price: 13000, label: 'Coriolis meter', low: 7000, high: 30000, basis: '2 in (DN50) Coriolis meter, 316L wetted tubes, 2 in ASME Class 150 RF flanges, integral or remote 4-20…', ev: 'sourced' },
  'fe.thermal': { price: 6500, label: 'Thermal mass meter', low: 2600, high: 11000, basis: '2 in (DN50) INLINE thermal mass flowmeter for gas (air / N2 / CH4), 316SS wetted, ASME Class 150…', ev: 'sourced' },
  'fe.vortex': { price: 6000, label: 'Vortex meter', low: 3300, high: 9500, basis: '2 in (DN50) wafer or flanged vortex meter, 316L/CF-3M wetted, ASME Class 150, integral 4-20 mA / HART…', ev: 'sourced' },
  'fe.ultrasonic': { price: 5800, label: 'Ultrasonic meter', low: 1700, high: 13000, basis: '2 in (DN50) pipe. TWO SCOPES: (a) INLINE spool-piece transit-time meter, 316SS wetted, Class 150…', ev: 'sourced' },
  'fe.magmeter': { price: 4800, label: 'Magnetic flow meter', low: 2400, high: 9500, basis: '2 in (DN50) DN50 Class 150 RF flanged magmeter, PTFE/PFA or hard-rubber liner with 316L electrodes,…', ev: 'sourced' },
  'fe.venturi': { price: 4500, label: 'Venturi tube', low: 1200, high: 9000, basis: '2 in (DN50) classical long-form venturi tube, ASME/ISO 5167-4 profile, fabricated 316SS, Class 150 RF…', ev: 'sourced' },
  'fe.nozzle': { price: 4000, label: 'Flow nozzle', low: 1500, high: 9000, basis: '2 in (DN50) ASME MFC-3M / ISO 5167-3 long-radius flow nozzle, 316SS, welded-in throat with holding ring…', ev: 'sourced' },
  'fe.pd': { price: 3200, label: 'PD meter', low: 700, high: 8000, basis: '2 in (DN50) positive-displacement meter (oval gear / rotary vane / nutating disc), 316SS or…', ev: 'sourced' },
  'fe.rotameter': { price: 3100, label: 'Rotameter', low: 250, high: 5200, basis: '2 in (DN50) Class 150 flanged variable-area meter, 316SS wetted. TWO SCOPES PRICED: (a) armored…', ev: 'sourced' },
  'fe.avgpitot': { price: 2800, label: 'Averaging pitot', low: 1700, high: 6100, basis: '2 in (DN50) line, 316SS averaging-pitot sensor with multiple upstream/downstream ports, threaded or…', ev: 'sourced' },
  'fe.turbine': { price: 1800, label: 'Turbine meter', low: 700, high: 4500, basis: '2 in (DN50) inline axial turbine meter, 316SS body and rotor with tungsten-carbide bearings, wafer or…', ev: 'sourced' },
  'fe.orifice': { price: 1300, label: 'Orifice plate + flanges', low: 350, high: 3500, basis: '2 in (DN50) orifice flange union, ASME B16.36 Class 300 RF weld-neck pair with 1/2 in NPT taps, jack…', ev: 'sourced' },
  'fe.pitot': { price: 600, label: 'Pitot / averaging pitot', low: 120, high: 2500, basis: 'Single-point insertion pitot / pitot-static tube, 316SS, 1/8–3/8 in stem, 6–18 in insertion length,…', ev: 'sourced' },
  'fe.ro': { price: 450, label: 'Restriction orifice', low: 120, high: 9000, basis: '2 in (DN50) 316SS restriction orifice PLATE, non-bevelled, sized for a fixed pressure letdown,…', ev: 'sourced' },

  // --- instrument accessories ---
  'acc.loadcell': { price: 1000, label: 'Load Cell', low: 180, high: 3100, basis: 'Stainless steel compression load cell, 5 t (11,000 lb) rated capacity, IP67/68 welded, ~3 mV/V output,…', ev: 'sourced' },
  'acc.floatcage': { price: 900, label: 'External Float Cage', low: 390, high: 5000, basis: 'External float chamber / cage only: 2 in NPT (or 2 in 150# RF side-side) x 1 in NPT process piping,…', ev: 'sourced' },
  'acc.bulb': { price: 800, label: 'Filled Bulb + Capillary', low: 350, high: 1700, basis: 'Gas-actuated (Class II) filled-system dial thermometer: 4.5-5 in dial, 316SS bulb, ~10 ft armored 316SS…', ev: 'sourced' },
  'acc.lg': { price: 750, label: 'Gauge Glass', low: 110, high: 2600, basis: 'One-section armored flat-glass REFLEX level gauge, ~11.5 in centre-to-centre (about 12 in visible), 1/2…', ev: 'sourced' },
  'acc.radar': { price: 400, label: 'Radar Level Horn', low: 85, high: 1400, basis: 'HORN ONLY: 4 in / DN100 cone antenna with PTFE process seal and flanged process connection, 316L…', ev: 'sourced' },
  'acc.pg': { price: 190, label: 'Pressure Gauge', low: 30, high: 520, basis: '4.5 in (114 mm) dial process gauge, 304SS case / 316SS bourdon and socket, glycerin filled, 1/4 or 1/2…', ev: 'sourced' },
  'acc.seal': { price: 185, label: 'Diaphragm Seal', low: 60, high: 650, basis: 'Threaded diaphragm seal, 1/2 in NPT female process x 1/2 in NPT instrument, all-welded or bolted, 316L…', ev: 'sourced' },
  'acc.afr': { price: 140, label: 'Air Filter Regulator', low: 20, high: 520, basis: '1/4 in NPT instrument-air filter-regulator with output gauge, 0-125 psig output (or 2-60 psig), 250…', ev: 'sourced' },
  'acc.thermowell': { price: 90, label: 'Thermowell', low: 15, high: 460, basis: '316SS threaded thermowell, 3/4 in MNPT process x 1/2 in NPT female instrument connection, straight or…', ev: 'sourced' },
  'acc.bimetal': { price: 85, label: 'Bimetal Thermometer', low: 18, high: 250, basis: '5 in dial industrial bimetal thermometer, 316SS stem 1/4 in dia x 6 in insertion, 1/2 in NPT,…', ev: 'sourced' },
  'acc.siphon': { price: 50, label: 'Gauge Siphon (Pigtail)', low: 10, high: 300, basis: '1/4 in NPT male x 1/4 in NPT female pigtail (coil) gauge siphon, 316SS, ~5.5 in, Schedule 40, steam…', ev: 'sourced' },

  // --- rotating ---
  'comp.centrifugal': { price: 480000, label: 'Centrifugal compressor', low: 250000, high: 5000000, basis: 'Integrally geared multistage centrifugal process compressor, SMALL FRAME, 375 kW (500 hp) absorbed,…', ev: 'sourced' },
  'turbine.steam': { price: 280000, label: 'Steam turbine', low: 80000, high: 8500000, basis: '500 kW class steam turbine, backpressure / single-stage, ~500 psig / 550 F inlet to 50 psig exhaust,…', ev: 'sourced' },
  'comp.recip': { price: 60000, label: 'Reciprocating compressor', low: 2000, high: 1500000, basis: 'TWO cases. (a) Priced as typical: industrial two-stage lubricated reciprocating AIR compressor, 75 kW…', ev: 'sourced' },
  'comp.screw': { price: 54000, label: 'Screw compressor', low: 12000, high: 95000, basis: '75 kW (100 hp) fixed-speed oil-injected rotary screw air compressor package, base mount, 125 psig, 481…', ev: 'sourced' },
  agitator: { price: 18000, label: 'Agitator', low: 4100, high: 60000, basis: 'Top-entry gear-drive agitator, 7.5 kW (10 hp), ~10 m3 (2,500 gal) vessel, ASME flange mount with single…', ev: 'sourced' },
  blower: { price: 16000, label: 'Blower', low: 3100, high: 60000, basis: 'Rotary positive-displacement (tri-lobe) blower, ~1,000 m3/h (600 icfm) at 0.5 barg / 7 psid, 15-22 kW…', ev: 'sourced' },
  'pump.peristaltic': { price: 12000, label: 'Peristaltic pump', low: 400, high: 40000, basis: 'Industrial hose (peristaltic) pump, 25 mm / 1 in hose, ~8-15 gpm at 7 barg, cast iron pump body,…', ev: 'sourced' },
  motor: { price: 11000, label: 'Electric motor', low: 600, high: 60000, basis: '75 kW (100 hp), 1,800 rpm, TEFC, NEMA Premium efficiency, 460 V 3-phase, 405T cast-iron frame, foot…', ev: 'sourced' },
  'pump.centrifugal': { price: 9500, label: 'Centrifugal pump', low: 3000, high: 28000, basis: 'ANSI/ASME B73.1 horizontal end-suction process pump, 2x3-8 hydraulic end, 100 gpm @ 150 ft TDH (~7.5-10…', ev: 'sourced' },
  'pump.plunger': { price: 9000, label: 'Plunger pump', low: 900, high: 45000, basis: 'Triplex plunger pump, 10 gpm at 1,500 psi (~9 kW hydraulic, 12-15 hp motor), crankcase-driven, bare…', ev: 'sourced' },
  'pump.vacuum': { price: 8000, label: 'Vacuum pump', low: 1000, high: 26000, basis: 'Single-stage liquid-ring vacuum pump, 150 cfm (255 m3/h) at 25 in Hg, cast iron body with bronze/CI…', ev: 'sourced' },
  vfd: { price: 6500, label: 'VFD', low: 300, high: 20000, basis: '75 kW (100 hp), 380-480 V 3-phase, IP20 / open-chassis general-purpose variable frequency drive, V/Hz…', ev: 'sourced' },
  'pump.submersible': { price: 5200, label: 'Submersible pump', low: 1400, high: 14000, basis: '5 hp (3.7 kW), 3 in discharge, 460 V 3-phase submersible sewage/dewatering pump, cast iron casing and…', ev: 'sourced' },
  'pump.diaphragm': { price: 3800, label: 'Diaphragm pump', low: 350, high: 13000, basis: 'TWO distinct items. (a) AODD: 2 in air-operated double-diaphragm pump, bolted, ~150-180 gpm max, PTFE…', ev: 'sourced' },
  fan: { price: 2400, label: 'Fan', low: 1000, high: 25000, basis: '24 in tube-axial fan with motor and V-belt drive package, ~9,000 cfm (15,000 m3/h) at low static…', ev: 'sourced' },
  ejector: { price: 1800, label: 'Ejector / eductor', low: 60, high: 12000, basis: '2 in liquid-jet eductor or single-stage steam-jet ejector, cast iron or bronze body, NPT or 150#…', ev: 'sourced' },
  'pump.gear': { price: 1500, label: 'PD pump (gear/screw)', low: 700, high: 13000, basis: 'Internal gear pump (Viking-class), 1-1.5 in NPT ports, 20 gpm at 100 psi differential, cast iron casing…', ev: 'sourced' },

  // --- vessels ---
  'vessel.sphere': { price: 1400000, label: 'Sphere', low: 450000, high: 3000000, basis: '1,500 m3 LPG Horton sphere, ~14.2 m dia, carbon steel SA-537 Cl.1, design pressure 1.77 MPa (17.7…', ev: 'sourced' },
  'vessel.floating-roof': { price: 1300000, label: 'Floating-roof tank', low: 650000, high: 2200000, basis: '5,000 m3 / ~31,450 bbl external floating-roof tank, API 650 App. C, ~22 m dia x 14 m high, carbon…', ev: 'sourced' },
  'vessel.column-packed': { price: 295000, label: 'Packed column', low: 90000, high: 700000, basis: 'Same shell as the tray column: 1.5 m ID x 20 m T-T CS, 12 mm wall, design 5 barg, skirt, 4 manways,…', ev: 'sourced' },
  'vessel.column-tray': { price: 230000, label: 'Trayed column', low: 75000, high: 650000, basis: '1.5 m ID x 20 m T-T carbon steel column, 20 valve trays at 0.6 m spacing (CS trays and downcomers),…', ev: 'sourced' },
  'vessel.cstr': { price: 200000, label: 'Stirred reactor', low: 30000, high: 420000, basis: '5 m3 (1,320 US gal) jacketed agitated reactor, SS316L wetted parts, CS jacket, ASME VIII Div 1, 10 barg…', ev: 'sourced' },
  'vessel.fixedbed': { price: 175000, label: 'Fixed-bed reactor', low: 60000, high: 700000, basis: 'Fixed-bed catalytic reactor sized for 5 m3 of catalyst: 1.5 m ID x ~4 m bed depth (5.5 m T-T), carbon…', ev: 'sourced' },
  'vessel.bullet': { price: 150000, label: 'Bullet', low: 45000, high: 330000, basis: '100 m3 / ~26,400 US gal horizontal ASME LPG bullet, ~2.8 m dia x 16 m OAL, carbon steel SA-612, design…', ev: 'sourced' },
  'vessel.sep3': { price: 125000, label: '3-phase separator', low: 40000, high: 450000, basis: 'Horizontal 3-phase (oil/water/gas) separator, 2.0 m ID x 6.0 m S/S, carbon steel SA-516-70, design 10…', ev: 'sourced' },
  'vessel.tank': { price: 80000, label: 'Storage tank', low: 45000, high: 260000, basis: '100 m3 / ~26,400 US gal vertical atmospheric storage tank, API 650, fixed cone roof, flat bottom, ~5.0…', ev: 'sourced' },
  'vessel.vertical': { price: 62000, label: 'Vertical vessel', low: 18000, high: 130000, basis: '10 m3 vertical pressure vessel, 1.8 m ID x 4.0 m T-T, carbon steel SA-516-70, design 10 barg / 165 psig…', ev: 'sourced' },
  'vessel.horizontal': { price: 55000, label: 'Horizontal vessel', low: 16000, high: 115000, basis: '10 m3 horizontal pressure vessel, 1.8 m ID x 4.0 m T-T, carbon steel SA-516-70, design 10 barg / 165…', ev: 'sourced' },
  'vessel.ko-drum': { price: 55000, label: 'KO drum', low: 18000, high: 130000, basis: '5 m3 knock-out drum, 1.4 m ID x 3.3 m T-T, carbon steel SA-516-70, design 10 barg / 165 psig, ASME VIII…', ev: 'sourced' },
  'vessel.silo': { price: 31000, label: 'Silo', low: 12000, high: 75000, basis: '50 m3 / 1,766 ft3 carbon steel silo, ~3.0 m dia cylinder with 60-degree cone bottom, ~5 mm plate,…', ev: 'sourced' },
  'vessel.open': { price: 14000, label: 'Open tank', low: 3500, high: 38000, basis: '10 m3 open-top vertical tank, ~2.2 m dia x 2.7 m high, carbon steel A36, 6 mm shell and bottom, no…', ev: 'sourced' },
  cyclone: { price: 9900, label: 'Cyclone', low: 2500, high: 45000, basis: 'Single gas-solid reverse-flow cyclone, 5,000 m3/h (~2,950 acfm) at near-ambient conditions,…', ev: 'sourced' },

  // --- heat transfer ---
  'heater.fired': { price: 2400000, label: 'Fired heater', low: 600000, high: 12000000, basis: '10 MW (34 MMBtu/hr) absorbed duty, vertical cylindrical process heater, CS tube coil, natural-gas…', ev: 'sourced' },
  'cooling-tower': { price: 680000, label: 'Cooling tower', low: 180000, high: 2500000, basis: '10 MW heat rejection (approx 2,300 nominal CT tons, 2,000 m3/h at 5 degC range), induced-draft…', ev: 'sourced' },
  'hx.air-cooler': { price: 125000, label: 'Air cooler', low: 45000, high: 480000, basis: '200 m2 bare-tube area (approx 2,400 m2 extended/finned), 2 bays, CS tubes with aluminium fins, 2 x 15…', ev: 'sourced' },
  'hx.kettle': { price: 76000, label: 'Kettle reboiler', low: 30000, high: 320000, basis: '100 m2 U-tube kettle reboiler, CS shell / CS tubes, TEMA BKU, 10 barg shell-side steam / 10 barg…', ev: 'sourced' },
  'hx.condenser': { price: 66000, label: 'Condenser', low: 25000, high: 290000, basis: '120 m2 shell-and-tube overhead condenser, TEMA BEM, CS shell / CS tubes, cooling water in tubes at 6…', ev: 'sourced' },
  'hx.shell-tube': { price: 58000, label: 'Shell & tube exchanger', low: 22000, high: 260000, basis: '100 m2 effective surface, TEMA BEM fixed-tubesheet, CS shell / CS tubes, 150 psig / 10 barg both sides,…', ev: 'sourced' },
  'hx.plate': { price: 33000, label: 'Plate exchanger', low: 14000, high: 95000, basis: '100 m2 gasketed plate-and-frame, 0.5 mm 316SS plates, NBR gaskets, painted CS frame, 10 barg / 150…', ev: 'sourced' },
  'hx.doublepipe': { price: 19000, label: 'Double-pipe exchanger', low: 7000, high: 55000, basis: '15 m2 multitube hairpin, CS shell / CS inner tubes, 2 x 6 m hairpin sections, 40 barg tube side / 10…', ev: 'sourced' },
  'heater.electric': { price: 11000, label: 'Electric heater', low: 3500, high: 180000, basis: '36 kW flanged circulation heater, 316SS wetted (sheath and vessel), DN80 150# flanges, Incoloy-800…', ev: 'sourced' },
  'hx.coil': { price: 8000, label: 'Heating/cooling coil', low: 2500, high: 30000, basis: '8 m2 helical immersion coil, 316SS Sch 10 DN50 pipe, ~50 m developed length, 10 barg steam or cooling…', ev: 'sourced' },

  // --- inline fittings, strainers & traps ---
  'fit.rupture-pin': { price: 3500, label: 'Rupture Pin Valve', low: 1500, high: 9000, basis: '2 in (DN50) Class 150 flanged rupture-pin relief valve, 316SS trim, buckling-pin actuated…', ev: 'est' },
  'fit.trap-float': { price: 3200, label: 'Float Steam Trap', low: 700, high: 6000, basis: '2 in (DN50) Class 150 flanged float & thermostatic trap, ductile-iron body, 200 psig (Spirax FT14-14HC…', ev: 'sourced' },
  'fit.silencer': { price: 2500, label: 'Silencer', low: 800, high: 15000, basis: '2 in inlet steam vent / blowdown silencer, carbon steel shell with SS internals and absorptive/diffuser…', ev: 'sourced' },
  'fit.hose-station': { price: 1800, label: 'Utility Hose Station', low: 700, high: 5000, basis: 'Wall-mounted 3-service utility station: steam and cold-water mixing (thermostatic or manual mixer),…', ev: 'est' },
  'fit.trap-bucket': { price: 1500, label: 'Inverted Bucket Trap', low: 180, high: 3500, basis: '2 in NPT/flanged inverted bucket trap, cast iron body with integral strainer, 150-250 psig (Armstrong…', ev: 'sourced' },
  'sample.cooler': { price: 1500, label: 'Sample Cooler', low: 800, high: 6000, basis: 'Shell-and-coil sample cooler, 316SS coil and shell, ~2-4 kW duty (boiler/steam sample service, 1/2 in…', ev: 'sourced' },
  'fit.pulsation-dampener': { price: 1400, label: 'Pulsation Dampener', low: 400, high: 5000, basis: '316SS bladder/diaphragm pulsation dampener, ~1-2 gallon (4-8 litre) volume, PTFE diaphragm, 1-2 in…', ev: 'sourced' },
  'mixer.static': { price: 1100, label: 'Static Mixer', low: 250, high: 3500, basis: '2 in (DN50) Sch 40 316/316L stainless static mixer, 6 helical elements, Class 150 flanged ends (Koflo…', ev: 'sourced' },
  'fit.exhaust-head': { price: 1000, label: 'Exhaust Head', low: 400, high: 3200, basis: '2 in NPT cast-iron exhaust head with SS separating internals and drain connection (Watson McDaniel…', ev: 'sourced' },
  'fit.sightglass': { price: 850, label: 'Sight Glass', low: 250, high: 2500, basis: '2 in (DN50) Class 150 flanged inline sight flow indicator, 316SS body, double-window with flapper or…', ev: 'sourced' },
  'strainer.basket': { price: 800, label: 'Basket Strainer', low: 450, high: 2500, basis: '2 in (DN50) Class 150 flanged simplex basket strainer, carbon steel body, SS basket, bolted cover', ev: 'sourced' },
  'fit.trap-thermo': { price: 700, label: 'Thermodynamic Trap', low: 250, high: 1500, basis: '1/2 in NPT all-stainless thermodynamic disc trap (Spirax TD42 class) — TD traps are inherently…', ev: 'sourced' },
  'filter.cartridge': { price: 600, label: 'Filter', low: 250, high: 6000, basis: 'Single-cartridge 10 in length 316SS liquid filter housing, 300 psi, 1-2 in NPT/flanged connections;…', ev: 'sourced' },
  'fit.coupling': { price: 600, label: 'Quick Coupling', low: 60, high: 2200, basis: '2 in dry-disconnect (dry-break) coupler x 2 in female NPT, 150 psi — aluminium for the low case, 316SS…', ev: 'sourced' },
  demister: { price: 550, label: 'Demister Pad', low: 250, high: 1600, basis: 'Knitted 316SS wire-mesh mist eliminator pad, ~100 mm (4 in) thick, standard density ~145 kg/m3, with…', ev: 'sourced' },
  'fit.steam-trap': { price: 450, label: 'Steam Trap', low: 120, high: 3500, basis: 'Generic process steam trap, 3/4 in NPT, stainless or cast-iron body, up to ~150 psig — the size…', ev: 'sourced' },
  'fit.mixing-tee': { price: 450, label: 'Mixing Tee', low: 120, high: 1800, basis: '2 in (DN50) Class 150 flanged mixing tee, 316SS body with an internal injection nozzle/insert on the…', ev: 'est' },
  'strainer.y': { price: 400, label: 'Y-Strainer', low: 120, high: 1200, basis: '2 in (DN50) Class 150 flanged, A216 WCB carbon steel body, 316SS perforated screen', ev: 'sourced' },
  'fit.expansion': { price: 400, label: 'Expansion Joint', low: 120, high: 2500, basis: 'BOTH given at 2 in (DN50) Class 150 flanged: (a) twin-sphere rubber joint, EPDM/neoprene, 150 psi; (b)…', ev: 'sourced' },
  'fit.sample': { price: 350, label: 'Sample Point', low: 120, high: 1200, basis: '3/4 in 316SS sample connection off a 2 in line: nipple + 316SS ball valve + needle throttling valve +…', ev: 'est' },
  'fit.quill': { price: 350, label: 'Injection Quill', low: 150, high: 1600, basis: '1/2 in NPT 316SS injection quill with integral check valve, ~8-12 in insertion length, 3,000 psi body…', ev: 'sourced' },
  'fit.hose': { price: 320, label: 'Hose', low: 90, high: 900, basis: '2 in ID x 3 ft (0.9 m) overall length T316L stainless corrugated hose with 300-series SS braid,…', ev: 'sourced' },
  'fit.drain': { price: 220, label: 'Drain', low: 90, high: 700, basis: '1 in valved drain off a 2 in line: 1 in CS/316SS nipple + 1 in ball or gate valve + plug/cap, threaded', ev: 'est' },
  'fit.funnel': { price: 200, label: 'Drain Funnel (Tundish)', low: 80, high: 600, basis: '304/316SS drain tundish, ~4-6 in bowl with 2 in outlet, bracket-mounted, open-to-atmosphere', ev: 'est' },
  'fit.vent': { price: 180, label: 'Vent', low: 70, high: 600, basis: '3/4 in valved vent off a 2 in line: 3/4 in nipple + 3/4 in CS/316SS ball valve + plug, threaded', ev: 'est' },
  'fit.spectacle': { price: 130, label: 'Spectacle Blind', low: 60, high: 400, basis: '2 in Class 150 ASME B16.48 spectacle blind, A516 Gr 70 carbon steel, with handle, painted', ev: 'sourced' },
  'strainer.cone': { price: 120, label: 'Temporary Cone Strainer', low: 45, high: 350, basis: '2 in (DN50) Class 150 temporary conical (witch-hat) strainer, CS ring with 316SS mesh over perforated…', ev: 'est' },
  'fit.spade': { price: 95, label: 'Spade / Spacer', low: 45, high: 300, basis: '2 in Class 150 ASME B16.48 paddle blank (spade) plus matching ring spacer, A516 Gr 70 carbon steel,…', ev: 'sourced' },
  'fit.flanges': { price: 65, label: 'Flange Pair', low: 35, high: 220, basis: 'One 2 in Class 150 RF joint: 2 x A105 CS weld-neck flanges + 1 x 1/16 in spiral-wound 316/graphite…', ev: 'sourced' },
  'fit.junction': { price: 30, label: 'Branch Junction', low: 12, high: 220, basis: '2 in (DN50) Sch 40 butt-weld equal tee, A234 WPB carbon steel; flanged 150# CS tee quoted as the high…', ev: 'sourced' },
  'fit.union': { price: 30, label: 'Union', low: 12, high: 120, basis: '2 in Class 3000 threaded union, A105 carbon steel, integral seat', ev: 'sourced' },
  'fit.blind': { price: 28, label: 'Blind Flange', low: 16, high: 90, basis: '2 in Class 150 RF blind flange, A105 carbon steel (gasket and bolts not included)', ev: 'sourced' },
  'fit.reducer-ecc': { price: 22, label: 'Eccentric Reducer', low: 10, high: 110, basis: '2 in x 1 in Sch 40 butt-weld eccentric reducer, A234 WPB carbon steel', ev: 'sourced' },
  'fit.reducer': { price: 18, label: 'Reducer', low: 8, high: 90, basis: '2 in x 1 in Sch 40 butt-weld concentric reducer, A234 WPB carbon steel', ev: 'sourced' },
  'fit.specbreak': { price: 0, label: 'Spec Break', low: 0, high: 0, basis: 'DRAWING SYMBOL ONLY — no hardware', ev: 'est' },

  // --- solids handling & separation ---
  crystallizer: { price: 700000, label: 'Crystallizer', low: 100000, high: 4000000, basis: 'Continuous forced-circulation vacuum crystallizer, ~5 t/h crystal product, 316SS body ~3 m dia, incl.…', ev: 'sourced' },
  'dryer.rotary': { price: 600000, label: 'Rotary Dryer', low: 80000, high: 2500000, basis: 'Direct co-current rotary drum dryer, 1.8 m dia x 12 m long, ~1,500 kg/h water evaporation, CS shell…', ev: 'sourced' },
  'mill.ball': { price: 500000, label: 'Ball Mill', low: 80000, high: 3000000, basis: 'Wet overflow ball mill, ~2.6 m dia x 4.0 m EGL, 20 t/h ore feed, ~600 kW ring-gear drive, incl. shell,…', ev: 'sourced' },
  evaporator: { price: 400000, label: 'Evaporator', low: 60000, high: 2500000, basis: 'Single-effect falling-film evaporator, 100 m2 heat-transfer area, 316SS tubes and shell, ~4,000 kg/h…', ev: 'sourced' },
  clarifier: { price: 350000, label: 'Clarifier / Thickener', low: 60000, high: 1500000, basis: '20 m diameter circular centre-drive clarifier/thickener MECHANISM: half-bridge, drive head with torque…', ev: 'sourced' },
  'dryer.spray': { price: 350000, label: 'Spray Dryer', low: 40000, high: 3000000, basis: 'Co-current spray dryer, ~100 kg/h water evaporation, 316SS product contact, rotary-atomiser or…', ev: 'sourced' },
  centrifuge: { price: 280000, label: 'Centrifuge', low: 30000, high: 900000, basis: 'BOTH priced at ~10 m3/h feed, 316SS wetted, skid-mounted with drive and control panel, ex-works. (a)…', ev: 'sourced' },
  'filter.rotary': { price: 250000, label: 'Rotary Drum Filter', low: 50000, high: 900000, basis: 'Rotary drum vacuum filter, 20 m2 filtration area (~2.4 m dia x 2.7 m face), 316SS drum and trough,…', ev: 'sourced' },
  extruder: { price: 250000, label: 'Extruder', low: 25000, high: 1100000, basis: 'Co-rotating intermeshing TWIN-screw extruder, ~500 kg/h, 50–60 mm screw dia, L/D 40, segmented barrels…', ev: 'sourced' },
  crusher: { price: 180000, label: 'Crusher / Mill', low: 25000, high: 800000, basis: 'Primary single-toggle jaw crusher, 50 t/h at 100 mm CSS, ~600 x 400 mm feed opening, 45 kW drive,…', ev: 'sourced' },
  'filter.press': { price: 110000, label: 'Filter Press', low: 15000, high: 500000, basis: 'Overhead-beam automatic filter press, 1000 x 1000 mm plates, 50 m2 filtration area, ~700 L cake volume,…', ev: 'sourced' },
  scrubber: { price: 95000, label: 'Scrubber', low: 15000, high: 600000, basis: 'Vertical counter-current packed-bed wet scrubber, 17,000 m3/h (~10,000 acfm), ~1.8 m dia x 6 m tall…', ev: 'sourced' },
  'screen.vibrating': { price: 85000, label: 'Vibrating Screen', low: 6000, high: 250000, basis: 'Inclined circular-motion 2-deck vibrating screen, 1.8 m x 4.9 m deck (~8.8 m2 per deck), ~150 t/h…', ev: 'sourced' },
  'blender.ribbon': { price: 75000, label: 'Ribbon Blender', low: 12000, high: 350000, basis: 'Horizontal double-ribbon blender, 2.8 m3 (100 ft3) working volume, ~1.2 m x 3.7 m U-trough, 304SS…', ev: 'sourced' },
  bagfilter: { price: 70000, label: 'Bag House', low: 20000, high: 500000, basis: 'Pulse-jet reverse-air baghouse, 17,000 m3/h (~10,000 acfm) at 0.5 bar, ~230 m2 of filter cloth…', ev: 'sourced' },
  coalescer: { price: 65000, label: 'Coalescer', low: 6000, high: 350000, basis: 'Vertical liquid/liquid cartridge coalescer, ~30 m3/h (~130 gpm), 9–13 element ASME Sec VIII CS vessel…', ev: 'sourced' },
  'bucket-elevator': { price: 55000, label: 'Bucket Elevator', low: 8000, high: 200000, basis: 'Centrifugal-discharge belt-and-bucket elevator, 15 m lift height, 30 t/h dry granular solids, carbon…', ev: 'sourced' },
  'dryer.tray': { price: 40000, label: 'Tray Dryer', low: 8000, high: 250000, basis: 'Batch tray (truck-and-tray) cabinet dryer, 48 trays of ~0.1 m2 (~5 m2 total tray area), 2 trolleys,…', ev: 'sourced' },
  'conveyor.belt': { price: 36000, label: 'Belt Conveyor', low: 12000, high: 90000, basis: '20 m centres x 600 mm troughed belt conveyor, carbon steel frame and stringers, 3-roll idlers, EP-250…', ev: 'sourced' },
  'conveyor.screw': { price: 14000, label: 'Screw Conveyor', low: 4000, high: 45000, basis: '9 in (230 mm) dia CDDP-style carbon-steel trough screw conveyor, 6 m long, sealed ends, 4 kW…', ev: 'sourced' },
  hydrocyclone: { price: 9000, label: 'Hydrocyclone', low: 600, high: 150000, basis: 'SINGLE unit: 250 mm (10 in) dia hydrocyclone, ~100 m3/h feed at 1.5 bar, CS/GRP body with replaceable…', ev: 'sourced' },
  'feeder.rotary': { price: 6500, label: 'Rotary Feeder', low: 2000, high: 30000, basis: '10 in (250 mm) square-flanged drop-through rotary airlock, cast-iron housing, 8-vane closed rotor,…', ev: 'sourced' },

  // --- utility packages & electrical ---
  flare: { price: 750000, label: 'Flare', low: 250000, high: 3500000, basis: 'Elevated self-supported/derrick flare, 35 m stack, 24 in riser, 50 t/h relief capacity, smokeless…', ev: 'est' },
  boiler: { price: 300000, label: 'Boiler', low: 110000, high: 950000, basis: '10 t/h (approx 22,000 lb/hr, 640 BHP) 4-pass wetback packaged firetube, 10 barg / 150 psig design,…', ev: 'sourced' },
  'package-unit': { price: 280000, label: 'Package unit', low: 40000, high: 2500000, basis: 'PLACEHOLDER SYMBOL — a vendor-supplied, shop-assembled skid delivered as one purchase order with its…', ev: 'est' },
  stack: { price: 180000, label: 'Stack', low: 45000, high: 900000, basis: '30 m self-supporting CS stack, 1.2 m internal diameter, 8 mm shell, unlined (no refractory), flanged…', ev: 'est' },
  'elec.mcc': { price: 104000, label: 'MCC', low: 44000, high: 520000, basis: '480 V 3ph 65 kA NEMA 1 gasketed indoor MCC lineup, 1600 A horizontal bus, ~20 vertical sections with…', ev: 'sourced' },
  deaerator: { price: 95000, label: 'Deaerator', low: 35000, high: 320000, basis: '20 t/h (approx 44,000 lb/hr) spray-tray deaerator, CS pressure vessel with 316SS spray valves and…', ev: 'sourced' },
  chiller: { price: 85000, label: 'Chiller', low: 45000, high: 175000, basis: '100 ton (352 kW) air-cooled packaged process chiller, scroll compressors, R-454B, integral pump and…', ev: 'sourced' },
  'elec.transformer': { price: 70000, label: 'Transformer', low: 18000, high: 190000, basis: '1000 kVA, 13.8 kV delta / 480-277 V wye, three-phase oil-filled pad-mount (dead-front, loop-feed), 65…', ev: 'sourced' },
  'filter-sep': { price: 32000, label: 'Filter separator', low: 9000, high: 140000, basis: 'DN150 (6 in) horizontal two-stage gas filter separator, 1,000 m3/h at 20 barg, CS ASME Section VIII Div…', ev: 'est' },
  'elec.ups': { price: 16000, label: 'UPS', low: 9100, high: 75000, basis: '20 kVA / 18 kW three-phase online double-conversion UPS, 480 V in / 208 V out (or 400 V), 30-minute…', ev: 'sourced' },
  'air-dryer': { price: 11000, label: 'Air dryer', low: 2700, high: 38000, basis: '200 scfm (340 Nm3/h) heatless twin-tower regenerative desiccant dryer, -40 degC pressure dewpoint, 10…', ev: 'sourced' },
  'elec.barrier': { price: 300, label: 'IS barrier', low: 150, high: 620, basis: 'One channel of a DIN-rail intrinsically safe isolating barrier for a 4-20 mA HART loop with 24 V DC…', ev: 'sourced' },

  // --- control hardware (logic symbols carry no hardware cost) ---
  'ctl.dcs': { price: 450000, label: 'DCS', low: 250000, high: 1100000, basis: '500 I/O distributed control system, ~350 AI/AO 4-20 mA HART plus ~150 DI/DO, redundant controllers and…', ev: 'sourced' },
  'ctl.sis': { price: 260000, label: 'SIS', low: 85000, high: 700000, basis: '100 I/O SIL 3 capable safety instrumented system: TUV-certified triple-modular-redundant or 1oo2D logic…', ev: 'sourced' },
  'ctl.plc': { price: 24000, label: 'PLC System', low: 5500, high: 90000, basis: 'Mid-range PLC control system, 128 I/O (approx 64 DI, 32 DO, 24 AI, 8 AO), single non-redundant…', ev: 'sourced' },
  'ctl.panel': { price: 4500, label: 'Local Panel', low: 1200, high: 40000, basis: 'Local control panel, 800 x 600 x 250 mm painted steel IP55 wall-mounted enclosure, non-hazardous area,…', ev: 'est' },
  'ctl.jb': { price: 1104, label: 'Junction Box', low: 600, high: 2640, basis: 'Field junction box, Ex e increased safety, 316L stainless steel enclosure approx 300 x 400 x 150 mm,…', ev: 'sourced' },
  'ctl.interlock': { price: 0, label: 'Interlock', low: 0, high: 0, basis: 'NOT HARDWARE — a P&ID/logic-diagram symbol denoting an interlock relationship (typically an ISA-5.2…', ev: 'est' },
  'logic.and': { price: 0, label: 'AND Gate', low: 0, high: 0, basis: 'NOT HARDWARE — an ISA-5.2 binary logic symbol on a logic diagram. No purchase order, no FOB price.…', ev: 'est' },
  'logic.or': { price: 0, label: 'OR Gate', low: 0, high: 0, basis: 'NOT HARDWARE — an ISA-5.2 binary logic symbol on a logic diagram. No purchase order, no FOB price.…', ev: 'est' },
  'logic.not': { price: 0, label: 'NOT Gate', low: 0, high: 0, basis: 'NOT HARDWARE — an ISA-5.2 binary logic symbol (signal inversion) on a logic diagram. No purchase order,…', ev: 'est' },

  // --- category fallbacks: median of the researched prices in each category.
  //     Only reached by custom/imported symbols now that every library symbol
  //     has an exact entry above. cat.inline is bimodal (a $18 reducer and a
  //     $700k crystallizer share the category), so treat it as a placeholder. ---
  'cat.accessories': { price: 190, label: 'Instrument accessory' },
  'cat.control': { price: 1104, label: 'Control hardware' },
  'cat.control-valves': { price: 7200, label: 'Control valve (other)' },
  'cat.flow-elements': { price: 3600, label: 'Flow element (other)' },
  'cat.heat': { price: 62000, label: 'Heat transfer (other)' },
  'cat.inline': { price: 3200, label: 'Fitting / inline item' },
  'cat.instruments': { price: 500, label: 'Instrument (other)' },
  'cat.rotating': { price: 9500, label: 'Rotating equipment (other)' },
  'cat.safety': { price: 3300, label: 'Safety device (other)' },
  'cat.valves': { price: 500, label: 'Valve (other)' },
  'cat.vessels': { price: 125000, label: 'Vessel (other)' },
  'cat.custom': { price: 1000, label: 'Custom symbol' },
}

/** ISA-letter classification for the generic instrument bubble. */
function instrumentKey(letters: string): string {
  if (letters.startsWith('A')) return 'instr.analyzer'
  if (/S[HL]*$/.test(letters) && letters.length > 1) return 'instr.switch'
  if (letters.endsWith('Y')) return 'instr.converter'
  if (letters.includes('C') && !letters.endsWith('V')) return 'instr.controller'
  if (letters.endsWith('T')) return 'instr.transmitter'
  if (letters.endsWith('R')) return 'instr.recorder'
  if (letters.endsWith('E')) return 'instr.element'
  if (letters.endsWith('I') || letters.endsWith('G')) return 'instr.indicator'
  return 'instr.generic'
}

/** The pricing bucket a node belongs to. Annotations cost nothing. */
export function priceKeyFor(node: PlantNode): string | null {
  if (node.kind === 'annotation') return null
  if (node.kind === 'instrument') {
    const letters = node.tag?.letters ?? ''
    if (node.symbolId === 'instr.bubble' || /^[A-Z]{1,4}$/.test(letters)) {
      return letters ? instrumentKey(letters) : 'instr.generic'
    }
  }
  if (DEFAULT_PRICES[node.symbolId]) return node.symbolId
  try {
    return `cat.${getSymbol(node.symbolId).category}`
  } catch {
    return 'cat.custom'
  }
}

/** Unit price: per-node exact cost → project override → default table. */
export function unitCost(node: PlantNode, budget?: BudgetSettings): number {
  if (typeof node.cost === 'number' && Number.isFinite(node.cost)) return node.cost
  const key = priceKeyFor(node)
  if (key === null) return 0
  const override = budget?.overrides?.[key]
  if (typeof override === 'number' && Number.isFinite(override)) return override
  return DEFAULT_PRICES[key]?.price ?? 0
}

export interface CostLine {
  key: string
  label: string
  count: number
  unit: number
  subtotal: number
}
export interface CostReport {
  /** Hardware subtotal (no factor). */
  hardware: number
  /** hardware × installFactor. */
  total: number
  lines: CostLine[]
  /** Nodes with no price anywhere (excluded annotations don't count). */
  unpriced: number
}

/** Whole-project estimate across every sheet, grouped by price bucket.
 *  Nodes with a per-node cost group under their bucket at their own price
 *  (mixed prices in one bucket show the summed subtotal; unit = '—' case
 *  is handled by the dialog). */
/** One estimate per document, however often the toolbar chip re-renders. The
 *  chip watches `doc`, and `touched()` mints a new one on every edit, so
 *  without this the whole project was re-priced on every keystroke and every
 *  symbol move. Same shape as the QA cache in validate/engine.ts. */
let cache: { doc: ProjectDoc; value: CostReport } | null = null

export function projectCost(doc: ProjectDoc): CostReport {
  if (cache && cache.doc === doc) return cache.value
  const value = computeProjectCost(doc)
  cache = { doc, value }
  return value
}

function computeProjectCost(doc: ProjectDoc): CostReport {
  const budget = doc.budget
  const byKey = new Map<string, CostLine>()
  let unpriced = 0
  for (const sheet of doc.sheets) {
    for (const node of sheet.nodes) {
      const key = priceKeyFor(node)
      if (key === null) continue
      const cost = unitCost(node, budget)
      if (cost === 0 && node.cost === undefined) unpriced++
      const entry = DEFAULT_PRICES[key]
      const line = byKey.get(key) ?? {
        key,
        label: entry?.label ?? key,
        count: 0,
        unit: budget?.overrides?.[key] ?? entry?.price ?? 0,
        subtotal: 0,
      }
      line.count++
      line.subtotal += cost
      byKey.set(key, line)
    }
  }
  const lines = [...byKey.values()].sort((a, b) => b.subtotal - a.subtotal)
  const hardware = lines.reduce((s, l) => s + l.subtotal, 0)
  const factor = budget?.installFactor ?? 1
  return { hardware, total: hardware * factor, lines, unpriced }
}

/** Compact money formatting for the status bar: 12400 -> "12.4k". */
export function fmtMoney(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`
  if (v >= 1e4) return `${(v / 1e3).toFixed(0)}k`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(Math.round(v))
}
