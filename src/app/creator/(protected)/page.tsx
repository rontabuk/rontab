import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, BadgeCheck, Check, ExternalLink, UserRound } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { EmailConfirmationWatcher } from "@/components/EmailConfirmationWatcher";
import { CreatorApplicationFields } from "@/components/creator/CreatorApplicationFields";
import { CreatorFanTools } from "@/components/creator/CreatorFanTools";
import { CreatorInfluenceSummary } from "@/components/creator/CreatorInfluence";
import { resendCreatorEmailVerification, saveCreatorApplication, saveCreatorContactPreferences, withdrawCreatorProfile } from "@/app/creator/(protected)/actions";
import { getCreatorAccount } from "@/lib/creator/access";
import { getCreatorInfluence } from "@/lib/creator/influence-server";
import { getSupportedLocations } from "@/lib/locations";

export const metadata: Metadata = { title: "Creator studio", robots: { index: false, follow: false } };
export const instant = false;

const statusCopy: Record<string, string> = {
  submitted: "Your profile is being reviewed.",
  changes_requested: "The review team asked for changes. Update your details and submit again.",
  rejected: "This application was not approved. You can revise it and submit again.",
  approved: "Your profile is public. Any changes you submit will be reviewed before they appear.",
  suspended: "This profile is currently unavailable. Contact support if you need help.",
  withdrawn: "Your profile is offline. You can submit it again with public consent.",
};

function isWithinLastDay(timestamp: string | null | undefined) {
  return Boolean(timestamp) && Date.now() - Date.parse(timestamp!) < 24 * 60 * 60 * 1000;
}

