import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Steady',
        short_name: 'Steady',
        description: 'A steady, practical way to keep track of the food you eat.',
        id: '/',
        scope: '/',
        theme_color: '#f8f6ed',
        background_color: '#f8f6ed',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/steady-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/steady-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/steady-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/(?:$|sign-in\/?$|onboarding\/?$|library\/?$|routine\/?$|profile\/?$)/],
        navigateFallbackDenylist: [/^\/(?:auth|rest|storage|realtime|functions|graphql|api)(?:\/|$)/],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/steady-icon-*.png', '**/steady-maskable-*.png'],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
