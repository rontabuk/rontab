import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, CalendarDays, MapPin, PackageCheck, Send, UsersRound } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { SellerVerificationBadge } from "@/components/seller/SellerVerificationBadge";
import { submitCreatorProductOpportunityProposal, withdrawCreatorProductOpportunityProposal } from "@/app/visitor/creator-opportunity-actions";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatDate, formatPrice } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import { getVisitorAccount } from "@/lib/visitor/access";
import { isUuid } from "@/lib/validation";
import { createProductMediaUrls } from "@/lib/supabase/storage";
import "../opportunities.css";

export const metadata: Metadata = { title: "Creator promotion details", robots: { index: false, follow: false } };
export const instant = false;

export default async function CreatorOpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ opportunityId: string }>;
  searchParams: Promise<{ submitted?: string; withdrawn?: string }>;
}) {
  await connection();
  const [{ opportunityId }, { submitted, withdrawn }, { supabase }, { cities }] = await Promise.all([
    params,
    searchParams,
    getVisitorAccount("/visitor/creator/opportunities"),
    getSupportedLocations(),
  ]);
  if (!isUuid(opportunityId)) notFound();

  const { data: profileId, error: profileIdError } = await supabase.rpc("get_my_creator_profile_id");
  if (profileIdError) throw new Error(profileIdError.message);
  const { data: creator, error: creatorError } = profileId
    ? await supabase.from("creator_profiles").select("id,status,is_public").eq("id", profileId).maybeSingle()
    : { data: null, error: null };
  if (creatorError) throw new Error(creatorError.message);

  let opportunity: {
    id: string;
    product_id: string;
    seller_profile_id: string;
    budget: number;
    currency: string;
    target_specialties: string[];
    is_nationwide: boolean;
    target_city_ids: string[];
    brief: string;
    product_provided: boolean;
    deadline: string | null;
    contact_methods: string[];
    status: string;
  } | null = null;
  let proposal: {
    id: string;
    amount: number;
    offer_details: string;
    status: string;
    share_email: boolean;
    share_phone: boolean;
  } | null = null;

  if (creator?.is_public && creator.status === "approved") {
    const [{ data, error }, { data: proposalData, error: proposalError }] = await Promise.all([
      supabase.from("creator_product_opportunities")
        .select("id,product_id,seller_profile_id,budget,currency,target_specialties,is_nationwide,target_city_ids,brief,product_provided,deadline,contact_methods,status")
        .eq("id", opportunityId).maybeSingle(),
      supabase.from("creator_product_opportunity_proposals")
        .select("id,amount,offer_details,status,share_email,share_phone")
        .eq("opportunity_id", opportunityId)
        .eq("creator_profile_id", creator.id)
        .maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    if (proposalError) throw new Error(proposalError.message);
    opportunity = data;
    proposal = proposalData;
  }

  if (!opportunity) {
    if (!creator?.is_public || creator.status !== "approved") {
      return (
        <main className="admin-overview visitor-creator-page creator-opportunities-page">
          <Link className="creator-opportunity-back" href="/visitor/creator/opportunities"><ArrowLeft size={14} aria-hidden="true" />All promotions</Link>
          <div className="admin-empty-state"><h1>An approved creator profile is needed</h1><p>Publish your creator profile to view matching product promotions.</p><Link href="/visitor/creator">Manage creator profile<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        </main>
      );
    }
    notFound();
  }
  if (!creator?.is_public || creator.status !== "approved") notFound();

  const [{ data: product, error: productError }, { data: images, error: imagesError }, { data: seller, error: sellerError }, { data: badgeRows, error: badgesError }, { data: creatorContact, error: creatorContactError }] = await Promise.all([
    supabase.from("products").select("id,name,slug,description,price,currency,category_id").eq("id", opportunity.product_id).eq("status", "approved").maybeSingle(),
    supabase.from("product_images").select("storage_path,media_type,alt_text,sort_order").eq("product_id", opportunity.product_id).order("sort_order"),
    supabase.from("seller_profiles").select("id,slug,shop_name").eq("id", opportunity.seller_profile_id).eq("status", "active").eq("is_public", true).maybeSingle(),
    supabase.rpc("get_public_seller_verification_badges", { p_seller_profile_ids: [opportunity.seller_profile_id] }),
    supabase.from("creator_contact_details").select("phone").eq("creator_profile_id", creator.id).maybeSingle(),
  ]);
  for (const result of [productError, imagesError, sellerError, badgesError, creatorContactError]) {
    if (result) throw new Error(result.message);
  }
  if (!product || !seller) notFound();

  const [{ data: category, error: categoryError }, { data: contact, error: contactError }] = await Promise.all([
    supabase.from("categories").select("name").eq("id", product.category_id).maybeSingle(),
    proposal?.status === "selected"
      ? supabase.rpc("get_creator_product_opportunity_contact", { p_proposal_id: proposal.id })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (categoryError) throw new Error(categoryError.message);
  if (contactError) throw new Error(contactError.message);

  const media = [...(images ?? [])].sort((first, second) => Number(second.media_type === "video") - Number(first.media_type === "video"))[0];
  const mediaUrls = await createProductMediaUrls(supabase, media ? [media.storage_path] : []);
  const mediaUrl = media ? mediaUrls.get(media.storage_path) : null;
  const cityNames = new Map(cities.map((city) => [city.city_id, city.city_name]));
  const badge = badgeRows?.find((row) => row.is_verified);
  const sellerBadge = badge ? <SellerVerificationBadge isBlue={badge.is_blue} /> : null;
  const selectedContact = contact?.[0] ?? null;

  return (
    <main className="admin-overview visitor-creator-page creator-opportunities-page creator-opportunity-detail-page">
      <Link className="creator-opportunity-back" href="/visitor/creator/opportunities"><ArrowLeft size={14} aria-hidden="true" />All promotions</Link>
      {submitted === "1" && <p className="admin-save-success" role="status">Your offer was sent to the seller.</p>}
      {withdrawn === "1" && <p className="admin-save-success" role="status">Your pending offer was withdrawn.</p>}
      <header className="creator-opportunity-detail-heading">
        <p className="admin-eyebrow">{category?.name ?? "Product promotion"}</p>
        <h1>{product.name}</h1>
        <p>{seller.shop_name} {sellerBadge}</p>
      </header>

      <section className="creator-opportunity-detail-product">
        {mediaUrl && (media?.media_type === "video"
          ? <video src={mediaUrl} controls preload="metadata" aria-label={`${product.name} product video`} />
          : <Image src={mediaUrl} alt={media.alt_text || product.name} width={260} height={300} unoptimized />)}
        <div>
          <p className="creator-opportunity-detail-price">{product.price === null ? "Price on request" : formatPrice(product.price, product.currency)}</p>
          <p>{product.description}</p>
          <Link href={`/products/${product.slug}`} target="_blank">View product<ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className="creator-opportunity-detail-terms" aria-labelledby="promotion-details-title">
        <div className="creator-opportunity-budget-line"><strong>{formatPrice(opportunity.budget, opportunity.currency)}</strong><span>Promotion budget</span></div>
        <h2 id="promotion-details-title">Campaign details</h2>
        <p className="creator-opportunity-target-line">Seller will share: {opportunity.contact_methods.map((method) => method === "email" ? "Email" : "Phone").join(" or ")}</p>
        <p className="creator-opportunity-target-line"><UsersRound size={14} aria-hidden="true" />{opportunity.target_specialties.map((specialty) => creatorSpecialties.find((item) => item.value === specialty)?.label ?? specialty).join(", ")}</p>
        <p className="creator-opportunity-target-line"><MapPin size={14} aria-hidden="true" />{opportunity.is_nationwide ? "United Kingdom" : opportunity.target_city_ids.map((cityId) => cityNames.get(cityId)).filter(Boolean).join(", ")}</p>
        {opportunity.deadline && <p className="creator-opportunity-target-line"><CalendarDays size={14} aria-hidden="true" />Preferred completion: {formatDate(opportunity.deadline)}</p>}
        {opportunity.product_provided && <p className="creator-opportunity-target-line"><PackageCheck size={14} aria-hidden="true" />Seller plans to provide the product</p>}
        <p className="creator-opportunity-brief">{opportunity.brief}</p>
      </section>

      {proposal?.status === "selected" && <div className="creator-opportunity-result is-selected"><strong>Your offer was selected</strong><p>Contact the seller to agree payment and delivery directly.</p>{selectedContact?.email && <a href={`mailto:${selectedContact.email}`}>{selectedContact.email}</a>}{selectedContact?.phone && <a href={`tel:${selectedContact.phone}`}>{selectedContact.phone}</a>}</div>}
      {proposal?.status === "not_selected" && <p className="creator-opportunity-result">The seller selected another offer.</p>}
      {proposal?.status === "pending" && <div className="creator-opportunity-result"><strong>Your offer: {formatPrice(proposal.amount, opportunity.currency)}</strong><p>The seller is reviewing your offer.</p><p>{proposal.offer_details}</p><form action={withdrawCreatorProductOpportunityProposal}><input type="hidden" name="proposal_id" value={proposal.id} /><button type="submit">Withdraw offer</button></form></div>}
      {!proposal && opportunity.status === "open" && <ActionForm className="creator-opportunity-offer-form creator-opportunity-detail-form" action={submitCreatorProductOpportunityProposal}>
        <input type="hidden" name="opportunity_id" value={opportunity.id} />
        <h2>Send your offer</h2>
        <label>Your offer amount ({opportunity.currency})<input name="amount" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required /></label>
        <label>What you will deliver<textarea name="offer_details" minLength={30} maxLength={2000} rows={5} required placeholder="Describe the platform, content format, and what is included in your price." /></label>
        <fieldset><legend>Contact details shared only if selected</legend><label><input type="checkbox" name="share_email" />Share my confirmed account email</label><label><input type="checkbox" name="share_phone" />Share my phone number</label><input name="contact_phone" type="tel" maxLength={32} defaultValue={creatorContact?.phone ?? ""} placeholder="Add a phone in your creator profile" /></fieldset>
        <p>Payment is agreed directly with the seller. The platform does not collect campaign payments.</p>
        <button type="submit"><Send size={14} aria-hidden="true" />Send offer</button>
      </ActionForm>}
      <p className="creator-opportunity-disclosure">Offers and payment are arranged directly by the seller and creator. The platform does not handle campaign payments or guarantee delivery.</p>
    </main>
  );
}
