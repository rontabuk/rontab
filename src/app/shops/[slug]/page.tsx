import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, MapPin, Phone } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatNumber } from "@/lib/format";
import { getPublicCatalog } from "@/lib/supabase/catalog";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import "./shop.css";

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await createSupabasePublicClient().from("seller_profiles")
    .select("shop_name,description")
    .eq("slug", slug)
    .eq("status", "active")
    .eq("is_public", true)
    .maybeSingle();
  return data
    ? { title: `${data.shop_name} | Rontab Shops`, description: data.description?.slice(0, 160) ?? `Discover products from ${data.shop_name} on Rontab.` }
    : { title: "Shop not found | Rontab" };
}

export default async function PublicShopPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const supabase = createSupabasePublicClient();
  const [{ data: seller, error: sellerError }, catalog] = await Promise.all([
    supabase.from("seller_profiles")
      .select("id,slug,shop_name,description,logo_url,shop_url,shop_city_id,status,is_public")
      .eq("slug", slug)
      .eq("status", "active")
      .eq("is_public", true)
      .maybeSingle(),
    getPublicCatalog(),
  ]);
  if (sellerError) throw new Error(sellerError.message);
  if (!seller) notFound();

  const [{ data: city, error: cityError }, { data: phone, error: phoneError }] = await Promise.all([
    seller.shop_city_id
      ? supabase.from("supported_cities").select("city_name").eq("city_id", seller.shop_city_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("get_public_seller_contact_phone", { p_seller_profile_id: seller.id }),
  ]);
  if (cityError) throw new Error(cityError.message);
  if (phoneError) throw new Error(phoneError.message);
  const products = catalog.products.filter((product) => product.sellerProfileId === seller.id);

  return (
    <>
      <SiteHeader />
      <main className="public-shop-page">
        <Link className="public-shop-back" href="/products"><ArrowLeft size={14} aria-hidden="true" />Browse products</Link>
        <header className="public-shop-hero">
          {seller.logo_url
            ? <Image className="public-shop-logo" src={seller.logo_url} alt={`${seller.shop_name} logo`} width={104} height={104} unoptimized />
            : <span className="public-shop-logo public-shop-logo-fallback" aria-hidden="true">{seller.shop_name.slice(0, 1).toUpperCase()}</span>}
          <div>
            <p className="public-shop-kicker">RONTAB SHOP</p>
            <h1>{seller.shop_name}</h1>
            {seller.description && <p className="public-shop-description">{seller.description}</p>}
            <div className="public-shop-meta">
              {city && <span><MapPin size={14} aria-hidden="true" />{city.city_name}</span>}
              {seller.shop_url && <a href={seller.shop_url} target="_blank" rel="noreferrer">Shop website<ArrowUpRight size={13} aria-hidden="true" /></a>}
              {phone && <a href={`tel:${phone}`}><Phone size={14} aria-hidden="true" />{phone}</a>}
            </div>
          </div>
        </header>
        <section aria-labelledby="public-shop-products-title">
          <div className="public-shop-section-heading">
            <h2 id="public-shop-products-title">Products</h2>
            <span>{formatNumber(products.length)}</span>
          </div>
          {products.length
            ? <div className="public-shop-products">{products.map((product) => <ProductCard product={product} key={product.slug} />)}</div>
            : <p className="public-shop-empty">This shop has no published products right now.</p>}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
