# Creator Programme

## Application and review

Confirmed visitor accounts can submit a public creator profile with a display name, introduction, one to five specialties, an optional primary audience city, links to social platforms, and up to three work samples. The creator must explicitly consent to publishing these fields. Seller and administrator accounts cannot submit visitor creator applications.

Applications move through `submitted`, `changes_requested`, `approved`, `rejected`, `suspended`, and `withdrawn` states. Only public profiles appear in the directory. Review notes are visible to the creator and administrators, not to the public. A creator who changes an approved profile submits a private draft for review; the last approved profile remains public until the new version is approved. A rejection or change request does not remove that approved version. Creators can take their profile offline and submit it again later with fresh public consent. Administrators can reinstate a suspended profile to the status it had before suspension.

## Public information and metrics

Approved profiles show the creator's display name, introduction, specialties, primary audience city, platform handles and links, follower counts, and up to three portfolio links. The counts are self-reported and are not verified by Rontab. Platform links must use HTTPS and the matching platform domain. Email addresses, account ownership identifiers, and pending edits are not public profile fields.

## Collaboration requests

Active sellers can send a private request to a public creator with a title, brief, and optional proposed compensation. Only the seller and creator can read the request. A creator can accept or decline and include a response while their profile is public; withdrawn or suspended creators cannot respond. Contact information is not exposed by the request workflow. Durable in-app notifications are sent to the creator for new requests and to the seller for creator responses. Either party is notified when the other withdraws or the creator profile becomes unavailable or is restored. Review decisions, suspension, and reinstatement are also sent to the creator.

## Fan codes and attribution

Each approved creator receives a unique `RT-` code. A confirmed visitor can follow multiple creators; the `(visitor, creator)` relationship is unique, so re-entering a code does not inflate the fan count. The first accepted code is stored separately as the visitor's original creator referral. Later codes can add follows but do not replace that attribution. Entering a code gives the visitor no loyalty points and does not automatically grant promotion credits to the creator.

## Creator points

Creator points are separate from visitor loyalty points. Administrators can grant points to approved creators with a recorded reason. Grants are positive, bounded, idempotent, and recorded in the admin audit log. Creators can view their balance and grant history. Creator points do not currently have a redemption flow.

## Database rollout

Apply the creator migrations in timestamp order, including `20261015140000_creator_profiles.sql`, `20261015150000_restrict_creator_private_select.sql`, `20261015160000_creator_profile_enrichment.sql`, `20261015170000_creator_private_draft_policies.sql`, `20261015180000_creator_platform_revision_uniqueness.sql`, `20261015190000_creator_collaboration_notifications.sql`, `20261015200000_creator_fan_codes.sql`, and `20261015210000_prevent_creator_self_follow.sql`. They use row-level security to keep drafts private, expose only approved snapshots, restrict collaboration requests to participants, and make fan/referral records idempotent.