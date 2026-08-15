import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Le port est fourni par l'hôte (PORT) quand il est imposé ; sinon Vite choisit.
  server: { port: process.env.PORT ? Number(process.env.PORT) : undefined },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/buna-logo.svg'],
      manifest: {
        name: 'BUNA Operations',
        short_name: 'BUNA',
        description: "Le système d'exploitation opérationnel de BUNA",
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F8F5F0',
        theme_color: '#2E211A',
        icons: [
          { src: 'brand/buna-logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        // Le manuel est un vrai fichier, pas une route de l'application. Sans
        // cette exception, la règle de repli SPA pourrait lui servir index.html
        // et renvoyer sur l'accueil quelqu'un qui a demandé l'aide.
        navigateFallbackDenylist: [/^\/manuel\.html$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'buna-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
