# Cloudflare deployment

Garrigram uses Workers for the app/API, D1 for posts, comments, named likes and photo effects, R2 Standard for photos, and Cloudflare Access for verified `@garrison.se` sign-in. No custom domain is required; use the Worker's HTTPS `workers.dev` URL initially.

## Current deployment — September 19, 2026

The Worker is deployed at **https://garrigram.garrigram.workers.dev** with company-only Cloudflare Access sign-in. HTTPS checks confirmed that signed-out requests for the homepage, JavaScript, posts API and upload paths redirect to the Access login page. The browser displays “Log in to Garrigram” with email-code login. A member completed sign-in and a production upload; the post remained in the live feed after reload. A subsequent read-only D1 check confirmed two saved posts totaling 1,348,412 photo bytes, including one with location coordinates. Live map-marker rendering and reactions have not yet been checked in a signed-in production session.

- D1 `garrigram`: `2a5b8292-dda7-4b9f-86b7-34af3aad6000`, Western Europe, migrations `0001` through `0004` applied.
- R2 `garrigram-photos`: Standard storage; public `r2.dev` access confirmed disabled.
- Current Worker version: `d131a556-89bf-48b4-98f5-1da49ecab7eb`.
- Zero Trust Free team: `garrigram`; issuer `https://garrigram.cloudflareaccess.com`.
- Access application: `a4b8a989-d4c9-47db-9767-85b9c50e972c`, protecting the `garrigram` Worker's production and preview URLs.
- Access policy: `4af22bc8-73ca-472a-8738-511e6c92cf4a` (Garrison team). Its single Allow rule includes emails ending in `garrison.se`, verified in the saved dashboard configuration. Only One-time PIN is accepted; application sessions last 24 hours.
- Wrangler is authorized. No additional API key is needed for Worker, D1 or R2 deployment.

Do not recreate these resources. Both Access identifiers are configured in `wrangler.jsonc`; use `bun run cf:deploy` for subsequent code changes. Access settings were configured through the signed-in dashboard: Wrangler's OAuth authorization rejected Access writes and some detail reads. Its empty list responses were not reliable evidence that no providers existed. Manage Access through the dashboard unless a token with the appropriate Access permissions is explicitly configured.

## Account setup

