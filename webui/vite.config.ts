import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/webui',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api':   'http://localhost:1208',
      '/ws':    { target: 'ws://localhost:1208', ws: true },
    },
  },
})
