import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig(({ command }) => ({
  plugins: [mkcert()],
  server: { https: true, host: true },
  base: command === 'build' ? '/vr-panorama-tour/' : '/',
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ['@babylonjs/core'],
          babylonGui: ['@babylonjs/gui'],
          babylonLoaders: ['@babylonjs/loaders']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['@babylonjs/core', '@babylonjs/gui', '@babylonjs/loaders']
  }
}))
