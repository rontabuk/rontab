import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, BadgeCheck, ExternalLink, MapPin, Phone, Send } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { CreatorFanTools } from "@/components/creator/CreatorFanTools";
import { CreatorVerificationBadge } from "@/components/creator/CreatorVerificationBadge";
import { CreatorInfluenceSummary } from "@/components/creator/CreatorInfluence";
import { getCreatorInfluence } from "@/lib/creator/influence-server";
import { inviteCreatorToProductOpportunity } from "@/app/seller/(protected)/creator-opportunity-actions";
import { RatingSummary, opportunityStatusLabels } from "@/components/creator-opportunities/Collaboration";
import { getViewer } from "@/lib/auth/viewer";
import { MIN_CREATOR_OPPORTUNITY_BUDGET, creatorSpecialties } from "@/lib/creator/catalog";
import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import { createSupabasePublicClient, createSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createSupabasePublicClient();
  const { data } = await supabase.from("creator_profiles").select("published_display_name,published_bio").eq("slug", slug).eq("is_public", true).maybeSingle();
  return data
    ? { title: `${data.published_display_name} | Creators`, description: data.published_bio?.slice(0, 160) }
    : { title: "Creator profile" };
}

export default async function CreatorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ slug }, , viewer] = await Promise.all([params, searchParams, getViewer()]);
  const supabase = createSupabasePublicClient();
  const { data: profile, error: profileError } = await supabase
    .from("creator_profiles")
    .select("id,slug,published_display_name,published_bio,published_specialties,published_audience_city_id,published_profile_image_path,published_cover_image_path,referral_code,is_public,created_at")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) notFound();

  const [{ data: profileImageResult, error: profileImageError }, { data: coverImageResult, error: coverImageError }] = await Promise.all([
    profile.published_profile_image_path
      ? supabase.storage.from("creator-profile-media").createSignedUrl(profile.published_profile_image_path, 60 * 60)
      : { data: null, error: null },
    profile.published_cover_image_path
      ? supabase.storage.from("creator-profile-media").createSignedUrl(profile.published_cover_image_path, 60 * 60)
      : { data: null, error: null },
  ]);
  if (profileImageError) throw new Error(profileImageError.message);
  if (coverImageError) throw new Error(coverImageError.message);

  const { data: accounts, error: accountsError } = await supabase
    .from("creator_platform_accounts")
    .select("id,creator_profile_id,platform,handle,profile_url,follower_count,followers_updated_at,is_published")
    .eq("creator_profile_id", profile.id)
    .eq("is_published", true)
    .order("platform");
  if (accountsError) throw new Error(accountsError.message);

  const [portfolioResult, audienceCitiesResult, influenceById, publicPhoneResult, ratingResult] = await Promise.all([
    supabase.from("creator_portfolio_items").select("id,title,url,position").eq("creator_profile_id", profile.id).eq("is_published", true).order("position"),
    supabase.from("creator_profile_audience_cities").select("city_id").eq("creator_profile_id", profile.id).eq("is_published", true),
    getCreatorInfluence(supabase, [profile.id]),
    supabase.rpc("get_public_creator_contact_phone", { p_creator_profile_id: profile.id }),
    supabase.rpc("get_creator_opportunity_ratings", { p_creator_profile_ids: [profile.id] }),
  ]);
  if (ratingResult.error) throw new Error(ratingResult.error.message);
  const rating = ratingResult.data?.[0];
  if (portfolioResult.error) throw new Error(portfolioResult.error.message);
  if (audienceCitiesResult.error) throw new Error(audienceCitiesResult.error.message);
  const influence = influenceById.get(profile.id);
  if (publicPhoneResult.error) throw new Error(publicPhoneResult.error.message);
  let fanCount = influence?.fan_count;
  if (fanCount === undefined) {
    const result = await supabase.rpc("creator_get_public_fan_count", { p_creator_profile_id: profile.id });
    if (result.error) throw new Error(result.error.message);
    fanCount = result.data ?? 0;
  }
  const audienceCityIds = [...new Set([
    ...(audienceCitiesResult.data ?? []).map((city) => city.city_id),
    ...(profile.published_audience_city_id ? [profile.published_audience_city_id] : []),
  ])];
  const { data: audienceCities, error: audienceCityNamesError } = audienceCityIds.length
    ? await supabase.from("supported_cities").select("city_id,city_name").in("city_id", audienceCityIds)
    : { data: [], error: null };
  if (audienceCityNamesError) throw new Error(audienceCityNamesError.message);

  let sellerProfile: { id: string; status: string } | null = null;
  let sellerProducts: { id: string; name: string; currency: string }[] = [];
  let sellerInvites: { id: string; product_id: string; budget: number; currency: string; status: string; created_at: string }[] = [];
  let canShareEmail = false;
  let canSharePhone = false;
  if (viewer.role === "seller") {
    const sessionClient = await createSupabaseServerClient();
    const { data, error } = await sessionClient.from("seller_profiles").select("id,status").eq("user_id", viewer.userId).maybeSingle();
    if (error) throw new Error(error.message);
    sellerProfile = data;
    if (sellerProfile) {
      const [productsResult, invitesResult, contactResult] = await Promise.all([
        sessionClient.from("products").select("id,name,currency").eq("seller_profile_id", sellerProfile.id).eq("status", "approved").order("name").limit(200),
        sessionClient.from("creator_product_opportunities").select("id,product_id,budget,currency,status,created_at")
          .eq("seller_profile_id", sellerProfile.id).eq("invited_creator_profile_id", profile.id).order("created_at", { ascending: false }).limit(10),
        sessionClient.from("seller_contact_details").select("registered_email,registered_email_confirmed_at,phone,phone_contact_confirmed_at").eq("seller_profile_id", sellerProfile.id).maybeSingle(),
      ]);
      for (const result of [productsResult, invitesResult, contactResult]) if (result.error) throw new Error(result.error.message);
      sellerProducts = productsResult.data ?? [];
      sellerInvites = invitesResult.data ?? [];
      canShareEmail = Boolean(contactResult.data?.registered_email && contactResult.data.registered_email_confirmed_at);
      canSharePhone = Boolean(contactResult.data?.phone && contactResult.data.phone_contact_confirmed_at);
    }
  }
  const productNames = new Map(sellerProducts.map((product) => [product.id, product.name]));

  return (
    <main className="creator-public-profile">
      <Link className="creator-back-link" href="/creators"><ArrowLeft size={14} aria-hidden="true" />All creators</Link>
      <header className="creator-profile-hero">
        <div className="creator-profile-cover">
          {coverImageResult?.signedUrl
            ? <Image src={coverImageResult.signedUrl} alt={`${profile.published_display_name} cover`} fill unoptimized sizes="(max-width: 700px) 100vw, 900px" />
            : <div className="creator-profile-cover-default"><span>CREATORS</span><strong>Creators who inspire everyday living</strong></div>}
        </div>
        <div className="creator-public-identity">
          <div className="creator-profile-avatar">
            {profileImageResult?.signedUrl
              ? <Image src={profileImageResult.signedUrl} alt={`${profile.published_display_name} profile picture`} width={88} height={88} unoptimized />
              : <span aria-hidden="true">{profile.published_display_name?.slice(0, 1).toUpperCase() || "R"}</span>}
          </div>
          <div>
            <p className="creator-directory-eyebrow">CREATOR PROFILE</p>
            <h1 className="creator-profile-name">{profile.published_display_name}<CreatorVerificationBadge /></h1>
          </div>
        </div>
        <p className="creator-profile-specialties">
          {(profile.published_specialties ?? []).map((value) => creatorSpecialties.find((item) => item.value === value)?.label ?? value).join(" · ")}
        </p>
        <p className="creator-profile-bio">{profile.published_bio}</p>
        {audienceCities.length > 0 && <p className="creator-profile-audience"><MapPin size={14} aria-hidden="true" />Audience: {audienceCities.map((city) => city.city_name).join(", ")}</p>}
        {publicPhoneResult.data && <a className="creator-profile-phone" href={`tel:${publicPhoneResult.data}`}><Phone size={14} aria-hidden="true" />{publicPhoneResult.data}</a>}
        <p className="creator-approved-mark"><BadgeCheck size={15} aria-hidden="true" />Profile reviewed by the team</p>
        <RatingSummary average={rating?.average_rating} count={rating?.review_count} label="collaboration rating" />
        <CreatorInfluenceSummary influence={influence} />
        {profile.referral_code && <CreatorFanTools
          displayName={profile.published_display_name ?? "Creator"}
          code={profile.referral_code}
          profileUrl={`/creators/${profile.slug}`}
          fanCount={fanCount}
          influencePoints={influence?.qualified_referrals}
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
      {viewer.role === "seller" && sellerProfile?.status === "active" && (
        <section className="creator-collaboration-form-section" aria-labelledby="creator-invite-form-title">
          <div className="creator-public-section-heading"><div><p className="creator-directory-eyebrow">SELLER COLLABORATION</p><h2 id="creator-invite-form-title">Invite this creator to promote a product</h2></div></div>
          {sellerInvites.length > 0 && <ul className="creator-invite-history">{sellerInvites.map((invite) => (
            <li key={invite.id}><Link href={`/seller/products/${invite.product_id}/creator-opportunity?opportunity=${invite.id}`}><strong>{productNames.get(invite.product_id) ?? "Product"}</strong><span>{formatPrice(invite.budget, invite.currency)}</span><span>{opportunityStatusLabels[invite.status] ?? invite.status}</span><small>{formatDate(invite.created_at)}</small></Link></li>
          ))}</ul>}
          {sellerProducts.length ? (
            <ActionForm className="creator-collaboration-form" action={inviteCreatorToProductOpportunity}>
              <input type="hidden" name="creator_profile_id" value={profile.id} />
              <input type="hidden" name="creator_slug" value={profile.slug} />
              <label>Product<select name="product_id" required defaultValue="">
                <option value="" disabled>Choose an approved product</option>
                {sellerProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select></label>
              <label>Promotion budget (GBP)<input name="budget" type="number" min={MIN_CREATOR_OPPORTUNITY_BUDGET} max="1000000" step="0.01" inputMode="decimal" required /><small>Minimum {formatPrice(MIN_CREATOR_OPPORTUNITY_BUDGET, "GBP")}. Payment is arranged directly with the creator.</small></label>
              <label className="creator-collaboration-check"><input type="checkbox" name="allow_counter_offers" defaultChecked />Let the creator propose a different price</label>
              <label>Campaign brief<textarea name="brief" minLength={30} maxLength={2000} rows={5} required placeholder="Describe the content, platform and key messages you want." /></label>
              <label>Preferred completion date<input type="date" name="deadline" /></label>
              <label className="creator-collaboration-check"><input type="checkbox" name="product_provided" />I will provide the product</label>
              <fieldset className="creator-collaboration-contact">
                <legend>Contact details shared only if you select their offer</legend>
                <label className="creator-collaboration-check"><input type="checkbox" name="contact_method" value="email" defaultChecked={canShareEmail} disabled={!canShareEmail} />Email{!canShareEmail && " Â· verify your account email first"}</label>
                <label className="creator-collaboration-check"><input type="checkbox" name="contact_method" value="phone" disabled={!canSharePhone} />Phone{!canSharePhone && " Â· verify your phone first"}</label>
                {!canShareEmail && !canSharePhone && <Link href="/seller/profile">Add and verify your contact details</Link>}
              </fieldset>
              <small>Only this creator will see the invitation. They reply with an offer, and you choose whether to accept it.</small>
              <button className="creator-collaboration-submit" type="submit"><Send size={14} aria-hidden="true" />Send invitation</button>
            </ActionForm>
          ) : <p className="creator-request-feedback">You need an approved live product before you can invite creators. <Link href="/seller/products">Manage products</Link></p>}
        </section>
      )}
      {viewer.role !== "seller" && <p className="creator-directory-note creator-seller-invite">Sellers can <Link href="/seller/login">sign in</Link> to invite this creator to promote a product.</p>}
      <p className="creator-directory-note">The team reviews creator applications. Social follower counts are supplied by creators and are not independently verified. Totals may include the same person on multiple platforms and exclude creator-code followers.</p>
    </main>
  );
}