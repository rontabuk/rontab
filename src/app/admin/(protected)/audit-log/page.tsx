import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };
export const instant = false;

const pageSize = 50;

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; page?: string }>;
}) {
  await connection();
  const [{ action: rawAction, entity: rawEntity, page: rawPage }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const action = normalizeFilter(rawAction);
  const entity = normalizeFilter(rawEntity);
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isSafeInteger(parsedPage) ? Math.max(1, parsedPage) : 1;
  let query = supabase
    .from("admin_audit_logs")
    .select("id,action,entity_type,entity_id,details,created_at,actor_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (action) query = query.ilike("action", `%${action}%`);
  if (entity) query = query.ilike("entity_type", `%${entity}%`);

  const { data: entries, count, error } = await query;
  if (error) throw new Error(error.message);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const filterParams = new URLSearchParams();
  if (action) filterParams.set("action", action);
  if (entity) filterParams.set("entity", entity);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams(filterParams);
    params.set("page", String(targetPage));
    return `/admin/audit-log?${params.toString()}`;
  }
  if (page > totalPages) redirect(pageHref(totalPages));

  return (
    <main className="admin-overview admin-audit-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">GOVERNANCE</p>
        <h1>Audit log</h1>
        <p>Administrative changes recorded by the database, newest first.</p>
      </header>
      <form className="admin-audit-filters" method="get">
        <label>Action<input name="action" defaultValue={action} maxLength={80} placeholder="e.g. seller_approved" /></label>
        <label>Record type<input name="entity" defaultValue={entity} maxLength={80} placeholder="e.g. product" /></label>
        <button className="admin-approve-button" type="submit">Filter log</button>
        {(action || entity) && <Link href="/admin/audit-log">Clear filters</Link>}
      </form>
      <div className="admin-audit-summary"><span>{formatNumber(count ?? 0)} matching events</span><span>Page {formatNumber(page)} of {formatNumber(totalPages)}</span></div>
      {entries.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Time</th><th>Action</th><th>Record</th><th>Administrator</th><th>Details</th></tr></thead>
            <tbody>{entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDateTime(entry.created_at)}</td>
                <td><strong>{entry.action.replaceAll("_", " ")}</strong><small>{entry.action}</small></td>
                <td>{entry.entity_type.replaceAll("_", " ")}<small>{entry.entity_id ?? "No record ID"}</small></td>
                <td><small>{entry.actor_id}</small></td>
                <td><details className="admin-audit-details"><summary>View details</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="admin-empty-state"><h2>No matching activity</h2><p>Try a broader action or record type filter.</p></div>}
      <nav className="admin-audit-pagination" aria-label="Audit log pages">
        {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span aria-disabled="true">Previous</span>}
        {page < totalPages ? <Link href={pageHref(page + 1)}>Next</Link> : <span aria-disabled="true">Next</span>}
      </nav>
    </main>
  );
}

function normalizeFilter(value: string | undefined) {
  return (value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}