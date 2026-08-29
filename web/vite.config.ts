import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { attachOcrDevServer } from './scripts/ocrDevServer'
export default defineConfig({
  base: './',
  plugins: [react(), { name: 'ocr-web-server', configureServer(server) { attachOcrDevServer(server) } }],
  server: { open: true, proxy: { '/siliconflow': { target: 'https://api.siliconflow.cn', changeOrigin: true, timeout: 180000, proxyTimeout: 180000, rewrite: (path) => path.replace(/^\/siliconflow/, '') } } },
  build: { rollupOptions: { input: 'index.html' } },
})