Account: `18fdbf2f6f454765e0b2b46590f0a608` (owned by Anton's personal Cloudflare account).

1. Enable R2 in **Storage & databases → R2**, completing Cloudflare's billing setup yourself. R2 includes free usage but bills overages.
2. Enable **Zero Trust** on the Free plan, create a team name, and enable **One-time PIN** as a login method. This sends a sign-in code to the user's email. Complete any billing/terms screens yourself.
3. Authorize Wrangler from this checkout:

   ```sh
   bun install --frozen-lockfile
   bun run cf:login
   ```

Do not paste API tokens into chat or commit them. Wrangler stores its login outside the repository.

## Provision and first deployment

```sh
bunx wrangler d1 create garrigram --location weur --binding DB --update-config
bunx wrangler r2 bucket create garrigram-photos --location weur --binding PHOTOS --update-config
bun run cf:migrate
bun run cf:build
```

Inspect `wrangler.jsonc` after provisioning: the existing DB binding must contain the real UUID, with no duplicate binding. Keep R2 private: do not enable its public development URL or attach a public bucket domain.

For the very first deployment, the app must exist before its Access application can be configured. Deploy it in its locked setup state:

```sh
bunx wrangler deploy --config wrangler.jsonc
```

It returns HTTP 503 and exposes no app assets, database contents or uploads until Access is configured. `assets.run_worker_first: true` is essential; it keeps every asset behind the authentication check. Preview URLs are disabled.

## Sign-in policy

In **Workers & Pages → garrigram → Access**, choose **Protect this Worker behind Access → All traffic**. Add the **Email domain** policy for exactly `garrison.se`. Do not add an Everyone rule or account-membership rule; the hosting account's personal Gmail address is deliberately not an app login.

If the dashboard only offers hostname-based Access, enable Access for the production `workers.dev` route under **Settings → Domains & Routes**, then configure its application in Zero Trust. Continue to keep preview URLs disabled.

Copy the Access team's `https://<team>.cloudflareaccess.com` domain and the application's Audience (AUD) tag into `vars.ACCESS_TEAM_DOMAIN` and `vars.ACCESS_AUD` in `wrangler.jsonc`. These are identifiers, not secrets. Then:

```sh
bun run cf:deploy
```

The deploy script checks that the production entrypoint, private asset routing, database ID and Access settings are present. The Worker independently verifies Access's signature, issuer, audience, expiry and exact email domain on every request. It ignores browser-supplied visitor IDs in production; likes use the verified email. `ctx.access` alone is insufficient for a Worker with Static Assets because the internal asset router does not forward that context.

## Verify the live app

- Signed-out requests must get the Access login page (or a denial), never posts or images.
- A `@garrison.se` user can sign in by email code, post a test photo with a location, see it on the map, and like it.
- Reload and open a second signed-in session to verify data and reactions persist.
- A different email domain cannot enter, and a copied image URL is still protected.
- Confirm R2's public access is disabled and production uses the intended D1 database.

No local user photos or SQLite database are uploaded during deployment. Production starts with an empty feed. The three local demo photo assets are part of the source bundle, but no demo records are inserted into production.

## Local development and tests

`bun run start` keeps the original Node/SQLite/file app on port 4317. To exercise Cloudflare's actual local D1/R2 implementation:

```sh
bun run cf:migrate:local
bun run cf:dev
```

The Cloudflare preview runs on `127.0.0.1:8787` with a fixed local identity. Its separate `cloudflare/local.mjs` entrypoint must never be deployed. Production has no environment flag to bypass authentication.

```sh
bun run test
bun run check
bun run cf:build
```

Tests cover the local API and multipart uploads, cryptographic Access verification, denial before serving assets, D1/R2 persistence across restart, reaction identity, cross-origin rejection, storage accounting and upload limits. Tests use temporary isolated storage.

## Costs and recovery

Stay on Workers Free and R2 Standard. Cloudflare Access Free has a seat limit; review it before inviting the whole company. The app accepts at most 8 MB per processed photo, 30 uploads per member per UTC day, and 8 GB of total photo bytes. Database triggers enforce the storage/daily limits against concurrent requests. These app limits are safeguards, **not a Cloudflare spending cap**: requests, other account usage and failed cleanup can still affect billing. Review Cloudflare usage and billing notifications.

D1 supports Time Travel recovery; R2 needs its own photo backup plan before relying on it for irreplaceable originals. The app stores browser-resized JPEGs, not original camera files. Keep applied D1 migrations immutable and add numbered migrations for future changes. Redeploying code does not reset D1 or R2.

Official references: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Public welcome and login branding

`wrangler.welcome.jsonc` deploys a static public welcome page at **https://go.garrigram.workers.dev** using `bun run cf:welcome`. This shorter share URL has Open Graph/Twitter metadata and a 1200×630 preview image. Its Sign in link enters the protected app on the original Worker URL. It has no database or photo bindings.

The Access login uses the supplied Garrison logo, charcoal background and only the company-email sign-in instruction. Its logo is served publicly by the separate `garrigram-brand` Worker (`wrangler.brand.jsonc`). Cloudflare’s email form/button and Access heading retain provider styling. Brand content is in `cloudflare/branding/`; never put private files there.

For schema changes, run `bun run cf:migrate` before `bun run cf:deploy`. The current additions are migration 0002 (comments), 0003 (like display names), 0004 (photo overlays), and 0005 (image variant storage accounting). Old likes have the fallback name “A teammate”; new likes store the chosen display name. Names are user-entered labels; reaction ownership remains the verified email.

Release verification: five automated tests passed (local persistence, Access JWT checks, unauthenticated denial, Cloudflare D1/R2 persistence, overlay validation). Browser checks confirmed face detection on a public portrait fixture, original/overlay toggling, comment submission, named-like dialog, closer map layout, branded Access login and public welcome page. Production signed-out checks for the app, assets, APIs and photo paths redirect to Access; welcome HTML and preview PNG return HTTP 200. The new authenticated features were tested locally; the production browser was signed out at deployment.

Post-release read-only D1 verification found all four migrations applied and five production posts totaling 4,190,044 photo bytes. Production data was not modified by the UI tests. Welcome Worker version: `4b393a6b-ad67-49f2-916e-42589dca257c`.

September 19 follow-up: simplified the public entry page and Access login copy. The cigarette control now appears on every post and generates a missing overlay on demand. Added owner-only caption edits, post deletion, and comment edits/deletion. APIs enforce verified-email ownership; post deletion deletes the private R2 object before removing the database record (foreign-key cascades remove comments/likes and the existing trigger releases storage accounting). A failed deletion can be retried; R2 and D1 are separate services. No new production migration is needed. Browser checks covered generation on an existing photo, caption/comment edits and both confirmation dialogs; isolated tests cover cross-user denial, cascading deletion and R2 cleanup.

The cigarette control is now a two-state accessible switch, labelled “ge ciggen en chans”, with no slider or partial swipe state. Browser verification confirmed off → on → off using click and keyboard, and zero slider controls.

## Image optimization

The `IMAGES` binding uses Cloudflare Images to produce two fixed, versioned WebP variants in private R2: `variants/v1/<source-key>/map.webp` (160px longest edge, quality 75) and `feed.webp` (960px, quality 82). `/uploads/<source-key>?size=map` and `?size=feed` authenticate first; arbitrary sizes are rejected. No query parameter serves the existing larger image. Variants are generated lazily for both old and new posts, and subsequent requests read R2 without calling the processor. `photo_variants` tracks their storage through D1 triggers.

Apply migration 0005 before deploying this version. No paid subscription is enabled by the deployment. Cloudflare Images Free currently allows 5,000 unique transformations per month; at the limit new transforms fail and this app serves the original. Saved R2 variants remain usable independently of the transformation cache. Each missing size is a separate transformation. Review [Images pricing](https://developers.cloudflare.com/images/pricing/) before changing plans.

Photo responses use `private, max-age=0, must-revalidate`, ETags, and 304 responses. Every request verifies Access and the post's existence before serving bytes or returning 304. Do not enable a public response cache in front of this check. Deletion removes the database record first (revoking image access and cascading variant accounting), then deletes the source and both fixed R2 keys; R2 cleanup failures need operator attention because D1 and R2 are separate services.

Verification includes concurrent variant requests, persistence across restart, conditional/HEAD requests, protected/deleted image access, processor failure fallback, and deletion/storage accounting. A real remote Images binding test used bundled example photos in isolated local D1/R2: Stockholm 530,386 bytes → map 6,796 bytes / feed 199,444 bytes; portrait output stayed 128×160 and 768×960, preserving its 4:5 proportions. No company posts were used in these tests.

## Trip profiles and People

Apply `0006_people.sql` with `bun run cf:migrate` before deploying. This adds profiles, temporary check-ins, location requests and per-person dismissals. The Worker uses the existing private R2 bucket and Images binding for avatars, and the existing Access identity for ownership. `wrangler.jsonc` adds a one-minute scheduled cleanup of expired location data. A dry-run build does not register that schedule.

Authenticated endpoints: GET/PUT `/api/profile`, GET `/api/people`, PUT/DELETE `/api/check-in`, POST `/api/location-requests`, and POST `/api/location-requests/:id/dismiss`. `/avatars/:uuid.ext` also verifies authentication and that the avatar is currently referenced. Social responses use `private, no-store`; People payloads never include owner emails. Latitude/longitude and expiry are validated and bounded on the server. Profile photos are capped at 512 KiB and included in the 8 GB storage budget.

The shared `social.mjs` routes run in both the Worker and local Node preview. Tests cover identity isolation, server-controlled expiry, expired-data cleanup, request cooldowns, persistent dismissal, avatar validation/replacement/concurrent saves, storage accounting, authentication and D1/R2 restart persistence. Browser checks cover mobile/desktop layout, cropping/saving an avatar, profile rendering in posts/comments, selected colleagues, stop sharing, sending/dismissing requests and empty states. GPS acquisition itself should also be tried on a phone with its normal permission prompt during acceptance testing.


## Photo notification deployment

Migration `0007_notifications.sql` adds the upload-event trigger and per-device subscriptions. Create queue `garrigram-notifications`; the existing Worker both produces and consumes messages. The one-minute cron handles temporary People cleanup and notification scheduling. Queue consumers process one device at a time, with two concurrent consumers and three retries; later cron sweeps recover pending work if a queue attempt is exhausted. All API and static asset routes, including the manifest/service worker, still pass through Access and JWT verification.

Store `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as Worker secrets (base64url P-256 keys). Never commit/export subscription auth material or the private signing key. Keep these keys stable across deployments: changing them requires browsers to resubscribe. Both keys plus the queue binding must exist before the UI offers notifications. The subscription API restricts destinations to supported HTTPS browser push providers and verifies browser encryption keys; redirects are forbidden. Notification secrets are unrelated to the Cloudflare API token.

Deployment order: queue → migrations → secrets → `bun run cf:deploy`. No paid plan is enabled. Queues, Workers and D1 quotas still apply to this account; see [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/). The public welcome/login branding Worker is a separate release and is not changed here.

To verify on a real device: sign in, enable **New photos on this device** in Edit profile, then press **Send test notification**. Test an upload by a second account, open the notification with an expired Access session, and switch notifications off. On iOS use the installed Home Screen app. Automated tests exercise provider acceptance with a simulated transport; actual OS delivery requires this device acceptance check.


September 20 release: Worker version `ebbcdfdd-c750-4b34-835a-de6fcf5c7dc6` deploys profiles/avatars, People check-ins and requests, centered close icons, and opt-in photo notifications. Migrations 0006/0007 applied successfully. Queue producer/consumer and the one-minute cron are deployed; both VAPID secrets are installed. All 17 automated tests and syntax checks passed. Signed-out requests to the app, People/notification APIs, service worker, manifest, icons and upload paths redirect to Access. The production browser was signed out, so real device subscription/delivery and post-login deep links remain user acceptance checks. The separate welcome/login branding was not redeployed.

Notification delivery follow-up: production version `e74a1c15-fb36-458d-9858-45fcc0313a2d` fixes a workerd incompatibility with Fetch `redirect: 'error'`. The live queue reproduced a provider-request TypeError; a strengthened Miniflare test reproduced the exact unsupported-redirect error through the actual HTTP path. Requests now use `manual`, and the consumer rejects non-2xx responses without forwarding signing headers to redirect destinations. The runtime regression covers real request construction and no redirect following. Sanitized retry diagnostics retain only stage/status/error category. After deployment, the existing phone's queued test updated its success timestamp beyond its test timestamp, confirming provider acceptance; OS display still requires the user's confirmation.


## Comment notification option

Apply migration `0008_comment_notifications.sql` before this release. It preserves existing photo subscriptions, defaults comment notifications to off, and adds comment events recorded transactionally on insert. No new Cloudflare resources or signing keys are needed. Photo and comment topics share a browser subscription and delivery lease but have independent preferences, cursors, cooldowns and notification tags. The consumer rechecks the enabled topic before delivery. Existing clients can still create photo-only subscriptions; updated clients change one preference at a time with authenticated PATCH requests. The local Node demo shows both controls disabled, as before; runtime/server and UI tests exercise their active behavior.

September 20 comment-alert release: Worker version `0cf505a9-28db-439d-9657-e21698cc103e`. Migration 0008 applied successfully; both existing devices retained photo alerts and comment alerts defaulted to off. All 20 automated tests, syntax checks and the dry-run build passed. The local profile layout was visually checked. Signed-out notification API and service-worker requests still redirect to Access. The user previously confirmed an actual iPhone test notification appeared; the new comment-specific flow is covered by automated tests and awaits a real-device comment check.
