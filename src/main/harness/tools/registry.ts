export { ToolRegistry } from './index'
export type { ToolContext, ToolDef, ToolResult } from './index'

import { ToolRegistry } from './index'
import { fileTools } from './fs'
import { searchTools } from './search'
import { bashTools } from './bash'
import { taskBoardTools } from './taskboard'
import { telegraphTools } from './telegraph'
import { swarmTools } from './swarm'

/** The standard Halis Code toolset. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  for (const tool of [...fileTools, ...searchTools, ...bashTools, ...taskBoardTools, ...telegraphTools, ...swarmTools]) {
    registry.register(tool)
  }
  return registry
}
