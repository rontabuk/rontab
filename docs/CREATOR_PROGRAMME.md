# Creator Programme

## Application and review

Confirmed visitor accounts can submit a public creator profile with a display name, introduction, one to five specialties, up to ten optional audience cities, links to social platforms, and up to three work samples. Audience cities describe where followers are based, not the creator's home. The creator must explicitly consent to publishing these fields. Seller and administrator accounts cannot submit visitor creator applications.

A creator profile is an additional profile linked to the existing visitor account, not an account conversion. Applying does not remove visitor access, loyalty points, or visit history, and the creator signs in with the same account.

Applications move through `submitted`, `changes_requested`, `approved`, `rejected`, `suspended`, and `withdrawn` states. Only public profiles appear in the directory. Review notes are visible to the creator and administrators, not to the public. A creator who changes an approved profile submits a private draft for review; the last approved profile remains public until the new version is approved. A rejection or change request does not remove that approved version. Creators can take their profile offline and submit it again later with fresh public consent. Administrators can reinstate a suspended profile to the status it had before suspension.

## Public information and metrics

Approved profiles show the creator's display name, introduction, specialties, audience cities, platform handles and links, follower counts, and up to three portfolio links. Creators may save a phone number and choose public visibility or collaboration-only visibility; collaboration-only is the default and is never shown to ordinary visitors. Public phone numbers appear only on the creator profile after explicit opt-in and a confirmed account email. The counts are self-reported and are not verified by Rontab. Platform links must use HTTPS and the matching platform domain. Email addresses, account ownership identifiers, and pending edits are not public profile fields.

## Collaboration requests

Active sellers can send a private request to a public creator with a title, brief, and optional proposed compensation. Only the seller and creator can read the request. A creator can accept or decline and include a response while their profile is public; withdrawn or suspended creators cannot respond. Contact information is not exposed by the request workflow. Durable in-app notifications are sent to the creator for new requests and to the seller for creator responses. Either party is notified when the other withdraws or the creator profile becomes unavailable or is restored. Review decisions, suspension, and reinstatement are also sent to the creator.

### Product promotion opportunities

Active sellers with a public shop profile can open one promotion opportunity for an approved product, set a visible budget, select creator specialties and either the whole United Kingdom or up to fifteen target cities, describe the requested content, set an optional deadline, and indicate whether they will provide the product. The public shop profile lists the shop name, description, location, website, and approved products. Only approved creators matching the specialties and at least one selected audience city can see a city-targeted opportunity. Nationwide opportunities can be seen by matching creators without a listed audience city.

Creators can submit one pending offer per opportunity, including a price above or below the seller's budget, delivery details, and explicit email and/or phone sharing preferences. They can withdraw a pending offer and submit again. Sellers can compare offers by amount, self-reported social follower totals, and audience city, then select one creator or close the opportunity. Selection marks the remaining pending offers as not selected and reveals only the contact methods both parties chose to share. Seller email and phone must be confirmed before they can be shared; creator email must be confirmed. Creator phone numbers are private and visible only after offer selection.

Rontab does not collect, hold, release, or guarantee campaign payments. The seller and selected creator arrange payment and delivery directly. Seller phone numbers default to collaboration-only and are shared with the selected creator only when chosen for that opportunity. Sellers may separately opt to show a confirmed phone on public product detail pages. Opportunity matching uses approved product and creator snapshots; updating the creator's audience cities remains private until the profile update is approved.

## Fan codes and attribution

Each approved creator receives a unique `RT-` code. A confirmed visitor can follow multiple creators; the `(visitor, creator)` relationship is unique, so re-entering a code does not inflate the fan count. The first accepted code is stored separately as the visitor's original creator referral. Later codes can add follows but do not replace that attribution. Entering a code gives the visitor no loyalty points and does not automatically grant promotion credits to the creator.

## Creator points

Creator points are separate from visitor loyalty points. Administrators can grant points to approved creators with a recorded reason. Grants are positive, bounded, idempotent, and recorded in the admin audit log. Creators can view their balance and grant history. Creator points do not currently have a redemption flow.

## Database rollout

Apply all migrations in timestamp order, including `20261015140000_creator_profiles.sql`, `20261015150000_restrict_creator_private_select.sql`, `20261015160000_creator_profile_enrichment.sql`, `20261015170000_creator_private_draft_policies.sql`, `20261015180000_creator_platform_revision_uniqueness.sql`, `20261015190000_creator_collaboration_notifications.sql`, `20261015200000_creator_fan_codes.sql`, `20261015210000_prevent_creator_self_follow.sql`, `20261015220000_creator_lifecycle_controls.sql`, `20261015230000_creator_notification_events.sql`, `20261016090000_creator_product_opportunities.sql`, the follow-up validation migrations `20261016091000_fix_creator_opportunity_array_validation.sql`, `20261016092000_fix_creator_proposal_contact_upsert.sql`, `20261016093000_cast_creator_opportunity_contacts.sql`, contact-visibility migrations `20261016100000_creator_seller_phone_visibility.sql`, `20261016101000_public_seller_contact_phone_batch.sql`, `20261016102000_public_creator_contact_phone.sql`, `20261016103000_keep_public_creator_phone_during_profile_review.sql`, and `20261016104000_require_public_shop_for_creator_opportunities.sql`. These migrations add private draft and approved audience-city snapshots, targeted product opportunities, proposals, explicit phone visibility preferences, and narrow public/selected-party contact RPCs.