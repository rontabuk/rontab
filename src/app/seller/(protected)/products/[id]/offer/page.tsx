import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProductOfferForm } from "@/components/seller/ProductOfferForm";
import { getSellerAccount } from "@/lib/seller/access";
import { getSupportedLocations } from "@/lib/locations";
import { createProductMediaUrls } from "@/lib/supabase/storage";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";
import { londonOfferDate } from "@/lib/seller/available-offers";
import { PRODUCT_REWARD_POINTS } from "@/lib/seller/offer-policy";
import { isUuid } from "@/lib/validation";
import "../../../../seller.css";

export const metadata: Metadata = { title: "Offer to the public", robots: { index: false, follow: false } };
export const instant = false;

export default async function ProductOfferPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const [{ id }, { supabase, seller }, { countries, cities }] = await Promise.all([params, getSellerAccount(), getSupportedLocations()]);
  if (!isUuid(id)) notFound();
  const [productResult, mediaResult, contactResult, audienceResult, settingsResult] = await Promise.all([
    supabase.from("products").select("id,name,status,external_url").eq("id", id).eq("seller_profile_id", seller.id).maybeSingle(),
    supabase.from("product_images").select("storage_path,media_type").eq("product_id", id).order("sort_order").limit(1),
    supabase.from("seller_contact_details").select("business_postcode").eq("seller_profile_id", seller.id).maybeSingle(),
    seller.status === "active" ? supabase.rpc("seller_get_product_offer_audience") : { data: [], error: null },
    supabase.from("seller_offer_settings").select("default_reward_points").eq("singleton", true).maybeSingle(),
  ]);
  if (productResult.error) throw new Error(productResult.error.message);
  if (!productResult.data) notFound();
  if (mediaResult.error) throw new Error(mediaResult.error.message);
  if (contactResult.error) throw new Error(contactResult.error.message);
  const unavailable = isSellerOfferSchemaUnavailable(audienceResult.error);
  if (audienceResult.error && !unavailable) throw new Error(audienceResult.error.message);
  if (settingsResult.error && !isSellerOfferSchemaUnavailable(settingsResult.error)) throw new Error(settingsResult.error.message);
  const media = mediaResult.data[0];
  const urls = await createProductMediaUrls(supabase, media ? [media.storage_path] : []);
  const mediaUrl = media ? urls.get(media.storage_path) : null;
  const product = productResult.data;
  const eligible = product.status === "approved" && seller.status === "active" && Boolean(media);
  return <main className="admin-overview seller-overview seller-product-offer-page">
    <Link className="seller-product-offer-back" href="/seller/products"><ArrowLeft size={14} aria-hidden="true" />Your products</Link>
    <header className="admin-page-heading"><p className="admin-eyebrow">PRODUCT OFFER</p><h1>Offer to the public</h1></header>
    <section className="seller-product-offer-preview" aria-label="Selected product">
      {mediaUrl && (media.media_type === "video" ? <video src={mediaUrl} muted playsInline controls preload="metadata" aria-label={product.name} /> : <Image src={mediaUrl} alt={product.name} width={90} height={90} unoptimized />)}
      <h2>{product.name}</h2>
    </section>
    {unavailable ? <p className="seller-account-notice">Product offers are not enabled in this database yet.</p> : !eligible ? <p className="seller-account-notice">An active seller account and an approved product with media are required.</p> : <ProductOfferForm
      productId={product.id} requestId={crypto.randomUUID()} countries={countries.filter((country) => country.country_code === "GB")}
      cities={cities.filter((city) => city.country_code === "GB")} rewardPoints={settingsResult.data?.default_reward_points ?? PRODUCT_REWARD_POINTS}
      postcode={contactResult.data?.business_postcode ?? ""} today={londonOfferDate()} audienceCounts={audienceResult.data ?? []} shopUrl={product.external_url}
    />}
  </main>;
}