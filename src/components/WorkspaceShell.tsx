import Link from "next/link";
import type { ReactNode } from "react";
import { signOut, type SignOutDestination } from "@/lib/auth/actions";

export function WorkspaceShell({
  area,
  sectionLabel,
  navigation,
  accountLabel,
  signOutTo,
  hideMobileAccountDetails = false,
  children,
}: {
  area?: string;
  sectionLabel: string;
  navigation: ReactNode;
  accountLabel: string;
  signOutTo: SignOutDestination;
  hideMobileAccountDetails?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`admin-shell${hideMobileAccountDetails ? " admin-shell-hide-mobile-account" : ""}`}>
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/products">
          <span className="admin-brand-word">RonTab</span>
          {area && <small>{area}</small>}
        </Link>
        <p className="admin-sidebar-label">{sectionLabel}</p>
        {navigation}
        <div className="admin-sidebar-bottom">
          <span>{accountLabel}</span>
          <form action={signOut.bind(null, signOutTo)}>
            <button className="admin-signout-button" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
