import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { formatDateTime, formatNumber, formatPrice } from "@/lib/format";
import { ADMIN_LIST_PAGE_SIZE, buildAdminListHref, normalizeAdminSearch, parseAdminListPage } from "@/lib/admin/listing";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { reviewProduct, setProductFeatured } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Product review", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await connection();
  const [{ q: rawQuery, status: rawStatus, page: rawPage }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const query = normalizeAdminSearch(rawQuery);
  const validStatuses = ["draft", "pending", "approved", "rejected", "paused", "archived"];
  const status = validStatuses.includes(rawStatus ?? "") ? rawStatus! : "all";
  const page = parseAdminListPage(rawPage);
  let productQuery = supabase
    .from("products")
    .select("id,name,slug,status,price,currency,created_at,seller_profile_id,category_id,featured_until", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * ADMIN_LIST_PAGE_SIZE, page * ADMIN_LIST_PAGE_SIZE - 1);
  if (query) productQuery = productQuery.ilike("name", `%${query}%`);
  if (status !== "all") productQuery = productQuery.eq("status", status as "draft" | "pending" | "approved" | "rejected" | "paused" | "archived");
  const { data: products, count, error } = await productQuery;

  if (error) throw new Error(error.message);
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_LIST_PAGE_SIZE));
  const filters = { q: query || undefined, status: status === "all" ? undefined : status };
  if (page > totalPages) redirect(buildAdminListHref("/admin/products", filters, totalPages));

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
        <p>Review submissions before they appear in the public catalogue. {formatNumber(totalCount)} matching products.</p>
      </header>
      <form className="admin-list-filters" method="get">
        <label>Search products<input name="q" defaultValue={query} maxLength={100} placeholder="Product name" /></label>
        <label>Status<select name="status" defaultValue={status}>
          <option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="draft">Draft</option><option value="paused">Paused</option><option value="archived">Archived</option>
        </select></label>
        <button className="admin-approve-button" type="submit">Filter products</button>
        {(query || status !== "all") && <Link href="/admin/products">Clear filters</Link>}
      </form>
      {products?.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Status</th><th>Review / feature</th></tr></thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.slug}</small></td>
                  <td>{sellerNames.get(product.seller_profile_id) ?? "—"}</td>
                  <td>{categoryNames.get(product.category_id) ?? "—"}</td>
                  <td>{formatPrice(product.price, product.currency)}</td>
                  <td><span className={`admin-status admin-status-${product.status}`}>{product.status}</span></td>
                  <td>
                    <div className="admin-product-actions">
                      {product.status === "pending" && (
                        <div className="admin-review-actions">
                          <form action={reviewProduct}><input type="hidden" name="product_id" value={product.id} /><button className="admin-approve-button" name="status" value="approved">Approve</button></form>
                          <form action={reviewProduct}><input type="hidden" name="product_id" value={product.id} /><button className="admin-reject-button" name="status" value="rejected">Reject</button></form>
                        </div>
                      )}
                      {product.status === "approved" && (
                        <>
                          {product.featured_until && (
                            <small>Featured until {formatDateTime(product.featured_until)}</small>
                          )}
                          <form action={setProductFeatured}>
                            <input type="hidden" name="product_id" value={product.id} />
                            <input type="hidden" name="is_featured" value="true" />
                            <button className="admin-approve-button" type="submit">Feature / renew</button>
                          </form>
                          {product.featured_until && (
                            <form action={setProductFeatured}>
                              <input type="hidden" name="product_id" value={product.id} />
                              <input type="hidden" name="is_featured" value="false" />
                              <button className="admin-reject-button" type="submit">Remove feature</button>
                            </form>
                          )}
                        </>
                      )}
                      {product.status !== "pending" && product.status !== "approved" && <span className="admin-muted">No action</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty-state"><h2>No matching products</h2><p>Try another search or filter.</p></div>
      )}
      <AdminListPagination path="/admin/products" filters={filters} page={page} totalPages={totalPages} totalCount={totalCount} pageSize={ADMIN_LIST_PAGE_SIZE} label="Product" />
    </main>
  );
}