export { ToolRegistry } from './index'
export type { ToolContext, ToolDef, ToolResult } from './index'

import { ToolRegistry } from './index'
import { fileTools } from './fs'
import { searchTools } from './search'
import { bashTools } from './bash'
import { taskBoardTools } from './taskboard'
import { telegraphTools } from './telegraph'
import { swarmTools } from './swarm'
import { webTools } from './web'
import { todoTools } from './todo'
import { questionTools } from './question'
import { jobTools } from './job-tools'
import { scheduleTools } from './schedule-tools'
import { gitTools } from './git'
import { delegateTools } from './delegate'
import { skillTools } from './skill-tool'
import { patchTools } from './patch-tool'

/** The standard Halis Code toolset. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  const all = [
    ...fileTools,
    ...searchTools,
    ...bashTools,
    ...taskBoardTools,
    ...telegraphTools,
    ...swarmTools,
    ...webTools,
    ...todoTools,
    ...questionTools,
    ...jobTools,
    ...scheduleTools,
    ...gitTools,
    ...delegateTools,
    ...skillTools,
    ...patchTools,
  ]
  for (const tool of all) {
    registry.register(tool)
  }
  return registry
}
