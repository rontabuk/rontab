import type { Metadata } from "next";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { formatDate } from "@/lib/format";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { setVisitorAccountStatus } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Visitors", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminVisitorsPage() {
  await connection();
  // The service-role client bypasses RLS, so admin access must be verified first.
  await requireAdmin();
  const supabase = createSupabaseServiceRoleClient();
  const authUsers = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    authUsers.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }

  const visitorUsers = authUsers.filter((user) => user.app_metadata?.role !== "admin");
  const { data: sellers, error: sellerError } = visitorUsers.length
    ? await supabase.from("seller_profiles").select("user_id")
    : { data: [], error: null };
  if (sellerError) throw new Error(sellerError.message);

  const sellerIds = new Set((sellers ?? []).map((seller) => seller.user_id));
  const visitors = visitorUsers
    .filter((user) => !sellerIds.has(user.id))
    .sort((first, second) => Date.parse(second.created_at) - Date.parse(first.created_at));

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">ACCOUNTS</p>
        <h1>Registered visitors</h1>
        <p>Review registered visitor accounts and suspend or restore their access.</p>
      </header>
      {visitors.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Account</th><th>Email</th><th>Joined</th><th>Last sign-in</th><th>Status</th><th>Access</th></tr></thead>
            <tbody>
              {visitors.map((visitor) => {
                const isSuspended = Boolean(visitor.banned_until);
                return (
                  <tr key={visitor.id}>
                    <td><strong>{visitor.user_metadata?.display_name || visitor.email || "Visitor"}</strong><small>{visitor.id}</small></td>
                    <td>
                      <span>{visitor.email || "No email"}</span>
                      <small className={visitor.email_confirmed_at ? "admin-email-confirmed" : "admin-email-unconfirmed"}>
                        {visitor.email_confirmed_at ? "Email confirmed" : "Email not confirmed"}
                      </small>
                    </td>
                    <td>{formatDate(visitor.created_at)}</td>
                    <td>{visitor.last_sign_in_at ? formatDate(visitor.last_sign_in_at) : "Never"}</td>
                    <td><span className={`admin-status admin-status-${isSuspended ? "suspended" : "active"}`}>{isSuspended ? "Suspended" : "Active"}</span></td>
                    <td>
                      <form className="admin-inline-form" action={setVisitorAccountStatus}>
                        <input type="hidden" name="visitor_id" value={visitor.id} />
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
        <div className="admin-empty-state"><h2>No registered visitors</h2><p>Visitor accounts will appear here after registration.</p></div>
      )}
    </main>
  );
}