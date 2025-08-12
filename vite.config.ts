import { defineConfig } from 'vite'
import adonisjs from '@adonisjs/vite/client'
import tailwindcss from 'tailwindcss'

export default defineConfig({
  plugins: [
    adonisjs({
      entrypoints: ['resources/js/app.js'],
      reload: ['resources/views/**/*.edge'],
    })
  ],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  build: {
    manifest: true,
    outDir: 'public/assets',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
