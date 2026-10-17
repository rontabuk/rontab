# Supabase Setup

## Prerequisites

- Docker Desktop is required only for the optional local database stack.
- `.env.local` containing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the hosted Auth client.
- In hosted Supabase Auth URL Configuration, allow your app's `/auth/callback` and `/seller/login` URLs (for local development: `http://127.0.0.1:3000/**` and `http://localhost:3000/**`).

## Email links

The local Supabase stack uses `supabase/templates/magic_link.html` for email links. For the hosted project, set the Magic Link template in Dashboard → Authentication → Email Templates to use this link:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">Continue to Rontab</a>
```

The app supplies a callback URL with a `flow` query parameter, so the template appends the token hash and email verification type. This lets the link complete on the device that opens the email. Dashboard templates are not changed by database migrations.

## Start and validate the local database

```bash
npm run db:start
npm run db:reset
npm run db:lint
```

`db:reset` rebuilds only the local database and applies files under `supabase/migrations`. It does not change the hosted project. Docker is not required for the application to read hosted Supabase data.

## Remote project

The hosted project is linked to this repository, and the current migrations are applied. For future schema changes, review the migration and inspect a dry-run first:

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Enter CLI tokens and database passwords only in a local terminal prompt; never paste them into chat or source files. Never expose a `service_role` key to the browser or commit it.

## Admin role

Create the account in Supabase Dashboard → Authentication → Users, then set `app_metadata` to `{ "role": "admin" }`. Do not set this in `user_metadata`, which users can edit. Sign out and back in after changing app metadata so the JWT contains the new role.