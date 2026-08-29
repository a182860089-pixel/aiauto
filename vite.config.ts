import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { attachOcrDevServer } from './scripts/ocrDevServer'

/**
 * 记录识别请求进度，方便在终端持续观察卡点。
 * @return Vite 插件
 */
function ocrDebugPlugin(): Plugin {
  return {
    name: 'ocr-debug',
    configureServer(server) {
      attachOcrDevServer(server)
      server.middlewares.use('/ocr-debug', (request, response, next) => {
        if (request.method !== 'POST') return next()
        var chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          console.log(`[ocr-ui] ${Buffer.concat(chunks).toString('utf8')}`)
          response.statusCode = 204
          response.end()
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), ocrDebugPlugin()],
  server: {
    open: '/ocr.html',
    proxy: {
      '/siliconflow': {
        target: 'https://api.siliconflow.cn',
        changeOrigin: true,
        timeout: 180000,
        proxyTimeout: 180000,
        rewrite: (path) => path.replace(/^\/siliconflow/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, request) => {
            if (String(request.url || '').includes('chat/completions')) console.log(`[ocr-proxy] start ${request.method}`)
          })
          proxy.on('proxyRes', (proxyResponse, request) => {
            if (String(request.url || '').includes('chat/completions')) console.log(`[ocr-proxy] status ${proxyResponse.statusCode}`)
          })
          proxy.on('error', (error) => {
            console.log(`[ocr-proxy] error ${error.message}`)
          })
        },
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        ocr: 'ocr.html',
      },
    },
  },
})