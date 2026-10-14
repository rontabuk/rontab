# Seller Offers and Vouchers

Seller promotions are separate from administrator-created loyalty offers. Sellers submit a draft with the promotion, UK branches, weekly schedule, requested daily capacity, and media. Submitted requests cannot be changed unless an administrator requests changes. Approval snapshots the final terms, points cost, and an independently approved daily capacity for every scheduled branch/time; publication creates a quota for each scheduled date and time.

## Visitor reservations

- Only verified visitor accounts in an enabled UK city can reserve an offer available in their saved city.
- The visitor confirms the point cost and cancellation terms before booking. A database transaction locks the visitor balance and daily quota, creates one unique voucher code, deducts points, and records the reservation together.
- A visitor may reserve an offer once per offer per UK date. Retrying the same reservation is idempotent and returns the existing voucher.
- Vouchers cannot be transferred. A visitor can cancel before the scheduled offer window starts; the system then restores the points and releases the quota. Cancellation is closed once the window starts.
- Unused vouchers expire at the end of their scheduled window without a refund. Expired or cancelled reservations do not permit a second reservation for that offer on the same date.
- An active seller can redeem a voucher code only for their own offer and during its scheduled UK-local window. A voucher can be redeemed once.
- A visitor may report one issue for a voucher that can no longer be cancelled. Administrators review the case and record a resolution note; reporting or resolving a case never refunds or changes points automatically.

## Seller audience privacy

Audience counts use verified eligible visitor profiles in the branch city. Counts below five are withheld; visible counts are aggregates only. Profile city is self-reported and is not proof of residence.

## Media and operations

Uploaded offer media is stored in a private Supabase bucket. Sellers can read and remove media only for editable requests; administrators can review submitted media, and visitors can read media only for published offers. The gallery and review page use short-lived signed URLs.

Apply repository migrations to a local database for testing. Do not apply these migrations to the linked production database without explicit approval. Run `npm run test:offer-concurrency` with the local Supabase stack running to exercise two simultaneous requests for the last daily place. SQL smoke files under `supabase/tests` can be run directly through local `psql`; the current files use rollback-only `DO` blocks rather than pgTAP plans.

## Seller suspension

- Suspending or deactivating a seller automatically pauses that seller's published offers and records each pause in the admin audit log. Paused offers are hidden from visitors and cannot receive new bookings.
- Existing vouchers are preserved, not automatically cancelled or refunded. A suspended seller cannot redeem them while inactive. If the seller is reactivated before a voucher window ends, the seller may redeem an existing voucher against its paused offer; reactivation does not republish the offer or accept new reservations.
- Vouchers cancelled before their window still follow the standard visitor refund rule. Vouchers that expire remain non-refundable under the current published terms; administrators must handle exceptional disputes through support and must not alter balances directly.
- Voucher issue reports appear in the seller-offer admin queue and must be resolved with an administrative note. Point compensation remains a separate, manual decision governed by the published terms; there is no automatic refund path for seller vouchers.