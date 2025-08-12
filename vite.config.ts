import { defineConfig } from 'vite'
import adonisjs from '@adonisjs/vite/client'
import tailwindcss from 'tailwindcss'

export default defineConfig({
  plugins: [
    adonisjs({
      /**
       * Entrypoints of your application. Each entrypoint will
       * result in a separate bundle.
       */
      entrypoints: ['resources/js/app.js'],

      /**
       * Paths to watch and reload the browser on file change
       */
      reload: ['resources/views/**/*.edge'],
    })
  ],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  build: {
    outDir: '../public/assets',
    assetsDir: '',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  base: '/assets/',
})
