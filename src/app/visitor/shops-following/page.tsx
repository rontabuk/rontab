import type { Metadata } from "next";
import { connection } from "next/server";
import { FollowedShopsList } from "@/components/FollowedShopsList";
import { getVisitorAccount } from "@/lib/visitor/access";
import type { Database } from "@/lib/supabase/database.types";
import "../visitor.css";
import "./shops-following.css";

export const metadata: Metadata = { title: "Shops I follow", robots: { index: false, follow: false } };
export const instant = false;

type FollowedShop = Database["public"]["Functions"]["visitor_get_my_followed_shops"]["Returns"][number];

export default async function FollowedShopsPage() {
  await connection();
  const { supabase } = await getVisitorAccount("/visitor/shops-following");
  const { data, error } = await supabase.rpc("visitor_get_my_followed_shops");
  if (error) throw new Error(error.message);
  const shops: FollowedShop[] = data ?? [];
  const { data: badges, error: badgesError } = shops.length
    ? await supabase.rpc("get_public_seller_verification_badges", { p_seller_profile_ids: shops.map((shop) => shop.seller_profile_id) })
    : { data: [], error: null };
  if (badgesError) throw new Error(badgesError.message);
  const badgesBySeller = new Map((badges ?? []).filter((badge) => badge.is_verified).map((badge) => [badge.seller_profile_id, badge]));
  const displayShops = shops.map((shop) => ({ ...shop, isBlueBadge: badgesBySeller.get(shop.seller_profile_id)?.is_blue ?? false }));

  return (
    <main className="admin-overview visitor-shops-following-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">YOUR SAVED SHOPS</p>
        <h1>Shops I follow</h1>
        <p>Your following list is private. Shop owners see the follower count, not your account or identity.</p>
      </header>
      <FollowedShopsList initialShops={displayShops} />
    </main>
  );
}
