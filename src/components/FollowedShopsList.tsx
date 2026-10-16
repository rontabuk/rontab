"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowUpRight, ListFilter, Minus, Plus, Search, Store } from "lucide-react";
import { toggleShopFollow } from "@/app/visitor/shop-follow-actions";
import { SellerVerificationBadge } from "@/components/seller/SellerVerificationBadge";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

type FollowedShop = Database["public"]["Functions"]["visitor_get_my_followed_shops"]["Returns"][number] & {
  isBlueBadge: boolean;
};

export function FollowedShopsList({ initialShops }: { initialShops: FollowedShop[] }) {
  const [shops, setShops] = useState(initialShops.map((shop) => ({ ...shop, following: true })));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransitionAction] = useTransition();
  const [query, setQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const cities = [...new Set(shops.map((shop) => shop.city_name).filter((city): city is string => Boolean(city)))].sort((first, second) => first.localeCompare(second));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleShops = shops.filter((shop) => {
    const matchesQuery = !normalizedQuery || `${shop.shop_name} ${shop.description ?? ""} ${shop.city_name ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);
    return matchesQuery && (cityFilter === "all" || shop.city_name === cityFilter);
  });
  const hasFilters = Boolean(normalizedQuery || cityFilter !== "all");

  function toggle(shop: typeof shops[number]) {
    const formData = new FormData();
    formData.set("seller_profile_id", shop.seller_profile_id);
    formData.set("shop_slug", shop.slug);
    formData.set("follow_action", shop.following ? "unfollow" : "follow");

    startTransitionAction(async () => {
      const result = await toggleShopFollow({ error: null, following: shop.following }, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setShops((current) => current.map((item) => item.seller_profile_id === shop.seller_profile_id
        ? { ...item, following: result.following }
        : item));
    });
  }

  return (
    <>
      {error && <p className="visitor-rewards-error" role="alert">{error}</p>}
      {shops.length ? (
        <>
          <div className="visitor-shop-follow-summary"><strong>{formatNumber(shops.filter((shop) => shop.following).length)}</strong><span>shops followed</span></div>
          {shops.length > 50 && <div className="visitor-shop-follow-filters">
            <label className="visitor-shop-follow-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">Search followed shops</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shops or cities" /></label>
            <label className="visitor-shop-follow-city"><ListFilter size={15} aria-hidden="true" /><span className="visually-hidden">Filter by city</span><select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              <option value="all">All cities</option>
              {cities.map((city) => <option value={city} key={city}>{city}</option>)}
            </select></label>
          </div>}
          {visibleShops.length ? <ol className="visitor-shop-follow-list">
            {visibleShops.map((shop) => (
              <li key={shop.seller_profile_id} data-following={shop.following}>
            <div className="visitor-shop-follow-identity">
              <Link className="visitor-shop-follow-logo" href={`/shops/${shop.slug}`}>
                {shop.logo_url ? <Image src={shop.logo_url} alt="" width={58} height={58} unoptimized /> : <Store size={21} aria-hidden="true" />}
              </Link>
              <div>
                <div className="visitor-shop-follow-name-row">
                  <h2><Link href={`/shops/${shop.slug}`}>{shop.shop_name}<ArrowUpRight size={14} aria-hidden="true" /></Link>{shop.isBlueBadge && <SellerVerificationBadge isBlue />}</h2>
                </div>
                {shop.description && <p>{shop.description}</p>}
                {shop.city_name && <small>{shop.city_name}</small>}
                <small>Following since {formatDateTime(shop.followed_at)}</small>
              </div>
            </div>
            <button
              className={`visitor-shop-follow-toggle${shop.following ? " is-following" : ""}`}
              type="button"
              aria-label={`${shop.following ? "Unfollow" : "Follow"} ${shop.shop_name}`}
              aria-pressed={shop.following}
              title={`${shop.following ? "Unfollow" : "Follow"} ${shop.shop_name}`}
              disabled={isPending}
              onClick={() => toggle(shop)}
            >
              {shop.following ? <Minus size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            </button>
              </li>
            ))}
          </ol> : (
            <div className="admin-empty-state"><h2>No shops match</h2><p>Try another name or city.</p>{hasFilters && <button className="visitor-shop-follow-clear" type="button" onClick={() => { setQuery(""); setCityFilter("all"); }}>Clear filters</button>}</div>
          )}
        </>
      ) : (
        <div className="admin-empty-state"><h2>No shops followed yet</h2><p>Open a public shop profile and follow the shops you want to keep close.</p><Link href="/products"><ArrowUpRight size={14} aria-hidden="true" />Discover products</Link></div>
      )}
    </>
  );
}
