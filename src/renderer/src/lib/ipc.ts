/** Typed access to the preload bridge. */
import type { HalisBridge } from '@shared/bridge'

declare global {
  interface Window {
    halis: HalisBridge
  }
}

export const bridge: HalisBridge = (window as unknown as { halis: HalisBridge }).halis
