# Rontab

An editorial product discovery experience for home and kitchen finds in the United Kingdom.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current scope

- Responsive English product-discovery storefront with search and category filters.
- Public catalog reads active categories and approved, funded products from Supabase.
- Seller signup starts in pending review (or automatic approval, if enabled in admin settings); approved sellers can submit products with photos or a vertical Reel.
- Active public sellers have shareable shop profiles; confirmed visitors can follow shops and keep a private following list, while sellers see follower counts only.
- Admin access is isolated and requires the verified `app_metadata.role = "admin"` claim, checked in every admin page and action.
- Seller advertising balances use click credits, with a shared pool and optional per-product allocations. New sellers receive a one-time 10,000-click welcome credit; admins can grant more. Credit purchases stay disabled until a payment provider is configured.
- Shop visits by confirmed visitor accounts are recorded on the server once per account and product; guest visits are redirected without spending seller credits or earning points. Subscription billing is not active yet.
- Visitor rewards include an append-only points ledger, city-targeted offers, guaranteed redemptions, and limited participation. Random selection is disabled by default.
- Seller promotions use a separate request/review/publish flow with UK branches, daily schedules, privacy-thresholded audience estimates, point-priced vouchers, atomic reservations, early-cancel refunds, and seller code redemption. Voucher points use a separate ledger but appear in the visitor's shared points balance and activity.
- Current location coverage is UK-only. Visitors, sellers, and offer allocations use canonical UK city records; new countries stay unavailable until their supported-country and city data are explicitly added.
- Configure `SUPABASE_SERVICE_ROLE_KEY` as a server-only environment variable for product visit redirects and visitor administration. Never expose it through a `NEXT_PUBLIC_` variable.

The product requirements document is in `docs/Rontab_Product_Specification.docx`.
The loyalty and rewards behavior is specified in `docs/LOYALTY_REWARDS.md`.

## Notifications

- Signed-in inboxes include administration announcements and product updates only from the account's creation time onward.
- The durable inbox migration stores event snapshots independently of the source's active status. Each channel loads 20 items at a time with a stable time-and-ID cursor; unread totals cover the entire eligible archive.
- Each account receives one persistent welcome message. Email confirmation remains a separate account reminder, and opening the inbox does not mark its contents as read.
- Reward offers that started before registration remain available on the rewards page when eligible, but do not appear as new-account notifications.
- Support, reward results, and creator collaboration messages remain restricted to their recipient. Existing per-message read status is preserved.
- Members cannot open administration messages predating their registration through inbox links. Administrators can still inspect older messages; public announcements remain readable by guests.

The durable inbox migration `supabase/migrations/20261018210000_durable_notification_inbox.sql` was applied to the linked hosted project `jwcfrrfainrdnifkezzb` on 2026-10-18 after explicit approval; the post-deployment dry-run reported no pending migrations. Other environments must apply it before relying on permanent history. Until deployed, the application retains the legacy 60-day announcement and 14-day product windows. The migration backfills available sources; deleted sources and earlier support states cannot be reconstructed. Future hosted deployments still require target and migration confirmation.

To test the migration and account isolation against the running local database without persisting changes (PowerShell):

```powershell
@('BEGIN;', (Get-Content -Raw supabase/migrations/20261018210000_durable_notification_inbox.sql), (Get-Content -Raw supabase/tests/durable_notification_inbox.sql), 'ROLLBACK;') | docker exec -i supabase_db_rontab psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run test:notifications
npm run build
```

With the local Supabase database running, verify simultaneous last-seat voucher reservations with:

```bash
npm run test:offer-concurrency
```

## Supabase configuration

`.env.local` contains the project URL and publishable key and is ignored by Git. Copy `.env.example` (committed, lists every supported variable) when configuring another environment. Set `NEXT_PUBLIC_SITE_URL` to the public origin in production so canonical URLs, `robots.txt` and `sitemap.xml` point at the live domain. Product visit redirects also require `SUPABASE_SERVICE_ROLE_KEY`, available in the Supabase project's API keys. Add it only to the server-side `.env.local` file, never to a `NEXT_PUBLIC_` variable or source control, then restart `npm run dev`.

Local migration files do not imply hosted deployment. Confirm the linked project's migration status before deploying changes.

### Optional local database

Docker Desktop is only required for a local Supabase stack. Start Docker, then run:

```bash
npm run db:start
npm run db:reset
npm run db:lint
```

`db:reset` rebuilds only the local database and applies files under `supabase/migrations`. It does not change the hosted project.

### Future hosted migrations

For each remote schema change, review the SQL and inspect a dry-run before applying it:

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Do not push unless the target project and proposed migration are confirmed. Enter CLI tokens and database passwords only in a local terminal prompt. Admin users must be created in Supabase Auth and granted `app_metadata.role = "admin"` by a trusted operator.
