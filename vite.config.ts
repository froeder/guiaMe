import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'GuiaMe SP — Eventos em São Paulo',
        short_name: 'GuiaMe SP',
        description: 'Descubra todos os eventos que acontecem em São Paulo: shows, teatro, exposições, gastronomia e muito mais.',
        theme_color: '#0D0D1A',
        background_color: '#0D0D1A',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'pt-BR',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        categories: ['entertainment', 'lifestyle', 'travel'],
        screenshots: [],
        shortcuts: [
          {
            name: 'Eventos Hoje',
            url: '/?filter=today',
            description: 'Ver eventos de hoje em São Paulo',
          },
          {
            name: 'Eventos Gratuitos',
            url: '/?price=free',
            description: 'Ver eventos gratuitos em São Paulo',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.allorigins\.win\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'event-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 6, // 6 hours
              },
            },
          },
          {
            urlPattern: /^https:\/\/images\.unsplash\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
