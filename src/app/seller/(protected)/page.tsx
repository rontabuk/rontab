import type { Metadata } from "next";
import { AddProductForm } from "@/components/seller/AddProductForm";
import { getSellerAccount } from "@/lib/seller/access";

export const metadata: Metadata = { title: "Seller products", robots: { index: false, follow: false } };

export default async function SellerDashboardPage() {
  const { supabase, seller } = await getSellerAccount();
  const [{ data: products, error: productError }, { data: categories, error: categoryError }] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,slug,status,price,currency,created_at")
      .eq("seller_profile_id", seller.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id,name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  if (productError) throw new Error(productError.message);
  if (categoryError) throw new Error(categoryError.message);

  return (
    <main className="admin-overview seller-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER WORKSPACE</p>
        <h1>{seller.shop_name}</h1>
        <p>Manage product drafts and submissions for review.</p>
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
          <span>Product submissions and edits are unavailable. Contact Rontab support for assistance.</span>
        </section>
      )}
      {seller.status === "active" && <AddProductForm sellerId={seller.id} categories={categories ?? []} />}

      <section className="seller-products-section" aria-labelledby="seller-products-title">
        <div className="seller-products-heading">
          <h2 id="seller-products-title">Your products</h2>
          <span>{products?.length ?? 0} total</span>
        </div>
        {products?.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Price</th><th>Status</th><th>Submitted</th></tr></thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.name}</strong><small>{product.slug}</small></td>
                    <td>{product.price === null ? "Price on request" : new Intl.NumberFormat("en-GB", { style: "currency", currency: product.currency }).format(product.price)}</td>
                    <td><span className={`admin-status admin-status-${product.status}`}>{product.status}</span></td>
                    <td>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(product.created_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="admin-empty-state"><h2>No products yet</h2><p>Your saved drafts and review submissions will appear here.</p></div>}
      </section>
    </main>
  );
}