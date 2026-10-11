import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Admin overview",
  robots: { index: false, follow: false },
};

const adminAreas = [
  { title: "Product review", description: "Review and moderate product listings.", href: "/admin/products" },
  { title: "Sellers", description: "Manage seller access and account status.", href: "/admin/sellers" },
  { title: "Categories", description: "Organize the product discovery taxonomy.", href: "/admin/categories" },
  { title: "Plans & billing", description: "Configure plans and subscription policies." },
  { title: "Loyalty & rewards", description: "Review points, badges, and reward grants." },
  { title: "Audit log", description: "Track sensitive administrative activity." },
];

export default function AdminOverviewPage() {
  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CONTROL ROOM</p>
        <h1>Administration</h1>
        <p>Private workspace for Rontab operations.</p>
      </header>
      <section className="admin-area-grid" aria-label="Administration areas">
        {adminAreas.map((area) => (
          <article className="admin-area-item" key={area.title}>
            <span className="admin-area-indicator" aria-hidden="true" />
            <div>
              <h2>{area.href ? <Link href={area.href}>{area.title}</Link> : area.title}</h2>
              <p>{area.description}</p>
            </div>
            <span className="admin-area-status">{area.href ? "Open" : "Setup pending"}</span>
          </article>
        ))}
      </section>
      <p className="admin-setup-notice">Access is restricted by Supabase Auth and a verified admin app role. Product review, seller approvals, and category management write audit records.</p>
    </main>
  );
}