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
- Admin access is isolated and requires the verified `app_metadata.role = "admin"` claim, checked in every admin page and action.
- Seller advertising balances use click credits, with a shared pool and optional per-product allocations. New sellers receive a one-time 10,000-click welcome credit; admins can grant more. Credit purchases stay disabled until a payment provider is configured.
- Shop visits by confirmed visitor accounts are recorded on the server once per account and product; guest visits are redirected without spending seller credits or earning points. Subscription billing is not active yet.
- Visitor rewards include an append-only points ledger, city-targeted offers, guaranteed redemptions, and limited participation. Random selection is disabled by default.
- Current location coverage is UK-only. Visitors, sellers, and offer allocations use canonical UK city records; new countries stay unavailable until their supported-country and city data are explicitly added.
- Configure `SUPABASE_SERVICE_ROLE_KEY` as a server-only environment variable for product visit redirects and visitor administration. Never expose it through a `NEXT_PUBLIC_` variable.

The product requirements document is in `docs/Rontab_Product_Specification.docx`.
The loyalty and rewards behavior is specified in `docs/LOYALTY_REWARDS.md`.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Supabase configuration

`.env.local` contains the project URL and publishable key and is ignored by Git. Copy `.env.example` when configuring another environment. Product visit redirects also require `SUPABASE_SERVICE_ROLE_KEY`, available in the Supabase project's API keys. Add it only to the server-side `.env.local` file, never to a `NEXT_PUBLIC_` variable or source control, then restart `npm run dev`.

All migrations under `supabase/migrations`, including loyalty and supported locations, are applied to the hosted Supabase project.

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
