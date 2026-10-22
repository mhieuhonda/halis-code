import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
    },
  },
  // Android 7.1 devices ship an updatable-but-older system WebView (frozen
  // around Chrome 115). es2022 keeps the bundle inside that envelope.
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
