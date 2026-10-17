import type { ReactNode } from "react";
import { Suspense } from "react";
import { connection } from "next/server";
import { SellerNavigation } from "@/components/seller/SellerNavigation";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { getSellerAccount } from "@/lib/seller/access";

export const instant = false;

async function ProtectedSellerShell({ children }: { children: ReactNode }) {
  const { supabase, seller } = await getSellerAccount();
  const { data: hasNewAdCreditGrants, error } = await supabase.rpc("seller_has_new_ad_credit_grants");
  if (error) throw new Error(error.message);

  return (
    <WorkspaceShell
      area="SELLER"
      sectionLabel="SHOP WORKSPACE"
      navigation={<SellerNavigation hasNewAdCreditGrants={hasNewAdCreditGrants} />}
      accountLabel={`${seller.shop_name} · ${seller.status}`}
      signOutTo="/seller/login"
      hideMobileAccountDetails
    >
      {children}
    </WorkspaceShell>
  );
}

export default async function SellerLayout({ children }: { children: ReactNode }) {
  await connection();

  return (
    <Suspense fallback={<main className="admin-loading">Loading seller workspace…</main>}>
      <ProtectedSellerShell>{children}</ProtectedSellerShell>
    </Suspense>
  );
}