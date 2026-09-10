import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig(({ command }) => {
  const wantsHttps = process.env.VITE_DEV_HTTPS === 'true'
  const forceHttpsOnNode22 = process.env.VITE_DEV_HTTPS_FORCE === 'true'
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  const isNode22OrNewer = Number.isFinite(nodeMajor) && nodeMajor >= 22
  const useHttps = wantsHttps && (!isNode22OrNewer || forceHttpsOnNode22)

  if (wantsHttps && !useHttps) {
    console.warn(
      '[vite] HTTPS dev mode disabled on Node 22+ due to a known WebSocket upgrade crash. Use VITE_DEV_HTTPS_FORCE=true to override.'
    )
  }

  return ({
  plugins: useHttps && command === 'serve' ? [mkcert()] : [],
  server: {
    https: useHttps,
    host: true,
    hmr: {
      protocol: useHttps ? 'wss' : 'ws'
    }
  },
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
  },
  worker: {
    format: 'es'
  }
})
})
