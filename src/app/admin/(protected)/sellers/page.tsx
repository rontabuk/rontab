import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { formatNumber } from "@/lib/format";
import { ADMIN_LIST_PAGE_SIZE, buildAdminListHref, normalizeAdminSearch, parseAdminListPage } from "@/lib/admin/listing";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { grantSellerAdCredits, setSellerStatus } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Sellers", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminSellersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; visibility?: string; page?: string }>;
}) {
  await connection();
  const [{ q: rawQuery, status: rawStatus, visibility: rawVisibility, page: rawPage }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const query = normalizeAdminSearch(rawQuery);
  const status = ["pending", "active", "suspended"].includes(rawStatus ?? "") ? rawStatus! : "all";
  const visibility = ["public", "hidden"].includes(rawVisibility ?? "") ? rawVisibility! : "all";
  const page = parseAdminListPage(rawPage);
  let sellerQuery = supabase
    .from("seller_profiles")
    .select("id,shop_name,slug,shop_url,status,is_public,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * ADMIN_LIST_PAGE_SIZE, page * ADMIN_LIST_PAGE_SIZE - 1);
  if (query) sellerQuery = sellerQuery.ilike("shop_name", `%${query}%`);
  if (status !== "all") sellerQuery = sellerQuery.eq("status", status as "pending" | "active" | "suspended");
  if (visibility !== "all") sellerQuery = sellerQuery.eq("is_public", visibility === "public");
  const { data: sellers, count, error } = await sellerQuery;

  if (error) throw new Error(error.message);
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_LIST_PAGE_SIZE));
  const filters = { q: query || undefined, status: status === "all" ? undefined : status, visibility: visibility === "all" ? undefined : visibility };
  if (page > totalPages) redirect(buildAdminListHref("/admin/sellers", filters, totalPages));

  const sellerIds = (sellers ?? []).map((seller) => seller.id);
  const [{ data: contactDetails, error: contactError }, { data: adAccounts, error: adAccountsError }] = sellerIds.length
    ? await Promise.all([
        supabase
          .from("seller_contact_details")
          .select("seller_profile_id,contact_name,phone,phone_contact_confirmed_at,website_url,instagram_url,business_address,registered_email,registered_email_confirmed_at")
          .in("seller_profile_id", sellerIds),
        supabase
          .from("seller_ad_accounts")
          .select("seller_profile_id,clicks_remaining,welcome_clicks_remaining,admin_clicks_remaining")
          .in("seller_profile_id", sellerIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (contactError) throw new Error(contactError.message);
  if (adAccountsError) throw new Error(adAccountsError.message);

  const contactBySellerId = new Map((contactDetails ?? []).map((details) => [details.seller_profile_id, details]));
  const adAccountBySellerId = new Map((adAccounts ?? []).map((account) => [account.seller_profile_id, account]));

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">ACCOUNTS</p>
        <h1>Sellers</h1>
        <p>Approve seller accounts and control public shop visibility. {formatNumber(totalCount)} matching shops.</p>
      </header>
      <form className="admin-list-filters" method="get">
        <label>Search shops<input name="q" defaultValue={query} maxLength={100} placeholder="Shop name" /></label>
        <label>Status<select name="status" defaultValue={status}><option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
        <label>Visibility<select name="visibility" defaultValue={visibility}><option value="all">All shops</option><option value="public">Public</option><option value="hidden">Hidden</option></select></label>
        <button className="admin-approve-button" type="submit">Filter shops</button>
        {(query || status !== "all" || visibility !== "all") && <Link href="/admin/sellers">Clear filters</Link>}
      </form>
      {sellers?.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Shop</th><th>Seller contact details</th><th>Click credits</th><th>Status</th><th>Public</th><th>Access</th></tr></thead>
            <tbody>
              {sellers.map((seller) => (
                <tr key={seller.id}>
                  <td><strong>{seller.shop_name}</strong><small>{seller.slug}</small>{seller.shop_url && <a className="admin-seller-shop-url" href={seller.shop_url} target="_blank" rel="noreferrer">Shop website</a>}</td>
                  <td>
                    {(() => {
                      const contact = contactBySellerId.get(seller.id);
                      if (!contact) return <span className="admin-muted">No contact details provided</span>;
                      return (
                        <div className="admin-seller-contact-details">
                          <strong>{contact.contact_name || "Contact name not provided"}</strong>
                          <span>{contact.registered_email}</span>
                          <span className={contact.registered_email_confirmed_at ? "admin-email-confirmed" : "admin-email-unconfirmed"}>
                            {contact.registered_email_confirmed_at ? "Email confirmed" : "Email not confirmed"}
                          </span>
                          {contact.phone && <span>Phone: {contact.phone}{contact.phone_contact_confirmed_at ? " · email-confirmed" : " · not confirmed"}</span>}
                          {contact.website_url && <a href={contact.website_url} target="_blank" rel="noreferrer">Website</a>}
                          {contact.instagram_url && <a href={contact.instagram_url} target="_blank" rel="noreferrer">Instagram</a>}
                          {contact.business_address && <span>{contact.business_address}</span>}
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    {(() => {
                      const account = adAccountBySellerId.get(seller.id);
                      if (!account) return <span className="admin-muted">No advertising balance</span>;
                      return (
                        <div className="admin-seller-credit-cell">
                          <strong>{formatNumber(account.clicks_remaining)} total</strong>
                          <small>Welcome: {formatNumber(account.welcome_clicks_remaining)}</small>
                          <small>Admin gifts: {formatNumber(account.admin_clicks_remaining)}</small>
                          <form className="admin-seller-credit-form" action={grantSellerAdCredits}>
                            <input type="hidden" name="seller_id" value={seller.id} />
                            <label>
                              <span className="visually-hidden">Free clicks for {seller.shop_name}</span>
                              <input name="clicks" type="number" min="1" max="10000000" step="1" placeholder="Clicks" required />
                            </label>
                            <label>
                              <span className="visually-hidden">Grant note for {seller.shop_name}</span>
                              <input name="note" type="text" maxLength={300} placeholder="Reason (optional)" />
                            </label>
                            <button className="admin-approve-button" type="submit">Grant free clicks</button>
                          </form>
                        </div>
                      );
                    })()}
                  </td>
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
        <div className="admin-empty-state"><h2>No matching sellers</h2><p>Try another search or filter.</p></div>
      )}
      <AdminListPagination path="/admin/sellers" filters={filters} page={page} totalPages={totalPages} totalCount={totalCount} pageSize={ADMIN_LIST_PAGE_SIZE} label="Seller" />
    </main>
  );
}