import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createProductMediaUrls } from "@/lib/supabase/storage";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";

export function londonOfferDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function getAvailableSellerOffers(supabase: SupabaseClient<Database>, cityId: string | null) {
  if (!cityId) return { offers: [], available: true };
  let { data, error } = await supabase.from("seller_offers")
    .select("id,title,offer_kind,description,benefit_details,discount_percent,media_url,media_storage_path,product_media_path,media_type,points_cost,audience,terms,valid_from,valid_until,fulfillment,external_url,external_code,max_claims,max_per_customer,target_all_uk,seller_offer_locations(id,offer_id,city_id,branch_name,branch_address),audience_locations:seller_offer_locations()")
    .eq("status", "published").eq("audience_locations.city_id", cityId)
    .or("target_all_uk.eq.true,audience_locations.not.is.null")
    .gte("valid_until", londonOfferDate()).order("valid_from").limit(60);
  if (error?.code === "42703" || error?.code === "PGRST204") {
    const legacy = await supabase.from("seller_offers")
      .select("id,title,offer_kind,description,benefit_details,discount_percent,media_url,media_storage_path,product_media_path,media_type,points_cost,terms,valid_from,valid_until,fulfillment,external_url,external_code,max_claims,seller_offer_locations!inner(id,offer_id,city_id,branch_name,branch_address)")
      .eq("status", "published").eq("seller_offer_locations.city_id", cityId)
      .gte("valid_until", londonOfferDate()).order("valid_from").limit(60);
    data = legacy.data?.map((offer) => ({
      ...offer,
      audience: offer.points_cost > 0 ? "reward" as const : "general" as const,
      max_per_customer: 3,
      target_all_uk: false,
      audience_locations: [],
    })) ?? null;
    error = legacy.error;
  }
  if (isSellerOfferSchemaUnavailable(error) || error?.code === "42703") return { offers: [], available: false };
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Offer data is unavailable.");
  const [productUrls, availability] = await Promise.all([
    createProductMediaUrls(supabase, data.flatMap((offer) => offer.product_media_path ? [offer.product_media_path] : [])),
    data.length ? supabase.rpc("get_public_seller_offer_availability", { p_offer_ids: data.map((offer) => offer.id) }) : { data: [], error: null },
  ]);
  if (availability.error) throw new Error(availability.error.message);
  const remaining = new Map(availability.data?.map((offer) => [offer.offer_id, offer.remaining_claims]));
  const offers = await Promise.all(data.map(async (offer) => {
    let mediaDisplayUrl = offer.product_media_path ? productUrls.get(offer.product_media_path) ?? "" : offer.media_url ?? "";
    if (offer.media_storage_path) {
      const { data: media, error: mediaError } = await supabase.storage.from("seller-offer-media").createSignedUrl(offer.media_storage_path, 1800);
      if (!mediaError) mediaDisplayUrl = media.signedUrl;
    }
    return { ...offer, mediaDisplayUrl, remainingClaims: remaining.get(offer.id) ?? null, locations: offer.seller_offer_locations };
  }));
  return { offers, available: true };
}

export type AvailableSellerOffer = Awaited<ReturnType<typeof getAvailableSellerOffers>>["offers"][number];