# Seller Offers and Vouchers

Seller promotions are separate from administrator-created loyalty offers. Sellers submit a draft with the promotion, UK branches, weekly schedule, requested daily capacity, and media. Submitted requests cannot be changed unless an administrator requests changes. Approval snapshots the final terms, points cost, and daily capacity; publication creates a quota for each scheduled date and time.

## Visitor reservations

- Only verified visitor accounts in an enabled UK city can reserve an offer available in their saved city.
- The visitor confirms the point cost and cancellation terms before booking. A database transaction locks the visitor balance and daily quota, creates one unique voucher code, deducts points, and records the reservation together.
- A visitor may reserve an offer once per offer per UK date. Retrying the same reservation is idempotent and returns the existing voucher.
- Vouchers cannot be transferred. A visitor can cancel before the scheduled offer window starts; the system then restores the points and releases the quota. Cancellation is closed once the window starts.
- Unused vouchers expire at the end of their scheduled window without a refund. Expired or cancelled reservations do not permit a second reservation for that offer on the same date.
- An active seller can redeem a voucher code only for their own offer and during its scheduled UK-local window. A voucher can be redeemed once.

## Seller audience privacy

Audience counts use verified eligible visitor profiles in the branch city. Counts below five are withheld; visible counts are aggregates only. Profile city is self-reported and is not proof of residence.

## Media and operations

Uploaded offer media is stored in a private Supabase bucket. Sellers can read and remove media only for editable requests; administrators can review submitted media, and visitors can read media only for published offers. The gallery and review page use short-lived signed URLs.

Apply repository migrations to a local database for testing. Do not apply these migrations to the linked production database without explicit approval. Run `npm run test:offer-concurrency` with the local Supabase stack running to exercise two simultaneous requests for the last daily place. SQL smoke files under `supabase/tests` can be run directly through local `psql`; the current files use rollback-only `DO` blocks rather than pgTAP plans.