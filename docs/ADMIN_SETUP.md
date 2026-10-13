# Rontab Admin Access

The admin portal is separate from the public storefront and has no public sign-up. `/admin` requires a valid Supabase Auth session whose verified user has `app_metadata.role` set to `admin`. Authorization is checked again on the server; hiding the route in the UI is not the security boundary.

## Configure

1. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
2. Create the administrator account from the Supabase Dashboard under **Authentication → Users**. Do not add an admin sign-up form to the public site.
3. Edit that user's **app metadata** to include `{ "role": "admin" }`. Never put this value in user metadata, which users can edit themselves.
4. Sign out and sign in again so Supabase issues a token with the updated app metadata.
5. Visit `/admin/login`.

Never expose a Supabase `service_role` key to the browser or commit it to the repository. Any future admin data actions must repeat a server-side role check and use database RLS policies.

## Stripe Sandbox: Advertising Credits

Only one-time advertising credit purchases in GBP are supported. Live payments and subscriptions are disabled. Use dedicated test shops: sandbox purchases add spendable credits to the existing advertising balance, so do not allowlist real sellers.

Set these server-only values in `.env.local` or the deployment's secret settings, never in chat or `NEXT_PUBLIC_*` variables:

```dotenv
STRIPE_SECRET_KEY=sk_test_REPLACE_LOCALLY
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_LOCALLY
BILLING_SITE_URL=http://localhost:3000
STRIPE_TEST_SELLER_IDS=REPLACE_WITH_TEST_SELLER_PROFILE_UUID
```

The existing `SUPABASE_SERVICE_ROLE_KEY` is also required. The seller IDs are `seller_profiles.id`, not Auth user IDs; multiple IDs may be comma-separated. The site URL must be an origin only, use HTTPS outside localhost, and match the browser's origin. Restart the development server after changing environment settings. Missing settings, live keys or a non-allowlisted seller keep checkout unavailable.

For local testing, use the official Stripe CLI:

```powershell
stripe login
stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook
```

Enter credentials directly into the terminal/provider dashboard. Put the listener's signing secret in `STRIPE_WEBHOOK_SECRET` locally. On a deployed sandbox, register the HTTPS `/api/stripe/webhook` endpoint in Stripe's test environment with those two event types and use that endpoint's own signing secret instead.

The seller workspace exposes **Test checkout** only for an active allowlisted test shop. Use Stripe's documented test cards, never real card details. A successful return URL does not grant credits: the signed webhook checks Stripe's session and PaymentIntent against the stored price, GBP amount and shop, then atomically applies the credit purchase once. The purchase history records pending, expired and completed test purchases. Returning before the webhook is processed displays a pending status.

Verify one successful checkout, cancellation, an expired checkout, a declined test card and webhook redelivery before release. Redelivery must not increase the balance a second time. Remove a test shop from the allowlist only after its pending sessions are resolved. A real-money launch still needs separate approval, final billing/refund/tax terms and live-mode implementation; refunds and disputes are not supported in this sandbox scope.