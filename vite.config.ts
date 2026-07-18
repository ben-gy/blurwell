import { defineConfig } from 'vite';

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
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
