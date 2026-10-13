import "server-only";

import { pickLeadMedia } from "@/lib/supabase/catalog";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProductMediaUrls } from "@/lib/supabase/storage";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Categories and signed lead media for a seller's own product rows.
export async function getSellerProductDetails(supabase: ServerClient, products: { id: string; category_id: string }[]) {
  const productIds = products.map((product) => product.id);
  const categoryIds = [...new Set(products.map((product) => product.category_id))];
  const [categoriesResult, mediaResult] = await Promise.all([
    categoryIds.length
      ? supabase.from("categories").select("id,name,slug").in("id", categoryIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase
          .from("product_images")
          .select("product_id,media_type,storage_path,alt_text")
          .in("product_id", productIds)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (categoriesResult.error) throw new Error(categoriesResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);

  const leadMedia = pickLeadMedia(mediaResult.data);
  const mediaUrls = await createProductMediaUrls(supabase, [...leadMedia.values()].map((media) => media.storage_path));

  return {
    categoryById: new Map(categoriesResult.data.map((category) => [category.id, category])),
    media: mediaResult.data,
    leadMedia,
    leadMediaUrl: (productId: string) => {
      const media = leadMedia.get(productId);
      return media ? mediaUrls.get(media.storage_path) ?? null : null;
    },
  };
}
