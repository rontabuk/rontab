# Creator Programme

## Application and review

Confirmed visitor accounts can submit a public creator profile with a display name, introduction, one to five specialties, and links to social platforms. Seller and administrator accounts cannot submit visitor creator applications.

Applications move through `submitted`, `changes_requested`, `approved`, `rejected`, and `suspended` states. Only approved profiles appear in the public directory. Review notes are visible to the creator and administrators, not to the public. A creator who changes an approved profile submits it for review again; the existing public page is hidden until the new submission is approved.

## Public information and metrics

Approved profiles show the creator's display name, introduction, specialties, platform handles and links, follower counts, and the date each count was last updated. The counts are self-reported and are not verified by Rontab. Platform links must use HTTPS and the matching platform domain. Email addresses and account ownership identifiers are not public profile fields.

## Creator points

Creator points are separate from visitor loyalty points. Administrators can grant points to approved creators with a recorded reason. Grants are positive, bounded, idempotent, and recorded in the admin audit log. Creators can view their balance and grant history. Creator points do not currently have a redemption flow.

## Database rollout

Apply `supabase/migrations/20261015140000_creator_profiles.sql` to the target Supabase environment before enabling the creator routes. The migration uses row-level security for public approved profiles, owner-only application data, and administrator-only mutations through database functions.