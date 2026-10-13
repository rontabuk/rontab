import type { ReactNode } from "react";
import { Suspense } from "react";
import { connection } from "next/server";
import { WorkspaceNavigation } from "@/components/WorkspaceNavigation";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { requireAdmin } from "@/lib/admin/access";
import { adminAreas } from "@/lib/admin/areas";

export const instant = false;

const adminLinks = [
  { href: "/admin", label: "Overview", exact: true },
  ...adminAreas.map(({ href, label }) => ({ href, label })),
];

async function ProtectedAdminShell({ children }: { children: ReactNode }) {
  const { admin } = await requireAdmin();

  return (
    <WorkspaceShell
      area="ADMIN"
      homeHref="/admin"
      sectionLabel="WORKSPACE"
      navigation={<WorkspaceNavigation label="Admin navigation" links={adminLinks} />}
      accountLabel={admin.email}
      signOutTo="/admin/login"
    >
      {children}
    </WorkspaceShell>
  );
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();

  return (
    <Suspense fallback={<main className="admin-loading">Loading private workspace…</main>}>
      <ProtectedAdminShell>{children}</ProtectedAdminShell>
    </Suspense>
  );
}