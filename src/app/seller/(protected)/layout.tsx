import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { SellerSignOutButton } from "@/components/seller/SellerSignOutButton";
import { getSellerAccount } from "@/lib/seller/access";

export const instant = false;

async function ProtectedSellerShell({ children }: { children: ReactNode }) {
  const { seller } = await getSellerAccount();

  return (
    <div className="admin-shell seller-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/seller">rontab<span>.</span><small>SELLER</small></Link>
        <p className="admin-sidebar-label">SHOP WORKSPACE</p>
        <nav className="admin-navigation" aria-label="Seller navigation">
          <Link className="admin-navigation-active" href="/seller">Products</Link>
        </nav>
        <div className="admin-sidebar-bottom">
          <span>{seller.shop_name} · {seller.status}</span>
          <SellerSignOutButton />
        </div>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}

export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="admin-loading">Loading seller workspace…</main>}>
      <ProtectedSellerShell>{children}</ProtectedSellerShell>
    </Suspense>
  );
}