import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, BadgeCheck, Check, Coins, ExternalLink, MessageSquareText, X } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { SellerVerificationBadge } from "@/components/seller/SellerVerificationBadge";
import { CreatorFanTools } from "@/components/creator/CreatorFanTools";
import { MultiCityPicker } from "@/components/MultiCityPicker";
import { respondToCreatorCollaborationRequest, saveCreatorContactPreferences, withdrawCreatorProfile } from "@/app/visitor/creator-actions";
import { creatorPlatforms, creatorSpecialties } from "@/lib/creator/catalog";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import { getVisitorAccount } from "@/lib/visitor/access";
import { saveCreatorApplication } from "@/app/visitor/creator-actions";
import type { Database } from "@/lib/supabase/database.types";
import "../visitor.css";

export const metadata: Metadata = { title: "Creator profile", robots: { index: false, follow: false } };
export const instant = false;

type CreatorProfile = Pick<
  Database["public"]["Tables"]["creator_profiles"]["Row"],
  "id" | "slug" | "display_name" | "bio" | "specialties" | "status" | "is_public" | "submitted_at" | "audience_city_id" | "public_profile_consent_at" | "referral_code"
>;
type CreatorPlatformAccount = Pick<
  Database["public"]["Tables"]["creator_platform_accounts"]["Row"],
  "id" | "creator_profile_id" | "platform" | "handle" | "profile_url" | "follower_count" | "followers_updated_at" | "is_published"
>;
type CreatorPortfolioItem = Pick<Database["public"]["Tables"]["creator_portfolio_items"]["Row"], "id" | "title" | "url" | "position" | "is_published">;
type CreatorCollaborationRequest = Pick<
  Database["public"]["Tables"]["creator_collaboration_requests"]["Row"],
  "id" | "seller_profile_id" | "title" | "brief" | "proposed_compensation" | "status" | "created_at" | "creator_response"
>;
type CreatorPointTransaction = Pick<
  Database["public"]["Tables"]["creator_point_transactions"]["Row"],
  "id" | "points_delta" | "reason" | "created_at"
>;

const statusCopy: Record<string, string> = {
  submitted: "Your profile is being reviewed.",
  changes_requested: "The review team asked for changes. Update your details and submit again.",
  rejected: "This application was not approved. You can revise it and submit again.",
  approved: "Your profile is public. Any changes you submit will be reviewed before they appear.",
  suspended: "This profile is currently unavailable. Contact Rontab support if you need help.",
  withdrawn: "Your profile is offline. You can submit it again with public consent.",
};

