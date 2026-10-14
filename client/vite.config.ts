import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev, the browser talks to Vite on :5173 and Vite forwards /ws to the
    // collaboration server on :8080. In production the server serves both.
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
