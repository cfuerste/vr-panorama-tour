import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins: [mkcert()],
  server: { https: true, host: true },
  base: '/vr-panorama-tour/'
})
