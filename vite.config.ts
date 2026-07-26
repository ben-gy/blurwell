// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    // MUST stay 'iife' (a classic worker). MediaPipe's vision_wasm_internal.js
    // is a UMD script that defines ModuleFactory as a plain global and has no
    // ESM export — in a module worker it gets loaded via import(), lands in
    // module scope, and the runtime dies with "ModuleFactory not set."
    // importScripts() only exists in classic workers, so this is the format
    // that lets the detector load at all.
    format: 'iife',
  },
  // mediabunny and the MediaPipe vision tasks ship their own pre-bundled ESM +
  // WASM; let Vite resolve them as-is rather than pre-optimising (which can
  // mangle the WASM urls).
  optimizeDeps: {
    exclude: ['mediabunny', '@mediapipe/tasks-vision'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon-32.png',
        'favicon-16.png',
        'apple-touch-icon.png',
        'robots.txt',
      ],
      manifest: {
        name: 'Blurwell — blur faces in photos and video',
        short_name: 'Blurwell',
        description:
          'Blur faces in photos and video entirely in your browser. Nothing is uploaded; works offline.',
        id: '/',
        start_url: '/',
        scope: '/',
        theme_color: '#0d0f12',
        background_color: '#0d0f12',
        display: 'standalone',
        orientation: 'any',
        categories: ['photo', 'utilities', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Precache the app shell + icons + the demo sample. The ~11 MB MediaPipe
        // WASM runtime and the BlazeFace .tflite model are served from this
        // origin and runtime-cached on first use, NOT precached — a fixed-cost
        // install must not pull an 11 MB download most visitors never trigger.
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,jpg}'],
        globIgnores: ['**/mediapipe-wasm/**', '**/models/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
