import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
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
  test: {
    /*
     * Les worktrees de travail vivent sous `.claude/worktrees/` — donc DANS
     * l'arborescence du dépôt. Sans cette exclusion, vitest y trouve une
     * seconde copie de toute la suite et la joue deux fois : 602 tests au lieu
     * de 305. Le coût n'est pas la durée, c'est le diagnostic — un worktree
     * laissé dans un état intermédiaire fait échouer la suite du dépôt
     * principal, pour une raison qui n'apparaît nulle part dans son code.
     */
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
})
