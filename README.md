# garri·gram

A local photo-sharing app for Garrison. Two main views: a chronological photo feed and an interactive map. Visual direction inspired by [garrison.se](https://garrison.se): charcoal, mint, orange, and rounded typography.

## Run locally

Requires Node.js 24 or later. No package installation or cloud account is needed.

```sh
npm start
# or: node server.mjs
```

Open http://127.0.0.1:4317. The server listens on loopback only by default. `PORT` and `DATA_DIR` can override the port and storage directory. `npm run dev` restarts the server on source changes; refresh the browser to see client edits.

## Included

- Feed and map, with mobile bottom navigation.
- Photo upload, drag and drop, and a camera capture input for supported phones.
- Captions and remembered display names.
- Optional location: a city, Garrison HQ, map selection, or browser geolocation requested only after clicking “Use my location”.
- Photo pins open the corresponding moment. Full-size photo viewer.
- Likes stored per browser visitor; other tabs pick up changes on focus or every 30 seconds.
- Photos resized to at most 2400 pixels and re-encoded as JPEG in the browser; original metadata is not retained. Input limit 15 MB. HEIC support depends on the browser; unsupported formats get an error directing the user to JPG/PNG/WebP.
- Recoverable errors keep the draft intact. Closing the composer also preserves its draft until the page is reloaded.

## Persistence and local identity

`data/garrigram.sqlite` stores posts and likes. `data/uploads/` stores uploaded images. Both survive server restarts and are ignored by Git. Back up the entire `data/` directory with the server stopped. Browser storage contains only a display-name preference and random visitor ID, not posts or image data.

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
