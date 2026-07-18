# blurwell

**Blur faces in photos and video, entirely in your browser — nothing is ever uploaded.**

Live: https://blurwell.benrichardson.dev

---

## what it is

Blurwell covers faces in photos and video so you can publish them. It exists because of a small absurdity in the tools that already do this: almost all of them ask you to upload the *unblurred* file first. For the footage where anonymity actually matters — a protest, a dashcam near-miss, a user-research recording covered by a consent form, someone else's child in the background of a sports day — handing the original to a stranger's server is precisely the thing you were trying to avoid.

So Blurwell does the whole job in the tab. A 224 KB neural network finds the faces, the blur is burned into the pixels, and video is re-encoded on your own hardware. There is no upload endpoint in the application. Once the page has loaded it works with the network switched off, which is a claim you can check yourself in about ten seconds.

Automatic detection handles faces. For everything a face detector cannot know about — licence plates, name badges, tattoos, a screen in the background — you drag a box over it by hand.

## how it works

**Images** are decoded, scanned once, and re-rendered from raw pixels. Because the output is rebuilt from pixel data alone, EXIF and GPS metadata do not survive into the export.

**Video is processed in two passes**, which is the interesting part:

```
pass 1 (scan)    demux ──► decode ──► downscale to 960px ──► BlazeFace ──► detection timeline
pass 2 (render)  demux ──► decode ──► redact using timeline ──► H.264 encode ──► MP4 mux
                                              ▲
                    audio track ──────────────┴──► copied through untouched
```

The two-pass design solves a real privacy bug. A detector run independently on each frame *will* miss faces on some frames — a head turn, motion blur, a partial crop — and every miss is a frame of un-blurred face in the published file. Blurwell scans the entire clip first and records every detection against its timestamp, so during the render pass it can cover each frame using detections from a window *either side* of it. A single-pass tool can only extend coverage forwards, which leaves the frames just before a face is first picked up exposed.

Three mechanisms bias the whole system towards over-covering rather than under-covering:

- **Persistence** — every detection stays live for a window (default 400 ms) in both directions.
- **Padding** — boxes grow by a fraction of their own size (default 18%), because BlazeFace returns a tight crop around the eyes, nose and mouth, and hair, chin and ears identify someone too.
- **Merging** — boxes that substantially overlap collapse into their union, so two adjacent faces don't blur as two rectangles with a seam between them.

Redaction is destructive by design. Each region is written over in the output canvas; it is not an overlay, and there is no layer to peel away.

## browser APIs used

- **`@mediapipe/tasks-vision` (FaceDetector / BlazeFace, WASM)** — locates faces. Model and runtime are both served from this origin, never a CDN.
- **WebCodecs**, via mediabunny — hardware-backed H.264 decode and encode in the tab.
- **mediabunny** (`CanvasSink` → `CanvasSource`, `EncodedPacketSink` → `EncodedAudioPacketSource`) — demux, per-frame access, audio passthrough and MP4 muxing. Chosen over ffmpeg.wasm because it needs no COOP/COEP headers, which GitHub Pages cannot set.
- **OffscreenCanvas + Canvas 2D** — `filter: blur()`, block-averaging pixelation, and solid fills, applied under a clip so a strong blur can sample beyond the box without smearing a halo across the frame.
- **Web Workers** — the entire pipeline runs off the main thread. No `requestAnimationFrame` anywhere in it, so a backgrounded tab cannot stall a long render.
- **Web Share API / Clipboard API** — hand the export to the system share sheet or the clipboard.
- **Service Worker** — offline operation after first load.

### a note on the worker format

The worker is a **classic** worker (`worker.format: 'iife'` in `vite.config.ts`), not a module worker. MediaPipe's `vision_wasm_internal.js` is a UMD script that defines `ModuleFactory` as a plain global and exposes no ESM export. In a module worker it gets pulled in via `import()`, lands in module scope, and the runtime dies with `ModuleFactory not set`. `importScripts()` exists only in classic workers. Changing this format will break face detection.

## security / privacy model

**Protected**
- Photos and video never leave the device. No upload endpoint, no account system; the tool runs fully offline once loaded.
- Detection runs against a local model on your own processor. No image data is sent anywhere for inference.
- **No face recognition, ever.** The model returns rectangles. Blurwell computes no embeddings, matches against no database, and cannot determine who anyone is.
- Redaction is burned into the exported pixels — no hidden layer retains the original detail.
- Image exports are rebuilt from raw pixels, dropping EXIF, GPS and camera serial numbers.
- Audio can be stripped on export, since a voice identifies a person as surely as a face.

**Not protected**
- Automatic detection is not perfect. Profile views, distant faces, occlusion and heavy motion blur can be missed. Review every export before publishing, and add manual boxes where you need certainty.
- Your original file is untouched — deliberately — so you must share the export, not the original.
- Hiding a face does not hide context: clothing, tattoos, a vehicle, the location, a timestamp or a gait can still identify someone.
- Pixelation at low strength is weaker than it looks and can sometimes be partially reversed. The default is a heavy blur; a black box is strongest.
- Loading the page is an ordinary web request, so GitHub Pages sees your IP.

**Trust model**
- The static bundle served by GitHub Pages, built from this public repository by GitHub Actions.
- The TLS chain between your browser and GitHub Pages.
- A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no cross-site tracking; your files are never sent to it.
- Nothing else. The model, the WASM runtime and the fonts are all same-origin; there are no third-party requests while you work.

## stack

- Vite 6 + vanilla TypeScript
- `@mediapipe/tasks-vision` for face detection, `mediabunny` for video
- Vitest for unit tests
- GitHub Pages for hosting, deployed via GitHub Actions

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via Cloudflare Web Analytics — no personal data, no cross-site tracking.

## local development

```bash
npm install
npm run dev      # vite dev server on :5173
npm test         # run vitest suite
npm run build    # produce dist/ for deploy
npm run preview  # serve dist/ locally
```

The BlazeFace model (`public/models/`) and the MediaPipe WASM runtime (`public/mediapipe-wasm/`) are vendored into the repository on purpose — fetching them from Google's CDN at runtime would leak the fact that a user is anonymising something and would break offline operation.

## deploying

A push to `main` triggers `.github/workflows/deploy.yml`, which runs tests, builds, and deploys `dist/` to GitHub Pages. The custom domain is set via `public/CNAME` — point a `CNAME` DNS record for `blurwell.benrichardson.dev` at `ben-gy.github.io`.

Bump `VERSION` in `public/sw.js` on every deploy; a fixed cache key would serve stale HTML to returning visitors forever.

## license

MIT — see [LICENSE](./LICENSE).
