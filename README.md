# Rontab

An editorial product discovery experience for home and kitchen finds in the UK and Europe.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current scope

- Responsive English product-discovery storefront with search and category filters.
- Public catalog reads active categories and approved products from Supabase.
- Seller signup starts in pending review; approved sellers can submit products and images.
- Admin access is isolated and requires the verified `app_metadata.role = "admin"` claim.
- Subscription billing, loyalty rewards, and real click analytics are not implemented yet.

The product requirements document is in `docs/Rontab_Product_Specification.docx`.

## Supabase configuration

`.env.local` contains the project URL and publishable key and is ignored by Git. Copy `.env.example` when configuring another environment. Never add a database password, access token, or `service_role` key to browser variables or source control.

The initial schema and seller/admin policy migrations are applied to the hosted Supabase project. Current migration files are under `supabase/migrations`.

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
