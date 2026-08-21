import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const src = fileURLToPath(new URL('./src', import.meta.url))

/** Static playground for GitHub Pages: https://<user>.github.io/MRI-Viewer/ */
export default defineConfig({
  base: '/MRI-Viewer/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': src },
  },
  publicDir: 'public',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    outDir: 'dist-playground',
    emptyOutDir: true,
  },
})
