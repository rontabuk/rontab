import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, CalendarDays, MapPin, PackageCheck, Send, UsersRound } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { withdrawCreatorProductOpportunityProposal, submitCreatorProductOpportunityProposal } from "@/app/visitor/creator-opportunity-actions";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatDate, formatPrice } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import { getVisitorAccount } from "@/lib/visitor/access";
import { createProductMediaUrls } from "@/lib/supabase/storage";
import "../../visitor.css";
import "./opportunities.css";

export const metadata: Metadata = { title: "Available creator opportunities", robots: { index: false, follow: false } };
export const instant = false;

export default async function CreatorOpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; withdrawn?: string }>;
}) {
  await connection();
  const [{ submitted, withdrawn }, { supabase }, { cities }] = await Promise.all([
    searchParams,
    getVisitorAccount("/visitor/creator/opportunities"),
    getSupportedLocations(),
  ]);
  const { data: profileId, error: profileIdError } = await supabase.rpc("get_my_creator_profile_id");
  if (profileIdError) throw new Error(profileIdError.message);
  const { data: creator, error: creatorError } = profileId
    ? await supabase.from("creator_profiles").select("id,status,is_public").eq("id", profileId).maybeSingle()
    : { data: null, error: null };
  if (creatorError) throw new Error(creatorError.message);

  let proposals: Awaited<ReturnType<typeof loadProposals>> = [];
  let opportunityRows: Awaited<ReturnType<typeof loadOpenOpportunities>> = [];
  let creatorPhone = "";
  if (creator?.is_public && creator.status === "approved") {
    const [proposalsResult, open, contactResult] = await Promise.all([
      loadProposals(supabase, creator.id),
      loadOpenOpportunities(supabase),
      supabase.from("creator_contact_details").select("phone").eq("creator_profile_id", creator.id).maybeSingle(),
    ]);
    if (contactResult.error) throw new Error(contactResult.error.message);
    creatorPhone = contactResult.data?.phone ?? "";
    proposals = proposalsResult;
    const historyIds = proposals.map((proposal) => proposal.opportunity_id);
    const history = historyIds.length ? await loadOpportunitiesById(supabase, historyIds) : [];
    opportunityRows = [...new Map([...open, ...history].map((opportunity) => [opportunity.id, opportunity])).values()];
  }
  const productIds = [...new Set(opportunityRows.map((opportunity) => opportunity.product_id))];
  const sellerIds = [...new Set(opportunityRows.map((opportunity) => opportunity.seller_profile_id))];
  const [productsResult, imageResult, sellersResult] = await Promise.all([
    productIds.length
      ? supabase.from("products").select("id,name,slug,description,price,currency,category_id").in("id", productIds).eq("status", "approved")
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase.from("product_images").select("id,product_id,storage_path,media_type,alt_text,sort_order").in("product_id", productIds).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
    sellerIds.length
      ? supabase.from("seller_profiles").select("id,slug,shop_name,logo_url").in("id", sellerIds).eq("status", "active").eq("is_public", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw new Error(productsResult.error.message);
  if (imageResult.error) throw new Error(imageResult.error.message);
  if (sellersResult.error) throw new Error(sellersResult.error.message);
  const products = new Map((productsResult.data ?? []).map((product) => [product.id, product]));
  const sellers = new Map((sellersResult.data ?? []).map((seller) => [seller.id, seller]));
  const visibleOpportunityRows = opportunityRows.filter((opportunity) => products.has(opportunity.product_id));
  const categoryIds = [...new Set([...products.values()].map((product) => product.category_id))];
  const { data: categories, error: categoriesError } = categoryIds.length
    ? await supabase.from("categories").select("id,name").in("id", categoryIds)
    : { data: [], error: null };
  if (categoriesError) throw new Error(categoriesError.message);
  const categoryNames = new Map((categories ?? []).map((category) => [category.id, category.name]));
  const mediaUrls = await createProductMediaUrls(supabase, (imageResult.data ?? []).map((media) => media.storage_path));
  const leadImages = new Map<string, { url: string; alt: string; mediaType: string }>();
  for (const media of imageResult.data ?? []) {
    if (!leadImages.has(media.product_id) && mediaUrls.has(media.storage_path)) {
      leadImages.set(media.product_id, { url: mediaUrls.get(media.storage_path)!, alt: media.alt_text, mediaType: media.media_type });
    }
  }
  const proposalsByOpportunity = new Map(proposals.map((proposal) => [proposal.opportunity_id, proposal]));
  const cityNames = new Map(cities.map((city) => [city.city_id, city.city_name]));
  const selectedProposals = proposals.filter((proposal) => proposal.status === "selected");
  const contactResults = await Promise.all(selectedProposals.map(async (proposal) => {
    const { data, error } = await supabase.rpc("get_creator_product_opportunity_contact", { p_proposal_id: proposal.id });
    if (error) throw new Error(error.message);
    return [proposal.id, data?.[0] ?? null] as const;
  }));
  const contactsByProposal = new Map(contactResults);

  return (
    <main className="admin-overview visitor-creator-page creator-opportunities-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CREATOR PROGRAMME</p>
        <h1>Available product promotions</h1>
        <p>Review offers from sellers whose product category, audience area and creator specialties match your profile.</p>
      </header>
      {submitted === "1" && <p className="admin-save-success" role="status">Your offer has been sent to the seller.</p>}
      {withdrawn === "1" && <p className="admin-save-success" role="status">Your pending offer was withdrawn.</p>}
      {!creator?.is_public || creator.status !== "approved" ? (
        <div className="admin-empty-state"><h2>An approved creator profile is needed</h2><p>Publish your creator profile to see matching product promotions and send offers.</p><Link href="/visitor/creator">Manage creator profile<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
      ) : visibleOpportunityRows.length ? (
        <div className="creator-opportunity-feed">
          {visibleOpportunityRows.map((opportunity) => {
            const product = products.get(opportunity.product_id)!;
            const seller = sellers.get(opportunity.seller_profile_id);
            const proposal = proposalsByOpportunity.get(opportunity.id);
            const image = leadImages.get(product.id);
            return (
              <article className="creator-opportunity-card" key={opportunity.id}>
                <div className="creator-opportunity-card-product">
                  {image && <Image src={image.url} alt={image.alt || product.name} width={100} height={118} unoptimized />}
                  <div><p className="creator-opportunity-category">{categoryNames.get(product.category_id) ?? "Product"}</p>{seller && <Link className="creator-opportunity-seller-link" href={`/shops/${seller.slug}`}>{seller.shop_name}<ArrowUpRight size={13} aria-hidden="true" /></Link>}<h2>{product.name}</h2><p>{formatPrice(product.price, product.currency)}</p><Link href={`/products/${product.slug}`} target="_blank">View product<ArrowUpRight size={13} aria-hidden="true" /></Link></div>
                </div>
                <div className="creator-opportunity-card-terms">
                  <p className="creator-opportunity-budget-line"><strong>{formatPrice(opportunity.budget, opportunity.currency)}</strong><span>Promotion budget</span></p>
                  <p className="creator-opportunity-target-line">Seller will share: {opportunity.contact_methods.map((method) => method === "email" ? "Email" : "Phone").join(" or ")}</p>
                  <p className="creator-opportunity-target-line"><UsersRound size={14} aria-hidden="true" />{opportunity.target_specialties.map((specialty) => creatorSpecialties.find((item) => item.value === specialty)?.label ?? specialty).join(", ")}</p>
                  <p className="creator-opportunity-target-line"><MapPin size={14} aria-hidden="true" />{opportunity.is_nationwide ? "United Kingdom" : opportunity.target_city_ids.map((cityId) => cityNames.get(cityId)).filter(Boolean).join(", ")}</p>
                  {opportunity.deadline && <p className="creator-opportunity-target-line"><CalendarDays size={14} aria-hidden="true" />Preferred completion: {formatDate(opportunity.deadline)}</p>}
                  {opportunity.product_provided && <p className="creator-opportunity-target-line"><PackageCheck size={14} aria-hidden="true" />Seller plans to provide the product</p>}
                  <p className="creator-opportunity-brief">{opportunity.brief}</p>
                  {proposal?.status === "selected" && <div className="creator-opportunity-result is-selected"><strong>Your offer was selected</strong><p>Contact the seller to agree payment and delivery directly.</p>{contactsByProposal.get(proposal.id)?.email && <a href={`mailto:${contactsByProposal.get(proposal.id)?.email}`}>{contactsByProposal.get(proposal.id)?.email}</a>}{contactsByProposal.get(proposal.id)?.phone && <a href={`tel:${contactsByProposal.get(proposal.id)?.phone}`}>{contactsByProposal.get(proposal.id)?.phone}</a>}</div>}
                  {proposal?.status === "not_selected" && <p className="creator-opportunity-result">The seller selected another offer.</p>}
                  {proposal?.status === "pending" && <div className="creator-opportunity-result"><strong>Your offer: {formatPrice(proposal.amount, opportunity.currency)}</strong><p>The seller is reviewing your offer.</p><form action={withdrawCreatorProductOpportunityProposal}><input type="hidden" name="proposal_id" value={proposal.id} /><button type="submit">Withdraw offer</button></form></div>}
                  {!proposal && opportunity.status === "open" && <ActionForm className="creator-opportunity-offer-form" action={submitCreatorProductOpportunityProposal}>
                    <input type="hidden" name="opportunity_id" value={opportunity.id} />
                    <label>Your offer amount ({opportunity.currency})<input name="amount" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required /></label>
                    <label>What you will deliver<textarea name="offer_details" minLength={30} maxLength={2000} rows={4} required placeholder="Describe the platform, content format, and what is included in your price." /></label>
                    <fieldset><legend>Contact details shared only if selected</legend><label><input type="checkbox" name="share_email" />Share my confirmed account email</label><label><input type="checkbox" name="share_phone" />Share my phone number</label><input name="contact_phone" type="tel" maxLength={32} defaultValue={creatorPhone} placeholder="Add a phone in your creator profile" /></fieldset>
                    <p>Payment is agreed directly with the seller. Rontab does not collect campaign payments.</p>
                    <button type="submit"><Send size={14} aria-hidden="true" />Send offer</button>
                  </ActionForm>}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="admin-empty-state"><h2>No matching promotions right now</h2><p>New opportunities will appear here when the campaign specialty and audience area match your approved profile.</p></div>
      )}
      <p className="creator-opportunity-disclosure">Offers and payment are arranged directly by the seller and creator. Rontab does not handle campaign payments or guarantee delivery.</p>
    </main>
  );
}

async function loadProposals(supabase: Awaited<ReturnType<typeof getVisitorAccount>>["supabase"], creatorProfileId: string) {
  const { data, error } = await supabase.from("creator_product_opportunity_proposals")
    .select("id,opportunity_id,amount,offer_details,status,share_email,share_phone,created_at")
    .eq("creator_profile_id", creatorProfileId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadOpenOpportunities(supabase: Awaited<ReturnType<typeof getVisitorAccount>>["supabase"]) {
  const { data, error } = await supabase.from("creator_product_opportunities")
    .select("id,product_id,seller_profile_id,budget,currency,target_specialties,is_nationwide,target_city_ids,brief,product_provided,deadline,contact_methods,status,created_at")
    .eq("status", "open").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadOpportunitiesById(supabase: Awaited<ReturnType<typeof getVisitorAccount>>["supabase"], opportunityIds: string[]) {
  const { data, error } = await supabase.from("creator_product_opportunities")
    .select("id,product_id,seller_profile_id,budget,currency,target_specialties,is_nationwide,target_city_ids,brief,product_provided,deadline,contact_methods,status,created_at")
    .in("id", opportunityIds);
  if (error) throw new Error(error.message);
  return data ?? [];
}
