import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 450,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'initial-vendor',
              test: /node_modules[\\/]/,
              tags: ['$initial'],
              maxSize: 300 * 1024,
            },
          ],
        },
      },
    },
  },
})
