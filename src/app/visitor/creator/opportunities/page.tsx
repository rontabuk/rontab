import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowRight, ArrowUpRight, MapPin, Search } from "lucide-react";
import { SellerVerificationBadge } from "@/components/seller/SellerVerificationBadge";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatNumber, formatPrice } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import { getVisitorAccount } from "@/lib/visitor/access";
import { createProductMediaUrls } from "@/lib/supabase/storage";
import "./opportunities.css";

export const metadata: Metadata = { title: "Available creator opportunities", robots: { index: false, follow: false } };
export const instant = false;

export default async function CreatorOpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; withdrawn?: string; q?: string; specialty?: string; city?: string; sort?: string; page?: string }>;
}) {
  await connection();
  const [{ submitted, withdrawn, q: requestedQuery, specialty: requestedSpecialty, city: requestedCity, sort: requestedSort, page: requestedPage }, { supabase }, { cities }] = await Promise.all([
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
  if (creator?.is_public && creator.status === "approved") {
    const [proposalsResult, open] = await Promise.all([
      loadProposals(supabase, creator.id),
      loadOpenOpportunities(supabase),
    ]);
    proposals = proposalsResult;
    const historyIds = proposals.map((proposal) => proposal.opportunity_id);
    const history = historyIds.length ? await loadOpportunitiesById(supabase, historyIds) : [];
    opportunityRows = [...new Map([...open, ...history].map((opportunity) => [opportunity.id, opportunity])).values()];
  }
  const productIds = [...new Set(opportunityRows.map((opportunity) => opportunity.product_id))];
  const sellerIds = [...new Set(opportunityRows.map((opportunity) => opportunity.seller_profile_id))];
  const [productsResult, imageResult, sellersResult, sellerBadgesResult] = await Promise.all([
    productIds.length
      ? supabase.from("products").select("id,name,slug,description,price,currency,category_id").in("id", productIds).eq("status", "approved")
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase.from("product_images").select("id,product_id,storage_path,media_type,alt_text,sort_order").in("product_id", productIds).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
    sellerIds.length
      ? supabase.from("seller_profiles").select("id,slug,shop_name,logo_url").in("id", sellerIds).eq("status", "active").eq("is_public", true)
      : Promise.resolve({ data: [], error: null }),
    sellerIds.length
      ? supabase.rpc("get_public_seller_verification_badges", { p_seller_profile_ids: sellerIds })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw new Error(productsResult.error.message);
  if (imageResult.error) throw new Error(imageResult.error.message);
  if (sellersResult.error) throw new Error(sellersResult.error.message);
  if (sellerBadgesResult.error) throw new Error(sellerBadgesResult.error.message);
  const products = new Map((productsResult.data ?? []).map((product) => [product.id, product]));
  const sellers = new Map((sellersResult.data ?? []).map((seller) => [seller.id, seller]));
  const sellerBadges = new Map((sellerBadgesResult.data ?? []).filter((badge) => badge.is_verified).map((badge) => [badge.seller_profile_id, badge]));
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
  const query = (requestedQuery ?? "").trim().slice(0, 100);
  const specialty = creatorSpecialties.find((item) => item.value === requestedSpecialty)?.value ?? "all";
  const city = cities.find((item) => item.city_id === requestedCity)?.city_id ?? "all";
  const sort = requestedSort === "budget-high" || requestedSort === "budget-low" ? requestedSort : "newest";
  const hasFilters = Boolean(query || specialty !== "all" || city !== "all" || sort !== "newest");
  const matchingOpportunities = visibleOpportunityRows.filter((opportunity) => {
    const product = products.get(opportunity.product_id)!;
    const sellerName = sellers.get(opportunity.seller_profile_id)?.shop_name ?? "";
    const searchMatches = !query || `${product.name} ${sellerName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    const specialtyMatches = specialty === "all" || opportunity.target_specialties.includes(specialty);
    const cityMatches = city === "all" || opportunity.is_nationwide || opportunity.target_city_ids.includes(city);
    return searchMatches && specialtyMatches && cityMatches;
  }).sort((first, second) => {
    if (sort === "budget-high") return second.budget - first.budget || second.created_at.localeCompare(first.created_at);
    if (sort === "budget-low") return first.budget - second.budget || second.created_at.localeCompare(first.created_at);
    return second.created_at.localeCompare(first.created_at);
  });
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(matchingOpportunities.length / pageSize));
  const parsedPage = Number(requestedPage);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, pageCount) : 1;
  const pageOpportunities = matchingOpportunities.slice((page - 1) * pageSize, page * pageSize);
  function pageHref(targetPage: number) {
    const params = new URLSearchParams({ page: String(targetPage), sort });
    if (query) params.set("q", query);
    if (specialty !== "all") params.set("specialty", specialty);
    if (city !== "all") params.set("city", city);
    return `/visitor/creator/opportunities?${params}`;
  }

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
      ) : (
        <>
          <section className="creator-opportunity-discovery" aria-label="Promotion search and filters">
            <span role="status">{formatNumber(matchingOpportunities.length)} matching promotions</span>
            <form className="creator-opportunity-search-filters" action="/visitor/creator/opportunities" method="get">
              <label>Search<input name="q" type="search" maxLength={100} defaultValue={query} placeholder="Product or shop" /></label>
              <label>Specialty<select name="specialty" defaultValue={specialty}>
                <option value="all">All specialties</option>
                {creatorSpecialties.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select></label>
              <label>Audience area<select name="city" defaultValue={city}>
                <option value="all">All areas</option>
                {cities.map((item) => <option value={item.city_id} key={item.city_id}>{item.city_name}</option>)}
              </select></label>
              <label>Sort by<select name="sort" defaultValue={sort}>
                <option value="newest">Newest</option>
                <option value="budget-high">Highest budget</option>
                <option value="budget-low">Lowest budget</option>
              </select></label>
              <button type="submit"><Search size={14} aria-hidden="true" />Apply</button>
              {hasFilters && <Link href="/visitor/creator/opportunities">Clear</Link>}
            </form>
          </section>
          {pageOpportunities.length ? (
            <div className="creator-opportunity-feed">
          {pageOpportunities.map((opportunity) => {
            const product = products.get(opportunity.product_id)!;
            const seller = sellers.get(opportunity.seller_profile_id);
            const proposal = proposalsByOpportunity.get(opportunity.id);
            const image = leadImages.get(product.id);
            return (
              <article className="creator-opportunity-summary" key={opportunity.id}>
                <div className="creator-opportunity-summary-product">
                  {image && <Image src={image.url} alt={image.alt || product.name} width={100} height={118} unoptimized />}
                  <div>
                    <p className="creator-opportunity-category">{categoryNames.get(product.category_id) ?? "Product"}</p>
                    {seller && <Link className="creator-opportunity-seller-link" href={`/shops/${seller.slug}`}>{seller.shop_name}{sellerBadges.has(seller.id) && <SellerVerificationBadge isBlue={sellerBadges.get(seller.id)?.is_blue} />}<ArrowUpRight size={13} aria-hidden="true" /></Link>}
                    <h2><Link href={`/visitor/creator/opportunities/${opportunity.id}`}>{product.name}</Link></h2>
                    <p>{formatPrice(product.price, product.currency)}</p>
                  </div>
                </div>
                <div className="creator-opportunity-summary-info">
                  <p className="creator-opportunity-budget-line"><strong>{formatPrice(opportunity.budget, opportunity.currency)}</strong><span>Promotion budget</span></p>
                  <p className="creator-opportunity-target-line"><MapPin size={14} aria-hidden="true" />{opportunity.is_nationwide ? "United Kingdom" : opportunity.target_city_ids.map((cityId) => cityNames.get(cityId)).filter(Boolean).join(", ")}</p>
                  {proposal && <span className={`creator-opportunity-proposal-status is-${proposal.status}`}>{proposal.status.replaceAll("_", " ")}</span>}
                  <Link className="creator-opportunity-detail-link" href={`/visitor/creator/opportunities/${opportunity.id}`}>View details<ArrowUpRight size={14} aria-hidden="true" /></Link>
                </div>
              </article>
            );
          })}
            </div>
          ) : (
            <div className="admin-empty-state"><h2>{hasFilters ? "No promotions match these filters" : "No matching promotions right now"}</h2><p>New opportunities appear when a seller&apos;s campaign matches your audience and specialties.</p>{hasFilters && <Link href="/visitor/creator/opportunities">Clear filters</Link>}</div>
          )}
          {pageCount > 1 && <nav className="creator-opportunity-pagination" aria-label="Promotion pages">
            {page > 1 ? <Link href={pageHref(page - 1)}><ArrowLeft size={14} aria-hidden="true" />Previous</Link> : <span />}
            <span>Page {formatNumber(page)} of {formatNumber(pageCount)}</span>
            {page < pageCount ? <Link href={pageHref(page + 1)}>Next<ArrowRight size={14} aria-hidden="true" /></Link> : <span />}
          </nav>}
        </>
      )}
      <p className="creator-opportunity-disclosure">Offers and payment are arranged directly by the seller and creator. The platform does not handle campaign payments or guarantee delivery.</p>
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
