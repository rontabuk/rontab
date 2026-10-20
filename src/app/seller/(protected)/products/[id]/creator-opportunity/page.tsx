import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, CalendarDays, MapPin, PackageCheck, UsersRound } from "lucide-react";
import { CreatorVerificationBadge } from "@/components/creator/CreatorVerificationBadge";
import { CreatorInfluenceSummary } from "@/components/creator/CreatorInfluence";
import { getCreatorInfluence } from "@/lib/creator/influence-server";
import { ActionForm } from "@/components/ActionForm";
import { OpportunityTargeting } from "@/components/creator-opportunities/OpportunityTargeting";
import { CollaborationProgress, CollaborationRatingForm, CollaborationReviews, RatingSummary, opportunityStatusLabels } from "@/components/creator-opportunities/Collaboration";
import { closeCreatorProductOpportunity, createCreatorProductOpportunity, rateCreatorForProductOpportunity, reviewCreatorProductOpportunityDelivery, selectCreatorProductOpportunityProposal } from "@/app/seller/(protected)/creator-opportunity-actions";
import { MIN_CREATOR_OPPORTUNITY_BUDGET, creatorSpecialties } from "@/lib/creator/catalog";
import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import { getSellerAccount } from "@/lib/seller/access";
import { createProductMediaUrls } from "@/lib/supabase/storage";
import { isUuid } from "@/lib/validation";
import "./creator-opportunity.css";