export default async function CreatorStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; withdrawn?: string; contactSaved?: string; registered?: string; verificationSent?: string; verificationError?: string; emailVerified?: string }>;
}) {
  await connection();
  const [{ submitted, withdrawn, contactSaved, registered, verificationSent, verificationError, emailVerified }, { supabase, user, creatorProfileId: profileId }, { cities }] = await Promise.all([
    searchParams,
    getCreatorAccount(),
    getSupportedLocations(),
  ]);
  const [profileResult, accountsResult, reviewsResult, portfolioResult, fanStatsResult, audienceCitiesResult, contactResult, influenceById, accountProfileResult] = await Promise.all([
    supabase.from("creator_profiles").select("id,slug,display_name,bio,specialties,status,is_public,audience_city_id,referral_code,profile_image_path,cover_image_path,published_profile_image_path,published_cover_image_path").eq("id", profileId).single(),
    supabase.from("creator_platform_accounts").select("platform,handle,profile_url,follower_count,is_published").eq("creator_profile_id", profileId).order("platform"),
    supabase.from("creator_profile_reviews").select("review_note").eq("creator_profile_id", profileId).order("created_at", { ascending: false }).limit(1),
    supabase.from("creator_portfolio_items").select("title,url,position,is_published").eq("creator_profile_id", profileId).order("position"),
    supabase.rpc("creator_get_my_fan_stats"),
    supabase.from("creator_profile_audience_cities").select("city_id,is_published").eq("creator_profile_id", profileId),
    supabase.from("creator_contact_details").select("phone,phone_visibility").eq("creator_profile_id", profileId).maybeSingle(),
    getCreatorInfluence(supabase, [profileId]),
    supabase.from("profiles").select("email_verified_at").eq("id", user.id).maybeSingle(),
  ]);
  for (const result of [profileResult, accountsResult, reviewsResult, portfolioResult, fanStatsResult, audienceCitiesResult, contactResult, accountProfileResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const emailIsVerified = Boolean(accountProfileResult.data?.email_verified_at);
  const emailRecentlyVerified = isWithinLastDay(accountProfileResult.data?.email_verified_at);
  const profile = profileResult.data;
  if (!profile) throw new Error("Creator profile is unavailable.");
  const accounts = accountsResult.data ?? [];
  const reviewNote = reviewsResult.data?.[0]?.review_note ?? null;
  const portfolioItems = portfolioResult.data ?? [];
  const fanCount = fanStatsResult.data?.[0]?.fan_count ?? 0;
  const firstReferralCount = fanStatsResult.data?.[0]?.first_referral_count ?? 0;
  const creatorContact = contactResult.data;
  const influence = influenceById.get(profileId);
  let audienceCityIds = (audienceCitiesResult.data ?? []).filter((city) => !city.is_published).map((city) => city.city_id);
  if (!audienceCityIds.length && profile.audience_city_id) audienceCityIds = [profile.audience_city_id];

  const useDraft = profile.status !== "approved";
  const profileImagePath = useDraft ? profile.profile_image_path ?? profile.published_profile_image_path : profile.published_profile_image_path;
  const coverImagePath = useDraft ? profile.cover_image_path ?? profile.published_cover_image_path : profile.published_cover_image_path;
  const [{ data: profileImageResult, error: profileImageError }, { data: coverImageResult, error: coverImageError }] = await Promise.all([
    profileImagePath ? supabase.storage.from("creator-profile-media").createSignedUrl(profileImagePath, 60 * 60) : { data: null, error: null },
    coverImagePath ? supabase.storage.from("creator-profile-media").createSignedUrl(coverImagePath, 60 * 60) : { data: null, error: null },
  ]);
  if (profileImageError) throw new Error(profileImageError.message);
  if (coverImageError) throw new Error(coverImageError.message);
  const profileImageUrl = profileImageResult?.signedUrl ?? null;
  const coverImageUrl = coverImageResult?.signedUrl ?? null;
  const formAccounts = accounts.filter((account) => account.is_published === !useDraft);
  const formPortfolio = portfolioItems.filter((item) => item.is_published === !useDraft);
  const statusDescription = profile.status === "submitted" && profile.is_public
    ? "Your updates are being reviewed. Your previously approved profile remains public."
    : profile.status === "submitted"
      ? `${statusCopy.submitted} It will not appear publicly until approved.`
      : profile.status === "changes_requested" && profile.is_public
        ? `${statusCopy.changes_requested} Your previously approved profile remains public.`
        : profile.status === "rejected" && profile.is_public
          ? `${statusCopy.rejected} Your previously approved profile remains public.`
          : statusCopy[profile.status] ?? "Your application status is being updated.";

  return (
    <main className="admin-overview creator-studio-page">
      <section className="creator-studio-profile" aria-labelledby="creator-studio-name">
        <div className="creator-profile-cover">
          {coverImageUrl
            ? <Image src={coverImageUrl} alt={`${profile.display_name} cover`} fill unoptimized sizes="(max-width: 700px) 100vw, 900px" />
            : <div className="creator-profile-cover-default"><span>CREATORS</span><strong>Creators who inspire everyday living</strong></div>}
        </div>
        <div className="creator-studio-identity">
          <div className="creator-profile-avatar">
            {profileImageUrl ? <Image src={profileImageUrl} alt={`${profile.display_name} profile picture`} width={88} height={88} unoptimized /> : <UserRound size={34} aria-hidden="true" />}
          </div>
          <div>
            <p className="admin-eyebrow">CREATOR STUDIO</p>
            <h1 id="creator-studio-name">{profile.display_name}</h1>
            <p>{profile.status === "approved" ? "Your public creator profile" : profile.is_public ? "Your updated profile is under review" : "Your creator account"}</p>
            {profile.status !== "suspended" && <Link className="creator-studio-edit-link" href="#creator-profile-editor">Edit creator profile</Link>}
          </div>
        </div>
      </section>

      {registered === "1" && <p className="admin-save-success" role="status">Your creator account is ready and your profile has been sent for review.</p>}
      {emailVerified === "0" && !emailIsVerified && <p className="form-error" role="alert">That confirmation link has expired or was already used. Send a new one below.</p>}
      {!emailIsVerified ? (
        <section className="creator-email-verify" aria-labelledby="creator-email-verify-title">
          <EmailConfirmationWatcher />
          <div>
            <h2 id="creator-email-verify-title">Confirm your email address</h2>
            <p>
              {verificationSent === "1"
                ? `We sent a confirmation link to ${user.email}. Open it on any phone or computer — this page updates once it is confirmed.`
                : `Confirm ${user.email} so the review team can approve your profile and you can respond to seller opportunities.`}
            </p>
            {verificationError === "rate-limited" && <p className="form-error" role="alert">We just sent you an email. Please wait a minute before asking again.</p>}
            {verificationError === "failed" && <p className="form-error" role="alert">We couldn&apos;t send the email right now. Please try again.</p>}
          </div>
          <form action={resendCreatorEmailVerification}>
            <button type="submit" className="admin-primary-button">{verificationSent === "1" ? "Send again" : "Send confirmation link"}</button>
          </form>
        </section>
      ) : (emailVerified === "1" || emailRecentlyVerified) && (
        <section className="creator-email-verify creator-email-verified" aria-labelledby="creator-email-verify-title">
          <div>
            <h2 id="creator-email-verify-title">Email confirmed</h2>
            <p>{user.email} is confirmed. Your profile can now be approved by the review team.</p>
          </div>
          <button type="button" className="admin-primary-button" disabled><Check size={15} aria-hidden="true" /> Confirmed successfully</button>
        </section>
      )}
      {submitted === "1" && <p className="admin-save-success" role="status">Your creator profile has been submitted for review.</p>}
      {withdrawn === "1" && <p className="admin-save-success" role="status">Your profile is now offline. You can submit it again whenever you are ready.</p>}
      <div className="creator-programme-links">
        <Link href="/creators">Browse approved creators <ArrowUpRight size={15} aria-hidden="true" /></Link>
        <Link href="/creator/opportunities">Available product promotions <ArrowUpRight size={15} aria-hidden="true" /></Link>
        {profile.is_public && <Link href={`/creators/${profile.slug}`}><ExternalLink size={14} aria-hidden="true" />View your public profile</Link>}
      </div>

      <section className="creator-application-status" aria-labelledby="creator-status-title">
        <div>
          <p className="admin-eyebrow">PROFILE STATUS</p>
          <h2 id="creator-status-title"><span className={`creator-status-dot is-${profile.status}`} />{profile.status.replaceAll("_", " ")}</h2>
          <p>{statusDescription}</p>
          {reviewNote && <p className="creator-review-note"><strong>Review note:</strong> {reviewNote}</p>}
        </div>
      </section>

      <CreatorInfluenceSummary influence={influence} showProgress />

      {profile.is_public && profile.referral_code && (
        <CreatorFanTools
          displayName={profile.display_name}
          code={profile.referral_code}
          profileUrl={`/creators/${profile.slug}`}
          fanCount={fanCount}
          firstReferralCount={firstReferralCount}
          influencePoints={influence?.qualified_referrals}
          platforms={accounts.filter((account) => account.is_published).map((account) => account.platform === "x" ? "X" : account.platform)}
        />
      )}

      {contactSaved === "1" && <p className="admin-save-success" role="status">Creator phone and visibility preferences saved.</p>}
      <section className="creator-contact-section" aria-labelledby="creator-contact-title">
        <div className="creator-section-heading">
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
            <small>Collaboration-only numbers are never shown to ordinary visitors.</small>
          </label>
          <button className="admin-primary-button" type="submit">Save phone preferences</button>
        </ActionForm>
      </section>

      {profile.status !== "suspended" && profile.status !== "withdrawn" && (
        <form className="creator-withdraw-action" action={withdrawCreatorProfile}>
          <p>Take your profile offline. It will no longer appear in the creator directory or receive new product promotions.</p>
          <button className="admin-reject-button" type="submit">Take profile offline</button>
        </form>
      )}

      {profile.status === "suspended" ? (
        <p className="creator-suspended-note">Your profile cannot be edited while it is suspended.</p>
      ) : (
        <details id="creator-profile-editor" className="creator-application-section" open={profile.status === "changes_requested" || profile.status === "rejected" || profile.status === "withdrawn"}>
          <summary className="creator-application-summary">
            <strong>Edit creator profile</strong>
          </summary>
          <p className="creator-application-hint">{profile.is_public ? "Changes stay private until approved." : "Update your profile details for review."}</p>
          {profile.is_public && <p className="creator-edit-notice">Changes stay private during review. Your current approved profile remains visible until updates are approved.</p>}
          <ActionForm className="creator-application-form" action={saveCreatorApplication}>
            <CreatorApplicationFields
              cities={cities}
              profile={profile}
              audienceCityIds={audienceCityIds}
              accounts={formAccounts}
              portfolioItems={formPortfolio}
              profileImageUrl={profileImageUrl}
              coverImageUrl={coverImageUrl}
            />
            <button className="admin-primary-button" type="submit">Save and submit for review</button>
          </ActionForm>
        </details>
      )}

      <p className="creator-profile-footnote"><BadgeCheck size={14} aria-hidden="true" />Approval means the profile passed review. Platform metrics remain self-reported unless explicitly marked otherwise.</p>
    </main>
  );
}
