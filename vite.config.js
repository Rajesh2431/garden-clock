import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  define: {
    // Vercel sets VERCEL=1 during its builds. Keeping the flag out of local and
    // self-hosted builds avoids noisy 404s for the platform-only scripts.
    __VERCEL__: JSON.stringify(Boolean(process.env.VERCEL)),
  },
  // Vitest reads this section when it loads the Vite config.
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js'],
    restoreMocks: true,
    clearMocks: true,
  },
  plugins: [
    VitePWA({
      // External registration script keeps the production CSP free of inline scripts.
      injectRegister: 'script',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'og.png', 'robots.txt'],
      manifest: {
        name: 'Garden Clock',
        short_name: 'GardenClock',
        description:
          'A live clock wrapped in a procedural garden that reacts to real weather and local time.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'fullscreen',
        orientation: 'any',
        start_url: base,
        scope: base,
        categories: ['utilities', 'lifestyle'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Kiosk clock', short_name: 'Kiosk', url: base + '?kiosk=1' },
          { name: 'New garden', short_name: 'Regrow', url: base + '?regrow=1' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-styles',
              expiration: { maxEntries: 8, maxAgeSeconds: 31536000 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 16, maxAgeSeconds: 31536000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'open-meteo',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 12, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/geocoding-api\.open-meteo\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'open-meteo-geocoding',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 24, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/timeapi\.io\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'time-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 300 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
