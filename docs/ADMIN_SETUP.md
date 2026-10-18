# Rontab Admin Access

The admin portal is separate from the public storefront and has no public sign-up. `/admin` requires a valid Supabase Auth session whose verified user has `app_metadata.role` set to `admin`. Authorization is checked again on the server; hiding the route in the UI is not the security boundary.

## Configure

1. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
2. Create the administrator account from the Supabase Dashboard under **Authentication → Users**. Do not add an admin sign-up form to the public site.
3. Edit that user's **app metadata** to include `{ "role": "admin" }`. Never put this value in user metadata, which users can edit themselves.
4. Sign out and sign in again so Supabase issues a token with the updated app metadata.
5. Visit `/admin/login`.

Never expose a Supabase `service_role` key to the browser or commit it to the repository. Any future admin data actions must repeat a server-side role check and use database RLS policies.

## Category Defaults

Apply `20261018140000_women_category_hierarchy.sql`, `20261018150000_category_visibility_control.sql`, `20261018160000_men_designer_kids_categories.sql`, `20261018170000_home_electronics_categories.sql`, `20261018180000_books_hobbies_sports_categories.sql` and `20261018190000_restaurants_grocery_categories.sql` before deploying the updated category manager. From a locally authenticated, linked Supabase CLI session:

```powershell
npx supabase login
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

The defaults include Women (76 categories), Men (51), Designer (10), Kids (124), Home (143), Electronics (102), Books & Media (22), Hobbies & collectables (67) and Sports (125), counting each department itself. Men contains Clothing, Shoes, Accessories and Grooming; Designer has separate women and men groups; Kids has 12 groups covering clothing, toys, baby equipment, furniture, care, feeding, bedding, school supplies and other items. Home has 14 groups for appliances, kitchenware, household care, textiles, decor, office supplies, celebrations, tools, garden, furniture and pets. Electronics has 10 groups for gaming, computing, phones, audio, photography, tablets, TV, personal care, wearables and other devices. Books & Media has four groups; Hobbies & collectables and Sports each have 12. Only subcategories supplied in the reference screenshots are seeded. Magazines, Board games, Puzzles, Tabletop & miniature gaming and Postcards are directly selectable without unspecified child defaults. The "All" entries are navigation controls, not duplicate database categories. Further departments are not added until specified. Existing custom categories, including legacy Kitchen or Tableware entries and their assigned products, are preserved; matching slugs are not overwritten, moved or reactivated.

Restaurants adds 21 categories: the root and 20 directly selectable cuisine or meal-type branches, without another seeded level. Grocery adds 63 categories: the root, 22 groups and 40 subcategories across 12 larger groups (produce, meat, fish, dairy, bakery, grains, frozen food, cooking essentials, drinks, baby essentials, cleaning and paper goods). Smaller groups stay directly selectable. These are catalogue classifications, not delivery, checkout, restaurant-menu modifiers or dietary filters. Flat departments display a single two-column list without repeating their branches; mixed hierarchies retain their group-and-subcategory layout. Both follow the same administrator-owned visibility rules.

Manage them at `/admin/categories` using the expandable, searchable tree. **Visible** saves publication immediately, changing only visibility rather than rewriting the category's other fields. Hiding a parent hides its entire branch and its products from the public catalogue without changing each child's saved visibility. Restoring a parent restores only children that remain individually visible.

Use **Add category**, the plus icon beside a section, or its edit icon to open the single editor. **Parent category** places an entry under another section; **Sort order** determines sibling order. Slug, description and image URL are under **Advanced settings**. New categories receive a generated unique slug when it is left blank, including names written in non-Latin scripts. Editing an existing category preserves its slug and advanced fields unless explicitly changed. Circular parent relationships are rejected. Saves invalidate the public catalogue cache.

Desktop and phone navigation both read this database hierarchy. Main tabs display root sections; their category menu exposes the groups and subcategories. Selecting a parent includes its descendants. No runtime fallback silently reintroduces categories hidden by an administrator.

Rollback-only database smoke tests are `supabase/tests/women_categories_smoke.sql`, `supabase/tests/men_designer_kids_categories_smoke.sql`, `supabase/tests/home_electronics_categories_smoke.sql`, `supabase/tests/books_hobbies_sports_categories_smoke.sql` and `supabase/tests/restaurants_grocery_categories_smoke.sql`. Category visibility, descendant filters and desktop/phone interaction regressions run with `npm run test:catalog`.

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