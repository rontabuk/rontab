import type { Metadata } from "next";
import { connection } from "next/server";
import { BadgeCheck, Coins, ExternalLink } from "lucide-react";
import { CreatorVerificationBadge } from "@/components/creator/CreatorVerificationBadge";
import { grantCreatorPoints, reviewCreatorProfile } from "@/app/admin/(protected)/creator-actions";
import { requireAdmin } from "@/lib/admin/access";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatDateTime, formatNumber } from "@/lib/format";
import "../creator-admin.css";

export const metadata: Metadata = { title: "Creator applications", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ reviewed?: string; granted?: string; duplicate?: string }>;
}) {
  await connection();
  const [{ reviewed, granted, duplicate }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const [submittedResult, approvedResult, suspendedResult] = await Promise.all([
    supabase.from("creator_profiles").select("id,slug,display_name,bio,specialties,status,is_public,submitted_at,audience_city_id,published_display_name,published_bio,published_specialties,published_audience_city_id,created_at,updated_at").eq("status", "submitted").order("submitted_at", { ascending: true }),
    supabase.from("creator_profiles").select("id,slug,display_name,bio,specialties,status,is_public,submitted_at,audience_city_id,published_display_name,published_bio,published_specialties,published_audience_city_id,created_at,updated_at").eq("is_public", true).order("updated_at", { ascending: false }).limit(100),
    supabase.from("creator_profiles").select("id,display_name").eq("status", "suspended").order("updated_at", { ascending: false }),
  ]);
  if (submittedResult.error) throw new Error(submittedResult.error.message);
  if (approvedResult.error) throw new Error(approvedResult.error.message);
  if (suspendedResult.error) throw new Error(suspendedResult.error.message);
  const submitted = submittedResult.data;
  const approved = approvedResult.data;
  const suspended = suspendedResult.data;
  const allProfileIds = [...submitted, ...approved].map((profile) => profile.id);
  const cityIds = [...new Set([...submitted.map((profile) => profile.audience_city_id), ...approved.map((profile) => profile.published_audience_city_id)].filter((cityId): cityId is string => Boolean(cityId)))];
  const [accountsResult, portfolioResult, citiesResult, reviewsResult, pointsResult] = await Promise.all([
    allProfileIds.length
      ? supabase.from("creator_platform_accounts").select("id,creator_profile_id,platform,handle,profile_url,follower_count,followers_updated_at,is_published").in("creator_profile_id", allProfileIds).order("platform")
      : Promise.resolve({ data: [], error: null }),
    allProfileIds.length
      ? supabase.from("creator_portfolio_items").select("id,creator_profile_id,title,url,position,is_published").in("creator_profile_id", allProfileIds).order("position")
      : Promise.resolve({ data: [], error: null }),
    cityIds.length
      ? supabase.from("supported_cities").select("city_id,city_name,country_code").in("city_id", cityIds)
      : Promise.resolve({ data: [], error: null }),
    submitted.length
      ? supabase.from("creator_profile_reviews").select("creator_profile_id,review_note,created_at").in("creator_profile_id", submitted.map((profile) => profile.id)).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    approved.length
      ? supabase.from("creator_point_accounts").select("creator_profile_id,points_balance").in("creator_profile_id", approved.map((profile) => profile.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [accountsResult, portfolioResult, citiesResult, reviewsResult, pointsResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const accountsByProfile = new Map<string, typeof accountsResult.data>();
  for (const account of accountsResult.data ?? []) {
    const list = accountsByProfile.get(account.creator_profile_id) ?? [];
    list.push(account);
    accountsByProfile.set(account.creator_profile_id, list);
  }
  const latestNotes = new Map<string, string | null>();
  for (const review of reviewsResult.data ?? []) {
    if (!latestNotes.has(review.creator_profile_id)) latestNotes.set(review.creator_profile_id, review.review_note);
  }
  const balances = new Map((pointsResult.data ?? []).map((account) => [account.creator_profile_id, account.points_balance]));
  const fanCounts = new Map(await Promise.all(approved.map(async (profile) => {
    const { data, error } = await supabase.rpc("creator_get_public_fan_count", { p_creator_profile_id: profile.id });
    if (error) throw new Error(error.message);
    return [profile.id, data ?? 0] as const;
  })));
  const citiesById = new Map((citiesResult.data ?? []).map((city) => [city.city_id, `${city.city_name}, ${city.country_code}`]));
  const specialtyLabel = (value: string) => creatorSpecialties.find((item) => item.value === value)?.label ?? value;

  return (
    <main className="admin-overview admin-creators-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CREATOR PROGRAMME</p>
        <h1>Creator applications</h1>
        <p>Review applications before profiles become visible. Creator points are separate from visitor loyalty points.</p>
      </header>
      {reviewed === "1" && <p className="admin-save-success" role="status">Creator review decision saved.</p>}
      {granted === "1" && <p className="admin-save-success" role="status">Creator points grant recorded.</p>}
      {duplicate === "1" && <p className="admin-save-success" role="status">This points grant was already recorded and was not applied twice.</p>}

      <section className="admin-dashboard-section" aria-labelledby="creator-review-queue-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">REVIEW QUEUE</p><h2 id="creator-review-queue-title">Submitted profiles</h2></div>
          <span>{formatNumber(submitted.length)} awaiting review</span>
        </div>
        {submitted.length ? (
          <div className="creator-admin-list">
            {submitted.map((profile) => {
              const accounts = (accountsByProfile.get(profile.id) ?? []).filter((account) => !account.is_published);
              const portfolio = (portfolioResult.data ?? []).filter((item) => item.creator_profile_id === profile.id && !item.is_published);
              return (
                <article className="creator-admin-item" key={profile.id}>
                  <div className="creator-admin-profile">
                    <div className="creator-admin-status"><span className="admin-status admin-status-pending">Submitted</span><time>{formatDateTime(profile.submitted_at)}</time></div>
                    <h3>{profile.display_name}</h3>
                    <p className="creator-admin-specialties">{profile.specialties.map(specialtyLabel).join(" · ")}</p>
                    <p className="creator-admin-bio">{profile.bio}</p>
                    {profile.audience_city_id && <p className="creator-admin-specialties">Primary audience: {citiesById.get(profile.audience_city_id) ?? profile.audience_city_id}</p>}
                    {profile.is_public && (
                      <div className="creator-admin-public-snapshot">
                        <strong>Currently public</strong>
                        <span>{profile.published_display_name ?? profile.display_name} · {(profile.published_specialties ?? []).map(specialtyLabel).join(" · ")}</span>
                        {profile.published_audience_city_id && <span>Audience: {citiesById.get(profile.published_audience_city_id) ?? profile.published_audience_city_id}</span>}
                        {profile.published_bio && <p>{profile.published_bio}</p>}
                      </div>
                    )}
                    {latestNotes.has(profile.id) && <p className="creator-admin-prior-note"><strong>Previous review note:</strong> {latestNotes.get(profile.id)}</p>}
                    <div className="creator-admin-platforms">
                      {accounts.map((account) => (
                        <a href={account.profile_url} target="_blank" rel="noreferrer" key={account.id}>
                          <span>{account.platform === "x" ? "X" : account.platform}</span>
                          <strong>@{account.handle}</strong>
                          <small>{formatNumber(account.follower_count)} self-reported</small>
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                    {portfolio.length > 0 && <div className="creator-admin-portfolio">{portfolio.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.id}>{item.title}<ExternalLink size={12} aria-hidden="true" /></a>)}</div>}
                  </div>
                  <div className="creator-admin-review-actions">
                    <form action={reviewCreatorProfile}>
                      <input type="hidden" name="creator_profile_id" value={profile.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <button className="admin-approve-button" type="submit"><BadgeCheck size={14} aria-hidden="true" />Approve and publish</button>
                    </form>
                    <form action={reviewCreatorProfile}>
                      <input type="hidden" name="creator_profile_id" value={profile.id} />
                      <input type="hidden" name="decision" value="changes_requested" />
                      <label>Changes requested<textarea name="review_note" maxLength={2000} minLength={5} required /></label>
                      <button className="admin-approve-button" type="submit">Request changes</button>
                    </form>
                    <form action={reviewCreatorProfile}>
                      <input type="hidden" name="creator_profile_id" value={profile.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <label>Reason for rejection<textarea name="review_note" maxLength={2000} minLength={5} required /></label>
                      <button className="admin-reject-button" type="submit">Reject application</button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="admin-empty-state"><h2>No creator applications to review</h2><p>New submissions will appear here.</p></div>}
      </section>

      <section className="admin-dashboard-section" aria-labelledby="approved-creators-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">PUBLIC PROFILES</p><h2 id="approved-creators-title">Approved creators</h2></div>
          <span>{formatNumber(approved.length)} profiles</span>
        </div>
        {approved.length ? (
          <div className="creator-admin-list">
            {approved.map((profile) => (
              <article className="creator-admin-approved" key={profile.id}>
                <div>
                  <span className="admin-status admin-status-approved">{profile.status === "approved" ? "Approved" : "Public · update under review"}</span>
                  <h3>{profile.published_display_name ?? profile.display_name}<CreatorVerificationBadge fanCount={fanCounts.get(profile.id) ?? 0} /></h3>
                  {profile.published_audience_city_id && <small>{citiesById.get(profile.published_audience_city_id) ?? profile.published_audience_city_id}</small>}
                  <a href={`/creators/${profile.slug}`} target="_blank" rel="noreferrer">Open public profile <ExternalLink size={12} aria-hidden="true" /></a>
                </div>
                <div className="creator-admin-points">
                  <p><Coins size={14} aria-hidden="true" />{formatNumber(balances.get(profile.id) ?? 0)} creator points</p>
                  <form action={grantCreatorPoints}>
                    <input type="hidden" name="creator_profile_id" value={profile.id} />
                    <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                    <label>Points<input name="points" type="number" min="1" max="100000" step="1" required /></label>
                    <label>Reason<input name="reason" type="text" minLength={5} maxLength={500} required /></label>
                    <button className="admin-approve-button" type="submit">Grant points</button>
                  </form>
                  <form className="creator-admin-suspend" action={reviewCreatorProfile}>
                    <input type="hidden" name="creator_profile_id" value={profile.id} />
                    <input type="hidden" name="decision" value="suspend" />
                    <label>Suspension reason<input name="review_note" type="text" minLength={5} maxLength={2000} required /></label>
                    <button className="admin-reject-button" type="submit">Suspend profile</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : <div className="admin-empty-state"><h2>No approved creators yet</h2><p>Approved public profiles will appear here.</p></div>}
      </section>

      <section className="admin-dashboard-section" aria-labelledby="suspended-creators-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">ACCOUNT STATUS</p><h2 id="suspended-creators-title">Suspended profiles</h2></div>
          <span>{formatNumber(suspended.length)} profiles</span>
        </div>
        {suspended.length ? (
          <div className="creator-admin-list">
            {suspended.map((profile) => (
              <article className="creator-admin-item" key={profile.id}>
                <div>
                  <span className="admin-status admin-status-pending">Suspended</span>
                  <h3>{profile.display_name}</h3>
                  <p className="creator-admin-specialties">This profile is hidden from the public directory.</p>
                </div>
                <div className="creator-admin-review-actions">
                  <form action={reviewCreatorProfile}>
                    <input type="hidden" name="creator_profile_id" value={profile.id} />
                    <input type="hidden" name="decision" value="reinstate" />
                    <button className="admin-approve-button" type="submit">Restore public profile</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : <div className="admin-empty-state"><h2>No suspended creator profiles</h2></div>}
      </section>
    </main>
  );
}