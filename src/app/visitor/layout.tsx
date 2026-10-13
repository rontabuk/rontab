import type { ReactNode } from "react";
import { Suspense } from "react";
import { connection } from "next/server";
import { WorkspaceNavigation } from "@/components/WorkspaceNavigation";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { getVisitorAccount } from "@/lib/visitor/access";
import "./visitor.css";

export const instant = false;

const visitorLinks = [
  { href: "/visitor", label: "My profile", exact: true },
  { href: "/visitor/rewards", label: "Points & rewards" },
  { href: "/products", label: "Discover products" },
];

async function ProtectedVisitorShell({ children }: { children: ReactNode }) {
  const { user } = await getVisitorAccount();

  return (
    <WorkspaceShell
      area="VISITOR"
      homeHref="/visitor"
      sectionLabel="YOUR ACCOUNT"
      navigation={<WorkspaceNavigation label="Visitor navigation" links={visitorLinks} />}
      accountLabel={user.email ?? ""}
      signOutTo="/"
    >
      {children}
    </WorkspaceShell>
  );
}

export default async function VisitorLayout({ children }: { children: ReactNode }) {
  await connection();

  return (
    <Suspense fallback={<main className="admin-loading">Loading your account…</main>}>
      <ProtectedVisitorShell>{children}</ProtectedVisitorShell>
    </Suspense>
  );
}