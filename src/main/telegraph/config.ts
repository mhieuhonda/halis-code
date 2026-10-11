/**
 * Telegraph network configuration.
 *
 * Per the hackathon's hard lines: chain ID, token address, node URL and
 * price source are configuration values, not code. Flipping to mainnet is a
 * settings change (`networkId: 'base-mainnet'`), nothing else.
 *
 * The network table itself lives in @shared/types so the renderer can show
 * it without reaching into the main process.
 */
import { TELEGRAPH_NETWORKS } from '@shared/types'
import type { TelegraphNetworkConfig } from '@shared/types'

export { TELEGRAPH_NETWORKS }
export type { TelegraphNetworkConfig }

export function getNetwork(id: string): TelegraphNetworkConfig {
  return TELEGRAPH_NETWORKS[id] ?? TELEGRAPH_NETWORKS['base-sepolia']
}

/** Endpoints on the Telegraph node. */
export function enginePaths(nodeUrl: string) {
  const base = nodeUrl.replace(/\/$/, '')
  return {
    ask: `${base}/engine/v1/ask`,
    askDirect: (minerId: string) => `${base}/engine/v1/ask/${minerId}`,
    signal: (hash: string) => `${base}/engine/v1/signal/${hash}`,
    intents: `${base}/engine/v1/intents`,
    miners: `${base}/api/miners`,
    daemonCategories: `${base}/daemon/v1/categories`,
    daemonQuestions: `${base}/daemon/v1/questions`,
  }
}

/** Intents a coding agent cares about (mirrors the Season II catalogue). */
export const CODING_INTENTS = [
  'CODE_REVIEW',
  'SECURITY_REVIEW',
  'VULNERABILITY_TRIAGE',
  'CODE_PATCH_VERIFY',
  'REGRESSION_VERIFY',
  'CODE_GENERATION',
  'TASK_EXECUTION_QUALITY',
  'LLM_OUTPUT_EVALUATION',
  'QUESTION_ANSWERING',
  'TEXT_SUMMARIZATION',
  'CHAT_COMPLETION',
  'WEB_SEARCH',
] as const
