# Rontab Admin Access

The admin portal is separate from the public storefront and has no public sign-up. `/admin` requires a valid Supabase Auth session whose verified user has `app_metadata.role` set to `admin`. Authorization is checked again on the server; hiding the route in the UI is not the security boundary.

## Configure

1. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
2. Create the administrator account from the Supabase Dashboard under **Authentication → Users**. Do not add an admin sign-up form to the public site.
3. Edit that user's **app metadata** to include `{ "role": "admin" }`. Never put this value in user metadata, which users can edit themselves.
4. Sign out and sign in again so Supabase issues a token with the updated app metadata.
5. Visit `/admin/login`.

Never expose a Supabase `service_role` key to the browser or commit it to the repository. Any future admin data actions must repeat a server-side role check and use database RLS policies.