export default async function VisitorCreatorPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; replied?: string; withdrawn?: string; contactSaved?: string }>;
}) {
  await connection();
  const [{ submitted, replied, withdrawn, contactSaved }, { supabase }, { cities }] = await Promise.all([
    searchParams,
    getVisitorAccount("/visitor/creator"),
    getSupportedLocations(),
  ]);
  const { data: profileId, error: profileIdError } = await supabase.rpc("get_my_creator_profile_id");
  if (profileIdError) throw new Error(profileIdError.message);

  let profile: CreatorProfile | null = null;
  let accounts: CreatorPlatformAccount[] = [];
  let reviewNote: string | null = null;
  let pointsBalance = 0;
  let fanCount = 0;
  let firstReferralCount = 0;
  let pointTransactions: CreatorPointTransaction[] = [];
  let portfolioItems: CreatorPortfolioItem[] = [];
  let collaborationRequests: CreatorCollaborationRequest[] = [];
  let audienceCityIds: string[] = [];
  let creatorContact: Pick<Database["public"]["Tables"]["creator_contact_details"]["Row"], "phone" | "phone_visibility"> | null = null;
  if (profileId) {
    const [profileResult, accountsResult, reviewsResult, pointsResult, historyResult, portfolioResult, collaborationResult, fanStatsResult, audienceCitiesResult, contactResult] = await Promise.all([
      supabase.from("creator_profiles").select("id,slug,display_name,bio,specialties,status,is_public,submitted_at,audience_city_id,public_profile_consent_at,referral_code").eq("id", profileId).single(),
      supabase.from("creator_platform_accounts").select("id,creator_profile_id,platform,handle,profile_url,follower_count,followers_updated_at,is_published").eq("creator_profile_id", profileId).order("platform"),
      supabase.from("creator_profile_reviews").select("review_note").eq("creator_profile_id", profileId).order("created_at", { ascending: false }).limit(1),
      supabase.from("creator_point_accounts").select("points_balance").eq("creator_profile_id", profileId).single(),
      supabase.from("creator_point_transactions").select("id,points_delta,reason,created_at").eq("creator_profile_id", profileId).order("created_at", { ascending: false }).limit(20),
      supabase.from("creator_portfolio_items").select("id,title,url,position,is_published").eq("creator_profile_id", profileId).order("position"),
      supabase.from("creator_collaboration_requests").select("id,seller_profile_id,title,brief,proposed_compensation,status,created_at,creator_response").eq("creator_profile_id", profileId).order("created_at", { ascending: false }).limit(20),
      supabase.rpc("creator_get_my_fan_stats"),
      supabase.from("creator_profile_audience_cities").select("city_id,is_published").eq("creator_profile_id", profileId),
      supabase.from("creator_contact_details").select("phone,phone_visibility").eq("creator_profile_id", profileId).maybeSingle(),
    ]);
    for (const result of [profileResult, accountsResult, reviewsResult, pointsResult, historyResult, portfolioResult, collaborationResult, fanStatsResult, audienceCitiesResult, contactResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    if (!profileResult.data) throw new Error("Creator profile is unavailable.");
    const savedProfile = profileResult.data;
    profile = savedProfile;
    accounts = accountsResult.data ?? [];
    reviewNote = reviewsResult.data?.[0]?.review_note ?? null;
    pointsBalance = pointsResult.data?.points_balance ?? 0;
    pointTransactions = historyResult.data ?? [];
    portfolioItems = portfolioResult.data ?? [];
    collaborationRequests = collaborationResult.data ?? [];
    fanCount = fanStatsResult.data?.[0]?.fan_count ?? 0;
    firstReferralCount = fanStatsResult.data?.[0]?.first_referral_count ?? 0;
    creatorContact = contactResult.data;
    audienceCityIds = (audienceCitiesResult.data ?? []).filter((city) => !city.is_published).map((city) => city.city_id);
    if (!audienceCityIds.length && savedProfile.audience_city_id) audienceCityIds = [savedProfile.audience_city_id];
  }

  const useDraft = Boolean(profile && profile.status !== "approved");
  const formAccounts = accounts.filter((account) => account.is_published === !useDraft);
  const formPortfolio = portfolioItems.filter((item) => item.is_published === !useDraft);
  const accountsByPlatform = new Map(formAccounts.map((account) => [account.platform, account]));
  const portfolioByPosition = new Map(formPortfolio.map((item) => [item.position, item]));
  const requestSellerIds = [...new Set(collaborationRequests.map((request) => request.seller_profile_id))];
  const [{ data: requestSellers, error: requestSellersError }, { data: requestSellerBadges, error: requestSellerBadgesError }] = requestSellerIds.length
    ? await Promise.all([
        supabase.from("seller_profiles").select("id,shop_name").in("id", requestSellerIds),
        supabase.rpc("get_public_seller_verification_badges", { p_seller_profile_ids: requestSellerIds }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (requestSellersError) throw new Error(requestSellersError.message);
  if (requestSellerBadgesError) throw new Error(requestSellerBadgesError.message);
  const sellerNames = new Map((requestSellers ?? []).map((seller) => [seller.id, seller.shop_name]));
  const sellerBadges = new Map((requestSellerBadges ?? []).filter((badge) => badge.is_verified).map((badge) => [badge.seller_profile_id, badge]));
  const statusDescription = profile?.status === "submitted" && profile.is_public
    ? "Your updates are being reviewed. Your previously approved profile remains public."
    : profile?.status === "submitted"
      ? `${statusCopy.submitted} It will not appear publicly until approved.`
      : profile?.status === "changes_requested" && profile.is_public
        ? `${statusCopy.changes_requested} Your previously approved profile remains public.`
        : profile?.status === "rejected" && profile.is_public
          ? `${statusCopy.rejected} Your previously approved profile remains public.`
          : statusCopy[profile?.status ?? ""] ?? "Your application status is being updated.";

  return (
    <main className="admin-overview visitor-creator-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CREATOR PROGRAMME</p>
        <h1>Introduce yourself</h1>
        <p>Share what you create and where your audience follows you. Approved profiles are visible to the Rontab community and sellers.</p>
      </header>

      {!profile && (
        <section className="creator-account-choice" aria-labelledby="creator-account-choice-title">
          <p className="admin-eyebrow">SAME ACCOUNT</p>
          <h2 id="creator-account-choice-title">Add a creator profile to this account</h2>
          <p>This adds creator features without replacing your visitor account. Your loyalty points, visit history, and regular account access stay unchanged, and you keep using the same sign-in.</p>
        </section>
      )}

      {submitted === "1" && <p className="admin-save-success" role="status">Your creator profile has been submitted for review.</p>}
      {replied === "1" && <p className="admin-save-success" role="status">Your collaboration response has been sent.</p>}
      {withdrawn === "1" && <p className="admin-save-success" role="status">Your profile is now offline. You can apply again whenever you are ready.</p>}
      <div className="creator-programme-links">
        <Link href="/creators">Browse approved creators <ArrowUpRight size={15} aria-hidden="true" /></Link>
        <Link href="/visitor/creator/opportunities">Available product promotions <ArrowUpRight size={15} aria-hidden="true" /></Link>
        {profile?.is_public && <Link href={`/creators/${profile.slug}`}><ExternalLink size={14} aria-hidden="true" />View your public profile</Link>}
      </div>

      {profile && (
        <section className="creator-application-status" aria-labelledby="creator-status-title">
          <div>
            <p className="admin-eyebrow">APPLICATION STATUS</p>
            <h2 id="creator-status-title"><span className={`creator-status-dot is-${profile.status}`} />{profile.status.replaceAll("_", " ")}</h2>
            <p>{statusDescription}</p>
            {reviewNote && <p className="creator-review-note"><strong>Review note:</strong> {reviewNote}</p>}
          </div>
          <div className="creator-points-balance">
            <Coins size={17} aria-hidden="true" />
            <span><strong>{formatNumber(pointsBalance)}</strong><small>creator points</small></span>
          </div>
        </section>
      )}

      {profile?.is_public && profile.referral_code && (
        <CreatorFanTools
          displayName={profile.display_name}
          code={profile.referral_code}
          profileUrl={`/creators/${profile.slug}`}
          fanCount={fanCount}
          firstReferralCount={firstReferralCount}
          platforms={accounts.filter((account) => account.is_published).map((account) => account.platform === "x" ? "X" : account.platform)}
        />
      )}

      {contactSaved === "1" && <p className="admin-save-success" role="status">Creator phone and visibility preferences saved.</p>}
      {profile && (
        <section className="creator-contact-section" aria-labelledby="creator-contact-title">
          <div className="visitor-profile-heading">
            <p className="admin-eyebrow">CONTACT PREFERENCES</p>
            <h2 id="creator-contact-title">Your phone number</h2>
            <p>Choose whether everyone can see it on your public creator profile or only a seller whose offer you choose to share it with.</p>
          </div>
          <ActionForm className="creator-application-form creator-contact-preferences" action={saveCreatorContactPreferences}>
            <label>Phone number
              <input name="phone" type="tel" autoComplete="tel" defaultValue={creatorContact?.phone ?? ""} maxLength={32} placeholder="+44…" />
            </label>
            <label>Who can see your phone?
              <select name="phone_visibility" defaultValue={creatorContact?.phone_visibility ?? "collaborations"}>
                <option value="collaborations">Only a seller after I share it in an offer and they select me</option>
                <option value="public">Anyone viewing my public creator profile</option>
              </select>
              <small>Public visibility requires a confirmed account email. Collaboration-only numbers are never shown to ordinary visitors.</small>
            </label>
            <button className="admin-primary-button" type="submit">Save phone preferences</button>
          </ActionForm>
        </section>
      )}

      {profile && profile.status !== "suspended" && profile.status !== "withdrawn" && (
        <form className="creator-withdraw-action" action={withdrawCreatorProfile}>
          <p>Take your profile offline. It will no longer appear in the creator directory or accept new collaboration requests.</p>
          <button className="admin-reject-button" type="submit">Take profile offline</button>
        </form>
      )}

      {profile?.status === "suspended" ? (
        <p className="creator-suspended-note">Your profile cannot be edited while it is suspended.</p>
      ) : (
        <details className="creator-application-section" open={Boolean(profile && (profile.status === "changes_requested" || profile.status === "rejected"))}>
          <summary className="creator-application-summary">
            <span className="admin-eyebrow">YOUR PUBLIC PROFILE</span>
            <strong>{profile ? "Update your application" : "Apply with this account"}</strong>
            <small>{profile ? "Open to edit your profile details." : "Your visitor account and points will remain unchanged."}</small>
          </summary>
          {profile?.is_public && <p className="creator-edit-notice">Changes stay private during review. Your current approved profile remains visible until updates are approved.</p>}
          <ActionForm className="creator-application-form" action={saveCreatorApplication}>
            <label>
              Public display name
              <input name="display_name" defaultValue={profile?.display_name ?? ""} minLength={2} maxLength={100} autoComplete="nickname" required />
            </label>

            <div className="creator-audience-location">
              <p>Audience cities <small>Optional. Choose up to 10 cities where your audience is based, not your home address.</small></p>
              <MultiCityPicker
                name="audience_city_id"
                cities={cities}
                initialCityIds={audienceCityIds}
                maxSelected={10}
              />
            </div>
            <label>
              About you and your content
              <textarea name="bio" defaultValue={profile?.bio ?? ""} minLength={30} maxLength={2000} rows={6} required />
              <small>30 to 2,000 characters. Do not include private contact details.</small>
            </label>

            <fieldset className="creator-specialties">
              <legend>Content specialties <small>Choose 1 to 5</small></legend>
              <div>
                {creatorSpecialties.map(({ value, label }) => (
                  <label key={value}>
                    <input name="specialty" type="checkbox" value={value} defaultChecked={profile?.specialties.includes(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="creator-platforms">
              <legend>Social platforms <small>Add at least one. Follower counts are self-reported.</small></legend>
              <div className="creator-platform-list">
                {creatorPlatforms.map(({ value, label }) => {
                  const account = accountsByPlatform.get(value);
                  return (
                    <div className="creator-platform-row" key={value}>
                      <h3>{label}</h3>
                      <label>
                        Handle
                        <input name={`platform_${value}_handle`} defaultValue={account?.handle ?? ""} maxLength={100} autoComplete="off" />
                      </label>
                      <label>
                        Profile link
                        <input name={`platform_${value}_url`} type="url" defaultValue={account?.profile_url ?? ""} maxLength={500} placeholder="https://" />
                      </label>
                      <label>
                        Followers
                        <input name={`platform_${value}_followers`} type="number" min="0" max="1000000000" step="1" defaultValue={account?.follower_count ?? ""} inputMode="numeric" />
                      </label>
                    </div>
                  );
                })}
              </div>
              <p className="creator-metrics-disclaimer">Numbers are displayed with their last update date and are not verified by Rontab.</p>
            </fieldset>

            <fieldset className="creator-portfolio">
              <legend>Work samples <small>Optional. Add up to three public links.</small></legend>
              {[1, 2, 3].map((position) => {
                const item = portfolioByPosition.get(position);
                return (
                  <div className="creator-portfolio-row" key={position}>
                    <label>Sample {position} title<input name={`portfolio_${position}_title`} defaultValue={item?.title ?? ""} maxLength={120} /></label>
                    <label>HTTPS link<input name={`portfolio_${position}_url`} type="url" defaultValue={item?.url ?? ""} maxLength={500} placeholder="https://" /></label>
                  </div>
                );
              })}
            </fieldset>

            <label className="creator-public-consent">
              <input name="public_profile_consent" type="checkbox" required />
              <span>I agree that my name, introduction, specialties, audience cities, platform links, follower counts, and work samples may appear on my public Rontab creator profile.</span>
            </label>
            <button className="admin-primary-button" type="submit">{profile ? "Save and submit for review" : "Submit for review"}</button>
          </ActionForm>
        </details>
      )}

      {pointTransactions.length > 0 && (
        <section className="creator-points-history" aria-labelledby="creator-points-history-title">
          <div className="visitor-profile-heading">
            <p className="admin-eyebrow">CREATOR POINTS</p>
            <h2 id="creator-points-history-title">Points history</h2>
          </div>
          <ul>
            {pointTransactions.map((transaction) => (
              <li key={transaction.id}>
                <span><strong>+{formatNumber(transaction.points_delta)} points</strong><small>{transaction.reason}</small></span>
                <time dateTime={transaction.created_at}>{formatDateTime(transaction.created_at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
      {collaborationRequests.length > 0 && (
        <section className="creator-collaboration-inbox" aria-labelledby="creator-collaboration-title">
          <div className="visitor-profile-heading">
            <p className="admin-eyebrow">SELLER INQUIRIES</p>
            <h2 id="creator-collaboration-title">Collaboration requests</h2>
          </div>
          {collaborationRequests.map((request) => (
            <article className="creator-collaboration-item" key={request.id}>
              <div>
                <span className={`creator-collaboration-status is-${request.status}`}>{request.status}</span>
                <h3>{request.title}</h3>
                <p>From {sellerNames.get(request.seller_profile_id) ?? "Rontab seller"} {sellerBadges.has(request.seller_profile_id) && <SellerVerificationBadge isBlue={sellerBadges.get(request.seller_profile_id)?.is_blue ?? false} />} · {formatDateTime(request.created_at)}</p>
                <p>{request.brief}</p>
                {request.proposed_compensation && <p><strong>Proposed compensation:</strong> {request.proposed_compensation}</p>}
              </div>
              {request.status === "pending" && (
                <div className="creator-collaboration-actions">
                  <form action={respondToCreatorCollaborationRequest}>
                    <input type="hidden" name="request_id" value={request.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <label>Optional response<input name="response" maxLength={2000} /></label>
                    <button className="admin-approve-button" type="submit"><Check size={14} aria-hidden="true" />Accept request</button>
                  </form>
                  <form action={respondToCreatorCollaborationRequest}>
                    <input type="hidden" name="request_id" value={request.id} />
                    <input type="hidden" name="decision" value="decline" />
                    <label>Optional response<input name="response" maxLength={2000} /></label>
                    <button className="admin-reject-button" type="submit"><X size={14} aria-hidden="true" />Decline</button>
                  </form>
                </div>
              )}
              {request.status !== "pending" && request.creator_response && <p className="creator-collaboration-response"><MessageSquareText size={14} aria-hidden="true" />{request.creator_response}</p>}
            </article>
          ))}
        </section>
      )}
      <p className="creator-profile-footnote"><BadgeCheck size={14} aria-hidden="true" />Approval means the profile passed Rontab review. Platform metrics remain self-reported unless explicitly marked otherwise.</p>
    </main>
  );
}