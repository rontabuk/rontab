import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setSellerStatus } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Sellers", robots: { index: false, follow: false } };

export default async function AdminSellersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: sellers, error } = await supabase
    .from("seller_profiles")
    .select("id,shop_name,slug,status,is_public,created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">ACCOUNTS</p>
        <h1>Sellers</h1>
        <p>Approve seller accounts and control public shop visibility.</p>
      </header>
      {sellers?.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Shop</th><th>Status</th><th>Public</th><th>Access</th></tr></thead>
            <tbody>
              {sellers.map((seller) => (
                <tr key={seller.id}>
                  <td><strong>{seller.shop_name}</strong><small>{seller.slug}</small></td>
                  <td><span className={`admin-status admin-status-${seller.status}`}>{seller.status}</span></td>
                  <td>{seller.is_public ? "Visible" : "Hidden"}</td>
                  <td>
                    <form className="admin-inline-form" action={setSellerStatus}>
                      <input type="hidden" name="seller_id" value={seller.id} />
                      <select name="status" defaultValue={seller.status} aria-label={`Status for ${seller.shop_name}`}>
                        <option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option>
                      </select>
                      <label className="admin-checkbox-label"><input type="checkbox" name="is_public" defaultChecked={seller.is_public} /> Public</label>
                      <button className="admin-approve-button" type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty-state"><h2>No seller applications</h2><p>Seller applications will appear here after seller onboarding is enabled.</p></div>
      )}
    </main>
  );
}