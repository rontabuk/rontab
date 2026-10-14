import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Boxes, LifeBuoy, Store, TicketCheck } from "lucide-react";
import { requireAdmin } from "@/lib/admin/access";
import { formatDateTime, formatNumber } from "@/lib/format";
import { adminAreas, plannedAdminAreas } from "@/lib/admin/areas";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";

export const metadata: Metadata = {
  title: "Admin overview",
  robots: { index: false, follow: false },
};
export const instant = false;

export default async function AdminOverviewPage() {
  await connection();
  const { supabase } = await requireAdmin();
  const [productsResult, sellersResult, requestsResult, offersResult, auditResult, profilesResult, verifiedProfilesResult, activeSellersResult, approvedProductsResult, rewardSupportResult, voucherSupportResult, marketplaceSupportResult] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("seller_profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("seller_offer_requests").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    supabase.from("seller_offers").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("admin_audit_logs").select("id,action,entity_type,entity_id,created_at,actor_id").order("created_at", { ascending: false }).limit(8),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).not("email_verified_at", "is", null),
    supabase.from("seller_profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "approved"),
    supabase.rpc("admin_get_loyalty_claim_support_cases", { p_limit: 1, p_offset: 0 }),
    supabase.rpc("admin_get_seller_voucher_support_cases", { p_limit: 1, p_offset: 0 }),
    supabase.rpc("admin_get_marketplace_support_cases", { p_limit: 1, p_offset: 0 }),
  ]);
  for (const result of [productsResult, sellersResult, auditResult, profilesResult, verifiedProfilesResult, activeSellersResult, approvedProductsResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const requestsSchemaUnavailable = isSellerOfferSchemaUnavailable(requestsResult.error);
  const offersSchemaUnavailable = isSellerOfferSchemaUnavailable(offersResult.error);
  if (requestsResult.error && !requestsSchemaUnavailable) throw new Error(requestsResult.error.message);
  if (offersResult.error && !offersSchemaUnavailable) throw new Error(offersResult.error.message);
  const offerSchemaUnavailable = requestsSchemaUnavailable || offersSchemaUnavailable;
  const rewardSupportUnavailable = rewardSupportResult.error?.code === "PGRST202";
  const voucherSupportUnavailable = voucherSupportResult.error?.code === "PGRST202";
  const marketplaceSupportUnavailable = marketplaceSupportResult.error?.code === "PGRST202";
  if (rewardSupportResult.error && !rewardSupportUnavailable) throw new Error(rewardSupportResult.error.message);
  if (voucherSupportResult.error && !voucherSupportUnavailable) throw new Error(voucherSupportResult.error.message);
  if (marketplaceSupportResult.error && !marketplaceSupportUnavailable) throw new Error(marketplaceSupportResult.error.message);
  const supportUnavailable = rewardSupportUnavailable || voucherSupportUnavailable || marketplaceSupportUnavailable;
  const supportCount = supportUnavailable
    ? null
    : (rewardSupportResult.data?.[0]?.total_case_count ?? 0)
      + (voucherSupportResult.data?.[0]?.total_case_count ?? 0)
      + (marketplaceSupportResult.data?.[0]?.total_case_count ?? 0);
  const recentActivity = auditResult.data ?? [];
  const requestCount = offerSchemaUnavailable ? null : requestsResult.count ?? 0;
  const offerCount = offerSchemaUnavailable ? null : offersResult.count ?? 0;

  const queues = [
    { href: "/admin/products", label: "Product review", count: productsResult.count ?? 0, icon: Boxes },
    { href: "/admin/sellers", label: "Seller applications", count: sellersResult.count ?? 0, icon: Store },
    { href: "/admin/seller-offers", label: "Offer requests", count: requestCount, icon: TicketCheck },
    { href: "/admin/support", label: "Support cases", count: supportCount, icon: LifeBuoy },
  ];

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CONTROL ROOM</p>
        <h1>Operations overview</h1>
        <p>Live queues, marketplace activity, and recent administrative decisions.</p>
      </header>
      <section className="admin-dashboard-stats" aria-label="Marketplace operations">
        <div><span>Registered accounts</span><strong>{formatNumber(profilesResult.count ?? 0)}</strong></div>
        <div><span>Email-verified accounts</span><strong>{formatNumber(verifiedProfilesResult.count ?? 0)}</strong></div>
        <div><span>Active shops</span><strong>{formatNumber(activeSellersResult.count ?? 0)}</strong></div>
        <div><span>Published products</span><strong>{formatNumber(approvedProductsResult.count ?? 0)}</strong></div>
        <div><span>Products awaiting review</span><strong>{formatNumber(productsResult.count ?? 0)}</strong></div>
        <div><span>Seller applications</span><strong>{formatNumber(sellersResult.count ?? 0)}</strong></div>
        <div><span>Offer requests</span><strong>{requestCount === null ? "—" : formatNumber(requestCount)}</strong></div>
        <div><span>Published seller offers</span><strong>{offerCount === null ? "—" : formatNumber(offerCount)}</strong></div>
      </section>
      {offerSchemaUnavailable && <p className="admin-seller-schema-notice" role="status">Seller-offer metrics are unavailable until the seller-offer migrations are applied to this environment.</p>}
      <section className="admin-dashboard-section" aria-labelledby="admin-work-queue-title">
        <div className="admin-loyalty-list-heading"><div><p className="admin-eyebrow">NEEDS ATTENTION</p><h2 id="admin-work-queue-title">Work queues</h2></div></div>
        <div className="admin-work-queue">
          {queues.map(({ href, label, count, icon: Icon }) => (
            <Link className="admin-work-queue-item" href={href} key={href}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              <strong>{count === null ? "—" : formatNumber(count)}</strong>
            </Link>
          ))}
        </div>
      </section>
      <section className="admin-dashboard-section" aria-labelledby="admin-recent-activity-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">GOVERNANCE</p><h2 id="admin-recent-activity-title">Recent activity</h2></div>
          <Link href="/admin/audit-log">Open audit log</Link>
        </div>
        {recentActivity.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Action</th><th>Record</th><th>Administrator</th><th>Time</th></tr></thead>
              <tbody>{recentActivity.map((entry) => (
                <tr key={entry.id}>
                  <td><strong>{entry.action.replaceAll("_", " ")}</strong></td>
                  <td>{entry.entity_type.replaceAll("_", " ")}{entry.entity_id && <small>{entry.entity_id}</small>}</td>
                  <td><small>{entry.actor_id}</small></td>
                  <td>{formatDateTime(entry.created_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="admin-empty-state"><h2>No recorded activity yet</h2><p>Administrative decisions will appear here when recorded.</p></div>}
      </section>
      <section className="admin-area-grid" aria-label="Administration areas">
        {adminAreas.map((area) => (
          <article className="admin-area-item" key={area.href}>
            <span className="admin-area-indicator is-live" aria-hidden="true" />
            <div>
              <h2><Link href={area.href}>{area.label}</Link></h2>
              <p>{area.description}</p>
            </div>
            <span className="admin-area-status">Open</span>
          </article>
        ))}
        {plannedAdminAreas.map((area) => (
          <article className="admin-area-item" key={area.label}>
            <span className="admin-area-indicator" aria-hidden="true" />
            <div>
              <h2>{area.label}</h2>
              <p>{area.description}</p>
            </div>
            <span className="admin-area-status">Planned</span>
          </article>
        ))}
      </section>
      <p className="admin-setup-notice">Access is restricted by Supabase Auth and a verified admin app role. Audit entries are read from the protected database log.</p>
    </main>
  );
}