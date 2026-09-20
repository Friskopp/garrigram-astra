# garri·gram

A local photo-sharing app for Garrison. Two main views: a chronological photo feed and an interactive map. Visual direction inspired by [garrison.se](https://garrison.se): charcoal, mint, orange, and rounded typography.

## Run locally

Requires Node.js 24 or later. No cloud account is needed. Install dependencies and prepare the local face model first.

```sh
bun install --frozen-lockfile
npm run prepare:effects
npm start
# or: node server.mjs
```

Open http://127.0.0.1:4317. The server listens on loopback only by default. `PORT` and `DATA_DIR` can override the port and storage directory. `npm run dev` restarts the server on source changes; refresh the browser to see client edits.

## Included

- Feed and map, with mobile bottom navigation.
- Photo upload, drag and drop, and a camera capture input for supported phones.
- Captions and remembered display names. Owners can edit captions and edit/delete their own comments. Deleting a post removes its photo, comments, and likes after confirmation.
- Optional location: a city, Garrison HQ, map selection, or browser geolocation. The map opens at street zoom near the viewer when permission is granted; otherwise it uses the latest located post or Garrison HQ. “Near me” retries location and “Show all” fits the photo pins.
- Photo pins open the corresponding moment. Full-size photo viewer.
- Persistent comments and a list of names behind each like. Likes stored per browser visitor; other tabs pick up changes on focus or every 30 seconds.
- Photos resized to at most 2400 pixels and re-encoded as JPEG in the browser; original metadata is not retained. Input limit 15 MB. HEIC support depends on the browser; unsupported formats get an error directing the user to JPG/PNG/WebP.
- Recoverable errors keep the draft intact. Closing the composer also preserves its draft until the page is reloaded.

## Persistence and local identity

`data/garrigram.sqlite` stores posts, comments, likes, and cigarette overlay positions. `data/uploads/` stores uploaded images. Both survive server restarts and are ignored by Git. Back up the entire `data/` directory with the server stopped. Browser storage contains only a display-name preference and random visitor ID, not posts or image data.

The Node server is a loopback-only local prototype with display names, not verified employee accounts. The separate Cloudflare deployment requires verified `@garrison.se` sign-in and privately serves all app assets, posts and photos. Camera/geolocation require HTTPS when accessed from another device; localhost is a browser exception.

Three clearly labeled example moments are inserted on startup with fixed IDs (no duplicates). Set `SEED_DEMO=0` on a fresh data directory for an empty feed. This flag does not remove existing examples.

Map tiles and map-preview imagery come from OpenStreetMap, and the fonts use Google Fonts. They need internet access; the feed, bundled demo images, uploads, and stored data work locally. Map coordinates for example photos are illustrative, not extracted GPS data.

## Verification

```sh
npm test
npm run check
```

The integration test uses an isolated temporary database and server, verifies uploads and image retrieval, rejected inputs, cross-origin rejection, idempotent likes, separate visitor state, and persistence across a real server restart. It leaves the app's data untouched.

## Cloudflare hosting

Cloudflare Workers, D1, R2 and Access are configured in `wrangler.jsonc`. Install deployment/test tools with `bun install --frozen-lockfile`. See [CLOUDFLARE.md](CLOUDFLARE.md) for account setup, first deployment, private email sign-in, local Cloudflare emulation, costs and recovery.

The hosted app uses verified email for reaction identity, keeps photo storage private, and enforces an 8 GB photo budget plus 30 uploads per member per day. Local data is separate and is never uploaded automatically. Deployment still requires the account's real D1 ID and Access settings; the app fails closed until authentication is configured.

## Credits

- [Leaflet 1.9.4](https://leafletjs.com), BSD-2-Clause; license included in `public/vendor/LEAFLET-LICENSE`.
- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Stockholm: [Elijah Cobb / Unsplash](https://unsplash.com/photos/EAe_AWX92ds).
- Fika: [Mikael Stenberg / Unsplash](https://unsplash.com/photos/QL9AkXhjJuA).
- Archipelago: [Max van den Oetelaar / Unsplash](https://unsplash.com/photos/UTAoG0oeXew).
- Demo photos are covered by the [Unsplash License](https://unsplash.com/license). They are examples, not real employee posts.
- DM Sans and Manrope via Google Fonts, with system sans-serif fallback.

## Cigarette version

New uploads run through MediaPipe Face Landmarker in the browser. The model and WebAssembly are served from this app; face detection stays on the device. Up to 50 detected faces receive a playful cigarette overlay. The **ge ciggen en chans** on/off switch toggles between the original and the cigarette overlay. The resized photo remains intact. The button is visible on existing posts too: tapping it generates and saves a missing overlay. If no face is detected or processing fails, users can still post the original. Small, obscured, or side-facing faces may be missed.

Run `npm run prepare:effects` after dependency installation. This copies the pinned `@mediapipe/tasks-vision` runtime and downloads Google’s versioned Face Landmarker model; generated assets are ignored by Git and prepared automatically by deployment. MediaPipe is Apache-2.0 licensed. See [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) for model documentation.

Hosted ownership uses the verified Cloudflare Access email. Changing a display name never grants edit/delete rights. Local ownership uses the browser visitor ID; older local records without an owner remain read-only. Production posts already have email ownership, so these controls also work for existing posts.

## Image delivery

Cloudflare Images makes WebP variants on demand: a 160px longest-edge map thumbnail and a 960px feed image. They keep the original aspect ratio, so the cigarette overlay stays aligned. Detail views and face detection use the larger uploaded JPEG. Variants are stored once in private R2, counted toward the storage budget, and removed with the post. Existing uploads work automatically, with no re-upload or bulk backfill. Processor failures fall back to the original and pause generation for five minutes in that Worker instance.

Photos mode loads thumbnails only within the viewport plus a small buffer. Heatmap mode shows only the density layer, with no photo pins; density includes all matching coordinates. Unchanged markers survive refreshes. Images use private browser caching with authenticated ETag revalidation, so unchanged images return 304 instead of downloading again. No public photo cache is enabled.

The Node preview on port 4317 serves original images for variant URLs. Use the Cloudflare preview to test resizing; local Images simulation is limited. A temporary local config with `images.remote: true` exercises the real processor while keeping D1/R2 local. See [Cloudflare image setup](CLOUDFLARE.md#image-optimization).
