import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // React never changes between our builds, so give it its own hashed
        // chunk: it then stays in the immutable /assets/ cache across upgrades
        // instead of being re-downloaded inside the app chunk every time.
        manualChunks: { react: ['react', 'react-dom', 'react-dom/client'] },
      },
    },
  },
  test: { environment: 'jsdom', globals: true },
})
