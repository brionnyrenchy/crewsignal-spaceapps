import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.1.0'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', '_redirects'],
      manifest: {
        id: '/demo',
        name: 'CrewSignal — Health Observations & Context',
        short_name: 'CrewSignal',
        description:
          'Local-first personal crew observation recording, trends, body explorer, and exportable records.',
        theme_color: '#171717',
        background_color: '#fafafa',
        display: 'standalone',
        start_url: '/demo',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,ttf,svg,png,json,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
