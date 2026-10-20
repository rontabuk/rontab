import type { MetadataRoute } from "next";
import { cacheLife } from "next/cache";
import { informationPages } from "@/data/information";
import { siteUrl } from "@/lib/site-url";
import { createSupabasePublicClient } from "@/lib/supabase/server";

const SITEMAP_LIMIT = 5000;

async function getPublicSlugs() {
  "use cache";
  cacheLife("hours");
  const supabase = createSupabasePublicClient();
  const [products, shops, creators] = await Promise.all([
    supabase.from("products").select("slug").eq("status", "approved").limit(SITEMAP_LIMIT),
    supabase.from("seller_profiles").select("slug").eq("status", "active").eq("is_public", true).limit(SITEMAP_LIMIT),
    supabase.from("creator_profiles").select("slug").eq("is_public", true).limit(SITEMAP_LIMIT),
  ]);
  // Throwing keeps a failed lookup out of the cache.
  const error = products.error ?? shops.error ?? creators.error;
  if (error) throw new Error(error.message);
  const slugs = (rows: { slug: string | null }[] | null) => (rows ?? []).flatMap(({ slug }) => slug ? [slug] : []);
  return { products: slugs(products.data), shops: slugs(shops.data), creators: slugs(creators.data) };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const url = (path: string) => new URL(path, siteUrl).href;
  const entries: MetadataRoute.Sitemap = [
    { url: url("/"), changeFrequency: "daily", priority: 1 },
    { url: url("/products"), changeFrequency: "daily", priority: 0.9 },
    { url: url("/creators"), changeFrequency: "daily", priority: 0.7 },
    { url: url("/information"), changeFrequency: "monthly", priority: 0.3 },
    ...informationPages.map(({ slug }) => ({ url: url(`/${slug}`), changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
  try {
    const { products, shops, creators } = await getPublicSlugs();
    entries.push(
      ...products.map((slug) => ({ url: url(`/products/${encodeURIComponent(slug)}`), changeFrequency: "weekly" as const, priority: 0.8 })),
      ...shops.map((slug) => ({ url: url(`/shops/${encodeURIComponent(slug)}`), changeFrequency: "weekly" as const, priority: 0.6 })),
      ...creators.map((slug) => ({ url: url(`/creators/${encodeURIComponent(slug)}`), changeFrequency: "weekly" as const, priority: 0.5 })),
    );
  } catch (error) {
    console.error("Sitemap lookup failed", error);
  }
  return entries;
}
