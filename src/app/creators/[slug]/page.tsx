import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, BadgeCheck, ExternalLink, MapPin, Send } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { CreatorFanTools } from "@/components/creator/CreatorFanTools";
import { sendCreatorCollaborationRequest } from "@/app/seller/(protected)/creator-actions";
import { getViewer } from "@/lib/auth/viewer";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { createSupabasePublicClient, createSupabaseServerClient } from "@/lib/supabase/server";
import "../creators.css";

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createSupabasePublicClient();
  const { data } = await supabase.from("creator_profiles").select("published_display_name,published_bio").eq("slug", slug).eq("is_public", true).maybeSingle();
  return data
    ? { title: `${data.published_display_name} | Rontab Creators`, description: data.published_bio?.slice(0, 160) }
    : { title: "Creator profile | Rontab" };
}

export default async function CreatorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ request?: string }>;
}) {
  await connection();
  const [{ slug }, { request: requestResult }, viewer] = await Promise.all([params, searchParams, getViewer()]);
  const supabase = createSupabasePublicClient();
  const { data: profile, error: profileError } = await supabase
    .from("creator_profiles")
    .select("id,slug,published_display_name,published_bio,published_specialties,published_audience_city_id,referral_code,is_public,created_at")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) notFound();

  const { data: accounts, error: accountsError } = await supabase
    .from("creator_platform_accounts")
    .select("id,creator_profile_id,platform,handle,profile_url,follower_count,followers_updated_at,is_published")
    .eq("creator_profile_id", profile.id)
    .eq("is_published", true)
    .order("platform");
  if (accountsError) throw new Error(accountsError.message);

  const [portfolioResult, audienceCityResult, fanCountResult] = await Promise.all([
    supabase.from("creator_portfolio_items").select("id,title,url,position").eq("creator_profile_id", profile.id).eq("is_published", true).order("position"),
    profile.published_audience_city_id
      ? supabase.from("supported_cities").select("city_name,country_code").eq("city_id", profile.published_audience_city_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("creator_get_public_fan_count", { p_creator_profile_id: profile.id }),
  ]);
  if (portfolioResult.error) throw new Error(portfolioResult.error.message);
  if (audienceCityResult.error) throw new Error(audienceCityResult.error.message);
  if (fanCountResult.error) throw new Error(fanCountResult.error.message);

  let sellerProfile: { id: string; status: string } | null = null;
  let sellerRequest: { id: string; status: string; created_at: string } | null = null;
  if (viewer.role === "seller") {
    const sessionClient = await createSupabaseServerClient();
    const { data, error } = await sessionClient.from("seller_profiles").select("id,status").eq("user_id", viewer.userId).maybeSingle();
    if (error) throw new Error(error.message);
    sellerProfile = data;
    if (sellerProfile) {
      const { data: requests, error: requestError } = await sessionClient
        .from("creator_collaboration_requests")
        .select("id,status,created_at")
        .eq("creator_profile_id", profile.id)
        .eq("seller_profile_id", sellerProfile.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (requestError) throw new Error(requestError.message);
      sellerRequest = requests?.[0] ?? null;
    }
  }

  return (
    <main className="creator-public-profile">
      <Link className="creator-back-link" href="/creators"><ArrowLeft size={14} aria-hidden="true" />All creators</Link>
      <header className="creator-profile-hero">
        <p className="creator-directory-eyebrow">RONTAB CREATOR PROFILE</p>
        <h1>{profile.published_display_name}</h1>
        <p className="creator-profile-specialties">
          {(profile.published_specialties ?? []).map((value) => creatorSpecialties.find((item) => item.value === value)?.label ?? value).join(" · ")}
        </p>
        <p className="creator-profile-bio">{profile.published_bio}</p>
        {audienceCityResult.data && <p className="creator-profile-audience"><MapPin size={14} aria-hidden="true" />Audience: {audienceCityResult.data.city_name}, {audienceCityResult.data.country_code}</p>}
        <p className="creator-approved-mark"><BadgeCheck size={15} aria-hidden="true" />Profile reviewed by Rontab</p>
        {profile.referral_code && <CreatorFanTools
          displayName={profile.published_display_name ?? "Rontab Creator"}
          code={profile.referral_code}
          profileUrl={`/creators/${profile.slug}`}
          fanCount={fanCountResult.data ?? 0}
          platforms={accounts.map((account) => account.platform === "x" ? "X" : account.platform)}
        />}
      </header>
      <section className="creator-public-platforms" aria-labelledby="creator-public-platforms-title">
        <div className="creator-public-section-heading">
          <div><p className="creator-directory-eyebrow">FOLLOW THEIR WORK</p><h2 id="creator-public-platforms-title">Platforms & audience</h2></div>
          <span>Counts last updated by creator</span>
        </div>
        {accounts.length ? (
          <div className="creator-public-platform-list">
            {accounts.map((account) => (
              <article key={account.id}>
                <div><p>{account.platform === "x" ? "X" : account.platform}</p><h3>@{account.handle}</h3></div>
                <div className="creator-public-followers"><strong>{formatNumber(account.follower_count)}</strong><span>followers</span><small>Updated {formatDate(account.followers_updated_at)}</small></div>
                <a href={account.profile_url} target="_blank" rel="noreferrer" aria-label={`Open ${account.platform} profile for ${profile.published_display_name}`}><span>Visit profile</span><ExternalLink size={15} aria-hidden="true" /></a>
              </article>
            ))}
          </div>
        ) : <p className="creator-directory-note">No social profiles have been added.</p>}
      </section>
      {portfolioResult.data && portfolioResult.data.length > 0 && (
        <section className="creator-public-portfolio" aria-labelledby="creator-portfolio-title">
          <div className="creator-public-section-heading"><div><p className="creator-directory-eyebrow">SELECTED WORK</p><h2 id="creator-portfolio-title">Work samples</h2></div></div>
          <ul>{portfolioResult.data.map((item) => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={14} aria-hidden="true" /></a></li>)}</ul>
        </section>
      )}
      {requestResult === "sent" && <p className="creator-request-feedback" role="status">Your collaboration request was sent privately to this creator.</p>}
      {viewer.role === "seller" && sellerProfile?.status === "active" && (
        <section className="creator-collaboration-form-section" aria-labelledby="creator-collaboration-form-title">
          <div className="creator-public-section-heading"><div><p className="creator-directory-eyebrow">SELLER COLLABORATION</p><h2 id="creator-collaboration-form-title">Send a private request</h2></div></div>
          {sellerRequest?.status === "pending" ? (
            <p className="creator-request-feedback" role="status">You sent a request on {formatDateTime(sellerRequest.created_at)}. Its status is {sellerRequest.status}.</p>
          ) : (
            <ActionForm className="creator-collaboration-form" action={sendCreatorCollaborationRequest}>
              <input type="hidden" name="creator_profile_id" value={profile.id} />
              <input type="hidden" name="creator_slug" value={profile.slug} />
              <label>Request title<input name="title" minLength={3} maxLength={120} required /></label>
              <label>Collaboration brief<textarea name="brief" minLength={30} maxLength={2000} rows={5} required /></label>
              <label>Proposed compensation or product<input name="proposed_compensation" maxLength={500} /></label>
              <small>Your shop contact details stay private unless you choose to share them in your message.</small>
              <button className="creator-collaboration-submit" type="submit"><Send size={14} aria-hidden="true" />Send request</button>
            </ActionForm>
          )}
        </section>
      )}
      {viewer.role !== "seller" && <p className="creator-directory-note creator-seller-invite">Rontab sellers can <Link href="/seller/login">sign in</Link> to send a private collaboration request.</p>}
      <p className="creator-directory-note">Rontab reviews creator applications. Follower counts are self-reported and not independently verified.</p>
    </main>
  );
}