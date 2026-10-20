import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { formatDate, formatNumber } from "@/lib/format";
import { ADMIN_LIST_PAGE_SIZE, buildAdminListHref, normalizeAdminSearch, parseAdminListPage } from "@/lib/admin/listing";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { adjustVisitorPoints, setVisitorAccountStatus } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Visitors", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminVisitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; points?: string; pointsError?: string }>;
}) {
  await connection();
  const [{ q: rawQuery, status: rawStatus, page: rawPage, points: pointsMessage, pointsError }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const query = normalizeAdminSearch(rawQuery);
  const status = rawStatus === "active" || rawStatus === "suspended" ? rawStatus : "all";
  const page = parseAdminListPage(rawPage);
  const { data: visitors, error } = await supabase.rpc("admin_get_visitor_directory", {
    p_query: query,
    p_status: status,
    p_limit: ADMIN_LIST_PAGE_SIZE,
    p_offset: (page - 1) * ADMIN_LIST_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const totalCount = visitors[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_LIST_PAGE_SIZE));
  const filters = { q: query || undefined, status: status === "all" ? undefined : status };
  if (page > totalPages) redirect(buildAdminListHref("/admin/visitors", filters, totalPages));
  const currentHref = buildAdminListHref("/admin/visitors", filters, page);
  const { data: balances, error: balancesError } = visitors.length
    ? await supabase.from("loyalty_accounts").select("visitor_id,points_balance").in("visitor_id", visitors.map((visitor) => visitor.visitor_id))
    : { data: [], error: null };
  if (balancesError) throw new Error(balancesError.message);
  const balanceByVisitor = new Map((balances ?? []).map((account) => [account.visitor_id, account.points_balance]));

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">ACCOUNTS</p>
        <h1>Registered visitors</h1>
        <p>Review registered visitor accounts and suspend or restore their access. {formatNumber(totalCount)} matching visitors.</p>
      </header>
      <form className="admin-list-filters" method="get">
        <label>Search visitors<input name="q" defaultValue={query} maxLength={100} placeholder="Name, email, or account ID" /></label>
        <label>Status<select name="status" defaultValue={status}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
        <button className="admin-approve-button" type="submit">Filter visitors</button>
        {(query || status !== "all") && <Link href="/admin/visitors">Clear filters</Link>}
      </form>
      {pointsMessage && <p className="admin-save-success" role="status">{pointsMessage}</p>}
      {pointsError && <p className="admin-loyalty-error" role="alert">{pointsError}</p>}
      {visitors.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Account</th><th>Email</th><th>Joined</th><th>Last sign-in</th><th>Points</th><th>Status</th><th>Access</th></tr></thead>
            <tbody>
              {visitors.map((visitor) => {
                const isSuspended = Boolean(visitor.banned_until);
                return (
                  <tr key={visitor.visitor_id}>
                    <td><strong>{visitor.visitor_name || visitor.visitor_email || "Visitor"}</strong><small>{visitor.visitor_id}</small></td>
                    <td>
                      <span>{visitor.visitor_email || "No email"}</span>
                      <small className={visitor.email_confirmed_at ? "admin-email-confirmed" : "admin-email-unconfirmed"}>
                        {visitor.email_confirmed_at ? "Email confirmed" : "Email not confirmed"}
                      </small>
                    </td>
                    <td>{formatDate(visitor.created_at)}</td>
                    <td>{visitor.last_sign_in_at ? formatDate(visitor.last_sign_in_at) : "Never"}</td>
                    <td>
                      <strong>{formatNumber(balanceByVisitor.get(visitor.visitor_id) ?? 0)}</strong>
                      <details className="admin-points-adjust">
                        <summary>Adjust points</summary>
                        <form action={adjustVisitorPoints}>
                          <input type="hidden" name="visitor_id" value={visitor.visitor_id} />
                          <input type="hidden" name="return_to" value={currentHref} />
                          <label>Action<select name="direction" defaultValue="add"><option value="add">Add points</option><option value="deduct">Deduct points</option></select></label>
                          <label>Points<input name="points" type="number" min="1" max="100000" step="1" required /></label>
                          <label>Reason (shown to the visitor)<input name="reason" minLength={3} maxLength={200} required placeholder="e.g. Competition prize" /></label>
                          <button className="admin-approve-button" type="submit">Save points</button>
                        </form>
                      </details>
                    </td>
                    <td><span className={`admin-status admin-status-${isSuspended ? "suspended" : "active"}`}>{isSuspended ? "Suspended" : "Active"}</span></td>
                    <td>
                      <form className="admin-inline-form" action={setVisitorAccountStatus}>
                        <input type="hidden" name="visitor_id" value={visitor.visitor_id} />
                        <input type="hidden" name="status" value={isSuspended ? "active" : "suspended"} />
                        <button className={isSuspended ? "admin-approve-button" : "admin-reject-button"} type="submit">
                          {isSuspended ? "Restore access" : "Suspend account"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty-state"><h2>No matching visitors</h2><p>Try another search or filter.</p></div>
      )}
      <AdminListPagination path="/admin/visitors" filters={filters} page={page} totalPages={totalPages} totalCount={totalCount} pageSize={ADMIN_LIST_PAGE_SIZE} label="Visitor" />
    </main>
  );
}