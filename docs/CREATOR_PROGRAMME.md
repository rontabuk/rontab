# Creator Programme

## Application and review

Confirmed visitor accounts can submit a public creator profile with a display name, introduction, one to five specialties, an optional primary audience city, links to social platforms, and up to three work samples. The creator must explicitly consent to publishing these fields. Seller and administrator accounts cannot submit visitor creator applications.

Applications move through `submitted`, `changes_requested`, `approved`, `rejected`, and `suspended` states. Only approved profiles appear in the public directory. Review notes are visible to the creator and administrators, not to the public. A creator who changes an approved profile submits a private draft for review; the last approved profile remains public until the new version is approved. A rejection or change request does not remove that approved version.

## Public information and metrics

Approved profiles show the creator's display name, introduction, specialties, primary audience city, platform handles and links, follower counts, and up to three portfolio links. The counts are self-reported and are not verified by Rontab. Platform links must use HTTPS and the matching platform domain. Email addresses, account ownership identifiers, and pending edits are not public profile fields.

## Collaboration requests

Active sellers can send a private request to an approved creator with a title, brief, and optional proposed compensation. Only the seller and creator can read the request. A creator can accept or decline and include a response; contact information is not exposed by the request workflow.

## Creator points

Creator points are separate from visitor loyalty points. Administrators can grant points to approved creators with a recorded reason. Grants are positive, bounded, idempotent, and recorded in the admin audit log. Creators can view their balance and grant history. Creator points do not currently have a redemption flow.

## Database rollout

Apply the creator migrations in timestamp order, including `20261015140000_creator_profiles.sql`, `20261015150000_restrict_creator_private_select.sql`, `20261015160000_creator_profile_enrichment.sql`, `20261015170000_creator_private_draft_policies.sql`, and `20261015180000_creator_platform_revision_uniqueness.sql`. They use row-level security to keep drafts private, expose only approved snapshots, and restrict collaboration requests to their participants.