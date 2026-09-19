# Cloudflare deployment

Garrigram uses Workers for the app/API, D1 for posts and likes, R2 Standard for photos, and Cloudflare Access for verified `@garrison.se` sign-in. No custom domain is required; use the Worker's HTTPS `workers.dev` URL initially.

## Current deployment — September 19, 2026

The Worker is deployed at **https://garrigram.garrigram.workers.dev** with company-only Cloudflare Access sign-in. HTTPS checks confirmed that signed-out requests for the homepage, JavaScript, posts API and upload paths redirect to the Access login page. The browser displays “Log in to Garrigram” with email-code login. A real member's sign-in and first production upload still need an end-to-end check.

- D1 `garrigram`: `2a5b8292-dda7-4b9f-86b7-34af3aad6000`, Western Europe, migration `0001_initial.sql` applied.
- R2 `garrigram-photos`: Standard storage; public `r2.dev` access confirmed disabled.
- Current Worker version: `04a8a8ba-edb2-4bc4-ba62-4f0e263c8d3a`.
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
