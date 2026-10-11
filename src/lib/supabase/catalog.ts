import "server-only";

import type { Product, ProductCategory, ProductOverlayTone } from "@/data/products";
import { categories as sampleCategories, products as sampleProducts } from "@/data/products";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type SellerRow = Database["public"]["Tables"]["seller_profiles"]["Row"];
type ProductImageRow = Database["public"]["Tables"]["product_images"]["Row"];

const toneByCategory: Record<string, ProductOverlayTone> = {
  kitchen: "coffee",
  tableware: "ceramic",
  textiles: "linen",
  storage: "woven",
  living: "lamp",
};

const fallbackAvatar =
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=96&h=96&q=80";

function categoryImage(category: CategoryRow) {
  return (
    category.image_url ??
    sampleCategories.find((sample) => sample.id === category.slug)?.image ??
    sampleCategories[0].image
  );
}

export async function getPublicCatalog(): Promise<{
  categories: ProductCategory[];
  products: Product[];
}> {
  const supabase = await createSupabaseServerClient();
  const [categoriesResult, productsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("products")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (productsResult.error) throw productsResult.error;

  const categoryRows = (categoriesResult.data ?? []) as CategoryRow[];
  const productRows = (productsResult.data ?? []) as ProductRow[];
  const sellerIds = [...new Set(productRows.map((product) => product.seller_profile_id))];
  const productIds = productRows.map((product) => product.id);

  const [sellersResult, imagesResult] = await Promise.all([
    sellerIds.length
      ? supabase
          .from("seller_profiles")
          .select("*")
          .in("id", sellerIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase
          .from("product_images")
          .select("*")
          .in("product_id", productIds)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sellersResult.error) throw sellersResult.error;
  if (imagesResult.error) throw imagesResult.error;

  const sellers = new Map(
    ((sellersResult.data ?? []) as SellerRow[]).map((seller) => [seller.id, seller]),
  );
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const firstImageByProduct = new Map<string, ProductImageRow>();

  for (const image of (imagesResult.data ?? []) as ProductImageRow[]) {
    if (!firstImageByProduct.has(image.product_id)) {
      firstImageByProduct.set(image.product_id, image);
    }
  }

  const mappedProducts = await Promise.all(
    productRows.map(async (row): Promise<Product> => {
      const category = categoryById.get(row.category_id);
      const image = firstImageByProduct.get(row.id);
      const seller = sellers.get(row.seller_profile_id);
      let productImage = category ? categoryImage(category) : sampleCategories[0].image;
      let imageAlt = row.name;

      if (image) {
        imageAlt = image.alt_text || row.name;
        const { data } = await supabase.storage
          .from("product-images")
          .createSignedUrl(image.storage_path, 60 * 60);
        productImage = data?.signedUrl ?? productImage;
      }

      const publicLogo = seller?.logo_url?.startsWith("https://")
        ? seller.logo_url
        : fallbackAvatar;

      return {
        slug: row.slug,
        name: row.name,
        category: category?.slug ?? "home",
        price: row.price,
        addedAt: row.created_at,
        description: row.description,
        image: productImage,
        imageAlt,
        maker: seller?.shop_name ?? "Independent maker",
        makerImage: publicLogo,
        overlayTone: toneByCategory[category?.slug ?? ""] ?? "ceramic",
        detail: row.description,
        externalUrl: row.external_url,
      };
    }),
  );

  return {
    categories: categoryRows.map((category) => ({
      id: category.slug,
      name: category.name,
      image: categoryImage(category),
      imageAlt: category.name,
    })),
    products: mappedProducts,
  };
}

export function getDevelopmentSampleCatalog() {
  return { categories: sampleCategories, products: sampleProducts };
}