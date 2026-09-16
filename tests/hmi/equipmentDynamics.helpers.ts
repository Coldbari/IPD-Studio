// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/** Re-exports so the K11 tests read the SAME constants the model states,
 *  rather than copies of them. */
export { SHUT_LEAK_MAX, solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
export { valveResistance as valveResistanceOf } from '../../src/hmi/sim/hydraulic/model'
