import { SellerNavigation } from "@/components/seller/SellerNavigation";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Check, MapPin, Plus, UsersRound } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { SellerVerificationBadge } from "@/components/seller/SellerVerificationBadge";
import { SellerProfileEditButton } from "@/components/seller/SellerProfileEditButton";
import { SellerProfileContactLinks } from "@/components/seller/SellerProfileContactLinks";
import { ProductCard } from "@/components/ProductCard";
import { SiteHeader } from "@/components/SiteChrome";
import { followShop } from "@/app/visitor/shop-follow-actions";
import { getViewer } from "@/lib/auth/viewer";
import { formatNumber } from "@/lib/format";
import { getPublicCatalog } from "@/lib/supabase/catalog";
import { createSupabasePublicClient, createSupabaseServerClient } from "@/lib/supabase/server";
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
    ? { title: `${data.shop_name} | Shops`, description: data.description?.slice(0, 160) ?? `Discover products from ${data.shop_name}.` }
    : { title: "Shop profile", robots: { index: false, follow: false } };
}

export default async function PublicShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ followed?: string; unfollowed?: string; saved?: string }>;
}) {
  await connection();
  const [{ slug }, { followed, unfollowed, saved }, viewer] = await Promise.all([params, searchParams, getViewer()]);
  const supabase = createSupabasePublicClient();
  const [publicSellerResult, catalog, ownershipResult] = await Promise.all([
    supabase.from("seller_profiles")
      .select("id,slug,shop_name,description,logo_url,shop_url,shop_city_id,status,is_public")
      .eq("slug", slug)
      .eq("status", "active")
      .eq("is_public", true)
      .maybeSingle(),
    getPublicCatalog(),
    viewer.role === "seller"
      ? createSupabaseServerClient().then((sessionClient) => sessionClient.from("seller_profiles")
        .select("id,slug,shop_name,description,logo_url,shop_url,shop_city_id,status,is_public").eq("slug", slug).eq("user_id", viewer.userId).maybeSingle())
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (publicSellerResult.error) throw new Error(publicSellerResult.error.message);
  if (ownershipResult.error) throw new Error(ownershipResult.error.message);
  const seller = ownershipResult.data ?? publicSellerResult.data;
  if (!seller) notFound();

  const isOwner = ownershipResult.data?.id === seller.id;
  const [{ data: city, error: cityError }, { data: phone, error: phoneError }, { data: badges, error: badgesError }, { data: followerCount, error: followerCountError }] = await Promise.all([
    seller.shop_city_id
      ? supabase.from("supported_cities").select("city_name").eq("city_id", seller.shop_city_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("get_public_seller_contact_phone", { p_seller_profile_id: seller.id }),
    supabase.rpc("get_public_seller_verification_badges", { p_seller_profile_ids: [seller.id] }),
    isOwner
      ? createSupabaseServerClient().then((sessionClient) => sessionClient.rpc("seller_get_shop_follower_count"))
      : supabase.rpc("get_public_seller_follower_count", { p_seller_profile_id: seller.id }),
  ]);
  if (cityError) throw new Error(cityError.message);
  if (phoneError) throw new Error(phoneError.message);
  if (badgesError) throw new Error(badgesError.message);
  if (followerCountError) throw new Error(followerCountError.message);
  const showSellerOfferActions = isOwner && seller.status === "active";
  const sellerBadge = badges?.find((badge) => badge.is_verified);
  const followers = followerCount ?? 0;
  const products = catalog.products.filter((product) => product.sellerProfileId === seller.id);
  let isFollowing = false;
  if (viewer.role === "visitor") {
    const sessionClient = await createSupabaseServerClient();
    const { data, error } = await sessionClient.rpc("visitor_is_following_seller_shop", { p_seller_profile_id: seller.id });
    if (error) throw new Error(error.message);
    isFollowing = data;
  }

  const shopProfile = (
      <main className="public-shop-page">
        {!isOwner && <Link className="public-shop-back" href="/products"><ArrowLeft size={14} aria-hidden="true" />Browse products</Link>}
        {isOwner && saved === "1" && <p className="public-shop-feedback" role="status">Shop profile saved successfully.</p>}
        {isOwner && (!seller.is_public || seller.status !== "active") && <p className="public-shop-private-notice" role="status">Your shop is not visible to the public. Only you can view this profile.</p>}
        <header className="public-shop-hero">
          {seller.logo_url
            ? <Image className="public-shop-logo" src={seller.logo_url} alt={`${seller.shop_name} logo`} width={104} height={104} unoptimized />
            : <span className="public-shop-logo public-shop-logo-fallback" aria-hidden="true">{seller.shop_name.slice(0, 1).toUpperCase()}</span>}
          <div>
            <div className="public-shop-title-row">
              <h1 className="public-shop-name">{seller.shop_name}{sellerBadge && <SellerVerificationBadge isBlue={sellerBadge.is_blue} />}</h1>
              {isOwner && <SellerProfileEditButton />}
              {viewer.role === "visitor" ? (
                isFollowing ? (
                  <span className="public-shop-follow-status" role="img" aria-label={`Following ${seller.shop_name}`} title={`Following ${seller.shop_name}`}>
                    <Check size={15} aria-hidden="true" />
                  </span>
                ) : (
                <ActionForm className="public-shop-follow-form" action={followShop}>
                  <input type="hidden" name="seller_profile_id" value={seller.id} />
                  <input type="hidden" name="shop_slug" value={seller.slug} />
                  <button className="public-shop-follow-icon-button" type="submit" aria-label={`Follow ${seller.shop_name}`} title={`Follow ${seller.shop_name}`}>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </ActionForm>
                )
              ) : viewer.role === "guest" ? (
                <Link className="public-shop-follow-icon-link" href={`/account?next=${encodeURIComponent(`/shops/${seller.slug}`)}`} aria-label={`Sign in to follow ${seller.shop_name}`} title={`Sign in to follow ${seller.shop_name}`}><Plus size={16} aria-hidden="true" /></Link>
              ) : null}
            </div>
            {seller.description && <p className="public-shop-description">{seller.description}</p>}
            <div className="public-shop-meta">
              {city && <span><MapPin size={14} aria-hidden="true" />{city.city_name}</span>}
              <span><UsersRound size={14} aria-hidden="true" />{formatNumber(followers)} {followers === 1 ? "follower" : "followers"}</span>
            </div>
            <SellerProfileContactLinks sellerProfileId={seller.id} shopUrl={seller.shop_url} publicPhone={phone} isOwner={isOwner} />
            {followed === "1" && <p className="public-shop-feedback" role="status">Shop added to your following list.</p>}
            {unfollowed === "1" && <p className="public-shop-feedback" role="status">Shop removed from your following list.</p>}
          </div>
        </header>
        <section aria-labelledby="public-shop-products-title">
          <div className="public-shop-section-heading">
            <h2 id="public-shop-products-title">Products</h2>
            <span>{formatNumber(products.length)}</span>
          </div>
          {products.length
            ? <div className="product-grid public-shop-products">{products.map((product) => <ProductCard product={product} muteAutoplay showSellerOfferActions={showSellerOfferActions} key={product.slug} />)}</div>
            : <p className="public-shop-empty">This shop has no published products right now.</p>}
        </section>
      </main>
  );

  if (isOwner && viewer.role === "seller") {
    return <WorkspaceShell
      area="SELLER"
      sectionLabel="SHOP WORKSPACE"
      navigation={<SellerNavigation hasNewAdCreditGrants={viewer.hasNewAdCreditGrants} activeHref="/seller/profile" />}
      accountLabel={`${seller.shop_name} · ${seller.status}`}
      signOutTo="/seller/login"
      brandBackHref="/products"
      hideMobileAccountDetails
    >
      <SiteHeader />
      {shopProfile}
    </WorkspaceShell>;
  }

  return <><SiteHeader />{shopProfile}</>;
}
