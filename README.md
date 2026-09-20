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

## Trip profiles and People map

Map modes are Photos, Heatmap and People. Profiles have an optional cropped avatar and a display name, linked to the verified account in production and the browser visitor ID locally. Saving a profile updates the name/avatar shown beside existing owned posts and comments. Crop controls support pointer dragging and keyboard-accessible zoom and position sliders. The browser produces a small square JPEG; Cloudflare Images optimizes hosted avatars to 256px WebP when available. Avatar files stay private, count toward storage usage, and are removed on replacement/removal. Concurrent replacements use an optimistic update to avoid orphaned uploads.

People check-ins are explicit snapshots of a user's current position with an optional 200-character message. They expire exactly one hour after the server accepts them. Updating is a new explicit share and starts a fresh hour; Stop sharing removes the record immediately. No background tracking is used. Pins show the age of the shared position, and the selected person's card offers directions. Photo locations and temporary People locations are separate.

“Where is everyone?” sends an in-app request, optionally with a message, lasting one hour. Each sender can ask once every ten minutes; the server enforces the cooldown atomically. Requests appear in the feed, never share a recipient's location automatically, and can be dismissed per account. The app refreshes People data every 15 seconds while visible. Location requests stay in-app; optional push alerts are for new photos only.

Expired check-ins and requests are excluded immediately and purged on People API access; a production scheduled handler also purges every minute. For a later trip archive, exclude `check_ins`, `location_requests`, and `request_dismissals`. Cloudflare database backups/Time Travel have their own retention; expiry is not a promise to erase historical provider backups instantly.

### Isolated local demo

```sh
PORT=4319 DATA_DIR=/private/tmp/garrigram-people-demo node --watch server.mjs
# In another terminal:
node scripts/seed-people-demo.mjs
```

Open `http://127.0.0.1:4319/#map` and choose People. The seeder only accepts local HTTP URLs and creates four fictional colleagues in Tirana plus a location request. These check-ins expire normally; rerun the script to refresh them. Production data is never copied into the demo. Real browser geolocation still requires explicit permission when testing Share my location.


## Optional photo notifications

Edit profile → Notifications → **New photos on this device** is off by default. Enabling it requests browser permission, stores that device’s Web Push subscription under the verified account, and reveals **Send test notification**. Turning it off removes the server subscription immediately; other devices are unchanged. On iPhone/iPad, add Garrigram to the Home Screen and open it there first. A manifest and GA app icons support installation. The local Node demo displays the control but does not send push messages.

A D1 trigger records a lightweight event atomically with each new photo (never old/demo posts). A one-minute scheduled sweep queues eligible devices, grouping photos at least two minutes old and spacing deliveries at least two minutes apart. The consumer excludes the recipient’s own photos and deleted posts, encrypts the payload with Web Push, and retries transient failures. A per-device database cursor and lease suppress ordinary duplicate queue deliveries; ambiguous network failures can still be delivered more than once, so the client also replaces alerts using a stable tag. Push-provider acceptance is not a guarantee of display on a phone (Focus, permission and connectivity still apply).

Notifications contain only a photo count and a link, with no captions, images, names or location data. A single-photo alert opens its post; grouped alerts open the feed. Access login remains required to see content. The service worker does not intercept fetches or cache private content. Expired provider subscriptions are removed on 404/410; idle subscriptions expire after 90 days, and pending events after 24 hours. Pending events and `push_subscriptions` should be excluded from trip archives.

Tests cover opt-in and ownership, endpoint restrictions, device limits, cross-origin denial, grouping, encrypted payload decryption and VAPID signatures, actual Cloudflare runtime encryption, retries/revocation, UI permission states, and safe notification navigation. A real iPhone/Android delivery check still requires a user to enable notifications and tap **Send test notification** on that device.
