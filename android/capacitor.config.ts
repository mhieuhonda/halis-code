import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.mhieuhonda.haliscode',
  appName: 'Halis Code',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
