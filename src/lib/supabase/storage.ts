import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const PRODUCT_MEDIA_URL_SECONDS = 60 * 60;

// Signs every product media path in one request; unsigned paths fall back to placeholders.
export async function createProductMediaUrls(supabase: Pick<SupabaseClient, "storage">, storagePaths: string[]) {
  const urls = new Map<string, string>();
  const uniquePaths = [...new Set(storagePaths)];
  if (!uniquePaths.length) return urls;

  const { data, error } = await supabase.storage.from("product-images").createSignedUrls(uniquePaths, PRODUCT_MEDIA_URL_SECONDS);
  if (error) {
    console.error("Product media URLs could not be signed:", error.message);
    return urls;
  }

  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
