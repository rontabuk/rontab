import type { Metadata } from "next";
import { connection } from "next/server";
import { SellerProductList } from "@/components/seller/SellerProductList";
import { getSellerAccount } from "@/lib/seller/access";
import { getSellerProductDetails } from "@/lib/seller/products";

export const metadata: Metadata = { title: "Your products", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>;
}) {
  await connection();
  const [{ updated }, { supabase, seller }] = await Promise.all([searchParams, getSellerAccount()]);
  const { data: products, error } = await supabase
    .from("products")
    .select("id,name,slug,status,price,currency,click_count,created_at,category_id")
    .eq("seller_profile_id", seller.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const { categoryById, media: productMedia, leadMedia, leadMediaUrl } = await getSellerProductDetails(supabase, products);
  const mediaTypes = new Map<string, Set<"image" | "video">>();
  for (const media of productMedia) {
    mediaTypes.set(media.product_id, (mediaTypes.get(media.product_id) ?? new Set<"image" | "video">()).add(media.media_type));
  }

  const listProducts = products.map((product) => ({
    ...product,
    categoryName: categoryById.get(product.category_id)?.name ?? "Uncategorised",
    mediaTypes: [...(mediaTypes.get(product.id) ?? [])],
    previewUrl: leadMediaUrl(product.id),
    previewMediaType: leadMedia.get(product.id)?.media_type ?? null,
  }));

  return (
    <main className="admin-overview seller-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER WORKSPACE</p>
        <h1>Your products</h1>
        <p>Track drafts, submissions, and review decisions for {seller.shop_name}.</p>
      </header>
      {updated === "approved" && <p className="admin-save-success" role="status">Changes saved. The product was approved automatically and is live.</p>}
      {updated === "review" && <p className="admin-save-success" role="status">Changes saved and sent for admin review.</p>}
      <SellerProductList products={listProducts} canDelete={seller.status === "active"} canPromote={seller.status === "active"} />
    </main>
  );
}