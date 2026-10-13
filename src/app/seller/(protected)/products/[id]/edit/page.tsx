import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { EditProductForm } from "@/components/seller/EditProductForm";
import { getSellerAccount } from "@/lib/seller/access";
import { createProductMediaUrls } from "@/lib/supabase/storage";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Edit product", robots: { index: false, follow: false } };
export const instant = false;

type EditProductPageProps = { params: Promise<{ id: string }> };

export default async function EditSellerProductPage({ params }: EditProductPageProps) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, seller } = await getSellerAccount();
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id,name,slug,status,price,currency,category_id,description,external_url")
    .eq("id", id)
    .eq("seller_profile_id", seller.id)
    .maybeSingle();

  if (productError) throw new Error(productError.message);
  if (!product) notFound();

  const [{ data: categories, error: categoryError }, { data: mediaRows, error: mediaError }] = await Promise.all([
    supabase.from("categories").select("id,slug,name").eq("is_active", true).order("sort_order", { ascending: true }),
    supabase.from("product_images").select("storage_path,media_type").eq("product_id", product.id).order("sort_order", { ascending: true }),
  ]);

  if (categoryError) throw new Error(categoryError.message);
  if (mediaError) throw new Error(mediaError.message);

  const mediaUrls = await createProductMediaUrls(supabase, mediaRows.map((item) => item.storage_path));
  const media = mediaRows.map((item) => ({
    storagePath: item.storage_path,
    mediaType: item.media_type,
    url: mediaUrls.get(item.storage_path) ?? "",
  }));

  return (
    <main className="admin-overview seller-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER WORKSPACE</p>
        <h1>Edit product</h1>
        <p>Update the listing for {seller.shop_name}. Changes go through the current product approval setting.</p>
      </header>
      {seller.status === "active" ? (
        <EditProductForm
          sellerId={seller.id}
          shopName={seller.shop_name}
          shopLogo={seller.logo_url}
          categories={categories}
          product={product}
          currentMedia={media}
        />
      ) : (
        <section className="seller-account-notice seller-account-suspended" role="status">
          <strong>Product editing is unavailable.</strong>
          <span>Your seller account must be active to edit products.</span>
        </section>
      )}
    </main>
  );
}
