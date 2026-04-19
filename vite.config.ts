import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }

          // Largest / most-changed-independently libraries get their own chunk
          // so a deploy that only touches app code doesn't bust Firebase or MUI cache.
          if (id.includes('firebase') || id.includes('@firebase')) {
            return 'vendor-firebase'
          }

          // MUI icons tree-shakes but is still large — separate from core MUI
          // so icon additions don't bust the MUI core cache.
          if (id.includes('@mui/icons-material')) {
            return 'vendor-mui-icons'
          }

          if (id.includes('@mui/') || id.includes('@emotion')) {
            return 'vendor-mui'
          }

          if (id.includes('@tanstack')) {
            return 'vendor-query'
          }

          if (id.includes('react-router')) {
            return 'vendor-router'
          }

          // react-dom is large; keep it separate from the tiny react package
          // so react-dom updates don't bust the react cache and vice-versa.
          if (id.includes('react-dom')) {
            return 'vendor-react'
          }

          // Page-specific heavy libraries — only downloaded when the user
          // actually visits PicturesPage or CRM import.
          if (id.includes('yet-another-react-lightbox')) {
            return 'vendor-lightbox'
          }

          if (id.includes('jszip')) {
            return 'vendor-jszip'
          }

          if (id.includes('xlsx')) {
            return 'vendor-xlsx'
          }
        },
      },
    },
  },
})
