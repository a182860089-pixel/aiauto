import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve(rootDir, 'node_modules/react'),
      'react-dom': path.resolve(rootDir, 'node_modules/react-dom'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(rootDir, '..')],
    },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(rootDir, 'index.html'),
    },
  },
})
