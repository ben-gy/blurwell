# Blurwell — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **Custom domain:** https://blurwell.benrichardson.dev
- **GitHub Pages:** https://ben-gy.github.io/blurwell/ *(redirects to the custom domain)*

DNS (`CNAME blurwell → ben-gy.github.io`, DNS-only) and the GitHub Pages CNAME were both set automatically during the build. No manual setup should be required.

## What was verified before shipping

Driven in a real browser against the production build, not just unit tests:

- **Image path** — dropped a 960×1268 JPEG, detector found the face, dragged an extra manual box, exported a decodable 960×1268 JPEG.
- **Video path** — generated a WebM (VP9 + Opus) in-page, ran the two-pass pipeline, exported a playable MP4.
- **Redaction actually destroys pixels** — measured high-frequency detail in the face region of the *exported* MP4 against the source frame: **97% reduction** (25.9 → 0.78), with 14 blocks visibly changed. The blur is burned in, not overlaid.
- **Mobile at 375px** — no horizontal overflow, drop zone usable, all three modals fit and close on Escape, event-log drawer opens and closes via both its `×` and Escape.

## Bugs found and fixed during verification

1. **`ModuleFactory not set`** — MediaPipe's WASM loader is a UMD script with no ESM export, so in a module worker it landed in module scope and never registered. Switched the worker to classic (`worker.format: 'iife'`), which is the only format where `importScripts()` exists. Documented in the README so it doesn't get "tidied up" later.
2. **`hidden` attribute silently ignored** — author `display: flex/grid` rules beat the UA stylesheet's `[hidden] { display: none }`, so the progress panel and error banner were permanently rendered below the fold. Added an explicit `[hidden]` rule.
3. **MediaPipe timestamp mismatch on sparse video** — sampling on a fixed 15 Hz grid resolves to the *same* decoded frame when the source is sparser, and VIDEO mode requires strictly increasing timestamps. Now dedupes repeated frames and forces a monotonic detector clock.
