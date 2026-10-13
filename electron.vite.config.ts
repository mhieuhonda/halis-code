import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

/**
 * Halis Code — build configuration.
 *
 * The main process is emitted as CommonJS. viem / @x402 / MCP SDK are
 * ESM-only, so they are bundled into the main output instead of being
 * externalized. All runtime deps are bundled by electron-vite (they live in
 * devDependencies so electron-builder does not ship dead node_modules —
 * verified: out/main's only external requires are electron + node builtins).
 */
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      externalizeDeps: { exclude: ['viem', '@x402/evm', '@x402/fetch', '@x402/core', '@modelcontextprotocol/sdk'] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react({}), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    server: {
      port: 5199,
    },
  },
})
