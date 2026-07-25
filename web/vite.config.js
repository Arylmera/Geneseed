import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// @fontsource ships each face twice — .woff2 and a .woff fallback for browsers
// that predate woff2 (pre-2016). Nothing that can run this console is in that
// set, so every .woff was dead weight: committed into web/dist, re-committed on
// every UI rebuild, and downloaded by nobody. This drops the fallback from the
// emitted @font-face rules and the now-unreferenced files from the bundle.
//
// Deliberately a build-time transform rather than dynamic per-flavour font
// imports, which was the other candidate: the browser already fetches only the
// active flavour's families (verified on the wire), so that trade would have
// bought the same repo weight at the cost of a font flash on every load.
function dropWoffFallback() {
  return {
    name: 'geneseed-drop-woff-fallback',
    generateBundle(_options, bundle) {
      for (const [name, asset] of Object.entries(bundle)) {
        if (name.endsWith('.woff')) {
          delete bundle[name]
          continue
        }
        if (!name.endsWith('.css') || asset.type !== 'asset') continue
        asset.source = String(asset.source).replace(
          /,\s*url\([^)]+\.woff\)\s*format\(["']woff["']\)/g,
          '',
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), dropWoffFallback()],
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
