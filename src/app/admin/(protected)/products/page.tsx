import type { Metadata } from "next";
import { formatPrice } from "@/data/products";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reviewProduct } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Product review", robots: { index: false, follow: false } };

export default async function AdminProductsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: products, error } = await supabase
    .from("products")
    .select("id,name,slug,status,price,currency,created_at,seller_profile_id,category_id")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const sellerIds = [...new Set((products ?? []).map((product) => product.seller_profile_id))];
  const categoryIds = [...new Set((products ?? []).map((product) => product.category_id))];
  const [sellersResult, categoriesResult] = await Promise.all([
    sellerIds.length
      ? supabase.from("seller_profiles").select("id,shop_name").in("id", sellerIds)
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? supabase.from("categories").select("id,name").in("id", categoryIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sellersResult.error) throw new Error(sellersResult.error.message);
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);

  const sellerNames = new Map((sellersResult.data ?? []).map((seller) => [seller.id, seller.shop_name]));
  const categoryNames = new Map((categoriesResult.data ?? []).map((category) => [category.id, category.name]));

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CATALOGUE</p>
        <h1>Product review</h1>
        <p>Review submissions before they appear in the public catalogue.</p>
      </header>
      {products?.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.slug}</small></td>
                  <td>{sellerNames.get(product.seller_profile_id) ?? "—"}</td>
                  <td>{categoryNames.get(product.category_id) ?? "—"}</td>
                  <td>{formatPrice(product.price)}</td>
                  <td><span className={`admin-status admin-status-${product.status}`}>{product.status}</span></td>
                  <td>
                    {product.status === "pending" ? (
                      <div className="admin-review-actions">
                        <form action={reviewProduct}><input type="hidden" name="product_id" value={product.id} /><button className="admin-approve-button" name="status" value="approved">Approve</button></form>
                        <form action={reviewProduct}><input type="hidden" name="product_id" value={product.id} /><button className="admin-reject-button" name="status" value="rejected">Reject</button></form>
                      </div>
                    ) : <span className="admin-muted">No action</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty-state"><h2>No product submissions</h2><p>New seller submissions will appear here for review.</p></div>
      )}
    </main>
  );
}