import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { getVisitorAccount } from "@/lib/visitor/access";
import { ADMIN_LIST_PAGE_SIZE, buildAdminListHref, parseAdminListPage } from "@/lib/admin/listing";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "My reports", robots: { index: false, follow: false } };
export const instant = false;

export default async function VisitorSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await connection();
  const [{ page: requestedPage }, { supabase }] = await Promise.all([searchParams, getVisitorAccount()]);
  const page = Math.min(parseAdminListPage(requestedPage), 4001);
  const { data: reportRows, error } = await supabase.rpc("get_visitor_marketplace_support_cases", {
    p_limit: ADMIN_LIST_PAGE_SIZE,
    p_offset: (page - 1) * ADMIN_LIST_PAGE_SIZE,
  });
  const trackingUnavailable = error?.code === "PGRST202";
  if (error && !trackingUnavailable) throw new Error(error.message);
  const reports = reportRows ?? [];

  const totalCount = reports[0]?.total_case_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_LIST_PAGE_SIZE));
  if (page > totalPages) redirect(buildAdminListHref("/visitor/support", {}, totalPages));

  return (
    <main className="admin-overview visitor-support-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">YOUR ACCOUNT</p>
        <h1>My reports</h1>
        <p>Follow the review status and resolution notes for your product and seller reports.</p>
      </header>
      <section className="admin-loyalty-support-queue" aria-label="Your marketplace reports">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">MARKETPLACE</p><h2>Product and seller reports</h2></div>
          <span>{formatNumber(totalCount)} total reports</span>
        </div>
        {trackingUnavailable ? (
          <p className="admin-seller-schema-notice" role="status">Report tracking will be available after the support migration is applied to this environment.</p>
        ) : reports.length ? (
          <div className="visitor-support-list">
            {reports.map((report) => (
              <article className="visitor-support-item" key={report.case_id}>
                <div>
                  <div className="admin-loyalty-offer-tags">
                    <span className={`admin-loyalty-status is-${report.status}`}>{report.status.replaceAll("_", " ")}</span>
                    <span className="admin-loyalty-kind">{report.target_type === "product" ? "Product" : "Seller account"}</span>
                    <span className="admin-loyalty-kind">{report.issue_type.replaceAll("_", " ")}</span>
                  </div>
                  <h3>{report.target_name}</h3>
                  <p>{report.description}</p>
                  <small>Reported {formatDateTime(report.created_at)}</small>
                  {report.resolution_note && (
                    <p className="visitor-support-resolution"><strong>Support response</strong>{report.resolution_note}</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty-state"><h2>No reports yet</h2><p>Reports you send from a product page will appear here.</p></div>
        )}
        {!trackingUnavailable && <AdminListPagination path="/visitor/support" filters={{}} page={page} totalPages={totalPages} totalCount={totalCount} pageSize={ADMIN_LIST_PAGE_SIZE} label="Report" />}
      </section>
    </main>
  );
}