export const metadata: Metadata = { title: "Promote a product to creators", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerProductCreatorOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; invited?: string; selected?: string; closed?: string; completed?: string; revision?: string; rated?: string; opportunity?: string; sort?: string; city?: string; new?: string }>;
}) {
  await connection();
  const [{ id }, query, { supabase, seller }, { cities }] = await Promise.all([params, searchParams, getSellerAccount(), getSupportedLocations()]);
  if (!isUuid(id)) notFound();
  const { data: product, error: productError } = await supabase.from("products")
    .select("id,name,slug,status,price,currency,description,category_id")
    .eq("id", id)
    .eq("seller_profile_id", seller.id)
    .maybeSingle();
  if (productError) throw new Error(productError.message);
  if (!product) notFound();

  const [opportunityResult, mediaResult, contactResult] = await Promise.all([
    supabase.from("creator_product_opportunities").select("id,budget,currency,target_specialties,is_nationwide,target_city_ids,brief,product_provided,deadline,contact_methods,status,created_at,allow_counter_offers,invited_creator_profile_id,delivery_url,delivery_note,delivered_at,completed_at,revision_note")
      .eq("product_id", product.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("product_images").select("storage_path,media_type,alt_text").eq("product_id", product.id).order("sort_order").limit(1),
    supabase.from("seller_contact_details").select("registered_email,registered_email_confirmed_at,phone,phone_contact_confirmed_at")
      .eq("seller_profile_id", seller.id).maybeSingle(),
  ]);
  if (opportunityResult.error) throw new Error(opportunityResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);
  if (contactResult.error) throw new Error(contactResult.error.message);
  const opportunities = opportunityResult.data ?? [];
  const latestOpportunity = opportunities[0] ?? null;
  const openPublicOpportunity = opportunities.find((item) => item.status === "open" && !item.invited_creator_profile_id) ?? null;
  const requestedOpportunity = opportunities.find((item) => item.id === query.opportunity) ?? null;
  const opportunity = query.new === "1" && !openPublicOpportunity ? null : requestedOpportunity ?? openPublicOpportunity ?? latestOpportunity;
  const invitedCreatorIds = [...new Set(opportunities.flatMap((item) => item.invited_creator_profile_id ? [item.invited_creator_profile_id] : []))];
  const { data: invitedCreators, error: invitedCreatorsError } = invitedCreatorIds.length
    ? await supabase.from("creator_profiles").select("id,slug,published_display_name").in("id", invitedCreatorIds)
    : { data: [], error: null };
  if (invitedCreatorsError) throw new Error(invitedCreatorsError.message);
  const invitedCreatorById = new Map((invitedCreators ?? []).map((creator) => [creator.id, creator]));
  const invitedCreator = opportunity?.invited_creator_profile_id ? invitedCreatorById.get(opportunity.invited_creator_profile_id) : undefined;
  const mediaUrls = await createProductMediaUrls(supabase, mediaResult.data.map((media) => media.storage_path));
  const productImage = mediaResult.data[0] ? mediaUrls.get(mediaResult.data[0].storage_path) : null;
  const canShareEmail = Boolean(contactResult.data?.registered_email && contactResult.data.registered_email_confirmed_at);
  const canSharePhone = Boolean(contactResult.data?.phone && contactResult.data.phone_contact_confirmed_at);

  let proposals: Awaited<ReturnType<typeof loadProposals>> = [];
  let selectedContact: { email: string | null; phone: string | null } | null = null;
  let reviews: { reviewer_role: "seller" | "creator"; rating: number; comment: string | null; created_at: string }[] = [];
  let cityNamesById = new Map(cities.map((city) => [city.city_id, city.city_name]));
  if (opportunity) {
    proposals = await loadProposals(supabase, opportunity.id, cities);
    const selected = proposals.find((proposal) => proposal.status === "selected");
    if (selected) {
      const { data, error } = await supabase.rpc("get_creator_product_opportunity_contact", { p_proposal_id: selected.id });
      if (error) throw new Error(error.message);
      selectedContact = data?.[0] ?? null;
    }
    if (opportunity.status === "completed") {
      const { data, error } = await supabase.from("creator_product_opportunity_reviews")
        .select("reviewer_role,rating,comment,created_at").eq("opportunity_id", opportunity.id).order("created_at");
      if (error) throw new Error(error.message);
      reviews = data ?? [];
    }
  }
  const selectedProposal = proposals.find((proposal) => proposal.status === "selected");
  const sellerHasRated = reviews.some((review) => review.reviewer_role === "seller");
  const otherOpportunities = opportunities.filter((item) => item.id !== opportunity?.id);
  const availableProposalCities = [...new Set(proposals.flatMap((proposal) => proposal.audienceCities.map((city) => city.city_id)))];
  const selectedCity = availableProposalCities.includes(query.city ?? "") ? query.city : undefined;
  const sort = ["price-low", "price-high", "followers", "influence", "active"].includes(query.sort ?? "") ? query.sort! : "price-low";
  const visibleProposals = proposals.filter((proposal) => !selectedCity || proposal.audienceCities.some((city) => city.city_id === selectedCity))
    .sort((left, right) => sort === "influence" ? (right.influence?.qualified_referrals ?? 0) - (left.influence?.qualified_referrals ?? 0) || left.amount - right.amount
      : sort === "active" ? (right.influence?.active_referrals_30d ?? 0) - (left.influence?.active_referrals_30d ?? 0) || left.amount - right.amount
      : sort === "followers" ? right.totalFollowers - left.totalFollowers || left.amount - right.amount
      : sort === "price-high" ? right.amount - left.amount || right.totalFollowers - left.totalFollowers
        : left.amount - right.amount || right.totalFollowers - left.totalFollowers);
  cityNamesById = new Map(cities.map((city) => [city.city_id, city.city_name]));

  return (
    <main className="admin-overview seller-overview creator-opportunity-page">
      <Link className="creator-opportunity-back" href="/seller/products"><ArrowLeft size={14} aria-hidden="true" />Your products</Link>
      <header className="admin-page-heading">
        <p className="admin-eyebrow">PRODUCT PROMOTION</p>
        <h1>{product.name}</h1>
        <p>Invite matching creators to propose a promotion for this product.</p>
      </header>
      {query.created === "1" && <p className="admin-save-success" role="status">Your product promotion is open to matching creators.</p>}
      {query.invited === "1" && <p className="admin-save-success" role="status">Your private invitation was sent to the creator.</p>}
      {query.selected === "1" && <p className="admin-save-success" role="status">Creator selected. Your chosen contact details are now available below.</p>}
      {query.closed === "1" && <p className="admin-save-success" role="status">The promotion is closed and no longer available to creators.</p>}
      {query.completed === "1" && <p className="admin-save-success" role="status">Promotion marked complete. You can now rate the creator.</p>}
      {query.revision === "1" && <p className="admin-save-success" role="status">Your change request was sent to the creator.</p>}
      {query.rated === "1" && <p className="admin-save-success" role="status">Thank you. Your rating was saved.</p>}
      {!opportunity && latestOpportunity && <p className="creator-opportunity-history-note">The previous promotion is {opportunityStatusLabels[latestOpportunity.status] ?? latestOpportunity.status}. Opening another promotion will keep its offer history unchanged.</p>}
      <section className="creator-opportunity-product">
        {productImage && <Image src={productImage} alt={mediaResult.data[0]?.alt_text || product.name} width={96} height={112} unoptimized />}
        <div><span>{product.status}</span><h2>{product.name}</h2><p>{formatPrice(product.price, product.currency)}</p></div>
        <Link href={`/products/${product.slug}`} target="_blank">View product<ArrowUpRight size={14} aria-hidden="true" /></Link>
      </section>

      {!opportunity && product.status === "approved" && seller.status === "active" ? (
        <section className="creator-opportunity-section">
          <div className="creator-opportunity-section-heading"><div><p className="admin-eyebrow">OPEN TO MATCHED CREATORS</p><h2>Set up a product promotion</h2></div></div>
          <ActionForm className="creator-opportunity-form" action={createCreatorProductOpportunity}>
            <input type="hidden" name="product_id" value={product.id} />
            <label className="creator-opportunity-budget">Promotion budget
              <span><input name="budget" type="number" min={MIN_CREATOR_OPPORTUNITY_BUDGET} max="1000000" step="0.01" inputMode="decimal" required /><strong>{product.currency}</strong></span>
              <small>Minimum {formatPrice(MIN_CREATOR_OPPORTUNITY_BUDGET, product.currency)}.</small>
            </label>
            <label className="creator-opportunity-product-toggle"><input type="checkbox" name="allow_counter_offers" defaultChecked /><span>Allow creators to propose a different price. Untick to make this a fixed-price promotion.</span></label>
            <fieldset className="creator-opportunity-specialties">
              <legend>Creator specialties <small>Choose 1 to 5 to match</small></legend>
              <div>{creatorSpecialties.map(({ value, label }) => <label key={value}><input type="checkbox" name="specialty" value={value} /><span>{label}</span></label>)}</div>
            </fieldset>
            <fieldset className="creator-opportunity-location">
              <legend>Audience location</legend>
              <OpportunityTargeting cities={cities} />
            </fieldset>
            <label>Campaign brief
              <textarea name="brief" minLength={30} maxLength={2000} rows={5} required placeholder="Describe what you want the creator to make and where it should be published." />
            </label>
            <div className="creator-opportunity-form-row">
              <label>Preferred completion date<input type="date" name="deadline" /></label>
              <label className="creator-opportunity-product-toggle"><input type="checkbox" name="product_provided" /><span>I will provide the product for this promotion</span></label>
            </div>
            <fieldset className="creator-opportunity-contact-methods">
              <legend>Contact details to share after selecting a creator</legend>
              <label><input type="checkbox" name="contact_method" value="email" defaultChecked={canShareEmail} disabled={!canShareEmail} /><span>Email{!canShareEmail && " · verify your account email first"}</span></label>
              <label><input type="checkbox" name="contact_method" value="phone" disabled={!canSharePhone} /><span>Phone{!canSharePhone && " · verify your phone in seller profile first"}</span></label>
              {!canShareEmail && !canSharePhone && <Link href="/seller/profile">Add and verify your contact details</Link>}
            </fieldset>
            <p className="creator-opportunity-payment-note">Payments between sellers and creators happen outside RonTab. RonTab is not a party to these agreements. Agree on payment and delivery directly with the creator before work begins.</p>
            <button className="seller-auth-submit" type="submit">Publish creator opportunity</button>
          </ActionForm>
          {latestOpportunity && <Link className="creator-opportunity-new-link" href={`/seller/products/${product.id}/creator-opportunity`}>Return to previous promotion</Link>}
        </section>
      ) : !opportunity ? (
        <div className="admin-empty-state"><h2>Product promotion unavailable</h2><p>{product.status !== "approved" ? "Only approved live products can be offered to creators." : "Your seller account must be active to open a product promotion."}</p></div>
      ) : (
        <>
          <section className="creator-opportunity-overview">
            <div><span className={`creator-opportunity-status is-${opportunity.status}`}>{opportunityStatusLabels[opportunity.status] ?? opportunity.status}</span>{invitedCreator && <span className="collaboration-badge">Private invitation Â· <Link href={`/creators/${invitedCreator.slug}`}>{invitedCreator.published_display_name}</Link></span>}<span className={`collaboration-badge${opportunity.allow_counter_offers ? "" : " is-fixed"}`}>{opportunity.allow_counter_offers ? "Counter-offers allowed" : "Fixed price"}</span><h2>{formatPrice(opportunity.budget, opportunity.currency)} campaign budget</h2>{!invitedCreator && <><p>{opportunity.is_nationwide ? "United Kingdom" : opportunity.target_city_ids.map((cityId) => cityNamesById.get(cityId) ?? cityId).join(", ")}</p><p>{opportunity.target_specialties.map((value) => creatorSpecialties.find((item) => item.value === value)?.label ?? value).join(", ")}</p></>}</div>
            <p role="status"><UsersRound size={15} aria-hidden="true" />{formatNumber(proposals.length)} creator offers</p>
            {opportunity.status === "open" && seller.status === "active" && <form action={closeCreatorProductOpportunity}><input type="hidden" name="product_id" value={product.id} /><input type="hidden" name="opportunity_id" value={opportunity.id} /><button type="submit">Close opportunity</button></form>}
          </section>
          <CollaborationProgress status={opportunity.status} />
          {opportunity.status === "awarded" && selectedProposal && <section className="collaboration-panel"><h2>Waiting for delivery</h2><p>{selectedProposal.creator.published_display_name} will publish the promotion and send you the link here.</p>{opportunity.revision_note && <p><strong>Your change request:</strong> {opportunity.revision_note}</p>}</section>}
          {opportunity.status === "delivered" && <section className="collaboration-panel is-attention" aria-labelledby="delivery-review-title">
            <h2 id="delivery-review-title">Review the delivery</h2>
            {opportunity.delivery_url && <a href={opportunity.delivery_url} target="_blank" rel="noreferrer">Open published content<ArrowUpRight size={14} aria-hidden="true" /></a>}
            {opportunity.delivery_note && <p>{opportunity.delivery_note}</p>}
            {opportunity.delivered_at && <p>Delivered {formatDate(opportunity.delivered_at)}</p>}
            {seller.status === "active" && <div className="collaboration-panel-actions">
              <ActionForm action={reviewCreatorProductOpportunityDelivery}><input type="hidden" name="product_id" value={product.id} /><input type="hidden" name="opportunity_id" value={opportunity.id} /><input type="hidden" name="decision" value="complete" /><p>Happy with the result? Confirm to close the collaboration and unlock ratings.</p><button type="submit">Confirm completed</button></ActionForm>
              <ActionForm action={reviewCreatorProductOpportunityDelivery}><input type="hidden" name="product_id" value={product.id} /><input type="hidden" name="opportunity_id" value={opportunity.id} /><input type="hidden" name="decision" value="revise" /><label>Request changes<textarea name="revision_note" minLength={10} maxLength={1000} required placeholder="Explain what needs to change." /></label><button className="is-secondary" type="submit">Send change request</button></ActionForm>
            </div>}
          </section>}
          {opportunity.status === "completed" && <section className="collaboration-panel" aria-labelledby="collaboration-complete-title">
            <h2 id="collaboration-complete-title">Collaboration completed</h2>
            {opportunity.delivery_url && <a href={opportunity.delivery_url} target="_blank" rel="noreferrer">Open published content<ArrowUpRight size={14} aria-hidden="true" /></a>}
            {opportunity.completed_at && <p>Completed {formatDate(opportunity.completed_at)}</p>}
            <CollaborationReviews reviews={reviews} />
            {!sellerHasRated && <CollaborationRatingForm action={rateCreatorForProductOpportunity} title="Rate this creator" hiddenFields={{ product_id: product.id, opportunity_id: opportunity.id }} />}
          </section>}
          {selectedContact && <section className="creator-opportunity-contact"><h2>Selected creator contact</h2>{selectedContact.email && <p>Email <a href={`mailto:${selectedContact.email}`}>{selectedContact.email}</a></p>}{selectedContact.phone && <p>Phone <a href={`tel:${selectedContact.phone}`}>{selectedContact.phone}</a></p>}</section>}
          <section className="creator-opportunity-proposals" aria-labelledby="creator-opportunity-proposals-title">
            <div className="creator-opportunity-section-heading"><div><p className="admin-eyebrow">CREATOR OFFERS</p><h2 id="creator-opportunity-proposals-title">Compare proposals</h2></div><span>{formatNumber(proposals.length)} received</span></div>
            {proposals.length > 0 && <form className="creator-opportunity-filters" action={`/seller/products/${product.id}/creator-opportunity`} method="get">
              <label>Sort by<select name="sort" defaultValue={sort}><option value="price-low">Lowest price</option><option value="price-high">Highest price</option><option value="followers">Most social followers</option><option value="influence">Most Rontab influence</option><option value="active">Most active referrals · 30 days</option></select></label>
              <label>Audience city<select name="city" defaultValue={selectedCity ?? "all"}><option value="all">All audience cities</option>{availableProposalCities.map((cityId) => <option value={cityId} key={cityId}>{cityNamesById.get(cityId) ?? cityId}</option>)}</select></label>
              <button type="submit">Apply filters</button>
            </form>}
            {visibleProposals.length ? <ol className="creator-opportunity-proposal-list">{visibleProposals.map((proposal) => (
              <li key={proposal.id}>
                <header><div><h3><Link href={`/creators/${proposal.creator.slug}`} target="_blank">{proposal.creator.published_display_name}<ArrowUpRight size={14} aria-hidden="true" /></Link><CreatorVerificationBadge /></h3><RatingSummary average={proposal.rating?.average_rating} count={proposal.rating?.review_count} /><p>{proposal.audienceCities.map((city) => city.city_name).join(", ") || "No audience cities listed"}</p></div><strong>{formatPrice(proposal.amount, opportunity.currency)}</strong></header>
                <CreatorInfluenceSummary influence={proposal.influence} />
                <p className="creator-opportunity-follower-count"><UsersRound size={14} aria-hidden="true" />{formatNumber(proposal.totalFollowers)} self-reported social followers</p>
                <p>{proposal.offer_details}</p>
                <span className={`creator-opportunity-proposal-status is-${proposal.status}`}>{proposal.status.replaceAll("_", " ")}</span>{proposal.amount !== opportunity.budget && <small className="creator-opportunity-counter-note">Counter-offer Â· your budget {formatPrice(opportunity.budget, opportunity.currency)}</small>}
                {proposal.status === "pending" && opportunity.status === "open" && <form action={selectCreatorProductOpportunityProposal}><input type="hidden" name="product_id" value={product.id} /><input type="hidden" name="proposal_id" value={proposal.id} /><input type="hidden" name="opportunity_id" value={opportunity.id} /><button type="submit">Select this creator</button></form>}
              </li>
            ))}</ol> : <div className="admin-empty-state"><h2>{proposals.length ? "No offers match these filters" : "No creator offers yet"}</h2><p>{opportunity.status === "open" ? "Matching creators can now review the product and send their proposed price." : "Offers will appear here when creators respond."}</p></div>}
          </section>
          {opportunity.product_provided && <p className="creator-opportunity-product-note"><PackageCheck size={14} aria-hidden="true" />The seller plans to provide the product for the promotion.</p>}
          {opportunity.deadline && <p className="creator-opportunity-product-note"><CalendarDays size={14} aria-hidden="true" />Preferred completion: {formatDate(opportunity.deadline)}</p>}
          {opportunity.is_nationwide && <p className="creator-opportunity-product-note"><MapPin size={14} aria-hidden="true" />Open across the United Kingdom.</p>}
          {!openPublicOpportunity && seller.status === "active" && <Link className="creator-opportunity-new-link" href={`/seller/products/${product.id}/creator-opportunity?new=1`}>Open another promotion for this product</Link>}
        </>
      )}
      {otherOpportunities.length > 0 && <section className="creator-opportunity-section" aria-labelledby="creator-opportunity-history-title">
        <div className="creator-opportunity-section-heading"><div><p className="admin-eyebrow">PROMOTION HISTORY</p><h2 id="creator-opportunity-history-title">Other promotions for this product</h2></div></div>
        <ul className="creator-opportunity-history-list">{otherOpportunities.map((item) => {
          const invited = item.invited_creator_profile_id ? invitedCreatorById.get(item.invited_creator_profile_id) : undefined;
          return <li key={item.id}><Link href={`/seller/products/${product.id}/creator-opportunity?opportunity=${item.id}`}><strong>{formatPrice(item.budget, item.currency)}</strong><span>{invited ? `Invitation Â· ${invited.published_display_name}` : "Open to all creators"}</span><span>{opportunityStatusLabels[item.status] ?? item.status}</span><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></Link></li>;
        })}</ul>
      </section>}
    </main>
  );
}

async function loadProposals(supabase: Awaited<ReturnType<typeof getSellerAccount>>["supabase"], opportunityId: string, cities: Awaited<ReturnType<typeof getSupportedLocations>>["cities"]) {
  const { data: proposals, error } = await supabase.from("creator_product_opportunity_proposals")
    .select("id,creator_profile_id,amount,offer_details,status,share_email,share_phone,created_at")
    .eq("opportunity_id", opportunityId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const creatorIds = [...new Set(proposals.map((proposal) => proposal.creator_profile_id))];
  if (!creatorIds.length) return [];
  const [creatorsResult, accountsResult, audienceResult] = await Promise.all([
    supabase.from("creator_profiles").select("id,slug,published_display_name").in("id", creatorIds),
    supabase.from("creator_platform_accounts").select("creator_profile_id,follower_count").in("creator_profile_id", creatorIds).eq("is_published", true),
    supabase.from("creator_profile_audience_cities").select("creator_profile_id,city_id").in("creator_profile_id", creatorIds).eq("is_published", true),
  ]);
  for (const result of [creatorsResult, accountsResult, audienceResult]) if (result.error) throw new Error(result.error.message);
  const [influenceById, ratingsResult] = await Promise.all([
    getCreatorInfluence(supabase, creatorIds),
    supabase.rpc("get_creator_opportunity_ratings", { p_creator_profile_ids: creatorIds }),
  ]);
  if (ratingsResult.error) throw new Error(ratingsResult.error.message);
  const ratingByCreator = new Map((ratingsResult.data ?? []).map((rating) => [rating.creator_profile_id, rating]));
  const creators = new Map((creatorsResult.data ?? []).map((creator) => [creator.id, creator]));
  const followersByCreator = new Map<string, number>();
  for (const account of accountsResult.data ?? []) followersByCreator.set(account.creator_profile_id, (followersByCreator.get(account.creator_profile_id) ?? 0) + account.follower_count);
  const audienceByCreator = new Map<string, string[]>();
  for (const audience of audienceResult.data ?? []) audienceByCreator.set(audience.creator_profile_id, [...(audienceByCreator.get(audience.creator_profile_id) ?? []), audience.city_id]);
  const cityById = new Map(cities.map((city) => [city.city_id, city]));
  return proposals.flatMap((proposal) => {
    const creator = creators.get(proposal.creator_profile_id);
    if (!creator) return [];
    const audienceCities = (audienceByCreator.get(creator.id) ?? []).flatMap((cityId) => cityById.has(cityId) ? [cityById.get(cityId)!] : []);
    return [{ ...proposal, creator, audienceCities, totalFollowers: followersByCreator.get(creator.id) ?? 0, influence: influenceById.get(creator.id), rating: ratingByCreator.get(creator.id) }];
  });
}
