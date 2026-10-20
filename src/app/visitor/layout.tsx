import type { ReactNode } from "react";
import { Suspense } from "react";
import { connection } from "next/server";
import { WorkspaceNavigation } from "@/components/WorkspaceNavigation";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { BecomeCreatorDialog } from "@/components/visitor/BecomeCreatorDialog";
import { getVisitorAccount } from "@/lib/visitor/access";
import "./visitor.css";

export const instant = false;

const visitorLinks = [
  { href: "/visitor", label: "My profile", exact: true },
  { href: "/visitor/support", label: "My reports" },
  { href: "/visitor/rewards", label: "Points & rewards" },
  { href: "/products", label: "Discover products" },
  { href: "/visitor/fans", label: "I'm a fan of" },
  { href: "/visitor/shops-following", label: "Shops I follow" },
];

async function ProtectedVisitorShell({ children }: { children: ReactNode }) {
  const { user } = await getVisitorAccount();

  return (
    <WorkspaceShell
      sectionLabel="YOUR ACCOUNT"
      navigation={(
        <>
          <WorkspaceNavigation label="Account navigation" links={visitorLinks} />
          <BecomeCreatorDialog />
        </>
      )}
      accountLabel={user.email ?? ""}
      signOutTo="/"
      hideMobileAccountDetails
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