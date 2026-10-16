import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, Store, UserRoundMinus } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { unfollowShop } from "@/app/visitor/shop-follow-actions";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getVisitorAccount } from "@/lib/visitor/access";
import type { Database } from "@/lib/supabase/database.types";
import "../visitor.css";
import "./shops-following.css";

export const metadata: Metadata = { title: "Shops I follow", robots: { index: false, follow: false } };
export const instant = false;

type FollowedShop = Database["public"]["Functions"]["visitor_get_my_followed_shops"]["Returns"][number];

export default async function FollowedShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ unfollowed?: string }>;
}) {
  await connection();
  const [{ unfollowed }, { supabase }] = await Promise.all([searchParams, getVisitorAccount("/visitor/shops-following")]);
  const { data, error } = await supabase.rpc("visitor_get_my_followed_shops");
  if (error) throw new Error(error.message);
  const shops: FollowedShop[] = data ?? [];

  return (
    <main className="admin-overview visitor-shops-following-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">YOUR SAVED SHOPS</p>
        <h1>Shops I follow</h1>
        <p>Your following list is private. Shop owners see the follower count, not your account or identity.</p>
      </header>
      {unfollowed === "1" && <p className="admin-save-success" role="status">Shop removed from your following list.</p>}
      <div className="visitor-shop-follow-summary"><strong>{formatNumber(shops.length)}</strong><span>shops followed</span></div>
      {shops.length ? (
        <ol className="visitor-shop-follow-list">
          {shops.map((shop) => (
            <li key={shop.seller_profile_id}>
              <div className="visitor-shop-follow-identity">
                <Link className="visitor-shop-follow-logo" href={`/shops/${shop.slug}`}>
                  {shop.logo_url ? <Image src={shop.logo_url} alt="" width={58} height={58} unoptimized /> : <Store size={21} aria-hidden="true" />}
                </Link>
                <div>
                  <h2><Link href={`/shops/${shop.slug}`}>{shop.shop_name}<ArrowUpRight size={14} aria-hidden="true" /></Link></h2>
                  {shop.description && <p>{shop.description}</p>}
                  {shop.city_name && <small>{shop.city_name}</small>}
                  <small>Following since {formatDateTime(shop.followed_at)}</small>
                </div>
              </div>
              <ActionForm className="visitor-shop-unfollow-form" action={unfollowShop}>
                <input type="hidden" name="seller_profile_id" value={shop.seller_profile_id} />
                <input type="hidden" name="shop_slug" value={shop.slug} />
                <button type="submit"><UserRoundMinus size={14} aria-hidden="true" />Unfollow</button>
              </ActionForm>
            </li>
          ))}
        </ol>
      ) : (
        <div className="admin-empty-state"><h2>No shops followed yet</h2><p>Open a public shop profile and follow the shops you want to keep close.</p><Link href="/products">Discover products<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
      )}
    </main>
  );
}
