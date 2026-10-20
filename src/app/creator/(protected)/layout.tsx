import type { ReactNode } from "react";
import { Suspense } from "react";
import { connection } from "next/server";
import { WorkspaceNavigation } from "@/components/WorkspaceNavigation";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { getCreatorAccount } from "@/lib/creator/access";

export const instant = false;

const creatorLinks = [
  { href: "/creator", label: "Creator studio", exact: true },
  { href: "/creator/opportunities", label: "Product promotions" },
  { href: "/creators", label: "Creator directory" },
  { href: "/products", label: "Discover products" },
];

async function ProtectedCreatorShell({ children }: { children: ReactNode }) {
  const { user } = await getCreatorAccount();

  return (
    <WorkspaceShell
      area="CREATOR"
      sectionLabel="CREATOR WORKSPACE"
      navigation={<WorkspaceNavigation label="Creator navigation" links={creatorLinks} />}
      accountLabel={user.email ?? ""}
      signOutTo="/creator/login"
      brandBackHref="/products"
      hideMobileAccountDetails
    >
      {children}
    </WorkspaceShell>
  );
}

export default async function CreatorLayout({ children }: { children: ReactNode }) {
  await connection();

  return (
    <Suspense fallback={<main className="admin-loading">Loading creator workspace?</main>}>
      <ProtectedCreatorShell>{children}</ProtectedCreatorShell>
    </Suspense>
  );
}
