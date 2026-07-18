# Tool Plan: Blurwell

## Overview
- **Name:** Blurwell
- **Repo name:** blurwell
- **Tagline:** Blur faces in photos and video, entirely in your browser — nothing is ever uploaded.

## Problem It Solves

You have footage or photos you want to publish, but other people are in them. A dashcam clip you want to post after a near-miss. Protest footage where identifying a face could get someone arrested. A user-research recording you need to share with the team under a consent agreement. Photos of a school event where you only had permission for your own kid. A screen recording with a colleague's name badge in frame.

The job is simple — cover the faces — and every free tool that does it wants you to upload the file first. For exactly the footage where anonymity is the point, handing the un-anonymised original to a stranger's server is the one thing you must not do. The irony is total: you upload an unblurred video of a protester to get a blurred one back.

Blurwell does the whole job on-device. Faces are detected by a 230 KB neural net that ships with the page, the blur is burned into the pixels, and the file is re-encoded in the tab. Nothing is transmitted — the tool works with the network switched off.

## Why This Must Be Client-Side

- **Sensitive-data handling.** The input is, by definition, un-anonymised imagery of identifiable people. Uploading it to obtain anonymity is self-defeating. This is the strongest client-side argument in the whole catalog.
- **Large-file handling.** Video is hundreds of MB to multiple GB. Upload-process-download is slow, costs the operator money (hence ads, watermarks and 480p caps), and fails on a phone tether. Local processing is bounded only by the user's CPU/GPU.
- **Offline as proof.** Once loaded, Blurwell runs with the network off. That is a claim the user can personally verify in ten seconds — a far better trust signal than a privacy policy.

## Browser APIs / Libraries Used

| API / Library | What it does for us | Fallback if unsupported |
|---|---|---|
| `@mediapipe/tasks-vision` (FaceDetector, BlazeFace short-range, WASM) | Detects faces in a frame; model + WASM vendored into `public/` so no CDN fetch at runtime | Manual blur regions still work; auto-detect surfaces an error and degrades |
| WebCodecs (`VideoEncoder`/`VideoDecoder`, via mediabunny) | Decodes and re-encodes video frames on-device | Capability gate on `getFirstEncodableVideoCodec(['avc'])`; Firefox users told to use Chrome/Edge/Safari for video (images still work) |
| `mediabunny` (`CanvasSink` → `CanvasSource`, `Output`, `Mp4OutputFormat`) | Demux → per-frame canvas → blur → re-encode → mux MP4, no COOP/COEP needed | N/A — hard requirement for video |
| OffscreenCanvas + Canvas 2D (`filter: blur()`, `drawImage`) | Applies the blur/pixelate/box redaction into the pixels | N/A |
| Web Workers | The entire detect → blur → encode pipeline runs off the main thread | N/A — hard requirement |
| `createImageBitmap` | Decodes still images without a DOM `<img>` | N/A |
| Web Share API | Share the anonymised file straight to Messages/Mail on mobile | Download button |
| Service Worker (PWA) | Full offline operation after first load | Online-only, tool still functions |

## Workflow (input → process → output)

1. **Input** — user drops (or taps to pick, or pastes) a photo or a video. Nothing is read until they act.
2. **Detect** — the file is decoded locally; BlazeFace finds faces. For video, every frame is scanned and detections are *persisted and padded* (see below). The user sees boxes drawn over a preview.
3. **Adjust** — user picks a redaction style (blur / pixelate / solid black), tunes the strength and box padding, deletes any false positive, and drags new boxes over anything the detector can't know about (licence plates, name badges, tattoos, screens).
4. **Render** — blur is burned into the pixels; video is re-encoded to MP4 with a determinate progress bar and fps readout.
5. **Output** — download, Web Share, or copy-to-clipboard (images). EXIF is dropped on the way out; audio can optionally be stripped.

### The flicker problem (why naive per-frame detection is a privacy bug)

Running a detector independently on each frame *will* miss a face on some frames — a head turn, motion blur, a bad crop. Every miss is an un-blurred frame of a face in the published file, which defeats the entire purpose. Blurwell therefore:

- **Persists** each detection for a trailing window (~0.4 s) so a momentary miss stays covered.
- **Pads** every box by a user-adjustable margin (default 18%) so hair, chin and jawline are inside the blur.
- **Merges** overlapping boxes so a padded cluster doesn't produce visible seams.

