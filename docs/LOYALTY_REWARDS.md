# Rontab Loyalty and Rewards

## Purpose

Extend visitor points into an auditable loyalty programme with two distinct
offer types: limited participation and guaranteed redemption. The product UI is
English to match Rontab's current launch language.

## Current point rules

- Only authenticated, email-confirmed visitor accounts earn points.
- Seller and administrator accounts are not eligible for visitor rewards.
- A visitor earns one point on their first eligible product visit. Repeat visits
  to that product do not award another point.
- Product visits award at most the administrator-configured number of points
  per visitor in a rolling 24-hour period (default 250, configurable from 1 to
  250). Visits after the cap still work but do not award points; serialize this
  check per visitor in PostgreSQL to prevent concurrent requests exceeding it.
- Show the visitor their earned points against the rolling limit and state when
  the limit is reached. Account navigation must show the current spendable
  balance, not lifetime product visits.
- Guest visits do not award points and do not consume seller click credits.
- Keep loyalty-point accounting separate from seller advertising click counts.
- Migrate each existing `visitor_product_points` row as one earned point; do not
  reset or silently change existing balances.

## Offer types

### Limited participation

- An administrator sets the minimum eligible balance, points charged per entry,
  entry window, eligible city/country, image, terms, and number of winners.
- Minimum eligibility and entry cost are separate settings.
- No points are charged unless the visitor explicitly confirms participation.
- Charge the configured entry cost once on confirmation. A participant spends
  those points whether selected or not; non-participants lose nothing.
- One entry per visitor per offer by default.
- Support an administrator-run random draw, but keep random-draw offers disabled
  and hidden from visitors until a platform administrator explicitly enables
  random draws and publishes an offer.
- Store the draw result and participants in an auditable record.

### Guaranteed redemption

- An administrator sets the required balance, point cost, available quantity,
  dates, eligible city/country, image, fulfilment details, and terms.
- A confirmed redemption is guaranteed while stock remains.
- Lock stock and deduct points atomically when the visitor confirms the claim.
- Viewing an offer or being eligible does not reserve stock or deduct points.

## Location rules

- Visitors save one city and country in their profile; an offer may target one
  or more city/country pairs, or be available without a location restriction.
- Current rollout enables only the United Kingdom (`GB`). Country and city
  selectors read enabled rows from `supported_countries` and `supported_cities`;
  adding another country later requires loading its licensed city dataset and
  enabling that country, not changing the picker UI.
- The current location scope is the United Kingdom only. The picker uses 1,305
  UK city/town records from
  `world-cities-json` (SimpleMaps World Cities Database, CC BY 4.0), keyed by
  stable source IDs. Other countries are unavailable until their country and
  city records are intentionally enabled. This covers the source's listed populated places; it is
  not a postcode directory and may not contain every village or locality.
- Each targeted city has an independent capacity slider. The offer's total
  capacity is the sum of its city quotas; the administrator cannot set a
  conflicting separate total. With no city quotas, one global capacity slider
  applies everywhere.
- Compare normalized city and country values on the server/database.
- Prevent profile city/country changes when the current or requested location
  matches a published, active city quota. Enforce this in PostgreSQL, not only
  in the form.
- Capture the visitor's eligible location on each participation or redemption
  record so later profile changes cannot alter past eligibility.
- The profile location is self-declared in this release; do not describe it as
  verified residence.

## Administrator controls

- Administrators create and edit drafts, preview eligible visitor counts,
  publish, pause, complete, and review offers.
- The system may calculate eligible counts and suggest quantities, but never
  publishes an offer or changes its terms automatically.
- Random draws are disabled by default. When disabled, random offers cannot be
  published and are not returned to visitor pages.
- Record sensitive actions in `admin_audit_logs`, including offer creation,
  publication, pause/cancellation, random-draw toggle, and draw execution.
- Do not delete published offers or point transactions; preserve history.

## Outcomes, fulfilment, and support

- Notify each visitor when a participation result is final or a guaranteed reward
  is successfully claimed. Result notifications are per claim and have an
  independent read state.
- Selected and redeemed rewards remain pending fulfilment until an administrator
  records a delivery note. An optional receipt, shipment, or case reference can
  be recorded with the administrator and timestamp in the audit history.
- Administrators may attach a PDF, JPEG, PNG, or WebP delivery proof up to 10 MB.
  Evidence files are private; only administrators can read them through a
  short-lived signed link in the reward record.
- A visitor may submit one support report for a selected or redeemed reward.
  Reports are limited to delivery or reward-quality issues and are visible to
  that visitor and administrators only.
- Administrators move reports through open, in-review, and resolved states.
  Resolution requires a note and is audited. Resolving a support report does not
  mark a gift delivered, alter a claim result, refund points, or modify the
  points ledger.
- No automatic points refund or compensation is provided for support reports.
  Any future compensation policy must define eligibility, limits, authorization,
  and a separately audited points-ledger operation before implementation.

## Visitor experience

- Add a dedicated Points & Rewards view under the visitor account.
- Show current balance, earned/spent totals, recent activity, and progress to
  the next relevant point threshold.
- Display active, eligible offers with image, offer type, location, dates,
  eligibility balance, point cost, availability, and clear terms.
- Keep entry, result, and redemption history visible to the visitor.
- Present point activity and offer history as separate views, each paginated in
  stable newest-first order; include the points spent on each offer claim.
- Explain that participation costs points regardless of outcome before the
  visitor confirms.
- Explain that redemption is guaranteed only after a successful claim while
  stock is available.

## Data and security contract

- Use an append-only point transaction ledger and a transactionally maintained
  balance row. Clients may read their own records but cannot write balances,
  transactions, entries, or redemption results directly.
- Use unique constraints and row locks to prevent duplicate entries,
  double-spending, and overselling the final redemption item.
- Enforce visitor eligibility, email confirmation, role exclusion, location,
  offer status, active dates, balance, stock, and random-draw setting in
  database functions.
- Authenticate and authorize every Server Action; database functions repeat
  sensitive authorization checks.
- Store offer images as HTTPS URLs in the first release. A managed upload flow
  can be added later without changing offer semantics.
- Do not apply schema migrations to the linked production database without
  explicit approval.

## Future changes

For each new request, classify it as a change to participation, redemption,
points, location, administration, or a genuinely new offer type. Record its
effects on eligibility, point movement, audit history, roles, database
constraints, UI states, and tests before implementation. Preserve these rules
unless the administrator explicitly approves a versioned policy change.

## Acceptance criteria

1. Existing visitor balances are unchanged after migration.
2. Guests, sellers, administrators, and unconfirmed users cannot earn, spend,
   or redeem visitor points.
3. A visitor who does not enter an offer retains all points.
4. A confirmed limited-participation entry spends the stated cost once,
   regardless of result; retrying cannot charge a second time.
5. A redemption succeeds only once per offer per visitor and never exceeds
   available stock or the visitor's balance under concurrent requests.
6. A visitor cannot change city/country during an active location-targeted
   offer; eligibility uses the recorded location at claim time.
7. Multiple-city offers keep independent capacities; admin metrics show eligible
  and claimed counts by city, and any draw respects each city's winner quota.
8. Random offers remain hidden and cannot accept entries while random draws are
   disabled; an authorized administrator can enable, publish, and run a draw.
9. Admin operations are audited, and visitors can inspect their point and
   offer history.
10. `npm run lint` and `npm run build` pass. Database migrations are tested
   locally when Docker is available; production push remains a separate,
   approval-gated operation.