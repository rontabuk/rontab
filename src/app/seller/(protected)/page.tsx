import type { Metadata } from "next";
import { connection } from "next/server";
import { AddProductForm } from "@/components/seller/AddProductForm";
import { getSellerAccount } from "@/lib/seller/access";

export const metadata: Metadata = { title: "Add products", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerDashboardPage() {
  await connection();
  const { supabase, seller } = await getSellerAccount();
  const { data: categories, error: categoryError } = await supabase
    .from("categories")
    .select("id,slug,name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (categoryError) throw new Error(categoryError.message);

  return (
    <main className="admin-overview seller-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER WORKSPACE</p>
        <h1>Add products</h1>
        <p>Add a product to {seller.shop_name} for review.</p>
      </header>

      {seller.status === "pending" && (
        <section className="seller-account-notice" role="status">
          <strong>Your shop is awaiting review.</strong>
          <span>You can submit products after an administrator approves your seller profile.</span>
        </section>
      )}
      {seller.status === "suspended" && (
        <section className="seller-account-notice seller-account-suspended" role="status">
          <strong>Your seller account is suspended.</strong>
          <span>Product submissions and edits are unavailable. Contact support for assistance.</span>
        </section>
      )}
      {seller.status === "active" && <AddProductForm sellerId={seller.id} shopName={seller.shop_name} shopLogo={seller.logo_url} categories={categories ?? []} />}
    </main>
  );
}