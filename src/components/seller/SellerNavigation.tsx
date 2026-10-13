"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { markSellerAdCreditGrantsSeen } from "@/app/seller/(protected)/actions";
import { WorkspaceNavigation } from "@/components/WorkspaceNavigation";

export function SellerNavigation({ hasNewAdCreditGrants }: { hasNewAdCreditGrants: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/seller/advertising" && hasNewAdCreditGrants) {
      void markSellerAdCreditGrantsSeen();
    }
  }, [pathname, hasNewAdCreditGrants]);

  return (
    <WorkspaceNavigation
      label="Seller navigation"
      links={[
        { href: "/seller/profile", label: "Profile" },
        { href: "/seller", label: "Add products", exact: true },
        { href: "/seller/products", label: "Your products" },
        {
          href: "/seller/advertising",
          label: "Advertising",
          indicator: hasNewAdCreditGrants ? "New admin click-credit grant" : undefined,
        },
      ]}
    />
  );
}