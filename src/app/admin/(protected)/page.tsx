import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { adminAreas, plannedAdminAreas } from "@/lib/admin/areas";

export const metadata: Metadata = {
  title: "Admin overview",
  robots: { index: false, follow: false },
};
export const instant = false;

export default async function AdminOverviewPage() {
  await connection();
  await requireAdmin();

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CONTROL ROOM</p>
        <h1>Administration</h1>
        <p>Private workspace for Rontab operations.</p>
      </header>
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
      <p className="admin-setup-notice">Access is restricted by Supabase Auth and a verified admin app role. Product review, seller approvals, category changes, and reward decisions write audit records.</p>
    </main>
  );
}