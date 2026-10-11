import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSignOutButton } from "@/components/admin/AdminSignOutButton";
import { getAdminUser } from "@/lib/supabase/server";

export const instant = false;

async function ProtectedAdminShell({ children }: { children: ReactNode }) {
  const admin = await getAdminUser();

  if (!admin) redirect("/admin/login");

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin">rontab<span>.</span><small>ADMIN</small></Link>
        <p className="admin-sidebar-label">WORKSPACE</p>
        <nav className="admin-navigation" aria-label="Admin navigation">
          <Link className="admin-navigation-active" href="/admin">Overview</Link>
          <Link href="/admin/products">Product review</Link>
          <Link href="/admin/sellers">Sellers</Link>
          <Link href="/admin/categories">Categories</Link>
        </nav>
        <div className="admin-sidebar-bottom">
          <span>{admin.email}</span>
          <AdminSignOutButton />
        </div>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="admin-loading">Loading private workspace…</main>}>
      <ProtectedAdminShell>{children}</ProtectedAdminShell>
    </Suspense>
  );
}