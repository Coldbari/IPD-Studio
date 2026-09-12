// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { TAGGING_RULES } from './tagging'
import { TOPOLOGY_RULES } from './topology'
import { INSTRUMENTATION_RULES } from './instrumentation'
import { PROCESS_RULES } from './process'
import { DATA_RULES } from './data'
import { STANDARD_RULES } from './standard'
import { SIGNAL_RULES } from './signal'
import { HIERARCHY_RULES } from './hierarchy'

/** Every check the engine runs. Order here is irrelevant — the report sorts by
 *  severity, then discipline, then title. */
export const ALL_RULES: Rule[] = [
  ...TAGGING_RULES,
  ...TOPOLOGY_RULES,
  ...INSTRUMENTATION_RULES,
  ...PROCESS_RULES,
  ...DATA_RULES,
  ...STANDARD_RULES,
  ...SIGNAL_RULES,
  ...HIERARCHY_RULES,
]

export const RULES_BY_ID: Record<string, Rule> = Object.fromEntries(ALL_RULES.map((r) => [r.id, r]))
