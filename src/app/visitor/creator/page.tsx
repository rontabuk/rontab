import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, BadgeCheck, Coins, ExternalLink } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { creatorPlatforms, creatorSpecialties } from "@/lib/creator/catalog";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getVisitorAccount } from "@/lib/visitor/access";
import { saveCreatorApplication } from "@/app/visitor/creator-actions";
import type { Database } from "@/lib/supabase/database.types";
import "../visitor.css";

export const metadata: Metadata = { title: "Creator profile", robots: { index: false, follow: false } };
export const instant = false;

type CreatorProfile = Pick<
  Database["public"]["Tables"]["creator_profiles"]["Row"],
  "id" | "slug" | "display_name" | "bio" | "specialties" | "status" | "is_public" | "submitted_at"
>;
type CreatorPlatformAccount = Pick<
  Database["public"]["Tables"]["creator_platform_accounts"]["Row"],
  "id" | "creator_profile_id" | "platform" | "handle" | "profile_url" | "follower_count" | "followers_updated_at"
>;
type CreatorPointTransaction = Pick<
  Database["public"]["Tables"]["creator_point_transactions"]["Row"],
  "id" | "points_delta" | "reason" | "created_at"
>;

const statusCopy: Record<string, string> = {
  submitted: "Your profile is being reviewed. It will not appear publicly until approved.",
  changes_requested: "The review team asked for changes. Update your details and submit again.",
  rejected: "This application was not approved. You can revise it and submit again.",
  approved: "Your profile is public. Any changes you submit will be reviewed before they appear.",
  suspended: "This profile is currently unavailable. Contact Rontab support if you need help.",
};

export default async function VisitorCreatorPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  await connection();
  const [{ submitted }, { supabase }] = await Promise.all([searchParams, getVisitorAccount("/visitor/creator")]);
  const { data: profileId, error: profileIdError } = await supabase.rpc("get_my_creator_profile_id");
  if (profileIdError) throw new Error(profileIdError.message);

  let profile: CreatorProfile | null = null;
  let accounts: CreatorPlatformAccount[] = [];
  let reviewNote: string | null = null;
  let pointsBalance = 0;
  let pointTransactions: CreatorPointTransaction[] = [];
  if (profileId) {
    const [profileResult, accountsResult, reviewsResult, pointsResult, historyResult] = await Promise.all([
      supabase.from("creator_profiles").select("id,slug,display_name,bio,specialties,status,is_public,submitted_at").eq("id", profileId).single(),
      supabase.from("creator_platform_accounts").select("id,creator_profile_id,platform,handle,profile_url,follower_count,followers_updated_at").eq("creator_profile_id", profileId).order("platform"),
      supabase.from("creator_profile_reviews").select("review_note").eq("creator_profile_id", profileId).order("created_at", { ascending: false }).limit(1),
      supabase.from("creator_point_accounts").select("points_balance").eq("creator_profile_id", profileId).single(),
      supabase.from("creator_point_transactions").select("id,points_delta,reason,created_at").eq("creator_profile_id", profileId).order("created_at", { ascending: false }).limit(20),
    ]);
    for (const result of [profileResult, accountsResult, reviewsResult, pointsResult, historyResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    profile = profileResult.data;
    accounts = accountsResult.data ?? [];
    reviewNote = reviewsResult.data?.[0]?.review_note ?? null;
    pointsBalance = pointsResult.data?.points_balance ?? 0;
    pointTransactions = historyResult.data ?? [];
  }

  const accountsByPlatform = new Map(accounts.map((account) => [account.platform, account]));

  return (
    <main className="admin-overview visitor-creator-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CREATOR PROGRAMME</p>
        <h1>Introduce yourself</h1>
        <p>Share what you create and where your audience follows you. Approved profiles are visible to the Rontab community and sellers.</p>
      </header>

      {submitted === "1" && <p className="admin-save-success" role="status">Your creator profile has been submitted for review.</p>}
      <div className="creator-programme-links">
        <Link href="/creators">Browse approved creators <ArrowUpRight size={15} aria-hidden="true" /></Link>
        {profile?.status === "approved" && <Link href={`/creators/${profile.slug}`}><ExternalLink size={14} aria-hidden="true" />View your public profile</Link>}
      </div>

      {profile && (
        <section className="creator-application-status" aria-labelledby="creator-status-title">
          <div>
            <p className="admin-eyebrow">APPLICATION STATUS</p>
            <h2 id="creator-status-title"><span className={`creator-status-dot is-${profile.status}`} />{profile.status.replaceAll("_", " ")}</h2>
            <p>{statusCopy[profile.status] ?? "Your application status is being updated."}</p>
            {reviewNote && <p className="creator-review-note"><strong>Review note:</strong> {reviewNote}</p>}
          </div>
          <div className="creator-points-balance">
            <Coins size={17} aria-hidden="true" />
            <span><strong>{formatNumber(pointsBalance)}</strong><small>creator points</small></span>
          </div>
        </section>
      )}

      {profile?.status === "suspended" ? (
        <p className="creator-suspended-note">Your profile cannot be edited while it is suspended.</p>
      ) : (
        <section className="creator-application-section" aria-labelledby="creator-application-title">
          <div className="visitor-profile-heading">
            <p className="admin-eyebrow">YOUR PUBLIC PROFILE</p>
            <h2 id="creator-application-title">{profile ? "Update your application" : "Creator application"}</h2>
          </div>
          {profile?.status === "approved" && <p className="creator-edit-notice">Submitting changes temporarily hides your current profile while the updated version is reviewed.</p>}
          <ActionForm className="creator-application-form" action={saveCreatorApplication}>
            <label>
              Public display name
              <input name="display_name" defaultValue={profile?.display_name ?? ""} minLength={2} maxLength={100} autoComplete="nickname" required />
            </label>
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
            <button className="admin-primary-button" type="submit">{profile ? "Save and submit for review" : "Submit for review"}</button>
          </ActionForm>
        </section>
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
      <p className="creator-profile-footnote"><BadgeCheck size={14} aria-hidden="true" />Approval means the profile passed Rontab review. Platform metrics remain self-reported unless explicitly marked otherwise.</p>
    </main>
  );
}