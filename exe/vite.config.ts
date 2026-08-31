import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    fs: {
      allow: [path.resolve(rootDir, '..')],
    },
  },
  build: {
    rollupOptions: {
      input: 'index.html',
    },
  },
})