This is called out in the UI, because a user needs to know the tool is designed to over-blur rather than under-blur.

## Non-Goals

- No person/body detection, no licence-plate model — manual boxes cover those, and shipping a weak plate detector would imply a guarantee we can't keep.
- No motion-tracked manual boxes in v1 — a manual box applies to the whole clip or a chosen time range, not a moving path.
- No face *recognition* — Blurwell never identifies who anyone is, only where a face is. No embeddings, ever.
- No cloud sync, no accounts, no upload — ever, in any version.

## Target Audience

Someone with a file they are afraid to publish as-is: a journalist or activist at 1am with protest footage and a deadline, a researcher bound by a consent form, a parent posting a sports-day clip, a driver sharing a dashcam near-miss. Anxious, time-pressured, and — critically — already suspicious of upload-based tools. They need to *believe* the privacy claim, not just read it.

## Style Direction

**Tone:** professional, calm, quietly technical — reassurance without cutesiness.
**Colour palette:** dark. Near-black paper (`#0d0f12`) with soft off-white ink, hairline rules, and a single restrained amber accent (`#e0a33a`) used only for the active redaction state and primary action. Dark suits the audience (security/journalism-adjacent), keeps attention on the imagery being previewed, and avoids the "consumer photo toy" read.
**UI density:** balanced — a large preview stage, a compact control rail, no dashboard clutter.
**Dark/light theme:** dark.
**Reference tools for feel:** Squoosh (workflow-first, image front and centre), Dropwell (event log, threat-model honesty).

## Technical Architecture

- **Stack:** Vanilla TypeScript + Vite. No React — the state is a single document model plus a canvas preview, which is imperative work that React would only complicate.
- **Key libraries:** `@mediapipe/tasks-vision`, `mediabunny`.
- **Worker strategy:** one dedicated module worker owning the whole pipeline (MediaPipe init, detection, blur compositing, mediabunny encode). Progress and event-log lines stream back via `postMessage`. No `requestAnimationFrame` anywhere in the pipeline — a hidden tab must not stall a render.
- **Storage:** none for user data. `localStorage` for UI preferences (style, strength, padding) only.
- **Assets:** BlazeFace `.tflite` (~230 KB) and the MediaPipe vision WASM are vendored into `public/` and fetched same-origin, so there is no third-party request at runtime and the tool works offline.

## Privacy & Trust Model

**Protected**
- Photos and video never leave the device — there is no upload endpoint, and the tool runs fully offline.
- Detection runs against a local model; no image data is sent anywhere for inference.
- No face recognition, no embeddings, no identity inference of any kind.
- EXIF/GPS metadata is dropped from image output as a side effect of re-encoding.
- Audio can be stripped on export, since a voice identifies a person as surely as a face.

**Not protected**
- Blurring is irreversible in the exported pixels, but *the original file on your disk is untouched* — anonymise, then share the export, not the original.
- Automatic detection is not perfect. Profile views, distant faces, masks, and heavy motion blur can be missed. Every export must be reviewed before publishing; the UI says so.
- Redaction hides faces, not context — clothing, tattoos, location, gait and timestamps can still identify someone.
- Pixelation at low strength can be partially reversible in principle; the default is a heavy gaussian blur for this reason.
- The initial page load is served by GitHub Pages, which sees your IP like any web request.

**Trust surface**
- The static site bundle served by GitHub Pages, built and deployed from the public repo by GitHub Actions.
- The TLS chain between the browser and GitHub Pages.
- A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no cross-site tracking; your files are never sent to it.
- No other third-party network calls: the model, the WASM, and the fonts are all same-origin.

## UX Required Surfaces

- Drop zone with drag-drop, tap-to-pick and paste-to-ingest; accepted-format caption.
- Determinate progress with fps/frame readout during video render.
- Event log drawer with in-drawer `×` and Escape-to-close (verified at 375px).
- How-It-Works modal (detection → persistence → burn-in → re-encode).
- Privacy modal (Protected / Not protected / Trust surface).
- About modal with benrichardson.dev + sites.benrichardson.dev attribution and the source-repo link.
- Output: download + Web Share + copy-to-clipboard (images).
- Keyboard: Escape closes modals/drawer, Enter runs the primary action, Cmd/Ctrl+V pastes an image, Delete removes the selected box.
- Sticky footer: "Built by benrichardson.dev · more tools & sites → sites.benrichardson.dev".
