import "server-only";

import { cache } from "react";
import { getOverlayTone, type Product, type ProductCategory } from "@/data/products";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import { createProductMediaUrls } from "@/lib/supabase/storage";

type ProductImageRow = Database["public"]["Tables"]["product_images"]["Row"];

// Products lead with their Reel when one exists, otherwise with their first photo.
export function pickLeadMedia<T extends Pick<ProductImageRow, "product_id" | "media_type">>(mediaRows: readonly T[]) {
  const leadMedia = new Map<string, T>();
  for (const media of mediaRows) {
    if (!leadMedia.has(media.product_id) || media.media_type === "video") leadMedia.set(media.product_id, media);
  }
  return leadMedia;
}

export type TopVideoAd = { id: string; title: string; mediaUrl: string; mediaType: "video" | "image"; displaySeconds: number; targetUrl: string | null };

export async function getTopVideoAds(): Promise<TopVideoAd[]> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("top_video_ads")
    .select("id,title,storage_path,media_type,display_seconds,target_url")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  // The banner is optional, so a failed read must not take the catalogue down.
  if (error) {
    console.error("Top video ads could not be loaded:", error.message);
    return [];
  }

  return data.map((ad) => ({
    id: ad.id,
    title: ad.title,
    mediaUrl: supabase.storage.from("top-video-ads").getPublicUrl(ad.storage_path).data.publicUrl,
    mediaType: ad.media_type,
    displaySeconds: ad.display_seconds,
    targetUrl: ad.target_url,
  }));
}

// Cached per request so page metadata and content share one catalogue read.
export const getPublicCatalog = cache(async (): Promise<{
  categories: ProductCategory[];
  products: Product[];
}> => {
  const supabase = createSupabasePublicClient();
  const [categoriesResult, productsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id,slug,name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("products")
      .select("id,slug,name,description,audio_script,price,click_count,featured_until,new_until,category_id,seller_profile_id")
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (productsResult.error) throw productsResult.error;

  const productRows = productsResult.data;
  const sellerIds = [...new Set(productRows.map((product) => product.seller_profile_id))];
  const productIds = productRows.map((product) => product.id);

  const [sellersResult, mediaResult] = await Promise.all([
    sellerIds.length
      ? supabase.from("seller_profiles").select("id,shop_name,shop_url,logo_url").in("id", sellerIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase
          .from("product_images")
          .select("product_id,storage_path,media_type,alt_text")
          .in("product_id", productIds)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sellersResult.error) throw sellersResult.error;
  if (mediaResult.error) throw mediaResult.error;

  const sellers = new Map(sellersResult.data.map((seller) => [seller.id, seller]));
  const categoryById = new Map(categoriesResult.data.map((category) => [category.id, category]));
  const leadMediaByProduct = pickLeadMedia(mediaResult.data);
  const mediaUrls = await createProductMediaUrls(
    supabase,
    [...leadMediaByProduct.values()].map((media) => media.storage_path),
  );

  return {
    categories: categoriesResult.data.map((category) => ({ id: category.slug, name: category.name })),
    products: productRows.map((row) => {
      const category = categoryById.get(row.category_id);
      const media = leadMediaByProduct.get(row.id);
      const seller = sellers.get(row.seller_profile_id);

      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        category: category?.slug ?? "home",
        categoryName: category?.name ?? "Home",
        price: row.price,
        clickCount: row.click_count,
        featuredUntil: row.featured_until,
        newUntil: row.new_until,
        description: row.description,
        audioScript: row.audio_script,
        image: media ? mediaUrls.get(media.storage_path) ?? "" : "",
        imageAlt: media?.alt_text || row.name,
        mediaType: media?.media_type ?? "image",
        maker: seller?.shop_name ?? "Independent maker",
        shopUrl: seller?.shop_url ?? null,
        makerImage: seller?.logo_url?.startsWith("https://") ? seller.logo_url : "",
        overlayTone: getOverlayTone(category?.slug),
      };
    }),
  };
});
