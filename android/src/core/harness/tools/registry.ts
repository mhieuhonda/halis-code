export { ToolRegistry } from './index'
export type { ToolContext, ToolDef, ToolResult } from './index'

import { ToolRegistry } from './index'
import { taskBoardTools } from './taskboard'
import { telegraphTools } from './telegraph'
import { swarmTools } from './swarm'
import { webTools } from './web'
import { todoTools } from './todo'
import { questionTools } from './question'
import { scheduleTools } from './schedule-tools'
import { delegateTools } from './delegate'

/**
 * The Android toolset: everything the phone is allowed to do.
 * No file writes, no terminal, no git — those desktop surfaces simply do
 * not exist here. Research, coordination, reminders and paid intelligence
 * are all present, matching the desktop feature-for-feature within that
 * boundary.
 */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  const all = [
    ...taskBoardTools,
    ...telegraphTools,
    ...swarmTools,
    ...webTools,
    ...todoTools,
    ...questionTools,
    ...scheduleTools,
    ...delegateTools,
  ]
  for (const tool of all) {
    registry.register(tool)
  }
  return registry
}
